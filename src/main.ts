import { chapters } from "./chapters/index.ts";
import { createStage } from "./core/stage.ts";
import type { Chapter, Scenario } from "./core/types.ts";

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} がありません`);
  return found as T;
}

const chapterSelect = el<HTMLSelectElement>("chapter");
const scenarioSelect = el<HTMLSelectElement>("scenario");
const counter = el("counter");
const title = el("step-title");
const log = el<HTMLOListElement>("log");
const stage = createStage(el("stage"));

let chapter: Chapter;
let scenario: Scenario;
// -1 は「まだ何も送っていない」初期状態（画面では 0 / N）。選んだだけでは動かさない
let index = -1;
let timer: number | undefined;

function option(value: string, text: string): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

function render(): void {
  const step = scenario.steps[index];
  // 状態表示は先頭からの積み上げにする。途中の手順を直接開いても表示が同じになる
  const state = Object.assign({}, ...scenario.steps.slice(0, index + 1).map((s) => s.state ?? {}));
  stage.show(step && { ...step, state });
  counter.textContent = `${index + 1} / ${scenario.steps.length}`;
  title.textContent = step?.title ?? "「次へ」で1手順目を始めます";
  log.replaceChildren(
    ...scenario.steps.slice(0, index + 1).map((s, i) => {
      const li = document.createElement("li");
      li.textContent = s.log;
      if (i === index) li.classList.add("current");
      if (s.status === "fail" || s.status === "wait") li.classList.add(s.status);
      return li;
    }),
  );
  const params = new URLSearchParams({ ch: chapter.id, sc: scenario.id, step: String(index + 1) });
  history.replaceState(null, "", `?${params}`);
}

function clampIndex(i: number): number {
  return Math.min(Math.max(i, -1), scenario.steps.length - 1);
}

function selectScenario(id: string | null, step = 0): void {
  scenario = chapter.scenarios.find((s) => s.id === id) ?? chapter.scenarios[0]!;
  scenarioSelect.value = scenario.id;
  index = clampIndex(step - 1);
  render();
}

function selectChapter(id: string | null, sc: string | null = null, step = 0): void {
  chapter = chapters.find((c) => c.id === id) ?? chapters[0]!;
  chapterSelect.value = chapter.id;
  scenarioSelect.replaceChildren(...chapter.scenarios.map((s) => option(s.id, s.label)));
  stage.load(chapter);
  selectScenario(sc, step);
}

function go(delta: number): void {
  index = clampIndex(index + delta);
  render();
}

function stop(): void {
  window.clearInterval(timer);
  timer = undefined;
  el("play").textContent = "自動再生";
}

chapterSelect.append(...chapters.map((c) => option(c.id, c.title)));
chapterSelect.addEventListener("change", () => { stop(); selectChapter(chapterSelect.value); });
scenarioSelect.addEventListener("change", () => { stop(); selectScenario(scenarioSelect.value); });
el("prev").addEventListener("click", () => { stop(); go(-1); });
el("next").addEventListener("click", () => { stop(); go(1); });
el("play").addEventListener("click", () => {
  if (timer !== undefined) return stop();
  if (index === scenario.steps.length - 1) index = -1;
  el("play").textContent = "停止";
  go(1);
  timer = window.setInterval(() => (index === scenario.steps.length - 1 ? stop() : go(1)), 1800);
});

const params = new URLSearchParams(location.search);
selectChapter(params.get("ch"), params.get("sc"), Number(params.get("step")) || 0);

// E2E がブラウザ外から手順を進めて状態を確かめるための窓口
Object.assign(window, {
  __demo: {
    chapters: () => chapters.map((c) => ({ id: c.id, scenarios: c.scenarios.map((s) => ({ id: s.id, steps: s.steps.length })) })),
    open: (ch: string, sc: string, step: number) => { stop(); selectChapter(ch, sc, step); },
    steps: () => scenario.steps.map((s) => ({ title: s.title, log: s.log, packet: s.from && s.to ? s.packet ?? "" : null, status: s.status ?? "ok" })),
    current: () => ({ chapter: chapter.id, scenario: scenario.id, step: index + 1, total: scenario.steps.length, title: title.textContent }),
    renderCalls: () => stage.renderCalls(),
    settled: () => stage.settled(),
  },
});
