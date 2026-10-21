# サーバーライフサイクル検証記録

2026-10-21、macOS、Node `v24.19.0`。出発点: `ba79219` (`main`)。
以下のコマンドはリポジトリrootから実行した（`cd`付きは記載のdirectory）。
本番のMac mini / Cloudflare / Render / PostgreSQLへの停止操作・デプロイは行っていない。

## 改修前と不具合の再現

| 実行コマンド                                                                                                           | 実行結果                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test --prefix backend/server`                                                                                     | baseline 159/159成功                                                                                                                                                       |
| `npm test --prefix backend/cloudflare`                                                                                 | baseline 6/6成功                                                                                                                                                           |
| `cd backend/server && node --import tsx --test test/distributedRuntime.test.ts`                                        | 回帰テスト追加後36件中2件失敗。重複disconnectが期限30,000を49,999へ延長、halt後のleaveがrejectしない                                                                       |
| `cd backend/cloudflare && node --import tsx --test --test-name-pattern='standalone node' test/session.integration.mjs` | 実Socket.IOで一時切断後 `isStart: false` を再現（期待true）。最初の起動試行はfixtureの空文字cluster設定で失敗したため、未設定へ修正して再実行                              |
| `cd backend/server && node --import tsx --test --test-name-pattern='delayed snapshots' test/routedFailure.test.ts`     | 旧版snapshotでbroadcast数4（期待1）。snapshot修正後に追加した古いtombstoneのrouteテストでもowner.testを選択し失敗（期待backup.test）。いずれも実装を修正して同じ条件で成功 |

テストを削除・skipしたり、期待する猶予・削除条件を緩和したりしていない。
新規Worker単独テストでは、既存のstandalone実装が退出ACKを返さないことも検出し、保存後ACKを分散モードと共通の経路へ統合した。
テスト実装中のMiniflareの削除済みAPI `getDurableObjectStorage` による失敗は、テスト専用DO subclassの保存状態観測へ置換した。productionの認証・ゲーム・退出処理は置き換えていない。
追加した同期テストのhistory型とnullableなcheckpointはtscで検出し、明示型と存在確認assertを追加して再検査した。型検査の無効化は行っていない。
同一socketのID変更テストは、別の有効なsession JWTと有効なdisplayNameを送信する。payload不正による拒否をID束縛の成功と数えない。

## 最終検証

| コマンド                                                                                                                                                    | 結果・範囲                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck --prefix backend/server`                                                                                                                 | 成功。Node/shared + test/tsconfigの両方                                                                                                                                                                                                      |
| `npm run typecheck --prefix backend/cloudflare`                                                                                                             | 成功。Worker/shared                                                                                                                                                                                                                          |
| `cd frontend && npx tsc --noEmit`                                                                                                                           | 成功                                                                                                                                                                                                                                         |
| `npm test --prefix backend/server`                                                                                                                          | 165/165成功。既存159 + 新規6。core、runtime、peer、routing、実WebSocket、Socket.IOの既存テストを含む                                                                                                                                         |
| `npm test --prefix backend/cloudflare`                                                                                                                      | 6/6成功                                                                                                                                                                                                                                      |
| `cd backend/server && node --import tsx --test test/distributedRuntime.test.ts test/peerConsensus.test.ts test/peerLink.test.ts test/routedFailure.test.ts` | 73/73成功。時計fixtureと実PeerControl、実peer WebSocket、ブラウザtransport fixtureを含む                                                                                                                                                     |
| `ETB_RACE_REPEATS=20 npm run test:race --prefix backend/server`                                                                                             | 73件の主要テストを20回連続成功。runtime内の短時間の切断/復帰/重複参加は各回25cycle                                                                                                                                                           |
| `cd backend/cloudflare && node --import tsx --test test/session.integration.mjs`                                                                            | 2/2成功。実Node Socket.IO + workerd Native WebSocket、実ES256認証。20秒を実時間で待ち、置換・複数タブ・一時断・復帰・明示退出ACK・再参加・期限切れ・最後の接続終了・保存状態削除・再作成を確認。Workerはclose callbackの重複も保存期限で検査 |
| `npm run test:integration --prefix backend/cloudflare`                                                                                                      | 12/12成功、約238秒。最終のroute fenceと有効な別JWTによるID変更拒否を含む（下記の実通信シナリオ）                                                                                                                                             |
| `npm run test:playground --prefix frontend`                                                                                                                 | 28/28成功                                                                                                                                                                                                                                    |
| `npm run build --prefix backend/server`                                                                                                                     | 成功。tsc + production entry生成                                                                                                                                                                                                             |
| `cd backend/cloudflare && npx wrangler deploy --dry-run --outdir /tmp/etb-worker-dry-run`                                                                   | 成功。Worker bundle生成のみ、デプロイなし                                                                                                                                                                                                    |
| `npm run build --prefix frontend`                                                                                                                           | 成功。import/kana/bot-typingの既存テスト、Next production compile、型検査、page生成。sharedをrepo rootからbundleできることを確認                                                                                                             |
| `npm run lint --prefix frontend`                                                                                                                            | 失敗: 5 errors / 7 warnings。すべて未変更ファイル。下欄参照                                                                                                                                                                                  |
| `cd frontend && npx eslint lib/room/clusterConfig.ts lib/room/routedSocket.ts next.config.ts`                                                               | 成功。変更したfrontend全ファイル                                                                                                                                                                                                             |
| `git diff --check`                                                                                                                                          | 成功                                                                                                                                                                                                                                         |

