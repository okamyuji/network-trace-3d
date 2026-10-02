import assert from "node:assert/strict";
import { test } from "node:test";
import { type World, curl, diagnose, dig, ping } from "./sim.ts";

const healthy: World = { host: "shop.example", ip: "203.0.113.10", dns: "ok", hostUp: true, icmpAllowed: true, port: "open", cert: "ok", status: 200 };

test("正常なら dig は IP を、ping は応答を、curl は 200 を返す", () => {
  assert.match(dig(healthy).output, /status: NOERROR/);
  assert.match(dig(healthy).output, /203\.0\.113\.10/);
  assert.equal(ping(healthy).ok, true);
  assert.match(curl(healthy).output, /< HTTP\/1\.1 200/);
  assert.equal(diagnose(healthy).stoppedAt, null);
});

test("名前が引けなければ dig は NXDOMAIN、curl は終了コード6で止まる", () => {
  const w: World = { ...healthy, dns: "nxdomain" };
  assert.match(dig(w).output, /status: NXDOMAIN/);
  assert.match(curl(w).output, /curl: \(6\) Could not resolve host: shop\.example/);
  assert.equal(diagnose(w).stoppedAt, "dns");
});

test("ICMPだけ塞がれていると ping は失敗するが curl は成功し、止まっていないと分かる", () => {
  const w: World = { ...healthy, icmpAllowed: false };
  assert.equal(ping(w).ok, false);
  assert.match(curl(w).output, /200/);
  assert.equal(diagnose(w).stoppedAt, null);
  assert.match(diagnose(w).note, /ICMP/);
});

test("待ち受けていないポートは curl が終了コード7ですぐ失敗する", () => {
  const w: World = { ...healthy, port: "closed" };
  assert.match(curl(w).output, /Connection refused/);
  assert.match(curl(w).output, /curl: \(7\)/);
  assert.equal(diagnose(w).stoppedAt, "port");
});

test("途中で捨てられると curl は終了コード28の時間切れになる", () => {
  const w: World = { ...healthy, port: "filtered" };
  assert.match(curl(w).output, /curl: \(28\).*Timeout was reached/);
  assert.equal(diagnose(w).stoppedAt, "port");
});

test("ホストが止まっていると ping も curl も時間切れになり、到達性の問題と判断する", () => {
  const w: World = { ...healthy, hostUp: false };
  assert.equal(ping(w).ok, false);
  assert.match(curl(w).output, /curl: \(28\)/);
  assert.equal(diagnose(w).stoppedAt, "reach");
});

test("証明書の期限切れは TCP 接続の後、TLS の段階で止まる", () => {
  const w: World = { ...healthy, cert: "expired" };
  const out = curl(w).output;
  assert.match(out, /Connected to shop\.example/);
  assert.match(out, /SSL certificate problem: certificate has expired/);
  assert.equal(diagnose(w).stoppedAt, "tls");
});

test("502 はHTTPのやり取りまで進んでおり、問題はプロキシの奥にある", () => {
  const w: World = { ...healthy, status: 502 };
  assert.match(curl(w).output, /< HTTP\/1\.1 502 Bad Gateway/);
  assert.equal(diagnose(w).stoppedAt, "http");
});

