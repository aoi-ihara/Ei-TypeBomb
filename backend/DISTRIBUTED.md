# 分散ルームとフェイルオーバー

PR #366 の署名付きタブセッションを使う、任意長の**順序付きチェーン**です。Mac mini / Render は同じ Node エントリーポイントです。Worker は既存の GameRoom namespace を使います。ゲームの選問・爆弾・脱落処理は `shared/game.ts`、所有権と復元は `shared/distributed/` に共通化しています。

## 整合性と可用性

Supabase PostgreSQL を、ゲームサーバーから独立した**必須の耐久レプリカ兼制御基盤**として使います。所有権とゲーム状態は別テーブルです。状態の確定と fencing の検査は同じトランザクションで行います。所有者・instance・epoch・revision・DB時刻による3秒リースを検査し、成功した保存ACKを受けてからゲーム結果を配信します。リースは1秒ごとに更新します。制御基盤へ到達できなければゲームの確定を止め、所有権を再確認して再接続します。クライアントの申告でリースを失効させません。

下位すべてへ直接 `/internal/replicate` を通知します。途中の親の停止に依存しません。typing/hint は100ms単位で最新値をまとめ、変化がなければ送信しません。重要イベントはすぐ保存・通知し、接続がある間は5秒ごとに全snapshotを通知します。下位サーバーのACKが欠落しても、独立した必須レプリカであるPostgreSQLのACKがある場合は確定できます。**下位ゲームサーバーだけのACKをクォーラムにはしません**。この選択により、Workerが直後に停止してもRenderはPostgreSQLから確定状態を取得できます。

直接通知はsnapshot/deltaと基準revisionを含みます。ただし、受信側は通知内容を権威として採用せず、DBが発行した不透明なreceipt、送信者の10秒JWT（issuer・受信者audience・対象ルーム・instance/epoch/revisionを検証）、自分の専用資格情報を使って現在のcheckpointを取得します。この取得が欠落・古いdeltaの修復も兼ねます。したがって現実装は**制御基盤との間では完全なJSON checkpointを転送**します。純粋な差分だけの永続化ではありません。下位のローカルキャッシュから昇格することはありません。

新規ルームは直近10秒以内に登録された最上位で作成します。既存ルームは保存されたownerへ接続し、リース切れの後に下位が原子的に引き継ぎます。上位への移動はDBで拒否します。同一URLのプロセス再起動もepochを更新して旧プロセスをfenceします。複数候補が競合してもDBのroom単位ロックとrevision CASで1台だけが確定できます。サーバーのalive情報と親子情報はDBに保持するため、親停止時も失われません。起動時の登録は親への論理的な登録を共通レジストリ経由で行い、親HTTPへの到達を必須にしません。

移行では最後に確認できた所有者のリース更新時刻からタイマーを停止し、全参加者の再接続か20秒の復帰期限まで待ちます。期限後、未復帰者には既存の通常切断処理を適用します（生存プレイヤー退出なら試合をキャンセル）。席順・問題index・ゲームID・爆弾は再抽選しません。一時的なtransport切断は即時退出にしません。観戦者を含む全接続の復帰猶予が終わり、ゲームが動いていないことを確認して、DELETING→DELETEDのtombstoneを保存します。再作成は別instanceです。

## 手動設定（本番への適用・デプロイは別途必要）

1. `pgcrypto` を `extensions` schemaで利用できることを確認し、`supabase/migrations/20261018142210_distributed_room_control.sql` を管理者のSQL Editor/通常のmigration手順で適用します。`etb_private` はData APIの公開schemaに追加しないでください。
2. サーバーごとに32バイト以上のランダムトークンを生成し、管理者として以下を**親から順に**登録します。URLはHTTPSのoriginのみ・末尾のスラッシュなし。depthは0から連続、重複不可です。新しい下位を追加するときも同じSQLだけで既存コードの変更は不要です。

```sql
-- 実際のURLと安全に生成したトークンに置換。トークンをGitへ保存しない。
insert into etb_private.servers(id, token_hash, parent, depth, transport)
values
 ('https://PRIMARY_HOST', sha256(convert_to('PRIMARY_RANDOM_TOKEN', 'UTF8')), null, 0, 'socket.io'),
 ('https://WORKER_HOST', sha256(convert_to('WORKER_RANDOM_TOKEN', 'UTF8')), 'https://PRIMARY_HOST', 1, 'websocket'),
 ('https://RENDER_HOST', sha256(convert_to('RENDER_RANDOM_TOKEN', 'UTF8')), 'https://WORKER_HOST', 2, 'socket.io');
```

3. 各ゲームサーバーに以下を設定します。Nodeの `PORT` は省略時3001、Renderではプラットフォーム指定を使えます。

