import { ethers } from "hardhat";

/**
 * Генерация callData для execute() вызова SponsoredAccount
 * @param accountAddress - адрес SponsoredAccount
 * @param targetContract - целевой контракт для вызова
 * @param value - количество wei для отправки
 * @param data - закодированные данные вызова
 * @returns закодированный callData для execute()
 */
export async function generateCallData(
	accountAddress: string,
	targetContract: string,
	value: bigint,
	data: string
): Promise<string> {
	const account = await ethers.getContractAt(
		"SponsoredAccount",
		accountAddress
	);
	return account.interface.encodeFunctionData("execute", [
		targetContract,
		value,
		data,
	]);
}

/**
 * Генерация callData для ERC20 approve
 * @param accountAddress - адрес SponsoredAccount
 * @param tokenAddress - адрес ERC20 токена
 * @param spender - адрес, которому разрешается тратить токены
 * @param amount - количество токенов для approve
 * @returns закодированный callData
 */
export async function generateERC20ApproveCallData(
	accountAddress: string,
	tokenAddress: string,
	spender: string,
	amount: bigint
): Promise<string> {
	const token = await ethers.getContractAt("MockERC20", tokenAddress);
	const approveData = token.interface.encodeFunctionData("approve", [
		spender,
		amount,
	]);

	return generateCallData(accountAddress, tokenAddress, 0n, approveData);
}

/**
 * Генерация callData для ERC20 transfer
 * @param accountAddress - адрес SponsoredAccount
 * @param tokenAddress - адрес ERC20 токена
 * @param recipient - адрес получателя
 * @param amount - количество токенов для transfer
 * @returns закодированный callData
 */
export async function generateERC20TransferCallData(
	accountAddress: string,
	tokenAddress: string,
	recipient: string,
	amount: bigint
): Promise<string> {
	const token = await ethers.getContractAt("MockERC20", tokenAddress);
	const transferData = token.interface.encodeFunctionData("transfer", [
		recipient,
		amount,
	]);

	return generateCallData(accountAddress, tokenAddress, 0n, transferData);
}

/**
 * Генерация callData для произвольного вызова контракта
 * @param accountAddress - адрес SponsoredAccount
 * @param targetContract - адрес целевого контракта
 * @param value - количество wei для отправки
 * @param functionName - имя функции для вызова
 * @param abi - ABI функции
 * @param args - аргументы функции
 * @returns закодированный callData
 */
export function generateCustomCallData(
	accountAddress: string,
	targetContract: string,
	value: bigint,
	functionName: string,
	abi: any[],
	args: any[]
): string {
	const iface = new ethers.Interface(abi);
	const data = iface.encodeFunctionData(functionName, args);

	const accountInterface = new ethers.Interface([
		"function execute(address dest, uint256 value, bytes calldata func) external",
	]);

	return accountInterface.encodeFunctionData("execute", [
		targetContract,
		value,
		data,
	]);
}

/**
 * Генерация callData для отправки ETH
 * @param recipient - адрес получателя
 * @param amount - количество wei для отправки
 * @returns закодированный callData
 */
export function generateETHTransferCallData(
	recipient: string,
	amount: bigint
): string {
	const accountInterface = new ethers.Interface([
		"function execute(address dest, uint256 value, bytes calldata func) external",
	]);

	return accountInterface.encodeFunctionData("execute", [
		recipient,
		amount,
		"0x", // пустые данные для простой отправки ETH
	]);
}
