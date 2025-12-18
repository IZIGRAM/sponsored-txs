import { expect } from "chai";
import { ethers } from "hardhat";

describe("Sponsored AA contracts", function () {
	it("deploys EntryPoint + Paymaster + Factory", async function () {
		const EntryPoint = await ethers.getContractFactory("LocalEntryPoint");
		const entryPoint = await EntryPoint.deploy();
		await entryPoint.waitForDeployment();

		const [deployer] = await ethers.getSigners();

		const Paymaster = await ethers.getContractFactory("SponsoredPaymaster");
		const paymaster = await Paymaster.deploy(
			await entryPoint.getAddress(),
			deployer.address
		);
		await paymaster.waitForDeployment();

		const Factory = await ethers.getContractFactory("SponsoredAccountFactory");
		const factory = await Factory.deploy(await entryPoint.getAddress());
		await factory.waitForDeployment();

		expect(await paymaster.verifyingSigner()).to.equal(deployer.address);
		expect(await factory.entryPoint()).to.equal(await entryPoint.getAddress());
	});
});
