// 出力の文言は macOS 上の curl 8.7.1 / ping / dig 9.10.6 で実際に表示されたものに合わせている

export interface World {
  host: string;
  ip: string;
  dns: "ok" | "nxdomain";
  hostUp: boolean;
  icmpAllowed: boolean;
  /** filtered は途中で黙って捨てられる状態（DROP やセキュリティグループで不許可） */
  port: "open" | "closed" | "filtered";
  cert: "ok" | "expired";
  status: number;
}

export interface ToolResult {
  ok: boolean;
  exitCode: number;
  output: string;
}

export interface CurlResult extends ToolResult {
  exitCode: 0 | 6 | 7 | 28 | 60;
}

const CONNECT_TIMEOUT_MS = 10000;

const REASON: Record<number, string> = { 200: "OK", 404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout" };

export function dig(w: World): ToolResult {
  const ok = w.dns === "ok";
  const lines = [`;; ->>HEADER<<- opcode: QUERY, status: ${ok ? "NOERROR" : "NXDOMAIN"}`];
  if (ok) lines.push(";; ANSWER SECTION:", `${w.host}.\t300\tIN\tA\t${w.ip}`);
  return { ok, exitCode: 0, output: lines.join("\n") };
}

export function ping(w: World): ToolResult {
  if (w.dns !== "ok") return { ok: false, exitCode: 68, output: `ping: cannot resolve ${w.host}: Unknown host` };
  const replied = w.hostUp && w.icmpAllowed;
  const output = [
    `--- ${w.host} ping statistics ---`,
    replied ? "3 packets transmitted, 3 packets received, 0.0% packet loss" : "3 packets transmitted, 0 packets received, 100.0% packet loss",
  ].join("\n");
  return { ok: replied, exitCode: replied ? 0 : 2, output };
}

export function curl(w: World): CurlResult {
  const where = `${w.host} port 443`;
  if (w.dns !== "ok") {
    return { ok: false, exitCode: 6, output: `* Could not resolve host: ${w.host}\ncurl: (6) Could not resolve host: ${w.host}` };
  }
  const head = [`* Host ${w.host}:443 was resolved.`, `* IPv4: ${w.ip}`, `*   Trying ${w.ip}:443...`];
  if (!w.hostUp || w.port === "filtered") {
    const msg = `Failed to connect to ${where} after ${CONNECT_TIMEOUT_MS + 2} ms: Timeout was reached`;
    return { ok: false, exitCode: 28, output: [...head, `* ${msg}`, `curl: (28) ${msg}`].join("\n") };
  }
  if (w.port === "closed") {
    const msg = `Failed to connect to ${where} after 1 ms: Couldn't connect to server`;
    return {
      ok: false,
      exitCode: 7,
      output: [...head, `* connect to ${w.ip} port 443 from 192.168.1.10 port 52344 failed: Connection refused`, `* ${msg}`, `curl: (7) ${msg}`].join("\n"),
    };
  }
  head.push(`* Connected to ${w.host} (${w.ip}) port 443`);
  if (w.cert === "expired") {
    const msg = "SSL certificate problem: certificate has expired";
    return { ok: false, exitCode: 60, output: [...head, `* ${msg}`, `curl: (60) ${msg}`].join("\n") };
  }
  const lines = [...head, "*  SSL certificate verify ok.", "> GET / HTTP/1.1", `> Host: ${w.host}`, ">", `< HTTP/1.1 ${w.status} ${REASON[w.status] ?? ""}`.trimEnd()];
  return { ok: true, exitCode: 0, output: lines.join("\n") };
}

export type Layer = "dns" | "reach" | "port" | "tls" | "http";

/** 世界の正体は見ずに、ping と curl の結果だけから「どこで止まったか」を判断する。名前解決の失敗は curl の終了コード6で分かる */
export function diagnose(w: World): { stoppedAt: Layer | null; note: string } {
  const p = ping(w);
  const c = curl(w);
  const icmpNote = p.ok ? "" : "（ping が返らないのは ICMP が塞がれているだけで、サーバーは動いている）";
  switch (c.exitCode) {
    case 0: {
      const status = Number(/< HTTP\/1\.1 (\d{3})/.exec(c.output)![1]);
      if (status >= 500) return { stoppedAt: "http", note: `HTTPのやり取りまでは進んだ。${status} の原因はプロキシの奥にある${icmpNote}` };
      return { stoppedAt: null, note: `最後まで通っている${icmpNote}` };
    }
    case 6:
      return { stoppedAt: "dns", note: "名前解決で止まっている。DNSの設定やレコードを見る" };
    case 7:
      return { stoppedAt: "port", note: "ホストには届いたが、そのポートで誰も待ち受けていないか、拒否された" };
    case 28:
      return p.ok
        ? { stoppedAt: "port", note: "ping は返るのにポートへの接続だけ時間切れ。ファイアウォールで捨てられている可能性が高い" }
        : { stoppedAt: "reach", note: "ping も接続も返らない。ホストが止まっているか、経路の途中で全部捨てられている" };
    case 60:
      return { stoppedAt: "tls", note: "TCPの接続まではできた。証明書の検証で止まっている" };
  }
}
