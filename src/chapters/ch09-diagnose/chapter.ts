import type { Chapter, Scenario, Step, StepStatus } from "../../core/types.ts";
import { type CurlResult, type Layer, type World, curl, diagnose, dig, ping } from "./sim.ts";

const BASE: World = { host: "shop.example", ip: "203.0.113.10", dns: "ok", hostUp: true, icmpAllowed: true, port: "open", cert: "ok", status: 200 };

const NODE_OF: Record<Layer, string> = { dns: "dns", reach: "server", port: "fw", tls: "server", http: "server" };
const LAYER_NAME: Record<Layer, string> = { dns: "名前解決", reach: "到達性", port: "ポート", tls: "TLS（証明書）", http: "HTTP（アプリ側）" };

const lastLines = (text: string, n: number): string => text.split("\n").slice(-n).join("\n");

function digSteps(w: World): Step[] {
  const d = dig(w);
  return [
    { title: "dig で名前解決を確かめる", log: "dig shop.example", from: "you", to: "dns", packet: "A?", focus: ["dns"] },
    { title: d.ok ? "IPアドレスが返る" : "名前が見つからない", log: lastLines(d.output, 2), from: "dns", to: "you", packet: d.ok ? w.ip : "NXDOMAIN", status: d.ok ? "ok" : "fail", focus: ["you"], state: { you: lastLines(d.output, 1) } },
  ];
}

// 名前が引けないとパケット自体を送らないので、移動を描かない
function move(w: World, to: string, packet: string): Partial<Step> {
  return w.dns === "ok" ? { from: "you", to, packet } : {};
}

function pingSteps(w: World): Step[] {
  const p = ping(w);
  const to = w.icmpAllowed ? "server" : "fw";
  const steps: Step[] = [
    { title: "ping で到達性を確かめる", log: "ping -c 3 shop.example", ...move(w, to, "ICMP echo"), status: p.ok ? "ok" : "fail", focus: [w.dns === "ok" ? to : "you"], state: { you: lastLines(p.output, 1) } },
  ];
  if (p.ok) steps.push({ title: "応答が返る", log: lastLines(p.output, 1), from: "server", to: "you", packet: "ICMP reply", focus: ["you"] });
  return steps;
}

const CURL_STATUS: Record<CurlResult["exitCode"], StepStatus> = { 0: "ok", 6: "fail", 7: "fail", 28: "wait", 60: "ok" };

function curlReply(c: CurlResult, http: boolean): Step | undefined {
  const last = lastLines(c.output, 2);
  if (c.exitCode === 7) return { title: "RST が返る", log: last, from: "server", to: "you", packet: "RST", status: "fail", focus: ["you"] };
  if (c.exitCode === 60) return { title: "証明書の検証で止まる", log: last, from: "server", to: "you", packet: "証明書", status: "fail", focus: ["you"] };
  if (c.exitCode !== 0) return undefined;
  const line = lastLines(c.output, 1);
  return { title: "HTTPの応答が返る", log: line, from: "server", to: "you", packet: line.replace("< HTTP/1.1 ", ""), status: http ? "fail" : "ok", focus: ["you"] };
}

function curlSteps(w: World, http: boolean): Step[] {
  const c = curl(w);
  const to = c.exitCode === 28 && w.hostUp ? "fw" : "server";
  const first: Step = {
    title: "curl -v でどこまで進むかを見る",
    log: "curl -v https://shop.example/",
    ...move(w, to, "SYN :443"),
    status: CURL_STATUS[c.exitCode],
    focus: ["server"],
    state: { you: lastLines(c.output, c.ok || c.exitCode === 60 ? 2 : 1) },
  };
  const reply = curlReply(c, http);
  return reply ? [first, reply] : [first];
}

function build(id: string, label: string, change: Partial<World>): Scenario {
  const w = { ...BASE, ...change };
  const v = diagnose(w);
  const verdict: Step = {
    title: v.stoppedAt ? `止まっている場所: ${LAYER_NAME[v.stoppedAt]}` : "止まっている場所はない",
    log: v.note,
    status: v.stoppedAt ? "fail" : "ok",
    focus: [v.stoppedAt ? NODE_OF[v.stoppedAt] : "you"],
  };
  return { id, label, steps: [...digSteps(w), ...pingSteps(w), ...curlSteps(w, v.stoppedAt === "http"), verdict] };
}

export const ch09: Chapter = {
  id: "ch09",
  title: "切り分けのコマンド",
  nodes: [
    { id: "you", label: "自分の端末", kind: "client", pos: [-7, 0.5, 0] },
    { id: "dns", label: "DNS", kind: "dns", pos: [-2, 0.55, -4] },
    { id: "fw", label: "ファイアウォール", kind: "firewall", pos: [1, 0.9, 0] },
    { id: "server", label: "shop.example 203.0.113.10", kind: "server", pos: [6, 0.8, 0] },
  ],
  scenarios: [
    build("healthy", "正常", {}),
    build("dns", "名前が引けない", { dns: "nxdomain" }),
    build("icmp", "ping だけ返らない", { icmpAllowed: false }),
    build("closed", "ポートが閉じている", { port: "closed" }),
    build("filtered", "ポートで捨てられる", { port: "filtered" }),
    build("down", "ホストが止まっている", { hostUp: false }),
    build("cert", "証明書の期限切れ", { cert: "expired" }),
    build("bad-gateway", "502 が返る", { status: 502 }),
  ],
};
