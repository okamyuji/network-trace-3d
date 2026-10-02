import type { Chapter, Scenario } from "../../core/types.ts";
import { decideNextHop, formatIPv4, parseCidr, subnetInfo } from "./sim.ts";

const GATEWAY = "192.168.1.1";

function judge(selfCidr: string, dest: string): { text: string; same: boolean; nextHop: string } {
  const self = subnetInfo(selfCidr);
  const destNet = subnetInfo(`${dest}/${parseCidr(selfCidr).prefix}`).network;
  const { sameSubnet, nextHop } = decideNextHop(selfCidr, GATEWAY, dest);
  return {
    same: sameSubnet,
    nextHop,
    text: `自分 ${self.network} / 宛先 ${destNet}\n→ ${sameSubnet ? "同じサブネット" : "別のサブネット"}`,
  };
}

function direct(): Scenario {
  const j = judge("192.168.1.10/24", "192.168.1.20");
  return {
    id: "same",
    label: "同じサブネットへ送る",
    steps: [
      { title: "宛先が同じサブネットかを計算する", log: `マスク255.255.255.0で両者のネットワーク部を比べる。次の送り先は ${j.nextHop}`, focus: ["pc"], state: { pc: j.text } },
      { title: "ARPで相手の機器を探す", log: "「192.168.1.20 は誰？」をサブネット全体に問い合わせる", from: "pc", to: "peer", packet: "ARP 要求", focus: ["peer"] },
      { title: "相手が名乗り出る", log: "192.168.1.20 が自分のMACアドレスを返す", from: "peer", to: "pc", packet: "ARP 応答" },
      { title: "ルーターを通らずに届く", log: "パケットは同じサブネット内で直接届く", from: "pc", to: "peer", packet: "IP パケット", focus: ["peer"], state: { peer: "受信 OK" } },
    ],
  };
}

function viaGateway(): Scenario {
  const j = judge("192.168.1.10/24", "10.0.2.5");
  return {
    id: "other",
    label: "別のサブネットへ送る",
    steps: [
      { title: "宛先が別のサブネットだと分かる", log: `ネットワーク部が違うので、次の送り先はデフォルトゲートウェイ ${j.nextHop}`, focus: ["pc"], state: { pc: j.text } },
      { title: "まずゲートウェイ（ルーター）へ渡す", log: "宛先のIPアドレスは10.0.2.5のまま、ルーターに預ける", from: "pc", to: "router", packet: "→10.0.2.5", focus: ["router"] },
      { title: "ルーターが隣のサブネットへ転送する", log: "ルーターは経路表を見て10.0.2.0/24側へ送り出す", from: "router", to: "srv", packet: "→10.0.2.5", focus: ["srv"], state: { srv: "受信 OK" } },
      { title: "返事も同じルーターを経由する", log: "10.0.2.5 からの応答はルーター経由でPCへ戻る", from: "srv", to: "router", packet: "応答" },
      { title: "PCが応答を受け取る", log: "往復ともゲートウェイを通った", from: "router", to: "pc", packet: "応答", focus: ["pc"] },
    ],
  };
}

function wrongMask(): Scenario {
  const wrong = judge("192.168.1.10/16", "192.168.2.5");
  const right = judge("192.168.1.10/24", "192.168.2.5");
  const info = subnetInfo("192.168.1.10/16");
  return {
    id: "wrong-mask",
    label: "マスクを /16 と誤設定する",
    steps: [
      { title: "誤ったマスクで計算する", log: `/16 だと自分のネットワークは ${info.network}〜${info.broadcast} になり、192.168.2.5 も「同じ」と判断する`, focus: ["pc"], state: { pc: wrong.text } },
      { title: "ルーターに渡さずARPで探してしまう", log: "「192.168.2.5 は誰？」を自分のサブネットにだけ問い合わせる", from: "pc", to: "router", packet: "ARP 要求", status: "fail", focus: ["router"], state: { router: "ARPは転送しない" } },
      { title: "誰も応答しない", log: "ARPはルーターを越えないため、192.168.2.5 の宛先が分からず、IPパケットを送り出せない", status: "fail", focus: ["far"], state: { far: "問い合わせが届かない" } },
      { title: "正しいマスク /24 なら", log: `マスクを /24 に直すと別サブネットと判断し、${right.nextHop} に渡せる`, from: "pc", to: "router", packet: "→192.168.2.5", focus: ["pc"], state: { pc: right.text, router: "" } },
      { title: "ルーター経由で届く", log: "ルーターが192.168.2.0/24側へ転送する", from: "router", to: "far", packet: "→192.168.2.5", focus: ["far"], state: { far: "受信 OK" } },
    ],
  };
}

export const ch02: Chapter = {
  id: "ch02",
  title: "IPアドレスとサブネット",
  nodes: [
    { id: "pc", label: "PC 192.168.1.10", kind: "client", pos: [-6, 0.5, 1.5] },
    { id: "peer", label: "NAS 192.168.1.20", kind: "server", pos: [-6, 0.8, -2] },
    { id: "router", label: `ルーター ${GATEWAY}`, kind: "router", pos: [0, 0.2, 0] },
    { id: "srv", label: "Web 10.0.2.5", kind: "server", pos: [6, 0.8, -2.5] },
    { id: "far", label: "DB 192.168.2.5", kind: "server", pos: [6, 0.8, 3] },
  ],
  zones: [
    { label: `192.168.1.0/24（マスク ${formatIPv4(0xffffff00)}）`, center: [-6, 0.01, 0], size: [5, 7], color: "#3b82f6" },
    { label: "10.0.2.0/24", center: [6, 0.01, -2.5], size: [4.5, 3.6], color: "#22c55e" },
    { label: "192.168.2.0/24", center: [6, 0.01, 3], size: [4.5, 3.6], color: "#a855f7" },
  ],
  scenarios: [direct(), viaGateway(), wrongMask()],
};
