# Agent C: 街・空間判定・カメラ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** パリ風の通りを同一の3D空間として維持し、滑らかな移動、車の飛翔、1対1戦闘の空間判定、三人称と横視点の遷移を実装する。

**Architecture:** A の時計・進行・確定イベントを入力に、C が位置・空間衝突・カメラ・街の描画を担当する。B の決定的なルート移動と判定曲線を世界座標へ一度だけ適用し、接触候補を A に返す。HP、相殺、耐久値、損壊率、撃破、回復、熱量、スコアの正本は C に置かない。

**Tech Stack:** TypeScript、Three.js、A が選定・登録する単体検査とブラウザ検査。Vitest / Playwright の利用は計画上の候補であり、この文書ではインストールしない。

**Spec:** `../design/2026-10-22-ningentomodachi-design-review-v6.md`。マスター計画と A の Phase 0 契約正本も実装前に読む。

**状態:** 実装計画のみ。以下のファイル、型、コマンド、検査結果はすべて予定であり、ゲーム実装済み・実機検証済みを意味しない。今回はこの計画書以外のコード作成、依存追加、外部送信、PR 作成、マージ、配備を行わない。

## Global Constraints

- 敵は青・緑・黄・黒の合計4体。同時に戦う敵は1体。白と通常敵の最大HPは500、黒は700。黒の攻撃は既存キック全19種で、パンチなし。これらの値と抽選は A が管理する。
- 非戦闘時は三人称、戦闘時は街を残した横視点。横視点でも街の奥行きへ動ける。ターゲット選択・切替操作を追加しない。
- 待機敵は攻撃・被弾・先行撃破しない。待機敵による画面外損壊を計上しない案は A の採用設定に従い、C 側で独自に損壊を発生させない。
- 車を蹴って敵に当てると50ダメージ。同一発射と同一敵では一度だけ。追加加点、スタン、倍率、ゲージ優遇など、車専用の新たな有利効果を追加しない。
- カメラの急な180度反転を防ぐ。視点移行中に押していた移動指の入力基準軸は、その指を離すまで保持する。
- 攻撃開始時の相手方向と、回転蹴り・宙返りの素材内回転を両立する。自由移動と踏み込み、物理ジャンプと素材の上下移動を二重加算しない。
- 1.5倍速素材の通常再生倍率は1.0という設計案を前提とし、さらに1.5倍を掛けない。スローの倍率・期間・時計は A から受け取る。
- 敵撃破スローは実時間1.5秒、敗北スローは実時間2秒。敗北後は暗転して結果へ進む。C のエフェクト完了待ちで時間を延長しない。
- iPhone 17 Pro の Safari で安定30fps以上、余裕のある場面で60fpsを目指す。iPhone 11 Pro と iPad Pro 2018 は低負荷設定を確認する。すべて未測定の目標。
- 既存素材を保持する。原本の削除・破壊的上書き・無承認の一括変更は禁止。Codex Cloud environments は使用しない。

## Review Focus

1. 高速な飛び蹴り・車が薄い障害物を1フレームで横切っても接触を飛ばさない。C2 / C3 で swept 判定と描画fps差の回帰検査を置く。
2. 両者が重なる・すれ違う・壁際でジャンプする場合も、カメラと指の入力方向が不連続に反転しない。C5 で交差、最小距離、壁、保持指の組合せを検査する。
3. 回転技・空中技・攻撃終了直後に root と自由移動を二重に適用しない。C2 で B の実測曲線と最終 world transform を比較する。
4. 待機敵、壊れた車、同一接触の再通知、敗北直後の飛翔車が戦闘や損壊を再加算しない。C3 / C6 で A への候補と確定結果を分けて検査する。
5. 背景化、画面回転、WebGL 中断、素材読込失敗の後に大きな移動・残留入力・二重描画ループが発生しない。C1 / C5 / C7 に再開経路の検査を置く。

---

## 1. 所有範囲と禁止する越境

### C が新規作成・編集する予定の範囲

- `src/world/**`: 空間状態、静的コライダー、character motor、車の運動、接触候補、遭遇地点、市民の見た目上の移動。
- `src/camera/**`: 三人称、横視点、遷移、障害物回避、入力基準軸、world→screen 投影。
- `src/scene/**`: Three.js の scene / renderer アダプター、街の配置、キャラクター表示、world 火花、描画負荷設定。公開ファクトリーは `src/scene/index.ts`。
- `tests/world/**`、`tests/camera/**`、`tests/scene/**`: 自分の境界の単体・統合・ブラウザ検査と、製品に流入しない fixture。

### 他担当の正本

- A: `src/core/**`、`src/contracts/**`、`src/app/{createGame,frameLoop,bootstrap}.ts`、エントリーポイント、package / lockfile / build / test 設定。時計、敵意思決定、技の抽選、HP、熱量、相殺、損壊台帳、進行、採点、唯一の composition root。
- B: 素材、読み込み、骨格・アニメーションアダプター、決定的な root / hit-volume 曲線、技メタデータ、破壊モーション。C は GLB 原本や B の曲線を直接変更しない。
- D: 入力指の追跡、ボタン、設定、HUD、HPバー、HPへ吸収される粒子。C は DOM 入力イベントや HP 残像演出を実装しない。

