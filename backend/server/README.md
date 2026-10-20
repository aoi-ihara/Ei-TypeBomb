# Room configuration lookup

Only a fresh room instance loads settings/items from Supabase PostgREST with the
verified room JWT and publishable key. No service-role key or PostgreSQL control
connection is used. Existing games recover exclusively from peer checkpoints.

# Socket.IO rate limit

受信イベントは socket・イベントごとのトークンバケットで制限します。
接続時はバケットが満杯で、受信1件につき1トークンを消費し、経過時間に
比例して回復します。未使用分は最大バースト件数まで保持します。

| イベント          | 最大バースト件数 | 毎秒の回復件数 |
| ----------------- | ---------------: | -------------: |
| `currentInput`    |               60 |             30 |
| `word:success`    |               10 |              5 |
| `room:join`       |                5 |              2 |
| `room:leave`      |                5 |              2 |
| `game:start`      |                2 |              1 |
| `auth:response`   |                3 |            0.5 |
| `health:ping`     |                2 |            0.2 |
| `health:database` |                2 |            0.2 |

入力には高速なタイピングと通信遅延による短時間の集中送信の余裕を持たせ、
DBアクセスを伴う認証・ゲーム開始には低めの閾値を設定しています。
設定は `../shared/rateLimits.ts` にあり、`src/lib/socketRateLimit.ts` が接続ごとに適用します。
ヘルスプローブは再接続による回避を防ぐため、接続ごとの制限に加えて送信元アドレス単位でも制限します。
RTT プローブは ID を検証してからアドレス枠を消費し、不正な ID には応答しません。

超過分はハンドラー実行前に破棄し、エラー返信・ログ出力・遅延実行・切断は
行いません。入力の超過は単語成功や退室の枠を消費せず、サーバー内部の
イベント送信や切断時のクリーンアップにも影響しません。破棄された入力は
再送しないため、観戦表示は次の受理された入力で更新されます。

接続ごとの状態は切断時に破棄し、タイマーは使いません。ヘルスプローブの
アドレス枠は 60 秒以上未使用の状態を掃除し、保持数を最大 1,000 件に制限します。
その他のイベントは接続単位の制限です。

検証: `npm test`（レート制限と実接続でのbroadcastテスト）、`npm run build`。

共通ゲームコアと runtime の境界、ビルド出力、将来の拡張については
[共通コアのREADME](../shared/README.md) を参照してください。

## Distributed topology configuration

Set the **same** `ETB_CLUSTER_CONFIG` on Vercel and every game server:

```dotenv
ETB_CLUSTER_CONFIG='{"version":1,"servers":["https://primary.example.com","https://worker.example.com/ws","https://render.example.com"]}'
```

The array defines priority and `/ws` identifies Workers. `CLUSTER_SERVER_TOKEN` is optional: hosts automatically create persistent signing keys and verify peers through their configured HTTPS `/cluster/identity` endpoints. Set `SERVER_PUBLIC_URL` on hosts whose identity is ambiguous; Render uses `RENDER_EXTERNAL_URL`, and a sole Worker entry is selected automatically. Keep `CLUSTER_STATE_DIR` on persistent storage. See [distributed setup](../DISTRIBUTED.md) for migration and trust rules.
