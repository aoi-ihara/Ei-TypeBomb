# WebSocket分散ルーム（PR #367 設計変更）

## 保存先と接続

ゲーム状態・プレイヤー・トポロジー・所有権・確認状態にPostgreSQL/Supabaseを使いません。DBへのアクセスは担当Primaryが**新しいルームインスタンス**を作成するときの設定・問題取得だけです。移行時はレプリカの確定checkpointを使います。ルームが不明で必要なサーバーに接続できない場合、DBから作り直さず停止します。フロントエンドの既存のルーム編集・認証・オンライン記憶機能は変更しません。

Nodeはメモリだけを使い、Mac miniとRenderで同じプログラムを動かします。Workerは `ClusterDO` が接続とトポロジー、ルーム別 `ReplicaDO` が投票状態・checkpoint・tombstoneを保持します。既存 `GameRoom` はゲーム通信/タイマーのアダプターです。ゲームルールは `shared/game.ts`、複製・所有権確認は `shared/distributed/` に共通化しています。

環境変数は既存の3項目と、サーバー専用の署名付きidentity bundleです。

```dotenv
PRIMARY_SERVER_URL=https://PRIMARY_HOST
PARENT_SERVER_URL=                 # Primaryだけ空
SERVER_PUBLIC_URL=https://THIS_HOST
CLUSTER_SERVER_TOKEN=JSON_IDENTITY_BUNDLE
# 既存のroom/session JWT公開鍵、Supabase publishable設定は新規設定取得用に維持
# 任意: CLUSTER_DRAINING=true（所有権譲渡を承認する運用モード）
```

子は親の `/cluster/ws` にWSS接続して登録し、認証済みトポロジーを伝播します。既知の他サーバーにも直接接続でき、親停止でレジストリを捨てません。台数・Node/Workerの位置はコードに固定していません。登録できるidentityはオフラインCAが署名したURL・親・depth・transportに限定します。

## 所有権と確定方式：可用性最優先

このPRは**ゲームを止めないこと**を優先し、過半数や末尾のACKがなくても、所有者が持つ署名付きcheckpointをローカルで確定できるようにしています。RenderがスリープしていてもMac miniとWorkerは動作し、Mac miniが落ちた後も、Workerにcheckpointが保存済みなら**Worker単独で移行・続行**できます。さらにWorkerが落ちても、Renderにcheckpointが既に届いていればRender単独で復旧できます。

- 各ルームにはinstance、owner、epoch、revision、固定投票者集合と署名付きcheckpointが存在します。
- ゲームイベントは現ownerのローカル保存と署名により確定し、下位へのWebSocketレプリケーションは**best-effort**です。100ms入力集約と5秒Snapshotは維持します。
- 新規ルーム作成時と所有権移行時には、応答する下位サーバーへの初期checkpoint配布を最大150ms待機します。それを超えてもゲームを停止しません。
- 障害報告を受けた下位候補は、元ownerの健全性を確認します。元ownerが応答せず、候補が同じルームの証明済みcheckpointを保持していれば、**他ノードの同意を待たず**新epochで引き継ぎます。
- フェイルバックは引き続き行いません。クライアントは得られる範囲で最大epochのownerを探します。旧ownerは他サーバーの新epochを再発見した時点で停止する仕組みです。
- イベントID重複排除と、偽造した署名/別ルーム/旧epochを拒否する検証は維持します。

### 意図的な整合性上の制限

**ネットワーク分断中の二重進行と、その際のゲーム操作の消失を許容します。** 1台のACKだけで確定する以上、独立した複数の生存サーバーが同じルームで同時に進行することを完全に防ぐことはできません。ネットワークが復旧した時により新しいepochのcheckpointが優先され、選ばれなかった側の操作は巻き戻る可能性があります。

特に「クライアントが正解を見た直後に所有サーバーだけが停止し、その正解がどの下位レプリカにも転送されていない」場合、最後の正解・爆弾位置などが失われる可能性があります。**この実装には厳密な一貫性・線形化可能性・ゼロデータ損失の保証はありません。** これはETBのライブゲームで停止時間を最小化するために選んだトレードオフです。対戦結果や学習記録について事後照合を必須にする用途には、このモードをそのまま使わないでください。

