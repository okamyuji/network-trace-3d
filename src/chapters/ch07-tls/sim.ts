export interface Cert {
  subject: string;
  issuer: string;
  /** サブジェクト代替名（SAN）に書かれたホスト名 */
  names: string[];
  /** YYYY-MM-DD。日単位に単純化している */
  notBefore: string;
  notAfter: string;
}

export type TlsError = "unknown-issuer" | "expired" | "not-yet-valid" | "name-mismatch";

export interface VerifyResult {
  ok: boolean;
  error?: TlsError;
  path: string[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 9525 6.3 に沿い、ワイルドカードは左端の1ラベルだけを置き換える */
export function matchesHost(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase().split(".");
  const h = host.toLowerCase().split(".");
  if (p.length !== h.length) return false;
  return p.every((label, i) => label === h[i] || (i === 0 && label === "*"));
}

export function verifyChain(input: {
  sent: Cert[];
  host: string;
  now: string;
  trust: Cert[];
}): VerifyResult {
  const { sent, host, now, trust } = input;
  if (!DATE.test(now)) throw new Error(`日付は YYYY-MM-DD で指定します: ${now}`);
  const path: string[] = [];
  let cert: Cert | undefined = sent[0];
  if (!cert) return { ok: false, error: "unknown-issuer", path };
  if (!cert.names.some((n) => matchesHost(n, host)))
    return { ok: false, error: "name-mismatch", path: [cert.subject] };
  for (;;) {
    path.push(cert.subject);
    if (now < cert.notBefore) return { ok: false, error: "not-yet-valid", path };
    if (now > cert.notAfter) return { ok: false, error: "expired", path };
    const anchor = trust.find((t) => t.subject === cert!.issuer);
    if (anchor) {
      if (anchor.subject !== cert.subject) path.push(anchor.subject);
      return { ok: true, path };
    }
    const next: Cert | undefined = sent.find((c) => c.subject === cert!.issuer && c !== cert);
    if (!next) return { ok: false, error: "unknown-issuer", path };
    cert = next;
  }
}

/** 検証を省く（curl の -k に相当）と、暗号化はされるが相手の確認は行われない */
export function connectTls(input: {
  sent: Cert[];
  host: string;
  now: string;
  trust: Cert[];
  verify: boolean;
}): {
  encrypted: boolean;
  authenticated: boolean;
  error: TlsError | null;
} {
  if (!input.verify) return { encrypted: true, authenticated: false, error: null };
  const r = verifyChain(input);
  return r.ok
    ? { encrypted: true, authenticated: true, error: null }
    : { encrypted: false, authenticated: false, error: r.error ?? null };
}
