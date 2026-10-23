# KungFuHandCombo5: unaccepted source diagnostic

This is one real source motion with five impacts, not production catalog admission.
All anatomy, continuous containment, gameplay and root-policy acceptance remain null.
The original source, shared clock helpers, validators, Core and application are unchanged.

## Pinned source and native clock

- android_punch.glb: 5,584,752 bytes, SHA256 c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d.
- manifest.json: 46,217 bytes, SHA256 dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0.
- Manifest /clips/12 has frames 1–145, FPS 45, already retimed with runtime speed one.
- GLB /animations/12 uses accessor 3563 for 145 native float32 times and accessor 3566 for the same two endpoints.
- Native time bytes SHA256: 24f4d10b919cf2cf3b0f62ea8b50e800259a7cb41e82c0c0f052328c381e5f31.
- Native positive initial hold: 0.02222222276031971 s. Full duration: 3.222222328186035 s.

The unchanged generic uniform-clock helper rejects native F127 and F143. F127 is
2.8222219944000244 s (bytes 49 9f 34 40), residual 2.2836029511807965e-7 s from
first-key plus index/45; F143 is 3.1777780055999756 s (b7 60 4b 40), residual
2.2728410042915925e-7 s. The shared 2e-7 s gate was not widened.

The private clip-specific mapping instead requires the exact source, manifest and
native time-byte pins, then maps frame F to native accessor index F−1. Generated
inclusive end uses the following native accessor. Relative author annotations
remain separate; source times are never rounded to pass validation. Pure controls
retain the generic rejection and reject altered, missing or reordered native keys.

## Five event-specific hypotheses

Source impacts are F22 right closed fist, F43 left palm heel, F66 right dorsal
closed fist, F87 right elbow and F108 left follow-up palm. These are impact
instants, NOT source-authored active-window widths. Developer-generated provisional
inclusive windows are F21–23, F42–44, F65–67, F86–88 and F107–109.

Existing source-only predicates are reused without modifications:
- Event 0: distal hand plus proximal-finger/restored-rim hypothesis.
- Events 1 and 4: left palmar-heel hypothesis.
- Event 2: dorsal hand plus proximal-finger/restored-rim hypothesis.
- Event 3: posterior elbow-band hypothesis in forearm.R inverse-bind space, retaining upper-arm/forearm influence union.

One source-reference AABB-midpoint sphere per event uses maximum finite corner
distance plus the existing 1e-7 m CPU guard. No target-dependent fit, refit,
whole-limb fallback, geometry broadening or interpolation allowance was added.

Grounded-posture-y remains a candidate policy: extract original XZ once and retain
native pelvis Y and source yaw. Preserve low broad guard, final advanced guard,
+Z 0.1600000262260437 m advance and near-zero net yaw. No origin snap or foot lock.

## Frozen bake and initial candidate

Recipe wrapper SHA256: 11611ef2840df7d26dc1f77942aef95a645ef7dd4de83fb79dcb2ec465c8faca.
Candidate SHA256: 5200f8a078d30d3f9f62a6c5c4a25c7e8c5f53a02e0a1d81de79d8811804bb67.
Candidate size: 2,602,750 bytes, copied byte-identically after exclusive generation.

Exactly one generation used one source pack and 251 precharged mixer updates at
251 unique native/finite-probe times. All exact local transforms were cached;
restoration did not synthesize source poses. The 191 bake keys comprise zero,
145 native accessor keys and 45 active-cell quarters; 60 odd-eighth measurements
are disjoint finite probes. The existing bakeMotion base lattice is explicitly
1 Hz and adds no keys because 1/2/3 s already occur in the native accessors.
This irregular accessor/active-cell bake is NOT claimed to be 240 Hz sampling.

Polygon counts per event: 470, 201, 425, 455, 201. Each event has 25 finite probes.
Signed maximum finite surface escapes, in millimetres:
- Event 0: −0.000124797.
- Event 1: +0.009142533.
- Event 2: +0.030251785.
- Event 3: +0.002294854.
- Event 4: +0.003212307.

The four positive interpolation escapes are preserved. Negative finite samples
are not continuous containment certificates. No regeneration or refit occurred.

## Independent finite parity and lifecycle evidence

One separately released parity test passed at 294 finite poses:
- 13,577,214 whole-source vertices, maximum source/runtime error 6.616780201862999e-15 m.
- 1,314,768 head vertices, maximum numeric-head error 6.68775835685978e-16 m.
- Extracted root transport restored once: maximum error 0 m.
- All five signed finite measurements independently reproduced, including the four positive escapes.

Observed calls were 300 original-source mixer updates, 882 public runtime seeks
and 294 numeric-head queries. Static reservations were 1,764 internal runtime
mixer updates and 42 head-provider initialization samples. These reservations
are accounting against unchanged helpers, not observed internal instrumentation.
Hard pre-call ceilings remain 301 / 885 / 1770 / 295 plus 42 initialization.

Observed whole-source floor range was −0.366738215 mm to −0.000027465 mm.
Left support subtree bottom reached 39.999594 mm, with maximum XZ displacement
143.199974 mm; right subtree maximum XZ displacement was 0.270108 mm.
These original source observations were retained, not corrected or certified as
foot locking or gameplay support acceptance.

Each successfully acquired resource immediately registers cleanup. Exact primary
failures, including primitive/undefined values, survive cleanup failures; the
caller-owned lifecycle receipt records secondary errors. All disposers drain,
with mixer stop and uncache protected separately. Cleanup-only failures reject
otherwise successful work. Pure controls cover these cases and budget overflow.

Validation history: initial four pure tests exposed two native-clock REDs; the
private exact-clock correction passed four tests; lifecycle/counter controls
passed seven; pinned candidate plus those controls passed all eight. Typecheck
passed. One candidate generation and one parity run passed with normal cleanup.
No full-suite, continuous containment, visual anatomy, production, C recovery,
obstacle, locomotion transition or next-jump qualification is claimed here.
