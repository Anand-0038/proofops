// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IncidentOracle
 * @notice Sepolia mock oracle / health surface for the incident-response keeper.
 *         KeeperHub executes allowlisted writes (setHeartbeat, pause, setMaxDeviationBps).
 */
contract IncidentOracle {
    address public owner;
    uint256 public heartbeat;
    uint256 public lastUpdated;
    uint256 public price;
    uint256 public maxDeviationBps;
    uint256 public healthFactorBps;
    bool public paused;

    error NotOwner();
    error IsPaused();
    error InvalidParam();

    event HeartbeatUpdated(uint256 heartbeat, uint256 timestamp);
    event Paused(address by);
    event Unpaused(address by);
    event MaxDeviationUpdated(uint256 bps);
    event HealthFactorUpdated(uint256 bps);
    event PriceUpdated(uint256 price);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    constructor(uint256 _heartbeat, uint256 _price, uint256 _maxDeviationBps, uint256 _healthFactorBps) {
        owner = msg.sender;
        heartbeat = _heartbeat;
        price = _price;
        maxDeviationBps = _maxDeviationBps;
        healthFactorBps = _healthFactorBps;
        lastUpdated = block.timestamp;
    }

    function setHeartbeat(uint256 _heartbeat) external onlyOwner whenNotPaused {
        if (_heartbeat == 0) revert InvalidParam();
        heartbeat = _heartbeat;
        lastUpdated = block.timestamp;
        emit HeartbeatUpdated(_heartbeat, block.timestamp);
    }

    function setPrice(uint256 _price) external onlyOwner whenNotPaused {
        price = _price;
        lastUpdated = block.timestamp;
        emit PriceUpdated(_price);
    }

    function setMaxDeviationBps(uint256 bps) external onlyOwner whenNotPaused {
        if (bps > 10_000) revert InvalidParam();
        maxDeviationBps = bps;
        emit MaxDeviationUpdated(bps);
    }

    function setHealthFactorBps(uint256 bps) external onlyOwner {
        healthFactorBps = bps;
        emit HealthFactorUpdated(bps);
    }

    /// @dev Test helper: rewind lastUpdated to simulate staleness (owner only).
    function warpLastUpdated(uint256 ts) external onlyOwner {
        lastUpdated = ts;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidParam();
        owner = newOwner;
    }
}
