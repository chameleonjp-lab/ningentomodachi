# Agent B：素材・モーション統合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存42モーションと白・青・緑・黄・黒の外観を原本保全のまま利用し、専用敗北2モーション、決定的な攻撃軌道データ、単一骨格の再生基盤を提供する。

**Architecture:** Bは素材の取得・台帳・派生生成・描画再生・ローカル軌道を担当する。共有契約はAが所有し、Cが空間変換と移動・接触候補、AがHP・相殺・熱量・勝敗の最終決定を行う。実クリップの判定用曲線はオフラインで固定し、描画フレームやAnimationMixerのイベント順から戦闘結果を決めない。

**Tech Stack:** 設計案のTypeScript / Three.js / GLB。テストランナー、ブラウザ検査、固定tick、ツールの版はPhase 0でAが確定する。既存の利用可能な制作ツールを優先し、未承認のインストールは行わない。

**Spec:** `design/2026-10-22-ningentomodachi-design-review-v6.md`。読込時のSHA-256は `8baa701cb13546ae7e7dddb1c4296f97f0758443cfa90d9b4f777d76b4f5d217`。

**状態:** 実装開始前の計画書。以下のパス・API・コマンド・テスト結果はすべて予定であり、コード、敗北クリップ、実機性能の完成を示さない。設計書の「提案」は実装上の初期値であり、新たなユーザー承認済み要件とは扱わない。

## 1. 全体制約

- 元素材の所在は設計書第13章。確認済みリポジトリ版は `7e00fb9823a01c9842787eab4d3ac2a95f67561c`。これは素材の根拠版であり、将来のPR base SHAとは別物。
- 既存42本は移動9・ジャンプ1・パンチ分類13・キック分類19。AcrobaticComboは原本と台帳に残す。初版の抽選から外す案では手技12・キック19を使用する。42本を41本と数え直さない。
- 追加はパンチ致死用とキック致死用の2本。元の42本と合わせて台帳上44本となる。色違いやカテゴリごとの重複モデルを別のモーションとして数えない。
- 1.5倍速素材は時間を既に通常版の2/3へ変更済み。通常の再生倍率は1.0とする設計初期値。再度1.5を掛けない。
- 1機につき1つの骨格階層。4カテゴリGLBのモデルを4体重ねない。インスタンス間で共有してよい不変データと、独立すべき骨・アニメーター・マテリアル状態を分ける。
- 色違いでも赤い発光を維持する。死亡時の発光停止が別の生存機体へ波及しない。
- ルート移動・ジャンプ位置はCが一度だけ適用する。Bは軌道と見た目を提供し、戦闘中の自由移動を技の踏み込みへ二重加算しない。
- 敗北クリップはスロー倍率0.25の初期値で0.5 clip秒を実時間2秒で再生し、主要な崩壊・倒れ込みを完了する。2 clip秒を8実秒へ引き延ばさない。
- 敵撃破スローは実時間1.5秒。0.5秒の共通死亡クリップならその間に0.375 clip秒進み、残り0.125 clip秒はスロー解除後に通常速度で継続する。途中で待機姿勢へ切らない。A/Cの遷移をクリップ完走待ちで延長しない。
- 破壊演出は骨格・元デザインを維持する案。車致死をキック側へ割り当てる案の決定権はA。火花・発光停止の表現データをBが渡し、HPバー吸収の表現はDに任せる。
- 原本は変更・削除・上書きしない。最適化は別の版付き派生物として作成し、再生成前にも以前の派生版を保存する。
- 今回は計画のみ。実装、素材ダウンロード、依存導入、push、PR作成、外部アップロード、公開、マージ、配備を実行しない。Codex Cloud environmentsは使用しない。

## 2. Review Focus

