export function appendXff(current: string | undefined, clientIp: string): string {
  return current ? `${current}, ${clientIp}` : clientIp;
}

interface Health {
  inService: boolean;
  /** 現在の状態と逆の結果が続いた回数 */
  streak: number;
}

export function createBalancer(config: {
  ip: string;
  targets: string[];
  unhealthyThreshold: number;
  healthyThreshold: number;
}) {
  const { ip, targets, unhealthyThreshold, healthyThreshold } = config;
  if (targets.length === 0) throw new Error("振り分け先が1つもありません");
  if (unhealthyThreshold < 1 || healthyThreshold < 1) throw new Error("閾値は1以上で指定します");
  const health = new Map<string, Health>(targets.map((t) => [t, { inService: true, streak: 0 }]));
  let cursor = 0;

  function inService(): string[] {
    return targets.filter((t) => health.get(t)!.inService);
  }

  function healthCheck(target: string, ok: boolean): void {
    const h = health.get(target);
    if (!h) throw new Error(`登録されていない振り分け先です: ${target}`);
    if (ok === h.inService) {
      h.streak = 0;
      return;
    }
    h.streak++;
    if (h.streak >= (h.inService ? unhealthyThreshold : healthyThreshold)) {
      h.inService = !h.inService;
      h.streak = 0;
    }
  }

  /** クライアントのIPアドレスから来たリクエストを振り分け、アプリ側から見える情報を返す */
  function forward(clientIp: string, xff?: string): { target: string; remoteAddr: string; xff: string } {
    // 全部が不健全なときは全部へ振り分ける。AWS ALB の fail open と同じ考え方
    const pool = inService().length > 0 ? inService() : targets;
    const target = pool[cursor % pool.length]!;
    cursor++;
    return { target, remoteAddr: ip, xff: appendXff(xff, clientIp) };
  }

  return { inService, healthCheck, forward };
}
