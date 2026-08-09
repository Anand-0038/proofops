// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ActionLog
 * @notice On-chain attestations of keeper/runbook actions for incident response.
 *         Stores incidentId + artifactHash + uri — no SIEM, no fake multi-keeper network.
 */
contract ActionLog {
    struct Action {
        bytes32 incidentId;
        bytes32 artifactHash;
        string uri;
        address actor;
        uint64 recordedAt;
    }

    Action[] public actions;
    mapping(bytes32 => uint256[]) private _byIncident;
    mapping(bytes32 => bool) public attestationExists;

    event ActionRecorded(
        uint256 indexed actionIndex,
        bytes32 indexed incidentId,
        bytes32 artifactHash,
        address indexed actor,
        string uri
    );

    error EmptyIncident();
    error EmptyHash();
    error EmptyUri();
    error DuplicateAction(bytes32 incidentId, bytes32 artifactHash);

    function recordAction(bytes32 incidentId, bytes32 artifactHash, string calldata uri)
        external
        returns (uint256 index)
    {
        if (incidentId == bytes32(0)) revert EmptyIncident();
        if (artifactHash == bytes32(0)) revert EmptyHash();
        if (bytes(uri).length == 0) revert EmptyUri();

        bytes32 attestationKey = keccak256(
            abi.encode(incidentId, artifactHash)
        );
        if (attestationExists[attestationKey]) {
            revert DuplicateAction(incidentId, artifactHash);
        }
        attestationExists[attestationKey] = true;

        index = actions.length;
        actions.push(
            Action({
                incidentId: incidentId,
                artifactHash: artifactHash,
                uri: uri,
                actor: msg.sender,
                recordedAt: uint64(block.timestamp)
            })
        );
        _byIncident[incidentId].push(index);
        emit ActionRecorded(index, incidentId, artifactHash, msg.sender, uri);
    }

    function actionCount() external view returns (uint256) {
        return actions.length;
    }

    function actionsForIncident(bytes32 incidentId) external view returns (uint256[] memory) {
        return _byIncident[incidentId];
    }
}
