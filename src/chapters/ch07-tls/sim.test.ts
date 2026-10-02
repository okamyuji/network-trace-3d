import assert from "node:assert/strict";
import { test } from "node:test";
import { type Cert, connectTls, matchesHost, verifyChain } from "./sim.ts";

const root: Cert = { subject: "Example Root CA", issuer: "Example Root CA", names: [], notBefore: "2020-01-01", notAfter: "2040-01-01" };
const mid: Cert = { subject: "Example Intermediate CA", issuer: "Example Root CA", names: [], notBefore: "2024-01-01", notAfter: "2030-01-01" };
const leaf: Cert = { subject: "shop.example", issuer: "Example Intermediate CA", names: ["shop.example", "*.shop.example"], notBefore: "2026-08-01", notAfter: "2026-10-30" };
const trust = [root];
const NOW = "2026-10-02";

test("サーバー証明書→中間証明書→信頼するルートの順につながれば検証に成功する", () => {
  const r = verifyChain({ sent: [leaf, mid], host: "shop.example", now: NOW, trust });
  assert.deepEqual(r, { ok: true, path: ["shop.example", "Example Intermediate CA", "Example Root CA"] });
});

test("中間証明書を送り忘れると、発行者をたどれず失敗する", () => {
  const r = verifyChain({ sent: [leaf], host: "shop.example", now: NOW, trust });
  assert.equal(r.ok, false);
  assert.equal(r.error, "unknown-issuer");
});

test("有効期限を1日でも過ぎると失敗し、最終日はまだ有効", () => {
  assert.equal(verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026-10-30", trust }).ok, true);
  const r = verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026-10-31", trust });
  assert.equal(r.error, "expired");
});

test("有効期間の開始前も失敗する", () => {
  assert.equal(verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026-07-31", trust }).error, "not-yet-valid");
});

test("証明書の名前とアクセス先が違えば失敗する", () => {
  assert.equal(verifyChain({ sent: [leaf, mid], host: "admin.example", now: NOW, trust }).error, "name-mismatch");
});

test("ワイルドカードは左端の1ラベルだけに一致する", () => {
  assert.equal(matchesHost("*.shop.example", "api.shop.example"), true);
  assert.equal(matchesHost("*.shop.example", "a.b.shop.example"), false);
  assert.equal(matchesHost("*.shop.example", "shop.example"), false);
  assert.equal(matchesHost("shop.example", "SHOP.example"), true);
});

test("信頼ストアにないルートで終わるチェーンは失敗する", () => {
  assert.equal(verifyChain({ sent: [leaf, mid], host: "shop.example", now: NOW, trust: [] }).error, "unknown-issuer");
});

test("検証を省いても暗号化はされるが、相手が本物かは確かめられていない", () => {
  const skipped = connectTls({ sent: [leaf], host: "shop.example", now: NOW, trust, verify: false });
  assert.deepEqual(skipped, { encrypted: true, authenticated: false, error: null });
  const checked = connectTls({ sent: [leaf], host: "shop.example", now: NOW, trust, verify: true });
  assert.deepEqual(checked, { encrypted: false, authenticated: false, error: "unknown-issuer" });
  const good = connectTls({ sent: [leaf, mid], host: "shop.example", now: NOW, trust, verify: true });
  assert.deepEqual(good, { encrypted: true, authenticated: true, error: null });
});

test("日付の形が崩れていればエラーにする", () => {
  assert.throws(() => verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026/10/02", trust }), /日付/);
});

test("日付の前後に余計な文字があればエラーにする", () => {
  for (const now of ["x2026-10-02", "2026-10-022"]) {
    assert.throws(() => verifyChain({ sent: [leaf, mid], host: "shop.example", now, trust }), /日付/);
  }
});

test("ラベルの数が違えば、前の部分が一致していても一致としない", () => {
  assert.equal(matchesHost("shop.example", "shop.example.attacker"), false);
  assert.equal(matchesHost("api.*.example", "api.shop.example"), false);
});

test("証明書が1枚も届かなければ失敗する", () => {
  assert.deepEqual(verifyChain({ sent: [], host: "shop.example", now: NOW, trust }), { ok: false, error: "unknown-issuer", path: [] });
});

test("失敗したときは、どこまでたどれたかも返す", () => {
  assert.deepEqual(verifyChain({ sent: [leaf, mid], host: "admin.example", now: NOW, trust }), { ok: false, error: "name-mismatch", path: ["shop.example"] });
  assert.deepEqual(verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026-10-31", trust }), { ok: false, error: "expired", path: ["shop.example"] });
  assert.deepEqual(verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026-07-31", trust }), { ok: false, error: "not-yet-valid", path: ["shop.example"] });
});

test("有効期間の初日はもう有効", () => {
  assert.equal(verifyChain({ sent: [leaf, mid], host: "shop.example", now: "2026-08-01", trust }).ok, true);
});

test("信頼ストアに入れた自己署名証明書は、それ自体が信頼の起点になる", () => {
  const self: Cert = { subject: "intra.example", issuer: "intra.example", names: ["intra.example"], notBefore: "2026-01-01", notAfter: "2027-01-01" };
  assert.deepEqual(verifyChain({ sent: [self], host: "intra.example", now: NOW, trust: [self] }), { ok: true, path: ["intra.example"] });
  assert.equal(verifyChain({ sent: [self], host: "intra.example", now: NOW, trust }).error, "unknown-issuer");
});
