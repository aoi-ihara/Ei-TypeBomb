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

| イベント | 最大バースト件数 | 毎秒の回復件数 |
| --- | ---: | ---: |
| `currentInput` | 60 | 30 |
| `word:success` | 10 | 5 |
| `room:join` | 5 | 2 |
| `room:leave` | 5 | 2 |
| `game:start` | 2 | 1 |
| `auth:response` | 3 | 0.5 |

入力には高速なタイピングと通信遅延による短時間の集中送信の余裕を持たせ、
DBアクセスを伴う認証・ゲーム開始には低めの閾値を設定しています。
設定は `../shared/rateLimits.ts` にあり、`src/lib/socketRateLimit.ts` が接続ごとに適用します。

超過分はハンドラー実行前に破棄し、エラー返信・ログ出力・遅延実行・切断は
行いません。入力の超過は単語成功や退室の枠を消費せず、サーバー内部の
イベント送信や切断時のクリーンアップにも影響しません。破棄された入力は
再送しないため、観戦表示は次の受理された入力で更新されます。

状態は接続内で保持し、タイマーは使いません。再接続では枠がリセットされます。
IP単位・複数接続をまたぐ制限は対象外です。

検証: `npm test`（レート制限と実接続でのbroadcastテスト）、`npm run build`。

共通ゲームコアと runtime の境界、ビルド出力、将来の拡張については
[共通コアのREADME](../shared/README.md) を参照してください。

## ETB Console

TTYではDashboardの `C` からControl Menuを開きます。設定一覧では
`↑` / `↓` または `Tab` / `Shift+Tab` で移動、`Enter` で開き、`Esc` で戻ります。
SGRマウス対応端末では項目をクリックして開くこともできます。

編集を開くと現在値が全選択されるので、新しい値をそのまま入力できます。
`←` / `→`、`Home` / `End`、Backspace / Deleteで部分編集もできます。
`Enter` で保存、`Esc` でキャンセル。`Tab` で入力欄・Save・Cancelを移動できます。
入力エラーや保存失敗時は編集内容を保持します。

- **Port**: 1〜65535。保存後の次回起動時に適用します。環境変数 `PORT` が
  優先される場合は、稼働中のポートと保存値を別々に表示します。
- **Terminal Width**: 40〜1000文字。編集中に実際の端末幅で制限したプレビューを
  表示し、保存後は即座に描画幅へ適用します。
- **Logs**: 既存の `logs/server.log` を表示します。`↑` / `↓`、
  `PageUp` / `PageDown` でスクロール、`Home` で表示範囲の先頭、
  `End` または `F` で最新ログへの追従に戻ります。`←` / `→` で長い行を
  横スクロールします。`Esc` または `Q` でControl Menuへ戻ります。
  メモリと読み込み負荷を制限するため、表示範囲は末尾128 KiBです。
  追従停止中は内容を固定し、新しいログによるスクロール位置の移動を防ぎます。

設定保存先は `console.config.json` です。マウス・Raw Mode・カーソルは
終了時に復元します。非TTYでは対話UIを無効にし、通常のログ出力を維持します。
