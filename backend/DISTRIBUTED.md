# WebSocket分散ルーム（PR #367 設計変更）

## 保存先と接続

ゲーム状態・プレイヤー・トポロジー・所有権・確認状態にPostgreSQL/Supabaseを使いません。DBへのアクセスは担当Primaryが**新しいルームインスタンス**を作成するときの設定・問題取得だけです。移行時はレプリカの確定checkpointを使います。ルームが不明で必要なサーバーに接続できない場合、DBから作り直さず停止します。フロントエンドの既存のルーム編集・認証・オンライン記憶機能は変更しません。

Nodeは `CLUSTER_STATE_DIR`（既定 `.cluster-state`）のSQLiteにboot ID・投票記録・promise・checkpoint・非投票ミラー・tombstone・認証済みレジストリを保存し、Mac miniとRenderで同じプログラムを動かします。Node.js 22.13以降が必要です。Workerは `ClusterDO` が接続とトポロジー、ルーム別 `ReplicaDO` が投票状態・checkpoint・tombstoneを保持します。既存 `GameRoom` はゲーム通信/タイマーのアダプターです。ゲームルールは `shared/game.ts`、複製・所有権確認は `shared/distributed/` に共通化しています。

環境変数のトポロジー設定は**全サーバーおよびVercelで同一**の `ETB_CLUSTER_CONFIG` へ統合します。配列の順序が優先順位、`/ws` の付いたURLがCloudflareのNative WebSocketを意味します。`/ws` はこの設定上の識別子であり、サーバー間のWSSは引き続き自動的に `/cluster/ws` を使います。

```dotenv
ETB_CLUSTER_CONFIG='{"version":1,"servers":["https://primary.example.com","https://worker.example.com/ws","https://render.example.com"]}'
```

Mac mini・Worker・Render・Vercelにはこの**同じ値**を設定してください。各ゲームサーバーの自己URLと親URLは署名付きidentityのsubjectを配列から探して自動導出します。従来の `PRIMARY_SERVER_URL` / `PARENT_SERVER_URL` / `SERVER_PUBLIC_URL` と `NEXT_PUBLIC_PRIMARY_SERVER_URL` / `NEXT_PUBLIC_SECONDARY_SERVER_URL` / `NEXT_PUBLIC_FALLBACK_SERVER_URL` / `NEXT_PUBLIC_DISTRIBUTED_ROOMS` は、新構成では設定不要です。旧形式は移行のため互換性を維持しています。

**セキュリティに関する例外：** `CLUSTER_SERVER_TOKEN` は各サーバー固有の秘密鍵を含むため、全ノード共通の公開JSONにまとめません。各ゲームサーバーには従来どおり別の `CLUSTER_SERVER_TOKEN` Secretが1個必要です。Vercelのフロントエンドには設定せず、ブラウザへは公開URLの配列だけを渡します。既存のユーザーJWT公開鍵とSupabase Publishable設定も認証／ルーム取得のため継続して使用します。

証明書と配列が一致しない場合は起動を拒否します。証明書は次のように生成できます。

```sh
cd backend/server
node scripts/cluster-credentials.mjs /PRIVATE/NEW_DIRECTORY \
  '{"version":1,"servers":["https://primary.example.com","https://worker.example.com/ws","https://render.example.com"]}'
```

`server-0.json` はMac mini、`server-1.json` はWorker、`server-2.json` はRenderのSecretへ設定し、`offline-authority.json` はオフライン保管してください。

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
| Renderのみ | Renderが同ルームの投票資格と有効なcheckpointを保持していれば継続。再起動後は同じ永続ディスクを利用すること |
| どのサーバーにも対象ルームのcheckpointがない | 復元不可能。推測でDBからゲームを再構築しない |

NodeはSQLiteのFULL同期で確定前に状態を保存します。同じDBを使うプロセスの同時起動はSQLiteの排他ロックで拒否され、SIGKILLでもOSがロックを解除します。証明書変更やDB破損は新しい投票状態に置換せず起動を拒否します。boot IDだけを設定・コピーして使い回さないでください。

**Renderでは永続ディスクをマウントし、`CLUSTER_STATE_DIR=/var/data/ei-typebomb-cluster` などを設定してください。** Mac miniにも再起動後に維持されるディレクトリを指定します。既定のローカルディレクトリは、Renderの一時ファイルシステムを永続化しません。ディスクの追加・プラン変更・本番デプロイはこのコード変更では実施しません。同一identityを別々のディスクで同時起動する構成はサポートしません。