オフライン署名CA、接続nonceと相互認証、ルームごとのrevision検証は引き続き使用します。Byzantine動作、鍵漏洩、同じidentityでのNode複数同時起動は対象外です。

## 継続できる条件・停止する条件

| 稼働状況 | 可能な操作 |
|---|---|
| Primary + Worker + Render | 通常運用、下位へ非同期複製 |
| Primaryのみ | Primary上でゲームを継続できる（ただし未複製の状態を失う可能性） |
| Workerのみ | Workerが該当ルームのcheckpointを既に持つ場合、単独で引き継ぎ・継続 |
| Renderのみ | Renderが同ルームの有効なcheckpointを既に持ち、Nodeプロセスが再起動せず残っている場合に継続 |
| どのサーバーにも対象ルームのcheckpointがない | 復元不可能。推測でDBからゲームを再構築しない |

Node.jsは投票状態・ゲーム状態をメモリに保持します。スリープ/終了したRenderが再起動すると元の起動IDとメモリを失うため、**再起動したRenderが単独で古いゲームを復元できるわけではありません**。WorkerのDurable Objectsには永続化したcheckpointがあり、復元適性が異なります。

初期化時に署名済みrosterの先頭から連続した登録済みノードをルームの固定投票者として採用します。Primary1台でも新規ルームは開始できますが、その時にまだ登録されていない後続サーバーはそのルームの選出投票者になりません。非投票ミラーを自動的に選出投票者へ変更する機能はありません。**完全なフェイルオーバーを希望する場合は、必要な下位サーバーがゲーム開始前に登録されていることを確認してください。**

## 同期・復元・削除

入力/hintは最新値を100ms単位で集約し、JSON差分を送ります。欠落した基準hashの場合、認証済みWebSocketから完全な提案を再取得します。変化のない入力は送信しません。開始・正解・爆弾移動・脱落・終了・接続状態はローカルで即時確定し、下位へベストエフォートで複製します。接続中のルームは5秒ごとにも完全checkpointを送ります。確定checkpointは下位への直接送信も行うため、親経由だけに依存しません。非投票レプリカが受信しただけではゲームを進めません。確定直後の停止では、送信前のイベントが失われる可能性があります。

クライアントはforegroundで約1.25秒応答がないと下位へ `/cluster/report` を送ります。room JWTと同じタブのsession JWT、room ID、認識したowner、最後のrevision、failureフラグを検証します。バックグラウンドでは応答監視を抑え、復帰後もサーバー側確認を必須にします。認証中には別の猶予を設けます。

復元は署名された最新確定checkpointから行います。座席、表示名、game ID、爆弾ID/位置/段階/turn、選択済み問題、入力、推薦情報、イベント重複排除を引き継ぎます。移行中はタイマーを止め、参加者全員の再接続または20秒の復帰期限後に再開します。期限後の未復帰者には既存の通常退出処理を適用します。残り時間の再構成には保存時刻と最終確認時刻を使い、既に期限付近なら最小の復帰余裕を設けます。ホスト間の時計同期は必要ですが、時計を所有権の根拠にはしません。

全transport接続の復帰猶予が終了し、試合が動いていないことを確認してDELETEDのtombstoneを所有サーバーで確定し、下位へ非同期同期します。tombstoneは自動破棄しません。古いsnapshotは状態を上書きできず、再作成では新instanceと大きいepochを使います。ownerも必要な投票者も不在なら削除を推測で確定しません。

## デプロイとメンバー追加・削除

1. identityを安全なディレクトリへ作成します。URLはHTTPS origin、順序・transportは引数で指定します。

```sh
cd backend/server
node scripts/cluster-credentials.mjs /PRIVATE/NEW_DIRECTORY \
  socket.io=https://PRIMARY_HOST websocket=https://WORKER_HOST socket.io=https://RENDER_HOST
```

`server-N.json` の内容を各サーバーの `CLUSTER_SERVER_TOKEN` secretへ設定します。`offline-authority.json` はオフライン保管し、どのゲームサーバーにも置かないでください。サーバーの署名秘密鍵はそのサーバーidentity専用で、ユーザーJWT署名やSupabase管理権限はありません。従来のランダムなDB capability文字列は新形式に自動変換しません。

旧PostgreSQL版とのローリング混在はできません。旧版の進行中ルームを終了し、全旧サーバーを停止してからクラスタ全員を同じ新版へ切り替えてください。旧版のcheckpointの自動インポートは行いません。

