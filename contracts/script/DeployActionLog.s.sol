// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ActionLog} from "../src/ActionLog.sol";

/// @notice Deploy the proof attestation contract with a one-time deployer.
/// ProofOps never uses this key for judged execution or attestation writes.
contract DeployActionLog is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        ActionLog actionLog = new ActionLog();
        console2.log("ActionLog deployed:", address(actionLog));
        vm.stopBroadcast();
    }
}
