import type { Address } from "viem";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

export const SEPOLIA_ETHERSCAN = "https://sepolia.etherscan.io";

export const txUrl = (hash: string) => `${SEPOLIA_ETHERSCAN}/tx/${hash}`;
export const addressUrl = (addr: string) => `${SEPOLIA_ETHERSCAN}/address/${addr}`;

export const DONOTTRAIN_ABI = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sha256Hash", type: "bytes32" },
      { name: "pHash", type: "bytes8" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "sha256Hash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getRegistration",
    stateMutability: "view",
    inputs: [{ name: "sha256Hash", type: "bytes32" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "timestamp", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
      { name: "pHash", type: "bytes8" },
    ],
  },
  {
    type: "function",
    name: "findSimilar",
    stateMutability: "view",
    inputs: [
      { name: "queryPHash", type: "bytes8" },
      { name: "maxDistance", type: "uint8" },
    ],
    outputs: [{ type: "bytes32[]" }],
  },
  {
    type: "function",
    name: "totalRegistrations",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "HashRegistered",
    inputs: [
      { name: "sha256Hash", type: "bytes32", indexed: true },
      { name: "pHash", type: "bytes8", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "AlreadyRegistered", inputs: [] },
  { type: "error", name: "NotRegistered", inputs: [] },
  { type: "error", name: "HammingDistanceTooLarge", inputs: [] },
] as const;

// ---------------------------------------------------------------------------
// Power Pixel Pro — separate contract, separate address, separate ABI.
// Deliberately mirrored below the DoNotTrain exports so the two products
// never share state, events, or function selectors at the application layer.
// ---------------------------------------------------------------------------

export const PPP_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_PPP_CONTRACT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;

export const POWERPIXELPRO_ABI = [
  {
    type: "function",
    name: "LOOKUP_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ATTESTATION_FEE",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "payForLookup",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "registerScan",
    stateMutability: "payable",
    inputs: [
      { name: "imageHash", type: "bytes32" },
      { name: "verdictReason", type: "string" },
      { name: "aiDetected", type: "bool" },
      { name: "brandDetected", type: "bool" },
      { name: "watermarkDetected", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "isAttested",
    stateMutability: "view",
    inputs: [{ name: "imageHash", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "imageHash", type: "bytes32" }],
    outputs: [
      { name: "attestor", type: "address" },
      { name: "timestamp", type: "uint256" },
      { name: "blockNumber", type: "uint256" },
      { name: "verdictReason", type: "string" },
      { name: "aiDetected", type: "bool" },
      { name: "brandDetected", type: "bool" },
      { name: "watermarkDetected", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "totalAttestations",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawFees",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "LookupPaid",
    inputs: [
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ScanAttested",
    inputs: [
      { name: "imageHash", type: "bytes32", indexed: true },
      { name: "attestor", type: "address", indexed: true },
      { name: "aiDetected", type: "bool", indexed: false },
      { name: "brandDetected", type: "bool", indexed: false },
      { name: "watermarkDetected", type: "bool", indexed: false },
      { name: "verdictReason", type: "string", indexed: false },
      { name: "timestamp", type: "uint256", indexed: false },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeesWithdrawn",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "InsufficientLookupFee", inputs: [] },
  { type: "error", name: "InsufficientAttestationFee", inputs: [] },
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "NotAttested", inputs: [] },
  { type: "error", name: "WithdrawalFailed", inputs: [] },
  { type: "error", name: "NoFeesToWithdraw", inputs: [] },
] as const;

/// Fixed fees (matched to the on-chain constants). 0.0001 ETH each — tiny
/// on Sepolia, real-but-affordable framing on mainnet.
export const LOOKUP_FEE_ETH = "0.0001";
export const ATTESTATION_FEE_ETH = "0.0001";
