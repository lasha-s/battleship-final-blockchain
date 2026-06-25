# Sapphire Battleship — Confidential Game State via TEE

University blockchain course project: a battleship game against the house where the
board lives in **confidential smart-contract storage** on [Oasis Sapphire](https://docs.oasis.io/dapp/sapphire/),
a confidential EVM ParaTime running inside Intel SGX enclaves.

On a public EVM chain this game is impossible to build naively: contract storage is
world-readable, so the opponent's board would be visible to anyone before the first
shot. The classic workaround is commitments plus a ZK proof per move. On Sapphire,
the TEE keeps storage, calldata, and view-call results encrypted — so the contract
simply holds the board in plain Solidity state, and only the enclave can read it.

## The privacy property

- The contract places a fleet (ships of length 3, 2, 2 on an 8×8 grid) using
  **Sapphire's native TEE randomness** (`Sapphire.randomBytes`) — no oracle, not
  predictable by miners/sequencers or the player.
- An observer of the chain sees that *some* transaction hit the contract, but:
  - **calldata is encrypted** — they cannot see which cell you fired at;
  - **storage is encrypted** — they cannot read the board or your progress;
  - **no events are emitted** — event logs would be public even on Sapphire.
- Hit/miss results are only available through `myGame(token)`, an **authenticated
  view call**. On Sapphire, plain `eth_call` queries are unauthenticated —
  `msg.sender` is always `address(0)` — so the contract inherits
  [`SiweAuth`](https://api.docs.oasis.io/sol/sapphire-contracts/contracts/auth/SiweAuth.sol/contract.SiweAuth.html):
  the player signs a Sign-In-With-Ethereum message, `login()` returns an
  encrypted auth token, and that token proves the caller's address in view
  calls. Without a valid token, queries are rejected (`NotAuthenticated`).
- The full board is revealed (`revealBoard(token)`) only after the game ends.

### Known leaks (threat model summary)

| What leaks | Why | Severity |
|---|---|---|
| Tx existence, sender, timing | Public chain metadata | Player identity plays at all |
| Gas used by `fire()` | Hit branch does extra SSTOREs | ~1 bit/shot side channel |
| Trust in Intel SGX + Oasis validators | TEE trust model | Board confidentiality, not integrity of past results |

## Repo layout

```
contracts/Battleship.sol        — the game (deployable)
contracts/test/TestBattleship.sol — test harness with mocked randomness (never deploy)
test/Battleship.test.js         — unit tests (local Hardhat network)
scripts/deploy.js               — deployment
scripts/play.js                 — CLI client
frontend/                       — web UI (Vite + MetaMask), fire-control terminal
```

## Write-up

The full project write-up — threat model, architecture diagram, primitive
choice justification, measured side channels — is in
[docs/WRITEUP.md](docs/WRITEUP.md).

## Live deployment

Deployed on Sapphire Testnet at
[`0x1172C51280765764DdEEc83d5fd10a10D395BC17`](https://explorer.oasis.io/testnet/sapphire/address/0x1172C51280765764DdEEc83d5fd10a10D395BC17).

## Setup

```bash
npm install
npx hardhat test          # 13 tests, run locally with mocked randomness
```

## Deploy & play on Sapphire Testnet

1. Copy `.env.example` to `.env`, set `PRIVATE_KEY`.
2. Fund the account at the [testnet faucet](https://faucet.testnet.oasis.io) (Sapphire).
3. Deploy and play:

```bash
npx hardhat run scripts/deploy.js --network sapphire-testnet

export CONTRACT=0x...   # printed by deploy
ACTION=new                npx hardhat run scripts/play.js --network sapphire-testnet
ACTION=fire X=3 Y=4       npx hardhat run scripts/play.js --network sapphire-testnet
ACTION=status             npx hardhat run scripts/play.js --network sapphire-testnet
ACTION=reveal             npx hardhat run scripts/play.js --network sapphire-testnet
```

Rules: 7 ship cells, 24 shots. Sink the fleet before you run out.

During the demo: open the tx in the [testnet explorer](https://explorer.oasis.io/testnet/sapphire)
and show that the `fire` calldata is encrypted — then run `ACTION=status` to show
the player's authenticated, private view of the same state.

## Web frontend

```bash
npm run frontend        # Vite dev server on http://localhost:5173
```

Requirements: MetaMask with the playing account imported. "ESTABLISH LINK"
switches/adds the Sapphire Testnet network automatically, then asks for one
SIWE signature to unlock the private board view. Click a cell to fire (one
transaction per shot); every tx hash in the log links to the explorer so the
audience can verify the calldata is encrypted.

## Local confidential testing (optional)

The unit tests run on plain Hardhat with mocked randomness. To test the *real*
confidential path locally, run the Sapphire localnet docker image:

```bash
docker run -it -p8545:8545 -p8546:8546 ghcr.io/oasisprotocol/sapphire-localnet
npx hardhat run scripts/deploy.js --network sapphire-localnet
```
