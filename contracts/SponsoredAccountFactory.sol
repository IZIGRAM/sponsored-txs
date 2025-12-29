// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

import "./SponsoredAccount.sol";

/**
 * Deterministic Create2 factory for SponsoredAccount.
 */
contract SponsoredAccountFactory {
    IEntryPoint public immutable entryPoint;

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(IEntryPoint anEntryPoint) {
        entryPoint = anEntryPoint;
    }

    function createAccount(address owner, uint256 salt) external returns (SponsoredAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length > 0) {
            return SponsoredAccount(payable(predicted));
        }

        account = new SponsoredAccount{salt: bytes32(salt)}(owner);
        emit AccountCreated(address(account), owner, salt);
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes memory initCode = abi.encodePacked(
            type(SponsoredAccount).creationCode,
            abi.encode(entryPoint, owner)
        );

        bytes32 initCodeHash = keccak256(initCode);
        bytes32 addrHash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), initCodeHash)
        );

        return address(uint160(uint256(addrHash)));
    }
}