1. 同名ボーンでもbind poseや親が違う素材を黙って混在させない。骨格署名不一致をB2で停止させる。
2. 描画fps・シーク・復帰で打撃窓を飛ばしたり重複させない。B3/B4で同じtick列のサンプルが一致することを検査する。
3. 共有マテリアルの色変更・発光停止が別の個体へ漏れない。B2/B5で複数色・個別死亡を同時表示する。
4. ロード中の再試行や古い要求の完了で、二重モデル・古い素材・解放済み資源が混じらない。B1/B4で取消、世代ID、再試行を検査する。
5. 高負荷端末・WebGL中断でも「モックなら成功」を実素材の合格に代用しない。B6で実GLBと計測条件を記録し、実機未検証は未検証として残す。

## 3. ファイル所有権と予定配置

Bだけが変更する予定の領域は `src/assets/**`、`public/game-assets/**`、`tools/assets/**`、`tests/assets/**`。同領域でも既存原本や承認済み資料の破壊的変更を許可する意味ではない。

- `src/assets/assetCatalog.ts`：不変の素材パック、クリップと色の対応。
- `src/assets/index.ts`：Bの公開factory `createAssetsModule` と公開型の再export。アプリへの結線は行わない。
- `src/assets/loadAssetPack.ts`：進捗・整合性・取消・再試行を備えたロード。
- `src/assets/createAndroidInstance.ts`：共有資源と個体別骨格の生成・解放。
- `src/assets/actorAnimator.ts`：A/Cの描画用状態からポーズを再生するアダプター。
- `src/assets/motionSampler.ts`：固定曲線からルート差分と打撃体積をサンプリング。
- `src/assets/deathAnimation.ts`：敗北クリップ、最終姿勢、発光停止の表示。
- `public/game-assets/<assetPackHash>/manifest.json`：公開可能な派生物だけを列挙する版付きマニフェスト。
- `public/game-assets/<assetPackHash>/android.glb`、`motions.glb`、`motion-curves.json`、`colors.json`：配布用派生物。実際の分割方式は初期ロード計測後に凍結する。
- `tools/assets/source-lock.json`：取得元の版、ファイルのSHA-256、サイズ、出典と公開可否。秘密URL、トークン、私有素材そのものは含めない。
- `tools/assets/inventory.mts`、`validate-skeleton.mts`、`derive-pack.mts`、`bake-curves.mts`、`measure-reach.mts`：一方向で再現可能な生成・検査。
- `tools/assets/author-death-clips.mts`：同じ骨格への2本の制作手順。必要な手作業工程とツール版も記録する。
- `tools/assets/reports/`：台帳、差分画像・動画の参照、性能計測条件、生成来歴。コミット対象は事前承認されたものだけ。
- `tests/assets/inventory.test.ts`、`skeleton.test.ts`、`motionSampler.test.ts`、`animator.test.ts`、`deathTiming.test.ts`、`loading.test.ts`：計算・契約検査。
- `tests/assets/browser/real-assets.spec.ts`、`tests/assets/fixtures/`：実素材のブラウザ検査と最小モック。実素材の正本をfixtureへ複製しない。

`<assetPackHash>` は確定したパック識別子で置き換える。ローカル取得原本はリポジトリ外の専用保管先に保存し、公開用ディレクトリへ無条件コピーしない。

他担当の領域は変更しない。

- A：`src/core/**`、`src/contracts/**`、`src/app/{createGame,frameLoop,bootstrap}.ts`、`src/main.ts`、`index.html`、package/lock/config。共有型、戦闘・熱量・時計、抽選、ロード完了後の開始制御、各moduleの結線。
- C：`src/world/**`、`src/camera/**`、`src/scene/**`。world transform、接触候補、ルート適用、移動とジャンプ。
- D：`src/ui/**`、`src/input/**`、`tests/ui/**`、`tests/input/**`。入力、設定、ロード案内、HP/熱量表示。

共有設定や型の追加が必要なら、Bは変更要求と最小fixtureをAへ渡す。契約ファイルを独自作成して迂回しない。

## 4. Phase 0でAが凍結する受け渡し契約

以下は必要な意味とAPI名の案。最終的な型・関数名・版番号はAの `src/contracts/**` が唯一の正本となり、Bのローカルコピーは置かない。凍結時に本計画中の呼称との対応表を残す。

