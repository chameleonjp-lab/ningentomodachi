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

export const GROUNDED_KICK_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export interface GroundedKickSourceInput {
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
export const groundedKickHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const selections = [
  {
    name: 'FrontThrustKick',
    index: 8,
    side: 'L',
    supportSide: 'R',
    supportField: 'support_contacts',
    peakField: 'peak_frame',
    endFrame: 65,
    firstFrame: 31,
    lastFrame: 36,
    peakFrame: 33,
    sourceDirection: 'forward heel/sole thrust; Blender -Y maps to glTF +Z',
  },
  {
    name: 'SideKick',
    index: 1,
    side: 'R',
    supportSide: 'L',
    supportField: 'support',
    peakField: 'frame',
    endFrame: 53,
    firstFrame: 24,
    lastFrame: 27,
    peakFrame: 26,
    sourceDirection:
      'lateral side kick toward character right (source Blender -X)',
  },
] as const;

/** Pins belong to this diagnostic, never to a caller-supplied trust argument. */
export function readGroundedKickSources(input: GroundedKickSourceInput) {
  const pins = GROUNDED_KICK_SOURCE_PINS;
  if (
    groundedKickHash(input.sourceBytes) !== pins.sourceSha256 ||
    groundedKickHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Grounded kick source hash mismatch');
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
        record(source.attack_and_timeline_events).attack_events,
      );
      const event = record(events[0]);
      const frames = list(event.active_frames);
      const support = record(
        list(record(source.support_contacts)[selection.supportField])[0],
      );
      const supportFrames = list(support.frames);
      const expectedSupport =
        selection.supportSide === 'R' ? 'right foot' : 'left foot';
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
        supportFrames.length !== 2 ||
        supportFrames[0] !== 1 ||
        supportFrames[1] !== selection.endFrame ||
        (support.side !== selection.supportSide &&
          support.limb !== expectedSupport)
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
        supportSide: selection.supportSide,
        sourceFrames: [selection.firstFrame, selection.lastFrame] as const,
        sourceClipPointer,
        sourceEventPointer: `${sourceClipPointer}/attack_and_timeline_events/attack_events/0`,
        sourceDirection: selection.sourceDirection,
        sourceEvent: event,
        sourceSupport: support,
        sourceRoot: source.root_motion,
        sourceTimesSeconds: [...binary.sampleTimes],
        window,
        rootPolicy: copyRootPolicy({
          version: 1,
          clipId: selection.name,
          sourceSha256: pins.sourceSha256,
          mode: 'grounded-posture-y',
          provenance: {
            manifestSha256: pins.manifestSha256,
            clipPointer: sourceClipPointer,
            supportPointer: `${sourceClipPointer}/support_contacts/${selection.supportField}/0`,
          },
        }),
        rootPolicyAcceptance: null,
        acceptance: null,
      };
    }),
  );
}

export const GROUNDED_KICK_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    '6aee8452848a45df5f05f6cdb99abf6cc157a4ceb3e8c6b25db4c94839dc0ee2',
  recipeSha256:
    'a33389fdba7bb0676408ba5b7767f4613bface8ea8c47487f747e71d408553d8',
});
export interface GroundedKickDiagnosticInput extends GroundedKickSourceInput {
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
export function loadGroundedKickDiagnostics(
  input: GroundedKickDiagnosticInput,
) {
  const pins = GROUNDED_KICK_DIAGNOSTIC_PINS;
  if (
    groundedKickHash(input.candidateBytes) !== pins.candidateSha256 ||
    groundedKickHash(input.recipeBytes) !== pins.recipeSha256
  )
    throw new Error('Grounded kick diagnostic hash mismatch');
  const descriptors = readGroundedKickSources(input);
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
        rootCurve.some((key) => key.position.y !== 0)
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
          (polygon.region !== 'heel' && polygon.region !== 'sole') ||
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
