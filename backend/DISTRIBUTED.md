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

## 所有権確認プロトコルと安全性

**固定された投票者集合の過半数ACK**で状態を確定します。各ルーム作成時に `roomInstanceId` と、証明書で許可された順序付きメンバー/起動ID（incarnation）を固定します。通常時はMac mini → Workerまでの2台で過半数に達するため、Renderがスリープしても待ちません。Raftそのものではなく、順序付きWebSocket転送を使う独自の過半数合意です。

- ownerは変更を計算するだけで、まだ確定応答を返しません。
- 署名付き提案（ルーム・instance・epoch・revision・checkpoint hash）を下位投票者へ送り、保存済み投票者の経路が過半数に達したら確定します。途中の投票者が未接続なら次の下位投票者を試します。順番違い、別instance、旧epoch、違う提案hashを拒否します。
- 過半数を満たした最後の投票者が署名付きの決定証明を発行し、確認経路を逆向きに確定させます。ownerがこれを受け取ってから、クライアントへ結果を配信します。残る下位サーバーには確定checkpointを非同期に直接同期します。
- ACK消失時、操作は「失敗」と断定できません。過半数の決定証明を持つ最新checkpointを次のownerが復元します。イベントIDの再送は二重適用しません。過半数で未決定のpending状態は復元元にしません。
- クライアントの障害報告だけでは移行しません。報告先は既存ownerに問い合わせ、正常に過半数を確認できるownerなら移行を拒否します。draining中または過半数確認不能で停止したownerは譲渡を承認できます。
- ownerが応答しない場合も、候補以降から**ルーム全体の固定投票者数の過半数**がより大きなepochを永続/メモリにpromiseしてから移行します。最新の確定checkpointを取り込み、新epochのMIGRATING状態も過半数で確定します。単なる接続失敗を所有権には変換しません。
- 候補は同じか下位の位置に限ります。同じownerの実行アダプター復元も新epochでfenceします。上位へのフェイルバックは許可しません。
- ownerは約1秒ごとにも過半数で所有権確認を行います。これは時刻で失効させるリースではありません。タイムアウトは停止/再照会の契機だけで、epochを獲得する証拠にはしません。

**安全性の根拠:** 固定投票者の過半数どうしは少なくとも1台で必ず重なります。投票者はルームごとの直列化とepoch promiseを維持し、より大きなepochを約束した後は旧ownerの確定要求を拒否します。単独のRenderは過半数を作れず、通信分断による単独昇格はできません。確定証明を持つcheckpointから復元します。

**障害モデル:** 正しく動く認証済みサーバーのクラッシュ、メッセージ遅延/欠落/重複/逆順、通信分断に対応します。Byzantine動作、秘密鍵漏洩、同じURL/identityで複数のNodeプロセスを同時稼働させる運用、CA管理者が競合する構成を発行する操作は対象外です。各URLは1プロセス（WorkerはDOの単一実行保証）で運用してください。

## 継続できる条件・停止する条件

3台の投票者がPrimary / Worker / Renderなら、過半数は2台です。**Render停止中でもPrimary＋Workerでゲームを確定できます。** Primary停止時はWorker＋Renderが通信できればWorkerに移行できます。Worker停止中でもPrimary＋Renderで確定できます。ただし**2台停止してRenderだけが残った場合は、Render単独での自動復旧を行いません**。これは古いownerとの二重進行を防ぐためです。

固定集合で過半数の有効な投票者が応答しない場合は確定を停止します。Renderが初回登録前にスリープしている新規ルームは、既知の認証済みPrimary＋Workerだけを固定投票者とし、両者のACKで開始できます。この既存ルームにRenderが後から加わっても、自動的に投票者として昇格しません。

Nodeが再起動するとメモリ投票状態を失い、新しい起動IDになります。古いcheckpointをキャッシュすることはできますが、**失った旧投票者として再参加することはできません**。そのNodeをまだ必須とする既存ルームは停止するか、そのNodeより下位の元の投票者へ安全に移行します。Workerの起動IDと投票状態は自身のDO storageに保存します。DO storage消去や証明書の期限切れでも、推測で再開させません。

有効な過半数とその確定状態が残らない場合の自動復旧、ローカルキャッシュだけを投票状態へ昇格する復旧、未知のルームを分断中にDBから再作成する復旧は**無効**です。全コピーを失った進行中ゲームの復元はできません。