契約ファイルの計画上の配置は `src/contracts/{ids,clock,motion,combat,spatial,commands,events,snapshot,ports,index}.ts`。Bは `motion.ts` / `ports.ts` を中心に消費し、他担当のmoduleを直接importして結線しない。`createAssetsModule(dependencies): AssetsModule` を `src/assets/index.ts` から公開し、Aのbootstrapだけが呼び出す。dependenciesと戻り値の最終型はPhase 0のports契約で確定する。

### 4.1 素材・クリップ

- `AssetPackVersion`：schemaVersion、sourceCommit、原本ファイル一覧とSHA-256、derivativeHashes、skeletonSignature、generatorVersion、samplingVersion。正規化したmanifestと各ファイルhashからassetPackHashを算出する。自己参照hashは計算入力から除く。
- `MotionClipMeta`：clipId、sourceClipName、category、sourceDurationSec、actualDurationSec、runtimeRate=1.0、loop方針、root方針、startup/active/recovery、attackEligible、impact一覧、effectiveReachM。
- `ImpactDefinition`：clip内で安定したimpactIndex、activeWindows、正規化weight、hitVolume種別と曲線参照。weightは有限・非負、攻撃クリップ内の合計を1とする。初期案は等分。打撃数は見た目と台帳から確認し、技名の数字だけで推測しない。
- BのimpactIndexは発動ごとのIDではない。Aが `actorId + attackInstanceId + impactIndex` から一意のimpactIdを構成し、重複命中・相殺消費を管理する。
- BがeffectiveReachMを計測し、Aが確定した計算式へ投入して総ダメージ・各打撃ダメージを決める。Bは独立した威力表、相殺解決、熱量加算を実装しない。
- 色manifestは見た目だけを扱う。青/緑/黄の固定4パンチ+4キック、白の抽選候補、黒のキック全19本というゲーム上の選択集合はAが所有し、Bが存在と再生可能性を検査する。

### 4.2 曲線と座標

- `sampleMotion(clipId, previousClipTime, clipTime): MotionSample`：読取専用入力から、区間内root差分、現在のローカル打撃体積と有効窓を返す予定API。
- 基準はメートル、秒、右手系。up軸、forward軸、原点、ヒット体積の中心・半径、root translationとroot yawの分離、補間・丸め・境界時刻規則をA/Cと凍結する。外部GLBの軸変換は派生生成時に1回だけ行う。
- rootは攻撃開始基準の移動曲線、手足の体積はサンプル時点のactor-local座標として渡す。Cは経路・衝突で確定したactor transformを使って1回world変換する。rootを含んだ座標へ再度rootを足さない。
- 判定用サンプル周波数、固定tick、補間方式をmanifestに保持する。初期案は固定tickと一致する等間隔サンプルと区間掃引。実際の周波数は高速度キックの接触を落とさない精度検査で確定する。
- Cは前後tickのworld体積から接触時刻・位置・法線などの候補を作る。Aが固定した時刻/ID順で相殺優先、身体命中、ダメージを解決する。BはAnimationMixer由来の命中イベントを発火しない。
- 射程は攻撃開始位置から「踏み込み＋手足軌道＋有効な打撃体積」を含む到達距離。計測平面・前方方向・高さ条件を凍結し、root距離だけ・待機姿勢の腕長だけで代用しない。
- 回転技の姿勢回転は残す。Cのactor headingとBの骨格内回転を分離し、毎描画フレームのlookAtで技の回転を打ち消さない。
- 攻撃開始時のworld-facing basisはCが固定し、技の移動軌道を途中で相手方向へ回し直さない。Cの接触候補はsimulation tickと区間内TOIを持つ。
- 通常ジャンプはCの移動/接地を正本とし、Bのジャンプクリップは表示。通常jumpではBのvisual root Yを除去する。技に内包された宙返りの高さは個別root方針に従い、aerial rootが必要な区間の所有権切替をPhase 0で凍結する。別のジャンプ重力・高度を二重適用しない。

### 4.3 時計・ロード・表示

