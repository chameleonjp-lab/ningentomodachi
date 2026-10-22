# Pinned runtime preparation (bounded candidate)

`createPinnedThreeAssetPack({ sources, artifactBytes, rootPolicies?, signal, checkpoint? })`
returns the existing `ThreeAssetPack`. `ANDROID_RUNTIME_ARTIFACT_V1` supplies the
ordered original repository paths, byte lengths, SHA-256 pins, and local public
artifact URL. Supply the four original speed-1.5 GLBs in that order, at runtime
rate 1. Fetching, scheduling, initial loading UI, run cancellation, residency, and
optional prefetch remain A's responsibility. No future actor is instantiated by
preparing a pack.

The built-in manifest is the trust root, not a caller-selected digest. All source
and artifact hashes are verified before JSON decoding or GLTF parsing. Mutable
inputs and the cancellation identity are captured before the first await. The
factory never runs hull certification or death authoring and never consults or
populates the legacy qualification plan cache. There is no production fallback.
The returned pack preserves the existing root-policy and bounds-capability APIs.
A can require `defeatPoseSupport` on the already-required staged white rig before
readiness, without creating an extra capability-probe actor. A must still verify the accepted motion catalog, full configured
root-policy/provenance compatibility, and clip durations. This artifact does not
authorize provisional attack annotations or arbitrary caller policies.

The artifact stores original vertex indices grouped by the complete, unquantized
four-joint/four-weight tuple. Its offline certificate is identical to the accepted
exact-weight hull algorithm; import verifies all source tuples, index membership,
mesh coverage and counts but does not repeat that expensive certificate. The
serialized death tracks reproduce the existing canonical 500 ms clips, including
all Float32 bits and negative zero. Source geometry, palettes, 53 bones and all
42 original clips are unchanged. Bounds are CPU-skinning extrema for immutable
B-owned geometry, not a strict GPU floating-point enclosure or full-world visual
acceptance.

Cancellation is checked before/after actual task yields, asynchronous hashes,
source inspections/parses, and bounded track/vertex import chunks. The optional
checkpoint receives stage names; it cannot remove B's own task yield by returning
an already-resolved promise. A thrown scheduler error or cancellation releases
partially parsed resources and never returns the unfinished pack. Disposing a
pack prevents new actors, while existing actors retain shared geometry/tracks
until their final disposal. At the last reference, the pack releases its support
plan and animation/policy maps; it has no global production plan cache. A must
drop the obsolete bundle on retry.

Promise-based preparation is not itself proof of responsiveness. GLTF parsing,
source validation, JSON decoding and actor instantiation include synchronous work.
`tools/assets/measure-runtime-artifacts.mts` measures complete factory preparation,
observed event-loop timer spacing and separate white/black instantiation. Its
checkpoint spans include waits and are conservative operation bounds, not exact
synchronous CPU attribution. Browser/input/device qualification remains separate.

Offline generation uses the existing installed tools only:
- `tools/assets/build-runtime-artifacts.mts NEW_ARTIFACT_PATH NEW_MANIFEST_PATH`
- Both paths must be new; generation uses exclusive writes and preserves old
  candidates. It verifies the original source lock before generation.
- `tests/assets/runtimeArtifacts.test.ts` independently regenerates the complete
  artifact from repository sources and compares its exact bytes and SHA-256.
- Updating an artifact or trusted pin requires a new bounded review. Do not accept
  an arbitrary external artifact by computing and supplying its hash.

## Lossless derived representation (separate qualification)

`createPinnedDerivedThreeAssetPack` accepts `derivedBytes` instead of the four
`sources`; the other artifact, policy, cancellation and checkpoint inputs are
unchanged. Its distinct built-in manifest pins an 8,349,400-byte derived GLB and
the existing pose artifact. The original 22,167,156 bytes remain immutable. All
42 original clips, fractional samples, static geometry, materials, hierarchy,
skin bindings and component bits are conserved. This is storage deduplication,
not mesh simplification, retiming or new animation authoring.

`tools/assets/build-derived-pack.mts` creates only new output paths. Its offline
certificate rejects unsupported source features and requires exact static-scene
agreement across the four pinned sources. The runtime does not accept a caller's
certificate or chosen hash. Original per-clip source hashes and manifest policy
pointers remain authoritative; substituting the derived hash as an original
policy source is rejected. Existing grounded-policy and catalog acceptance gates
are unchanged. No additional attack window or vertical policy is authorized.

A quiet Node measurement reduced complete factory time from 643.028 to 373.514 ms,
but the largest observed timer gap worsened from 63.318 to 81.064 ms. Initial input
capture cost 3.996 ms; white/black clones cost 11.473/8.961 ms (20.437 ms contiguous).
This representation is therefore NOT responsiveness-accepted or production-ready.
Those numbers exclude fetch, module startup, renderer/GPU work and actual device
behavior. Async entry points and checkpoint spans do not prove nonblocking parse
or inspection. Further exact-preserving preparation slicing and browser input/frame
qualification remain separate work, not a fallback that skips validation.


## Yielding preparation (correctness qualification only)

The derived factory now drives the same strict source-validator generator through
bounded work checkpoints; `inspectGlb` still drains that generator synchronously.
Input snapshots, validation order/results and trusted pins are unchanged. The
installed GLTFLoader's public plugin hooks queue the original typed
`loadAnimation` calls without hiding JSON definitions, bypassing its dependency
cache, changing tracks or modifying parser methods. Static scenes and resolved
mesh roots are observed before ownership transfer. Rejection settles pending mesh
and queued-animation work before disposing their shared resources exactly once.

Every factory checkpoint performs an actual task yield and checks cancellation.
The optional callback may observe progress, but must settle cooperatively; a
never-settling caller promise cannot be made safely cancellable by this factory.
Native JSON decoding, static loading and one animation load are still atomic
boundaries. Timer clamping, garbage collection and browser/device behavior can
change total preparation time and blocking gaps. The slicing trades some total
cold time for smaller observed gaps; it does not guarantee a frame rate.

The public factory signature and returned `ThreeAssetPack` are unchanged.
`pack.create(color)` remains synchronous. A must stage only required residents,
yield/check cancellation between those creations, own each pending rig until its
single transfer, and dispose untransferred rigs on cancellation or retry. No
extra probe rig, future active actor or hidden animation update is introduced.
The old source-based factory is retained unchanged; it is not a responsiveness
fallback. Actual browser input/frame, first renderer draw and device qualification
remain required before a production-readiness claim.

For the final preparation candidate, one fresh Node24.19.0/Linux EPYC sample took
603.654 ms total with a16.170 ms maximum1 ms timer spacing; initial capture was
6.065 ms. Parser-start/first-inspection/static-scene checkpoint spans were
16.887/16.250/14.162 ms, including waits. White/black creation remained separate
7.749/5.694 ms synchronous operations (13.445 ms contiguous). An earlier
pre-queue-failure-guard sample took634.317 ms with an18.657 ms gap. Both remain
CPU-only observations, not a60 fps guarantee or a browser loading acceptance.
Timer clamping can increase browser total time. No fetch, module startup or first
renderer draw is included. The supported hook/delegation behavior is checked
against pinned Three0.186.1/@types0.186.0 and must be re-reviewed on upgrades.
