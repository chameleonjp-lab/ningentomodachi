/** Offline diagnostic source boundary, never a production move registry. */
import { createHash } from 'node:crypto';
import { copyRootPolicy, inspectGlb, type MotionAsset } from '../../src/assets';
import {
  clipId,
  durationMs,
  type Vector3,
  validateMotionDefinition,
} from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const GROUNDED_PUNCH_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  sourceSha256:
    'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
  manifestPath:
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  manifestSha256:
    'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
});
export interface GroundedPunchSourceInput {
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
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export const groundedPunchHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const selections = [
  {
    name: 'PunchCombo4',
    index: 4,
    endFrame: 81,
    supportPointer: 'support',
    events: [
      { side: 'L', peak: 12, first: 11, last: 12, type: 'jab' },
      { side: 'R', peak: 24, first: 23, last: 24, type: 'cross' },
      { side: 'L', peak: 39, first: 38, last: 40, type: 'horizontal hook' },
      { side: 'R', peak: 59, first: 58, last: 60, type: 'upward uppercut' },
    ],
  },
  {
    name: 'PalmStrike',
    index: 9,
    endFrame: 61,
    supportPointer: 'support_contacts',
    events: [{ side: 'R', peak: 25, first: 24, last: 26, type: 'palm_heel' }],
  },
] as const;

/** All trust pins and diagnostic interval choices are owned here, not caller-supplied. */
export function readGroundedPunchSources(input: GroundedPunchSourceInput) {
  const pins = GROUNDED_PUNCH_SOURCE_PINS;
  if (
    groundedPunchHash(input.sourceBytes) !== pins.sourceSha256 ||
    groundedPunchHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Grounded punch source hash mismatch');
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
      const sourceEvents = list(
        record(source.attack_and_timeline_events).attack_events,
      );
      const sourceSupport = record(source.support_contacts);
      if (
        source.clip !== selection.name ||
        source.primary_category !== 'punch' ||
        source.fps !== 45 ||
        range[0] !== 1 ||
        range[1] !== selection.endFrame ||
        sourceEvents.length !== selection.events.length
      )
        throw new Error('Unexpected source clip identity or event count');
      if (selection.name === 'PunchCombo4') {
        if (
          sourceSupport.support !==
          'Left sole planted throughout; rear forefoot pivots with heel rise during cross, then returns flat for hook and uppercut. No steps or airborne phases.'
        )
          throw new Error('Unexpected combo support provenance');
      } else {
        const support = list(sourceSupport.support_contacts);
        if (
          support.length !== 2 ||
          support.some((item, index) => {
            const entry = record(item),
              frames = list(entry.frames);
            return (
              entry.bone !== (index === 0 ? 'foot.L' : 'foot.R') ||
              frames.length !== 2 ||
              frames[0] !== 1 ||
              frames[1] !== 61
            );
          })
        )
          throw new Error('Unexpected palm support provenance');
      }
      const binary = inspected.clips.find(
        (clip) => clip.name === selection.name,
      );
      if (!binary) throw new Error('Missing exact binary clip');
      const sourceClipPointer = `/clips/${selection.index}`;
      const events = selection.events.map((expected, index) => {
        const event = record(sourceEvents[index]);
        const explicit = selection.name === 'PunchCombo4';
        if (
          event.frame !== expected.peak ||
          event.type !== expected.type ||
          (explicit
            ? event.limb !== `hand.${expected.side}`
            : event.side !== 'R' ||
              event.count !== 1 ||
              'window' in event ||
              'active_frames' in event)
        )
          throw new Error('Unexpected source event identity');
        if (explicit) {
          const frames = list(event.window);
          if (
            frames.length !== 2 ||
            frames[0] !== expected.first ||
            frames[1] !== expected.last
          )
            throw new Error('Unexpected explicit source interval');
        }
        const window = inclusiveAccessorFrameWindow({
          sourceStartFrame: 1,
          sourceEndFrame: selection.endFrame,
          fps: 45,
          firstFrame: expected.first,
          lastFrame: expected.last,
          peakFrame: expected.peak,
          accessorTimesSeconds: binary.sampleTimes,
          durationMs: binary.durationSeconds * 1000,
        });
        return {
          impactIndex: index,
          side: expected.side,
          boneName: `hand.${expected.side}`,
          sourceType: expected.type,
          peakFrame: expected.peak,
          sourceFrames: explicit
            ? ([expected.first, expected.last] as const)
            : null,
          diagnosticFrames: [expected.first, expected.last] as const,
          windowOrigin: explicit
            ? ('source-explicit-interval' as const)
            : ('developer-provisional-around-source-peak' as const),
          sourceEventPointer: `${sourceClipPointer}/attack_and_timeline_events/attack_events/${index}`,
          sourceEvent: event,
          window,
          intendedRegion: explicit
            ? ('distal-hand-proximal-finger-rim' as const)
            : ('proximal-palmar-heel' as const),
          acceptance: null,
        };
      });
      return {
        clipId: clipId(selection.name),
        durationMs: durationMs(binary.durationSeconds * 1000),
        sourceClipPointer,
        sourceTimesSeconds: [...binary.sampleTimes],
        events,
        sourceSupport,
        sourceRoot: source.root_motion,
        sourcePhases: source.phases,
        rootPolicy: copyRootPolicy({
          version: 1,
          clipId: selection.name,
          sourceSha256: pins.sourceSha256,
          mode: 'grounded-posture-y',
          provenance: {
            manifestSha256: pins.manifestSha256,
            clipPointer: sourceClipPointer,
            supportPointer: `${sourceClipPointer}/support_contacts/${selection.supportPointer}`,
          },
        }),
        rootPolicyAcceptance: null,
        acceptance: null,
      };
    }),
  );
}

