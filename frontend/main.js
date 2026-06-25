import { Buffer } from "buffer";
import { BrowserProvider, Contract, JsonRpcProvider, Signature, Wallet } from "ethers";

// Some siwe/sapphire deps reach for the Node global at runtime.
globalThis.Buffer ??= Buffer;
import { wrapEthersSigner } from "@oasisprotocol/sapphire-ethers-v6";
import { SiweMessage } from "siwe";

const CONTRACT = "0x1172C51280765764DdEEc83d5fd10a10D395BC17";
const EXPLORER = "https://explorer.oasis.io/testnet/sapphire";
const GRID = 8;

const CHAIN = {
  chainId: "0x5aff", // 23295
  chainName: "Oasis Sapphire Testnet",
  nativeCurrency: { name: "TEST", symbol: "TEST", decimals: 18 },
  rpcUrls: ["https://testnet.sapphire.oasis.io"],
  blockExplorerUrls: [EXPLORER],
};

const ABI = [
  "function newGame()",
  "function fire(uint8 x, uint8 y)",
  "function myGame(bytes token) view returns (uint64 shots, uint64 hits, uint8 shotCount, uint8 hitCount, bool active, bool won)",
  "function revealBoard(bytes token) view returns (uint64)",
  "function login(string siweMsg, (bytes32 r, bytes32 s, uint256 v) sig) view returns (bytes)",
  "function domain() view returns (string)",
  "function MAX_SHOTS() view returns (uint8)",
  "function SHIP_CELLS() view returns (uint8)",
  "error GameStillActive()",
  "error NoActiveGame()",
  "error NoFinishedGame()",
  "error OutOfBounds()",
  "error AlreadyFired()",
  "error NotAuthenticated()",
];

const $ = (id) => document.getElementById(id);
const COLS = "ABCDEFGH";

let game = null; // ethers Contract bound to the Sapphire-wrapped signer
let token = "0x"; // SIWE auth token for view calls
let maxShots = 24;
let shipCells = 7;
let lastView = null;
let busy = false;

/* ── log ──────────────────────────────────────────────────────────────── */

function log(tag, html) {
  const p = document.createElement("p");
  const t = new Date().toTimeString().slice(0, 8);
  p.innerHTML =
    `<span class="t">${t}</span>` +
    `<span class="tag tag-${tag.toLowerCase()}">[${tag.toUpperCase()}]</span>` +
    html;
  $("log").appendChild(p);
  $("log").scrollTop = $("log").scrollHeight;
}

function describeError(e) {
  const data = e?.data ?? e?.info?.error?.data;
  if (game && typeof data === "string") {
    try {
      const parsed = game.interface.parseError(data);
      if (parsed) return parsed.name;
    } catch {}
  }
  if (e?.code === "ACTION_REJECTED") return "Signature rejected";
  return e?.shortMessage ?? e?.message ?? String(e);
}

/* ── board rendering ──────────────────────────────────────────────────── */

function buildBoard() {
  $("col-labels").innerHTML = COLS.split("")
    .map((c) => `<span>${c}</span>`)
    .join("");
  $("row-labels").innerHTML = Array.from({ length: GRID }, (_, i) => `<span>${i + 1}</span>`).join("");
  const board = $("board");
  board.innerHTML = "";
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.title = `${COLS[x]}${y + 1}`;
      cell.addEventListener("click", () => fire(x, y, cell));
      board.appendChild(cell);
    }
  }
}

function renderView(view, board = null) {
  lastView = view;
  const { shots, hits, shotCount, hitCount, active, won } = view;
  for (const cell of document.querySelectorAll(".cell")) {
    const i = BigInt(Number(cell.dataset.y) * GRID + Number(cell.dataset.x));
    const bit = 1n << i;
    cell.classList.remove("pending");
    cell.classList.toggle("hit", (hits & bit) !== 0n);
    cell.classList.toggle("miss", (shots & bit) !== 0n && (hits & bit) === 0n);
    cell.classList.toggle("ship", board !== null && (board & bit) !== 0n);
    cell.classList.toggle("locked", !active);
  }
  $("ro-shots").textContent = `${String(shotCount).padStart(2, "0")}/${maxShots}`;
  $("ro-hits").textContent = `${String(hitCount).padStart(2, "0")}/${shipCells}`;
  const state = $("ro-state");
  if (active) {
    state.textContent = "Playing";
    state.className = "state-on";
  } else if (won) {
    state.textContent = "Won";
    state.className = "state-won";
  } else {
    state.textContent = "Lost";
    state.className = "state-lost";
  }
  $("btn-new").disabled = active;
  $("btn-reveal").disabled = active;
}

function renderNoGame() {
  lastView = null;
  $("ro-shots").textContent = "--/--";
  $("ro-hits").textContent = "--/--";
  const state = $("ro-state");
  state.textContent = "No game";
  state.className = "state-idle";
  $("btn-new").disabled = false;
  $("btn-reveal").disabled = true;
  for (const cell of document.querySelectorAll(".cell")) {
    cell.className = "cell locked";
  }
}

