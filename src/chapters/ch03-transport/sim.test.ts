import assert from "node:assert/strict";
import { test } from "node:test";
import { tcpTransfer, udpTransfer } from "./sim.ts";

test("TCPは3回のやり取り（SYN, SYN-ACK, ACK）で接続を始め、SYNが番号を1つ消費する", () => {
  const { events } = tcpTransfer({ segments: 1, lose: [] });
  const head = events.slice(0, 3).map((e) => [e.from, e.kind, e.seq, e.ack]);
  assert.deepEqual(head, [
    ["client", "SYN", 100, undefined],
    ["server", "SYN-ACK", 300, 101],
    ["client", "ACK", 101, 301],
  ]);
});

test("TCPの確認応答番号は「次に欲しいバイト位置」を表す", () => {
  const { events } = tcpTransfer({ segments: 2, lose: [] });
  const data = events.filter((e) => e.kind === "DATA");
  const acks = events.filter((e) => e.kind === "ACK" && e.from === "server");
  assert.deepEqual(
    data.map((d) => d.seq),
    [101, 201],
  );
  assert.deepEqual(
    acks.slice(0, 2).map((a) => a.ack),
    [201, 301],
  );
});

test("TCPは失われた区切りをタイムアウト後に送り直し、受け手には全部が順に届く", () => {
  const result = tcpTransfer({ segments: 3, lose: [2] });
  assert.deepEqual(result.delivered, [1, 2, 3]);
  const lost = result.events.filter((e) => e.lost);
  assert.equal(lost.length, 1);
  assert.equal(lost[0]?.segment, 2);
  const retrans = result.events.filter((e) => e.kind === "DATA" && e.retransmit);
  assert.deepEqual(
    retrans.map((e) => e.segment),
    [2],
  );
  assert.ok(result.events.some((e) => e.kind === "TIMEOUT"));
});

test("TCPは最後にFINを双方向で交わして接続を閉じる", () => {
  const { events } = tcpTransfer({ segments: 1, lose: [] });
  assert.deepEqual(
    events.slice(-4).map((e) => `${e.from}:${e.kind}`),
    ["client:FIN", "server:ACK", "server:FIN", "client:ACK"],
  );
});

test("UDPは失われたデータグラムを送り直さず、受け手には残りだけが届く", () => {
  const result = udpTransfer({ datagrams: 3, lose: [2] });
  assert.deepEqual(result.delivered, [1, 3]);
  assert.equal(result.events.length, 3);
  assert.ok(result.events.every((e) => e.kind === "DATAGRAM"));
});

test("損失がなければUDPも全部届き、接続手続きは発生しない", () => {
  const result = udpTransfer({ datagrams: 2, lose: [] });
  assert.deepEqual(result.delivered, [1, 2]);
  assert.ok(!result.events.some((e) => e.kind === "SYN"));
});

test("存在しない番号の損失指定や0件の送信はエラーにする", () => {
  assert.throws(() => tcpTransfer({ segments: 0, lose: [] }), /1以上/);
  assert.throws(() => tcpTransfer({ segments: 2, lose: [3] }), /範囲/);
  assert.throws(() => udpTransfer({ datagrams: 2, lose: [0] }), /範囲/);
});

test("最初と最後の区切りも失う番号として指定できる", () => {
  assert.deepEqual(tcpTransfer({ segments: 3, lose: [1, 3] }).delivered, [1, 2, 3]);
  assert.deepEqual(udpTransfer({ datagrams: 3, lose: [1, 3] }).delivered, [2]);
});

test("時間切れはクライアント側の出来事として記録され、終了時の番号は送ったバイト数を反映する", () => {
  const { events } = tcpTransfer({ segments: 1, lose: [1] });
  assert.deepEqual(
    events.find((e) => e.kind === "TIMEOUT"),
    { from: "client", kind: "TIMEOUT", segment: 1 },
  );
  assert.deepEqual(events.slice(-5), [
    { from: "server", kind: "ACK", seq: 301, ack: 201 },
    { from: "client", kind: "FIN", seq: 201 },
    { from: "server", kind: "ACK", seq: 301, ack: 202 },
    { from: "server", kind: "FIN", seq: 301 },
    { from: "client", kind: "ACK", seq: 202, ack: 302 },
  ]);
});

test("UDPで失われたデータグラムには lost の印が付く", () => {
  const { events } = udpTransfer({ datagrams: 2, lose: [2] });
  assert.deepEqual(events, [
    { from: "client", kind: "DATAGRAM", segment: 1 },
    { from: "client", kind: "DATAGRAM", segment: 2, lost: true },
  ]);
});
