// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IncidentOracle} from "../src/IncidentOracle.sol";

contract IncidentOracleTest is Test {
    IncidentOracle internal oracle;
    address internal owner = address(this);
    address internal stranger = address(0xBEEF);

    function setUp() public {
        oracle = new IncidentOracle(3600, 2000e8, 100, 15000);
    }

    function test_initialState() public view {
        assertEq(oracle.heartbeat(), 3600);
        assertEq(oracle.maxDeviationBps(), 100);
        assertEq(oracle.healthFactorBps(), 15000);
        assertFalse(oracle.paused());
        assertEq(oracle.owner(), owner);
    }

    function test_setHeartbeat_updatesTimestamp() public {
        uint256 beforeTs = oracle.lastUpdated();
        vm.warp(block.timestamp + 10);
        oracle.setHeartbeat(1800);
        assertEq(oracle.heartbeat(), 1800);
        assertGt(oracle.lastUpdated(), beforeTs);
    }

    function test_pause_and_blockWrites() public {
        oracle.pause();
        assertTrue(oracle.paused());
        vm.expectRevert(IncidentOracle.IsPaused.selector);
        oracle.setHeartbeat(900);
    }

    function test_unpause() public {
        oracle.pause();
        oracle.unpause();
        oracle.setHeartbeat(900);
        assertEq(oracle.heartbeat(), 900);
    }

    function test_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(IncidentOracle.NotOwner.selector);
        oracle.pause();
    }

    function test_transferOwnership_toKeeperWallet() public {
        address keeper = address(0x333);
        oracle.transferOwnership(keeper);
        assertEq(oracle.owner(), keeper);
        vm.prank(keeper);
        oracle.pause();
        assertTrue(oracle.paused());
    }

    function test_warpLastUpdated_simulatesStaleness() public {
        oracle.warpLastUpdated(1);
        assertEq(oracle.lastUpdated(), 1);
    }

    function test_setMaxDeviationBps() public {
        oracle.setMaxDeviationBps(50);
        assertEq(oracle.maxDeviationBps(), 50);
        vm.expectRevert(IncidentOracle.InvalidParam.selector);
        oracle.setMaxDeviationBps(10_001);
    }
}