- `loadAssetPack(version, abortSignal, onProgress): Promise<AssetPack>`：検証済み完全パックだけを返す。欠損・hash不一致・骨格不一致は理由付き失敗。中途半端な成功を返さない。
- `createAndroidInstance(pack, color): AndroidInstance` と `disposeAndroidInstance(instance)`：個体別骨格/アニメーター、共有mesh/textureの参照管理を分離する。
- `renderActor(instance, ActorVisualState): void`：clipId、attackInstanceId、clipTime、transform、deathVisualStateなど、A/Cの確定済み状態から描画する。ゲーム状態を変更しない。
- 時計の更新権限はA。通常clip進行はgameDelta、ポーズ・背景化時は0、敗北専用演出はAが供給するpresentationDeltaを使う。B独自のwall clockで進めない。
- 敗北完了の通知は表示の診断用で、Aの勝敗や実時間2秒を延長しない。ロード中の再試行UIはD、開始可否はAが所有する。

## 5. 段階と小タスク

実装時の各タスクは「失敗するテストを作る → 意図した失敗を確認 → 最小実装 → 関連テストを再実行 → 変更対象を限定したコミット」の順に進める。以下のチェックボックスは未実施。

### B0：契約と実行条件を受け取る

依存：AのPhase 0（P0）のPRを本人がマージし、全担当共通の新しいmain SHAを確認すること。契約commitの凍結だけではP1の実装開始条件を満たさない。成果物：source-lockの書式、曲線/座標/時計の合意、所有領域一覧、P1開始準備の確認記録。

- [ ] Aから契約commit、統合baseのSHA、採用パッケージ管理方式、予定テストコマンドを受け取る。
- [ ] P0が本人によってマージ済みであることと、その変更を含む新しいmain SHAを検証する。オーケストレーターとA/B/C/Dが同じSHAをP1開始baseとして記録したことを確認する。未マージのP0 branchや単なる契約commitから実装を始めない。
- [ ] 4.1〜4.3の要求を契約fixtureへ照合し、不足分はAへ戻す。特にimpactIndexとimpactId、clip秒と実秒、root座標を確認する。
- [ ] 原本取得先、派生物の保存先、GitHub送信対象・公開範囲の承認状況を分けて記録する。
- [ ] Bだけのworktree/branchを承認された非Cloud環境で用意する。環境の新規起動・インストール・公開は必要な権限を先に確認する。

P0の本人マージと共通の新main SHA確認が済む前は、読取調査、契約のレビュー、fixtureの設計までに限る。モック、fixtureコード、本体コード、素材の派生生成を先行実装しない。

出口条件：P0の本人マージと共通の新main SHAを検証済みで、そのbase上でAの凍結契約をimportする最小fixtureが型検査できる。未決の型はBが仮に公開しない。このゲート通過後は、素材取得がまだでもB1以降の合成fixture実装を並行できる。

### B1：原本固定・実42本の台帳・ロード失敗検知

予定ファイル：`tools/assets/source-lock.json`、`inventory.mts`、`src/assets/assetCatalog.ts`、`loadAssetPack.ts`、`tests/assets/inventory.test.ts`、`loading.test.ts`。

Consumes：凍結したAssetPackVersionとロード契約。Produces：版付き台帳、正常/異常のload結果。

- [ ] inventory testを作る。カテゴリ数9/1/13/19、合計42、一意clipId、実GLB内の名前、各duration>0、NaNなし、参照ファイルの存在をassertする。
- [ ] 欠落clip、同名重複、偽装拡張子、hash不一致、空GLBのfixtureで失敗を確認する。
- [ ] 許可された読取経路で固定版を取得し、原本を独立保存する。URL、版、取得日時、byte数、SHA-256を記録し、Drive素材は実ファイルの版/hashも固定する。取得済みと公開許可済みを混同しない。
- [ ] `inventory.mts`でindex/manifestの宣言とGLBの実animation一覧を突き合わせる。移動9、ジャンプ1、パンチ13、キック19の実測一覧を出す。不一致時に数を強制補正しない。
- [ ] speed15のdurationを検査し、比較用通常版が利用可能なら2/3比を確認する。通常版未取得ならその比率の追加検証は未実施として記録する。
- [ ] 取消・timeout・古いロード要求完了・再試行をテストし、失敗時にプレイ可能パックを返さない実装にする。
- [ ] テストを再実行し、実42本台帳とsource-lockだけを限定コミットする。

