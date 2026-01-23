import { ethers } from 'hardhat';
import type { JsonRpcProvider, Wallet } from 'ethers';

// -------------------- Helpers --------------------
function hexPadTo(hex: string, bytes: number) {
  return ethers.zeroPadValue(hex, bytes);
}

/** pack two uint128 into bytes32: (high << 128) | low */
function packU128(high: bigint, low: bigint): string {
  const v = (high << 128n) | low;
  return ethers.toBeHex(v, 32);
}

/** build paymasterData for v0.6 format:
 * data = [validUntil(6) | validAfter(6)]
 */
function buildPaymasterData(validUntil: number, validAfter: number): string {
  const vu = hexPadTo(ethers.toBeHex(validUntil), 6);
  const va = hexPadTo(ethers.toBeHex(validAfter), 6);

  // concat as bytes: 6 + 6 = 12 bytes
  return ethers.concat([vu, va]);
}

/** pack paymasterAndData v0.7 layout:
 * [paymaster(20) | pmVerificationGasLimit(16) | pmPostOpGasLimit(16) | data...]
 * data = [validUntil(6) | validAfter(6) | signature(65+)]
 */
function buildPaymasterAndData(
  paymaster: string,
  pmVerificationGasLimit: bigint,
  pmPostOpGasLimit: bigint,
  validUntil: number,
  validAfter: number,
  sponsorSignature?: string,
): string {
  const pmAddr = ethers.getAddress(paymaster);
  const pmVerification = hexPadTo(ethers.toBeHex(pmVerificationGasLimit), 16);
  const pmPostOp = hexPadTo(ethers.toBeHex(pmPostOpGasLimit), 16);

  const vu = hexPadTo(ethers.toBeHex(validUntil), 6);
  const va = hexPadTo(ethers.toBeHex(validAfter), 6);

  const parts = [pmAddr, pmVerification, pmPostOp, vu, va];
  if (sponsorSignature) {
    parts.push(sponsorSignature);
  }

  // concat as bytes: 20 + 16 + 16 + 6 + 6 + [signature]
  return ethers.concat(parts);
}

/**
 * ✅ Correct sponsor signature for your SponsoredPaymaster.sol
 *
 * Contract does:
 *   sponsorHash = keccak256(abi.encode(userOpHash, validUntil(uint48), validAfter(uint48), chainid, paymaster))
 *   digest = toEthSignedMessageHash(sponsorHash)
 *   ECDSA.recover(digest, sponsorSig) == verifyingSigner
 *
 * Offchain we do:
 *   sponsorHash exactly the same abi.encode
 *   sponsor.signMessage(bytes32 sponsorHash)  // adds EIP-191 prefix => matches toEthSignedMessageHash
 */
async function makeSponsorSig(args: {
  provider: JsonRpcProvider;
  sponsor: Wallet;
  userOpHash: string;
  validUntil: number;
  validAfter: number;
  paymaster: string;
}): Promise<string> {
  const { provider, sponsor, userOpHash, validUntil, validAfter, paymaster } =
    args;

  const chainId = (await provider.getNetwork()).chainId;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const sponsorHash = ethers.keccak256(
    coder.encode(
      ['bytes32', 'uint48', 'uint48', 'uint256', 'address'],
      [
        userOpHash,
        validUntil, // uint48
        validAfter, // uint48
        chainId,
        ethers.getAddress(paymaster),
      ],
    ),
  );

  // IMPORTANT: signMessage(bytes32) => eth_sign style => matches toEthSignedMessageHash on-chain
  return sponsor.signMessage(ethers.getBytes(sponsorHash));
}

async function bundlerRpc<T = any>(
  url: string,
  method: string,
  params: any[],
  network?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (process.env.API_KEY) {
    headers['x-api-key'] = process.env.API_KEY;
  }

  // Add network as third parameter if provided
  const rpcParams = network ? [...params, network] : params;

  const body: any = { jsonrpc: '2.0', id: 1, method, params: rpcParams };

  console.log('Bundler request:');
  console.log(JSON.stringify(body, null, 2));

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();

  console.log('Bundler response:');
  console.log(JSON.stringify(json, null, 2));

  if (json.error)
    throw new Error(
      `${method} error: ${json.error.message || JSON.stringify(json.error)}`,
    );
  return json.result as T;
}

