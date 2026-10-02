// 全章・全シナリオ・全ステップを実ブラウザで再生し、描画とエラーの有無を確かめる。
// 使い方: node scripts/verify.ts [--shots] [--dist]
//   --shots で shots/ に各ステップの画像を保存し、--dist でビルド済みの dist/ を検査する
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer, preview } from "vite";

interface DemoChapter {
  id: string;
  scenarios: { id: string; steps: number }[];
}

const saveShots = process.argv.includes("--shots");
const server = process.argv.includes("--dist")
  ? await preview({ logLevel: "error", preview: { port: 5174, strictPort: true } })
  : await createServer({ logLevel: "error", server: { port: 5174, strictPort: true } }).then((s) => s.listen());
const url = "http://localhost:5174/";

// headless の Chromium は GPU がないため、ソフトウェア実装の WebGL を明示的に許可する
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors: string[] = [];
page.on("console", (m) => {
  // ReadPixels の性能警告は、この検査スクリプトがキャンバスを読むことで出るため数えない
  if ((m.type() === "error" || m.type() === "warning") && !m.text().includes("GPU stall due to ReadPixels")) {
    errors.push(`${m.type()}: ${m.text()}`);
  }
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url);
await page.waitForFunction(() => "__demo" in window);
const chapters = await page.evaluate(() => (window as any).__demo.chapters() as DemoChapter[]);
if (saveShots) await mkdir("shots", { recursive: true });

let checked = 0;
const failures: string[] = [];
for (const ch of chapters) {
  for (const sc of ch.scenarios) {
    for (let step = 1; step <= sc.steps; step++) {
      await page.evaluate(([c, s, n]) => (window as any).__demo.open(c, s, n), [ch.id, sc.id, step] as const);
      await page.waitForFunction(() => (window as any).__demo.settled());
      await page.waitForTimeout(120);
      const info = await page.evaluate(() => {
        const demo = (window as any).__demo;
        const canvas = document.querySelector("#stage canvas") as HTMLCanvasElement;
        const probe = document.createElement("canvas");
        probe.width = 64;
        probe.height = 64;
        const ctx = probe.getContext("2d")!;
        ctx.drawImage(canvas, 0, 0, 64, 64);
        const px = ctx.getImageData(0, 0, 64, 64).data;
        const colors = new Set<number>();
        for (let i = 0; i < px.length; i += 4) colors.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        return { current: demo.current(), calls: demo.renderCalls(), colors: colors.size };
      });
      const where = `${ch.id}/${sc.id}#${step}`;
      if (info.current.step !== step || info.current.scenario !== sc.id) failures.push(`${where}: 手順が開けない ${JSON.stringify(info.current)}`);
      if (info.calls <= 0) failures.push(`${where}: 描画呼び出しが0`);
      if (info.colors < 8) failures.push(`${where}: キャンバスがほぼ単色 (${info.colors}色)`);
      if (saveShots) await page.screenshot({ path: `shots/${ch.id}-${sc.id}-${String(step).padStart(2, "0")}.png` });
      checked++;
    }
  }
}

// 読者が実際に触る操作（選択欄、前へ・次へ、自動再生、URLでの直接指定）でも手順が進むことを確かめる
const current = () => page.evaluate(() => (window as any).__demo.current() as { chapter: string; scenario: string; step: number });
await page.goto(url);
await page.waitForFunction(() => "__demo" in window);
await page.selectOption("#chapter", "ch04");
await page.selectOption("#scenario", "drop");
await page.click("#next");
await page.click("#next");
await page.click("#prev");
const manual = await current();
if (manual.chapter !== "ch04" || manual.scenario !== "drop" || manual.step !== 2) failures.push(`操作: 選択と前へ・次へ ${JSON.stringify(manual)}`);
if (!["ch=ch04", "sc=drop", "step=2"].every((q) => page.url().includes(q))) failures.push(`操作: URL ${page.url()}`);
await page.click("#play");
await page.waitForFunction(() => (window as any).__demo.current().step >= 4, null, { timeout: 10000 }).catch(() => undefined);
const played = await current();
if (played.step < 4) failures.push(`操作: 自動再生で進まない ${JSON.stringify(played)}`);
await page.click("#play");
await page.goto(`${url}?ch=ch07&sc=expired&step=3`);
await page.waitForFunction(() => "__demo" in window);
const linked = await current();
if (linked.chapter !== "ch07" || linked.scenario !== "expired" || linked.step !== 3) failures.push(`操作: URLから直接開けない ${JSON.stringify(linked)}`);
console.log(`画面操作の検査: 選択→次へ→前へ ${JSON.stringify(manual)} / 自動再生後 step=${played.step} / URL指定 ${JSON.stringify(linked)}`);

await browser.close();
await server.close();
console.log(`検査したステップ: ${checked}`);
console.log(`コンソールのエラーと警告: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
for (const f of failures) console.log(`NG ${f}`);
process.exit(errors.length === 0 && failures.length === 0 ? 0 : 1);
