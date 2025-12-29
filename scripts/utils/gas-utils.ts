import { ethers } from "hardhat";

/**
 * Упаковка двух uint128 в bytes32
 * @param high - старшие 128 бит
 * @param low - младшие 128 бит
 * @returns bytes32 строка
 */
export function pack128(high: bigint, low: bigint): string {
	const packed = (high << 128n) | low;
	return ethers.zeroPadValue(ethers.toBeHex(packed), 32);
}

/**
 * Упаковка uint48 в bytes6
 * @param value - значение для упаковки
 * @returns bytes6 строка
 */
export function u48ToBytes6(value: bigint): string {
	return ethers.zeroPadValue(ethers.toBeHex(value), 6);
}

/**
 * Упаковка uint128 в bytes16
 * @param value - значение для упаковки
 * @returns bytes16 строка
 */
export function u128ToBytes16(value: bigint): string {
	return ethers.zeroPadValue(ethers.toBeHex(value), 16);
}

/**
 * Конкатенация hex строк
 * @param parts - массив hex строк для объединения
 * @returns объединенная hex строка
 */
export function concatHex(parts: string[]): string {
	return ethers.concat(parts.map((p) => ethers.getBytes(p)));
}

/**
 * Распаковка bytes32 на два uint128
 * @param packed - упакованные данные
 * @returns массив [high, low]
 */
export function unpack128(packed: string): [bigint, bigint] {
	const value = BigInt(packed);
	const high = value >> 128n;
	const low = value & ((1n << 128n) - 1n);
	return [high, low];
}