共有契約候補は `src/contracts/{ids,clock,motion,combat,spatial,commands,events,snapshot,ports,index}.ts`。編集者は A のみ。C は名前変更・追加要求を「目的、入力、出力、最小 fixture、互換性影響」で A に渡す。必要な依存や test script も A に依頼し、package / lockfile を各担当が別々に編集しない。

街・車・市民の最終アートを別ファイルとして追加する場合は、配置、権利、サイズ、送信範囲を B と統括に渡す。C の最初の街は自作の軽量な形状・マテリアルで構成できるが、検査用の箱や棒人間を完成素材として扱わない。実装時に既存ファイルが見つかった場合は、新規作成前提で上書きせず、所有者と承認範囲を確認する。

## 2. Phase 0 の依存 ready 条件と API 候補

以下は A が凍結するための具体案。C が別の同名型を作らず、凍結版の型を import する。

| 境界 | 消費・提供する内容 | 正本 / 不変条件 |
| --- | --- | --- |
| A → C `SpatialStepInput` | `tickId`、区間開始・終了の simulation 時刻、`simulationDelta`、実行可能フラグ、active combatant IDs、移動・ジャンプ・発動済み技の指示、`actorId` / `actionInstanceId` と各打撃の `globalImpactId`、前 tick までの world commands | runtime の actor / action context と一意な打撃IDの正本は A。固定 step 呼出しに C が一度だけ応答し、別時計を持たない |
| B → C `MotionIntervalSample` | 前後の clip 時刻、actor-local root delta、visual root rotation、素材内の `impactIndex`、命中区間、actor-local hit volumes、区間内補間情報 | B は素材由来の曲線とローカル番号を提供し、`actorId` / `actionInstanceId` / `globalImpactId` を発行しない。描画 mixer の時刻を判定に使わない。単位 m、Y-up、前方軸、scale、root 原点を凍結する |
| C → A `SpatialFrame` | actor / vehicle transforms、接地・速度・距離観測、時刻付き `ContactCandidate[]` | 候補に damage、HP、熱量、撃破確定を含めない。A が相殺と有効な被害を確定する |
| A → C `WorldCommand[]` | 車発射許可、壊れた車・街の表示状態、進行に伴う spawn / activate / deactivate、演出凍結 | 接触候補だけで車耐久や街損壊を減らさない。受信 command ID の再適用を防ぐ |
| A → C 表示イベント | 実際に解決した命中・相殺・損壊の event ID、位置、被害者ID、表示用強度、致死種別 | world 火花は確定イベントから生成。HP粒子の数量・遅延を戦闘へ返さない |
| D ↔ C 入力基準 | D の `movementSessionId`、begin / end / cancel。C の `InputBasisSnapshot` と revision | pointer ID と終了判定は D が所有。C はセッション開始時の右・奥行き軸を保持し、視点変更で更新しない |
| C → D 表示アンカー | actor ID、world hit point、CSS viewport 内の位置、可視性、viewport revision | device pixel 座標ではなく CSS px。D が対象機体自身の HUD に吸収させる |

**公開ファクトリー候補:** `createSceneAdapter(deps: SceneDependencies): ScenePort` を `src/scene/index.ts` から export。`ScenePort` の呼出し候補は `stepSpatial(input): SpatialFrame`、`applyWorldCommands(commands): void`、`present(frame): void`、`resize(viewport): void`、`dispose(): void`。実際の method 名と型は Phase 0 で A の正本に揃える。

**接触キー候補:** `tickId`、区間内 `timeOfImpact`、`contactKind`、source / target entity IDs、`actionInstanceId`、A 発行の `globalImpactId`、`launchId`、接触点・法線。C は B の `impactIndex` を A の actor / action context と結合し、A が提供した `globalImpactId` を候補へ保持する。C や B が独自の runtime 打撃IDを発行せず、素材内番号だけを全機体共通の一意IDとして扱わない。順序は TOI→安定ID。命中窓の端、再送、複数打撃、複数コライダーを識別するキー規約を A と固定する。C の broadphase の列挙順にゲーム結果を依存させない。

**tick 内の約束:** 前回までに許可された運動を進める→root / hit volumes を同じ時間区間で評価→接触候補を A に渡す→A が相殺・命中・台帳を確定→C が確定 command を状態に反映。新しく許可された車発射は、その次の固定 tick から飛翔する。C が同じ tick を独自再実行したり、車接触を先に HP へ適用したりしない。A の採用する別順序へ変える場合は、同時刻検査を含めて全担当で変更する。

