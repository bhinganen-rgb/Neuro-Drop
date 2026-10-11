const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(signer.address);
  console.log("Network:  ", hre.network.name);
  console.log("Deployer: ", signer.address);
  console.log("Balance:  ", hre.ethers.formatEther(bal), "BOT");

  const F = await hre.ethers.getContractFactory("NeuroDrop");
  const nd = await F.deploy();
  await nd.waitForDeployment();
  const addr = await nd.getAddress();

  console.log("NeuroDrop deployed at:", addr);
  console.log("\n>>> Update CONTRACT_ADDRESS in frontend/index.html <<<");
}

main().catch((e) => { console.error(e); process.exit(1); });
