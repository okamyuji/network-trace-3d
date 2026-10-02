import assert from "node:assert/strict";
import { test } from "node:test";
import { decideNextHop, formatIPv4, parseCidr, parseIPv4, subnetInfo } from "./sim.ts";

test("IPv4の文字列を32ビットの数に変換し、元の表記に戻せる", () => {
  assert.equal(parseIPv4("192.168.1.10"), 0xc0a8010a);
  assert.equal(formatIPv4(0xc0a8010a), "192.168.1.10");
  assert.equal(formatIPv4(parseIPv4("255.255.255.255")), "255.255.255.255");
  assert.equal(parseIPv4("0.0.0.0"), 0);
});

test("範囲外や形の崩れたIPv4はエラーにする", () => {
  for (const bad of ["256.0.0.1", "1.2.3", "1.2.3.4.5", "a.b.c.d", "", "01.2.3.4", "-1.2.3.4"]) {
    assert.throws(() => parseIPv4(bad), /IPv4/, bad);
  }
});

test("CIDR表記をアドレスとプレフィックス長に分け、範囲外の長さはエラーにする", () => {
  assert.deepEqual(parseCidr("10.0.2.5/16"), { ip: parseIPv4("10.0.2.5"), prefix: 16 });
  assert.throws(() => parseCidr("10.0.0.1/33"), /プレフィックス/);
  assert.throws(() => parseCidr("10.0.0.1"), /CIDR/);
  assert.throws(() => parseCidr("10.0.0.1/"), /プレフィックス/);
});

test("/24 のネットワーク、ブロードキャスト、ホスト範囲を求める", () => {
  assert.deepEqual(subnetInfo("192.168.1.10/24"), {
    network: "192.168.1.0",
    broadcast: "192.168.1.255",
    mask: "255.255.255.0",
    firstHost: "192.168.1.1",
    lastHost: "192.168.1.254",
    hostCount: 254,
  });
});

test("境界値: /30 は2台、/0 は全アドレス、/32 は1台だけを表す", () => {
  const p30 = subnetInfo("10.0.0.6/30");
  assert.equal(p30.network, "10.0.0.4");
  assert.equal(p30.broadcast, "10.0.0.7");
  assert.equal(p30.hostCount, 2);
  const p0 = subnetInfo("8.8.8.8/0");
  assert.equal(p0.mask, "0.0.0.0");
  assert.equal(p0.network, "0.0.0.0");
  assert.equal(p0.broadcast, "255.255.255.255");
  const p32 = subnetInfo("10.0.0.9/32");
  assert.equal(p32.network, "10.0.0.9");
  assert.equal(p32.hostCount, 1);
  assert.equal(p32.firstHost, "10.0.0.9");
  assert.equal(p32.lastHost, "10.0.0.9");
  assert.equal(subnetInfo("10.0.0.8/31").hostCount, 2);
});

test("同じサブネットの宛先には直接送る", () => {
  assert.deepEqual(decideNextHop("192.168.1.10/24", "192.168.1.1", "192.168.1.20"), {
    sameSubnet: true,
    nextHop: "192.168.1.20",
  });
});

test("別のサブネットの宛先はデフォルトゲートウェイに渡す", () => {
  assert.deepEqual(decideNextHop("192.168.1.10/24", "192.168.1.1", "10.0.2.5"), {
    sameSubnet: false,
    nextHop: "192.168.1.1",
  });
});

test("マスクを/16と誤設定すると、別サブネットの宛先も同じサブネットだと判断してしまう", () => {
  assert.equal(decideNextHop("192.168.1.10/16", "192.168.1.1", "192.168.2.5").sameSubnet, true);
  assert.equal(decideNextHop("192.168.1.10/24", "192.168.1.1", "192.168.2.5").sameSubnet, false);
});

test("スラッシュが2つ以上ある表記や、数字以外を含むプレフィックスはエラーにする", () => {
  assert.throws(() => parseCidr("10.0.0.1/24/8"), /CIDR/);
  assert.throws(() => parseCidr("10.0.0.1/5a"), /プレフィックス/);
  assert.throws(() => parseCidr("10.0.0.1/a5"), /プレフィックス/);
});