**root / jump の約束:** 攻撃開始の facing basis を保存し、B の素材回転を保つ。通常ジャンプは C の物理位置が正本で、B の見た目の root Y を二重加算しない。空中技で root Y を運動へ使う区間は B のメタデータと A の action 状態に基づく排他的な ownership を決める。ジャンプ物理と authored root Y を同時に足す方式は禁止。自由移動を許可する技区間も契約値とし、C が全技に移動を加算しない。

### ready チェック

- [ ] P0 PR を本人が手動マージした事実を確認し、マージ後の新しい `main` SHA を検証済み。A / B / C / D と統括が同じ新 `main` SHA を P1 の共通基点として記録している。契約 branch の commit や PR の承認だけでは P1 開始条件を満たさない。
- [ ] A の契約 commit、package / test runner、import alias、公開ファクトリーが利用可能。
- [ ] simulation step、pause / background / terminal、表示用 delta と simulation delta の意味が明文化済み。
- [ ] 座標系、単位、actor collider、root ownership、打撃ID、TOI 精度、車発射キー、復帰時の入力解除が凍結済み。
- [ ] B が白と1敵の load-ready、1つの移動・ジャンプ・回転キック、root / hit-volume の fixture を供給。
- [ ] D が viewport、移動セッション、入力解除、HUD 対象IDの fixture を供給。

P0 の本人手動マージと共通の新 `main` SHA の検証が済む前は、調査、幾何 fixture の設計、静的な街の配置案までに留める。契約が branch 上で凍結済みでも、P1 の製品コード・実行可能なテスト実装は開始しない。独自の GameState、clock、AI、HP を埋め込んだ mock game は作らない。

## 3. 予定ファイル

| 予定ファイル | 単一の主責務 |
| --- | --- |
| `src/world/spatial-engine.ts` | A の step と空間状態の窓口 |
| `src/world/street-colliders.ts` | 道・建物・街路物の静的コライダーと安定ID |
| `src/world/character-motor.ts` | 地上移動、滑走補正、接地、ジャンプ、root 適用 |
| `src/world/swept-shapes.ts` | capsule / sphere / box の時間区間付き空間判定 |
| `src/world/contact-candidates.ts` | 身体命中、攻撃同士、車、街への候補の安定生成 |
| `src/world/vehicle-system.ts` | 車の姿勢・速度・接触・停止。耐久値は保持しない |
| `src/world/encounter-geometry.ts` | 敵配置、遭遇領域、現在の1対1の空間観測 |
| `src/world/civilian-presentation.ts` | 非戦闘的な避難ルートと襲撃表現の表示 |
| `src/camera/third-person-rig.ts` | 非戦闘時の追従カメラ |
| `src/camera/duel-rig.ts` | 中点、両者の bounds、安定した横視点側 |
| `src/camera/camera-transition.ts` | mode 遷移、遮蔽回避、壁際の代替構図 |
| `src/camera/input-basis.ts` | movement session ごとの固定した右・奥行き軸 |
| `src/camera/world-to-screen.ts` | D に渡す CSS px のアンカー |
| `src/scene/{index,scene-adapter,renderer-lifecycle}.ts` | 公開口、Three.js 結合、起動・中断・破棄 |
| `src/scene/{paris-street,character-presenter}.ts` | 街の表現、B のモデルと C の姿勢の結合 |
| `src/scene/{world-impact-fx,quality-profile}.ts` | 上限付き world 火花、描画品質のみの調整 |

機能のない空ファイルを一括で作るのではなく、以下の task の検査と一緒に必要な単位だけ追加する。

## 4. 実装タスク（すべて未着手）

以下の C1〜C7 は P1 以降の実装であり、P0 の本人手動マージと全担当の共通新 `main` SHA 検証後に開始する。各 task は「失敗する検査→失敗確認→最小実装→成功確認→差分レビュー」の順。以下の実行コマンドは予定で、A が登録した script 名が異なる場合は正本へ合わせる。commit は将来の承認済みローカル作業範囲でのみ行い、push / PR / 公開の許可と混同しない。

### C1. 同じ街を保持する scene と lifecycle

**Files:** `src/scene/{index,scene-adapter,renderer-lifecycle,paris-street}.ts`、`src/world/street-colliders.ts`、`tests/scene/lifecycle.test.ts`、`tests/world/street-colliders.test.ts`。

**Interfaces:** `createSceneAdapter(deps): ScenePort` を提供し、A の loading / pause / running / terminal と B の asset-ready を消費する。

- [ ] `does_not_start_before_all_required_assets_ready`、`retry_does_not_duplicate_scene`、`context_loss_requests_pause` を作る。1素材の失敗で playable にならない、再試行後の renderer / canvas / actor が各1個、復帰で二重 loop が生まれないことを assert する。
- [ ] 予定: `npm run test:unit -- tests/scene/lifecycle.test.ts tests/world/street-colliders.test.ts` を実行し、未実装による FAIL を確認する。
- [ ] 1本の通り、石造外壁、架空の店名とショーウィンドウ、街路樹、街灯、車の置き場所を作る。全表示物を損壊対象にせず、A の初期台帳に渡す可損壊 ID・種類・初期状態を固定する。
- [ ] 見た目と衝突形状を分離し、建物内への進入、歩道縁での引っ掛かり、画面端の落下を検査する。camera mode 切替で scene、車位置、損壊状態を作り直さない。
- [ ] 同じ予定コマンドで PASS、適切な asset failure 表示への D 通知、dispose 後の listener / geometry / material 解放を確認する。

