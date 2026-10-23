# B asset/animation module

All exports are in `index.ts`. The shared DTOs in `../contracts` are the authority. This module neither creates a renderer nor modifies HP, heat, spatial transforms, input, progression or results.

## Composition

- `createMotionCatalog(load, { timeoutMs })` returns a per-run `MotionCatalogPort`. `load(signal)` supplies fully annotated `MotionAsset[]`; only an entirely validated immutable catalog is published. Failed, aborted, stale and disposed requests cannot publish.
- `createActorAnimator(context, assets)` returns `AnimationPort`; context includes C's public `ActorRenderHostPort<Object3D>`. `assets` supplies B-owned rigs, exact clip durations and the four locomotion clip IDs. A must prepare before rendering.
- `createAssetsModule(context, catalog, assets)` is a convenience returning those two public B ports. It does not replace A's factories or bootstrap.
- `createThreeAssetPack(sourceBytes, palettes, extraClips)` uses one compatible source hierarchy and all category clips. Verify bytes with `loadVerifiedSource` first. It returns `create(color)`, `clipDuration`, `clipNames`, `dispose`. Use `SOURCE_PALETTES` for the four source-derived enemy material variants. White is unchanged. Sources must contain no duplicate clip names.
- One hierarchy contains five skinned material primitives sharing 53 bone instances. It is not four category actors. Each actor owns its material instances, mixer and bone textures; geometry is shared until the pack and every actor are disposed.
- Mount/detach occur only through C's generic render host. B retains the animated clip-zero root translation (including authored crouch/guard offsets), and removes only subsequent displacement from visual skeleton playback. The offline evaluator uses the identical origin. C applies that sampled displacement once to the physical anchor, not the static rest translation. Visual skeletal spin is retained. B never sets the physical anchor or calls a renderer.
- Attack time is `(gameTimeMs - attack.startedAt) / 1000`, clamped once; speed15 clips use rate 1, not 1.5. Locomotion uses C's committed state and A's game clock.
- Defeated actors require A's durable `defeatPresentation`. B maps the chosen category to `DefeatPunch`/`DefeatKick`, seeks using the shared presentation clock, and holds the last pose. Missing records or clips fail explicitly. Enemy 1500ms slow yields 375ms clip time, followed by 125ms at normal speed; white 2000ms slow reaches 500ms. No independent wall clock.

## Deterministic geometry and source evidence

`bakeMotion` takes explicit strike annotations, root ownership and exact source sample times. It adds regular keys without rounding away fractional glTF accessor times. It measures horizontal root + limb + radius reach over active intervals. `createSourceEvaluator` evaluates actual glTF hierarchy/bones offline, in ascending time order for yaw unwrapping. Sphere joint origins/radii, strike windows and Euler yaw extraction still require visual validation for each technique, particularly tumbling/rotating motions. Do not treat the real Jab CPU test as all-attack acceptance.

`inspectGlb` validates binary bounds, animation input/output accessors, clip uniqueness, hierarchy/bind signatures including non-joint ancestors, skin weights, joint/vertex/index bounds and finite rest transforms. `tools/assets/inventory.mts` emits a new source lock without overwriting an existing output. The lock covers original42 and retimed42, 9 movement + 1 jump + 13 punch + 19 kick, runtime rate 1. AcrobaticCombo remains in the source inventory.

`authorDeathClips` emits two distinct 0.5s articulated candidates, with no edits to original clips, meshes, skeleton or palettes. Prepare a detached white source actor, seek `Idle` at zero, then pass its node. Authoring clones the seed and samples the complete skinned mesh at 240Hz to create a defeated-only pelvis track with canonical local-ground clearance. It never adds a gameplay root-position track. This is an offline operation, not a per-frame or per-defeat operation.

