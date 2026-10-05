# network-trace-3d

Webページが表示されるまでの通信と、障害の切り分けを、章ごとの3D模式図とCLIで追う教材です。

各章のシミュレーション（`src/chapters/chNN-*/sim.ts`）が手順の配列を返します。立体図（three.js）とCLIは、同じ配列を表示します。

| 章   | 内容                                                            |
| ---- | --------------------------------------------------------------- |
| ch01 | ブラウザでの画面表示の流れ（DNS → TCP → TLS → HTTP → 描画）     |
| ch02 | IPアドレスとサブネット、デフォルトゲートウェイ                  |
| ch03 | TCPとUDP、再送                                                  |
| ch04 | ポートとファイアウォール（DROPとREJECT、127.0.0.1での待ち受け） |
| ch05 | DNSとTTL、キャッシュ                                            |
| ch06 | HTTPのステータスコード（502と504）                              |
| ch07 | HTTPSと証明書（期限切れ、中間証明書、名前の不一致）             |
| ch08 | プロキシとロードバランサ（X-Forwarded-For、ヘルスチェック）     |
| ch09 | ping、dig、curlによる切り分け                                   |

## 動かし方

実行には、Node.jsの26以上とpnpmが必要です。

```sh
pnpm install
pnpm dev                    # http://localhost:5173 で立体図を開く
pnpm cli                    # 章の一覧
pnpm cli ch04               # 章のシナリオ一覧
pnpm cli ch04 drop          # 手順を端末に表示
```

立体図はドラッグで回転し、ホイールで拡大縮小できます。URLに`?ch=ch04&sc=drop&step=3`を付けると、章、シナリオ、手順を直接開けます。

## 検査

```sh
pnpm check                  # 整形、リント、型検査（Vite+）
pnpm test                   # node:test による単体テスト
pnpm verify                 # Playwright で全章・全手順を実ブラウザ再生し、描画とコンソールエラーを確かめる
pnpm verify --shots         # 各手順の画面を shots/ に保存する
pnpm build && pnpm verify --dist
pnpm mutation               # StrykerJS による変異テスト
```

`pnpm verify`を初めて使う前に、`pnpm exec playwright install chromium`を実行します。

`stryker.config.json`の`tsconfigFile`は、存在しないファイルを意図して指しています。TypeScript 7はJavaScriptのAPIを持たないので、StrykerJSによるtsconfigの読み込みを止めています。

## ライセンス

MIT