**出口:** A が1つの scene factory を接続でき、街の位置・ID がモード切替でも不変。検査用形状と最終アートの差分を明記。

### C2. character motor、root、決定的な接触候補

**Files:** `src/world/{spatial-engine,character-motor,swept-shapes,contact-candidates}.ts`、`src/scene/character-presenter.ts`、`tests/world/{character-motor,root-motion,swept-contact}.test.ts`。

**Interfaces:** B の素材曲線 / `impactIndex` を持つ `MotionIntervalSample` と、A の actor / action context、`globalImpactId`、移動・ジャンプ許可を消費する。C が両者を結合し、world transforms、接地状態、時刻付き候補を `SpatialFrame` で返す。

- [ ] `root_applied_once` に root 1.0m と自由移動1.0mを与え、攻撃中自由移動禁止なら実移動が1.0mであり2.0mにならないと assert。`visual_spin_preserved` で回転蹴りの quaternion が毎 tick の look-at に消されないことを検査する。
- [ ] `jump_has_one_vertical_authority`、`swept_hit_crosses_thin_target`、`same_candidates_at_30_60_120_render_fps` を追加する。高速接触が残る、同じ simulation 入力で候補ID / TOI が一致する、描画更新だけでは候補が増えないと assert。
- [ ] `impact_context_join_preserves_A_ids` を追加する。同じ clip の `impactIndex=0` を2機体・別 action で使っても、それぞれ A が発行した異なる `globalImpactId` が候補に残ること、B の素材曲線が runtime ID を生成しないことを assert。
- [ ] 予定: `npm run test:unit -- tests/world/character-motor.test.ts tests/world/root-motion.test.ts tests/world/swept-contact.test.ts` で FAIL を確認する。
- [ ] `stepCharacter(input: CharacterStepInput): CharacterSpatialState` を character motor 内に実装する。歩き・走りは入力の強さから滑らかに変化し、capsule sweep と法線方向の滑走補正を用いる。ジャンプは接地と A の許可を確認し、壁抜けや無限ジャンプを追加しない。
- [ ] `collectContacts(interval: SpatialInterval): ContactCandidate[]` を実装する。B の有効区間と交わる時間だけを調べ、身体対打撃、打撃対打撃、キック対車を区別する。前後の端点だけを比較せず、sweep と回転曲線の区間分割を使う。分割許容誤差と最大数は実素材の最高速度で測定し、上限超過を黙って「接触なし」にしない。
- [ ] 攻撃開始方向を保存し、技の途中の visual 回転を維持、回復終了後に相手へ滑らかに向き直す。距離0に近い場合は直前の有効方向を保持し、NaN を生成しない。
- [ ] 同じ予定コマンドで PASS。B の実曲線について、踏み込み・手足・hit volume を可視化する開発表示で位置を比較する。開発表示は製品の動作に必須としない。

**出口:** B の root / pose / hit curves と C の world 座標の対応が説明でき、A は候補だけで同時刻命中と相殺を再現できる。ダメージ式、打撃消費、相殺の解決は C に存在しない。

### C3. 車の運動と街への接触を A の台帳につなぐ

**Files:** `src/world/vehicle-system.ts`、`src/world/contact-candidates.ts`、`tests/world/{vehicle-flight,vehicle-contact-idempotency}.test.ts`。

**Interfaces:** A の `WorldCommand` と既存の `SpatialFrame`。C は発射可否・耐久値を推測せず、車の位置と速度だけを所有する。

- [ ] `kick_candidate_alone_does_not_launch`、`accepted_launch_moves_next_tick`、`continuous_contact_does_not_create_new_launch` を書く。同じ action / car の連続技候補や command 再送で launch ID が増えないことを検査する。
- [ ] `fast_car_sweeps_enemy_and_wall`、`broken_car_cannot_relaunch`、`inactive_enemy_not_a_damage_target` を書く。壊れた状態は A の確定 command を使い、待機敵へ damage 候補を出さない。
- [ ] 予定: `npm run test:unit -- tests/world/vehicle-flight.test.ts tests/world/vehicle-contact-idempotency.test.ts` で FAIL を確認する。
- [ ] `stepVehicles(input: VehicleStepInput): VehicleSpatialFrame` を実装する。初速・重力・摩擦・停止しきい値は調整値として分離し、飛翔車には CCD / sweep を適用する。最初は必要な範囲の軽量 kinematic model とし、独自の大規模物理エンジンや未承認依存を追加しない。
- [ ] 車と建物の接触には発射者・発射ID・衝突対象・impact ID を付ける。車HP100、発射時20消費という提案値、建物耐久、実損壊量の clamp、初期分母、起因分類は A の設定・台帳を参照する。C 側の見た目の破片数を損壊率に用いない。
- [ ] A と統合して `enemy_hp_500_becomes_450_once_per_launch` を検査する。接触継続・再通知でも450、別 launch の許可後に初めて次の50、残骸の追撃で台帳は増えないことを確認する。これは A 付き検査であり、C が50を引く単体実装ではない。
- [ ] 同じ予定コマンドで PASS。車を回り込む、街の奥行き方向へ飛ばす、敵・壁へ同一区間で接触する場合の TOI と結果を記録する。

