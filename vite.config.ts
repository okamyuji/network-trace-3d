import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: { port: 5173, strictPort: true },
  // three.js 本体だけで 500kB を超えるため、警告の基準を引き上げる
  build: { chunkSizeWarningLimit: 800 },
});
