# Native-XYZ sweep diagnostics, not damage geometry

These two source-pinned fixtures are unaccepted diagnostic/broadphase proposals.
All anatomy, continuous-containment, gameplay-allowance and acceptance fields
remain null. They are not a production catalog or readiness signal. LowSweep
is deliberately absent.

## Source identity and clocks

- RoundhouseKick: kick manifest clip 2, original right shin/instep event,
  authored frames 30–35, peak 31. The source describes a horizontal inward arc.
- SideThrustKick: kick manifest clip 9, original right heel/sole thrust,
  authored frames 34–39, peak 36. Its source direction is lateral, not an
  instruction to rotate the actor toward a target.
- Both use the immutable already-retimed speed-1.5 source at runtime speed 1.
  Exact Float32 accessor times and first-key hold remain authoritative.
- Inclusive source cells are converted by explicit developer policy to half-open
  runtime windows [F30,F36) and [F34,F40). This is not new source annotation.

The built-in source/manifest/recipe/candidate pins are in the test-only
`tools/assets/groundedSweepDiagnostic.ts` boundary. The recipe preserves the
original fixed recipe-plan UTF-8 bytes as strings because parsing and reprinting
JSON can change numeric spellings without changing values. Both original plan
hashes must verify before the offline baker touches source geometry.

## Source regions and one deterministic fit

Roundhouse keeps separately tagged anterior-shin and instep hypotheses. Shin cuts
use the original inverse-bind shin frame, including inverse-transpose normal
transformation. Instep cuts use the original mesh-bind frame. SideThrust keeps
separate heel and sole hypotheses. All cuts use original skin influences and
interpolated original vertex-normal fields, not accepted face/contact normals.

Original primitive, triangle, vertex IDs and barycentric clipped boundaries are
retained. Roundhouse has 416 polygons (213 full and 203 clipped), without overlap.
SideThrust has 152 polygons (108 full and 44 clipped); eight original faces belong
to both heel and sole, so polygon counts are not disjoint face counts.

Roundhouse's single capsule has a declared original mesh-bind +Y axis. A proper
rotation P(x,y,z)=(x,-z,y) lets the unchanged +Z fitter operate, followed by the
inverse on both endpoints. Radius is unchanged. SideThrust uses +Z directly.
The complete posed clipped surface is evaluated relative to the reference bone:
shin for Roundhouse, foot for SideThrust. The instep is not falsely rigid-bound
to the shin. No PCA, target data, iterative refit or gameplay allowance is used.
The separate 1e-7 m CPU arithmetic guard is not interpolation padding.

## Retained limitations and RED evidence

The unchanged initial capsule radii are 128.218 mm and 82.053 mm. Finite quarter-key
probes retain:
- Roundhouse: maximum sampled surface residual -0.000208 mm. This finite margin
  is not a continuous enclosure certificate.
- SideThrust: positive surface escape 0.055852 mm. The raw capsule does not even
  contain every tested intermediate source pose.

Finite selected-region directional excess reaches 93.911 mm for Roundhouse and
72.007 mm for SideThrust. These are not approved visible-reach tolerances or
actual target clearances. No numerical enclosure padding is applied to these
bytes. Source patch refinement and actual event-time contact attribution remain
separate gates; proxy hits cannot be represented as exact source-triangle hits.

## Native posture and finite source qualification

Both clips explicitly use `in-place-posture-xyz`: native source XYZ remains in
visual and strike geometry, and extracted transport XYZ is exactly zero. This
is distinct from existing full-root removal and grounded-Y policies. Matching
policy provenance is required across bake, public rig and numeric head provider.
Raw root curves are retained alongside zero-transport curves.

The source proof checks 278 poses and 12,838,318 complete original/public-rig
vertices under matched translated/rotated parents, plus 1,243,216 numeric-provider
head vertices. Maximum errors are below 4.66e-15 m and 8.90e-16 m respectively,
against the unchanged 1e-10 m source-equivalence criterion. Parent transforms
are not mutated. The serialized capsule residuals are independently reproduced.

Finite clipped left-sole minima retain authored deviations: -0.416581 mm for
Roundhouse and -0.096960 mm for SideThrust. Support annotations include loading,
pivot and recovery phases; these measurements do not assert a stationary whole
sole, universal foot planting or C gravity qualification.

Depth-tested region interpretation, continuous enclosure and actual C-facing
contact tests are separate review gates. No source animation, original geometry,
shared helper or previous diagnostic fixture is changed by this batch.
