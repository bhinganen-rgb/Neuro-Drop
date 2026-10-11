// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title NeuroDrop - On-chain dead-man's switch
/// @notice Users escrow BOT + a message. If they fail to check in before the
///         deadline, anyone can trigger release to the beneficiary.
/// @dev    Messages are stored in plaintext on-chain. This is a legacy/anti-loss
///         tool, NOT a secrecy tool. Do not use it to store secrets.
contract NeuroDrop is Ownable, ReentrancyGuard, Pausable {
    enum Status { Armed, Released, Disarmed }

    struct Drop {
        address owner;
        address beneficiary;
        uint256 amount;
        string message;
        uint256 armedAt;
        uint256 lastCheckIn;
        uint256 intervalSecs;
        Status status;
    }

    uint256 public constant MIN_INTERVAL = 1 hours;
    uint256 public constant MAX_INTERVAL = 365 days;
    uint256 public constant MAX_MESSAGE_LEN = 512;
    uint256 public constant MAX_FEE_BPS = 500; // 5%

    uint256 public platformFeeBps = 50; // 0.5%
    uint256 public accruedFees;

    Drop[] private _drops;
    mapping(address => uint256[]) private _byOwner;
    mapping(address => uint256[]) private _byBeneficiary;

    event DropArmed(uint256 indexed dropId, address indexed owner, address indexed beneficiary, uint256 amount, uint256 intervalSecs);
    event CheckedIn(uint256 indexed dropId, address indexed owner, uint256 timestamp);
    event Disarmed(uint256 indexed dropId, address indexed owner, uint256 refund);
    event Released(uint256 indexed dropId, address indexed beneficiary, uint256 payout, uint256 fee, address triggeredBy);
    event PlatformFeeUpdated(uint256 oldBps, uint256 newBps);
    event FeesWithdrawn(address to, uint256 amount);

    constructor() Ownable(msg.sender) {}

    // ---------------- User actions ----------------

    function arm(address beneficiary, string calldata message, uint256 intervalSecs)
        external
        payable
        whenNotPaused
        returns (uint256 dropId)
    {
        require(msg.value > 0, "amount required");
        require(beneficiary != address(0), "bad beneficiary");
        require(beneficiary != msg.sender, "self beneficiary");
        require(intervalSecs >= MIN_INTERVAL && intervalSecs <= MAX_INTERVAL, "bad interval");
        require(bytes(message).length <= MAX_MESSAGE_LEN, "message too long");

        dropId = _drops.length;
        _drops.push(Drop({
            owner: msg.sender,
            beneficiary: beneficiary,
            amount: msg.value,
            message: message,
            armedAt: block.timestamp,
            lastCheckIn: block.timestamp,
            intervalSecs: intervalSecs,
            status: Status.Armed
        }));
        _byOwner[msg.sender].push(dropId);
        _byBeneficiary[beneficiary].push(dropId);

        emit DropArmed(dropId, msg.sender, beneficiary, msg.value, intervalSecs);
    }

    function checkIn(uint256 dropId) external whenNotPaused {
        Drop storage d = _drops[dropId];
        require(d.owner == msg.sender, "not owner");
        require(d.status == Status.Armed, "not armed");
        require(block.timestamp <= d.lastCheckIn + d.intervalSecs, "expired");
        d.lastCheckIn = block.timestamp;
        emit CheckedIn(dropId, msg.sender, block.timestamp);
    }

    function disarm(uint256 dropId) external nonReentrant {
        Drop storage d = _drops[dropId];
        require(d.owner == msg.sender, "not owner");
        require(d.status == Status.Armed, "not armed");
        uint256 refund = d.amount;
        d.status = Status.Disarmed;
        d.amount = 0;
        (bool ok, ) = msg.sender.call{value: refund}("");
        require(ok, "refund failed");
        emit Disarmed(dropId, msg.sender, refund);
    }

    function release(uint256 dropId) external nonReentrant {
        Drop storage d = _drops[dropId];
        require(d.status == Status.Armed, "not armed");
        require(block.timestamp > d.lastCheckIn + d.intervalSecs, "not expired");

        uint256 total = d.amount;
        uint256 fee = (total * platformFeeBps) / 10_000;
        uint256 payout = total - fee;

        d.status = Status.Released;
        d.amount = 0;
        accruedFees += fee;

        (bool ok, ) = d.beneficiary.call{value: payout}("");
        require(ok, "payout failed");

        emit Released(dropId, d.beneficiary, payout, fee, msg.sender);
    }

    // ---------------- Views ----------------

    function getDrop(uint256 dropId)
        external
        view
        returns (
            address owner_,
            address beneficiary,
            uint256 amount,
            string memory message,
            uint256 armedAt,
            uint256 lastCheckIn,
            uint256 intervalSecs,
            uint8 status
        )
    {
        Drop storage d = _drops[dropId];
        return (d.owner, d.beneficiary, d.amount, d.message, d.armedAt, d.lastCheckIn, d.intervalSecs, uint8(d.status));
    }

    function getDeadline(uint256 dropId) external view returns (uint256) {
        Drop storage d = _drops[dropId];
        return d.lastCheckIn + d.intervalSecs;
    }

    function isExpired(uint256 dropId) external view returns (bool) {
        Drop storage d = _drops[dropId];
        if (d.status != Status.Armed) return false;
        return block.timestamp > d.lastCheckIn + d.intervalSecs;
    }

    function getDropsByOwner(address who) external view returns (uint256[] memory) {
        return _byOwner[who];
    }

    function getDropsForBeneficiary(address who) external view returns (uint256[] memory) {
        return _byBeneficiary[who];
    }

    function dropCount() external view returns (uint256) {
        return _drops.length;
    }

    // ---------------- Admin ----------------

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function setPlatformFeeBps(uint256 newBps) external onlyOwner {
        require(newBps <= MAX_FEE_BPS, "fee too high");
        uint256 old = platformFeeBps;
        platformFeeBps = newBps;
        emit PlatformFeeUpdated(old, newBps);
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "bad to");
        uint256 amt = accruedFees;
        accruedFees = 0;
        (bool ok, ) = to.call{value: amt}("");
        require(ok, "withdraw failed");
        emit FeesWithdrawn(to, amt);
    }
}
