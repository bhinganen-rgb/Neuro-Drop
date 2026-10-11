const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NeuroDrop", function () {
  let nd, owner, alice, bob, carol;
  const ONE = ethers.parseEther("1");
  const HOUR = 3600;
  const DAY = 86400;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const F = await ethers.getContractFactory("NeuroDrop");
    nd = await F.deploy();
    await nd.waitForDeployment();
  });

  async function armDrop(from = alice, beneficiary = bob, interval = DAY, amount = ONE, msg = "hi") {
    const tx = await nd.connect(from).arm(beneficiary.address, msg, interval, { value: amount });
    await tx.wait();
    return (await nd.dropCount()) - 1n;
  }

  it("arm validates interval bounds", async () => {
    await expect(nd.connect(alice).arm(bob.address, "m", 60, { value: ONE })).to.be.revertedWith("bad interval");
    await expect(nd.connect(alice).arm(bob.address, "m", 366 * DAY, { value: ONE })).to.be.revertedWith("bad interval");
  });

  it("arm requires non-zero amount and beneficiary", async () => {
    await expect(nd.connect(alice).arm(bob.address, "m", DAY, { value: 0 })).to.be.revertedWith("amount required");
    await expect(nd.connect(alice).arm(ethers.ZeroAddress, "m", DAY, { value: ONE })).to.be.revertedWith("bad beneficiary");
    await expect(nd.connect(alice).arm(alice.address, "m", DAY, { value: ONE })).to.be.revertedWith("self beneficiary");
  });

  it("arm rejects overlong message", async () => {
    const big = "x".repeat(513);
    await expect(nd.connect(alice).arm(bob.address, big, DAY, { value: ONE })).to.be.revertedWith("message too long");
  });

  it("only owner can checkIn and disarm", async () => {
    const id = await armDrop();
    await expect(nd.connect(bob).checkIn(id)).to.be.revertedWith("not owner");
    await expect(nd.connect(bob).disarm(id)).to.be.revertedWith("not owner");
  });

  it("checkIn resets deadline", async () => {
    const id = await armDrop();
    const d1 = await nd.getDeadline(id);
    await ethers.provider.send("evm_increaseTime", [HOUR * 2]);
    await ethers.provider.send("evm_mine", []);
    await nd.connect(alice).checkIn(id);
    const d2 = await nd.getDeadline(id);
    expect(d2).to.be.gt(d1);
  });

  it("release requires expired", async () => {
    const id = await armDrop();
    await expect(nd.connect(carol).release(id)).to.be.revertedWith("not expired");
  });

  it("release pays beneficiary minus fee, permissionless", async () => {
    const id = await armDrop(alice, bob, HOUR, ONE);
    await ethers.provider.send("evm_increaseTime", [HOUR + 10]);
    await ethers.provider.send("evm_mine", []);
    const before = await ethers.provider.getBalance(bob.address);
    await nd.connect(carol).release(id); // permissionless
    const after = await ethers.provider.getBalance(bob.address);
    const fee = (ONE * 50n) / 10_000n;
    expect(after - before).to.equal(ONE - fee);
    expect(await nd.accruedFees()).to.equal(fee);
  });

  it("disarm returns funds to owner", async () => {
    const id = await armDrop();
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await nd.connect(alice).disarm(id);
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);
    expect(after - before + gas).to.equal(ONE);
  });

  it("cannot release after disarm or double-release", async () => {
    const id = await armDrop();
    await nd.connect(alice).disarm(id);
    await expect(nd.connect(carol).release(id)).to.be.revertedWith("not armed");

    const id2 = await armDrop(alice, bob, HOUR);
    await ethers.provider.send("evm_increaseTime", [HOUR + 10]);
    await ethers.provider.send("evm_mine", []);
    await nd.connect(carol).release(id2);
    await expect(nd.connect(carol).release(id2)).to.be.revertedWith("not armed");
  });

  it("checkIn fails once expired", async () => {
    const id = await armDrop(alice, bob, HOUR);
    await ethers.provider.send("evm_increaseTime", [HOUR + 10]);
    await ethers.provider.send("evm_mine", []);
    await expect(nd.connect(alice).checkIn(id)).to.be.revertedWith("expired");
  });

  it("pause blocks arm and checkIn", async () => {
    await nd.pause();
    await expect(nd.connect(alice).arm(bob.address, "m", DAY, { value: ONE })).to.be.reverted;
    await nd.unpause();
    const id = await armDrop();
    await nd.pause();
    await expect(nd.connect(alice).checkIn(id)).to.be.reverted;
  });

  it("admin fee bounds and withdraw", async () => {
    await expect(nd.setPlatformFeeBps(501)).to.be.revertedWith("fee too high");
    await nd.setPlatformFeeBps(100);
    expect(await nd.platformFeeBps()).to.equal(100);

    const id = await armDrop(alice, bob, HOUR, ONE);
    await ethers.provider.send("evm_increaseTime", [HOUR + 10]);
    await ethers.provider.send("evm_mine", []);
    await nd.connect(carol).release(id);
    const fee = (ONE * 100n) / 10_000n;
    expect(await nd.accruedFees()).to.equal(fee);
    await expect(nd.connect(alice).withdrawFees(alice.address)).to.be.reverted;
    await nd.withdrawFees(owner.address);
    expect(await nd.accruedFees()).to.equal(0n);
  });

  it("isExpired accuracy and indexes", async () => {
    const id = await armDrop(alice, bob, HOUR);
    expect(await nd.isExpired(id)).to.equal(false);
    await ethers.provider.send("evm_increaseTime", [HOUR + 10]);
    await ethers.provider.send("evm_mine", []);
    expect(await nd.isExpired(id)).to.equal(true);

    const owners = await nd.getDropsByOwner(alice.address);
    const benes = await nd.getDropsForBeneficiary(bob.address);
    expect(owners.length).to.equal(1);
    expect(benes.length).to.equal(1);

    await nd.connect(carol).release(id);
    expect(await nd.isExpired(id)).to.equal(false); // no longer armed
  });
});
