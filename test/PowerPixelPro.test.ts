import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs.js";
import { PowerPixelPro } from "../typechain-types";

const { ethers } = hre;

const SHA_A = "0x" + "a".repeat(64);
const SHA_B = "0x" + "b".repeat(64);
const SHA_C = "0x" + "c".repeat(64);

const REASON_CLEAR     = "Clear to publish.";
const REASON_BRAND     = "Trademark or brand presence detected.";
const REASON_WATERMARK = "Third-party watermark detected.";

const LOOKUP_FEE      = ethers.parseEther("0.0001");
const ATTESTATION_FEE = ethers.parseEther("0.0001");

describe("PowerPixelPro", () => {
  async function deploy() {
    const [deployer, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PowerPixelPro");
    const c = (await Factory.deploy()) as unknown as PowerPixelPro;
    await c.waitForDeployment();
    return { c, deployer, alice, bob };
  }

  /* ───────── deployment ───────── */
  it("sets the deployer as the owner", async () => {
    const { c, deployer } = await deploy();
    expect(await c.owner()).to.equal(deployer.address);
  });

  it("exposes the LOOKUP_FEE and ATTESTATION_FEE constants", async () => {
    const { c } = await deploy();
    expect(await c.LOOKUP_FEE()).to.equal(LOOKUP_FEE);
    expect(await c.ATTESTATION_FEE()).to.equal(ATTESTATION_FEE);
  });

  /* ───────── lookup payment ───────── */
  it("payForLookup with the exact fee emits LookupPaid", async () => {
    const { c, alice } = await deploy();
    await expect(c.connect(alice).payForLookup({ value: LOOKUP_FEE }))
      .to.emit(c, "LookupPaid")
      .withArgs(alice.address, LOOKUP_FEE, anyValue);
  });

  it("payForLookup with too little reverts with InsufficientLookupFee", async () => {
    const { c, alice } = await deploy();
    await expect(
      c.connect(alice).payForLookup({ value: LOOKUP_FEE - 1n })
    ).to.be.revertedWithCustomError(c, "InsufficientLookupFee");
  });

  it("payForLookup accepts an overpayment (more than the minimum)", async () => {
    const { c, alice } = await deploy();
    const generous = LOOKUP_FEE * 3n;
    await expect(c.connect(alice).payForLookup({ value: generous }))
      .to.emit(c, "LookupPaid")
      .withArgs(alice.address, generous, anyValue);
  });

  /* ───────── attestation ───────── */
  it("registerScan with the fee emits ScanAttested and marks isAttested", async () => {
    const { c, alice } = await deploy();
    await expect(
      c.connect(alice).registerScan(SHA_A, REASON_CLEAR, false, false, false, {
        value: ATTESTATION_FEE,
      })
    )
      .to.emit(c, "ScanAttested")
      .withArgs(SHA_A, alice.address, false, false, false, REASON_CLEAR, anyValue, anyValue);

    expect(await c.isAttested(SHA_A)).to.equal(true);
  });

  it("registerScan without the fee reverts with InsufficientAttestationFee", async () => {
    const { c, alice } = await deploy();
    await expect(
      c.connect(alice).registerScan(SHA_A, REASON_CLEAR, false, false, false)
    ).to.be.revertedWithCustomError(c, "InsufficientAttestationFee");
  });

  it("registerScan with too little reverts with InsufficientAttestationFee", async () => {
    const { c, alice } = await deploy();
    await expect(
      c.connect(alice).registerScan(SHA_A, REASON_CLEAR, false, false, false, {
        value: ATTESTATION_FEE - 1n,
      })
    ).to.be.revertedWithCustomError(c, "InsufficientAttestationFee");
  });

  it("getAttestation returns the stored record", async () => {
    const { c, alice } = await deploy();
    const tx = await c
      .connect(alice)
      .registerScan(SHA_A, REASON_BRAND, true, true, false, { value: ATTESTATION_FEE });
    const receipt = await tx.wait();

    const [attestor, timestamp, blockNumber, reason, ai, brand, watermark] =
      await c.getAttestation(SHA_A);
    expect(attestor).to.equal(alice.address);
    expect(blockNumber).to.equal(receipt!.blockNumber);
    expect(reason).to.equal(REASON_BRAND);
    expect(ai).to.equal(true);
    expect(brand).to.equal(true);
    expect(watermark).to.equal(false);
    expect(timestamp).to.be.gt(0n);
  });

  it("re-scanning the same hash overwrites and does not increment totalAttestations", async () => {
    const { c, alice, bob } = await deploy();
    await c.connect(alice).registerScan(SHA_A, REASON_BRAND, false, true, false, {
      value: ATTESTATION_FEE,
    });
    expect(await c.totalAttestations()).to.equal(1n);

    await c.connect(bob).registerScan(SHA_A, REASON_CLEAR, false, false, false, {
      value: ATTESTATION_FEE,
    });
    expect(await c.totalAttestations()).to.equal(1n);

    const [attestor, , , reason, , brand] = await c.getAttestation(SHA_A);
    expect(attestor).to.equal(bob.address);
    expect(reason).to.equal(REASON_CLEAR);
    expect(brand).to.equal(false);
  });

  it("totalAttestations counts unique hashes", async () => {
    const { c, alice, bob } = await deploy();
    await c.connect(alice).registerScan(SHA_A, REASON_CLEAR, false, false, false, {
      value: ATTESTATION_FEE,
    });
    await c.connect(bob).registerScan(SHA_B, REASON_WATERMARK, false, false, true, {
      value: ATTESTATION_FEE,
    });
    await c.connect(alice).registerScan(SHA_C, REASON_CLEAR, true, false, false, {
      value: ATTESTATION_FEE,
    });
    expect(await c.totalAttestations()).to.equal(3n);
  });

  it("getAttestation reverts NotAttested for an unscanned hash", async () => {
    const { c } = await deploy();
    await expect(c.getAttestation(SHA_A)).to.be.revertedWithCustomError(c, "NotAttested");
  });

  /* ───────── fee withdrawal ───────── */
  it("contract balance accrues from lookups and attestations", async () => {
    const { c, alice, bob } = await deploy();
    const contractAddr = await c.getAddress();

    await c.connect(alice).payForLookup({ value: LOOKUP_FEE });
    await c.connect(bob).registerScan(SHA_A, REASON_CLEAR, false, false, false, {
      value: ATTESTATION_FEE,
    });

    expect(await ethers.provider.getBalance(contractAddr)).to.equal(LOOKUP_FEE + ATTESTATION_FEE);
  });

  it("withdrawFees by the owner moves balance to the recipient and emits FeesWithdrawn", async () => {
    const { c, deployer, alice, bob } = await deploy();
    const contractAddr = await c.getAddress();

    await c.connect(alice).payForLookup({ value: LOOKUP_FEE });
    await c.connect(bob).registerScan(SHA_A, REASON_CLEAR, false, false, false, {
      value: ATTESTATION_FEE,
    });
    const total = LOOKUP_FEE + ATTESTATION_FEE;

    const recipientBefore = await ethers.provider.getBalance(bob.address);
    await expect(c.connect(deployer).withdrawFees(bob.address))
      .to.emit(c, "FeesWithdrawn")
      .withArgs(bob.address, total);

    expect(await ethers.provider.getBalance(contractAddr)).to.equal(0n);
    expect(await ethers.provider.getBalance(bob.address)).to.equal(recipientBefore + total);
  });

  it("withdrawFees from a non-owner reverts with NotOwner", async () => {
    const { c, alice } = await deploy();
    await c.connect(alice).payForLookup({ value: LOOKUP_FEE });
    await expect(c.connect(alice).withdrawFees(alice.address)).to.be.revertedWithCustomError(
      c,
      "NotOwner"
    );
  });

  it("withdrawFees with empty balance reverts with NoFeesToWithdraw", async () => {
    const { c, deployer } = await deploy();
    await expect(c.connect(deployer).withdrawFees(deployer.address)).to.be.revertedWithCustomError(
      c,
      "NoFeesToWithdraw"
    );
  });
});
