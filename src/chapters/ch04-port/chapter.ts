import type { Chapter, Scenario, Step } from "../../core/types.ts";
import { type ConnectResult, type Host, type IptablesRule, type SgRule, connect } from "./sim.ts";

const host: Host = {
  ip: "10.0.1.10",
  listening: [
    { addr: "0.0.0.0", port: 80 },
    { addr: "127.0.0.1", port: 5432 },
  ],
};
const SG_DEFAULT: SgRule[] = [{ port: 80 }, { port: 5432 }, { port: 8080 }];

const LISTEN_TEXT = "LISTEN 0.0.0.0:80\nLISTEN 127.0.0.1:5432";

const ENDING: Record<ConnectResult["outcome"], string> = {
  connected: "接続できた",
  refused: "すぐに「接続拒否（Connection refused）」になる",
  timeout: "何も返らず、待った末に「時間切れ（timed out）」になる",
};

function build(
  id: string,
  label: string,
  port: number,
  sg: SgRule[],
  iptables: IptablesRule[],
): Scenario {
  const r = connect({ sg, iptables, policy: "ACCEPT", host, port });
  const state = {
    sg: `許可: ${sg.map((x) => x.port).join(", ")}`,
    fw: iptables.length
      ? iptables.map((x) => `--dport ${x.dport} -j ${x.target}`).join("\n")
      : "規則なし（ACCEPT）",
    server: LISTEN_TEXT,
  };
  const syn = `SYN →:${port}`;
  const steps: Step[] = [
    {
      title: `${port}番へ接続を始める`,
      log: `クライアントが ${host.ip}:${port} に SYN を送る`,
      from: "client",
      to: "sg",
      packet: syn,
      focus: ["sg"],
      state,
    },
  ];
  if (r.stoppedAt === "sg") {
    steps.push({
      title: "セキュリティグループで止まる",
      log: r.reason,
      from: "client",
      to: "sg",
      packet: syn,
      status: "fail",
      focus: ["sg"],
    });
  } else {
    steps.push({
      title: "セキュリティグループを通る",
      log: `${port}番の許可規則がある`,
      from: "sg",
      to: "fw",
      packet: syn,
      focus: ["fw"],
    });
    if (r.stoppedAt === "iptables") {
      steps.push({
        title: "iptablesで止まる",
        log: r.reason,
        from: "sg",
        to: "fw",
        packet: syn,
        status: "fail",
        focus: ["fw"],
      });
      if (r.outcome === "refused") {
        steps.push({
          title: "拒否の返事が戻る",
          log: "--reject-with tcp-reset なら RST が返る",
          from: "fw",
          to: "client",
          packet: "RST",
          status: "fail",
          focus: ["client"],
        });
      }
    } else {
      steps.push({
        title: "iptablesを通ってサーバーに届く",
        log: "OSが宛先ポートで待ち受けているプログラムを探す",
        from: "fw",
        to: "server",
        packet: syn,
        focus: ["server"],
      });
      steps.push({
        title:
          r.outcome === "connected"
            ? "待ち受けていたので SYN-ACK を返す"
            : "待ち受けていないので RST を返す",
        log: r.reason,
        from: "server",
        to: "client",
        packet: r.outcome === "connected" ? "SYN-ACK" : "RST",
        status: r.outcome === "connected" ? "ok" : "fail",
        focus: ["client"],
      });
    }
  }
  if (r.outcome === "timeout") {
    steps.push({
      title: "応答を待ち続ける",
      log: "クライアントは SYN を何度か送り直してから諦める",
      from: "client",
      to: "sg",
      packet: syn,
      status: "wait",
      focus: ["client"],
    });
  }
  steps.push({
    title: `結果: ${r.outcome}`,
    log: ENDING[r.outcome],
    status: r.outcome === "connected" ? "ok" : r.outcome === "refused" ? "fail" : "wait",
    focus: [r.stoppedAt === "sg" ? "sg" : r.stoppedAt === "iptables" ? "fw" : "server"],
  });
  return { id, label, steps };
}

export const ch04: Chapter = {
  id: "ch04",
  title: "ポートとファイアウォール",
  nodes: [
    { id: "client", label: "クライアント", kind: "client", pos: [-7, 0.5, 0] },
    { id: "sg", label: "セキュリティグループ", kind: "firewall", pos: [-2.5, 0.9, 0] },
    { id: "fw", label: "iptables（サーバー内）", kind: "firewall", pos: [2, 0.9, 0] },
    { id: "server", label: `サーバー ${host.ip}`, kind: "server", pos: [6, 0.8, 0] },
  ],
  zones: [{ label: "サーバーの中", center: [4, 0.01, 0], size: [6, 5], color: "#22c55e" }],
  scenarios: [
    build("open", "80番: 通る", 80, SG_DEFAULT, []),
    build("closed", "8080番: 誰も待ち受けていない", 8080, SG_DEFAULT, []),
    build("localhost", "5432番: 127.0.0.1でだけ待ち受け", 5432, SG_DEFAULT, []),
    build("sg-block", "80番: セキュリティグループで不許可", 80, [{ port: 22 }], []),
    build("drop", "80番: iptablesでDROP", 80, SG_DEFAULT, [{ dport: 80, target: "DROP" }]),
    build("reject", "80番: iptablesでREJECT", 80, SG_DEFAULT, [{ dport: 80, target: "REJECT" }]),
  ],
};
