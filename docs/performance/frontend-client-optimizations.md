# フロントエンド軽量化（2026-11-13）

## 対象

- ① 初期JavaScript: ルーム参加時のTurnstileだけを `next/dynamic` で読み込む。通常のルーム表示ではTurnstile SDKを先読みしない。
- ④ PostHog: 製品イベント・ページビュー・feature flagsは従来通り。Session Replayは初期表示時に起動せず最初のポインタ/キーボード操作で開始。DOMを監視するイベントトラッカーは編集・ゲームページでだけ遅延読み込みし、DOM変更時の検査を1フレームにまとめる。
- ⑤ ルーム一覧: 検索は全ルームを対象に維持。検索の描画処理を `useDeferredValue` で分離。最初24カードを描画し、末尾付近のスクロールか「さらに表示」で24カードずつ追加する（IntersectionObserverがない環境でもボタンで表示可能）。
- ⑥ プリフェッチ: 初期自動prefetchは先頭2つの公開ルームに限定。その他の公開カードは表示範囲の240px手前で候補にし、220ms間隔で順番にprefetchする。ホバー/フォーカスは即時prefetch。Router Cacheの `onInvalidate` を使い、期限切れ後の次の操作でも再先読み可能。

## 不変条件

- RSC Router Cache 30秒、Supabaseの権限検証、公開/非公開、保存済みトグル、ゲーム参加、Editorの `edit_version`、PostHogのカスタムイベントは変更しない。
- 新規依存なし・デザインの変更は最小限（25件以上で「さらに表示」ボタンのみ追加）。
- Session Replayは最初の操作以降の記録になる。初期ロード直後に離脱した人のリプレイは記録しない。PostHogプロジェクトの録画設定・サンプリングは依然適用される。
- 画面外のルームはDOMにまだ存在しないため、ブラウザ標準のページ内テキスト検索とは異なるが、アプリ内ルーム検索は全件対象。
- 大量のルームをスクロールした場合は追加描画済みのカードが残る（仮想スクロールではない）。今後さらに規模が大きくなったら計測後に仮想化を検討。

## 検証項目

1. 本番ビルド、Frontend input tests、room-list、TypeScript。
2. ルーム一覧が24件以下・25件以上で操作でき、検索・保存切り替え・ルーム編集リンクが正常。
3. キーボードのみの操作でも「さらに表示」で全カードへ到達可能。
4. 公開ルームだけがprefetchされ、表示範囲外で一度に大量のRSCリクエストが発生しない。
5. 非公開ルームの認証、Turnstileチャレンジが開いたときにのみロードされ正常に検証される。
6. PostHogの `$pageview` / `room_editor_opened` / `game_finished` / `room_saved_toggled` が維持され、セッション録画は初回操作後に開始される。
7. 比較: initial JS transferred / long tasks / RSC prefetch request count / listing scroll performance。計測値を確認前に断定しない。
