import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, isIdempotent, isSafe, proxyRequest } from "./sim.ts";

test("ステータスコードは先頭の桁で5つのクラスに分かれる", () => {
  assert.equal(classify(101).label, "情報");
  assert.equal(classify(200).label, "成功");
  assert.equal(classify(301).label, "リダイレクト");
  assert.equal(classify(404).label, "クライアントエラー");
  assert.equal(classify(503).label, "サーバーエラー");
});

test("境界値: 100と599は有効、99と600と小数は無効", () => {
  assert.equal(classify(100).label, "情報");
  assert.equal(classify(599).label, "サーバーエラー");
  for (const bad of [99, 600, 200.5]) assert.throws(() => classify(bad), /100〜599/);
});

test("知らないコードでもクラスの x00 として扱える（471 は 400 扱い）", () => {
  assert.equal(classify(471).treatAs, 400);
});

test("GETとHEADは安全、PUTとDELETEは安全ではないがべき等、POSTはどちらでもない", () => {
  assert.equal(isSafe("GET"), true);
  assert.equal(isSafe("HEAD"), true);
  assert.equal(isSafe("PUT"), false);
  assert.equal(isIdempotent("PUT"), true);
  assert.equal(isIdempotent("DELETE"), true);
  assert.equal(isIdempotent("GET"), true);
  assert.equal(isSafe("POST"), false);
  assert.equal(isIdempotent("POST"), false);
  assert.throws(() => isSafe("FETCH"), /メソッド/);
});

test("アプリの返したステータスはプロキシがそのまま中継する", () => {
  assert.deepEqual(proxyRequest({ upstream: "ok", timeoutSec: 60 }), {
    status: 200,
    madeBy: "app",
  });
  assert.deepEqual(proxyRequest({ upstream: "not-found", timeoutSec: 60 }), {
    status: 404,
    madeBy: "app",
  });
  assert.deepEqual(proxyRequest({ upstream: "app-error", timeoutSec: 60 }), {
    status: 500,
    madeBy: "app",
  });
});

test("アプリにつながらない、または壊れた応答なら、プロキシ自身が502を作る", () => {
  assert.deepEqual(proxyRequest({ upstream: "down", timeoutSec: 60 }), {
    status: 502,
    madeBy: "proxy",
  });
  assert.deepEqual(proxyRequest({ upstream: "malformed", timeoutSec: 60 }), {
    status: 502,
    madeBy: "proxy",
  });
});

test("アプリの応答が待ち時間を超えたらプロキシ自身が504を作る。ちょうど同じなら間に合う", () => {
  assert.deepEqual(proxyRequest({ upstream: "slow", responseSec: 61, timeoutSec: 60 }), {
    status: 504,
    madeBy: "proxy",
  });
  assert.deepEqual(proxyRequest({ upstream: "slow", responseSec: 60, timeoutSec: 60 }), {
    status: 200,
    madeBy: "app",
  });
});

test("RFC 9110 で定義された8つのメソッドの性質がすべて表のとおりになる", () => {
  const expected: [string, boolean, boolean][] = [
    ["GET", true, true],
    ["HEAD", true, true],
    ["OPTIONS", true, true],
    ["TRACE", true, true],
    ["PUT", false, true],
    ["DELETE", false, true],
    ["POST", false, false],
    ["CONNECT", false, false],
  ];
  for (const [name, safe, idempotent] of expected) {
    assert.deepEqual([isSafe(name), isIdempotent(name)], [safe, idempotent], name);
  }
});
