import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/client"),
    },
  },
  build: {
    outDir: "../../dist/client",
  },
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:3000", ws: true },
      "/auth": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
