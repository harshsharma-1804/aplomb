import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5000,
    proxy: {
      "/__config": {
        target: process.env["VITE_ORCHESTRATOR_URL"] ?? "http://localhost:3002",
        changeOrigin: true,
        credentials: true,
      },
      "/auth": {
        target: process.env["VITE_ORCHESTRATOR_URL"] ?? "http://localhost:3002",
        changeOrigin: true,
        credentials: true,
      },
      "/api": {
        target: process.env["VITE_ORCHESTRATOR_URL"] ?? "http://localhost:3002",
        changeOrigin: true,
        credentials: true,
      },
    },
  },
  preview: { port: 5000 },
});
