# Public-factory composition checkpoint

`createIntegratedGame` composes the public Core, motion catalog/animator, scene,
and interface factories. `mountApplication` adds an owned positioned surface,
CSS-pixel viewport/safe-area measurements, browser lifecycle and frame scheduling.
It does not remove caller-owned DOM. The interface host lives for the application;
simulation, renderer, rigs, input and loaded assets are isolated per run.

## Required real-source input

`AcceptedGameConfiguration` is an input name, **not an acceptance certificate**.
It requires A-owned fixed move sets, explicit initial world durability, optional
scene layout, and an abort-aware per-run `loadAssets(context, signal)` function.
Moves are deeply copied/frozen once per run and shared by Core and asynchronous
visual validation. Caller edits during loading cannot change that run’s requirements;
caller-owned objects themselves are not frozen or modified.
Layout and durability IDs must be unique and match exactly. The loader returns:
- `motions: readonly MotionAsset[]`, with B-reviewed source metadata, geometry,
  active windows and root/ownership curves;
- `animator: AnimatorAssets<Object3D> & { dispose(): void }`, with B's validated
  actor rigs and locomotion/death clips. Death clips must last exactly 500 ms.

The disposal wrapper must release the asset pack after animator-owned actor rigs
have been detached/disposed; retain method binding if the wrapper uses `this`.
Late cancelled loads are disposed and cannot publish readiness. Catalog readiness
is still validated by the public controller; callers cannot mark it ready. Before
that boundary, composition requires all four locomotion clips, both 500 ms death
clips, and every configured attack visual with exactly matching catalog duration.
Rejected packs are released and a retry loads a fresh pack. These structural checks
do not certify source-grounded geometry, timing annotations or visual artwork.

The production entry deliberately supplies **no configuration** because accepted
complete real-source motion/visual data is not yet available. It shows the shell
and an explicit unavailable notice; attempting preparation fails closed. Test
fixtures are never imported into production. A build is not a playable-game claim.

## Authority and presentation

Core alone controls HP, heat, progression, score, contacts and world durability.
AI and touch input use the same C-backed movement-basis/session service. Core
retains held direction through attacks; C suppresses free movement while applying
authored root motion. Pause/release/encounter changes still clear held input.

The existing frame loop publishes one immutable committed frame, renders B then C,
and supplies D with C projections from original confirmed world hit coordinates.
D chooses retained defeat HUD participants from Core's presentation record and
clock, never from a second timer or by restoring combat targeting. C owns a
defeated-only presentation child beneath the unchanged physical anchor. It settles
airborne clearance on B's shared clip clock and frames that visual position, while
historical hit points remain their original world coordinates. This accepted
structural handoff does not certify B's local death artwork.

## Evidence limits

Integration tests use actual public factories with synthetic B metadata/rigs,
a renderer test double and jsdom. They cover readiness, cancellation, cleanup,
real C contact-to-Core-to-HUD flow, held movement/root ownership, defeat HUD
retention/expiry and pause. They do not establish WebGL rendering, source-art
quality, Safari/device input, accessibility layout or mobile performance.
