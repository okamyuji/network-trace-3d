import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Host,
  type IptablesRule,
  connect,
  evaluateIptables,
  securityGroupAllows,
} from "./sim.ts";

const web: Host = {
  ip: "10.0.1.10",
  listening: [
    { addr: "0.0.0.0", port: 80 },
    { addr: "127.0.0.1", port: 5432 },
  ],
};
const allowAll = [{ port: 80 }, { port: 5432 }, { port: 8080 }];
const open: IptablesRule[] = [];

test("iptablesは上から順に照合し、最初に一致した規則で決まる", () => {
  const rules: IptablesRule[] = [
    { dport: 80, target: "ACCEPT" },
    { dport: 80, target: "DROP" },
  ];
  assert.deepEqual(evaluateIptables(rules, "ACCEPT", 80), { target: "ACCEPT", rule: 1 });
});

test("iptablesでどの規則にも一致しなければチェーンのポリシーで決まる", () => {
  assert.deepEqual(evaluateIptables([{ dport: 22, target: "ACCEPT" }], "DROP", 80), {
    target: "DROP",
    rule: null,
  });
});

test("セキュリティグループは許可規則のどれかに一致すれば通す", () => {
  assert.equal(securityGroupAllows([{ port: 22 }, { port: 80 }], 80), true);
  assert.equal(securityGroupAllows([{ port: 22 }], 80), false);
  assert.equal(securityGroupAllows([], 80), false);
});

test("許可されていて待ち受けているポートには接続できる", () => {
  const r = connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 80 });
  assert.equal(r.outcome, "connected");
  assert.equal(r.stoppedAt, "server");
});

test("待ち受けていないポートにはRSTが返り、すぐに接続拒否になる", () => {
  const r = connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 8080 });
  assert.equal(r.outcome, "refused");
  assert.equal(r.stoppedAt, "server");
});

test("127.0.0.1でだけ待ち受けるポートは、外からは待ち受けていないのと同じになる", () => {
  const r = connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 5432 });
  assert.equal(r.outcome, "refused");
  assert.match(r.reason, /127\.0\.0\.1/);
});

test("セキュリティグループで許可されていなければ応答がなく、時間切れになる", () => {
  const r = connect({ sg: [{ port: 22 }], iptables: open, policy: "ACCEPT", host: web, port: 80 });
  assert.equal(r.outcome, "timeout");
  assert.equal(r.stoppedAt, "sg");
});

test("iptablesのDROPは黙って捨てるので時間切れ、REJECTはRSTを返すので接続拒否になる", () => {
  const drop = connect({
    sg: allowAll,
    iptables: [{ dport: 80, target: "DROP" }],
    policy: "ACCEPT",
    host: web,
    port: 80,
  });
  assert.equal(drop.outcome, "timeout");
  assert.equal(drop.stoppedAt, "iptables");
  const reject = connect({
    sg: allowAll,
    iptables: [{ dport: 80, target: "REJECT" }],
    policy: "ACCEPT",
    host: web,
    port: 80,
  });
  assert.equal(reject.outcome, "refused");
  assert.equal(reject.stoppedAt, "iptables");
});

test("範囲外のポート番号はエラーにする", () => {
  for (const port of [0, 65536, 1.5, -1]) {
    assert.throws(
      () => connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port }),
      /ポート番号/,
    );
  }
  assert.doesNotThrow(() =>
    connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 65535 }),
  );
  assert.doesNotThrow(() =>
    connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 1 }),
  );
});

test("止まった理由には、どの規則か（行番号かポリシーか）とポートの状態が書かれる", () => {
  const byRule = connect({
    sg: allowAll,
    iptables: [
      { dport: 22, target: "ACCEPT" },
      { dport: 80, target: "DROP" },
    ],
    policy: "ACCEPT",
    host: web,
    port: 80,
  });
  assert.equal(byRule.reason, "iptables の2行目が DROP で、何も返さずに捨てた");
  const byPolicy = connect({ sg: allowAll, iptables: [], policy: "DROP", host: web, port: 80 });
  assert.equal(byPolicy.reason, "iptables のポリシーが DROP で、何も返さずに捨てた");
  assert.equal(
    connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 80 }).reason,
    "80番で待ち受けているプログラムが接続を受け付けた",
  );
  assert.equal(
    connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 5432 }).reason,
    "5432番は 127.0.0.1 でだけ待ち受けており、外から来た接続にはOSがRSTを返した",
  );
});

test("待ち受けていないポートの理由には、OSがRSTを返したことが書かれる", () => {
  assert.equal(
    connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 8080 }).reason,
    "8080番で待ち受けているプログラムがなく、OSがRSTを返した",
  );
});

test("127.0.0.1だけで待ち受けるポートの結果は、サーバーで拒否されたものとして返る", () => {
  assert.deepEqual(
    connect({ sg: allowAll, iptables: open, policy: "ACCEPT", host: web, port: 5432 }),
    {
      outcome: "refused",
      stoppedAt: "server",
      reason: "5432番は 127.0.0.1 でだけ待ち受けており、外から来た接続にはOSがRSTを返した",
    },
  );
});
