// book の表紙（cover.html）を 1000x1400 の PNG に書き出す。
// 使い方: node scripts/cover.ts <出力先のPNG>
import { chromium } from "playwright";
import { createServer } from "vite";

const out = process.argv[2];
if (!out) {
  console.error("使い方: node scripts/cover.ts <出力先のPNG>");
  process.exit(1);
}
const server = await createServer({ logLevel: "error", server: { port: 5176, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:5176/cover.html");
await page.waitForFunction(() => (window as any).__coverReady === true, null, { timeout: 30000 });
await page.screenshot({ path: out });
await browser.close();
await server.close();
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(out);
