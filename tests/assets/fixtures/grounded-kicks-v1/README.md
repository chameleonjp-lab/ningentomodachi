# Grounded kicks: source-pinned diagnostic only

These fixtures do **not** authorize HP contacts or production catalog readiness.
All acceptance fields remain null. The capsules are one deterministic
source-only broadphase proposal per clip, not accepted exact-contact geometry.

## Exact identities and clocks

- `FrontThrustKick` is original kick manifest clip 8, left heel/sole, frames
  31–36, peak 33. It is **not** the separately qualified `FrontKick`.
- `SideKick` is original kick manifest clip 1, right heel/sole, frames 24–27,
  peak 26. Its source direction is lateral. A miss under actual target-facing
  gameplay is a result, not permission to rotate the actor or expand a window.
- Both use the original already-retimed speed-1.5 kick GLB at runtime speed 1.
  Exact binary accessor times, including the first-key hold, are authoritative.
- Converting inclusive source frame cells to half-open runtime intervals is an
  explicit developer policy: first annotated key through the key after the
  inclusive last frame. The original source annotation is not rewritten.

Source/manifest/recipe/candidate SHA-256 pins are built into the test-only adapter
in `tools/assets/groundedKickDiagnostic.ts`; caller-supplied trust pins are not
accepted. Original GLBs and manifests are unchanged.

## Source contact region, not a desired hit

The recipe records source-only heel and sole cuts, using original positions,
skin weights and interpolated source vertex-normal fields. These cuts are
anatomical proposals, not a claim that smooth vertex normals are face normals
or that every selected point is the leading visible contact.

Every polygon retains primitive, original triangle and vertex indices, and
barycentric boundary coefficients. Clipping includes partially crossing faces,
not just triangles whose three vertices pass. Heel/sole overlap is recorded
explicitly: eight original faces per clip occur in both regions.

FrontThrustKick has 107 full and 48 clipped region polygons; SideKick has 108
full and 44 clipped polygons. These counts are not disjoint triangle counts.
Coefficients apply to original **posed** vertices, preserving mixed skinning
along clipped boundaries. Visual region/topology review remains a gate.

## One frozen fit and retained failures

The capsule axis is fixed to source-bind +Z before any target test. Its transverse
center is the source-point bounding-box midpoint; radius and shortest feasible
axis segment are determined once from the active source points. The separate
1e-7 m arithmetic guard is added only after endpoint fitting. No PCA, iterative
target fitting, or Uppercut gameplay allowance is used.

The initial capsule radius is about 82.053 mm for each foot. Quarter-key replay
finds genuine surface escapes from the serialized piecewise-linear capsule:
- FrontThrustKick: 0.115750681 mm at 706.25 ms.
- SideKick: 0.191960953 mm at 572.916666667 ms.

These RED observations are retained and independently checked against the public
catalog. A finite maximum is not a continuous bound. The existing additional
interpolation-enclosure target of 0.25 mm is **not applied to these bytes**;
finite-grid evidence alone cannot certify it, and the arithmetic guard cannot
be relabelled as that enclosure.

Finite directional support excess is also substantial: FrontThrustKick reaches
53.545 mm upward and 61.748 mm downward; SideKick reaches 40.859 mm upward and
72.007 mm downward. Front forward +Z excess is 15.532 mm; Side lateral +X/-X
excess is 23.847/21.997 mm. These are selected-region support measurements, not
actual target clearances or approved gameplay tolerances. Intended source-patch
refinement is a separate gate before proxy hits could authorize damage.

## Root and qualification boundary

Each clip carries explicit pinned `grounded-posture-y` policy provenance. Raw
source Y remains in the visual pose and strike geometry; extracted transport Y
is zero. Source support annotations motivate this proposal but do not prove its
whole-clip qualification alone. Raw curves are retained alongside transport.

The source geometry test compares untouched original GLTF vertices with the
public pinned pack under the same translated/rotated parent, restores extracted
transport exactly once, and records actual support-foot and full-body minima.
Across 238 source poses and 10,991,078 vertex comparisons, the maximum
matched-parent error is below 7e-15 m with the unchanged 1e-10 m threshold.
Original support minima reach approximately -0.0564 mm and -0.1592 mm for the
two clips; these authored deviations are retained, not corrected.

It does not claim C gravity/motor qualification, continuous containment, source
triangle collision, complete roster readiness, or browser/device performance.

The offline baker can regenerate the diagnostic bytes from pinned repository
sources. This data and its test-only loader are not exported from `src/assets`
and are not installed into a production catalog.
