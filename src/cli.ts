// 立体図と同じ手順データを端末に表示する。
// 使い方: node src/cli.ts            （章の一覧）
//         node src/cli.ts ch02       （章のシナリオ一覧）
//         node src/cli.ts ch02 other （手順を順に表示）
import { chapters } from "./chapters/index.ts";

const [chapterId, scenarioId] = process.argv.slice(2);
const chapter = chapters.find((c) => c.id === chapterId);

if (!chapter) {
  for (const c of chapters) console.log(`${c.id}  ${c.title}`);
  process.exit(chapterId ? 1 : 0);
}
const scenario = chapter.scenarios.find((s) => s.id === scenarioId);
if (!scenario) {
  for (const s of chapter.scenarios) console.log(`${s.id}  ${s.label}`);
  process.exit(scenarioId ? 1 : 0);
}

const mark = { ok: "  ", fail: "✗ ", wait: "… " } as const;
console.log(`# ${chapter.title} / ${scenario.label}`);
scenario.steps.forEach((s, i) => {
  const move = s.from && s.to ? `[${s.from} → ${s.to}${s.packet ? ` : ${s.packet}` : ""}] ` : "";
  console.log(`${String(i + 1).padStart(2)}. ${mark[s.status ?? "ok"]}${s.title}`);
  console.log(`      ${move}${s.log.replaceAll("\n", "\n      ")}`);
  for (const [node, text] of Object.entries(s.state ?? {})) {
    if (text) console.log(`      ${node}: ${text.replaceAll("\n", " ")}`);
  }
});
