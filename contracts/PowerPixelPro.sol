// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  PowerPixelPro — Paid pre-publish image-IP scan + attestation registry
/// @notice Two-step revenue model: users pay a small fee to run a scan, and a
///         second fee to attest the result on-chain. Fees accrue in the
///         contract and can be withdrawn by the owner.
/// @dev    Standalone from the DoNotTrain academic prototype contract. No shared
///         state, no shared events, no shared ABIs. Deployed at its own address.
contract PowerPixelPro {
    /// @notice Fixed fee to run a scan (lookup). Frontend calls payForLookup()
    ///         with this value before invoking /api/classify.
    uint256 public constant LOOKUP_FEE = 0.0001 ether;

    /// @notice Fixed fee to write an attestation on-chain. Required as
    ///         msg.value on registerScan(). Gas is paid separately.
    uint256 public constant ATTESTATION_FEE = 0.0001 ether;

    /// @notice The address that deployed the contract. Sole party allowed to
    ///         withdraw accrued fees.
    address public immutable owner;

    struct ScanAttestation {
        address attestor;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 imageHash;
        string  verdictReason;
        bool    aiDetected;
        bool    brandDetected;
        bool    watermarkDetected;
        bool    exists;
    }

    /// @dev imageHash → most recent attestation. Re-scans by anyone overwrite.
    mapping(bytes32 => ScanAttestation) private attestations;

    /// @dev Every imageHash ever attested, in insertion order.
    bytes32[] public allImageHashes;

    /// @notice Emitted when a user pays for a scan. Frontend can listen for
    ///         this event (or just wait for the tx receipt) before running
    ///         /api/classify, so the API only runs for paying users.
    event LookupPaid(
        address indexed payer,
        uint256 amount,
        uint256 timestamp
    );

    event ScanAttested(
        bytes32 indexed imageHash,
        address indexed attestor,
        bool    aiDetected,
        bool    brandDetected,
        bool    watermarkDetected,
        string  verdictReason,
        uint256 timestamp,
        uint256 blockNumber
    );

    event FeesWithdrawn(address indexed to, uint256 amount);

    error InsufficientLookupFee();
    error InsufficientAttestationFee();
    error NotOwner();
    error NotAttested();
    error WithdrawalFailed();
    error NoFeesToWithdraw();

    constructor() {
        owner = msg.sender;
    }

    /// @notice Pay the lookup fee. Frontend gates the /api/classify call on
    ///         this transaction confirming.
    /// @dev    The image hash is NOT stored on-chain here — the chain only
    ///         records "someone paid for a scan." That keeps gas cheap and
    ///         doesn't bloat storage with hashes for scans that get blocked.
    function payForLookup() external payable {
        if (msg.value < LOOKUP_FEE) revert InsufficientLookupFee();
        emit LookupPaid(msg.sender, msg.value, block.timestamp);
    }

    /// @notice Write a scan verdict on-chain. Requires the attestation fee
    ///         as msg.value.
    function registerScan(
        bytes32 imageHash,
        string  calldata verdictReason,
        bool    aiDetected,
        bool    brandDetected,
        bool    watermarkDetected
    ) external payable {
        if (msg.value < ATTESTATION_FEE) revert InsufficientAttestationFee();

        bool firstTime = !attestations[imageHash].exists;

        attestations[imageHash] = ScanAttestation({
            attestor: msg.sender,
            timestamp: block.timestamp,
            blockNumber: block.number,
            imageHash: imageHash,
            verdictReason: verdictReason,
            aiDetected: aiDetected,
            brandDetected: brandDetected,
            watermarkDetected: watermarkDetected,
            exists: true
        });

        if (firstTime) {
            allImageHashes.push(imageHash);
        }

        emit ScanAttested(
            imageHash,
            msg.sender,
            aiDetected,
            brandDetected,
            watermarkDetected,
            verdictReason,
            block.timestamp,
            block.number
        );
    }

    /// @notice Cheap existence check.
    function isAttested(bytes32 imageHash) external view returns (bool) {
        return attestations[imageHash].exists;
    }

    /// @notice Returns the full attestation record. Reverts if not attested.
    function getAttestation(bytes32 imageHash)
        external
        view
        returns (
            address attestor,
            uint256 timestamp,
            uint256 blockNumber,
            string  memory verdictReason,
            bool    aiDetected,
            bool    brandDetected,
            bool    watermarkDetected
        )
    {
        ScanAttestation memory a = attestations[imageHash];
        if (!a.exists) revert NotAttested();
        return (
            a.attestor,
            a.timestamp,
            a.blockNumber,
            a.verdictReason,
            a.aiDetected,
            a.brandDetected,
            a.watermarkDetected
        );
    }

    /// @notice Total unique images ever attested.
    function totalAttestations() external view returns (uint256) {
        return allImageHashes.length;
    }

    /// @notice Withdraw accumulated fees to a chosen address. Owner only.
    function withdrawFees(address payable to) external {
        if (msg.sender != owner) revert NotOwner();
        uint256 balance = address(this).balance;
        if (balance == 0) revert NoFeesToWithdraw();
        (bool ok, ) = to.call{value: balance}("");
        if (!ok) revert WithdrawalFailed();
        emit FeesWithdrawn(to, balance);
    }
}