/* ── chain plumbing ───────────────────────────────────────────────────── */

async function ensureChain(ethereum) {
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN.chainId }],
    });
  } catch (e) {
    if (e?.code !== 4902) throw e;
    await ethereum.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
  }
}

async function siweLogin(signer) {
  const domain = await game.domain();
  const msg = new SiweMessage({
    domain,
    address: signer.address,
    uri: `http://${domain}`,
    version: "1",
    chainId: parseInt(CHAIN.chainId, 16),
  }).toMessage();
  log("sys", "Sign the message to continue.");
  const sig = Signature.from(await signer.signMessage(msg));
  return game.login(msg, { r: sig.r, s: sig.s, v: sig.v });
}

async function getSigner() {
  if (window.ethereum) {
    await ensureChain(window.ethereum);
    const provider = new BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    return await provider.getSigner();
  }
  // Testnet fallback for running without a wallet extension.
  const key = import.meta.env.PRIVATE_KEY;
  if (!key) {
    throw new Error("No wallet found. Install MetaMask, or set PRIVATE_KEY in .env.");
  }
  log("sys", "No wallet extension. Using PRIVATE_KEY from .env.");
  return new Wallet(key, new JsonRpcProvider(CHAIN.rpcUrls[0]));
}

async function connect() {
  try {
    $("btn-connect").disabled = true;
    const signer = wrapEthersSigner(await getSigner());
    game = new Contract(CONTRACT, ABI, signer);

    $("net-lamp").classList.add("on");
    $("net-label").textContent = "Connected";
    $("operator").textContent = `Account: ${signer.address.slice(0, 6)}...${signer.address.slice(-4)}`;
    log("sys", `Connected: <b>${signer.address}</b>`);

    [maxShots, shipCells] = (await Promise.all([game.MAX_SHOTS(), game.SHIP_CELLS()])).map(Number);
    token = await siweLogin(signer);
    log("sys", "Ready.");

    $("btn-refresh").disabled = false;
    await refresh();
  } catch (e) {
    log("err", describeError(e));
    $("btn-connect").disabled = false;
  }
}

/* ── game actions ─────────────────────────────────────────────────────── */

async function refresh() {
  if (!game) return;
  try {
    renderView(await game.myGame(token));
  } catch (e) {
    if (describeError(e) === "NoFinishedGame") renderNoGame();
    else log("err", describeError(e));
  }
}

async function newGame() {
  if (!game || busy) return;
  busy = true;
  try {
    log("sys", "Starting new game.");
    const tx = await game.newGame();
    log("tx", txLink(tx.hash));
    await tx.wait();
    log("sys", "Game started.");
    await refresh();
  } catch (e) {
    log("err", describeError(e));
  } finally {
    busy = false;
  }
}

async function fire(x, y, cell) {
  if (!game || busy || !lastView?.active) return;
  if (cell.classList.contains("hit") || cell.classList.contains("miss")) return;
  busy = true;
  cell.classList.add("pending");
  const ref = `${COLS[x]}${y + 1}`;
  try {
    const before = lastView.hitCount;
    const tx = await game.fire(x, y);
    log("tx", `Shot <b>${ref}</b>: ${txLink(tx.hash)}`);
    await tx.wait();
    await refresh();
    if (lastView.hitCount > before) {
      log("hit", `<b>${ref}</b>: hit.`);
    } else {
      log("miss", `<b>${ref}</b>: miss.`);
    }
    if (!lastView.active) {
      if (lastView.won) log("win", "You won. Reveal the board if you want.");
      else log("err", "No shots left. You lost.");
    }
  } catch (e) {
    cell.classList.remove("pending");
    log("err", `${ref}: ${describeError(e)}`);
  } finally {
    busy = false;
  }
}

async function reveal() {
  if (!game) return;
  try {
    const board = await game.revealBoard(token);
    renderView(lastView, board);
    log("sys", "Board revealed.");
  } catch (e) {
    log("err", describeError(e));
  }
}

function txLink(hash) {
  return `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 18)}...</a>`;
}

/* ── boot ─────────────────────────────────────────────────────────────── */

buildBoard();
renderNoGame();
$("btn-new").disabled = true;
$("btn-connect").addEventListener("click", connect);
$("btn-new").addEventListener("click", newGame);
$("btn-refresh").addEventListener("click", refresh);
$("btn-reveal").addEventListener("click", reveal);
const link = $("contract-link");
link.href = `${EXPLORER}/address/${CONTRACT}`;
link.textContent = CONTRACT;
log("sys", "Connect wallet to begin.");
window.ethereum?.on?.("accountsChanged", () => location.reload());
window.ethereum?.on?.("chainChanged", () => location.reload());
