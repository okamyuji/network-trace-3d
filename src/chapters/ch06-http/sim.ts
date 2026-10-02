const CLASSES = ["情報", "成功", "リダイレクト", "クライアントエラー", "サーバーエラー"] as const;

export function classify(code: number): { label: (typeof CLASSES)[number]; treatAs: number } {
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    throw new Error(`ステータスコードは100〜599の整数です: ${code}`);
  }
  const head = Math.floor(code / 100);
  return { label: CLASSES[head - 1]!, treatAs: head * 100 };
}

// RFC 9110 9.2 で定義されたメソッドの性質
const METHODS: Record<string, { safe: boolean; idempotent: boolean }> = {
  GET: { safe: true, idempotent: true },
  HEAD: { safe: true, idempotent: true },
  OPTIONS: { safe: true, idempotent: true },
  TRACE: { safe: true, idempotent: true },
  PUT: { safe: false, idempotent: true },
  DELETE: { safe: false, idempotent: true },
  POST: { safe: false, idempotent: false },
  CONNECT: { safe: false, idempotent: false },
};

function method(name: string): { safe: boolean; idempotent: boolean } {
  const found = METHODS[name];
  if (!found) throw new Error(`RFC 9110 にないメソッドです: ${name}`);
  return found;
}

export const isSafe = (name: string): boolean => method(name).safe;
export const isIdempotent = (name: string): boolean => method(name).idempotent;

export type Upstream = "ok" | "not-found" | "app-error" | "down" | "malformed" | "slow";

export function proxyRequest(input: {
  upstream: Upstream;
  timeoutSec: number;
  responseSec?: number;
}): { status: number; madeBy: "app" | "proxy" } {
  switch (input.upstream) {
    case "ok":
      return { status: 200, madeBy: "app" };
    case "not-found":
      return { status: 404, madeBy: "app" };
    case "app-error":
      return { status: 500, madeBy: "app" };
    case "down":
    case "malformed":
      return { status: 502, madeBy: "proxy" };
    case "slow":
      return (input.responseSec ?? 0) > input.timeoutSec ? { status: 504, madeBy: "proxy" } : { status: 200, madeBy: "app" };
  }
}