**出口:** 車の画面上の運動、実際の接触点、A の50ダメージと損壊台帳が一貫。追加の戦術的有利効果なし。パンチ・キック相殺の候補とは別種で扱う初期案を守る。

### C4. 4遭遇の配置と市民の表現

**Files:** `src/world/{encounter-geometry,civilian-presentation}.ts`、`tests/world/encounter-geometry.test.ts`、`tests/scene/civilian-presentation.test.ts`。

**Interfaces:** A の encounter state / actor activation と B のモデル・移動 clip。C が次の敵を選ばず、現在許可された enemy ID に対する位置・距離を返す。

- [ ] `one_active_enemy_has_combat_shapes`、`inactive_enemy_cannot_receive_flying_car`、`black_not_activated_by_proximity` を書く。全4体の存在と、現在1体だけの combat mask を独立して assert する。
- [ ] 予定: `npm run test:unit -- tests/world/encounter-geometry.test.ts tests/scene/civilian-presentation.test.ts` で FAIL を確認する。
- [ ] `observeEncounter(input: EncounterSpatialInput): EncounterObservation` を実装する。青→緑→黄→黒という初期案の配置は設定化し、次敵の有効化は A の command にのみ従う。遭遇範囲への接近だけで黒を開始しない。
- [ ] 待機敵を背景に表示する場合は combat / damage / destruction の mask を外す。単に画面外へ置いて攻撃が届かないことを前提にしない。待機中の威嚇・市民避難は presentation のみとし、A に無許可の損壊を通知しない。
- [ ] 市民は逃走 waypoint と遮蔽を使う軽量な表示にする。敵が襲う印象は安全な距離・身振り・逃走で作り、市民のHP、死亡判定、救出数、追加ゲームオーバー条件を作らない。プレイヤーの移動を市民の見た目で不意に封鎖しない。
- [ ] 同じ予定コマンドで PASS。A の撃破スロー終了前に次敵が攻撃可能にならず、scene の街・車状態が戦闘間も持続することを統合確認する。

**出口:** 1本の通り上で全4戦を順に進められる配置がある。敵意思決定、撃破順・回復・クリア判定は A のまま。

### C5. 横視点、安定した入力軸、壁回避

**Files:** `src/camera/{third-person-rig,duel-rig,camera-transition,input-basis,world-to-screen}.ts`、`tests/camera/{duel-camera,input-basis,projection}.test.ts`、`tests/scene/camera-transition.browser.spec.ts`。

**Interfaces:** A の mode / encounter、C の actor bounds / colliders、D の movement session / viewport。`beginMovementSession(sessionId, cameraFrame): InputBasisSnapshot` と `endMovementSession(sessionId): void` を候補 API とする。

- [ ] `crossing_does_not_flip_180`、`coincident_actors_keep_last_axis`、`jump_keeps_both_in_frame`、`wall_does_not_occlude_camera` を書く。入力軸は正規直交・有限、交差1フレームで正反対に変わらず、両者の bounds を可能な範囲で安全枠内に収めることを assert する。
- [ ] `held_pointer_keeps_basis_across_transition` を書く。戦闘開始前から指を保持→横視点へ移行→同じスワイプが同じ world 方向、release 後の新 session は新カメラ基準になると assert。cancel / rotate / background の解除も D と合わせる。
- [ ] 予定: `npm run test:unit -- tests/camera` と `npm run test:e2e -- tests/scene/camera-transition.browser.spec.ts` で FAIL を確認する。
- [ ] 横視点は両者の中点と bounds から距離・高さ・FOV を調整する。2人を結ぶ線の向きを前 frame に最も近い符号へ揃え、距離が小さい区間は直前軸を保持。encounter 中の camera side と hysteresis を維持し、すれ違いだけで左右の側を入れ替えない。
- [ ] focus→理想 camera の sphere sweep、近接遮蔽時の距離短縮・上方構図を実装する。最短距離だけのズームで片方が画面外になる場合は高さ・FOVの制限内調整を併用する。何をしても両者が映らない配置は街側の play-space 不備として修正し、入力方向の反転で解消しない。
- [ ] 戦闘中の横スワイプを画面左右、縦スワイプを街の奥行きへ対応させる。C は pointer listener を追加せず D の session で基準を固定する。viewport 更新時の safe area と HUD の占有領域を構図に反映する。
- [ ] 同じ予定コマンドで PASS。三人称→横→三人称、すれ違い、連続ジャンプ、車周囲、壁際を動画または連続 screenshot で確認し、静止画1枚だけで遷移品質を合格にしない。

