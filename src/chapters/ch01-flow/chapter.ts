import type { Chapter, Scenario, Step } from "../../core/types.ts";
import { type Phase, loadPage } from "./sim.ts";

const IP = "203.0.113.10";

const SEEN: Record<Phase, string> = {
  dns: "「名前が見つからない」という趣旨のエラーが出る",
  tcp: "「接続できない」または「応答がない」という趣旨のエラーが出る",
  tls: "「接続が安全ではない」という警告が出る",
  http: "サーバーが返したエラーのページが出る",
  render: "白い画面のまま、または崩れた表示になる",
};

function phaseSteps(phase: Phase, host: string, port: number, path: string): Step[] {
  switch (phase) {
    case "dns":
      return [
        {
          title: "名前からIPアドレスを調べる（DNS）",
          log: `${host} の IP アドレスをフルリゾルバーに問い合わせる`,
          from: "pc",
          to: "dns",
          packet: `${host} ?`,
          focus: ["dns"],
        },
        {
          title: "IPアドレスが返る",
          log: `${host} は ${IP}`,
          from: "dns",
          to: "pc",
          packet: IP,
          focus: ["pc"],
          state: { pc: `${host} = ${IP}` },
        },
      ];
    case "tcp":
      return [
        {
          title: "TCPの接続を申し込む",
          log: `${IP}:${port} へ SYN を送る`,
          from: "pc",
          to: "web",
          packet: "SYN",
          focus: ["web"],
        },
        {
          title: "サーバーが応じる",
          log: "SYN-ACK が返り、PC が ACK を返して接続ができる",
          from: "web",
          to: "pc",
          packet: "SYN-ACK",
          focus: ["pc"],
          state: { web: `LISTEN :${port}` },
        },
      ];
    case "tls":
      return [
        {
          title: "暗号化の準備をする（TLS）",
          log: "使う暗号方式を決め、サーバーの証明書を確かめる",
          from: "pc",
          to: "web",
          packet: "ClientHello",
          focus: ["web"],
        },
        {
          title: "証明書を受け取り検証する",
          log: "証明書が本物で、期限内で、名前が合っていれば先へ進む",
          from: "web",
          to: "pc",
          packet: "証明書",
          focus: ["pc"],
          state: { pc: `${host} = ${IP}\n証明書 OK` },
        },
      ];
    case "http":
      return [
        {
          title: "HTTPリクエストを送る",
          log: `GET ${path} を送る`,
          from: "pc",
          to: "web",
          packet: `GET ${path}`,
          focus: ["web"],
        },
        {
          title: "HTMLが返る",
          log: "200 OK と HTML が返る",
          from: "web",
          to: "pc",
          packet: "200 OK",
          focus: ["pc"],
        },
      ];
    case "render":
      return [
        {
          title: "ブラウザが画面を組み立てる",
          log: "HTML を読み、必要な CSS や画像を同じ手順で取りに行き、画面に描く",
          focus: ["pc"],
          state: { pc: "表示完了" },
        },
      ];
  }
}

function build(id: string, label: string, url: string, fail?: Phase): Scenario {
  const r = loadPage(url, fail ? { fail } : {});
  const { host, port, path, scheme } = r.target;
  const steps: Step[] = [
    {
      title: "URLを分解する",
      log: `スキーム ${scheme}、ホスト名 ${host}、ポート ${port}、パス ${path}`,
      focus: ["pc"],
      state: { pc: `${scheme}://${host}:${port}` },
    },
  ];
  for (const { phase, ok } of r.phases) {
    const s = phaseSteps(phase, host, port, path);
    if (ok) {
      steps.push(...s);
    } else {
      const first = s[0]!;
      steps.push({ ...first, status: "fail", title: `${first.title} → 失敗` });
      steps.push({
        title: "ここで止まる",
        log: `この先の段階には進まない。ブラウザには${SEEN[phase]}`,
        status: "fail",
        focus: ["pc"],
      });
    }
  }
  return { id, label, steps };
}

export const ch01: Chapter = {
  id: "ch01",
  title: "ブラウザでの画面表示の流れ",
  nodes: [
    { id: "pc", label: "ブラウザ", kind: "client", pos: [-6, 0.5, 0] },
    { id: "dns", label: "DNS（フルリゾルバー）", kind: "dns", pos: [0, 0.55, -4] },
    { id: "web", label: `Webサーバー ${IP}`, kind: "server", pos: [6, 0.8, 0] },
  ],
  scenarios: [
    build("https", "https:// のページを開く", "https://shop.example/"),
    build("dns-fail", "名前解決で止まる", "https://shop.example/", "dns"),
    build("tcp-fail", "接続で止まる", "https://shop.example/", "tcp"),
    build("tls-fail", "証明書で止まる", "https://shop.example/", "tls"),
  ],
};
