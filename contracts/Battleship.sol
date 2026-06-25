// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Sapphire} from "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";
import {SiweAuth} from "@oasisprotocol/sapphire-contracts/contracts/auth/SiweAuth.sol";

/// Battleship against the contract. The ship board stays in Sapphire storage;
/// players learn hit/miss state through authenticated view calls.
contract Battleship is SiweAuth {
    uint8 public constant GRID = 8; // 8x8 board, cell index = y * 8 + x
    uint8 public constant MAX_SHOTS = 24; // lose if fleet survives this many
    uint8 public constant SHIP_CELLS = 7; // ships of length 3 + 2 + 2

    struct Game {
        uint64 board; // secret ship bitmap — never returned while active
        uint64 shots; // bitmap of cells the player has fired at
        uint64 hits; // bitmap of shots that hit a ship
        uint8 shotCount;
        uint8 hitCount;
        bool active;
        bool won;
        bool exists;
    }

    // Internal so the local test harness can inspect and seed games.
    mapping(address => Game) internal games;

    error GameStillActive();
    error NoActiveGame();
    error NoFinishedGame();
    error OutOfBounds();
    error AlreadyFired();
    error NotAuthenticated();

    /// @param inDomain The dApp domain baked into SIWE login messages.
    constructor(string memory inDomain) SiweAuth(inDomain) {}

    /// Start a new game. The house places its fleet with TEE randomness.
    function newGame() external {
        Game storage g = games[msg.sender];
        if (g.active) revert GameStillActive();
        games[msg.sender] = Game({
            board: _placeShips(),
            shots: 0,
            hits: 0,
            shotCount: 0,
            hitCount: 0,
            active: true,
            won: false,
            exists: true
        });
    }

    /// Fire at cell (x, y). Result is NOT returned or logged — query myGame().
    function fire(uint8 x, uint8 y) external {
        Game storage g = games[msg.sender];
        if (!g.active) revert NoActiveGame();
        if (x >= GRID || y >= GRID) revert OutOfBounds();

        uint64 bit = uint64(1) << (uint16(y) * GRID + x);
        if (g.shots & bit != 0) revert AlreadyFired();

        g.shots |= bit;
        g.shotCount++;

        if (g.board & bit != 0) {
            g.hits |= bit;
            g.hitCount++;
            if (g.hitCount == SHIP_CELLS) {
                g.active = false;
                g.won = true;
            }
        }
        if (g.active && g.shotCount >= MAX_SHOTS) {
            g.active = false;
        }
    }

    /// The player's private view of their game.
    /// @param token SIWE auth token from login(); may be empty in tx context.
    function myGame(bytes memory token)
        external
        view
        returns (
            uint64 shots,
            uint64 hits,
            uint8 shotCount,
            uint8 hitCount,
            bool active,
            bool won
        )
    {
        Game storage g = _authenticatedGame(token);
        return (g.shots, g.hits, g.shotCount, g.hitCount, g.active, g.won);
    }

    /// Reveal the full board, but only once the game is over.
    function revealBoard(bytes memory token) external view returns (uint64) {
        Game storage g = _authenticatedGame(token);
        if (g.active) revert GameStillActive();
        return g.board;
    }

    function _authenticatedGame(bytes memory token)
        internal
        view
        returns (Game storage g)
    {
        // Sapphire eth_call sets msg.sender to address(0), so view calls use
        // the SIWE token. Transactions keep the normal msg.sender path.
        address player = msg.sender;
        if (player == address(0)) {
            player = authMsgSender(token); // address(0) if token is empty
            if (player == address(0)) revert NotAuthenticated();
        }
        g = games[player];
        if (!g.exists) revert NoFinishedGame();
    }

    /// Place ships of length 3, 2, 2 at random; returns the board bitmap.
    function _placeShips() internal view returns (uint64 board) {
        bytes32 seed = _seed();
        uint8[3] memory lengths = [3, 2, 2];
        uint256 nonce;
        uint256 placed;
        while (placed < lengths.length) {
            // Expand the private seed into placement attempts.
            bytes32 r = keccak256(abi.encodePacked(seed, nonce++));
            bool horizontal = uint8(r[0]) & 1 == 1;
            uint8 x = uint8(r[1]) % GRID;
            uint8 y = uint8(r[2]) % GRID;
            (bool ok, uint64 mask) = _shipMask(x, y, lengths[placed], horizontal);
            if (ok && board & mask == 0) {
                board |= mask;
                placed++;
            }
        }
    }

    /// Bitmap for a ship at (x, y); ok=false if it doesn't fit on the grid.
    function _shipMask(uint8 x, uint8 y, uint8 len, bool horizontal)
        internal
        pure
        returns (bool ok, uint64 mask)
    {
        if (horizontal ? x + len > GRID : y + len > GRID) return (false, 0);
        for (uint8 k = 0; k < len; k++) {
            uint8 cx = horizontal ? x + k : x;
            uint8 cy = horizontal ? y : y + k;
            mask |= uint64(1) << (uint16(cy) * GRID + cx);
        }
        return (true, mask);
    }

    /// Randomness source — virtual so tests can run without the precompile.
    function _seed() internal view virtual returns (bytes32) {
        return bytes32(Sapphire.randomBytes(32, "battleship.placement"));
    }
}
