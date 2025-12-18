// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/core/Helpers.sol";

/**
 * Minimal ERC-4337 smart account for EntryPoint v0.7 (PackedUserOperation).
 *
 * - Owner can execute directly, or via EntryPoint during UserOp execution.
 * - Signature check expects EIP-712 signature over `userOpHash` (same behavior as SimpleAccount).
 */
contract SponsoredAccount is BaseAccount, Ownable2Step {
    using ECDSA for bytes32;

    IEntryPoint private immutable _entryPoint;

    constructor(IEntryPoint anEntryPoint, address initialOwner) Ownable(initialOwner) {
        _entryPoint = anEntryPoint;
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    receive() external payable {}

    function _requireForExecute() internal view override {
        require(
            msg.sender == address(entryPoint()) || msg.sender == owner(),
            "account: not Owner or EntryPoint"
        );
    }

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal override returns (uint256 validationData) {
        if (owner() != ECDSA.recover(userOpHash, userOp.signature)) {
            return SIG_VALIDATION_FAILED;
        }
        return SIG_VALIDATION_SUCCESS;
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    function addDeposit() external payable {
        entryPoint().depositTo{value: msg.value}(address(this));
    }

    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) external onlyOwner {
        entryPoint().withdrawTo(withdrawAddress, amount);
    }
}
