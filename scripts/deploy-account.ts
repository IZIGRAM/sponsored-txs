import { ethers } from 'hardhat';

/**
 * Deploy a SponsoredAccount via the factory.
 *
 * Required env vars:
 *   RPC_URL - RPC endpoint
 *   FACTORY - SponsoredAccountFactory address
 *   OWNER_PRIVATE_KEY - Owner's private key
 *   SALT - (optional) Salt for CREATE2, defaults to 0
 */
async function main() {
  const RPC_URL = process.env.RPC_URL;
  const FACTORY = process.env.FACTORY;
  const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;
  const SALT = BigInt(process.env.SALT || '0');

  if (!RPC_URL || !FACTORY || !OWNER_PRIVATE_KEY) {
    throw new Error(
      'Missing required env vars: RPC_URL, FACTORY, OWNER_PRIVATE_KEY',
    );
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

  console.log('=== Deploy SponsoredAccount ===');
  console.log('Factory:', FACTORY);
  console.log('Owner:', owner.address);
  console.log('Salt:', SALT.toString());

  const factoryIface = new ethers.Interface([
    'function createAccount(address owner, uint256 salt) external returns (address)',
    'function getAddress(address owner, uint256 salt) external view returns (address)',
  ]);

  // Get predicted address
  const getAddressData = factoryIface.encodeFunctionData('getAddress', [
    owner.address,
    SALT,
  ]);
  const predictedResult = await provider.call({
    to: FACTORY,
    data: getAddressData,
  });
  const predictedAddress = ethers.AbiCoder.defaultAbiCoder().decode(
    ['address'],
    predictedResult,
  )[0];
  console.log('Predicted address:', predictedAddress);

  // Check if already deployed
  const code = await provider.getCode(predictedAddress);
  if (code !== '0x') {
    console.log('✓ Account already deployed at:', predictedAddress);
    return;
  }

  console.log('Account not deployed, deploying...');

  // Create deployment transaction
  const createAccountData = factoryIface.encodeFunctionData('createAccount', [
    owner.address,
    SALT,
  ]);

  const tx = await owner.sendTransaction({
    to: FACTORY,
    data: createAccountData,
  });

  console.log('Transaction sent:', tx.hash);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait();
  console.log('✓ Account deployed!');
  console.log('Transaction hash:', receipt?.hash);
  console.log('Block:', receipt?.blockNumber);
  console.log('Gas used:', receipt?.gasUsed?.toString());

  // Verify deployment
  const codeAfter = await provider.getCode(predictedAddress);
  if (codeAfter !== '0x') {
    console.log('✓ Verified: Account is deployed at:', predictedAddress);
  } else {
    console.log('✗ Error: Account code not found after deployment');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
