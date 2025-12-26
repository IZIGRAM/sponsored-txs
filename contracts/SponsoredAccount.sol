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

function execute(
    address dest,
    uint256 value,
    bytes calldata func
) external {
    _requireFromEntryPointOrOwner();

    (bool success, bytes memory result) =
        dest.call{value: value}(func);

    require(success, "execute failed");
}

function executeBatch(
    address[] calldata dest,
    uint256[] calldata value,
    bytes[] calldata func
) external {
    _requireFromEntryPointOrOwner();

    require(
        dest.length == value.length && dest.length == func.length,
        "length mismatch"
    );

    for (uint256 i = 0; i < dest.length; i++) {
        (bool success, ) =
            dest[i].call{value: value[i]}(func[i]);
        require(success, "executeBatch failed");
    }
}

function _requireFromEntryPointOrOwner() internal view {
    require(
        msg.sender == address(entryPoint()) || msg.sender == owner(),
        "not authorized"
    );
}


}