export const GROUNDED_PUNCH_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    'd586bc66708ea3fbdeef01074b9e94921430e77824901cd9a1cb8b3ca648cfa8',
  recipeSha256:
    '7945bf72a47629e327ced40413581752a2655544301f8c4e1f898379d83dd97d',
});
export interface GroundedPunchDiagnosticInput extends GroundedPunchSourceInput {
  readonly candidateBytes: Uint8Array;
  readonly recipeBytes: Uint8Array;
}
function numeric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Finite diagnostic number required');
  return value;
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
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('Diagnostic string required');
  return value;
}
function rootKeys(value: unknown) {
  return list(value).map((value) => {
    const key = record(value);
    return {
      atMs: durationMs(numeric(key.atMs)),
      position: vector(key.position),
      visualYawRad: numeric(key.visualYawRad),
    };
  });
}
/** Built-in source/recipe/candidate pins. No caller trust override or production readiness. */
export function loadGroundedPunchDiagnostics(
  input: GroundedPunchDiagnosticInput,
) {
  const pins = GROUNDED_PUNCH_DIAGNOSTIC_PINS;
  if (
    groundedPunchHash(input.candidateBytes) !== pins.candidateSha256 ||
    groundedPunchHash(input.recipeBytes) !== pins.recipeSha256
  )
    throw new Error('Grounded punch diagnostic hash mismatch');
  const descriptors = readGroundedPunchSources(input);
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
    recipe.gameplayAllowance !== null ||
    recipe.status !== 'diagnostic-broadphase-only'
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
      const impacts = list(definition.impacts).map((value, index) => {
        const impact = record(value),
          event = descriptor.events[index];
        if (
          !event ||
          impact.impactIndex !== index ||
          impact.startMs !== event.window.startMs ||
          impact.endMs !== event.window.endMs ||
          impact.damageShare !== 1 / descriptor.events.length
        )
          throw new Error('Diagnostic impact/source timing mismatch');
        return {
          impactIndex: index,
          startMs: durationMs(event.window.startMs),
          endMs: durationMs(event.window.endMs),
          damageShare: numeric(impact.damageShare),
          shapeId: text(impact.shapeId),
        };
      });
      if (
        definition.clipId !== descriptor.clipId ||
        definition.category !== 'punch' ||
        definition.durationMs !== descriptor.durationMs ||
        impacts.length !== descriptor.events.length
      )
        throw new Error('Diagnostic clock/category mismatch');
      const shapes = list(serialized.shapes).map((value, index) => {
        const shape = record(value);
        if (shape.shapeId !== impacts[index]?.shapeId)
          throw new Error('Diagnostic shape binding');
        return {
          shapeId: text(shape.shapeId),
          keys: list(shape.keys).map((value) => {
            const key = record(value),
              volume = record(key.volume),
              radiusM = numeric(volume.radiusM);
            if (volume.kind !== 'sphere' || radiusM <= 0)
              throw new Error('Diagnostic sphere required');
            return {
              atMs: durationMs(numeric(key.atMs)),
              volume: {
                kind: 'sphere' as const,
                center: vector(volume.center),
                radiusM,
              },
            };
          }),
        };
      });
      if (
        shapes.length !== impacts.length ||
        new Set(shapes.map((shape) => shape.shapeId)).size !== shapes.length
      )
        throw new Error('Distinct event shapes required');
      const rootCurve = rootKeys(definition.rootCurve),
        owners = list(serialized.ownership),
        owner = record(owners[0]);
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
          category: 'punch',
          durationMs: descriptor.durationMs,
          effectiveRangeM: numeric(definition.effectiveRangeM),
          impacts,
          rootCurve,
          sampling: {
            version: 1,
            sampleRateHz: 240,
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
        throw new Error('Invalid diagnostic definition');
      const regions = list(entry.regions).map((value, index) => {
        const region = record(value),
          event = descriptor.events[index];
        if (
          !event ||
          JSON.stringify(region.event) !== JSON.stringify(event) ||
          region.shapeId !== impacts[index]?.shapeId
        )
          throw new Error('Diagnostic region/event binding');
        const seed = record(region.seed);
        const polygons = list(region.polygons).map((value) => {
          const p = record(value),
            vertexIndices = triple(p.vertexIndices);
          vertexIndices.forEach(sourceIndex);
          if (
            (p.region !== 'distal-hand' &&
              p.region !== 'proximal-finger' &&
              p.region !== 'palmar-heel') ||
            (p.coverage !== 'full' && p.coverage !== 'clipped') ||
            typeof p.restoredLeadingRim !== 'boolean'
          )
            throw new Error('Diagnostic anatomical region');
          const barycentric = list(p.barycentric).map(triple);
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
            primitive: sourceIndex(p.primitive),
            triangleIndex: sourceIndex(p.triangleIndex),
            vertexIndices,
            region: p.region,
            coverage: p.coverage,
            restoredLeadingRim: p.restoredLeadingRim,
            jointIndex: sourceIndex(p.jointIndex),
            sourceJointName: text(p.sourceJointName),
            barycentric,
          };
        });
        if (polygons.length === 0 || numeric(seed.radiusM) <= 0)
          throw new Error('Empty diagnostic region');
        return {
          event,
          shapeId: text(region.shapeId),
          polygons,
          seed: {
            kind: 'sphere' as const,
            center: vector(seed.center),
            radiusM: numeric(seed.radiusM),
          },
        };
      });
      if (regions.length !== impacts.length)
        throw new Error('Missing diagnostic event region');
      const finiteMeasurement = list(entry.finiteMeasurement).map((value) => {
        const m = record(value);
        if (m.continuousClaim !== false)
          throw new Error('Unexpected continuous claim');
        return {
          probes: sourceIndex(m.probes),
          testedCorners: sourceIndex(m.testedCorners),
          maximumFiniteSurfaceEscapeM: numeric(m.maximumFiniteSurfaceEscapeM),
          escapedAtMs: numeric(m.escapedAtMs),
          directionalExcess: list(m.directionalExcess).map((value) => {
            const metric = record(value);
            return {
              axis: text(metric.axis),
              maximumM: numeric(metric.maximumM),
              atMs: numeric(metric.atMs),
            };
          }),
        };
      });
      if (finiteMeasurement.length !== impacts.length)
        throw new Error('Missing diagnostic measurements');
      return {
        descriptor,
        rootPolicy: descriptor.rootPolicy,
        asset,
        regions,
        rawRootCurve: rootKeys(entry.rawRootCurve),
        finiteMeasurement,
        acceptance: null,
        gameplayAllowance: null,
        usage: 'diagnostic-broadphase-only' as const,
      };
    }),
  );
}
