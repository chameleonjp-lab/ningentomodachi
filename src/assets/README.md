# B asset/animation module: P1 review candidate

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

`authorDeathClips` creates two distinct half-second skeletal candidates from the supplied source guard pose. They preserve the rig and design and are CPU tested across all source colors. They are not final visual-quality approval, authored GLB delivery or completed collapse/fire/spark acceptance. Apply extra clips explicitly to `createThreeAssetPack`.

## Not yet accepted

- No complete, visually confirmed 32-attack window/shape/root-ownership dataset has been emitted. Game move eligibility remains A-owned, including the proposed AcrobaticCombo exclusion.
- No public asset pack or fullgame wiring is shipped here. The public directory is intentionally untouched. Private Drive GLBs remain outside the repository; only exact material values and source hashes are present.
- No real WebGL/shared-depth rendering, one-on-one integration, full four-opponent game, screenshots/video, mobile browser performance or iPhone/iPad acceptance has been performed.
- Model resources, synthetic public-contract correctness, actual CPU source playback, visual acceptance, integration and device acceptance are separate gates.
