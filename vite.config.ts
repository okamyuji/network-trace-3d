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
  plugins: [
    {
      // GitHub Pages はヘッダーを付けられないため meta で配る。開発サーバーは CSS を <style> で
      // 差し込み HMR で WebSocket も使うので、ビルド版だけに入れる
      name: "csp",
      apply: "build",
      transformIndexHtml: () => [
        {
          tag: "meta",
          attrs: {
            "http-equiv": "Content-Security-Policy",
            content:
              "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'",
          },
          injectTo: "head-prepend",
        },
      ],
    },
  ],
  base: "./",
  server: { port: 5173, strictPort: true },
  // three.js 本体だけで 500kB を超えるため、警告の基準を引き上げる
  build: { chunkSizeWarningLimit: 800 },
});
