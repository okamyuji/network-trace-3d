import assert from "node:assert/strict";
import { test } from "node:test";
import { appendXff, createBalancer } from "./sim.ts";

test("X-Forwarded-For がなければ作り、あれば末尾に追記する", () => {
  assert.equal(appendXff(undefined, "203.0.113.7"), "203.0.113.7");
  assert.equal(appendXff("198.51.100.1", "203.0.113.7"), "198.51.100.1, 203.0.113.7");
});

test("ロードバランサは振り分け先を順番に回す", () => {
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a", "b", "c"],
    unhealthyThreshold: 2,
    healthyThreshold: 2,
  });
  assert.deepEqual(
    [1, 2, 3, 4].map(() => lb.forward("203.0.113.7").target),
    ["a", "b", "c", "a"],
  );
});

test("アプリのログに残る送信元はロードバランサのIPアドレスで、元のIPアドレスは X-Forwarded-For に入る", () => {
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a"],
    unhealthyThreshold: 2,
    healthyThreshold: 2,
  });
  const seen = ["203.0.113.7", "198.51.100.23"].map((ip) => lb.forward(ip));
  assert.deepEqual(
    seen.map((s) => s.remoteAddr),
    ["10.0.0.5", "10.0.0.5"],
  );
  assert.deepEqual(
    seen.map((s) => s.xff),
    ["203.0.113.7", "198.51.100.23"],
  );
});

test("ヘルスチェックに続けて閾値回失敗した振り分け先は外され、1回だけなら外れない", () => {
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a", "b"],
    unhealthyThreshold: 2,
    healthyThreshold: 2,
  });
  lb.healthCheck("b", false);
  assert.deepEqual(lb.inService(), ["a", "b"]);
  lb.healthCheck("b", false);
  assert.deepEqual(lb.inService(), ["a"]);
  assert.deepEqual(
    [1, 2, 3].map(() => lb.forward("203.0.113.7").target),
    ["a", "a", "a"],
  );
});

test("途中で成功すると失敗の連続回数は数え直しになる", () => {
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a", "b"],
    unhealthyThreshold: 2,
    healthyThreshold: 2,
  });
  lb.healthCheck("b", false);
  lb.healthCheck("b", true);
  lb.healthCheck("b", false);
  assert.deepEqual(lb.inService(), ["a", "b"]);
});

test("外された振り分け先は続けて閾値回成功すると戻る", () => {
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a", "b"],
    unhealthyThreshold: 2,
    healthyThreshold: 2,
  });
  lb.healthCheck("b", false);
  lb.healthCheck("b", false);
  lb.healthCheck("b", true);
  assert.deepEqual(lb.inService(), ["a"]);
  lb.healthCheck("b", true);
  assert.deepEqual(lb.inService(), ["a", "b"]);
});

test("全部が不健全になったら、全部に振り分ける（fail open）", () => {
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a", "b"],
    unhealthyThreshold: 1,
    healthyThreshold: 1,
  });
  lb.healthCheck("a", false);
  lb.healthCheck("b", false);
  assert.deepEqual(lb.inService(), []);
  assert.deepEqual(
    [1, 2].map(() => lb.forward("203.0.113.7").target),
    ["a", "b"],
  );
});

test("未登録の振り分け先や1未満の閾値はエラーにする", () => {
  assert.throws(
    () =>
      createBalancer({
        ip: "10.0.0.5",
        targets: ["a"],
        unhealthyThreshold: 0,
        healthyThreshold: 2,
      }),
    /閾値/,
  );
  assert.throws(
    () =>
      createBalancer({ ip: "10.0.0.5", targets: [], unhealthyThreshold: 2, healthyThreshold: 2 }),
    /振り分け先/,
  );
  const lb = createBalancer({
    ip: "10.0.0.5",
    targets: ["a"],
    unhealthyThreshold: 2,
    healthyThreshold: 2,
  });
  assert.throws(() => lb.healthCheck("z", true), /登録/);
});

test("復帰側の閾値が0でもエラーにする", () => {
  assert.throws(
    () =>
      createBalancer({
        ip: "10.0.0.5",
        targets: ["a"],
        unhealthyThreshold: 2,
        healthyThreshold: 0,
      }),
    /閾値/,
  );
});
