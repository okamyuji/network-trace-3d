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
  : await createServer({ logLevel: "error", server: { port: 5174, strictPort: true } }).then((s) =>
      s.listen(),
    );
const url = "http://localhost:5174/";

// headless の Chromium は GPU がないため、ソフトウェア実装の WebGL を明示的に許可する
const browser = await chromium.launch({
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const errors: string[] = [];
page.on("console", (m) => {
  // ReadPixels の性能警告は、この検査スクリプトがキャンバスを読むことで出るため数えない
  if (
    (m.type() === "error" || m.type() === "warning") &&
    !m.text().includes("GPU stall due to ReadPixels")
  ) {
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
      await page.evaluate(([c, s, n]) => (window as any).__demo.open(c, s, n), [
        ch.id,
        sc.id,
        step,
      ] as const);
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
        for (let i = 0; i < px.length; i += 4)
          colors.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
        return { current: demo.current(), calls: demo.renderCalls(), colors: colors.size };
      });
      const where = `${ch.id}/${sc.id}#${step}`;
      if (info.current.step !== step || info.current.scenario !== sc.id)
        failures.push(`${where}: 手順が開けない ${JSON.stringify(info.current)}`);
      if (info.calls <= 0) failures.push(`${where}: 描画呼び出しが0`);
      if (info.colors < 8) failures.push(`${where}: キャンバスがほぼ単色 (${info.colors}色)`);
      if (saveShots)
        await page.screenshot({
          path: `shots/${ch.id}-${sc.id}-${String(step).padStart(2, "0")}.png`,
        });
      checked++;
    }
  }
}

// 読者が実際に触る操作（選択欄、前へ・次へ、自動再生、URLでの直接指定）でも手順が進むことを確かめる
const current = () =>
  page.evaluate(
    () => (window as any).__demo.current() as { chapter: string; scenario: string; step: number },
  );
await page.goto(url);
await page.waitForFunction(() => "__demo" in window);
// 選んだだけでは何も動かず、「次へ」を押すまで初期状態（0手順目）にとどまること
const idle = () =>
  page.evaluate(() => ({
    step: (window as any).__demo.current().step as number,
    moving: !(window as any).__demo.settled(),
    counter: document.getElementById("counter")!.textContent,
    packets: [...document.querySelectorAll(".packet-label")].filter((e) => e.textContent).length,
  }));
for (const [select, value] of [
  ["#chapter", "ch04"],
  ["#scenario", "drop"],
] as const) {
  await page.selectOption(select, value);
  await page.waitForTimeout(100);
  const s = await idle();
  if (s.step !== 0 || s.moving || s.counter !== "0 / 5" || s.packets !== 0)
    failures.push(`操作: ${select} を選んだだけで動いた ${JSON.stringify(s)}`);
}
await page.click("#next");
await page.click("#next");
await page.click("#prev");
const manual = await current();
if (manual.chapter !== "ch04" || manual.scenario !== "drop" || manual.step !== 1)
  failures.push(`操作: 選択と前へ・次へ ${JSON.stringify(manual)}`);
if (!["ch=ch04", "sc=drop", "step=1"].every((q) => page.url().includes(q)))
  failures.push(`操作: URL ${page.url()}`);
await page.click("#prev");
const back = await idle();
if (back.step !== 0 || back.packets !== 0)
  failures.push(`操作: 前へで初期状態に戻らない ${JSON.stringify(back)}`);
await page.click("#next");
await page.click("#play");
await page
  .waitForFunction(() => (window as any).__demo.current().step >= 4, null, { timeout: 10000 })
  .catch(() => undefined);
const played = await current();
if (played.step < 4) failures.push(`操作: 自動再生で進まない ${JSON.stringify(played)}`);
await page.click("#play");
await page.goto(`${url}?ch=ch07&sc=expired&step=3`);
await page.waitForFunction(() => "__demo" in window);
const linked = await current();
if (linked.chapter !== "ch07" || linked.scenario !== "expired" || linked.step !== 3)
  failures.push(`操作: URLから直接開けない ${JSON.stringify(linked)}`);
await page.goto(`${url}?ch=ch07&sc=expired&step=0`);
await page.waitForFunction(() => "__demo" in window);
const linkedIdle = await idle();
if (linkedIdle.step !== 0 || linkedIdle.packets !== 0)
  failures.push(`操作: step=0 で初期状態を開けない ${JSON.stringify(linkedIdle)}`);
// 「次へ」を1回押すごとに、右側の説明と立体図のパケットが同じ手順を指していることを確かめる
let synced = 0;
for (const ch of chapters) {
  for (const sc of ch.scenarios) {
    await page.goto(`${url}?ch=${ch.id}&sc=${sc.id}&step=0`);
    await page.waitForFunction(() => "__demo" in window);
    const expected = await page.evaluate(
      () =>
        (window as any).__demo.steps() as {
          title: string;
          log: string;
          packet: string | null;
          status: string;
        }[],
    );
    for (let k = 1; k <= expected.length; k++) {
      await page.click("#next");
      // ラベルの位置と表示は次の描画で反映されるので、1フレーム待ってから読む
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const e = expected[k - 1]!;
      const seen = await page.evaluate(() => ({
        counter: document.getElementById("counter")!.textContent,
        items: document.querySelectorAll("#log li").length,
        last: document.querySelector("#log li:last-child")?.textContent ?? "",
        title: document.getElementById("step-title")!.textContent,
        packets: [...document.querySelectorAll(".packet-label")]
          .map((el) => el.textContent)
          .filter(Boolean),
      }));
      const packet =
        e.packet === null ? [] : [e.packet + (e.status === "fail" ? " ×" : "")].filter(Boolean);
      const ok =
        seen.counter === `${k} / ${expected.length}` &&
        seen.items === k &&
        seen.last === e.log &&
        seen.title === e.title &&
        JSON.stringify(seen.packets) === JSON.stringify(packet);
      if (!ok)
        failures.push(
          `同期: ${ch.id}/${sc.id} 次へ${k}回目 期待=${JSON.stringify({ k, log: e.log, packet })} 実際=${JSON.stringify(seen)}`,
        );
      synced++;
    }
  }
}
console.log(`「次へ」での同期の検査: ${synced}手順`);
console.log(
  `画面操作の検査: 選択→次へ→前へ ${JSON.stringify(manual)} / 自動再生後 step=${played.step} / URL指定 ${JSON.stringify(linked)}`,
);

await browser.close();
await server.close();
console.log(`検査したステップ: ${checked}`);
console.log(`コンソールのエラーと警告: ${errors.length}`);
for (const e of errors) console.log(`  ${e}`);
for (const f of failures) console.log(`NG ${f}`);
process.exit(errors.length === 0 && failures.length === 0 ? 0 : 1);