出口条件：原本hashとクリップ数の実測が揃う。原本未取得/不一致なら実素材統合ゲートはblocked。モック成功はこの出口条件を満たさない。

### B2：単一骨格・5色の派生パック

予定ファイル：`validate-skeleton.mts`、`derive-pack.mts`、`createAndroidInstance.ts`、版付き派生物、`tests/assets/skeleton.test.ts`。

Consumes：B1台帳、Aの座標契約。Produces：1骨格へ統合した42本、白/青/緑/黄/黒の表示バリアント。

- [ ] ボーン名・親子関係・bind pose・inverse bind matrices・スケール・skin weightsの互換性テストを作る。53ボーンは設計書の参考値であり、実計測との差を報告する。
- [ ] 非互換ボーン、異なるbind pose、欠損textureのfixtureが検査に落ちることを確認する。
- [ ] 互換ならカテゴリGLBのクリップだけを1つの基準骨格へ統合する。非互換なら原本を直さず、明示的な派生マッピングとポーズ比較を追加してから先へ進む。
- [ ] 5色を実素材に基づいて設定する。未取得色を推測で完成扱いしない。赤い発光と元デザインを比較する。
- [ ] 不変mesh/textureは共有し、個体別骨格・アニメーター・色/発光状態は独立させる。1体を倒しても他色の発光が消えないことをテストする。
- [ ] 立ち姿・移動・代表パンチ/キックの比較画像または動画、三角形数/textureサイズ/転送量の実測を記録する。
- [ ] テストを再実行し、元素材のhash不変と派生パック再生成の再現性を確認して限定コミットする。

出口条件：1機1骨格で42本を再生できる。色違いで動きや骨格が変わらず、複製カテゴリモデルが残っていない。最適化で見た目を失った場合は新しい派生版を不採用にし、原本はそのまま残す。

### B3：決定的なルート・打撃・射程メタデータ

予定ファイル：`bake-curves.mts`、`measure-reach.mts`、`motionSampler.ts`、`motion-curves.json`、`tests/assets/motionSampler.test.ts`。

Consumes：B2実クリップ、Aのimpact/座標/固定tick契約。Produces：MotionClipMetaとMotionSample、測定根拠付きeffectiveReachM。

- [ ] 合成の単発・3打・rootあり・回転技fixtureを作る。weight合計1、窓順序、window境界、同じ入力の同じ出力、時間外の安全なclampをassertする。
- [ ] root移動だけを射程にした誤実装、累積delta二重加算、描画fps依存サンプルがテストで落ちることを確認する。
- [ ] クリップをオフライン評価し、攻撃手足の体積とrootの固定曲線を生成する。見た目を確認して各打撃窓・impactIndexを記録する。アニメーション名から打数を機械的に決めない。
- [ ] 射程の計測基準と可視化を出し、踏み込みと手足到達の合成をA/Cと確認する。計測値と判定用曲線が同じ素材版を参照することを検査する。
- [ ] 1技の全打撃weight合計が1になること、AcrobaticComboは台帳に存在し抽選候補初期案ではfalseであることを検査する。
- [ ] Cへ単発/連続/回転/踏み込み/宙返りのfixtureを渡す。Cが空間接触候補を返し、Aが100対70→弱い側30、同値→0、相殺済み打撃の身体命中除外を検査できるようにする。
- [ ] 30/60/不規則描画fpsでも同じ固定tick入力の曲線値・metadata hashが一致することを確認し、限定コミットする。

出口条件：全採用攻撃の窓・配分・有効射程が実測される。B自身はダメージ計算を持たない。高速打撃の区間内接触はCの掃引テストと組み合わせて確認し、離散サンプルだけで漏れなしを断言しない。

### B4：描画専用アニメーターを接続する

