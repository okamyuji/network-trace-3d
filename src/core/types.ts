export type NodeKind = "client" | "server" | "dns" | "router" | "firewall" | "proxy" | "lb" | "ca";

export interface StageNode {
  id: string;
  label: string;
  kind: NodeKind;
  pos: [number, number, number];
}

/** 半透明の板。サブネットやVPCのような「範囲」を立体図に置くために使う。 */
export interface Zone {
  label: string;
  center: [number, number, number];
  size: [number, number];
  color: string;
}

export type StepStatus = "ok" | "fail" | "wait";

export interface Step {
  title: string;
  log: string;
  from?: string;
  to?: string;
  packet?: string;
  status?: StepStatus;
  focus?: string[];
  /** ノードIDごとの状態表示。立体図ではノード名の下に出る。 */
  state?: Record<string, string>;
}

export interface Scenario {
  id: string;
  label: string;
  steps: Step[];
}

export interface Chapter {
  id: string;
  title: string;
  nodes: StageNode[];
  zones?: Zone[];
  scenarios: Scenario[];
}
