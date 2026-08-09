// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IncidentOracle} from "../src/IncidentOracle.sol";

contract DeployIncidentOracle is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        IncidentOracle oracle = new IncidentOracle(
            3600,           // heartbeat 1h
            2000e8,         // price
            100,            // maxDeviationBps 1%
            10500           // healthFactorBps 1.05 — demo breach-ish
        );
        console2.log("IncidentOracle deployed:", address(oracle));
        vm.stopBroadcast();
    }
}
