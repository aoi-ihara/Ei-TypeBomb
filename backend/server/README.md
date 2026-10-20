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

The array defines priority and `/ws` identifies Workers. Server-specific keys and `CLUSTER_SERVER_TOKEN` authentication have been removed. Node restores its URL from `CLUSTER_STATE_DIR`; a fresh local Node defaults to Primary, Render uses `RENDER_EXTERNAL_URL`, and a sole Worker entry is selected automatically. Set `SERVER_PUBLIC_URL` for other replicas or multiple Workers. Keep voting state on persistent storage. Peer access is trusted: public declarations do not prevent impersonation. Player JWT authentication remains required. See [distributed setup](../DISTRIBUTED.md).

### Changing server URLs without discarding room state

For URL rotations use **version 2** of `ETB_CLUSTER_CONFIG`. The ordered entries
have a stable voter `id` and an independently editable `url`:

```dotenv
ETB_CLUSTER_CONFIG='{"version":2,"servers":[{"id":"primary","url":"https://primary.example.com"},{"id":"worker","url":"https://worker.example.com/ws"},{"id":"render","url":"https://render.example.com"}]}'
SERVER_NODE_ID=primary
```

The same JSON must be deployed to **every** server and the frontend. Set
`SERVER_NODE_ID` only on a server that cannot reliably select itself using
`SERVER_PUBLIC_URL` or Render's `RENDER_EXTERNAL_URL`. Node with persistent
`CLUSTER_STATE_DIR` restores its ID automatically; do not delete this directory
to change its URL. Changing only `url` (while retaining `id`, order and transport)
preserves stored voter boots, room checkpoints, and ongoing room instances after
restart. The public route response includes both the voter ID and the new
connection URL. For Workers, keep the `/ws` suffix on the URL.

**Upgrading an existing version-1 cluster:** the server's original URL is
already its durable voter ID and is embedded in previous checkpoints. Set the
new version-2 `id` to that **original origin exactly**, even if the `url`
changes. Example:

```dotenv
ETB_CLUSTER_CONFIG='{"version":2,"servers":[{"id":"https://old-primary.example.com","url":"https://new-primary.example.com"},{"id":"https://old-worker.example.com","url":"https://new-worker.example.com/ws"}]}'
```

After migrating, retain those IDs across all further URL changes. Choosing
new friendly IDs for an existing cluster would make its old voting records
incompatible, so use friendly names only when starting a brand-new cluster.

**Not a live voter reconfiguration:** changing priority/order, membership,
or transport still fails closed while old voting records exist. Those changes
need a coordinated drain and a separate membership migration protocol; this
change does not claim to safely implement them. Roll out endpoint changes to
all nodes and Vercel together. During a rolling deployment, stale connection
URLs can temporarily be unreachable until all nodes are updated.
