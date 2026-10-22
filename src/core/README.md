# P1 Core authority

`createCore` is the pure production-rules implementation of the frozen `CorePort`.
It is separate from the P0 foundation. It owns HP, action permissions, heat,
activation/impact/event identities, clash resolution, encounters, score and the
world durability ledger. Adapters submit candidates, not damage decisions.

## Composition boundary

Provide a prepared public `MotionCatalogPort` view and fixed character move sets.
Catalog validation occurs at the internal `AssetsReady` transition, so an async
asset pack may prepare after construction. The normal actors require four punches
and four kicks; black requires all 19 kicks and no punches. Provide `WorldSeed`
with stable C layout IDs and initial durability. The default empty world is useful
for pure tests and has finite zero destruction rates; it is not the Paris layout.

To enable opponents, create `createEnemyAi` with the same C-backed movement session
service used by player input, inject its `decide` function as `enemyAi`, and dispose
it with the run. AI movement projects world direction onto the held C basis:
positive x is screen-right and positive z is screen-up/away from the camera.
Core then validates AI commands exactly as player commands. The pure fixture suite
intentionally disables AI where testing controlled combat outcomes.

Real B/C/D wiring, rendering, actual source assets and device verification are
separate integration work. This module does not claim those checks are complete.

## Explicit prototype policies

- Grounded-only attacks are the default, configurable with `groundedAttacksOnly`.
  Input is not buffered. Within one ordered transport batch the first accepted
  attack wins over jump; rejected input does not spend heat or draw a move.
- AI approaches at a provisional 1.8 m threshold, alternates kick/punch intents for
  normal actors and uses kicks for black. Core randomly selects within the fixed
  category set using the seeded RNG.
- Damage is `180 / (1 + rangeM)`; combo shares conserve the total.
- Earlier valid contact wins. Exact-time ties resolve clashes first, then body,
  then car/world, with stable authoritative IDs before candidate IDs. One impact
  has one consumption. Different combo impacts remain independent.
- Car launch costs 20 of 100 configured example HP. Vehicle-to-object loss is 20;
  speed is not treated as a damage formula. Vehicle hits on the current enemy are
  50 once per launch/target. Vehicle-caused defeat chooses the kick death category.
- Death slow playback is 0.25, enemy slow lasts 1500 ms, white slow 2000 ms, and
  fade lasts a provisional 400 ms. These are explicit tuning defaults, not claims
  that every proposed number was a final user requirement.

## Clock mapping

`present` accepts active real and presentation elapsed time independently of fixed
simulation ticks, preserving P0 pause/backlog semantics. Core retains a processed
real cursor. Each fixed step maps its simulation interval onto the corresponding
accepted-real interval; attack ends and contacts use that mapping, never the end
of the latest render frame. Heat snapshots may project the current accepted-real
time without committing that projection into the authoritative simulation anchor.
Thus backlog cannot charge cooling twice or move lock deadlines to frame ends.

The 1500 ms encounter gate is processed against that cursor even if presentation
has already caught up. Overlap with the slow interval scales subsequent simulation
steps. The collision-producing fixed tick is not retroactively re-simulated after
it discovers a lethal contact. Pause accepts neither presentation nor active-real
time. Terminal HP/score/game time remain frozen while presentation completes.

## Reproduction

`recordCore` captures immutable public calls and outputs; `replayCore` drives a
fresh instance with the same tape. Keep the run seed, motion metadata/fingerprint,
fixed move sets and world seed alongside it. When AI is enabled, wrap its provider
with `recordIntentProvider` and replay the resulting public command batches using
`replayIntentProvider`: camera-basis/session acquisition is an external input, not
a reproducible hidden source. No private adapter state is required.
Synthetic public fixtures test rules independently of B/C/D implementation details.