// -------------------- Main --------------------
async function main() {
  // Validate required environment variables
  // ACCOUNT is now optional - can be computed from FACTORY + SALT
  const requiredVars = [
    'RPC_URL',
    'BUNDLER_RPC_URL',
    'ENTRYPOINT',
    'OWNER_PRIVATE_KEY',
    'PAYMASTER',
    'SPONSOR_PRIVATE_KEY',
    'TOKEN',
    'TO',
    'AMOUNT',
  ];

  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}\n\n` +
        `Please set these in your .env file or environment. See script comments for details.`,
    );
  }

  // Either ACCOUNT or FACTORY must be provided
  if (!process.env.ACCOUNT && !process.env.FACTORY) {
    throw new Error(
      'Either ACCOUNT or FACTORY must be provided.\n' +
        'Set ACCOUNT for existing smart account, or FACTORY (+ optional SALT) to compute address.',
    );
  }

  console.log('\n=== Configuration ===');
  const RPC_URL = process.env.RPC_URL!;
  const BUNDLER_RPC_URL = process.env.BUNDLER_RPC_URL!;
  const ENTRYPOINT = ethers.getAddress(process.env.ENTRYPOINT!);
  const NETWORK = process.env.NETWORK;

  console.log('RPC_URL:', RPC_URL);
  console.log('BUNDLER_RPC_URL:', BUNDLER_RPC_URL);
  console.log('ENTRYPOINT:', ENTRYPOINT);
  console.log('NETWORK:', NETWORK || 'not set');

  const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY!;
  const SPONSOR_PRIVATE_KEY = process.env.SPONSOR_PRIVATE_KEY!;
  const PAYMASTER = ethers.getAddress(process.env.PAYMASTER!);

  console.log('PAYMASTER:', PAYMASTER);

  const provider: JsonRpcProvider = new ethers.JsonRpcProvider(RPC_URL);

  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);
  const sponsor = new ethers.Wallet(SPONSOR_PRIVATE_KEY, provider);

  const TOKEN = ethers.getAddress(process.env.TOKEN!);
  const TO = ethers.getAddress(process.env.TO!);
  const AMOUNT = BigInt(process.env.AMOUNT!);
  const ACTION = (process.env.ACTION || 'approve').toLowerCase();

  console.log('TOKEN:', TOKEN);
  console.log('TO:', TO);
  console.log('AMOUNT:', AMOUNT.toString());
  console.log('ACTION:', ACTION);

  const NONCE_KEY = BigInt(process.env.NONCE_KEY || '0');
  const VALIDITY_SECONDS = Number(process.env.VALIDITY_SECONDS || '300');
  const OWNER_SIG_MODE = (process.env.OWNER_SIG_MODE || 'message') as
    | 'message'
    | 'typedData';
  const SEND = process.env.SEND === '1';

  // Factory interface for getAddress and createAccount
  const factoryIface = new ethers.Interface([
    'function createAccount(address owner, uint256 salt) external returns (address)',
    'function getAddress(address owner, uint256 salt) external view returns (address)',
  ]);

  // Determine sender address
  let sender: string;
  const salt = BigInt(process.env.SALT || '0');

  if (process.env.FACTORY) {
    // Compute sender from factory.getAddress(owner, salt)
    const factory = ethers.getAddress(process.env.FACTORY);
    const getAddressData = factoryIface.encodeFunctionData('getAddress', [
      owner.address,
      salt,
    ]);

    const result = await provider.call({
      to: factory,
      data: getAddressData,
    });

    sender = ethers.getAddress(
      ethers.AbiCoder.defaultAbiCoder().decode(['address'], result)[0],
    );
    console.log('Computed sender from factory.getAddress:', sender);
    console.log('Factory:', factory);
    console.log('Owner:', owner.address);
    console.log('Salt:', salt.toString());
  } else {
    // Use explicit ACCOUNT address
    sender = ethers.getAddress(process.env.ACCOUNT!);
    console.log('Using explicit ACCOUNT as sender:', sender);
  }

  // Check if smart account is deployed
  const accountCode = await provider.getCode(sender);
  const isAccountDeployed = accountCode !== '0x';
  console.log('Smart Account deployed:', isAccountDeployed);

  let initCode = '0x';
  if (!isAccountDeployed) {
    // Account not deployed - need initCode
    if (process.env.FACTORY) {
      const factory = ethers.getAddress(process.env.FACTORY);

      // Auto-generate factory call data: createAccount(owner, salt)
      const factoryCallData = factoryIface.encodeFunctionData('createAccount', [
        owner.address,
        salt,
      ]);

      initCode = ethers.concat([factory, factoryCallData]);
      console.log(
        'Account not deployed - auto-generated initCode for deployment',
      );
      console.log('initCode length:', initCode.length);
    } else {
      throw new Error(
        'Smart Account is not deployed and no FACTORY provided.\n' +
          'Set FACTORY in .env (and optionally SALT, defaults to 0)',
      );
    }
  } else {
    console.log('Account already deployed - no initCode needed');
  }

  // Interfaces
  const entryPointIface = new ethers.Interface([
    'function getNonce(address sender, uint192 key) view returns (uint256)',
    'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  ]);

  const smartAccountIface = new ethers.Interface([
    'function execute(address dest,uint256 value,bytes func)',
  ]);

  const erc20Iface = new ethers.Interface([
    'function transfer(address to,uint256 amount) returns (bool)',
    'function approve(address spender,uint256 amount) returns (bool)',
  ]);

  // 1) callData for account.execute(dest, value, func)
  console.log('\n=== Step 1: Preparing callData ===');
  const tokenCall =
    ACTION === 'approve'
      ? erc20Iface.encodeFunctionData('approve', [TO, AMOUNT])
      : erc20Iface.encodeFunctionData('transfer', [TO, AMOUNT]);

  const callData = smartAccountIface.encodeFunctionData('execute', [
    TOKEN,
    0n,
    tokenCall,
  ]);
  console.log('callData length:', callData.length);

  // 2) nonce
  console.log('\n=== Step 2: Getting nonce ===');
  const nonce: bigint = (
    await provider.call({
      to: ENTRYPOINT,
      data: entryPointIface.encodeFunctionData('getNonce', [sender, NONCE_KEY]),
    })
  ).toString() as any;

  const nonceBig = BigInt(nonce);
  console.log('nonce:', nonceBig.toString());

  // 3) fee data
  console.log('\n=== Step 3: Getting fee data ===');
  const fee = await provider.getFeeData();
  if (!fee.maxFeePerGas || !fee.maxPriorityFeePerGas) {
    throw new Error('No EIP-1559 fee data. Check RPC or network.');
  }
  const maxFeePerGas = fee.maxFeePerGas;
  const maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
  console.log('maxFeePerGas:', maxFeePerGas.toString());
  console.log('maxPriorityFeePerGas:', maxPriorityFeePerGas.toString());

  // 4) Build a "draft" userOp for gas estimation (v0.6-like)
  console.log('\n=== Step 4: Building draft UserOp ===');

  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 5;
  const validUntil = now + VALIDITY_SECONDS;

  // Create a draft v0.7 packed userOp to compute userOpHash for sponsor signature
  const draftAccountGasLimits = packU128(1_500_000n, 1_000_000n);
  const draftGasFees = packU128(
    BigInt(maxPriorityFeePerGas),
    BigInt(maxFeePerGas),
  );
  const draftPaymasterAndData = buildPaymasterAndData(
    PAYMASTER,
    1_500_000n,
    0n,
    validUntil,
    validAfter,
  );

  const draftUserOpForHash: any = {
    sender,
    nonce: ethers.toBeHex(nonceBig),
    initCode,
    callData,
    accountGasLimits: draftAccountGasLimits,
    preVerificationGas: ethers.toBeHex(100_000n),
    gasFees: draftGasFees,
    paymasterAndData: draftPaymasterAndData,
    signature: '0x',
  };

  const draftUserOpHash: string = await provider.call({
    to: ENTRYPOINT,
    data: entryPointIface.encodeFunctionData('getUserOpHash', [
      draftUserOpForHash,
    ]),
  });

  // ✅ Correct draft sponsor signature per your paymaster
  const draftSponsorSig = await makeSponsorSig({
    provider,
    sponsor,
    userOpHash: draftUserOpHash,
    validUntil,
    validAfter,
    paymaster: PAYMASTER,
  });

  // Use dummy owner signature (will fail account validation but allows your bundler flow)
  // Combined signature: ownerSig (65 bytes) || sponsorSig (65 bytes)
  const dummyOwnerSig = '0x' + 'ff'.repeat(65);
  const draftSignature = ethers.concat([dummyOwnerSig, draftSponsorSig]);

  const draftUserOp: any = {
    sender,
    nonce: ethers.toBeHex(nonceBig),
    initCode,
    callData,
    accountGasLimits: draftAccountGasLimits,
    preVerificationGas: ethers.toBeHex(100_000n),
    gasFees: draftGasFees,
    paymasterAndData: draftPaymasterAndData,
    signature: draftSignature,
  };
  console.log(
    'Draft UserOp created (v0.7 packed format) with correct sponsor signature and dummy owner signature',
  );

  // 5) Ask bundler to estimate gas
  console.log('\n=== Step 5: Estimating gas ===');
  const gasEst = await bundlerRpc<any>(
    BUNDLER_RPC_URL,
    'eth_estimateUserOperationGas',
    [draftUserOp, ENTRYPOINT],
    NETWORK,
  );

  const callGasLimit = BigInt(gasEst.callGasLimit);
  // Ensure verificationGasLimit is at least 1,500,000
  const verificationGasLimitRaw = BigInt(gasEst.verificationGasLimit);
  const verificationGasLimit =
    verificationGasLimitRaw < 1_500_000n ? 1_500_000n : verificationGasLimitRaw;
  const preVerificationGas = BigInt(gasEst.preVerificationGas);

  console.log('callGasLimit:', callGasLimit.toString());
  console.log(
    'verificationGasLimit:',
    verificationGasLimit.toString(),
    verificationGasLimitRaw < 1_500_000n
      ? '(bumped from ' + verificationGasLimitRaw.toString() + ')'
      : '',
  );
  console.log('preVerificationGas:', preVerificationGas.toString());

  const pmVerificationGasLimit = BigInt(
    gasEst.paymasterVerificationGasLimit ?? 1_500_000n,
  );
  const pmPostOpGasLimit = BigInt(gasEst.paymasterPostOpGasLimit ?? 0n);

  console.log('pmVerificationGasLimit:', pmVerificationGasLimit.toString());
  console.log('pmPostOpGasLimit:', pmPostOpGasLimit.toString());

  // 6) validity window
  console.log('\n=== Step 6: Validity window ===');
  console.log('validAfter:', validAfter);
  console.log('validUntil:', validUntil);
  console.log('validity window (seconds):', VALIDITY_SECONDS);

  // 7) Note: Using v0.7 packed format with paymasterAndData
  console.log('\n=== Step 7: Paymaster configured ===');
  console.log('Using v0.7 packed paymasterAndData format');

  // 8) Compute real userOpHash using EntryPoint v0.7 packed struct
  console.log('\n=== Step 8: Computing userOpHash ===');

  const accountGasLimits = packU128(
    BigInt(verificationGasLimit),
    BigInt(callGasLimit),
  );
  const gasFees = packU128(BigInt(maxPriorityFeePerGas), BigInt(maxFeePerGas));
  const paymasterAndData = buildPaymasterAndData(
    PAYMASTER,
    BigInt(pmVerificationGasLimit),
    BigInt(pmPostOpGasLimit),
    validUntil,
    validAfter,
  );

  const userOpForHash: any = {
    sender,
    nonce: ethers.toBeHex(nonceBig),
    initCode,
    callData,
    accountGasLimits,
    preVerificationGas: ethers.toBeHex(preVerificationGas),
    gasFees,
    paymasterAndData,
    signature: '0x',
  };

  const userOpHash: string = await provider.call({
    to: ENTRYPOINT,
    data: entryPointIface.encodeFunctionData('getUserOpHash', [userOpForHash]),
  });
  console.log('userOpHash:', userOpHash);

  // 9) ✅ Correct sponsor signature per your paymaster
  console.log('\n=== Step 9: Creating sponsor signature ===');
  const sponsorSig = await makeSponsorSig({
    provider,
    sponsor,
    userOpHash,
    validUntil,
    validAfter,
    paymaster: PAYMASTER,
  });
  console.log('sponsorSig:', sponsorSig);

  // 10) Owner signature
  // SponsoredAccount._validateSignature uses ECDSA.tryRecover(userOpHash, sig) - RAW hash without prefix
  // So we need to sign the raw hash, not use signMessage which adds EIP-191 prefix
  console.log('\n=== Step 10: Creating owner signature ===');
  let ownerSig: string;

  if (OWNER_SIG_MODE === 'typedData') {
    const chainId = (await provider.getNetwork()).chainId;
    const domain = {
      name: 'ERC4337',
      version: '0.7',
      chainId,
      verifyingContract: ENTRYPOINT,
    };
    const types = {
      UserOpHash: [{ name: 'userOpHash', type: 'bytes32' }],
    };
    ownerSig = await owner.signTypedData(domain as any, types as any, {
      userOpHash,
    });
  } else {
    // Sign raw hash (no EIP-191 prefix) - this is what SponsoredAccount expects
    const signingKey = new ethers.SigningKey(owner.privateKey);
    const sig = signingKey.sign(userOpHash);
    ownerSig = ethers.Signature.from(sig).serialized;
  }
  console.log('ownerSig:', ownerSig);

  // 11) Combined signature = ownerSig (65 bytes) || sponsorSig (65 bytes)
  // SponsoredPaymaster expects sponsor signature at userOp.signature[65:]
  console.log('\n=== Step 11: Combining signatures ===');
  const signature = ethers.concat([ownerSig, sponsorSig]);
  console.log('combined signature length:', signature.length);

  // 12) final userOp payload for eth_sendUserOperation (v0.7 packed format)
  console.log('\n=== Step 12: Building final UserOp ===');
  const finalUserOp = {
    sender,
    nonce: ethers.toBeHex(nonceBig),
    initCode,
    callData,
    accountGasLimits,
    preVerificationGas: ethers.toBeHex(preVerificationGas),
    gasFees,
    paymasterAndData,
    signature,
  };

  const rpcParams: any[] = [finalUserOp, ENTRYPOINT];
  if (NETWORK) {
    rpcParams.push(NETWORK);
  }

  const rpcBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendUserOperation',
    params: rpcParams,
  };

  console.log('\n=== eth_sendUserOperation body ===');
  console.log(JSON.stringify(rpcBody, null, 2));

  if (SEND) {
    console.log('\n=== Sending UserOperation ===');
    const res = await bundlerRpc<string>(
      BUNDLER_RPC_URL,
      'eth_sendUserOperation',
      [finalUserOp, ENTRYPOINT],
      NETWORK,
    );
    console.log('✓ Bundler returned userOpHash:', res);
  } else {
    console.log('\n=== Dry run mode (SEND not set to 1) ===');
    console.log('To actually send, set SEND=1 in your .env file');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
