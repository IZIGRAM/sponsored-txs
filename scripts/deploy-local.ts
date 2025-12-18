import { ethers } from "hardhat";

async function main() {
	// Local deployment includes EntryPoint.
	const EntryPoint = await ethers.getContractFactory("LocalEntryPoint");
	const entryPoint = await EntryPoint.deploy();
	await entryPoint.waitForDeployment();

	const [deployer] = await ethers.getSigners();

	const SponsoredPaymaster = await ethers.getContractFactory(
		"SponsoredPaymaster"
	);
	const paymaster = await SponsoredPaymaster.deploy(
		await entryPoint.getAddress(),
		deployer.address
	);
	await paymaster.waitForDeployment();

	const SponsoredAccountFactory = await ethers.getContractFactory(
		"SponsoredAccountFactory"
	);
	const factory = await SponsoredAccountFactory.deploy(
		await entryPoint.getAddress()
	);
	await factory.waitForDeployment();

	console.log("EntryPoint:", await entryPoint.getAddress());
	console.log("Paymaster:", await paymaster.getAddress());
	console.log("Factory:", await factory.getAddress());
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
