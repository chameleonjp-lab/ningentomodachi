/** Offline/test-only source boundary. It confers no gameplay or catalog acceptance. */
import { createHash } from 'node:crypto';
import {
  clipId,
  durationMs,
  validateMotionDefinition,
  type Vector3,
} from '../../src/contracts';
import { copyRootPolicy, inspectGlb, type MotionAsset } from '../../src/assets';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const GROUNDED_SWEEP_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export interface GroundedSweepSourceInput {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Source object required');
  return value as Record<string, unknown>;
}
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Source array required');
  return value;
}
function numeric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Finite source number required');
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export const groundedSweepHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const selections = [
  {
    name: 'RoundhouseKick',
    index: 2,
    side: 'R',
    supportSide: 'L',
    supportField: 'support',
    eventField: 'strikes',
    peakField: 'peak_frame',
    endFrame: 67,
    firstFrame: 30,
    lastFrame: 35,
    peakFrame: 31,
    supportFrames: [
      [1, 10],
      [11, 60],
      [61, 67],
    ],
    regions: ['anterior-shin-hypothesis', 'instep-hypothesis'],
    axis: 'Y',
    referenceJoint: 50,
    referenceNode: 49,
    referenceName: 'shinR',
    recipePlanSha256:
      '50429342684caacbed3ec3aa2a466c28f675a9f4ce4d1f7d244f7688eccdf932',
    sourceDirection:
      'source horizontal inward right shin/instep arc; no target-facing correction',
  },
  {
    name: 'SideThrustKick',
    index: 9,
    side: 'R',
    supportSide: 'L',
    supportField: 'support_contacts',
    eventField: 'attack_events',
    peakField: 'peak_frame',
    endFrame: 71,
    firstFrame: 34,
    lastFrame: 39,
    peakFrame: 36,
    supportFrames: [
      [1, 71],
      [1, 1],
      [71, 71],
    ],
    regions: ['heel-hypothesis', 'sole-hypothesis'],
    axis: 'Z',
    referenceJoint: 51,
    referenceNode: 48,
    referenceName: 'footR',
    recipePlanSha256:
      'e9b8ee23d60a7d16c61cfac52d47d867299214467d6cc0ac6213c30f234134f3',
    sourceDirection:
      'source lateral pushing thrust, Blender -X; no target-facing correction',
  },
] as const;

