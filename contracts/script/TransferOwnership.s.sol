// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IncidentOracle} from "../src/IncidentOracle.sol";

/// @notice Transfer IncidentOracle ownership to KeeperHub org Turnkey wallet.
contract TransferOwnership is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address oracleAddr = vm.envAddress("TARGET_CONTRACT_ADDRESS");
        address newOwner = vm.envAddress("KEEPERHUB_WALLET");
        vm.startBroadcast(pk);
        IncidentOracle(oracleAddr).transferOwnership(newOwner);
        console2.log("Ownership transferred to", newOwner);
        vm.stopBroadcast();
    }
}
