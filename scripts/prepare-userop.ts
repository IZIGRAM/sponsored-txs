import { ethers } from "hardhat";
import type { Signer } from "ethers";
import {
	pack128,
	u48ToBytes6,
	u128ToBytes16,
	concatHex,
} from "./utils/gas-utils";
import {
	SponsoredAccountFactory__factory,
	LocalEntryPoint__factory,
} from "../typechain-types/factories/contracts";
import { normalizeSig } from "./utils/signature-utils";
import { generateERC20ApproveCallData } from "./utils/calldata-utils";

// Реэкспорт утилит для удобства
export {
	pack128,
	u48ToBytes6,
	u128ToBytes16,
	concatHex,
	unpack128,
} from "./utils/gas-utils";
export { normalizeSig } from "./utils/signature-utils";
export {
	generateCallData,
	generateERC20ApproveCallData,
	generateERC20TransferCallData,
	generateCustomCallData,
	generateETHTransferCallData,
} from "./utils/calldata-utils";

export interface PrepareUserOpParams {
	// Адреса контрактов
	entryPointAddress: string;
	accountAddress: string;
	paymasterAddress: string;

	// Signers
	ownerSigner: Signer; // Владелец аккаунта
	sponsorSigner: Signer; // Спонсор (подписывает paymaster)

	// Данные операции
	callData: string; // Закодированный вызов execute()
	nonce: bigint; // Nonce из EntryPoint

	// Опциональные параметры
	initCode?: string; // Для создания нового аккаунта (по умолчанию "0x")

	// Gas параметры (опциональные, есть значения по умолчанию)
	verificationGasLimit?: bigint;
	callGasLimit?: bigint;
	preVerificationGas?: bigint;
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;

	// Paymaster параметры
	paymasterVerificationGasLimit?: bigint;
	paymasterPostOpGasLimit?: bigint;
	validUntil?: bigint; // Временные рамки для paymaster (0 = бессрочно)
	validAfter?: bigint;

	// Сеть
	network?: string;
}

export interface UserOperationDto {
	sender: string;
	nonce: string;
	initCode: string;
	callData: string;
	callGasLimit: string;
	verificationGasLimit: string;
	preVerificationGas: string;
	maxFeePerGas: string;
	maxPriorityFeePerGas: string;
	paymasterAndData: string;
	signature: string;
	network: string;
}

/**
 * Подготовка UserOperation для ERC-4337
 */
export async function prepareUserOperation(
	params: PrepareUserOpParams
): Promise<UserOperationDto> {
	console.log("[prepareUserOperation] Start");
	const verificationGasLimit = params.verificationGasLimit ?? 10_000_000n;
	const callGasLimit = params.callGasLimit ?? 2_000_000n;
	const preVerificationGas = params.preVerificationGas ?? 100_000n;
	const maxFeePerGas = params.maxFeePerGas ?? 1_000_000_000n;
	const maxPriorityFeePerGas = params.maxPriorityFeePerGas ?? 1_000_000_000n;

	const pmVerificationGasLimit =
		params.paymasterVerificationGasLimit ?? 5_000_000n;
	const pmPostOpGasLimit = params.paymasterPostOpGasLimit ?? 0n;
	const validUntil = params.validUntil ?? 0n;
	const validAfter = params.validAfter ?? 0n;

	const initCode = params.initCode ?? "0x";
	const network = params.network ?? "mainnet";

	const accountGasLimits = pack128(verificationGasLimit, callGasLimit);
	const gasFees = pack128(maxPriorityFeePerGas, maxFeePerGas);

	const paymasterAndData = concatHex([
		params.paymasterAddress,
		u128ToBytes16(pmVerificationGasLimit),
		u128ToBytes16(pmPostOpGasLimit),
		u48ToBytes6(validUntil),
		u48ToBytes6(validAfter),
	]);

	const userOp = {
		sender: params.accountAddress,
		nonce: params.nonce,
		initCode,
		callData: params.callData,
		accountGasLimits,
		preVerificationGas,
		gasFees,
		paymasterAndData,
		signature: "0x",
	} as const;

	console.log("[prepareUserOperation] UserOp object built");

	const chainId = BigInt((await ethers.provider.getNetwork()).chainId);
	console.log("[prepareUserOperation] chainId:", chainId.toString());

	// EIP-712 domain для EntryPoint
	const domain = {
		name: "ERC4337",
		version: "1",
		chainId: Number(chainId),
		verifyingContract: params.entryPointAddress,
	} as const;

	const types = {
		PackedUserOperation: [
			{ name: "sender", type: "address" },
			{ name: "nonce", type: "uint256" },
			{ name: "initCode", type: "bytes" },
			{ name: "callData", type: "bytes" },
			{ name: "accountGasLimits", type: "bytes32" },
			{ name: "preVerificationGas", type: "uint256" },
			{ name: "gasFees", type: "bytes32" },
			{ name: "paymasterAndData", type: "bytes" },
		],
	};

	let ownerSig: string;
	try {
		if (typeof (params.ownerSigner as any)._signTypedData === "function") {
			ownerSig = await (params.ownerSigner as any)._signTypedData(
				domain,
				types,
				{
					sender: userOp.sender,
					nonce: userOp.nonce,
					initCode: userOp.initCode,
					callData: userOp.callData,
					accountGasLimits: userOp.accountGasLimits,
					preVerificationGas: userOp.preVerificationGas,
					gasFees: userOp.gasFees,
					paymasterAndData: userOp.paymasterAndData,
				}
			);
		} else if (
			typeof (params.ownerSigner as any).signTypedData === "function"
		) {
			ownerSig = await (params.ownerSigner as any).signTypedData(
				domain,
				types,
				{
					sender: userOp.sender,
					nonce: userOp.nonce,
					initCode: userOp.initCode,
					callData: userOp.callData,
					accountGasLimits: userOp.accountGasLimits,
					preVerificationGas: userOp.preVerificationGas,
					gasFees: userOp.gasFees,
					paymasterAndData: userOp.paymasterAndData,
				}
			);
		} else {
			throw new Error(
				"Signer does not support signTypedData or _signTypedData"
			);
		}
		console.log("[prepareUserOperation] Owner signature created");
	} catch (e) {
		console.error("[prepareUserOperation] Error signing owner signature:", e);
		throw e;
	}

	const ownerSigNorm = normalizeSig(ownerSig);
	console.log("[prepareUserOperation] Owner signature normalized");

	const entryPoint = await ethers.getContractAt(
		"LocalEntryPoint",
		params.entryPointAddress
	);
	const userOpHash: string = await entryPoint.getUserOpHash(userOp);
	console.log("[prepareUserOperation] userOpHash:", userOpHash);

	const paymaster = await ethers.getContractAt(
		"SponsoredPaymaster",
		params.paymasterAddress
	);
	const sponsorHash: string = await paymaster.getSponsorHash(
		userOpHash,
		validUntil,
		validAfter
	);
	console.log("[prepareUserOperation] sponsorHash:", sponsorHash);

	let sponsorSig: string;
	try {
		sponsorSig = normalizeSig(
			await params.sponsorSigner.signMessage(ethers.getBytes(sponsorHash))
		);
		console.log(
			"[prepareUserOperation] Sponsor signature created and normalized"
		);
	} catch (e) {
		console.error("[prepareUserOperation] Error signing sponsor signature:", e);
		throw e;
	}

	const signature = concatHex([ownerSigNorm, sponsorSig]);
	console.log("[prepareUserOperation] Signatures concatenated");

	const result = {
		sender: params.accountAddress,
		nonce: ethers.toBeHex(params.nonce),
		initCode,
		callData: params.callData,
		callGasLimit: ethers.toBeHex(callGasLimit),
		verificationGasLimit: ethers.toBeHex(verificationGasLimit),
		preVerificationGas: ethers.toBeHex(preVerificationGas),
		maxFeePerGas: ethers.toBeHex(maxFeePerGas),
		maxPriorityFeePerGas: ethers.toBeHex(maxPriorityFeePerGas),
		paymasterAndData,
		signature,
		network,
	};
	console.log("[prepareUserOperation] DTO ready");
	return result;
}

const ENTRYPOINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const PAYMASTER_ADDRESS = "0xf0D6ea3774e0e15940dB60bCDe2A32b43aA64029";
const TOKEN_ADDRESS = "0xF7a1385afC2007185439C05140E959Cd05ba2a7c";
const OWNER_INDEX = 0;
const SPONSOR_INDEX = 0;
const RECIPIENT_ADDRESS = "0xFCF8d2b098B3160654bbaDa1a8769483c71C288b";

async function main() {
	const signers = await ethers.getSigners();
	const sponsor = signers[SPONSOR_INDEX];
	const owner = signers[OWNER_INDEX];

	console.log(`[main] Sponsor address: ${sponsor.address}`);
	console.log(`[main] Owner address: ${owner.address}`);
	const FACTORY_ADDRESS =
		process.env.FACTORY_ADDRESS || "0xe1a59183eF026f83b3c61f058464b609bee62e90";
	const SALT = 0n;

	// Connect to the factory contract
	const factory = SponsoredAccountFactory__factory.connect(
		FACTORY_ADDRESS,
		owner
	);
	// Get the predicted account address for the owner and salt
	const ACCOUNT_ADDRESS = await factory.getAddress(owner.address, SALT);
	const entryPoint = LocalEntryPoint__factory.connect(
		ENTRYPOINT_ADDRESS,
		owner
	);
	console.log(`[main] Predicted SponsoredAccount address: ${ACCOUNT_ADDRESS}`);

	console.log("[main] Start");
	const callApprove = await generateERC20ApproveCallData(
		ACCOUNT_ADDRESS,
		TOKEN_ADDRESS,
		RECIPIENT_ADDRESS,
		100n
	);
	console.log("[main] callApprove calldata:", callApprove);

	const nonce = await entryPoint.getNonce(ACCOUNT_ADDRESS, 0);
	console.log("[main] nonce:", nonce.toString());

	const networkName =
		(ethers as any).provider?._network?.name ||
		(ethers as any).network?.name ||
		process.env.HARDHAT_NETWORK ||
		"unknown";
	console.log(`[main] Hardhat network: ${networkName}`);

	const userOpDto = await prepareUserOperation({
		entryPointAddress: ENTRYPOINT_ADDRESS,
		accountAddress: ACCOUNT_ADDRESS,
		paymasterAddress: PAYMASTER_ADDRESS,
		ownerSigner: owner,
		sponsorSigner: sponsor,
		callData: callApprove,
		nonce,
		network: networkName,
	});

	const dto = {
		sender: userOpDto.sender,
		nonce: userOpDto.nonce,
		initCode: userOpDto.initCode,
		callData: userOpDto.callData,
		callGasLimit: userOpDto.callGasLimit,
		verificationGasLimit: userOpDto.verificationGasLimit,
		preVerificationGas: userOpDto.preVerificationGas,
		maxFeePerGas: userOpDto.maxFeePerGas,
		maxPriorityFeePerGas: userOpDto.maxPriorityFeePerGas,
		paymasterAndData: userOpDto.paymasterAndData,
		signature: userOpDto.signature,
		network: userOpDto.network,
	};
	console.log("[main] Final UserOperation DTO:");
	console.log(JSON.stringify(dto, null, 2));
}

if (require.main === module) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