予定ファイル：`actorAnimator.ts`、`tests/assets/animator.test.ts`、`tests/assets/browser/real-assets.spec.ts`。

Consumes：AのActorVisualState、Cのtransform、B2/B3パック。Produces：ゲーム状態を変更しない表示とライフサイクル診断。

- [ ] start/seek/pause/resume/clip切替/同一attackInstance再描画のテストを作る。通常倍率1、二重timeScaleなし、終了通知一度だけをassertする。
- [ ] rootをposeにもactorにも加えた場合、pause中に進む場合、古いinstanceの完了が新しい技を止める場合を失敗させる。
- [ ] 明示的clipTimeからポーズを更新する。歩行/走行の見た目、ジャンプ、攻撃、死亡の優先順位はA/Cの状態に従う。Bが入力や抽選を受け付けない。
- [ ] 回転技の視覚回転を残し、終了後の向き直りはCに任せる。root translationは可視骨格から分離し、Cの確定移動を一度だけ使う。
- [ ] ロード取消、再開、個体破棄、リトライ時のresource参照数をテストし、共有資源を早期disposeしない。
- [ ] 実GLBで通常/スロー/pause/復帰をブラウザ確認して限定コミットする。

出口条件：A/Cがモックから実アニメーターへ差し替えられる。描画終了イベントが戦闘判定の正本になっていない。モック動作と実GLB動作を別々に記録する。

### B5：専用敗北2クリップを制作する

予定ファイル：`author-death-clips.mts`、版付き`motions.glb`、`deathAnimation.ts`、`tests/assets/deathTiming.test.ts`。

Consumes：共通骨格、Aの致死原因とpresentation clock。Produces：パンチ/キック各1本の新クリップ、最終姿勢、発光停止マーカー。

- [ ] 2本それぞれactualDurationSec=0.5、非loop、全5色へ適用可、主要動作が末端までに完了するテストを作る。台帳が42+2=44になることをassertする。
- [ ] 誤った2秒clip、二重0.25倍、途中で待機へ戻す実装が失敗することを確認する。
- [ ] 原本ではなく新派生クリップとして、パンチ致死とキック致死で見分けられる倒れ込みを制作する。骨格の変更や未指定の機体再設計はしない。
- [ ] 0.25倍で2実秒の白敗北を再生し、最終姿勢を保持してA/Dの暗転0.4秒という初期案へつなぐ。ポーズ/背景化では演出時計も止める。
- [ ] 敵は1.5実秒で0.375 clip秒まで進み、解除後の残り0.125秒を継続再生する。次の状態へ遷移しても倒れる途中を切らず、倒れた個体を待機へ復帰させない。
- [ ] 同時致死・車致死・黒最終撃破でAが選んだ原因/結果に従うことを確認する。演出がHP・回復・採点や入力停止を変更しない。
- [ ] 白/青/緑/黄/黒の両致死パターンを動画または時刻付き連続画像で確認し、限定コミットする。

出口条件：44本台帳、2本の見た目、白の2秒完結と敵の継続再生が実素材で揃う。Dの粒子/赤HP区間が間に合わない場合はDへ報告し、B側で敗北時間を伸ばさない。

### B6：実1対1スライスから全4体の負荷を検証する

予定ファイル：`tests/assets/browser/real-assets.spec.ts`、`tools/assets/reports/`。依存：A/C/Dの接続とB1〜B5。