test("各コマンドの出力は、手元で実行した実物と同じ形になる", () => {
  assert.deepEqual(dig(healthy), { ok: true, exitCode: 0, output: ";; ->>HEADER<<- opcode: QUERY, status: NOERROR\n;; ANSWER SECTION:\nshop.example.\t300\tIN\tA\t203.0.113.10" });
  assert.deepEqual(dig({ ...healthy, dns: "nxdomain" }), { ok: false, exitCode: 0, output: ";; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN" });
  assert.deepEqual(ping(healthy), { ok: true, exitCode: 0, output: "--- shop.example ping statistics ---\n3 packets transmitted, 3 packets received, 0.0% packet loss" });
  assert.deepEqual(ping({ ...healthy, icmpAllowed: false }), { ok: false, exitCode: 2, output: "--- shop.example ping statistics ---\n3 packets transmitted, 0 packets received, 100.0% packet loss" });
  assert.deepEqual(ping({ ...healthy, dns: "nxdomain" }), { ok: false, exitCode: 68, output: "ping: cannot resolve shop.example: Unknown host" });

  const head = "* Host shop.example:443 was resolved.\n* IPv4: 203.0.113.10\n*   Trying 203.0.113.10:443...\n";
  assert.deepEqual(curl({ ...healthy, dns: "nxdomain" }), { ok: false, exitCode: 6, output: "* Could not resolve host: shop.example\ncurl: (6) Could not resolve host: shop.example" });
  assert.deepEqual(curl({ ...healthy, port: "filtered" }), {
    ok: false,
    exitCode: 28,
    output: `${head}* Failed to connect to shop.example port 443 after 10002 ms: Timeout was reached\ncurl: (28) Failed to connect to shop.example port 443 after 10002 ms: Timeout was reached`,
  });
  assert.deepEqual(curl({ ...healthy, port: "closed" }), {
    ok: false,
    exitCode: 7,
    output: `${head}* connect to 203.0.113.10 port 443 from 192.168.1.10 port 52344 failed: Connection refused\n* Failed to connect to shop.example port 443 after 1 ms: Couldn't connect to server\ncurl: (7) Failed to connect to shop.example port 443 after 1 ms: Couldn't connect to server`,
  });
  assert.deepEqual(curl({ ...healthy, cert: "expired" }), {
    ok: false,
    exitCode: 60,
    output: `${head}* Connected to shop.example (203.0.113.10) port 443\n* SSL certificate problem: certificate has expired\ncurl: (60) SSL certificate problem: certificate has expired`,
  });
  assert.deepEqual(curl(healthy), {
    ok: true,
    exitCode: 0,
    output: `${head}* Connected to shop.example (203.0.113.10) port 443\n*  SSL certificate verify ok.\n> GET / HTTP/1.1\n> Host: shop.example\n>\n< HTTP/1.1 200 OK`,
  });
  assert.match(curl({ ...healthy, status: 418 }).output, /< HTTP\/1\.1 418$/);
});

test("ステータス行の理由句は代表的なコードについて正しく付く", () => {
  const reasons: [number, string][] = [[404, "Not Found"], [500, "Internal Server Error"], [502, "Bad Gateway"], [503, "Service Unavailable"], [504, "Gateway Timeout"]];
  for (const [status, reason] of reasons) {
    assert.ok(curl({ ...healthy, status }).output.endsWith(`< HTTP/1.1 ${status} ${reason}`), String(status));
  }
});

test("500ちょうどでもアプリ側の問題と判断する", () => {
  assert.equal(diagnose({ ...healthy, status: 500 }).stoppedAt, "http");
});

test("判断の説明文は止まった場所ごとに決まった文になる", () => {
  assert.equal(diagnose(healthy).note, "最後まで通っている");
  assert.equal(diagnose({ ...healthy, port: "closed" }).note, "ホストには届いたが、そのポートで誰も待ち受けていないか、拒否された");
  assert.equal(diagnose({ ...healthy, port: "filtered" }).note, "ping は返るのにポートへの接続だけ時間切れ。ファイアウォールで捨てられている可能性が高い");
  assert.equal(diagnose({ ...healthy, hostUp: false }).note, "ping も接続も返らない。ホストが止まっているか、経路の途中で全部捨てられている");
  assert.equal(diagnose({ ...healthy, cert: "expired" }).note, "TCPの接続まではできた。証明書の検証で止まっている");
  assert.equal(diagnose({ ...healthy, status: 502 }).note, "HTTPのやり取りまでは進んだ。502 の原因はプロキシの奥にある");
  assert.equal(diagnose({ ...healthy, icmpAllowed: false }).note, "最後まで通っている（ping が返らないのは ICMP が塞がれているだけで、サーバーは動いている）");
});