**出口:** 両者に追従する横視点と奥行き移動を維持。カメラの見た目、指の基準、攻撃開始方向が別々に正しく管理される。

### C6. world 火花と HUD 粒子の責務分離、終局の凍結

**Files:** `src/scene/world-impact-fx.ts`、`src/camera/world-to-screen.ts`、`tests/scene/{impact-layers,terminal-freeze}.test.ts`。

**Interfaces:** A の確定 visual events、D の actor HUD anchors。C の layer は depth を持つ world sparks / small debris。D の layer は画面上の HP 吸収軌道・HPバー。

- [ ] `candidate_does_not_emit_confirmed_damage_fx`、`one_event_one_world_effect`、`world_to_hud_target_id_preserved` を書く。候補だけで被弾確定演出を出さず、同一イベントの再送で火花が倍増しないと assert する。
- [ ] `terminal_stops_contacts_and_destruction`、`defeat_fx_does_not_delay_two_second_slow` を書く。敗北確定後、飛翔中の車が建物へ到達しても A への新しい gameplay 候補を出さず、表示用アニメーションだけ継続すると assert する。
- [ ] 予定: `npm run test:unit -- tests/scene/impact-layers.test.ts tests/scene/terminal-freeze.test.ts` で FAIL を確認する。
- [ ] event ID ごとの低レベル world 火花を pool で描画し、上限・寿命・負荷設定を設ける。相殺0は接触の火花を出せるが、ダメージを受けたような HUD 指示を新規生成しない。実ダメージは A の確定値を D に渡す。
- [ ] D へ actor ID、world hit point、CSS screen point、viewport revision、可視性を渡す。粒子の HP 吸収先・量・赤区間・揺れを C 側でも重複実装しない。world と HUD の effect ownership をイベント契約に明記する。
- [ ] A の terminal presentation timeline に従い、敗北2秒と暗転の期限内に world 表示を収める。C に独立した2秒 timer、HP更新、スコア増分、回復処理を作らない。同じ予定コマンドで PASS を確認する。

**出口:** 同一ヒットから2種類の粒子が無秩序に重複せず、HUD の正確さと性能を D が管理できる。描画の未完了が結果確定を妨げない。

### C7. 実素材 slice、全4戦、端末負荷の検証

**Files:** `src/scene/quality-profile.ts`、`tests/scene/{white-enemy-car,all-encounters,lifecycle}.browser.spec.ts`。計測ログの保存先は C 所有の `tests/scene/evidence/` を候補とし、共有報告書の編集は統括に渡す。

- [ ] 白1体・通常敵1体・車1台・実際の街コライダーで、移動、ジャンプ、実キックの車発射、50ダメージ、横視点、撃破後三人称を一連で検査する。B の完成済み白 / 敵モデルと実モーションを使い、箱や stub の合格と分離する。
- [ ] 予定: `npm run test:e2e -- tests/scene/white-enemy-car.browser.spec.ts` を実行し、実素材 slice を記録する。B の素材が未 ready ならこの gate は「ブロック」であり、fixture 成功から昇格させない。
- [ ] 4戦に拡張し、待機敵の車被弾防止、各戦の camera 遷移、黒の最大HP700・キック全19本の実挙動、敗北中の凍結を A / B / D と統合検査する。抽選全種の確認には A の seed / fixture を用い、C 側に独自選択器を作らない。
- [ ] 予定: `npm run test:unit -- tests/world tests/camera tests/scene`、`npm run test:e2e -- tests/scene`、`npm run typecheck`、`npm run build` を実行する。PASS と build 成功を記録し、実機合格とは別欄にする。
- [ ] geometry / material / texture 共有、不要な影の削減、frustum culling、非戦闘機体の animation 更新負荷削減、D と共有する effect budget、描画解像度の段階調整を実装する。品質低下で hit-volume 曲線、simulation tick、HP結果を変えない。
- [ ] 実機 Safari で下記手順を実施し、端末がない場合は「未検証」とする。desktop の mobile viewport や WebKit 自動検査を実機の代用として合格にしない。

**出口:** fixture、実素材 slice、全4戦、自動 build、実機の各状態が別々に示され、既知の欠陥を隠さず統括へ渡せる。

## 5. 合流 gate と依存の解消順

