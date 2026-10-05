import type { Chapter, Scenario, Step } from "../../core/types.ts";
import { type Segment, tcpTransfer, udpTransfer } from "./sim.ts";

const WHO = { client: "クライアント", server: "サーバー" } as const;

function describe(e: Segment): { title: string; log: string } {
  const nums = [
    e.seq !== undefined ? `seq=${e.seq}` : "",
    e.ack !== undefined ? `ack=${e.ack}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  switch (e.kind) {
    case "SYN":
      return { title: "接続を申し込む（SYN）", log: `${nums}。自分の番号の始まりを伝える` };
    case "SYN-ACK":
      return {
        title: "申し込みを受けて自分も申し込む（SYN-ACK）",
        log: `${nums}。ack は「次は ${e.ack} 番から欲しい」という意味`,
      };
    case "ACK":
      return { title: `${WHO[e.from]}が受け取りを確認する（ACK）`, log: `${nums}` };
    case "DATA":
      if (e.lost)
        return {
          title: `データ${e.segment}が途中で失われる`,
          log: `${nums} の区切りが相手に届かない`,
        };
      return {
        title: e.retransmit ? `データ${e.segment}を送り直す` : `データ${e.segment}を送る`,
        log: `${nums}（100バイト）`,
      };
    case "TIMEOUT":
      return {
        title: "確認応答が来ないまま時間切れになる",
        log: `データ${e.segment}の ACK が来ないので、同じ番号で送り直すと決める`,
      };
    case "FIN":
      return { title: `${WHO[e.from]}が送信の終わりを伝える（FIN）`, log: nums };
    case "DATAGRAM":
      return e.lost
        ? {
            title: `データグラム${e.segment}が失われる`,
            log: "UDPは届いたかどうかを確かめないので、送った側は気づかない",
          }
        : { title: `データグラム${e.segment}を送る`, log: "接続手続きなしで、いきなり送る" };
  }
}

function toSteps(events: Segment[]): Step[] {
  const received: number[] = [];
  return events.map((e) => {
    const { title, log } = describe(e);
    if (e.kind === "TIMEOUT") {
      return {
        title,
        log,
        status: "wait",
        focus: ["client"],
        state: { client: "再送タイマーが切れた" },
      };
    }
    const to = e.from === "client" ? "server" : "client";
    if ((e.kind === "DATA" || e.kind === "DATAGRAM") && !e.lost) received.push(e.segment!);
    const step: Step = {
      title,
      log,
      from: e.from,
      to,
      packet: e.kind === "DATA" || e.kind === "DATAGRAM" ? `#${e.segment}` : e.kind,
      focus: [to],
      state: { server: `受け取った区切り: ${received.join(", ") || "なし"}`, client: "" },
    };
    if (e.lost) step.status = "fail";
    return step;
  });
}

function summary(delivered: number[], sent: number, retransmits: number): Step {
  return {
    title: "アプリケーションに渡った結果",
    log: `${sent}個中 ${delivered.length}個（${delivered.join(", ")}）が届いた。送り直し ${retransmits}回`,
    focus: ["server"],
    status: delivered.length === sent ? "ok" : "fail",
  };
}

function scenario(id: string, label: string, kind: "tcp" | "udp", lose: number[]): Scenario {
  const result =
    kind === "tcp" ? tcpTransfer({ segments: 3, lose }) : udpTransfer({ datagrams: 3, lose });
  const retransmits = result.events.filter((e) => e.retransmit).length;
  return {
    id,
    label,
    steps: [...toSteps(result.events), summary(result.delivered, 3, retransmits)],
  };
}

export const ch03: Chapter = {
  id: "ch03",
  title: "TCPとUDP",
  nodes: [
    { id: "client", label: "クライアント", kind: "client", pos: [-5, 0.5, 0] },
    { id: "server", label: "サーバー", kind: "server", pos: [5, 0.8, 0] },
  ],
  scenarios: [
    scenario("tcp", "TCP（損失なし）", "tcp", []),
    scenario("tcp-loss", "TCP（2番目が失われる）", "tcp", [2]),
    scenario("udp-loss", "UDP（2番目が失われる）", "udp", [2]),
  ],
};