The Three driver captures the actual preceding displayed pose. Fixed entry-relative joint offsets decay over the first 0.1 clip seconds while the articulated canonical reaction starts immediately. It never repeatedly selects a shortest quaternion path to a moving target. The pelvis uses an entry-specific fixed swing/twist path to the terminal orientation over the full fall, composed with the canonical deviation from its own start-to-terminal path. A continuously lowered waypoint avoids an upward swing between opposing sideways body axes. This preserves canonical-start orientation without an upright/airborne classification threshold. Actor-local rotation is converted back through the current pelvis parent; no C node transform is written.

The driver restores the unblended mixer pose before repeat/backward seeks, preventing unchanged-key caching from accumulating presentation edits. Complete skinned-surface support is measured during entry-aware death playback because inverted head/torso surfaces can be lowest. Correction changes only the defeated pelvis in actor-local coordinates under C's translated/rotated parent. It never reads or compensates for world ground height. Any inherited below-zero local source surface clears continuously over the first 0.1 clip seconds rather than snapping at entry. Actual world contact still depends on C applying source root displacement once and settling its airborne presentation child; local floor tests are not proof of world collision. C alone owns that descent and immutable physical placement. Full-surface runtime evaluation has a device-performance cost that remains to be measured.

Numerical tests sample canonical geometry at 480Hz, entry rotations at 960Hz, and the independently found FrontKick wrist seam on fresh actors separated by 20ns. Reachable CartwheelKick, ChineseCartwheelKick, ButterflyKick and DivingLunge entries must not reset upright; tests also cover full-surface continuity, exact entry, canonical Idle orientation, terminal pose, repeat/backward seeks and translated-parent invariance. These samples do not prove every continuous-time surface or every possible entry. Articulated pose quality, actual-scene contact and device cost remain independent review gates. Apply the candidate clips explicitly to `createThreeAssetPack`; this is not an accepted production asset delivery.

## Not yet accepted

- No complete, visually confirmed 32-attack window/shape/root-ownership dataset has been emitted. Game move eligibility remains A-owned, including the proposed AcrobaticCombo exclusion.
- No public asset pack or fullgame wiring is shipped here. The public directory is intentionally untouched. Private Drive GLBs remain outside the repository; only exact material values and source hashes are present.
- No real WebGL/shared-depth rendering, one-on-one integration, full four-opponent game, screenshots/video, mobile browser performance or iPhone/iPad acceptance has been performed.
- Model resources, synthetic public-contract correctness, actual CPU source playback, visual acceptance, integration and device acceptance are separate gates.

### Artifact-delivery correction (2026-10-23)

The earlier statement that the public directory is untouched describes the
original module checkpoint and is retained above as history. It is superseded
for the current repository: these two checked-in public payloads are present and
match their built-in trust pins:
- `public/game-assets/android/derived-pack-v1.glb`: 8,349,400 bytes; SHA-256
  `78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b`,
  pinned by `ANDROID_DERIVED_PACK_V1` in `derivedPackManifest.ts`.
- `public/game-assets/android/runtime-artifact-v1.json`: 1,351,601 bytes; SHA-256
  `04dd9e6ee5dd9600eb93a4083a18e721634e4b136afe3b1b02d7835e6caf5c22`,
  pinned by `ANDROID_RUNTIME_ARTIFACT_V1` in `runtimeArtifactManifest.ts`.

`../app/androidVisualAssets.ts` already provides `androidAssetUrls`, resolving
the fixed manifest paths beneath an explicit application base, and
`prepareAndroidVisualAssets`, consuming the two pinned payloads. No new
base-aware resolver is needed. See `RUNTIME_ARTIFACTS.md` for artifact scope.
This is repository availability, not a public-deployment or playable-game claim.
`../main.ts` still supplies no accepted game configuration; complete gameplay
catalog acceptance and browser/device readiness remain unproven.

### Source-stamped driver preparation (checkpoint 1)

Prepared packs with all four locomotion sources expose immutable `poseBindings`.
Each opaque clip identity binds the original source SHA/clip index, exact visual
length, explicit extraction receipt (or clearly identified legacy full extraction),
and canonical sampling version. The pinned lossless factory retains original
source identity; this is not attack metadata or anatomy acceptance. The catalog's
optional `poseBindings` callback is read only during `prepare`, after the existing
load resolves. Missing or mismatched attack coverage fails without publishing the
descriptor. Legacy catalogs have no descriptor.

