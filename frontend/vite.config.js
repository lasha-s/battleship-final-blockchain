import { defineConfig } from "vite";

export default defineConfig({
  // Expose the project-root .env for the testnet wallet fallback.
  envDir: "..",
  envPrefix: ["VITE_", "PRIVATE_"],
  resolve: {
    // siwe expects Buffer at runtime.
    alias: { buffer: "buffer/" },
  },
});
