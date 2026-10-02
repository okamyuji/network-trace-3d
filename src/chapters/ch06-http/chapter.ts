import type { Chapter, Scenario, Step, StepStatus } from "../../core/types.ts";
import { type Upstream, classify, proxyRequest } from "./sim.ts";

const TIMEOUT = 60;
const REQUEST = "GET /orders HTTP/1.1\nHost: shop.example\nAccept: application/json";

const REASON: Record<number, string> = { 200: "OK", 404: "Not Found", 500: "Internal Server Error", 502: "Bad Gateway", 504: "Gateway Timeout" };

const WHERE: Record<number, string> = {
  200: "問題なし",
  404: "送った側（URLやパラメーター）を見直す",
  500: "アプリケーションのログを見る",
  502: "プロキシのログと、アプリのプロセスが動いているか・待ち受けポートが合っているかを見る",
  504: "アプリの処理時間と、プロキシの待ち時間の設定を見る",
};

function upstreamSteps(upstream: Upstream, status: number, madeBy: "app" | "proxy", responseSec: number): Step[] {
  if (upstream === "down") {
    return [{ title: "プロキシがアプリへ転送しようとして失敗する", log: "アプリのポートで誰も待ち受けておらず、接続が拒否された", from: "proxy", to: "app", packet: "GET /orders", status: "fail", focus: ["app"], state: { app: "停止中" } }];
  }
  if (madeBy === "proxy" && upstream === "slow") {
    return [{ title: "アプリが返事をしないまま時間が過ぎる", log: `アプリの処理に ${responseSec}秒かかり、プロキシの待ち時間 ${TIMEOUT}秒を超えた`, from: "proxy", to: "app", packet: "GET /orders", status: "wait", focus: ["app"], state: { app: `処理中… ${responseSec}秒` } }];
  }
  const forward: Step = { title: "プロキシがアプリへ転送する", log: "リバースプロキシは受け取ったリクエストを裏のアプリに渡す", from: "proxy", to: "app", packet: "GET /orders", focus: ["app"] };
  if (upstream === "malformed") {
    return [forward, { title: "アプリがHTTPとして読めない応答を返す", log: "ヘッダーの形が崩れていて、プロキシは中身を解釈できない", from: "app", to: "proxy", packet: "壊れた応答", status: "fail", focus: ["proxy"], state: { app: "HTTP/1.1 2O0 ?" } }];
  }
  const statusLine = `HTTP/1.1 ${status} ${REASON[status]}`;
  return [forward, { title: `アプリが ${status} を返す`, log: `${statusLine}（Content-Type: application/json）`, from: "app", to: "proxy", packet: String(status), focus: ["proxy"], state: { app: statusLine } }];
}

function replyStatus(status: number): StepStatus {
  if (status >= 500) return "fail";
  return status >= 400 ? "wait" : "ok";
}

function build(id: string, label: string, upstream: Upstream, responseSec = 1): Scenario {
  const { status, madeBy } = proxyRequest({ upstream, timeoutSec: TIMEOUT, responseSec });
  const statusLine = `HTTP/1.1 ${status} ${REASON[status]}`;
  const cls = classify(status);
  const byProxy = madeBy === "proxy";
  const steps: Step[] = [
    { title: "ブラウザがリクエストを送る", log: "メソッド GET、パス /orders、Host ヘッダーで宛先のサイト名を伝える", from: "client", to: "proxy", packet: "GET /orders", focus: ["proxy"], state: { client: REQUEST } },
    ...upstreamSteps(upstream, status, madeBy, responseSec),
    {
      title: byProxy ? `プロキシが自分で ${status} を作って返す` : `プロキシが ${status} をそのまま中継する`,
      log: `${statusLine}。${cls.label}（${cls.treatAs / 100}xx）。この応答を作ったのは${byProxy ? "プロキシ" : "アプリ"}`,
      from: "proxy",
      to: "client",
      packet: String(status),
      status: replyStatus(status),
      focus: ["client"],
      state: { proxy: byProxy ? `${status} を生成` : "中継のみ", client: statusLine },
    },
    { title: "次に見る場所", log: WHERE[status]!, focus: [byProxy ? "proxy" : status === 404 ? "client" : "app"] },
  ];
  return { id, label, steps };
}

export const ch06: Chapter = {
  id: "ch06",
  title: "HTTPのステータスコード",
  nodes: [
    { id: "client", label: "ブラウザ", kind: "client", pos: [-6, 0.5, 0] },
    { id: "proxy", label: "リバースプロキシ", kind: "proxy", pos: [0, 0.8, 0] },
    { id: "app", label: "アプリケーション", kind: "server", pos: [6, 0.8, 0] },
  ],
  scenarios: [
    build("ok", "200: 成功", "ok"),
    build("not-found", "404: パスが違う", "not-found"),
    build("app-error", "500: アプリの例外", "app-error"),
    build("down", "502: アプリが止まっている", "down"),
    build("malformed", "502: 壊れた応答", "malformed"),
    build("slow", "504: アプリが遅すぎる", "slow", 75),
  ],
};