この変更以前にメモリから失われた投票記録は復活しません。旧bootのミラーしか残っていない場合は安全に選出できず、`VOTER_STATE_LOST` として自動再試行を停止します。未登録の固定投票者は `VOTER_NOT_IN_COHORT`、既知の対戦のcheckpointが見つからない場合は `CHECKPOINT_UNAVAILABLE` です。サーバー／永続ディスクを復旧してから利用者がページを再読み込みして再接続できます。一時障害は最大60回再試行し、成功snapshotが得られなければ `RECOVERY_TIMEOUT` として停止します。

クライアントは取得済みのinstance IDをルート照会と認証に渡し、状態消失を新規ルームとして再作成することを防ぎます。ただし初回アクセス／ページの完全再読込では、どのサーバーにもcheckpointがないルームを過去に遊ばれたルームと区別できません。永続ストレージを全台で消した場合の履歴検知には、別の永続インスタンス台帳が必要です。

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

## 2026-10-20 障害の再現・修正検証

実プロセスの検証は `npm run test:integration --prefix backend/cloudflare` で実行します。認証にはテスト用ES256鍵と実際の検証コードを使用し、ゲーム通信は実Socket.IO／workerd WebSocketです。Supabaseの設定取得だけはローカルHTTP fixtureです。本番サーバー・本番データを停止／更新しません。

- Primary停止→Worker単独で対戦と入力継続。
- Primaryとworkerd停止→Render単独で同じgameId・instance・プレイヤーを復元。
- RenderをSIGKILL→同じSQLiteで再起動し、旧owner停止後に昇格。所有者になったRenderの再SIGKILLからも復元。
- 全対戦プレイヤーと観戦者の実接続を切断し、Nodeの8秒ロビー猶予を超える9秒後に同じ対戦へ復帰（対戦復帰猶予は20秒）。全員切断時は期限を停止し、全員復帰時に停止時間を加算。
- Primary再起動時にrouteはRenderを返し、旧ownerへのゲーム認証は拒否。Renderでの退出を他の接続にも配信。
- Renderだけで新規JWT／ルーム設定から作成し、2プレイヤーが参加して対戦開始・カウントダウン完了。
- RenderのSQLiteを削除→再起動→稼働中ownerから署名付きミラーを受信→ownerとWorkerを停止。`Ineligible voter or lost process memory` を実際に記録し、HTTP 409／`VOTER_STATE_LOST` を1回だけ通知して停止。DBから元のゲームを捏造しない。

修正前に追加したテストでは、Render再起動後の `gameId` が `undefined`（元のgameId不一致）となり失敗しました。全員切断の単体再現では、9秒後の `isStart` が `false` となり失敗しました。boot検証を削除せず、保存と猶予処理を修正しています。また、古い確定tombstoneが新しい署名付きミラーより優先される `read/status` の失敗を再現し、epoch・revisionの新しい方を返すよう修正しました。ミラーを保存しても投票資格を付与しません。

**未解決の方式上の制約：** 上記はクラッシュと再起動の検証です。ネットワーク分断中の厳密な単一owner保証は、この文書の「意図的な整合性上の制限」のとおりありません。可用性を保ったままそれを保証するには、全サーバーが確認する外部の排他的リース／fencing authorityなどへの方式変更が必要です。今回その保証を追加したとは扱いません。


## タブを閉じた後の退出（#389 追補）

対戦中のセッション期限処理に、ほかのプレイヤー／観戦者が接続していると期限切れプレイヤーを削除しない条件が残っていました。このため、タブを閉じたプレイヤーが20秒の復帰猶予を超えて対戦終了まで残ることがありました。期限直前には対戦を維持し、期限直後にセッションと座席が消える失敗テストで再現しています。

- 待機中に確定した切断：Node／Workerとも即時退出。最後の接続ならルームを削除します。
- 対戦参加者の切断：20秒の復帰猶予を維持し、猶予内に戻れば同じ対戦へ復帰できます。観戦セッションは参加者用の延長の対象にせず、元の切断期限で削除します。
- 猶予を過ぎても戻らない場合：ほかに接続があっても期限切れセッションを削除し、通常の切断退出を適用します。生存プレイヤーの退出は既存ゲームルールに従って対戦を終了し、接続中の全員へ反映します。

実Socket.IO／workerdで、一方の接続を閉じて他方の画面から猶予中の維持と期限後の退出反映を確認します。Renderでは続けて待機中のタブ閉鎖、最後のタブ閉鎖後の `DELETED` tombstoneも検証します。また移行済みルームで待機中のタブを閉じ、新しいページ相当の別の署名付きセッションを発行して入室し直し、旧名がなく新しい表示名で参加できることを検証します。これはサーバーが切断を検知した時点を起点とする猶予です。ブラウザー／ネットワークが無応答になり切断の検知自体が遅れる場合、その検知時間が別途加わります。

## 退出・再参加後の移行待ち（#390 追補）

