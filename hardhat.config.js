// Load Sapphire first so it can wrap the provider.
require("@oasisprotocol/sapphire-hardhat");
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Sapphire currently needs pre-Shanghai bytecode.
      evmVersion: "paris",
    },
  },
  networks: {
    "sapphire-testnet": {
      url: "https://testnet.sapphire.oasis.io",
      chainId: 0x5aff, // 23295
      accounts,
    },
    "sapphire-localnet": {
      // docker run -it -p8545:8545 -p8546:8546 ghcr.io/oasisprotocol/sapphire-localnet
      url: "http://localhost:8545",
      chainId: 0x5afd, // 23293
      accounts,
    },
  },
};