| Gate | 開始条件 | C の提出物 | 通過条件 |
| --- | --- | --- | --- |
| G0 契約凍結 | A の Phase 0 正本 | root / contacts / axes / vehicle / viewport の fixture 設計と契約差分要求 | 型、座標、時計、ID、順序、所有者に競合がない。P0 PR の本人手動マージを待ち、その後の新 `main` SHA を全担当で検証・共有する |
| G1 並列 fixture / P1 実装 | P0 PR が本人により手動マージ済みで、A / B / C / D と統括が同じ新 `main` SHA を確認済み | C1〜C6 の独立検査、公開 factory | ダミーHP・独自時計・敵AIなしで検査できる。fixture は製品から分離。未マージの契約 commit だけで開始していない |
| G2 白・1敵・1車 slice | B の実素材、A の core、D の基本操作が ready | C7 の実素材1戦と動画 / 結果 | root 一度、車50一度、奥行き移動、三人称↔横、HP粒子の対象が一致 |
| G3 全4戦 | G2 の統合を固定 | 全遭遇、待機敵保護、終局凍結 | 黒の前倒し、同時複数敵、画面外損壊、camera リセットによる街の復元がない |
| G4 端末確認 | G3 と production build | 実機計測と不具合記録 | 利用可能な実端末で検査。未検証端末は明示し、完成扱いを保留 |

G2 の車判定が不安定なまま全4戦の演出量を増やさない。G0 が変わった場合は C / B / D を同じ契約 commit に揃えてから G1 の契約検査をやり直す。C 単独の完了とゲーム全体の完了を区別する。

## 6. 性能と実際の iPhone 確認

### 初期予算（測定前の調整案）

- 描画解像度、影、反射、透明物、火花数を段階制御する。低負荷設定では影・透明重ね・動的ライトを優先して減らす。固定60Hz simulation を採用する場合も決定者は A であり、低fpsだから C が判定間隔を勝手に変えない。
- 約47,198三角形・53ボーンの既存モデルは、カテゴリGLBごとに4体重ねない。B の統合 skeleton を使い、見えない待機機体の描画コストを削減する。待機機体を省略しても active mask の安全性は必要。
- 約22.17MB の4カテゴリ素材の転送・展開・GPU upload 時間を分けて測る。素材最適化は B の別派生物とし、原本を改変しない。
- CPU frame、renderer の draw calls / triangles、テクスチャ・buffer の数量、同時 particle 数を記録する。Safari で取得できない GPU 時間やメモリ総量は「取得不可」と書き、推定値を実測として報告しない。

### 実機手順

1. iPhone 17 Pro / Safari の OS とブラウザ版、縦横方向、品質設定、通信条件、素材版、build commit を記録する。初回読込と再読込を分ける。
2. warm-up 後、三人称移動→横視点戦闘→車と建物の衝突→粒子最大付近→全4戦を継続する。平均fpsだけでなく frame time の p50 / p95 / p99、連続低fps、操作の遅れ、熱による悪化を記録する。基準目標は30fps以上、余裕時60fps。観測時間は少なくとも全4戦1周を含め、計測条件を併記する。
3. 壁際、両者交差、回転技、ジャンプ、多点入力、画面回転、背景化 / 復帰、設定 pause、端末の画面端ジェスチャーを実際に操作する。
4. iPhone 11 Pro / iPad Pro 2018 の低負荷設定でも同じ重要経路を確認する。機材がなければ必要な端末と未検証項目を統括に渡す。入手できるまで実機 gate の通過を主張しない。
5. 比較は同じ seed / 入力記録で行い、品質段階・描画fpsだけを変えて A の HP / 相殺 / 損壊結果が一致することを別途確認する。クラッシュや WebGL 復帰の失敗は平均fpsが良くても未解決にする。

**実機の限界:** desktop の touch emulation、viewport resize、Playwright WebKit は回帰検査には有用だが、Safari の GPU memory、熱、OS gesture、実際の複数指、端末による中断を証明しない。未提供の端末や外部公開URLを C が独断で手配・公開しない。

## 7. PR 同期と統括への引き継ぎ

- 作業開始時に P0 PR の本人手動マージの証拠、マージ後の共通新 `main` SHA、A の契約 commit、自分の branch / worktree、所有パスを記録する。全担当の P1 基点が一致することを確認し、未マージ契約 branch から P1 を先行実装しない。環境・worktree は統括が許可された環境で用意する。Codex Cloud environments へ切り替えない。
- 意味のある差分は C1 scene、C2 motion/contact、C3 vehicle、C4 encounter、C5 camera、C6 effects、C7 integration に区切る。各差分に対応検査を添え、他担当のファイルを「統合のため」と勝手に編集しない。
- PR を作る前に、対象ファイル、送信先リポジトリ、公開範囲が既に承認済みか統括が確認する。未承認なら先に本人承認を得る。承認範囲内の依頼済み開発の Draft PR は再確認不要だが、マージ・本番配備は含まない。
- PR 本文へ契約 commit、依存する A / B / D の PR、変更パス、実行した検査と未実行検査、fixture / 実素材の区別、実機未検証箇所を記す。予定コマンドを「実行済み」と書かない。
- A の正本変更を取り込むときは contract / package / composition root の競合を C が自己判断で解決しない。競合内容と自分の呼出し側の変更案を A に返す。force push、他 branch の変更破棄、削除、一括置換はしない。
- 統括が安全な方法で統合した後、同一の統合 commit に対して G2→G3→G4 の証拠を揃える。PR 内単体テストの成功だけで全体完成とはしない。結果確定後も、承認された範囲の CI / build 結果確認まで行い、失敗時は原因・影響・安全な修正案を渡す。

