import { ethers } from "hardhat";

/**
 * Нормализация ECDSA подписи
 * Приводит s-value к нижней половине для совместимости с некоторыми контрактами
 * @param sig - подпись для нормализации
 * @returns нормализованная подпись
 */
export function normalizeSig(sig: string): string {
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
