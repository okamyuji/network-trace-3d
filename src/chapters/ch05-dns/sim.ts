export interface ARecord {
  ip: string;
  ttl: number;
}

export interface Authority {
  server: string;
  zone: string;
  /** 下位ゾーン名 → それを担当するサーバー（NSレコードに相当） */
  delegations: Record<string, { server: string; ttl: number }>;
  records: Record<string, ARecord>;
}

export interface Resolution {
  ip: string | null;
  rcode: "NOERROR" | "NXDOMAIN";
  fromCache: boolean;
  /** このときに問い合わせたサーバーの順番 */
  asked: string[];
  /** 答えの残りTTL（秒） */
  ttl: number;
}

interface Cached<T> {
  value: T;
  expiresAt: number;
}

function isUnder(name: string, zone: string): boolean {
  return name === zone || name.endsWith(`.${zone}`);
}

/** フルリゾルバー（キャッシュDNSサーバー）の単純化したモデル。時刻は秒で外から与える。 */
export function createResolver(authorities: Authority[]) {
  const answers = new Map<string, Cached<ARecord>>();
  const referrals = new Map<string, Cached<string>>();
  let lastNow = -Infinity;

  function fresh<T>(entry: Cached<T> | undefined, now: number): entry is Cached<T> {
    return entry !== undefined && now < entry.expiresAt;
  }

  /** 期限内の委任情報のうち、名前に最も近い（長い）ゾーンから始める。なければルートから */
  function startingPoint(name: string, now: number): string {
    const usable = [...referrals].filter(([zone, entry]) => fresh(entry, now) && isUnder(name, zone));
    usable.sort(([a], [b]) => b.length - a.length);
    return usable[0]?.[1].value ?? "root";
  }

  function resolve(name: string, now: number): Resolution {
    if (!name.endsWith(".")) throw new Error(`名前は末尾のドットまで書きます（例: www.example.com.）: "${name}"`);
    if (now < lastNow) throw new Error(`時刻が巻き戻っています: ${now} < ${lastNow}`);
    lastNow = now;

    const cached = answers.get(name);
    if (fresh(cached, now)) {
      return { ip: cached.value.ip, rcode: "NOERROR", fromCache: true, asked: [], ttl: cached.expiresAt - now };
    }

    const asked: string[] = [];
    let server = startingPoint(name, now);
    for (;;) {
      const auth = authorities.find((a) => a.server === server);
      if (!auth) throw new Error(`サーバー ${server} が定義されていません`);
      asked.push(server);
      const record = auth.records[name];
      if (record) {
        // TTL 0 は期限が今この瞬間に切れるので、結果としてキャッシュされない（RFC 1035 3.2.1）
        answers.set(name, { value: record, expiresAt: now + record.ttl });
        return { ip: record.ip, rcode: "NOERROR", fromCache: false, asked, ttl: record.ttl };
      }
      const next = Object.entries(auth.delegations).find(([zone]) => isUnder(name, zone));
      if (!next) return { ip: null, rcode: "NXDOMAIN", fromCache: false, asked, ttl: 0 };
      const [zone, { server: child, ttl }] = next;
      referrals.set(zone, { value: child, expiresAt: now + ttl });
      server = child;
    }
  }

  return { resolve };
}
