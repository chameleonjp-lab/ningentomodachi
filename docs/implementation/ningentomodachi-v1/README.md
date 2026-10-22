# ニンゲントモダチ v1：要件・実装計画

このフォルダは実装前の要件資料と、4担当による並列開発の計画書です。ゲーム実装や公開の完了を示すものではありません。確定要件と初期提案は各資料内で区別しています。

## 読む順序

1. [要件資料 v6](2026-10-22-ningentomodachi-design-review-v6.md)
2. [全体実装計画](00-master-implementation-plan.md)
3. [担当 A：共通基盤・戦闘](01-agent-A-core-combat.md)
4. [担当 B：素材・アニメーション](02-agent-B-assets-animation.md)
5. [担当 C：ワールド・カメラ](03-agent-C-world-camera.md)
6. [担当 D：画面・入力](04-agent-D-interface-input.md)
7. [指揮担当向け開発運用指示書](05-orchestrator-development-operations.md)
8. [完成品のシステム連携図・フォルダ／ファイル構成図（PDF）](06-implementation-diagrams.pdf)

## 実装開始条件

計画書 PR のマージ確認後、P0 の共通基盤から着手します。P0 のマージ後に全担当が同じ main の固定 commit を基準にし、4担当の実装を並列化します。PR の作成は並列でも、統合検証とマージ判断は直列で行います。マージ・本番公開は本資料の追加には含みません。

## 正本と素材

コードの正本はこの GitHub リポジトリです。既存素材は assets/android/motions/ にあり、この文書追加では変更しません。Drive の参照リンクは本人専用素材の所在を示すもので、公開権限を変更するものではありません。