`ActorRig.seekPose(binding, clipTime)` uses milliseconds and restores canonical
source TRS through supported mixer stop/activation before absolute sampling.
`seekDefeat(StampedDefeatSeek)` validates its complete resolved source identity
before changing pose, reconstructs the left-side living entry once, and retains
it through repeated/reverse death and earlier living replay. Conflicting identity
is rejected. The source first-key hold and exact endpoint remain unchanged. The
caller resolves the shared side-aware stamp; this driver does not choose modes or
invent a left sample at an activation's own epoch. Public legacy `seek` remains
seconds and cannot be mixed back into a rig after a stamped operation.

The full actor-local support observation still belongs to B; C alone controls the
physical/facing/presentation parent and world settlement. No source bytes, death
tracks, original root displacement, hit geometry or gameplay clocks change here.
At checkpoint 1, the animator did not yet advertise or activate the new pose
protocol. That historical limitation is superseded for explicit
`deterministic-pose-v1` by the opt-in consumer below. Default legacy behavior and
the production-readiness gate remain unchanged. Staged actual rigs, not a
descriptor or an extra probe rig, establish method capability before qualified
application readiness.

## Opt-in stamped display consumer

`createActorAnimator` captures the shared run policy once. The default/explicit
legacy path is unchanged. For `deterministic-pose-v1`, construction captures the
prepared immutable `poseBindings`, validates all visual durations, the explicit
locomotion mapping and both 500 ms deaths, and advertises `poseProtocol` version1.
Construction is allocation-free: it never creates a capability-probe rig. A still
validates its actual staged required rigs before readiness. A `ThreeAssetPack`
adapter must explicitly supply `poseBindings.locomotion` as `locomotionClips`.

Qualified display selects exclusively from `SpatialActor.pose`. Living times use
the shared right-side helper; defeated entry uses the immutable left-side source
stamp and original Core defeat identity. It never consults a render-local epoch,
reselects Core attacks, or performs a public living seek before `seekDefeat`.
Canonical first-defeated mounts are allowed only on this qualified path. The
legacy unavailable-entry guard remains. Full sampled stamp/provenance conflicts
are rejected even when altered epochs happen to yield the same local clip time.

The complete resident frame is preflighted before seeking, retirement, mounting
or advancing the residency frontier. After pure data/descriptor validation
succeeds, retired actors are detached and
disposed before replacement creation. Actual method/getter validation is part of
the subsequent required acquisition: failure releases that acquisition and fails
closed, without rolling back or resurrecting an already retired actor. Surviving
actors are not sought until all required acquisitions/methods/mounts succeed.
Invalid input data still has zero retirement/acquisition/seek side effects. There
is no hidden third-rig allocation overlap or future/nonresident actor update.
A mount callback that disposes the run is
allowed to return its detach handle before the pending rig is released, retaining
detach-before-dispose ordering. Reentrant render is rejected; reentrant disposal
cannot recreate entries or continue to subsequent actors. Failed arbitrary engine
calls, a malformed disposer, OOM, or a host attaching then throwing without a
detach handle are not represented as a general rollback guarantee.

Actual rig methods are bound/captured once, not discovered by mutable getters on
every frame. After each qualified death seek, the same-frame stable-entry/full-XYZ
support observation is published with the committed identity. C alone owns the
physical anchor and presentation child. Retirement removes entry provenance and
resources, preserves only the existing run-local identity tombstone, and cannot
be undone by historical frames. Same-lifetime replay remains supported.

These declarations qualify deterministic display timing only. They do not certify
anatomical hurt geometry, continuous collision, a complete production catalog,
world/art/browser acceptance, or phone frame-time performance. Actual C/Core
composition and deployment readiness remain separately gated.

### Opt-in in-place XYZ posture (diagnostic policy)

