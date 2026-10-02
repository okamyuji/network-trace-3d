import assert from "node:assert/strict";
import { test } from "node:test";
import { type Authority, createResolver } from "./sim.ts";

function world(ip = "203.0.113.10"): Authority[] {
  return [
    { server: "root", zone: ".", delegations: { "com.": { server: "tld", ttl: 172800 } }, records: {} },
    { server: "tld", zone: "com.", delegations: { "example.com.": { server: "auth", ttl: 86400 } }, records: {} },
    { server: "auth", zone: "example.com.", delegations: {}, records: { "www.example.com.": { ip, ttl: 300 } } },
  ];
}

test("キャッシュが空なら、ルート→TLD→権威サーバーの順にたどって答えを得る", () => {
  const r = createResolver(world()).resolve("www.example.com.", 0);
  assert.equal(r.ip, "203.0.113.10");
  assert.equal(r.fromCache, false);
  assert.deepEqual(r.asked, ["root", "tld", "auth"]);
  assert.equal(r.ttl, 300);
});

test("TTLの間はキャッシュから答え、残りTTLは経過時間だけ減る", () => {
  const resolver = createResolver(world());
  resolver.resolve("www.example.com.", 0);
  const r = resolver.resolve("www.example.com.", 60);
  assert.equal(r.fromCache, true);
  assert.deepEqual(r.asked, []);
  assert.equal(r.ttl, 240);
});

test("TTLちょうどで期限切れになり、委任情報のキャッシュを使って権威サーバーだけに聞き直す", () => {
  const resolver = createResolver(world());
  resolver.resolve("www.example.com.", 0);
  assert.equal(resolver.resolve("www.example.com.", 299).fromCache, true);
  const r = resolver.resolve("www.example.com.", 300);
  assert.equal(r.fromCache, false);
  assert.deepEqual(r.asked, ["auth"]);
});

test("権威サーバーの値を変えても、TTLが切れるまでは古い値が返る", () => {
  const zones = world();
  const resolver = createResolver(zones);
  resolver.resolve("www.example.com.", 0);
  zones[2]!.records["www.example.com."] = { ip: "203.0.113.20", ttl: 300 };
  assert.equal(resolver.resolve("www.example.com.", 100).ip, "203.0.113.10");
  assert.equal(resolver.resolve("www.example.com.", 300).ip, "203.0.113.20");
});

test("TTLが0のレコードはキャッシュしない", () => {
  const zones = world();
  zones[2]!.records["www.example.com."] = { ip: "203.0.113.10", ttl: 0 };
  const resolver = createResolver(zones);
  resolver.resolve("www.example.com.", 0);
  assert.equal(resolver.resolve("www.example.com.", 0).fromCache, false);
});

test("存在しない名前は NXDOMAIN として返す", () => {
  const r = createResolver(world()).resolve("nope.example.com.", 0);
  assert.equal(r.ip, null);
  assert.equal(r.rcode, "NXDOMAIN");
});

test("末尾のドットがない名前や時刻の巻き戻しはエラーにする", () => {
  const resolver = createResolver(world());
  assert.throws(() => resolver.resolve("www.example.com", 0), /ドット/);
  resolver.resolve("www.example.com.", 10);
  assert.throws(() => resolver.resolve("www.example.com.", 5), /時刻/);
});

test("答えは NOERROR として返り、キャッシュから答えたときも同じ", () => {
  const resolver = createResolver(world());
  assert.equal(resolver.resolve("www.example.com.", 0).rcode, "NOERROR");
  assert.equal(resolver.resolve("www.example.com.", 1).rcode, "NOERROR");
});

test("NXDOMAIN はキャッシュからではなく、たどった結果として返る", () => {
  const r = createResolver(world()).resolve("nope.example.com.", 0);
  assert.deepEqual(r, { ip: null, rcode: "NXDOMAIN", fromCache: false, asked: ["root", "tld", "auth"], ttl: 0 });
});

test("ゾーンの頂点の名前（example.com. そのもの）も引ける", () => {
  const zones = world();
  zones[2]!.records["example.com."] = { ip: "203.0.113.30", ttl: 60 };
  assert.equal(createResolver(zones).resolve("example.com.", 0).ip, "203.0.113.30");
});

test("委任情報が期限切れなら、まだ期限内の上位の委任から始める", () => {
  const resolver = createResolver(world());
  resolver.resolve("www.example.com.", 0);
  assert.deepEqual(resolver.resolve("www.example.com.", 86400).asked, ["tld", "auth"]);
  assert.deepEqual(resolver.resolve("www.example.com.", 172800).asked, ["root", "tld", "auth"]);
});

test("覚えている委任が名前に関係なければ使わない", () => {
  const resolver = createResolver(world());
  resolver.resolve("www.example.com.", 0);
  assert.deepEqual(resolver.resolve("www.other.com.", 1).asked, ["tld"]);
});

test("委任先のサーバーが定義されていなければエラーにする", () => {
  const zones = world();
  zones[1]!.delegations["example.com."] = { server: "ghost", ttl: 60 };
  assert.throws(() => createResolver(zones).resolve("www.example.com.", 0), /ghost/);
});
