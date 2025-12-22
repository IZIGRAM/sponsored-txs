import { expect } from "chai";
import { ethers } from "hardhat";

function pack128(high: bigint, low: bigint): string {
	// bytes32 = (high << 128) | low
	const packed = (high << 128n) | low;
	return ethers.zeroPadValue(ethers.toBeHex(packed), 32);
}

function u48ToBytes6(value: bigint): string {
	return ethers.zeroPadValue(ethers.toBeHex(value), 6);
}

function u128ToBytes16(value: bigint): string {
	return ethers.zeroPadValue(ethers.toBeHex(value), 16);
}

function concatHex(parts: string[]): string {
	return ethers.concat(parts.map((p) => ethers.getBytes(p)));
}

function normalizeSig(sig: string): string {
	const N = BigInt(
		"0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"
	);
	const HALF_N = BigInt(
		"0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0"
	);

	const sigObj = ethers.Signature.from(sig);
	let v = sigObj.v < 27 ? sigObj.v + 27 : sigObj.v;

	let sValue = BigInt(sigObj.s);
	if (sValue > HALF_N) {
		sValue = N - sValue;
		v = v === 27 ? 28 : 27;
	}

	const sHex = ethers.toBeHex(sValue, 32);
	return ethers.Signature.from({ r: sigObj.r, s: sHex, v }).serialized;
}

