// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "@account-abstraction/contracts/core/BasePaymaster.sol";
import "@account-abstraction/contracts/core/Helpers.sol";

/**
 * Sponsored (gasless) paymaster:
 * - Any UserOperation is sponsored if it contains a valid sponsor signature in paymaster data.
 * - Sponsor signs a digest derived from the UserOperation hash + validity window.
 * - Paymaster returns empty context, so EntryPoint skips postOp.
 *
 * paymasterAndData layout (PackedUserOperation v0.7):
 *   [ paymaster (20) | pmVerificationGasLimit (16) | pmPostOpGasLimit (16) | data... ]
 *   data: [ validUntil (6) | validAfter (6) ]
 *
 * Sponsor signature is appended to `userOp.signature` AFTER the owner's 65-byte signature:
 *   userOp.signature = ownerSig (65) || sponsorSig (65+)
 */
contract SponsoredPaymaster is BasePaymaster {
    using MessageHashUtils for bytes32;

    address public verifyingSigner;

    event VerifyingSignerUpdated(address indexed signer);

    constructor(IEntryPoint anEntryPoint, address initialSigner) BasePaymaster(anEntryPoint) {
        verifyingSigner = initialSigner;
        emit VerifyingSignerUpdated(initialSigner);
    }

    function setVerifyingSigner(address signer) external onlyOwner {
        verifyingSigner = signer;
        emit VerifyingSignerUpdated(signer);
    }

    function getSponsorHash(
        bytes32 userOpHash,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        // include chainId + paymaster to prevent cross-chain / cross-paymaster replay
        return keccak256(abi.encode(userOpHash, validUntil, validAfter, block.chainid, address(this)));
    }

    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 /*maxCost*/
    ) internal override returns (bytes memory context, uint256 validationData) {
        bytes calldata paymasterAndData = userOp.paymasterAndData;

        // require at least: static fields (52) + (validUntil+validAfter) 12
        if (paymasterAndData.length < PAYMASTER_DATA_OFFSET + 12) {
            return ("", SIG_VALIDATION_FAILED);
        }

        // require sponsor signature appended to userOp.signature
        if (userOp.signature.length < 65 + 65) {
            return ("", SIG_VALIDATION_FAILED);
        }

        bytes calldata data = paymasterAndData[PAYMASTER_DATA_OFFSET:];
        uint48 validUntil = uint48(bytes6(data[0:6]));
        uint48 validAfter = uint48(bytes6(data[6:12]));

        bytes memory sponsorSig = userOp.signature[65:];

        bytes32 digest = getSponsorHash(userOpHash, validUntil, validAfter).toEthSignedMessageHash();
        bool sigFailed = ECDSA.recover(digest, sponsorSig) != verifyingSigner;

        validationData = _packValidationData(sigFailed, validUntil, validAfter);
        context = "";
    }
}
