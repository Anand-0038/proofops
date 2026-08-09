// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ActionLog} from "../src/ActionLog.sol";

contract ActionLogTest is Test {
    ActionLog internal actionLog;

    function setUp() public {
        actionLog = new ActionLog();
    }

    function test_record_and_query() public {
        bytes32 incident = keccak256("inc-1");
        bytes32 artifact = keccak256("artifact-bytes");
        uint256 idx = actionLog.recordAction(incident, artifact, "ipfs://demo");
        assertEq(idx, 0);
        assertEq(actionLog.actionCount(), 1);

        (
            bytes32 incidentId,
            bytes32 artifactHash,
            string memory uri,
            address actor,
            uint64 recordedAt
        ) = actionLog.actions(0);
        assertEq(incidentId, incident);
        assertEq(artifactHash, artifact);
        assertEq(uri, "ipfs://demo");
        assertEq(actor, address(this));
        assertGt(recordedAt, 0);

        uint256[] memory ids = actionLog.actionsForIncident(incident);
        assertEq(ids.length, 1);
        assertEq(ids[0], 0);
    }

    function test_revert_empty() public {
        vm.expectRevert(ActionLog.EmptyIncident.selector);
        actionLog.recordAction(bytes32(0), keccak256("x"), "u");
        vm.expectRevert(ActionLog.EmptyHash.selector);
        actionLog.recordAction(keccak256("i"), bytes32(0), "u");
        vm.expectRevert(ActionLog.EmptyUri.selector);
        actionLog.recordAction(keccak256("i"), keccak256("x"), "");
    }

    function test_revert_duplicate_attestation_but_allow_new_proof() public {
        bytes32 incident = keccak256("inc-1");
        bytes32 artifact = keccak256("artifact-v1");
        actionLog.recordAction(incident, artifact, "ipfs://v1");

        vm.expectRevert(
            abi.encodeWithSelector(
                ActionLog.DuplicateAction.selector,
                incident,
                artifact
            )
        );
        actionLog.recordAction(incident, artifact, "ipfs://duplicate");

        uint256 next = actionLog.recordAction(
            incident,
            keccak256("artifact-v2"),
            "ipfs://v2"
        );
        assertEq(next, 1);
    }
}
