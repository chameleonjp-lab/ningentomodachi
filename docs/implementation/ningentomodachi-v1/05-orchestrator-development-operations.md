# ニンゲントモダチ 指揮担当向け開発運用指示書

運用案1 / 2026-10-22 JST / 計画のみ。設定変更・PR・マージ・公開は未実施。

## 1. 目的

4エージェントが並行して作業しても、別PRの更新で古い検査結果が有効扱いになったり、同じファイルを上書きしたりしないようにする。失敗をゼロと保証するのではなく、失敗を早く検出し、原因担当・復帰点・再検査範囲を明確にして安全に前進する。

## 2. 絶対に分けるもの

- 並行開発と、mainへの取り込みは別。開発は4本、取り込み判断は1列。
- ローカル合流検証と、リモートmainのマージは別。本人のマージを代行しない。
- PRの緑と、最新main＋他PRとの組合せの緑は別。
- CIの取消／skip／未実行／timeoutは成功ではない。
- UIのHP残像と実HP、アニメーション再生時刻と戦闘時計を分ける。
- 共通ファイルはAだけが書く。他担当は変更要求で連携する。

## 3. 開始前のチェックリスト

1. 最新の本人指示、要件版、計画版、未決定の初期案を照合する。
2. 現在mainのSHAを取得し、既存PR、作業branch、未保存変更、担当稼働、同名タスクを確認する。
3. 現行CI・保護ルール・公開トリガーを読む。以前「CIなし」だった記録を現在へ読み替えない。
4. フォルダ所有者と共有ファイルロックを決める。package、lock、contracts、app、CI、統合testsはAだけ。
5. 作業場所は担当別の独立worktreeまたはチェックアウト。共通作業ディレクトリでbranchを切り替えない。既存作業を強制削除・resetしない。
6. 新規コード・素材の送信先、公開範囲、Draft PR対象を確認。承認済み同一操作は再確認しないが範囲拡大は別判断。
7. P0の基盤PRが本人により取り込まれた後、その新main SHAを4担当の共通基準とする。待ち時間は各自の調査・fixture・素材検査を進め、基盤未確定の推測コードを大量に作らない。

## 4. 作業台帳と状態遷移

担当ごとに次を記録する。

```text
taskId / requirementIds / owner / ownedPaths
status / branch / baseSha / headSha / contractVersion
assetManifestHash / dependencies / requiredChecks
localEvidence / ciRunIds / integrationCandidateSha
blocker / nextStep / updatedAt / completedAt
approvalScope / publishedState / deviceAcceptance
```

状態は planned → ready → implementing → local-verified → draft-pr → integration-verified → ready-for-owner → merged-observed。failed／blocked／needs-update は別状態。完了時刻はその成果の終了にだけ記録し、実機未確認を埋めない。

指揮担当は開始前に担当が本当に空いているか確認する。確認待ちの担当を稼働数に水増しせず、同じタスクを二重に割り当てない。担当が停止したら未保存作業とheadを先に確認し、停止理由を解消できる作業のみ再開する。

## 5. ブランチとPRの標準

- ブランチ例：feat/game-p1-a-core、feat/game-p1-b-assets、feat/game-p1-c-world、feat/game-p1-d-ui。例示名であり、同名既存があれば勝手に再利用しない。
- 1 PRは1担当・1段階・独立して検証できる差分。常に4つの巨大PRにまとめる必要はない。
- 原則baseはmain。P0取り込み後に同じ基準SHAから分岐し、契約fixtureで独立検査できるようにする。
- 未mergeの別担当branchを無断でbaseにしない。どうしても依存する場合は指揮担当が依存グラフ、親PR、追随手順を明記し、単独merge不可を示す。
- Draft PR本文に要件ID、対象ファイル、base/head、依存、検査、未確認事項、復元方法を記載する。
- Aの共有ファイル変更要求は、理由・変更案・影響するB/C/D・契約版更新を1件にまとめる。依存の更新はAが一度だけ行う。
- 外部提出前に秘密値、環境情報、不要なログ、未承認の素材が混ざらないか確認する。

## 6. 4本が同時に届いたときの手順

1. 各PRの最新headを再取得し、受領時点のbase/headと変更ファイル一覧を固定する。
2. 所有範囲違反、共有ファイル競合、契約版不一致を先に調べる。内容レビューの前にここを解消する。
3. 各PR単体の検査を確認する。成功していても、異なるheadの結果は無効。
4. 本人のmainを変更しない独立ローカル検証branchへ、最新main＋候補PRの固定headを予定順で合流する。例：A→B→C→D。依存が異なれば順番を台帳に記録して変更する。
5. 各段階の合流後に契約検査・型・関連単体を行い、最後の組合せで全体build／integration／browserを行う。
6. コンフリクトがなくても、実GLB・時計・イベント・HP演出・車判定の意味上の統合検査をする。
7. 受領後にPRへpushされたら、そのPRと下流候補の合流結果を失効させる。新headを取り直して必要な範囲を再検査する。
8. 本人へ最初のPRだけを取り込み候補として示す。4本まとめて「全部安全」と通知しない。
9. 本人のmerge後、mainの実SHAを再取得する。残りPRへ最新mainを取り込んで所有者が再検査し、新しい統合候補を作る。
10. 想定したmainと違う変更が入ったら次の取り込みを止める。独立した実装作業は続けてよい。

