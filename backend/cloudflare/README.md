# Ei-TypeBomb — Cloudflare Workers

`../server` の対戦サーバーを Workers + Durable Objects に移植した実装です。
ルームごとに `GameRoom` を割り当て、参加者・対戦状態を永続化します。
WebSocket Hibernation とアラームを使用し、休止・復帰をまたいでゲームを継続します。
Supabase の既存 `ei_typebomb_rooms` テーブルは読み取りのみで使用します。

## ローカル起動

```sh
cd backend/cloudflare
npm ci
cp .dev.vars.example .dev.vars
# .dev.vars に実際の値を設定
npm run dev
```

必要な値:

- `JWT_SECRET`: client がルーム入室トークンの署名に使う値と同一。
- `SUPABASE_DATABASE_URL`: `server` と同じ、読み取り専用ロールの PostgreSQL 接続文字列。
- `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_HOST`: 任意。未設定時はイベント送信を無効化。

`wrangler.jsonc` の `ALLOWED_ORIGINS` にクライアントの origin をカンマ区切りで指定します。
初期値は `http://localhost:3000`。パスや末尾スラッシュは含めません。

## クライアントの切り替え

既存 client に共通アダプター `lib/room/socket.ts` を追加済みです。
クライアント側の環境変数を次のように設定し、開発サーバーを再起動（本番は再ビルド）してください。

```dotenv
NEXT_PUBLIC_PRIMARY_SERVER_URL=http://localhost:8787/ws
# 従来の Socket.IO サーバーを予備にする場合
# NEXT_PUBLIC_BACKUP_SERVER_URL=https://YOUR_EXISTING_SERVER
```

本番は `https://YOUR_WORKER.workers.dev/ws` またはカスタムドメインの `/ws` にします。
ブラウザーに接続先の上書きを保存している場合は、そちらも変更してください。
`NEXT_PUBLIC_RENDER_URL` を参照する表示を使う場合は、その接続先も同様に設定します。

**末尾の `/ws` がプロトコル選択の目印です。** 通常の URL は従来どおり Socket.IO、
`/ws` 付き URL は標準 WebSocket を使用します。Workers は Socket.IO プロトコルを実装しません。
外部クライアントは下記仕様に合わせる必要があります。
異なるサーバー（Workers と従来 server）間で進行中の対戦状態は共有されません。

## デプロイ

### Cloudflare Workers Builds（Git連携）

Worker の **Settings > Build** に以下を設定してください。

| 項目 | 設定値 |
| --- | --- |
| Root directory | `backend/cloudflare` |
| Build command | `npm ci --include=dev && npm run build` |
| Deploy command | `npm run deploy` |

コマンドは Root directory 内で実行されるので、`cd cloudflare` は付けません。
`wrangler` は devDependencies にあるため、`--include=dev` でビルド用の依存関係も
インストールします。`npm run build` は dry-run のみで、公開は Deploy command が行います。
ビルド対象のブランチに `backend/` への移動が反映されていることも確認してください。
共通コードの `backend/shared/` は同じリポジトリから読み込みます。

設定仕様: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)。

### CLI

```sh
cd backend/cloudflare
npm ci --include=dev
npx wrangler secret put JWT_SECRET
npx wrangler secret put SUPABASE_DATABASE_URL
# 任意: npx wrangler secret put NEXT_PUBLIC_POSTHOG_KEY
npm run deploy
```

デプロイ前に `ALLOWED_ORIGINS` を本番クライアントの origin に変更してください。
`.dev.vars` はローカル専用で、本番にはアップロードされません。
初期テンプレートの migration `v1` を残し、`v2` でサンプル `MyDurableObject` を削除して
`GameRoom` を作成します。サンプル Durable Object に独自データを保存していた場合は、
削除前に移行してください。Cloudflare は `pg` で PostgreSQL に読み取り接続します。
`SUPABASE_DATABASE_URL` は `server` と同じ Supabase PostgreSQL 接続文字列を設定します。
既存 Supabase データに変更はありません。

## 通信仕様

- `GET /health` または `/`: 死活監視 JSON。
- `GET /ws/<ルームUUID>`: WebSocket upgrade。`/ws/health` は未認証の接続確認用。
- JSON フレーム: `{ "event": "イベント名", "data": ペイロード }`。
- 接続直後: `connect` (`{id}`)、続いて `auth:request`。
- `auth:response`: `{jwtToken, displayName}`。HS256 署名・期限・JWT の `id` と接続先ルームの一致を検証。
  URL には JWT を含めません。認証するまでルーム情報を配信しません。
- 受信: `room:join`, `room:leave`, `game:start`, `word:success`, `currentInput`（文字列）。
- 配信: `room:broadcast`, `typing:input`, `game:end`, `game:quited`, `error`。
- `ping` に `pong` を返します。アダプターは25秒間隔で送信。
  未認証接続は20秒、認証済みは75秒間応答がないと切断して参加者を除去します。

既存のイベント別トークンバケット制限、表示名上限50文字、入力上限32文字を維持します。
ゲーム開始3秒後に単語を表示し、設定秒数 + 0〜10秒ごとに爆弾を進め、5回目で終了します。
プレイヤーが退出・切断すると対戦を中断し参加者をリセットします。
`room:leave` は観戦接続を残すので、同じ接続から再参加できます。
観戦者のゲーム開始とカウントダウン中の単語成功は拒否します。

ファイルログ・常駐端末 UI は Workers の構造化 `console` ログに置き換えています。
PostHog の対戦イベントは `waitUntil` で送信します。既存の Node 向け OTLP ログ転送は移植対象外で、
必要な場合は Cloudflare 側のログ転送を別途設定してください。

## 検証

```sh
npm run cf-typegen  # バインディング変更時
npm run typecheck
npm test
npm run build      # wrangler deploy --dry-run（公開しない）
```

統合テストは Workers ランタイムで WebSocket・認証・DB 応答・人数制限・入力・
退出・永続化・アラームを検証します。DB 応答には fixture を使うため、本番 DB の書き換えはありません。
テストプールの Miniflare / Wrangler は overrides で開発用ランタイムと揃えています。

参考: [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、
[Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)。

共通ゲームコアと runtime の境界、deadline と将来の拡張については
[共通コアのREADME](../shared/README.md) を参照してください。