describe("Sponsored tx: ERC20 approve + transfer", function () {
	it("executes approve and transfer sponsored by paymaster", async function () {
		const [bundler, sponsor, owner, recipient] = await ethers.getSigners();

		// Deploy EntryPoint (local wrapper)
		const EntryPoint = await ethers.getContractFactory("LocalEntryPoint");
		const entryPoint = await EntryPoint.deploy();
		await entryPoint.waitForDeployment();

		// Deploy Paymaster with sponsor signer
		const Paymaster = await ethers.getContractFactory("SponsoredPaymaster");
		const paymaster = await Paymaster.deploy(
			await entryPoint.getAddress(),
			sponsor.address
		);
		await paymaster.waitForDeployment();

		// Deposit ETH to paymaster in EntryPoint
		await paymaster.connect(bundler).deposit({ value: ethers.parseEther("1") });

		// Deploy Factory + Account
		const Factory = await ethers.getContractFactory("SponsoredAccountFactory");
		const factory = await Factory.deploy(await entryPoint.getAddress());
		await factory.waitForDeployment();

		const salt = 123n;
		const predicted = await factory["getAddress(address,uint256)"](
			owner.address,
			salt
		);
		await (await factory.createAccount(owner.address, salt)).wait();

		const account = await ethers.getContractAt("SponsoredAccount", predicted);
		expect(await account.owner()).to.equal(owner.address);
		expect(await account.entryPoint()).to.equal(await entryPoint.getAddress());

		// Deploy ERC20 + mint to account
		const Token = await ethers.getContractFactory("MockERC20");
		const token = await Token.deploy("Mock", "MOCK");
		await token.waitForDeployment();

		await token.mint(await account.getAddress(), 1000n);

		// Helper to build and sign a sponsored UserOp
		async function buildSponsoredUserOp(callData: string, nonce: bigint) {
			const chainId = BigInt((await ethers.provider.getNetwork()).chainId);

			// Gas params (keep generous for tests)
			const verificationGasLimit = 10_000_000n;
			const callGasLimit = 2_000_000n;
			const accountGasLimits = pack128(verificationGasLimit, callGasLimit);
			// sanity: packing matches EntryPoint unpackUints
			const packedAGL = BigInt(accountGasLimits);
			expect(packedAGL >> 128n).to.equal(verificationGasLimit);
			expect(packedAGL & ((1n << 128n) - 1n)).to.equal(callGasLimit);

			const maxPriorityFeePerGas = 1_000_000_000n; // 1 gwei
			const maxFeePerGas = 1_000_000_000n; // 1 gwei
			const gasFees = pack128(maxPriorityFeePerGas, maxFeePerGas);
			const packedFees = BigInt(gasFees);
			expect(packedFees >> 128n).to.equal(maxPriorityFeePerGas);
			expect(packedFees & ((1n << 128n) - 1n)).to.equal(maxFeePerGas);

			const preVerificationGas = 100_000n;

			// Paymaster header fields
			const pmVerificationGasLimit = 5_000_000n;
			const pmPostOpGasLimit = 0n; // postOp not used (context empty), but field must exist

			const validAfter = 0n;
			const validUntil = 0n; // 0 = "indefinitely" in EntryPoint parsing

			const paymasterAndData = concatHex([
				await paymaster.getAddress(),
				u128ToBytes16(pmVerificationGasLimit),
				u128ToBytes16(pmPostOpGasLimit),
				u48ToBytes6(validUntil),
				u48ToBytes6(validAfter),
			]);

			// UserOp object (PackedUserOperation)
			const userOp = {
				sender: await account.getAddress(),
				nonce,
				initCode: "0x",
				callData,
				accountGasLimits,
				preVerificationGas,
				gasFees,
				paymasterAndData,
				signature: "0x",
			} as const;

			// Owner signature: sign EIP-712 typed data matching EntryPoint.getUserOpHash
			const domain = {
				name: "ERC4337",
				version: "1",
				chainId: Number(chainId),
				verifyingContract: await entryPoint.getAddress(),
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
			} as const;

			const ownerSig = await owner.signTypedData(domain, types, {
				sender: userOp.sender,
				nonce: userOp.nonce,
				initCode: userOp.initCode,
				callData: userOp.callData,
				accountGasLimits: userOp.accountGasLimits,
				preVerificationGas: userOp.preVerificationGas,
				gasFees: userOp.gasFees,
				paymasterAndData: userOp.paymasterAndData,
			});

			const ownerSigNorm = normalizeSig(ownerSig);

			// Sponsor signature: eth_sign style over paymaster.getSponsorHash(userOpHash,...)
			const userOpHash: string = await entryPoint.getUserOpHash(userOp);
			const sponsorHash: string = await paymaster.getSponsorHash(
				userOpHash,
				validUntil,
				validAfter
			);
			const sponsorSig = normalizeSig(
				await sponsor.signMessage(ethers.getBytes(sponsorHash))
			);

			const signature = concatHex([ownerSigNorm, sponsorSig]);

			// Preflight: make sure signatures validate off-chain the same way contracts do.
			const recoveredOwner = ethers.recoverAddress(userOpHash, ownerSigNorm);
			expect(recoveredOwner).to.equal(owner.address);

			const recoveredSponsor = ethers.verifyMessage(
				ethers.getBytes(sponsorHash),
				sponsorSig
			);
			expect(recoveredSponsor).to.equal(sponsor.address);

			return { ...userOp, signature };
		}

		// 1) Sponsored approve(recipient, 100)
		const approveData = token.interface.encodeFunctionData("approve", [
			recipient.address,
			100n,
		]);
		const callApprove = account.interface.encodeFunctionData("execute", [
			await token.getAddress(),
			0,
			approveData,
		]);

		const nonce0 = await entryPoint.getNonce(await account.getAddress(), 0);
		const userOp1 = await buildSponsoredUserOp(callApprove, nonce0);

		await entryPoint.connect(bundler).handleOps([userOp1], bundler.address);

		expect(
			await token.allowance(await account.getAddress(), recipient.address)
		).to.equal(100n);

		// 2) Sponsored transfer(recipient, 50)
		const transferData = token.interface.encodeFunctionData("transfer", [
			recipient.address,
			50n,
		]);
		const callTransfer = account.interface.encodeFunctionData("execute", [
			await token.getAddress(),
			0,
			transferData,
		]);

		const nonce1 = await entryPoint.getNonce(await account.getAddress(), 0);
		const userOp2 = await buildSponsoredUserOp(callTransfer, nonce1);

		await entryPoint.connect(bundler).handleOps([userOp2], bundler.address);

		expect(await token.balanceOf(recipient.address)).to.equal(50n);
		expect(await token.balanceOf(await account.getAddress())).to.equal(950n);
	});
});
