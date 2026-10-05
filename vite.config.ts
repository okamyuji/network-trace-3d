import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // node:test の runner が test() の返す Promise を待つため、浮いた Promise にならない
      "typescript/no-floating-promises": [
        "warn",
        { allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: "test" }] },
      ],
    },
    options: { typeAware: true, typeCheck: true },
  },
  base: "./",
  server: { port: 5173, strictPort: true },
  // three.js 本体だけで 500kB を超えるため、警告の基準を引き上げる
  build: { chunkSizeWarningLimit: 800 },
});
