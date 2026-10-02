export type Side = "client" | "server";

export interface Segment {
  from: Side;
  kind: "SYN" | "SYN-ACK" | "ACK" | "DATA" | "FIN" | "TIMEOUT" | "DATAGRAM";
  seq?: number;
  ack?: number;
  segment?: number;
  lost?: boolean;
  retransmit?: boolean;
}

export interface TransferResult {
  events: Segment[];
  /** 受け手のアプリケーションに渡った区切りの番号（1始まり） */
  delivered: number[];
}

// 番号の初期値は RFC 9293 の図と同じ 100 と 300 にそろえる。実際の実装は推測されにくい値を選ぶ。
const CLIENT_ISN = 100;
const SERVER_ISN = 300;
const BYTES = 100;

function validate(count: number, lose: number[]): void {
  if (!Number.isInteger(count) || count < 1) throw new Error(`送る数は1以上の整数で指定します: ${count}`);
  for (const n of lose) {
    if (!Number.isInteger(n) || n < 1 || n > count) throw new Error(`失う番号が範囲外です: ${n}（1〜${count}）`);
  }
}

/**
 * 1区切りずつ確認応答を待つ単純化したTCP。実際のTCPは複数の区切りをまとめて送れるが、
 * 「失われたら送り直す」という動きを1つずつ追えるように、ここでは待ってから次を送る。
 */
export function tcpTransfer({ segments, lose }: { segments: number; lose: number[] }): TransferResult {
  validate(segments, lose);
  const events: Segment[] = [
    { from: "client", kind: "SYN", seq: CLIENT_ISN },
    { from: "server", kind: "SYN-ACK", seq: SERVER_ISN, ack: CLIENT_ISN + 1 },
    { from: "client", kind: "ACK", seq: CLIENT_ISN + 1, ack: SERVER_ISN + 1 },
  ];
  const delivered: number[] = [];
  let next = CLIENT_ISN + 1;
  for (let i = 1; i <= segments; i++) {
    if (lose.includes(i)) {
      events.push({ from: "client", kind: "DATA", seq: next, segment: i, lost: true });
      events.push({ from: "client", kind: "TIMEOUT", segment: i });
      events.push({ from: "client", kind: "DATA", seq: next, segment: i, retransmit: true });
    } else {
      events.push({ from: "client", kind: "DATA", seq: next, segment: i });
    }
    next += BYTES;
    delivered.push(i);
    events.push({ from: "server", kind: "ACK", seq: SERVER_ISN + 1, ack: next });
  }
  events.push(
    { from: "client", kind: "FIN", seq: next },
    { from: "server", kind: "ACK", seq: SERVER_ISN + 1, ack: next + 1 },
    { from: "server", kind: "FIN", seq: SERVER_ISN + 1 },
    { from: "client", kind: "ACK", seq: next + 1, ack: SERVER_ISN + 2 },
  );
  return { events, delivered };
}

export function udpTransfer({ datagrams, lose }: { datagrams: number; lose: number[] }): TransferResult {
  validate(datagrams, lose);
  const events: Segment[] = [];
  const delivered: number[] = [];
  for (let i = 1; i <= datagrams; i++) {
    const lost = lose.includes(i);
    events.push({ from: "client", kind: "DATAGRAM", segment: i, ...(lost ? { lost } : {}) });
    if (!lost) delivered.push(i);
  }
  return { events, delivered };
}