backend/server と backend/cloudflare にはLintスクリプト/独立したLint設定がない。新しい依存は追加せず、両runtimeの型検査とビルドで検証した。これをbackend Lint成功とは表現しない。

## 実通信と障害シナリオ

`test:integration` は9件の既存分散scenario + legacy DO復旧1件 + 新規standalone 2件。
実プロセスのSIGKILL、実Socket.IO、workerd、Chromiumを使う。ルーム設定取得だけローカルHTTP fixtureであり、外部DBは起動していない。

| シナリオ                                    | 検査する状態・イベント順序                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `worker`                                    | Primary停止、Render停止中のWorker単独移行、同じgame ID/座席/入力で続行                    |
| `render`                                    | PrimaryとWorker停止→Render単独、復旧Primaryは旧ownerへ戻らず、退出を他接続へ配信          |
| `render-restart`                            | 同じSQLiteで再起動、永続boot/vote/checkpointを保持して復旧                                |
| `render-state-loss`, `render-identity-loss` | 永続状態欠落は分類エラーで停止。DBから過去のゲームを再作成しない                          |
| `fallback5-reopen`                          | 複数段の下位に移行、旧接続の退出→別ページ再参加→複数回の対戦開始、猶予後の掃除            |
| `browser-close-render/worker/fallback5`     | 実ブラウザのページ終了、beacon配送、接続世代fence、最後の終了後のtombstone                |
| `legacyTopology`                            | 実DO再起動。不正な構成変更で元の保存データを改変せず停止                                  |
| `standalone node/worker`                    | 実transportの一時断で20秒の猶予、同一タブ置換/別タブ保持、期限後退出、最終保存stateの除去 |

同期遅延・重複・逆順は `peerConsensus.test.ts` で本物のPeerControlが作成したcheckpointを複製先へ順序を変えて配送する。古いjoinが新しいleaveを上書きしないことと、hash破損が保存前に拒否されることを検査する。WAN上のパケット遅延を実際に発生させた試験ではない。
分断と競合選出はfixtureの経路遮断で検査する。分断中の単独進行を許す既存方式を明示的に検証し、厳密な単一owner保証の成功テストとは扱わない。

## Lintの既存エラー

次のファイルは本PRで変更していない。規則の無効化・検査対象の除外は行っていない。

- `frontend/app/(develop)/server-url/page.tsx:33`: effect内の同期setState（1 error）。
- `frontend/components/ui/Morph.tsx:25`: render中のref書き換え（1 error）。
- `frontend/lib/room/healthProbe.ts:32`: prefer-const（1 error）。
- `frontend/scripts/fix-word-drag.js:1,2`: CommonJS require（2 errors）。
- 既存警告7件: my-roomsの未使用state、game/playground/joinのhook依存、importWordsの未使用変数。

## 未実施・残るリスク

- 本番のホスト停止・復旧、実WANの片方向分断、長時間遅延、時計ずれ、Renderの実スリープ/ディスク消失は未実施。本番運用を停止・変更する検証をローカル試験に含めていない。ステージング演習と本番ログ照合が必要。
- 分断中の有効owner最大1、未配送commitのゼロ損失は未保証。既存の単独継続方式を保持している。改善案は [監査文書](server-lifecycle.md) に記載。
- peer相互認証の欠如は既存仕様のまま。公開構成の照合やhashを暗号的な認証と呼ばない。
- frontendは `backend/shared` を直接importするため、デプロイのcheckout/build contextにsharedを含める必要がある。リポジトリ全体からのNext buildは成功、frontendだけをコピーしたbuildは対象外。
- ローカル経過時間はクラウド間のfailover時間のSLOではない。CIはPR作成後に別環境で実行される。
