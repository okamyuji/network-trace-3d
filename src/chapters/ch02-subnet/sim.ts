export function parseIPv4(text: string): number {
  const parts = text.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255)) {
    throw new Error(`IPv4アドレスとして読めません: "${text}"`);
  }
  return parts.reduce((acc, p) => ((acc << 8) | Number(p)) >>> 0, 0);
}

export function formatIPv4(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 0xff).join(".");
}

export function parseCidr(text: string): { ip: number; prefix: number } {
  const parts = text.split("/");
  if (parts.length !== 2) {
    throw new Error(`CIDR表記（例: 192.168.1.10/24）として読めません: "${text}"`);
  }
  const [ip, prefix] = parts as [string, string];
  if (!/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) {
    throw new Error(`プレフィックス長は0〜32で指定します: "${text}"`);
  }
  return { ip: parseIPv4(ip), prefix: Number(prefix) };
}

function maskOf(prefix: number): number {
  // JavaScript のシフトは32で一周するため、/0 は別扱いにする
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export interface SubnetInfo {
  network: string;
  broadcast: string;
  mask: string;
  firstHost: string;
  lastHost: string;
  hostCount: number;
}

export function subnetInfo(cidr: string): SubnetInfo {
  const { ip, prefix } = parseCidr(cidr);
  const mask = maskOf(prefix);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  const size = 2 ** (32 - prefix);
  // /31 と /32 は「ネットワーク番号とブロードキャストを除く」規則を当てはめない（RFC 3021）
  const reserved = prefix >= 31 ? 0 : 1;
  return {
    network: formatIPv4(network),
    broadcast: formatIPv4(broadcast),
    mask: formatIPv4(mask),
    firstHost: formatIPv4(network + reserved),
    lastHost: formatIPv4(broadcast - reserved),
    hostCount: size - 2 * reserved,
  };
}

export function decideNextHop(
  selfCidr: string,
  gateway: string,
  destination: string,
): { sameSubnet: boolean; nextHop: string } {
  const { ip, prefix } = parseCidr(selfCidr);
  const mask = maskOf(prefix);
  const sameSubnet = (ip & mask) >>> 0 === (parseIPv4(destination) & mask) >>> 0;
  return { sameSubnet, nextHop: sameSubnet ? destination : gateway };
}