2. 3つのURL環境変数を証明書と一致させます。Nodeは `PORT` を利用できます。Workerには既存ROOMSに加えCLUSTER/REPLICASのDO bindingと `distributed-v2` migrationを設定します。`wrangler.jsonc` に定義済みです。previewにも必要です。Node/Worker間で `/cluster/ws` のWSSを許可し、プロキシのWebSocket idle timeoutを確認してください。
3. サーバー間の認証済み接続と初期checkpoint配送を確認し、frontendを `NEXT_PUBLIC_DISTRIBUTED_ROOMS=true` とbootstrap URLで再ビルドします。台数はbootstrapの3変数に制限されず、登録情報から取得します。session JWTは接続先変更で再発行しません。
4. 追加ノードは有効なCA証明書と親URLで登録でき、既存コード変更なしでバックアップを受信できます。ただし、**既存ルームの投票者集合は自動変更しません**。新規ルームの投票者はCA署名付きrosterのうち、登録済みの先頭から連続する認証済みメンバーで固定します。Primary単独でも新規ルームは作成できますが、未登録のレプリカは既存ルームの選出投票者になりません。
5. 新しい投票者構成の有効化や削除・順序変更では、旧構成のルームを先に終了/削除し、同じオフラインCAで新rosterのidentityを発行して全員へ設定します。`--authority /PRIVATE/offline-authority.json` を生成コマンドの先頭に指定すれば同じCAを利用できます。既存ルームの投票者構成の変更には、新しい構成での再作成が必要です。動的登録と投票者の安全な変更は区別しています。稼働中の投票者の無条件除去や自動joint-consensus再構成は実装していません。
6. `CLUSTER_DRAINING=true` のownerは照会時に譲渡を承認します。通常は正常ownerへの虚偽報告で移行しません。管理者CAは信頼境界なので、同じルームが生きたまま互いに独立したrosterを発行しないでください。

PostgreSQL制御RPCと専用migrationはリポジトリから削除しました。旧PRのSQLをすでに手動適用した環境では、旧アプリの停止後に管理者が `public.etb_cluster(text,text,text,jsonb)` と `etb_private` schemaを撤去してください。この変更は本番DBへ接続して撤去作業を実行しません。通常のルーム設定テーブルには触れません。

## 検証とコスト

```sh
npm ci --prefix backend/server
npm ci --prefix backend/cloudflare
npm test --prefix backend/server
npm run test:integration --prefix backend/cloudflare
npm run typecheck --prefix backend/server
npm run build --prefix backend/server
npm run typecheck --prefix backend/cloudflare
npm test --prefix backend/cloudflare
cd backend/cloudflare && npx wrangler deploy --dry-run
```

PostgreSQL、DB資格情報、外部サービスへの接続はテストに不要です。実通信テストはMac miniとRenderに相当するNodeプロセスをSIGKILLし、Workerが単独で進行中のゲームを継続できることを検証します。Render単独の進行は別のNode単体テストで確認します。正常owner拒否、認証拒否、Primary復旧後の新規作成、差分、ACK消失、同じタブIDを検証し、DBアクセスを設定取得だけに制限するカウンターも検査します。単体テストは承認移行、通信分断中の二重進行許容、単独稼働、Renderスリープ中の確定、メモリ消失、旧epoch、重複・逆順、tombstoneを検証します。CIにもDBサービスはありません。

メモリ/メッセージ上限はcheckpoint約512KiB、frame 2MiB（選出時の新旧checkpointを含む）、registry/roster 1,000件、接続当たりpending RPC 128件です。100msは集約間隔で、ネットワーク到達の保証ではありません。大規模構成では暗号検証とACKの遅延を実測してください。

標準WebSocketの接続はClusterDOを稼働状態に保ち、duration課金が発生します（[Cloudflareの説明](https://developers.cloudflare.com/durable-objects/examples/websocket-server/)）。現実装はhibernationで接続/未処理ACKを誤って復元しない方を優先しています。DOストレージは投票promise・確定状態のACK前保存に必要であり、高頻度入力では書き込みも増えます。無料枠内の常時運用は保証しません。本番デプロイと実クラウド間の停止演習は別途必要です。