移行中のruntimeを復元するたびに `resumeUntil = now + 20秒` としていたため、待機中にruntime／所有サーバーが再作成されると期限が先へ伸びていました。既に記録された期限（期限切れを含む）を引き継ぐように修正しています。また、待機室や退出で終了した対戦に再接続バリアが残ると新規セッションのjoinがretryになるため、対戦が開始されていないcheckpointの保存時には `resumeUntil`・`pausedAt` を解除します。待機解除前に、切断済みの待機室参加者の座席と対応するセッションを削除します。これにより旧座席による満員と、旧セッション期限切れによる新対戦の終了を防ぎます。座席を持たない観戦セッションの期限付き後片付けは継続します。

ローカル検証ではPrimary（Node）、Secondary（workerd）、5台のFallback（Node）を起動します。上位6台をSIGKILL／停止し、7番目のサーバーだけで以下を実行します。

1. 対戦を引き継ぎ、旧接続を閉じ、別の署名付きセッションを持つ2ページ相当のRoutedSocketで再参加。
2. 待機解除後に両者が参加し、新しい対戦のカウントダウンと正解によるターン更新まで確認。
3. 再び閉じて再参加し、待機開始10秒後に所有NodeをSIGKILLして同じSQLiteで再起動。元の期限を延長せず、再び対戦開始・回答まで確認。
4. 全員切断中に一人が戻って明示的に退出すると、20秒を待たず対戦終了・待機解除・再参加が可能。
5. 定員2人の満員待機室の所有Nodeを再起動し、旧タブを再接続させずに別の新規セッション2人で入室。待機表示も旧座席も残らず対戦を開始し、旧期限を越える21秒後も同じ対戦を継続して回答できることを確認。

修正前には手順3で、epochが3から4に進んだ後も旧名と `migrating: true` が元の期限を超えて残り、26秒以内の復帰テストが失敗しました。単体テストでも期限30000が復元後35000になること、待機中の退出後／移行した待機室で `migrating: true` が残ることを失敗として確認しています。通常のタブ相当の閉鎖・再参加（所有Nodeの再起動なし）は修正前にも通過しており、本番の全条件を特定できたとは扱いません。ブラウザーの代わりに本物のRoutedSocket・Socket.IO／WebSocketを用い、UIの待機表示の根拠であるsnapshotの `migrating` と、その後の実ゲームコマンドを検証します。

Workerでも、全プレイヤー切断→一人復帰→明示的退出→待機解除→再参加を実workerdで検証します。認証署名、checkpointの投票資格・epoch・fencing検証には変更を加えません。

CodexレビューのP1指摘（PR #391）では、待機だけを解除すると旧座席・旧セッションが残り、新規参加を妨げたり、新しい対戦を旧期限で終了させたりする問題が見つかりました。修正前に、満員の待機室を復元しても `old-a`・`old-b` が残る失敗を確認し、座席とセッションを片付けてから待機を解除する順序に修正しました。単体検証でも新しい2人だけで始めた対戦が21秒後に維持されることを確認します。

## Primary再起動直後のroute競合（#391 CI追補）

CIの `render` シナリオでは、再起動したPrimaryへの最初のrouteが、現ownerのRenderではなく保存済みのPrimaryを返して失敗しました。クラスタWebSocketはフレーム順を維持しますが、messageハンドラーの署名生成・署名検証は非同期です。一方のhello検証が先に終わると、自分のhello送信や相手側の検証が終わる前に最初のstatus RPCを送ることがあり、相手側が未認証RPCとして切断します。readは到達できなかったpeerを除外するため、保存済みの古いownerだけが候補に残ります。

また、接続完了を待ってからリスナーを設置すると、openと同じコールバックで届いた最初のchallengeを取りこぼす経路も実WebSocketで再現しました。Node・Workersともソケット生成直後からサイズ・件数に上限のあるバッファでフレームを保持します。

challenge・helloを含む認証中のフレームを受信順に処理し、認証後のRPCは並行処理します。認証待ちフレーム数には上限を設け、切断後の非同期認証完了でリンクを公開しません。証明書・challenge・方向・bootの検証は維持します。RPCまで全て直列化すると、応答を待つRPCの後ろにその応答が詰まるため、認証後は直列化しません。

署名生成を100ms遅延させるテストと実WebSocket上の最初のrouteテストを追加しました。修正前の隔離コピーで、最初のRPCが `Peer disconnected` となること、同じ条件のrouteが `https://primary.test` を返して `https://render.test` との比較に失敗することを確認しました。修正後は同じテストでRenderとそのepochを取得します。既存の実Node／workerd統合テストの「Primary再起動後もRender所有」検証は変更せず実行します。これは認証の競合修正であり、上記のネットワーク分断時の方式上の制約は残ります。