/** Pins belong to this diagnostic, never to a caller-supplied trust argument. */
export function readGroundedSweepSources(input: GroundedSweepSourceInput) {
  const pins = GROUNDED_SWEEP_SOURCE_PINS;
  if (
    groundedSweepHash(input.sourceBytes) !== pins.sourceSha256 ||
    groundedSweepHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Grounded sweep source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already-retimed runtime speed one required');
  const inspected = inspectGlb(input.sourceBytes);
  return freeze(
    selections.map((selection) => {
      const source = record(list(manifest.clips)[selection.index]);
      const range = list(source.source_frame_range);
      const events = list(
        record(source.attack_and_timeline_events)[selection.eventField],
      );
      const event = record(events[0]);
      const frames = list(event.active_frames);
      const supportRecords = list(
        record(source.support_contacts)[selection.supportField],
      );
      const supportFrames = supportRecords.map((v) => list(record(v).frames));
      if (
        source.clip !== selection.name ||
        source.primary_category !== 'kick' ||
        source.fps !== 45 ||
        range[0] !== 1 ||
        range[1] !== selection.endFrame ||
        events.length !== 1 ||
        frames.length !== 2 ||
        frames[0] !== selection.firstFrame ||
        frames[1] !== selection.lastFrame ||
        event[selection.peakField] !== selection.peakFrame ||
        JSON.stringify(supportFrames) !==
          JSON.stringify(selection.supportFrames)
      )
        throw new Error(
          'Unexpected source identity, interval or support record',
        );
      const binary = inspected.clips.find(
        (clip) => clip.name === selection.name,
      );
      if (!binary) throw new Error('Missing exact binary clip');
      const sourceClipPointer = `/clips/${selection.index}`;
      const window = inclusiveAccessorFrameWindow({
        sourceStartFrame: numeric(range[0]),
        sourceEndFrame: numeric(range[1]),
        fps: numeric(source.fps),
        firstFrame: numeric(frames[0]),
        lastFrame: numeric(frames[1]),
        peakFrame: numeric(event[selection.peakField]),
        accessorTimesSeconds: binary.sampleTimes,
        durationMs: binary.durationSeconds * 1000,
      });
      return {
        clipId: clipId(selection.name),
        durationMs: durationMs(binary.durationSeconds * 1000),
        side: selection.side,
        regions: [...selection.regions],
        axis: selection.axis,
        referenceJoint: selection.referenceJoint,
        referenceNode: selection.referenceNode,
        referenceName: selection.referenceName,
        recipePlanSha256: selection.recipePlanSha256,
        supportSide: selection.supportSide,
        sourceFrames: [selection.firstFrame, selection.lastFrame] as const,
        sourceClipPointer,
        sourceEventPointer: `${sourceClipPointer}/attack_and_timeline_events/${selection.eventField}/0`,
        sourceDirection: selection.sourceDirection,
        sourceEvent: event,
        sourceSupport: source.support_contacts,
        sourceRoot: source.root_motion,
        sourceTimesSeconds: [...binary.sampleTimes],
        window,
        rootPolicy: copyRootPolicy({
          version: 1,
          clipId: selection.name,
          sourceSha256: pins.sourceSha256,
          mode: 'in-place-posture-xyz',
          provenance: {
            manifestSha256: pins.manifestSha256,
            clipPointer: sourceClipPointer,
            supportPointer: `${sourceClipPointer}/support_contacts/${selection.supportField}`,
          },
        }),
        rootPolicyAcceptance: null,
        acceptance: null,
      };
    }),
  );
}

/** Frozen authoring-plan bytes must be supplied before any source geometry work. */
export function verifyGroundedSweepRecipePlans(
  plans: readonly Uint8Array[],
): void {
  if (
    plans.length !== selections.length ||
    plans.some(
      (bytes, i) =>
        groundedSweepHash(bytes) !== selections[i]?.recipePlanSha256,
    )
  )
    throw new Error('Fixed recipe plan hash mismatch');
}

export const GROUNDED_SWEEP_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    'e0b7d4d4881169c9c1e2cd97bfb7c4db58bd931b4387caed7bd210ced3dab40a',
  recipeSha256:
    'cfbf5c5df2fafd76d61c15f777c836346bb8d5a9e3abca22cc8904186ef88975',
});
export interface GroundedSweepDiagnosticInput extends GroundedSweepSourceInput {
  readonly candidateBytes: Uint8Array;
  readonly recipeBytes: Uint8Array;
}
function vector(value: unknown): Vector3 {
  const v = record(value);
  return { x: numeric(v.x), y: numeric(v.y), z: numeric(v.z) };
}
function sourceIndex(value: unknown): number {
  const n = numeric(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error('Source index required');
  return n;
}
function triple(value: unknown): readonly [number, number, number] {
  const a = list(value);
  if (a.length !== 3) throw new Error('Source triple required');
  return [numeric(a[0]), numeric(a[1]), numeric(a[2])];
}
/** Test-only, built-in trust pins. Deliberately returns unaccepted broadphase data,
 * never a production registry or readiness flag. */
export function loadGroundedSweepDiagnostics(
  input: GroundedSweepDiagnosticInput,
) {
  const pins = GROUNDED_SWEEP_DIAGNOSTIC_PINS;
  if (
    groundedSweepHash(input.candidateBytes) !== pins.candidateSha256 ||
    groundedSweepHash(input.recipeBytes) !== pins.recipeSha256
  )
    throw new Error('Grounded sweep diagnostic hash mismatch');
  const descriptors = readGroundedSweepSources(input);
  const candidate = record(
    JSON.parse(new TextDecoder().decode(input.candidateBytes)),
  );
  const recipe = record(
    JSON.parse(new TextDecoder().decode(input.recipeBytes)),
  );
  const results = list(candidate.results);
  if (
    results.length !== 2 ||
    recipe.acceptance !== null ||
    recipe.status !== 'diagnostic-broadphase-only' ||
    recipe.gameplayAllowance !== null
  )
    throw new Error('Diagnostic qualification state');
  return freeze(
    descriptors.map((descriptor, index) => {
      const entry = record(results[index]);
      if (
        entry.acceptance !== null ||
        entry.continuousContainment !== null ||
        entry.regionVisualAcceptance !== null ||
        entry.gameplayAllowance !== null ||
        JSON.stringify(entry.descriptor) !== JSON.stringify(descriptor)
      )
        throw new Error('Diagnostic source/acceptance binding');
      const serialized = record(entry.asset),
        definition = record(serialized.definition);
      const impactList = list(definition.impacts),
        impacts = impactList.map((value) => {
          const impact = record(value);
          if (typeof impact.shapeId !== 'string')
            throw new Error('Diagnostic shape ID');
          return {
            impactIndex: sourceIndex(impact.impactIndex),
            startMs: durationMs(numeric(impact.startMs)),
            endMs: durationMs(numeric(impact.endMs)),
            damageShare: numeric(impact.damageShare),
            shapeId: impact.shapeId,
          };
        });
      if (
        definition.clipId !== descriptor.clipId ||
        definition.category !== 'kick' ||
        definition.durationMs !== descriptor.durationMs ||
        impacts.length !== 1 ||
        impacts[0]?.startMs !== descriptor.window.startMs ||
        impacts[0]?.endMs !== descriptor.window.endMs
      )
        throw new Error('Diagnostic clock/category mismatch');
      const rootCurve = list(definition.rootCurve).map((value) => {
        const key = record(value);
        return {
          atMs: durationMs(numeric(key.atMs)),
          position: vector(key.position),
          visualYawRad: numeric(key.visualYawRad),
        };
      });
      const shapes = list(serialized.shapes).map((value) => {
        const shape = record(value);
        if (
          typeof shape.shapeId !== 'string' ||
          shape.shapeId !== impacts[0]?.shapeId
        )
          throw new Error('Diagnostic shape binding');
        return {
          shapeId: shape.shapeId,
          keys: list(shape.keys).map((value) => {
            const key = record(value),
              volume = record(key.volume);
            if (volume.kind !== 'capsule')
              throw new Error('Diagnostic capsule required');
            const radiusM = numeric(volume.radiusM);
            if (radiusM <= 0) throw new Error('Diagnostic capsule radius');
            return {
              atMs: durationMs(numeric(key.atMs)),
              volume: {
                kind: 'capsule' as const,
                start: vector(volume.start),
                end: vector(volume.end),
                radiusM,
              },
            };
          }),
        };
      });
      const owners = list(serialized.ownership);
      const owner = record(owners[0]);
      if (
        owners.length !== 1 ||
        owner.atMs !== 0 ||
        owner.horizontalOwner !== 'authored-root' ||
        owner.verticalOwner !== 'spatial-jump' ||
        rootCurve.some(
          (key) =>
            key.position.x !== 0 ||
            key.position.y !== 0 ||
            key.position.z !== 0,
        )
      )
        throw new Error('Diagnostic explicit transport policy');
      const sampling = record(definition.sampling);
      if (
        sampling.version !== 1 ||
        sampling.sampleRateHz !== 240 ||
        sampling.interpolation !== 'piecewise-linear'
      )
        throw new Error('Diagnostic sampling policy');
      const asset: MotionAsset = {
        definition: {
          clipId: descriptor.clipId,
          category: 'kick',
          durationMs: descriptor.durationMs,
          effectiveRangeM: numeric(definition.effectiveRangeM),
          impacts,
          rootCurve,
          sampling: {
            version: 1,
            sampleRateHz: numeric(sampling.sampleRateHz),
            interpolation: 'piecewise-linear',
          },
        },
        shapes,
        ownership: [
          {
            atMs: durationMs(0),
            horizontalOwner: 'authored-root',
            verticalOwner: 'spatial-jump',
          },
        ],
      };
      if (!validateMotionDefinition(asset.definition).valid)
        throw new Error('Invalid diagnostic motion definition');
      const polygons = list(entry.polygons).map((value) => {
        const polygon = record(value);
        const vertexIndices = triple(polygon.vertexIndices);
        vertexIndices.forEach(sourceIndex);
        if (
          typeof polygon.region !== 'string' ||
          !descriptor.regions.some((region) => region === polygon.region) ||
          (polygon.coverage !== 'full' && polygon.coverage !== 'clipped')
        )
          throw new Error('Diagnostic region/coverage');
        const barycentric = list(polygon.barycentric).map(triple);
        if (
          barycentric.length < 3 ||
          barycentric.some(
            (p) =>
              p.some((n) => n < 0 || n > 1) ||
              Math.abs(p[0] + p[1] + p[2] - 1) > 1e-12,
          )
        )
          throw new Error('Diagnostic barycentric polygon');
        return {
          primitive: sourceIndex(polygon.primitive),
          triangleIndex: sourceIndex(polygon.triangleIndex),
          vertexIndices,
          region: polygon.region,
          coverage: polygon.coverage,
          barycentric,
        };
      });
      const rawRootCurve = list(entry.rawRootCurve).map((value) => {
        const key = record(value);
        return {
          atMs: durationMs(numeric(key.atMs)),
          position: vector(key.position),
          visualYawRad: numeric(key.visualYawRad),
        };
      });
      const measurement = record(entry.finiteMeasurement);
      if (measurement.continuousClaim !== false)
        throw new Error('Unexpected continuous claim');
      return {
        descriptor,
        rootPolicy: descriptor.rootPolicy,
        asset,
        polygons,
        rawRootCurve,
        finiteMeasurement: {
          probes: sourceIndex(measurement.probes),
          testedCorners: sourceIndex(measurement.testedCorners),
          maximumFiniteSurfaceEscapeM: numeric(
            measurement.maximumFiniteSurfaceEscapeM,
          ),
          escapedAtMs: numeric(measurement.escapedAtMs),
          directionalExcess: list(measurement.directionalExcess).map(
            (value) => {
              const metric = record(value);
              if (typeof metric.direction !== 'string')
                throw new Error('Measurement direction');
              return {
                direction: metric.direction,
                maximumM: numeric(metric.maximumM),
                atMs: numeric(metric.atMs),
              };
            },
          ),
        },
        acceptance: null,
        usage: 'diagnostic-broadphase-only' as const,
      };
    }),
  );
}
