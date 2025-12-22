import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
	solidity: {
		version: "0.8.28",
		settings: {
			evmVersion: "cancun",
			optimizer: { enabled: true, runs: 200 },
		},
	},
	networks: {
		ethereum: {
			url: process.env.ETHEREUM_RPC_URL ?? "",
			chainId: 1,
			accounts,
		},
		arbitrum: {
			url: process.env.ARBITRUM_RPC_URL ?? "",
			chainId: 42161,
			accounts,
		},
		optimism: {
			url: process.env.OPTIMISM_RPC_URL ?? "",
			chainId: 10,
			accounts,
		},
		sepolia: {
			url: process.env.SEPOLIA_RPC_URL ?? "",
			chainId: 11155111,
			accounts,
		},
	},
};

export default config;
