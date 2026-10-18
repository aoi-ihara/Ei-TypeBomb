# Database connection

The Socket.IO server reads room configuration directly from PostgreSQL with a
least-privilege database role. It no longer needs a Supabase service-role key.

Set `SUPABASE_DATABASE_URL` to a PostgreSQL connection string that authenticates
as the read-only `etb_server` role. The role only needs `SELECT` access to
`public.ei_typebomb_rooms` plus the matching RLS policy.

Do not expose this connection string to the client or commit it to the repository.

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

Node.js accepts `PRIMARY_SERVER_URL`, `PARENT_SERVER_URL`, and optional
`SERVER_PUBLIC_URL`. The same variables are supported by Cloudflare.
For a primary, leave `PARENT_SERVER_URL` unset; replicas point to their
immediate parent. Distributed mode requires `SERVER_PUBLIC_URL`, a dedicated
`CLUSTER_SERVER_TOKEN` and the control migration. See
[setup and failover guarantees](../DISTRIBUTED.md) before enabling it.