- [ ] まず白対青だけで、実素材ロード→歩行/走行/ジャンプ→単発/連続/回転技→相殺→敗北/撃破→再試行を検証する。必須クリップ欠損時に開始しないことも含める。
- [ ] 実1対1が通ってから、青→緑→黄→黒という初期順に拡張する。待機個体の表示/非表示・resident数はCと揃え、4敵分を読み込む場合のメモリを測る。
- [ ] source-lockの全名前に対して再生試験を行う。移動9、ジャンプ1、パンチ13、キック19、新規2の全44本を検査し、ゲーム採用集合とは分けて記録する。
- [ ] 最低限、初回/再試行ロード時間、実byte数、GPU資源見積、draw call、三角形数、常駐メモリ傾向、fps/frame time、長時間切替後の資源増加を記録する。
- [ ] iPhone 17 Pro Safariの安定30fps以上・余裕時60fps、iPhone 11 Pro / iPad Pro 2018の低負荷確認を別々の実機受け入れ項目にする。端末・OS・ブラウザ・画質・試験時間を残し、デスクトップやエミュレーションで代用合格にしない。
- [ ] WebGL中断/復旧、画面回転、背景化、slow中の復帰、再プレイを実素材で確認する。資源再生成はB、表示案内はD、状態停止/再開はA/Cと分担する。
- [ ] 軽量化が必要なら元モデル約47,198三角形・53ボーン、カテゴリGLB合計約22.17MBという参考値と実測を区別する。派生版ごとにポーズ/色/打撃曲線を再比較する。圧縮導入で依存変更が必要ならAへ依頼する。
- [ ] B局所テスト、型検査、ビルド、実素材ブラウザ、実機の結果を分離して提出する。

出口条件：実1対1を通過し、全4体の素材/色/技が存在し、必要な性能・復旧確認が証拠付き。実機未確保は未実施ゲートとして残し「完成」「実機30fps達成」と記載しない。

## 6. テストコマンド案と証跡

以下はすべて予定。現在これらのscriptやアプリが存在するとは限らず、この計画作成では一切実行していない。Phase 0でAが実際のpackage scriptsへ対応付ける。`npm`は仮の表記で、A確定後はlockfileに対応する1方式だけを使う。

- `npm run assets:inventory`：実42本/派生44本の台帳とhash検査。失敗件数0が合格。
- `npm run assets:validate`：骨格・全曲線・配分・射程・原本不変の検査。missing/duplicate/non-finiteなし。
- `npm run test -- tests/assets`：Bの単体/契約検査。全対象PASS。
- `npm run test:browser -- tests/assets/browser/real-assets.spec.ts`：実GLBを使うブラウザ検査。モック専用runをこの証拠に混ぜない。
- `npm run typecheck`、`npm run lint`、`npm run build`：A管理の集約検査。成功/失敗/未実行を別記。

実機性能検査はコマンド成功で置き換えない。提出証跡には `{baseSha, headSha, contractVersion, assetPackHash, sourceHashes, toolVersions, browser, device, commands, results, notRunReasons}` を含める。動画・画像・実測値が私有素材を含む場合も、外部添付前に送信範囲の承認を確認する。

## 7. 他担当への引き渡し

- Aへ：採用/除外を区別した実clip一覧、impactIndex/weight、effectiveReachM、clip durationと状態境界、ロード失敗種別、敗北時計fixture。Aがダメージ・熱量・原因選択・集合を確定する。
- Cへ：root/hit-volume曲線、単位と軸、骨格原点、visual root分離、rotation/airborne例、衝突でrootが短縮された場合の描画整合条件。
- Dへ：ロード進捗・失敗再試行契約、実描画位置を取得する窓口、死亡の発光/火花マーカー。HP吸収イベントと実ダメージはAから受け取る方式を維持する。
- オーケストレーターへ：許可領域の変更一覧、原本不変hash、残った未実施、要承認の公開対象、契約版、base/head SHA、必要な統合再検証。

契約追加要求は「不足する意味・最小fixture・影響する担当・互換性」を一件にまとめAへ送る。独自型追加で並列実装を先へ進めない。

## 8. PR・再検証の制約

