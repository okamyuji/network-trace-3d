import assert from "node:assert/strict";
import { test } from "node:test";
import { chapters } from "./index.ts";

test("章IDとシナリオIDに重複がない", () => {
  assert.equal(new Set(chapters.map((c) => c.id)).size, chapters.length);
  for (const c of chapters) {
    assert.equal(new Set(c.scenarios.map((s) => s.id)).size, c.scenarios.length, c.id);
  }
});

test("すべての手順が、章に存在するノードだけを参照している", () => {
  for (const c of chapters) {
    const ids = new Set(c.nodes.map((n) => n.id));
    for (const s of c.scenarios) {
      assert.ok(s.steps.length > 0, `${c.id}/${s.id} に手順がない`);
      s.steps.forEach((step, i) => {
        const where = `${c.id}/${s.id}#${i + 1}`;
        for (const ref of [step.from, step.to, ...(step.focus ?? []), ...Object.keys(step.state ?? {})]) {
          if (ref !== undefined) assert.ok(ids.has(ref), `${where} が未定義のノード ${ref} を参照`);
        }
        assert.equal(step.from === undefined, step.to === undefined, `${where} は from と to の片方だけを持つ`);
        assert.ok(step.title.length > 0 && step.log.length > 0, `${where} の文が空`);
      });
    }
  }
});
