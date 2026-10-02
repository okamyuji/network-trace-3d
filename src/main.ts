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
let index = 0;
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
  title.textContent = step?.title ?? "";
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

function selectScenario(id: string | null, step = 1): void {
  scenario = chapter.scenarios.find((s) => s.id === id) ?? chapter.scenarios[0]!;
  scenarioSelect.value = scenario.id;
  index = Math.min(Math.max(step - 1, 0), scenario.steps.length - 1);
  render();
}

function selectChapter(id: string | null, sc: string | null = null, step = 1): void {
  chapter = chapters.find((c) => c.id === id) ?? chapters[0]!;
  chapterSelect.value = chapter.id;
  scenarioSelect.replaceChildren(...chapter.scenarios.map((s) => option(s.id, s.label)));
  stage.load(chapter);
  selectScenario(sc, step);
}

function go(delta: number): void {
  index = Math.min(Math.max(index + delta, 0), scenario.steps.length - 1);
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
selectChapter(params.get("ch"), params.get("sc"), Number(params.get("step") ?? 1));

// E2E がブラウザ外から手順を進めて状態を確かめるための窓口
Object.assign(window, {
  __demo: {
    chapters: () => chapters.map((c) => ({ id: c.id, scenarios: c.scenarios.map((s) => ({ id: s.id, steps: s.steps.length })) })),
    open: (ch: string, sc: string, step: number) => { stop(); selectChapter(ch, sc, step); },
    current: () => ({ chapter: chapter.id, scenario: scenario.id, step: index + 1, total: scenario.steps.length, title: title.textContent }),
    renderCalls: () => stage.renderCalls(),
    settled: () => stage.settled(),
  },
});
