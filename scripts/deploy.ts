import { ethers } from "hardhat";

/**
 * Deploy SponsoredPaymaster + SponsoredAccountFactory to a network where EntryPoint already exists.
 *
 * Env vars:
 * - ENTRYPOINT_ADDRESS: address of ERC-4337 EntryPoint (v0.7 / PackedUserOperation)
 * - VERIFYING_SIGNER: (optional) sponsor signer address; defaults to deployer
 * - CREATE_ACCOUNT_OWNER: (optional) if set, creates a SponsoredAccount for this owner
 * - CREATE_ACCOUNT_SALT: (optional) salt for create2, defaults to 0
 */
async function main() {
	const entryPointAddress = process.env.ENTRYPOINT_ADDRESS;
	if (!entryPointAddress) {
		throw new Error("Missing env var ENTRYPOINT_ADDRESS");
	}

	const [deployer] = await ethers.getSigners();

	const verifyingSigner = process.env.VERIFYING_SIGNER ?? deployer.address;

	console.log("Deploying SponsoredPaymaster...");
	const Paymaster = await ethers.getContractFactory("SponsoredPaymaster");
	const paymaster = await Paymaster.deploy(entryPointAddress, verifyingSigner);

	console.log("Waiting for SponsoredPaymaster deployment...");
	await paymaster.waitForDeployment();
	console.log("SponsoredPaymaster deployed at:", await paymaster.getAddress());

	console.log("Deploying SponsoredAccountFactory...");
	const Factory = await ethers.getContractFactory("SponsoredAccountFactory");
	const factory = await Factory.deploy(entryPointAddress);

	console.log("Waiting for SponsoredAccountFactory deployment...");
	await factory.waitForDeployment();

	console.log("Deployer:", deployer.address);
	console.log("EntryPoint:", entryPointAddress);
	console.log("SponsoredPaymaster:", await paymaster.getAddress());
	console.log("  verifyingSigner:", await paymaster.verifyingSigner());
	console.log("SponsoredAccountFactory:", await factory.getAddress());

	const ownerToCreate = process.env.CREATE_ACCOUNT_OWNER;
	if (ownerToCreate) {
		const salt = BigInt(process.env.CREATE_ACCOUNT_SALT ?? "0");
		const predicted = await factory["getAddress(address,uint256)"](
			ownerToCreate,
			salt
		);
		const tx = await factory.createAccount(ownerToCreate, salt);
		await tx.wait();
		console.log("SponsoredAccount (created):", predicted);
	}

	console.log("\nNext steps:");
	console.log(
		"- Fund the paymaster deposit by calling SponsoredPaymaster.deposit() with ETH"
	);
	console.log(
		"- Build UserOperations with paymasterAndData pointing to the paymaster"
	);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