- ブランチ名案は `feat/ningentomodachi-b-assets`。実際の名前とbaseブランチはオーケストレーターが指定し、開始時base SHAを記録する。素材参照commitを開発baseと誤認しない。
- Bは自分の所有領域だけをコミットし、package/lock/bootstrap/contractsを巻き込まない。元の `assets/android/**`、既存レビュー文書、無関係な添付物を変更しない。
- Draft PRは本人が依頼した案件でも、送信先repository、対象ファイル、公開範囲が承認済みの場合だけ作成できる。Drive由来の私有色素材/BLEND、新しい派生GLB、比較動画の追加を包括承認と推測しない。未承認ならローカル成果と一覧を渡して停止する。
- 本計画作成の承認を実装・外部送信の承認に読み替えない。実装時もマージ、auto-merge、本番配備はしない。Codex Cloud environmentsを使用する必要が生じたらユーザー自身の操作へ引き継ぐ。
- Draft PR本文には素材根拠版、assetPackHash、44本台帳、実素材/モックの検証区分、視覚差分、許可範囲、未実施実機を記載する。
- レビュー対象は最新head SHAに限定する。契約、共有設定、base、生成ツール、元素材、曲線、色、敗北clipのいずれかが変わったら影響範囲のテストを再実行する。競合解消・取り込み後も古いPASSを使い回さない。
- Bのlocal PASSだけで統合合格としない。最終統合headでA/C/Dを含む実1対1、全4体、相殺、2秒敗北、ロード復旧を再確認する。
- destructiveな上書き/削除/一括変更が必要なら、対象・件数・理由・影響・復元方法を示して事前承認を得る。復元用控えがない破壊的変更、再帰的強制削除は実行しない。

## 9. 将来のAgent Bへの開始プロンプト

あなたはニンゲントモダチのAgent Bです。この計画書と設計レビュー版6を読み、Aが凍結した契約commitを確認してください。P1実装を始めるには、P0のPRを本人がマージ済みであり、その変更を含む新しいmain SHAをオーケストレーターとA/B/C/D全員が共通baseとして確認済みであることが必要です。契約commitの凍結だけ、または未マージのP0 branchは開始条件になりません。ゲート通過前は読取調査とfixture設計のみを行い、モック/fixtureコードを含む実装や派生生成を始めないでください。ゲート通過後に素材・モーション担当の実装だけを進めてください。現在の実装/送信承認範囲は別途渡される原文を正本とし、この計画だけから承認を推測しないでください。

所有領域は src/assets、public/game-assets、tools/assets、tests/assets です。src/contracts、src/app、src/main.ts、index.html、package/lock/configはA、空間・移動はC、UI/入力はDの所有です。src/assets/index.ts からfactoryを公開し、Aだけがbootstrapへ結線します。共有契約を変更せず、不足はfixture付きでAへ依頼してください。原本と既存レビュー文書を保ち、取得物のhashと公開可否を記録してください。Codex Cloud environments、マージ、本番配備は行わないでください。未承認の外部送信も行わないでください。

42本の内訳と実GLBを照合し、1機1骨格、通常再生倍率1.0、決定的なroot/打撃曲線、全5色、敗北2本の順に実装してください。AcrobaticComboは保持し、抽選除外は設計初期案としてAの集合に従ってください。Aがダメージ/相殺/熱量、Cがworld変換とroot適用を担当します。0.5秒の敗北clipを0.25倍で2実秒とし、敵撃破1.5秒後は残りを等速で継続してください。

各タスクで失敗テスト、最小実装、再検証、限定コミットを行ってください。モック→実1対1→全4体の順を守り、実素材のブラウザ検査とiPhone/iPad実機検査を混同しないでください。必要なskillが見つからなければcheckoutの .agents/skills から関連するものだけを確認してください。

有用な結果は途中でも短く報告してください。完了時は変更ファイル、base/head SHA、契約版、assetPackHash、検査結果、未実施、ブロッカーを返してください。禁止/保留/不明の操作があれば、対象・理由・既に終わった範囲・結果の確実性を明記し、範囲を広げて迂回しないでください。

## 10. 計画の完了判定

B0〜B6が実装時の作業範囲である。現在完了するのは本計画の作成と設計整合の確認だけであり、将来のテストPASSや素材完成は宣言しない。親計画に必要な依存は「A契約凍結 → P0の本人マージ → 全担当共通の新main SHA検証 → P1のB/C/Dモック並列実装 → 実素材1対1 → 全4体・ブラウザ/実機受け入れ」で固定する。P0マージ前に並行できるのは調査とfixture設計までとする。
