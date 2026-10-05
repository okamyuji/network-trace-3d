import type { Chapter, Scenario, Step } from "../../core/types.ts";
import { type Authority, createResolver } from "./sim.ts";

const NAME = "www.example.com.";

function zones(): Authority[] {
  return [
    {
      server: "root",
      zone: ".",
      delegations: { "com.": { server: "tld", ttl: 172800 } },
      records: {},
    },
    {
      server: "tld",
      zone: "com.",
      delegations: { "example.com.": { server: "auth", ttl: 86400 } },
      records: {},
    },
    {
      server: "auth",
      zone: "example.com.",
      delegations: {},
      records: { [NAME]: { ip: "203.0.113.10", ttl: 300 } },
    },
  ];
}

const REPLY: Record<string, string> = {
  root: "com. のことは TLD サーバーへ（委任）",
  tld: "example.com. のことは権威サーバーへ（委任）",
  auth: "答え",
};

function lookup(resolver: ReturnType<typeof createResolver>, now: number): Step[] {
  const r = resolver.resolve(NAME, now);
  const clock = `時刻 ${now}秒`;
  const steps: Step[] = [
    {
      title: `${clock}: ブラウザが名前を問い合わせる`,
      log: `PC → フルリゾルバー: ${NAME} の A レコードは？`,
      from: "pc",
      to: "resolver",
      packet: "A?",
      focus: ["resolver"],
    },
  ];
  if (r.fromCache) {
    steps.push({
      title: "キャッシュから即答する",
      log: `キャッシュが有効なので外へ聞かない。残りTTL ${r.ttl}秒`,
      focus: ["resolver"],
      state: { resolver: `キャッシュ: ${r.ip}\n残りTTL ${r.ttl}秒` },
    });
  } else {
    if (r.asked[0] !== "root") {
      steps.push({
        title: "委任情報のキャッシュを使う",
        log: "答えは期限切れだが、権威サーバーの場所はまだ覚えているのでルートから始めない",
        focus: ["resolver"],
      });
    }
    for (const server of r.asked) {
      steps.push({
        title: `${server} サーバーに聞く`,
        log: `フルリゾルバー → ${server}`,
        from: "resolver",
        to: server,
        packet: "A?",
        focus: [server],
      });
      const isAnswer = server === r.asked.at(-1);
      steps.push({
        title: isAnswer ? `答えが返る: ${r.ip}（TTL ${r.ttl}）` : REPLY[server]!,
        log: isAnswer ? `${NAME} ${r.ttl} IN A ${r.ip}` : REPLY[server]!,
        from: server,
        to: "resolver",
        packet: isAnswer ? r.ip! : "委任",
        focus: ["resolver"],
        state: isAnswer ? { resolver: `キャッシュ: ${r.ip}\n残りTTL ${r.ttl}秒` } : {},
      });
    }
  }
  steps.push({
    title: `PCが ${r.ip} を受け取る`,
    log: `この時点で使われるIPアドレスは ${r.ip}`,
    from: "resolver",
    to: "pc",
    packet: r.ip!,
    focus: ["pc"],
    state: { pc: `${r.ip} に接続する` },
  });
  return steps;
}

function ttlScenario(): Scenario {
  const resolver = createResolver(zones());
  return {
    id: "ttl",
    label: "TTLの間はキャッシュ、切れたら聞き直す",
    steps: [0, 60, 300].flatMap((t) => lookup(resolver, t)),
  };
}

function changeScenario(): Scenario {
  const z = zones();
  const resolver = createResolver(z);
  const first = lookup(resolver, 0);
  z[2]!.records[NAME] = { ip: "203.0.113.20", ttl: 300 };
  const changed: Step = {
    title: "時刻 50秒: 権威サーバーの値を 203.0.113.20 に変える",
    log: "サーバー移行でAレコードを書き換えた。しかしフルリゾルバーは知らない",
    focus: ["auth"],
    state: { auth: "A 203.0.113.20（変更後）" },
  };
  return {
    id: "change",
    label: "IPアドレスを変えても古い値が返り続ける",
    steps: [...first, changed, ...lookup(resolver, 100), ...lookup(resolver, 300)],
  };
}

export const ch05: Chapter = {
  id: "ch05",
  title: "DNSとTTL",
  nodes: [
    { id: "pc", label: "PC（スタブリゾルバー）", kind: "client", pos: [-7, 0.5, 0] },
    { id: "resolver", label: "フルリゾルバー", kind: "dns", pos: [-2, 0.55, 0] },
    { id: "root", label: "ルート .", kind: "dns", pos: [4, 0.55, -4] },
    { id: "tld", label: "TLD com.", kind: "dns", pos: [5.5, 0.55, 0] },
    { id: "auth", label: "権威 example.com.", kind: "dns", pos: [4, 0.55, 4] },
  ],
  scenarios: [ttlScenario(), changeScenario()],
};
