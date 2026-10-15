import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { productionFrontendGuard } from "./scripts/release-contract.mjs";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwind(), productionFrontendGuard()],
  server: {
    port: 5173,
    strictPort: true,
    // Dev only: proxy /api to local backend
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
}));
