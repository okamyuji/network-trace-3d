import type { Chapter, Scenario, Step } from "../../core/types.ts";
import { createBalancer } from "./sim.ts";

const LB_IP = "10.0.0.5";
const CLIENTS = [
  { id: "c1", ip: "203.0.113.7" },
  { id: "c2", ip: "198.51.100.23" },
  { id: "c3", ip: "192.0.2.44" },
];
const NAMES: Record<string, string> = { a: "appA", b: "appB", c: "appC" };

function newLb() {
  return createBalancer({ ip: LB_IP, targets: ["a", "b", "c"], unhealthyThreshold: 2, healthyThreshold: 2 });
}

function requestSteps(lb: ReturnType<typeof newLb>, client: { id: string; ip: string }, logs: string[]): Step[] {
  const r = lb.forward(client.ip);
  const app = NAMES[r.target]!;
  logs.push(`${app}: remote=${r.remoteAddr} xff=${r.xff}`);
  return [
    { title: `${client.ip} からリクエストが来る`, log: "クライアントはロードバランサのIPに接続する", from: client.id, to: "lb", packet: "GET /", focus: ["lb"] },
    {
      title: `${app} へ振り分ける`,
      log: `ロードバランサが新しく接続を張り直すので、${app} から見た送信元は ${r.remoteAddr}。元のIPは X-Forwarded-For: ${r.xff}`,
      from: "lb",
      to: app,
      packet: `XFF: ${r.xff}`,
      focus: [app],
      state: { log: logs.slice(-3).join("\n") },
    },
  ];
}

function xffScenario(): Scenario {
  const lb = newLb();
  const logs: string[] = [];
  const steps = CLIENTS.flatMap((c) => requestSteps(lb, c, logs));
  steps.push({ title: "ログの送信元が全部同じになる理由", log: `remote はどれも ${LB_IP}。元のIPを知るには X-Forwarded-For を見る（信頼できる経路で付いた値だけを使う）`, focus: ["log"] });
  return { id: "xff", label: "ログのIPが全部同じになる", steps };
}

function healthScenario(): Scenario {
  const lb = newLb();
  const logs: string[] = [];
  const check = (ok: boolean, n: number): Step => {
    lb.healthCheck("b", ok);
    const now = lb.inService().map((t) => NAMES[t]).join(", ");
    return {
      title: `appB へのヘルスチェック${n}回目: ${ok ? "成功" : "失敗"}`,
      log: `振り分け対象: ${now}`,
      from: "lb",
      to: "appB",
      packet: "GET /health",
      status: ok ? "ok" : "fail",
      focus: ["appB"],
      state: { appB: lb.inService().includes("b") ? "振り分け対象" : "対象外", lb: `対象: ${now}` },
    };
  };
  return {
    id: "health",
    label: "ヘルスチェックで振り分け先を外す",
    steps: [
      check(false, 1),
      { title: "1回の失敗ではまだ外さない", log: "閾値は「続けて2回」。一時的な遅れで外さないための余裕", focus: ["lb"] },
      check(false, 2),
      ...requestSteps(lb, CLIENTS[0]!, logs),
      ...requestSteps(lb, CLIENTS[1]!, logs),
      ...requestSteps(lb, CLIENTS[2]!, logs),
      check(true, 3),
      check(true, 4),
      ...requestSteps(lb, CLIENTS[0]!, logs),
    ],
  };
}

export const ch08: Chapter = {
  id: "ch08",
  title: "プロキシとロードバランサ",
  nodes: [
    { id: "c1", label: "203.0.113.7", kind: "client", pos: [-7, 0.5, -3] },
    { id: "c2", label: "198.51.100.23", kind: "client", pos: [-7, 0.5, 0] },
    { id: "c3", label: "192.0.2.44", kind: "client", pos: [-7, 0.5, 3] },
    { id: "lb", label: `ロードバランサ ${LB_IP}`, kind: "lb", pos: [-1.5, 0.3, 0] },
    { id: "appA", label: "appA", kind: "server", pos: [4, 0.8, -3.5] },
    { id: "appB", label: "appB", kind: "server", pos: [4, 0.8, 0] },
    { id: "appC", label: "appC", kind: "server", pos: [4, 0.8, 3.5] },
    { id: "log", label: "アクセスログ", kind: "proxy", pos: [8.5, 2.5, 0] },
  ],
  zones: [{ label: "プライベートなサブネット", center: [4, 0.01, 0], size: [5, 10], color: "#22c55e" }],
  scenarios: [xffScenario(), healthScenario()],
};