```dotenv
PRIMARY_SERVER_URL=https://PRIMARY_HOST
PARENT_SERVER_URL=                 # Primaryのみ空。それ以外は直前のサーバーのorigin
SERVER_PUBLIC_URL=https://THIS_HOST
CLUSTER_SERVER_TOKEN=THIS_SERVER_RANDOM_TOKEN
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=EXISTING_PUBLISHABLE_KEY
JWT_KEY_ID=EXISTING_KEY_ID
JWT_PUBLIC_KEY=EXISTING_PUBLIC_JWK
```

`CLUSTER_SERVER_TOKEN` はサーバー専用secretです。Workerでは `wrangler secret put CLUSTER_SERVER_TOKEN`、Nodeではプロセスのsecret/environmentに配置します。ゲームサーバーにJWT秘密鍵、Supabase service_role、DB接続文字列は配置しません。RPCの権限は、このサーバーの登録とクラスタ内の許可されたルーム操作に限定されます。無効化は管理者が `enabled=false`、ローテーションは `token_hash` を更新します。

4. Workerの上記varsと既存の `ROOMS` binding、`ALLOWED_ORIGINS` を設定します。既存のDO namespace/classは維持します。1分間隔のscheduled handlerは登録情報を更新します。アクティブルームのリース・タイマーはDO alarmが処理し、バックアップだけのDOではゲームを進めません。preview環境にも同じ設定一式を別途設定してください。
5. フロントエンドを、既存のbootstrap URLと `NEXT_PUBLIC_DISTRIBUTED_ROOMS=true` で**再ビルド**します。bootstrapは到達先の種であり、台数制限ではありません。以後の候補は認証済みroute APIから取得し、ページ内で保持します。Workerのbootstrap URLは従来どおり `/ws` 付きでも使えます。少なくとも2つのbootstrapを設定すれば、最初のアクセス時からPrimary停止に対応できます。
6. JWT issuer=`ei-typebomb`、room audience=`authenticated`、session audience=`ei-typebomb:client-session` を署名時・検証時の両方に設定しています。既存のissuer/audienceなしcookieは再入室で再発行してください。タブセッションは移行時に再発行せず同じものを使います。
7. 各ホストの時計を同期し、各サーバーの `/health` とroom JWTを使った `/cluster/route`、registry、所有者移行をステージングで確認してから有効化してください。HTTPS/WSSが必須です（localhostのテストのみHTTPを許可）。

## テスト

Nodeの既存テストに加え、実際のPostgreSQLで所有権競合・旧epoch・登録拒否・tombstone・追加サーバーを検証します。さらにworkerd/Miniflareと実Socket.IOを起動し、NodeプロセスをSIGKILL→Worker復元→Primary再起動時のowner維持→Worker停止→別Nodeへの復元をテストします。フロントエンドのRoutedSocketも同じ通信に接続し、自動切り替えを検証します。

```sh
npm ci --prefix backend/server
npm ci --prefix backend/cloudflare
# 必ず使い捨てDBを指定。このテストはetb_private schemaを削除・再作成します。
export ETB_TEST_DATABASE_URL=postgresql://USER:PASS@localhost:5432/etb_failover_test
# 通常のPostgreSQLのみ: create role anon; create role authenticated;
npm test --prefix backend/server
npm run test:integration --prefix backend/cloudflare
npm run typecheck --prefix backend/server
npm run build --prefix backend/server
npm run typecheck --prefix backend/cloudflare
npm test --prefix backend/cloudflare
cd backend/cloudflare && npx wrangler deploy --dry-run
```

DB未指定時の通常テストではPostgreSQLを必要とするテストだけskipします。専用GitHub ActionsはPostgreSQLを起動して両方を実行します。本番資格情報・本番DBはテストに使用しません。

## 制限・運用コスト

- 設定前は分散モードを有効にしません。トポロジーだけ設定して必要なsecretを欠く場合は起動/処理を拒否します。従来のstandaloneは残ります。
- クラスタは任意長の直列チェーンです。分岐した木、多地域DBの合意、DB自体の障害継続は対象外です。DBが不明なら停止します。
- 512KiBのcheckpoint制限、受信サイズ制限、game command/heartbeatの頻度制限があります。大規模catalogや長時間のイベント履歴は制限に達する可能性があります。
- 100msは入力のバッチ間隔です。ネットワーク/DBの遅延時に100ms以内の到着を保証しません。重要イベントはDB往復の遅延を受けます。
- Workerのalarm、heartbeat、受信側の検証read、完全checkpointの書き込みが発生します。常時稼働・多数ルームで無料枠内になる保証はありません。実測と課金アラートが必要です。DOへの永続書き込みは重要イベントと5秒snapshotへまとめますが、入力のDB保存・検証readは残るため、長時間運用には転送量の追加最適化が必要です。
- 本番Mac mini / Cloudflare / Renderへのデプロイと実停止演習は未実施です。自動テストはローカルPostgreSQLとworkerdであり、実クラウド間のRTT・DNS・TLS・プラットフォーム停止は別途確認してください。