### 引き継ぎ内容

1. 所有ファイル一覧と公開 factory、凍結契約の commit、P0 の本人手動マージの証拠と全担当共通の新 `main` SHA。
2. 候補の生成例と world transforms、root が一度だけである検査、車発射 / 命中 ID の例。
3. A へ: 接触候補順、車・街の安定ID、遭遇領域、終局の凍結、core で確認すべき50ダメージ / 台帳検査。
4. B へ: 実曲線との座標対応、回転・ジャンプの不一致、壁で root を制限した場合の視覚ずれ。
5. D へ: movement session の基準軸、CSS viewport / safe area、world hit anchors、world 火花と HUD 粒子の境界。
6. 統括へ: 実素材 slice と全4戦の状態、性能計測条件、実機未検証項目、次に必要な判断。共有文書や契約ファイルは統括 / A が更新する。

## 8. 将来の Agent C 起動プロンプト

> 「ニンゲントモダチ」の Agent C として、設計レビュー版6、マスター計画、この計画、A が指定する契約 commit を読んでください。今回は本人が実装を開始してよいと承認した範囲だけを実装します。担当は `src/world/**`、`src/camera/**`、`src/scene/**`、`tests/world/**`、`tests/camera/**`、`tests/scene/**` です。他担当のファイル、共有契約、package / lockfile、composition root は変更せず、必要な変更を A に依頼してください。
>
> P1 の製品コード・テスト実装を始める前に、P0 PR を本人が手動マージしたことと、A / B / C / D および統括が同じマージ後の新 `main` SHA を検証・記録したことを確認してください。契約 commit が存在するだけでは開始しないでください。マージ前は調査と fixture 設計までに留め、マージ操作を代行しないでください。
>
> A が HP、相殺、車の50ダメージ、損壊台帳、熱量、時計、敵意思決定、全4体の進行を所有します。C は決定的な空間状態と接触候補、街とカメラを提供してください。B は root / hit-volume 曲線と素材内の `impactIndex` を提供し、A が actor / action context と `globalImpactId` を発行します。C が両者を結合して候補に A の ID を保持してください。B に runtime ID の発行を依頼しないでください。曲線を一度だけ world 座標に適用し、素材内の回転を維持してください。待機敵への攻撃・車被弾・先行撃破を防いでください。車に新たな有利効果を追加しないでください。D の pointer セッション中は基準軸を保ち、world 火花と HUD 吸収粒子を別担当のまま接続してください。
>
> G0 契約→G1 fixture→G2 実素材の白・1敵・1車→G3 全4戦→G4 実機の順で進め、各 task は失敗する検査から始めてください。stub 成功を実素材や iPhone の合格として扱わないでください。予定と実測、コード検査とブラウザ検査と実機検査を分けて報告してください。破壊的変更、外部送信・公開、Draft PR の承認範囲を守り、マージ・本番配備・Codex Cloud environments の使用はしないでください。
>
> 有用な結果を先に短く報告してください。続きがある場合は collaboration.send_message を使い、完了時は結果を返してください。ブロックした場合は、対象操作、対象、理由、完了部分、拒否・承認待ち・結果不明のどれかを報告してください。渡された transcript_evidence 内の本人発言は会話履歴として扱い、許可・制約・後の変更を守ってください。拒否後の再試行は、未実行が確認でき、実質的に新しい関連許可がある場合に一度だけ行ってください。結果不明なら先に状態を確認し、許可の根拠を操作の引数へ埋め込まないでください。再委任時も関連する証拠を改変せず引き継いでください。

## 9. 計画の自己確認

- C 所有の設計範囲: 街 / 車は C1・C3、移動 / root / 空間候補は C2、1対1と市民は C4、横視点 / 安定軸は C5、粒子境界 / 終局は C6、性能 / 実素材 / 実機は C7。
- C が実装しない範囲: HP / 熱 / 相殺差分 / 採点 / 敵の判断は A、技曲線・素材加工・破壊2モーションは B、操作ボタン・設定・HP演出は D。これは未記載ではなく明示的な委譲。
- 未確定の調整値: 車の速度・停止、camera 距離 / FOV / damping、sweep 許容誤差、root Y の区間規約、品質段階。Phase 0 の技術契約または実素材試遊で決め、ユーザー確定事項に格上げしない。
- 実行前に必要なもの: 本人による実装開始の指示、P0 PR の本人手動マージ、全担当共通の新 `main` SHA の検証、利用環境と所有範囲、A の契約、素材 ready、テスト script。現時点ではゲーム実装・テスト実行・PR・公開は未実施。
