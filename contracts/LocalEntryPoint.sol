// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@account-abstraction/contracts/core/EntryPoint.sol";

// Local wrapper to make Hardhat emit an artifact for EntryPoint via inheritance.
contract LocalEntryPoint is EntryPoint {}
