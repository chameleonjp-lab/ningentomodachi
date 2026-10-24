/** Offline single-hand diagnostics. Never a production registry. */
import { createHash } from 'node:crypto';
import { copyRootPolicy, inspectGlb, type MotionAsset } from '../../src/assets';
import {
  clipId,
  durationMs,
  type Vector3,
  validateMotionDefinition,
} from '../../src/contracts';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';
export const KUNG_FU_STRAIGHT_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  sourceSha256:
    'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
  manifestPath:
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  manifestSha256:
    'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
});
export interface KungFuStraightSourceInput {
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
export const kungFuStraightHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const KUNG_FU_STRAIGHT_RECIPE_HASHES = Object.freeze([
  'cda321a7ef466e3f231d4f96e903c34a2a925613cb2e388d4e34c53c4df56f34',
]);
export function validateKungFuStraightRecipes(bytes: Uint8Array) {
  if (
    kungFuStraightHash(bytes) !== KUNG_FU_STRAIGHT_DIAGNOSTIC_PINS.recipeSha256
  )
    throw new Error('Diagnostic recipe hash mismatch');
  const wrapper = record(JSON.parse(new TextDecoder().decode(bytes)));
  if (
    wrapper.schemaVersion !== 1 ||
    wrapper.status !== 'diagnostic-broadphase-only' ||
    wrapper.acceptance !== null ||
    wrapper.gameplayAllowance !== null ||
    Object.keys(wrapper).sort().join(',') !==
      'acceptance,gameplayAllowance,originalRecipeTexts,schemaVersion,status'
  )
    throw new Error('Diagnostic recipe state');
  const texts = list(wrapper.originalRecipeTexts);
  if (texts.length !== 1) throw new Error('One original recipe required');
  return freeze(
    texts.map((text, index) => {
      if (
        typeof text !== 'string' ||
        kungFuStraightHash(new TextEncoder().encode(text)) !==
          KUNG_FU_STRAIGHT_RECIPE_HASHES[index]
      )
        throw new Error('Original recipe hash mismatch');
      return record(JSON.parse(text));
    }),
  );
}
const selections = [
  {
    name: 'KungFuStraight',
    index: 8,
    end: 61,
    peak: 25,
    first: 25,
    last: 28,
    recoil: 29,
    side: 'R',
    eventKey: 'strike_events',
    eventIndex: 0,
    supportKey: 'contact',
  },
] as const;
export function readKungFuStraightSources(input: KungFuStraightSourceInput) {
  const pins = KUNG_FU_STRAIGHT_SOURCE_PINS;
  if (
    kungFuStraightHash(input.sourceBytes) !== pins.sourceSha256 ||
    kungFuStraightHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Single hand source hash mismatch');
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
    selections.map((s) => {
      const source = record(list(manifest.clips)[s.index]),
        range = list(source.source_frame_range),
        timeline = record(source.attack_and_timeline_events),
        event = record(list(timeline[s.eventKey])[s.eventIndex]);
      if (
        source.clip !== s.name ||
        source.primary_category !== 'punch' ||
        source.fps !== 45 ||
        range[0] !== 1 ||
        range[1] !== s.end ||
        event.frame !== s.peak
      )
        throw new Error('Unexpected source identity');
      const phases = list(record(source.phases).phases);
      const contact = record(phases[3]),
        recoil = record(phases[4]);
      if (
        event.limb !== 'right fist' ||
        event.direction !== 'character forward -Y' ||
        contact.name !== 'contact' ||
        JSON.stringify(contact.frames) !== '[25,28]' ||
        recoil.name !== 'recoil' ||
        JSON.stringify(recoil.frames) !== '[29,39]'
      )
        throw new Error('Exact contact phase and peak annotation required');
      const binary = inspected.clips.find((c) => c.name === s.name);
      if (!binary || binary.sampleTimes.length !== s.end)
        throw new Error('Exact accessor union required');
      const sourceClipPointer = `/clips/${s.index}`;
      const window = inclusiveAccessorFrameWindow({
        sourceStartFrame: 1,
        sourceEndFrame: s.end,
        fps: 45,
        firstFrame: s.first,
        lastFrame: s.last,
        peakFrame: s.peak,
        accessorTimesSeconds: binary.sampleTimes,
        durationMs: binary.durationSeconds * 1000,
      });
      return {
        clipId: clipId(s.name),
        durationMs: durationMs(binary.durationSeconds * 1000),
        sourceClipPointer,
        sourceTimesSeconds: [...binary.sampleTimes],
        events: [
          {
            impactIndex: 0,
            side: s.side,
            boneName: `hand.${s.side}`,
            sourceType: s.name,
            peakFrame: s.peak,
            sourceFrames: null,
            diagnosticFrames: [s.first, s.last] as const,
            recoilStartFrame: s.recoil,
            windowOrigin: 'developer-provisional-phase-derived' as const,
            earlierUnselectedFrames: [24, 26] as const,
            sourcePhasePointer: '/clips/8/phases/phases/3',
            sourceEventPointer: `${sourceClipPointer}/attack_and_timeline_events/${s.eventKey}/${s.eventIndex}`,
            sourceEvent: event,
            window,
            intendedRegion:
              'distal-right-hand-proximal-finger-rim-hypothesis' as const,
            acceptance: null,
          },
        ],
        sourceSupport: record(source.support_contacts),
        sourceRoot: source.root_motion,
        sourcePhases: source.phases,
        rootPolicy: copyRootPolicy({
          version: 1,
          clipId: s.name,
          sourceSha256: pins.sourceSha256,
          mode: 'grounded-posture-y',
          provenance: {
            manifestSha256: pins.manifestSha256,
            clipPointer: sourceClipPointer,
            supportPointer: `${sourceClipPointer}/support_contacts/${s.supportKey}`,
          },
        }),
        rootPolicyAcceptance: null,
        acceptance: null,
      };
    }),
  );
}

export const KUNG_FU_STRAIGHT_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    'f612629d1807ceb4f994c22935cc9d60119aad736528e1f20a5fafec011c1adb',
  recipeSha256:
    'c1f0898bc021e4df667ccf0c7dacf6cfacc77637dcb15c3883b8731696653ee4',
});
export interface KungFuStraightDiagnosticInput
  extends KungFuStraightSourceInput {
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
export function loadKungFuStraightDiagnostics(
  input: KungFuStraightDiagnosticInput,
) {
  const pins = KUNG_FU_STRAIGHT_DIAGNOSTIC_PINS;
  if (
    kungFuStraightHash(input.candidateBytes) !== pins.candidateSha256 ||
    kungFuStraightHash(input.recipeBytes) !== pins.recipeSha256
  )
    throw new Error('Single hand diagnostic hash mismatch');
  validateKungFuStraightRecipes(input.recipeBytes);
  const descriptors = readKungFuStraightSources(input);
  const candidate = record(
    JSON.parse(new TextDecoder().decode(input.candidateBytes)),
  );
  const recipe = record(
    JSON.parse(new TextDecoder().decode(input.recipeBytes)),
  );
  const results = list(candidate.results);
  if (
    results.length !== 1 ||
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
        if (Object.hasOwn(impact, 'additionalShapeIds'))
          throw new Error('Legacy diagnostic does not support additional shape references');
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
            (p.region !== 'distal-hand-hypothesis' &&
              p.region !== 'proximal-finger-hypothesis') ||
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
