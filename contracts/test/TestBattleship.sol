// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Battleship} from "../Battleship.sol";

/**
 * Test-only harness: the Sapphire randomBytes precompile does not exist on
 * the local Hardhat network. Tests use a mocked seed and can start games with
 * a known valid board.
 */
contract TestBattleship is Battleship {
    error InvalidTestBoard();

    constructor() Battleship("localhost") {}

    function _seed() internal view override returns (bytes32) {
        return keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender));
    }

    /// Start a deterministic test game for the caller.
    function newGameWithBoard(uint64 board) external {
        if (_shipCellCount(board) != SHIP_CELLS) revert InvalidTestBoard();

        Game storage g = games[msg.sender];
        if (g.active) revert GameStillActive();

        games[msg.sender] = Game({
            board: board,
            shots: 0,
            hits: 0,
            shotCount: 0,
            hitCount: 0,
            active: true,
            won: false,
            exists: true
        });
    }

    /// Expose the caller's secret board regardless of game state.
    function exposeBoard() external view returns (uint64) {
        return games[msg.sender].board;
    }

    function _shipCellCount(uint64 board) private pure returns (uint8 count) {
        while (board != 0) {
            count += uint8(board & uint64(1));
            board >>= 1;
        }
    }
}
