# ERC-4337 Sponsored Transactions (Account Abstraction)

This project contains:

- `SponsoredAccount`: an ERC-4337 compatible smart account.
- `SponsoredPaymaster`: a verifying paymaster that sponsors gas for `UserOperation`s signed by an offchain sponsor.
- `SponsoredAccountFactory`: Create2 factory for deterministic account addresses.

## Install

```bash
npm i
```

## Compile

```bash
npx hardhat compile
```

## Local deploy (includes EntryPoint)

```bash
npx hardhat run scripts/deploy-local.ts
```

## How sponsorship works (high level)

- The user signs the `UserOperation` for the account (owner signature).
- The sponsor (verifying signer) signs an approval for the same `UserOperation`.
- The bundler includes `paymasterAndData` pointing to `SponsoredPaymaster` plus the sponsor signature.
- The paymaster validates the sponsor signature and pays gas from its deposit in EntryPoint.

## paymasterAndData format (PackedUserOperation v0.7)

`paymasterAndData` is:

1) `paymaster` address (20 bytes)
2) `paymasterVerificationGasLimit` (16 bytes)
3) `paymasterPostOpGasLimit` (16 bytes)
4) `data` (custom)

For this repo, `data` is:

- `validUntil` (6 bytes, `uint48` big-endian)
- `validAfter` (6 bytes, `uint48` big-endian)
- `signature` (65+ bytes)

The paymaster checks:

`digest = eth_signed_message_hash( keccak256( userOpHash, validUntil, validAfter, chainId, paymasterAddress ) )`

and expects `signature` from `verifyingSigner`.

## Depositing to EntryPoint

After deploying `SponsoredPaymaster`, fund it by depositing ETH into EntryPoint:

- call `SponsoredPaymaster.deposit()` (it forwards ETH to `EntryPoint.depositTo(paymaster)`)

## Cancun note

`EntryPoint` in `@account-abstraction/contracts` uses transient storage (EIP-1153), so this repo compiles with `evmVersion=cancun`.
On chains that are not Cancun-compatible, deploy/use an EntryPoint version compatible with that chain.

## Notes

- This repo expects an ERC-4337 `EntryPoint` (v0.7 compatible) address. For local dev you can deploy one.
