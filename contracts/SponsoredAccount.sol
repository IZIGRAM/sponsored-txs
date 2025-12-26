// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // чтобы вызвать Ownable(initialOwner)
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/core/Helpers.sol"; // SIG_VALIDATION_*
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

contract SponsoredAccount is BaseAccount, Ownable2Step {
    using ECDSA for bytes32;

    IEntryPoint private immutable _entryPoint =
        IEntryPoint(0x0000000071727De22E5E9d8BAf0edAc6f37da032);

    // Ownable2Step наследуется от Ownable, поэтому вызываем конструктор Ownable
    constructor(address initialOwner) Ownable(initialOwner) {}

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    receive() external payable {}

   function _validateSignature(
    PackedUserOperation calldata userOp,
    bytes32 userOpHash
) internal override returns (uint256) {
    if (userOp.signature.length < 65) {
        return SIG_VALIDATION_FAILED;
    }

    bytes memory sig = new bytes(65);
    for (uint256 i = 0; i < 65; i++) {
        sig[i] = userOp.signature[i];
    }

    (address recovered, ECDSA.RecoverError err, ) =
        ECDSA.tryRecover(userOpHash, sig);

    if (err != ECDSA.RecoverError.NoError || recovered != owner()) {
        return SIG_VALIDATION_FAILED;
    }

    return SIG_VALIDATION_SUCCESS;
}

}