## 同期・復元・削除

入力/hintは最新値を100ms単位で集約し、JSON差分を送ります。欠落した基準hashの場合、認証済みWebSocketから完全な提案を再取得します。変化のない入力は送信しません。開始・正解・爆弾移動・脱落・終了・接続状態は即時提案し、必須の過半数ACKまで未確定です。接続中のルームは5秒ごとにも完全checkpointを送ります。確定checkpointは下位への直接送信も行うため、親経由だけに依存しません。非投票レプリカが受信しただけではゲームを進めません。

クライアントはforegroundで約1.25秒応答がないと下位へ `/cluster/report` を送ります。room JWTと同じタブのsession JWT、room ID、認識したowner、最後のrevision、failureフラグを検証します。バックグラウンドでは応答監視を抑え、復帰後もサーバー側確認を必須にします。認証中には別の猶予を設けます。

復元は署名された最新確定checkpointから行います。座席、表示名、game ID、爆弾ID/位置/段階/turn、選択済み問題、入力、推薦情報、イベント重複排除を引き継ぎます。移行中はタイマーを止め、参加者全員の再接続または20秒の復帰期限後に再開します。期限後の未復帰者には既存の通常退出処理を適用します。残り時間の再構成には保存時刻と最終確認時刻を使い、既に期限付近なら最小の復帰余裕を設けます。ホスト間の時計同期は必要ですが、時計を所有権の根拠にはしません。

全transport接続の復帰猶予が終了し、試合が動いていないことを確認してDELETEDのtombstoneを過半数で確定します。tombstoneは自動破棄しません。古いsnapshotは状態を上書きできず、再作成では新instanceと大きいepochを使います。ownerも必要な投票者も不在なら削除を推測で確定しません。

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
3. クラスタ全員が登録された後、frontendを `NEXT_PUBLIC_DISTRIBUTED_ROOMS=true` とbootstrap URLで再ビルドします。台数はbootstrapの3変数に制限されず、登録情報から取得します。session JWTは接続先変更で再発行しません。
4. 追加ノードは有効なCA証明書と親URLで登録でき、既存コード変更なしでバックアップを受信できます。ただし、**既存ルームの投票者集合は自動変更しません**。新規ルームの投票者はCA署名付きrosterのうち、登録済みの先頭から連続する認証済みメンバーで固定します。過半数未満では作成せず、既存ルームの不在メンバーを勝手に取り除きません。
5. 新しい投票者構成の有効化や削除・順序変更では、旧構成のルームを先に終了/削除し、同じオフラインCAで新rosterのidentityを発行して全員へ設定します。`--authority /PRIVATE/offline-authority.json` を生成コマンドの先頭に指定すれば同じCAを利用できます。認証済みの投票者による過半数が揃わない場合は新規作成を停止します。動的登録と投票者の安全な変更は区別しています。稼働中の投票者の無条件除去や自動joint-consensus再構成は実装していません。
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

PostgreSQL、DB資格情報、外部サービスへの接続はテストに不要です。実通信テストはNodeをSIGKILLし、クライアントの報告→workerdのゲーム復元、さらにWorker停止後にRender単独へ危険な移行をしないことを検証します。正常owner拒否、認証拒否、Primary復旧後の新規作成、差分、ACK消失、同じタブIDを検証し、DBアクセスを設定取得だけに制限するカウンターも検査します。単体テストは承認移行、通信分断、Renderスリープ中のゲーム確定、過半数不在、メモリ消失、旧epoch、重複・逆順、tombstoneを検証します。CIにもDBサービスはありません。

メモリ/メッセージ上限はcheckpoint約512KiB、frame 2MiB（選出時の新旧checkpointを含む）、registry/roster 1,000件、接続当たりpending RPC 128件です。100msは集約間隔で、ネットワーク到達の保証ではありません。大規模構成では暗号検証とACKの遅延を実測してください。

標準WebSocketの接続はClusterDOを稼働状態に保ち、duration課金が発生します（[Cloudflareの説明](https://developers.cloudflare.com/durable-objects/examples/websocket-server/)）。現実装はhibernationで接続/未処理ACKを誤って復元しない方を優先しています。DOストレージは投票promise・確定状態のACK前保存に必要であり、高頻度入力では書き込みも増えます。無料枠内の常時運用は保証しません。本番デプロイと実クラウド間の停止演習は別途必要です。
