/**
 * Minimal CLI for playing on a live Sapphire network.
 *
 * Usage (env vars, since `hardhat run` swallows CLI args):
 *   CONTRACT=0x... ACTION=new            npx hardhat run scripts/play.js --network sapphire-testnet
 *   CONTRACT=0x... ACTION=fire X=3 Y=4   npx hardhat run scripts/play.js --network sapphire-testnet
 *   CONTRACT=0x... ACTION=status         npx hardhat run scripts/play.js --network sapphire-testnet
 *   CONTRACT=0x... ACTION=reveal         npx hardhat run scripts/play.js --network sapphire-testnet
 */
const hre = require("hardhat");
const { ethers } = require("ethers");
const { wrapEthersSigner } = require("@oasisprotocol/sapphire-ethers-v6");
const { SiweMessage } = require("siwe");

const GRID = 8;

// View calls need a SIWE token because Sapphire eth_call does not preserve
// msg.sender.
async function siweLogin(game, signer) {
  const domain = await game.domain();
  const { chainId } = await signer.provider.getNetwork();
  const msg = new SiweMessage({
    domain,
    address: signer.address,
    uri: `http://${domain}`,
    version: "1",
    chainId: Number(chainId),
  }).toMessage();
  const sig = ethers.Signature.from(await signer.signMessage(msg));
  return game.login(msg, { r: sig.r, s: sig.s, v: sig.v });
}

function renderBoard(shots, hits, board = 0n) {
  const lines = ["    " + [...Array(GRID).keys()].join(" ")];
  for (let y = 0; y < GRID; y++) {
    let row = ` ${y} |`;
    for (let x = 0; x < GRID; x++) {
      const bit = 1n << BigInt(y * GRID + x);
      let ch = "·"; // unexplored water
      if (hits & bit) ch = "X"; // confirmed hit
      else if (shots & bit) ch = "o"; // miss
      else if (board & bit) ch = "S"; // ship (only after reveal)
      row += ch + " ";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

async function main() {
  const { CONTRACT, ACTION = "status", X, Y } = process.env;
  if (!CONTRACT) throw new Error("Set CONTRACT=0x... to the deployed address");

  // Use the Sapphire signer wrapper so tx calldata is encrypted.
  const provider = new ethers.JsonRpcProvider(hre.network.config.url);
  const signer = wrapEthersSigner(new ethers.Wallet(process.env.PRIVATE_KEY, provider));
  const artifact = await hre.artifacts.readArtifact("Battleship");
  const game = new ethers.Contract(CONTRACT, artifact.abi, signer);
  console.log(`Player: ${signer.address}\nAction: ${ACTION}\n`);

  if (ACTION === "new") {
    const tx = await game.newGame();
    console.log(`newGame tx: ${tx.hash}`);
    await tx.wait();
    console.log("Game started.");
    return;
  }

  if (ACTION === "fire") {
    if (X === undefined || Y === undefined) throw new Error("Set X= and Y=");
    const tx = await game.fire(Number(X), Number(Y));
    console.log(`fire(${X}, ${Y}) tx: ${tx.hash}`);
    await tx.wait();
    // The tx result is intentionally silent — ask the contract privately.
  }

  const token = await siweLogin(game, signer);

  if (ACTION === "reveal") {
    const board = await game.revealBoard(token);
    const g = await game.myGame(token);
    console.log(renderBoard(g.shots, g.hits, board));
    console.log("\nS = surviving ship cell, X = hit, o = miss");
    return;
  }

  // status (also runs after fire)
  const g = await game.myGame(token);
  console.log(renderBoard(g.shots, g.hits));
  console.log(
    `\nShots: ${g.shotCount}/24  Hits: ${g.hitCount}/7  ` +
      (g.active ? "Game on." : g.won ? "YOU WON — fleet destroyed!" : "Game over — fleet survived.")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
