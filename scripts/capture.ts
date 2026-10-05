// シナリオを再生しながら移動の途中も撮影し、GIFアニメーションにする。ImageMagick の magick コマンドを使う。
// 使い方: node scripts/capture.ts <出力先ディレクトリ> <章>:<シナリオ> [<章>:<シナリオ> ...]
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const [outDir, ...targets] = process.argv.slice(2);
if (!outDir || targets.length === 0) {
  console.error("使い方: node scripts/capture.ts <出力先> <章>:<シナリオ> ...");
  process.exit(1);
}

// 移動中の2コマと、到着後の止まった1コマを撮る
const MOVING_MS = [300, 600];
const SETTLED_DELAY_CS = 120;
const MOVING_DELAY_CS = 15;

const server = await createServer({ logLevel: "error", server: { port: 5175, strictPort: true } });
await server.listen();
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
await page.goto("http://localhost:5175/");
await page.waitForFunction(() => "__demo" in window);
await mkdir(outDir, { recursive: true });

for (const target of targets) {
  const [ch, sc] = target.split(":");
  const work = await mkdtemp(join(tmpdir(), "capture-"));
  const frames: { file: string; delay: number }[] = [];
  const total = await page.evaluate(
    ([c, s]) => {
      const demo = (window as any).__demo;
      // 最初のコマは、まだ何も送っていない初期状態（0 / N）にする
      demo.open(c, s, 0);
      return demo.current().total as number;
    },
    [ch, sc] as const,
  );
  await page.waitForTimeout(300);
  const first = join(work, "0000.png");
  await page.screenshot({ path: first });
  frames.push({ file: first, delay: SETTLED_DELAY_CS });
  for (let step = 1; step <= total; step++) {
    await page.evaluate(([c, s, n]) => (window as any).__demo.open(c, s, n), [
      ch,
      sc,
      step,
    ] as const);
    let last = 0;
    for (const at of MOVING_MS) {
      await page.waitForTimeout(at - last);
      last = at;
      const file = join(work, `${String(frames.length).padStart(4, "0")}.png`);
      await page.screenshot({ path: file });
      frames.push({ file, delay: MOVING_DELAY_CS });
    }
    await page.waitForFunction(() => (window as any).__demo.settled());
    await page.waitForTimeout(150);
    const file = join(work, `${String(frames.length).padStart(4, "0")}.png`);
    await page.screenshot({ path: file });
    frames.push({ file, delay: SETTLED_DELAY_CS });
  }
  const out = join(outDir, `${ch}-${sc}.gif`);
  const args = frames.flatMap((f) => ["-delay", String(f.delay), f.file]);
  execFileSync("magick", [
    ...args,
    "-loop",
    "0",
    "-resize",
    "880x",
    "-colors",
    "96",
    "-layers",
    "Optimize",
    out,
  ]);
  await rm(work, { recursive: true });
  console.log(`${out}  ${frames.length}コマ`);
}

await browser.close();
await server.close();
