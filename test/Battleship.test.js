const { expect } = require("chai");
const { ethers } = require("hardhat");

// Known board layout for deterministic tests:
// ship A (len 3, horizontal) at (0,0) -> cells 0,1,2
// ship B (len 2, vertical)   at (5,2) -> cells 21, 29
// ship C (len 2, horizontal) at (3,7) -> cells 59, 60
const CELLS = [0, 1, 2, 21, 29, 59, 60];
const BOARD = CELLS.reduce((m, c) => m | (1n << BigInt(c)), 0n);

const cell = (x, y) => y * 8 + x;

describe("Battleship", () => {
  let game, player, other;

  beforeEach(async () => {
    [player, other] = await ethers.getSigners();
    game = await ethers.deployContract("TestBattleship");
    await game.newGameWithBoard(BOARD);
  });

  it("places exactly SHIP_CELLS ship cells with random placement", async () => {
    // `other` gets a randomly placed board from the production newGame path.
    await game.connect(other).newGame();
    const board = await game.connect(other).exposeBoard();
    let bits = 0;
    for (let b = board; b > 0n; b >>= 1n) bits += Number(b & 1n);
    expect(bits).to.equal(Number(await game.SHIP_CELLS()));
  });

  it("rejects malformed deterministic test boards", async () => {
    const fresh = await ethers.deployContract("TestBattleship");
    const tooFewCells = BOARD ^ 1n;
    const tooManyCells = BOARD | (1n << 10n);

    await expect(fresh.newGameWithBoard(tooFewCells)).to.be.revertedWithCustomError(
      fresh,
      "InvalidTestBoard"
    );
    await expect(fresh.newGameWithBoard(tooManyCells)).to.be.revertedWithCustomError(
      fresh,
      "InvalidTestBoard"
    );
  });

  it("registers a hit and a miss correctly", async () => {
    await game.fire(0, 0); // ship A -> hit
    await game.fire(7, 7); // empty water -> miss

    const g = await game.myGame("0x");
    expect(g.shotCount).to.equal(2);
    expect(g.hitCount).to.equal(1);
    expect(g.hits).to.equal(1n << BigInt(cell(0, 0)));
    expect(g.active).to.equal(true);
  });

  it("rejects firing at the same cell twice", async () => {
    await game.fire(3, 3);
    await expect(game.fire(3, 3)).to.be.revertedWithCustomError(game, "AlreadyFired");
  });

  it("rejects out-of-bounds shots", async () => {
    await expect(game.fire(8, 0)).to.be.revertedWithCustomError(game, "OutOfBounds");
    await expect(game.fire(0, 8)).to.be.revertedWithCustomError(game, "OutOfBounds");
  });

  it("wins after sinking all ship cells and allows board reveal", async () => {
    for (const c of CELLS) {
      await game.fire(c % 8, Math.floor(c / 8));
    }
    const g = await game.myGame("0x");
    expect(g.active).to.equal(false);
    expect(g.won).to.equal(true);
    expect(g.hitCount).to.equal(7);
    expect(await game.revealBoard("0x")).to.equal(BOARD);
  });

  it("loses after MAX_SHOTS without sinking the fleet", async () => {
    const maxShots = Number(await game.MAX_SHOTS());
    // Fire at empty cells only: skip the 7 ship cells.
    const shipSet = new Set(CELLS);
    let fired = 0;
    for (let c = 0; c < 64 && fired < maxShots; c++) {
      if (shipSet.has(c)) continue;
      await game.fire(c % 8, Math.floor(c / 8));
      fired++;
    }
    const g = await game.myGame("0x");
    expect(g.active).to.equal(false);
    expect(g.won).to.equal(false);
  });

  it("keeps the board hidden while the game is active", async () => {
    await expect(game.revealBoard("0x")).to.be.revertedWithCustomError(game, "GameStillActive");
  });

  it("blocks play without an active game", async () => {
    await expect(game.connect(other).fire(0, 0)).to.be.revertedWithCustomError(
      game,
      "NoActiveGame"
    );
    await expect(game.connect(other).myGame("0x")).to.be.revertedWithCustomError(
      game,
      "NoFinishedGame"
    );
  });

  it("blocks starting a second game while one is active", async () => {
    await expect(game.newGame()).to.be.revertedWithCustomError(game, "GameStillActive");
    await expect(game.newGameWithBoard(BOARD)).to.be.revertedWithCustomError(game, "GameStillActive");
  });

  it("isolates games per player", async () => {
    await game.connect(other).newGame();
    await game.fire(0, 0); // player hits their own board's ship
    const otherView = await game.connect(other).myGame("0x");
    expect(otherView.shotCount).to.equal(0);
  });

  it("allows a rematch after the game ends", async () => {
    for (const c of CELLS) {
      await game.fire(c % 8, Math.floor(c / 8));
    }
    await game.newGameWithBoard(BOARD);
    const g = await game.myGame("0x");
    expect(g.active).to.equal(true);
    expect(g.shotCount).to.equal(0);
    expect(g.hitCount).to.equal(0);
    await expect(game.revealBoard("0x")).to.be.revertedWithCustomError(game, "GameStillActive");
  });

  it("emits no events for game actions (privacy: logs are public)", async () => {
    const tx = await game.fire(0, 0);
    const receipt = await tx.wait();
    expect(receipt.logs).to.have.lengthOf(0);
  });
});