`ClipRootPolicy.mode: 'in-place-posture-xyz'` retains the native authored root
translation in all three axes and extracts exactly zero XYZ transport. It does
not change source yaw, C facing, physical anchors or jump/gravity ownership.
The receipt remains source/manifest/support-bound; its pose binding differs from
both legacy full extraction and `grounded-posture-y`. Those existing modes and
all previously frozen fixtures keep their original behavior.

Compatibility requires zero XYZ root-curve keys and `spatial-jump` vertical
ownership. Raw source root displacement remains separate provenance, not actor
travel. This is an opt-in diagnostic decomposition, not a production catalog,
continuous support or gameplay-contact acceptance.

**Integration gate:** the independently owned numeric head point/interval
providers must explicitly support this mode or reject it before their old binary
root branches. This asset checkpoint must not be promoted with an old provider
that interprets the new mode as full extraction or grounded-Y. Numeric provider
qualification and actual C world/contact qualification remain separate gates.

### Isolated opt-in C recovery consumer candidate (Stage 2)

This candidate is not enabled by the application. `PoseRunPolicy.recovery` must
explicitly negotiate `kungfu-recovery-epoch-diagnostic-v1` separately from the
legacy deterministic-pose-v1 descriptor. The only admitted transition is the
C-owned natural KungFuStraight → Idle epoch, diagnostic 150 ms, fixed +1 lift.
Default canonical/death display, timing, input, contact capsule and physical root
remain unchanged. This does not fix the separate attack-start stance seam.

B prepares every actor before mounting, retiring, emitting or writing visible
TRS. A preparation evaluates an ephemeral private Object3D/Bone hierarchy and
AnimationMixer. It creates no Mesh, SkinnedMesh, geometry, material or texture
clone. The private hierarchy is disposed in `finally`, including failures; only
an immutable local-pose/support receipt remains until the frame applies or is
abandoned. CPU-only `stageActor` handles do not allocate a full display rig.
After every actor has prepared successfully, old residents retire before new
full rigs materialize; the initial two-resident budget remains peak two. Failed
preparation disposes staged CPU handles without retiring existing actors. A
materialization failure releases its CPU handle but does not undo prior valid
retirement. The prepared driver transfers exactly once into the display rig.
WeakMap receipts cannot be forged or resurrected after disposal. Every prepare
attempt invalidates earlier receipts, including failed attempts; successful
receipts are one-use. Generations are independent of snapshot revision, so a
fresh historical frame remains replayable during the same resident lifetime.
Callbacks after preparation fail closed; this is not rollback of arbitrary
host callbacks, material failures, or externally mutated visible hierarchies.

Support measurement reuses the existing certified-hull plan and unchanged arithmetic in
`skinBounds.ts`. Default SkinnedMesh measurement keeps its original direct matrix
path with no new matrix snapshots; only opt-in private preparation snapshots bindings. One immutable numeric support plan is owned by each pack and
shared with its owned actors. It is released only after pack disposal and the
last actor disposal. Numeric payload accounting excludes JS object/Map overhead:
- a temporary transform graph has N nodes, each with 42 numeric TRS/local/world
  slots, estimated 336 N bytes, plus the mixer/interpolant overhead;
- shared support numeric payload is 8 times the number of stored position,
  joint, weight, hull joint/weight and hull point components;
- each retained frame pose contains 10 numeric TRS components per sampled node,
  estimated 80 N bytes, plus IDs, topology, support, containers and engine overhead.
  Private preparation is sequential, so one private graph is live at a time, not
  one hidden actor per resident. Per-frame receipts scale only with C's bounded
  resident set. No production numeric-H resource, original source fetch, or extra
  asset download is introduced.

Composite defeat entry samples the same C epoch at its strict left side and then
uses the unchanged death/settlement implementation. Optional offline numeric H
accepts that same epoch/entry. Recovery intervals are explicitly unresolved and
split from canonical spans; post-defeat numeric queries are unsupported. These
APIs are not used by current live combat and do not certify continuous intervals.
Real-source parity, aggregate tests and any activation remain separate release
gates. Local source test flags remain gated; publication must resolve pending
policy without weakening CI or restoring obsolete source gates.
