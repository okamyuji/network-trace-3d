import type { Chapter, Scenario, Step } from "../../core/types.ts";
import { type Cert, type TlsError, connectTls, verifyChain } from "./sim.ts";

const root: Cert = { subject: "Example Root CA", issuer: "Example Root CA", names: [], notBefore: "2020-01-01", notAfter: "2040-01-01" };
const mid: Cert = { subject: "Example Intermediate CA", issuer: "Example Root CA", names: [], notBefore: "2024-01-01", notAfter: "2030-01-01" };
const leaf: Cert = { subject: "shop.example", issuer: "Example Intermediate CA", names: ["shop.example", "*.shop.example"], notBefore: "2026-08-01", notAfter: "2026-10-30" };
const NOW = "2026-10-02";

const NODE_OF: Record<string, string> = { "shop.example": "server", "Example Intermediate CA": "mid", "Example Root CA": "root" };

const MESSAGE: Record<TlsError, string> = {
  "unknown-issuer": "発行者をたどれない（中間証明書が届いていない、またはルートを信頼していない）",
  expired: "有効期限が切れている",
  "not-yet-valid": "有効期間がまだ始まっていない",
  "name-mismatch": "証明書の名前とアクセス先のホスト名が一致しない",
};

function build(id: string, label: string, opts: { sent: Cert[]; host?: string; now?: string; verify?: boolean }): Scenario {
  const host = opts.host ?? "shop.example";
  const now = opts.now ?? NOW;
  const verify = opts.verify ?? true;
  const input = { sent: opts.sent, host, now, trust: [root] };
  const result = connectTls({ ...input, verify });
  const chainText = opts.sent.map((c, i) => `${i + 1}. ${c.subject}（〜${c.notAfter}）`).join("\n");
  const steps: Step[] = [
    { title: `${host} に TLS 接続を始める（ClientHello）`, log: `時刻 ${now}。対応する暗号方式と、接続したいホスト名を伝える`, from: "client", to: "server", packet: "ClientHello", focus: ["server"], state: { client: "信頼するルート:\nExample Root CA" } },
    { title: "サーバーが証明書の束を送る", log: `送られてきた順: ${opts.sent.map((c) => c.subject).join(" → ")}`, from: "server", to: "client", packet: "Certificate", focus: ["client"], state: { server: chainText } },
  ];
  if (verify) {
    const v = verifyChain(input);
    steps.push({ title: "名前を照合する", log: `証明書の名前 ${leaf.names.join(", ")} とアクセス先 ${host} を比べる`, focus: ["client", "server"] });
    for (const subject of v.path) {
      const node = NODE_OF[subject]!;
      steps.push({ title: `${subject} を確かめる`, log: "発行者の署名と有効期間を、クライアントの中で確かめる（CAには問い合わせない）", focus: [node], state: { [node]: "確認済み" } });
    }
    if (!v.ok) {
      const node = NODE_OF[v.path.at(-1) ?? "shop.example"]!;
      steps.push({ title: "検証に失敗して接続を中止する", log: MESSAGE[v.error!], status: "fail", focus: [node], state: { [node]: `NG: ${v.error}` } });
      return { id, label, steps };
    }
  } else {
    steps.push({ title: "検証を省く（curl -k）", log: "証明書が正しいかを確かめずに先へ進む", status: "wait", focus: ["client"], state: { client: "検証しない" } });
  }
  steps.push({ title: "鍵を共有し、暗号化した通信が始まる", log: `暗号化: ${result.encrypted ? "あり" : "なし"} / 相手の確認: ${result.authenticated ? "済み" : "していない"}`, from: "client", to: "server", packet: "GET /（暗号化）", status: result.authenticated ? "ok" : "wait", focus: ["server"] });
  return { id, label, steps };
}

export const ch07: Chapter = {
  id: "ch07",
  title: "HTTPSと証明書",
  nodes: [
    { id: "client", label: "ブラウザ / curl", kind: "client", pos: [-6, 0.5, 0] },
    { id: "server", label: "shop.example", kind: "server", pos: [2, 0.8, 0] },
    { id: "mid", label: "中間CA", kind: "ca", pos: [6, 1.5, -3] },
    { id: "root", label: "ルートCA", kind: "ca", pos: [6, 3.5, 3] },
  ],
  scenarios: [
    build("ok", "正しい設定", { sent: [leaf, mid] }),
    build("missing-mid", "中間証明書の設定漏れ", { sent: [leaf] }),
    build("expired", "有効期限切れ", { sent: [leaf, mid], now: "2026-10-31" }),
    build("name", "名前の不一致", { sent: [leaf, mid], host: "admin.example" }),
    build("insecure", "検証を省く（暗号化だけ）", { sent: [leaf], verify: false }),
  ],
};
