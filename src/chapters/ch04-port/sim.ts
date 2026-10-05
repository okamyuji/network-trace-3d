export interface Listener {
  /** 0.0.0.0 はすべてのアドレス、127.0.0.1 は同じマシンの中からだけ受け付ける */
  addr: "0.0.0.0" | "127.0.0.1";
  port: number;
}

export interface Host {
  ip: string;
  listening: Listener[];
}

export interface SgRule {
  port: number;
}

export type Target = "ACCEPT" | "DROP" | "REJECT";

export interface IptablesRule {
  dport: number;
  target: Target;
}

export type Outcome = "connected" | "refused" | "timeout";

export interface ConnectResult {
  outcome: Outcome;
  stoppedAt: "sg" | "iptables" | "server";
  reason: string;
}

export function evaluateIptables(
  rules: IptablesRule[],
  policy: "ACCEPT" | "DROP",
  port: number,
): { target: Target; rule: number | null } {
  const index = rules.findIndex((r) => r.dport === port);
  return index === -1
    ? { target: policy, rule: null }
    : { target: rules[index]!.target, rule: index + 1 };
}

export function securityGroupAllows(rules: SgRule[], port: number): boolean {
  return rules.some((r) => r.port === port);
}

export function connect(input: {
  sg: SgRule[];
  iptables: IptablesRule[];
  policy: "ACCEPT" | "DROP";
  host: Host;
  port: number;
}): ConnectResult {
  const { sg, iptables, policy, host, port } = input;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`ポート番号は1〜65535の整数で指定します: ${port}`);
  }
  if (!securityGroupAllows(sg, port)) {
    return {
      outcome: "timeout",
      stoppedAt: "sg",
      reason: `セキュリティグループに ${port}番を許可する規則がなく、パケットが捨てられた`,
    };
  }
  const fw = evaluateIptables(iptables, policy, port);
  const which = fw.rule === null ? "ポリシー" : `${fw.rule}行目`;
  if (fw.target === "DROP") {
    return {
      outcome: "timeout",
      stoppedAt: "iptables",
      reason: `iptables の${which}が DROP で、何も返さずに捨てた`,
    };
  }
  if (fw.target === "REJECT") {
    return {
      outcome: "refused",
      stoppedAt: "iptables",
      reason: `iptables の${which}が REJECT で、拒否の返事を返した`,
    };
  }
  const listener = host.listening.find((l) => l.port === port);
  if (!listener) {
    return {
      outcome: "refused",
      stoppedAt: "server",
      reason: `${port}番で待ち受けているプログラムがなく、OSがRSTを返した`,
    };
  }
  if (listener.addr === "127.0.0.1") {
    return {
      outcome: "refused",
      stoppedAt: "server",
      reason: `${port}番は 127.0.0.1 でだけ待ち受けており、外から来た接続にはOSがRSTを返した`,
    };
  }
  return {
    outcome: "connected",
    stoppedAt: "server",
    reason: `${port}番で待ち受けているプログラムが接続を受け付けた`,
  };
}