ローカル検証branchでの合流は本番mergeではない。リモートへ統合branchをpushする場合も、対象・公開範囲が承認済みであることが必要。勝手なforce push、mainへの直接push、未承認のrebaseによる他担当履歴書換えはしない。

## 7. CIでPR同士を打ち消さない設計

CI設計はAが実装し、指揮担当が検証する。以下は未設定の計画。

- 通常PR検査のconcurrency groupはworkflowとPR番号（PR以外はref）で分け、別PRの実行を取消さない。同じPRの旧commitを取消す場合は、その旧結果を成功扱いしない。
- リポジトリ全体で同じgroup名を使い、4本のPRが互いのCIを止める構成を避ける。
- 必須checkの名称を安定させる。paths条件で必要checkそのものが発生しない構成を避け、必要なら常に走る集約checkで対象／対象外を明示する。
- unitは乱数seed・時刻を固定し、browserはports・一時ファイル・スクリーンショット保存先を分離する。
- キャッシュキーはOS・runtime・lockfileなど依存を区別する。テスト出力を依存キャッシュと混ぜない。
- artifactはPR番号、head SHA、run ID、担当、検査名を区別する。ログ・画像・検証JSONを省略せず保存する。
- 証跡にはチェックアウトしたSHA、PR head、base、統合candidate SHAをそれぞれ記録する。PRの合成mergeを検査した場合、head単体検査と区別する。
- 公開のworkflowは検査と分離。公開許可のないPRでproductionが更新されないことを確認する。

GitHub公式資料では、concurrency groupの共有が実行待ち・取消に影響する。PRごとの分離はこの挙動を踏まえた本計画の設計判断。確認日2026-10-22。
https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

GitHubのmerge queueは代替案として存在するが、今回は有効化せず、本人による順番mergeを標準とする。将来採用するなら利用条件・保護ルール・権限を確認し、merge_groupでも必須checkが走る構成が必要。確認日2026-10-22。
https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue

## 8. 失敗時の切り分けと復帰

| 状況 | 最初に確かめること | 対応 |
| --- | --- | --- |
| 検査が開始しない | event、対象branch、必須check名、workflow構文、権限 | AがCI原因修正。未実行を成功扱いしない |
| canceled | 同PR更新か別PRgroup競合か | 最新headを確認。group衝突ならAが設計修正 |
| 型・契約不一致 | contractVersion、共有型の独自複製 | 所有者へ戻し、Aの契約へ揃える |
| lock差分 | 他担当が依存変更していないか | 変更理由を保全しAへ集約。検査を弱めない |
| 単体成功・合流失敗 | main/headの変化、意味上の依存 | 合流前後を比較し原因担当が修正 |
| 素材不一致 | manifest、骨格、clip名、retime、hash | Bが原本から比較。未検証最適化を採用しない |
| 見た目とHPが違う | Dの残像とAの確定HP、イベント重複 | event IDで追跡。表示待ちで判定を遅らせない |
| 不安定なbrowser検査 | seed、待機条件、ポート競合、低fps | 原因を絞り再現。根拠なくtimeoutだけ増やさない |
| 接続／権限拒否 | 対象とエラー、実行済みか不確実か | 迂回しない。既存状態を読み、必要承認だけ依頼 |

一時的障害のみ、未実行／現在headを確認して限定再試行する。同じ原因の無限再実行、失敗テストの削除・skip化、闇雲な依存更新は禁止。変更前正常版、失敗ログ、修正commitを保持する。復帰は修正PRを基本とし、破壊的rollbackや強制削除は行わない。

## 9. 指揮担当の日常ループ

1. 新しい本人指示を最優先で受け取り、影響する担当へ原文と対象を送る。
2. 要件版とPR headの組を更新し、影響を受ける検証だけ失効させる。
3. ready状態の仕事を空いている担当へ割り当てる。単なる停止を待ち理由にしない。
4. 進捗は実装・検査・依存待ち・承認待ちを分けて読む。
5. 完成した担当は、他担当の変更を読取レビューする。相手のファイルを直接修正しない。
6. A↔Dは判定と表示、B↔Cはモーションと空間を相互レビュー。指揮担当が最終要件対応表を統合する。
7. 統合候補の証跡が揃ったときだけ本人に判断を依頼する。通常の細かな作業報告はまとめる。
8. 実装環境・接続・承認に問題があっても、独立して許可された調査や検査を継続する。

## 10. 担当へ渡す依頼テンプレート

```text
対象：ニンゲントモダチ / 担当A〜D / 段階P番号 / taskId
基準：要件版6、全体計画版1、該当個別計画、運用指示書
基準main SHA：実物から記入
作業branch・許可対象ファイル：実物から記入
契約版・素材manifest hash：実物から記入
今回の完了条件：要件ID、検査、成果物
依存：先行taskIdと受領条件
禁止：他担当領域変更、未承認公開、main直接変更、merge、課金
報告：head、変更範囲、実行コマンドと結果、証跡、未完了、次の再開点
```

未確認のSHAや承認は空欄のままにせず「未取得」と記す。指揮担当は実値を入れてから実装を開始させる。

## 11. 本人へ渡す取り込み判断メモ

PR URL、変更の目的、要件ID、base/head、直前のmain SHA、契約／素材版、必須check、統合candidate、画面確認、実機の確認範囲、残る制限、推奨取り込み順を短くまとめる。本人mergeを観測したらそのSHAで次の判定を更新する。マージ済みを公開済みとは扱わない。
