const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying Battleship to ${network.name} as ${deployer.address}`);

  // The SIWE domain the CLI client logs in with (see scripts/play.js).
  const battleship = await ethers.deployContract("Battleship", ["localhost"]);
  await battleship.waitForDeployment();

  console.log(`Battleship deployed at: ${await battleship.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
