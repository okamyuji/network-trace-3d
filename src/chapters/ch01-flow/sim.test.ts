import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPage, parseTarget } from "./sim.ts";

test("URLからスキーム、ホスト名、ポート、パスを取り出し、省略されたポートを補う", () => {
  assert.deepEqual(parseTarget("https://shop.example/orders?id=1"), {
    scheme: "https",
    host: "shop.example",
    port: 443,
    path: "/orders?id=1",
  });
  assert.deepEqual(parseTarget("http://shop.example"), {
    scheme: "http",
    host: "shop.example",
    port: 80,
    path: "/",
  });
  assert.equal(parseTarget("https://shop.example:8443/").port, 8443);
});

test("http と https 以外のURLや壊れたURLはエラーにする", () => {
  assert.throws(() => parseTarget("ftp://shop.example/"), /http/);
  assert.throws(() => parseTarget("shop.example"), /URL/);
});

test("httpsでは名前解決→TCP接続→TLS→HTTP→描画の順に進む", () => {
  const r = loadPage("https://shop.example/", {});
  assert.deepEqual(
    r.phases.map((p) => p.phase),
    ["dns", "tcp", "tls", "http", "render"],
  );
  assert.ok(r.phases.every((p) => p.ok));
  assert.equal(r.failedAt, null);
});

test("httpではTLSの段階がない", () => {
  const r = loadPage("http://shop.example/", {});
  assert.deepEqual(
    r.phases.map((p) => p.phase),
    ["dns", "tcp", "http", "render"],
  );
});

test("途中で失敗するとそこで止まり、後ろの段階には進まない", () => {
  const r = loadPage("https://shop.example/", { fail: "tcp" });
  assert.deepEqual(
    r.phases.map((p) => [p.phase, p.ok]),
    [
      ["dns", true],
      ["tcp", false],
    ],
  );
  assert.equal(r.failedAt, "tcp");
});

test("httpのURLでTLSの失敗を指定してもTLSの段階はないので最後まで進む", () => {
  assert.equal(loadPage("http://shop.example/", { fail: "tls" }).failedAt, null);
});
