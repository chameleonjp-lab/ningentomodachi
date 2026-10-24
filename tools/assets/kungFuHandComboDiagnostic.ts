/** Offline single-hand diagnostics. Never a production registry. */
import { createHash } from 'node:crypto';
import { copyRootPolicy, inspectGlb, type MotionAsset } from '../../src/assets';
import {
  clipId,
  durationMs,
  type Vector3,
  validateMotionDefinition,
} from '../../src/contracts';
import { inclusiveFrameWindow } from './annotationPolicy';
export const KUNG_FU_HAND_COMBO_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/punch/android_punch.glb',
  sourceSha256:
    'c5dd6733fc1ba208cb90b4a556dc8e0b05964d6c49e330d09220ade9b991d95d',
  manifestPath:
    'assets/android/motions/completed42-speed15/punch/manifest.json',
  manifestSha256:
    'dcb21aefd7e07cfe9019bc65d573e88db4fb477c1a10da619c3ab5afbc18aff0',
});
export interface KungFuHandComboSourceInput {
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
export const kungFuHandComboHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const KUNG_FU_HAND_COMBO_RECIPE_HASHES = Object.freeze([
  '65ec78d63f51fb3eaa17a1e75201c6630e606fc58112a3d5a3f198c99a6f8b2d',
]);
export function validateKungFuHandComboRecipes(bytes: Uint8Array) {
  if (
    kungFuHandComboHash(bytes) !== KUNG_FU_HAND_COMBO_DIAGNOSTIC_PINS.recipeSha256
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
        kungFuHandComboHash(new TextEncoder().encode(text)) !==
          KUNG_FU_HAND_COMBO_RECIPE_HASHES[index]
      )
        throw new Error('Original recipe hash mismatch');
      return record(JSON.parse(text));
    }),
  );
}
/** Exact native time accessor, not a widened generic uniform-clock tolerance.
 * Source animation /animations/12 has input accessor 3563 (145 float32 keys),
 * plus accessor 3566 (the same first/last endpoints). Manifest /clips/12 names
 * source frames 1..145. The reviewed clip-only correspondence is ordinal.
 */
export const KUNG_FU_HAND_COMBO_NATIVE_TIMES_SHA256 =
  '24f4d10b919cf2cf3b0f62ea8b50e800259a7cb41e82c0c0f052328c381e5f31';
export function validateKungFuHandComboAccessorTimes(times: readonly number[]) {
  if (times.length !== 145 || times.some((time, index) =>
    !Number.isFinite(time) || time !== Math.fround(time) || time <= 0 ||
    (index > 0 && time <= (times[index - 1] ?? Infinity))))
    throw new Error('Exact ordered native float32 accessor keys required');
  const bytes = new Uint8Array(times.length * 4);
  const view = new DataView(bytes.buffer);
  times.forEach((time, index) => view.setFloat32(index * 4, time, true));
  if (kungFuHandComboHash(bytes) !== KUNG_FU_HAND_COMBO_NATIVE_TIMES_SHA256)
    throw new Error('Native accessor byte hash mismatch');
}
/** Private clip-only mapping. Widths remain explicitly developer generated. */
function nativeFrameWindow(times: readonly number[], peakFrame: number, actualDurationMs: number) {
  validateKungFuHandComboAccessorTimes(times);
  const firstFrame = peakFrame - 1, lastFrame = peakFrame + 1;
  const relativeClock = inclusiveFrameWindow({ sourceStartFrame: 1, fps: 45,
    firstFrame, lastFrame, peakFrame, durationMs: actualDurationMs });
  const start = times[firstFrame - 1], peak = times[peakFrame - 1], end = times[lastFrame];
  if (start === undefined || peak === undefined || end === undefined ||
      !(start < end && start <= peak && peak < end) || end * 1000 > actualDurationMs)
    throw new Error('Native ordinal window exceeds original clip');
  return {
    policy: 'pinned-kungfu-hand-combo-ordinal-accessor-cells-v1' as const,
    acceptance: 'provisional-policy' as const,
    startMs: start * 1000, endMs: end * 1000, peakMs: peak * 1000,
    relativeClock, initialHoldEndMs: (times[0] ?? 0) * 1000,
    mappingProvenance: { manifestFrameRangePointer: '/clips/12/source_frame_range',
      animationPointer: '/animations/12', fullTimeAccessorPointer: '/accessors/3563',
      endpointAccessorPointer: '/accessors/3566', nativeTimesSha256: KUNG_FU_HAND_COMBO_NATIVE_TIMES_SHA256 },
  };
}
const events = [
  { peak: 22, side: 'R', boneName: 'hand.R', surface: 'closed fist', intendedRegion: 'distal-hand-proximal-finger-rim-hypothesis' },
  { peak: 43, side: 'L', boneName: 'hand.L', surface: 'open upright palm heel', intendedRegion: 'palmar-heel-hypothesis' },
  { peak: 66, side: 'R', boneName: 'hand.R', surface: 'dorsal closed fist', intendedRegion: 'dorsal-hand-proximal-finger-rim-hypothesis' },
  { peak: 87, side: 'R', boneName: 'forearm.R', surface: 'elbow, fist beside same-side head', intendedRegion: 'posterior-elbow-band-hypothesis' },
  { peak: 108, side: 'L', boneName: 'hand.L', surface: 'open upright palm heel', intendedRegion: 'palmar-heel-hypothesis' },
] as const;
export function readKungFuHandComboSources(input: KungFuHandComboSourceInput) {
  const pins = KUNG_FU_HAND_COMBO_SOURCE_PINS;
  if (input.sourceBytes.byteLength !== 5584752 || input.manifestBytes.byteLength !== 46217 ||
      kungFuHandComboHash(input.sourceBytes) !== pins.sourceSha256 ||
      kungFuHandComboHash(input.manifestBytes) !== pins.manifestSha256)
    throw new Error('Hand combo source hash mismatch');
  const manifest = record(JSON.parse(new TextDecoder().decode(input.manifestBytes)));
  if (manifest.runtime_playback_speed !== 1 || manifest.baked_speed_multiplier !== 1.5)
    throw new Error('Already-retimed runtime speed one required');
  const source = record(list(manifest.clips)[12]);
  const sourceEvents = list(record(source.attack_and_timeline_events).attack_events);
  if (source.clip !== 'KungFuHandCombo5' || source.primary_category !== 'punch' || source.fps !== 45 ||
      JSON.stringify(source.source_frame_range) !== '[1,145]' || sourceEvents.length !== 5 || source.loop !== false)
    throw new Error('Exact hand combo identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find((c) => c.name === source.clip);
  if (!binary || binary.sampleTimes.length !== 145 || binary.sampleTimes[0] !== 0.02222222276031971)
    throw new Error('Exact native accessor union and initial hold required');
  return freeze([{
    clipId: clipId('KungFuHandCombo5'), durationMs: durationMs(binary.durationSeconds * 1000),
    sourceClipPointer: '/clips/12', sourceTimesSeconds: [...binary.sampleTimes],
    events: events.map((selection, impactIndex) => {
      const sourceEvent = record(sourceEvents[impactIndex]);
      if (sourceEvent.frame !== selection.peak || sourceEvent.side !== selection.side ||
          sourceEvent.surface !== selection.surface || sourceEvent.count !== 1)
        throw new Error('Exact original five event annotations required');
      return {
        impactIndex, side: selection.side, boneName: selection.boneName,
        sourceType: 'KungFuHandCombo5', peakFrame: selection.peak, sourceFrames: null,
        diagnosticFrames: [selection.peak - 1, selection.peak + 1] as const,
        windowOrigin: 'developer-provisional-around-source-peak' as const,
        sourceEventPointer: `/clips/12/attack_and_timeline_events/attack_events/${impactIndex}`,
        sourceEvent,
        window: nativeFrameWindow(binary.sampleTimes, selection.peak, binary.durationSeconds * 1000),
        intendedRegion: selection.intendedRegion, acceptance: null,
      };
    }),
    sourceSupport: record(source.support_contacts), sourceRoot: source.root_motion,
    sourcePhases: source.phases, sourceStartEndUse: source.start_end_use,
    rootPolicy: copyRootPolicy({ version: 1, clipId: 'KungFuHandCombo5', sourceSha256: pins.sourceSha256,
      mode: 'grounded-posture-y', provenance: { manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/12', supportPointer: '/clips/12/support_contacts/support_contacts' } }),
    rootPolicyAcceptance: null, acceptance: null,
  }]);
}

export const KUNG_FU_HAND_COMBO_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    '5200f8a078d30d3f9f62a6c5c4a25c7e8c5f53a02e0a1d81de79d8811804bb67',
  recipeSha256:
    '11611ef2840df7d26dc1f77942aef95a645ef7dd4de83fb79dcb2ec465c8faca',
});
export interface KungFuHandComboDiagnosticInput
  extends KungFuHandComboSourceInput {
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
export function loadKungFuHandComboDiagnostics(
  input: KungFuHandComboDiagnosticInput,
) {
  const pins = KUNG_FU_HAND_COMBO_DIAGNOSTIC_PINS;
  if (
    kungFuHandComboHash(input.candidateBytes) !== pins.candidateSha256 ||
    kungFuHandComboHash(input.recipeBytes) !== pins.recipeSha256
  )
    throw new Error('Single hand diagnostic hash mismatch');
  validateKungFuHandComboRecipes(input.recipeBytes);
  const descriptors = readKungFuHandComboSources(input);
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
        sampling.sampleRateHz !== 1 ||
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
            sampleRateHz: 1,
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
              p.region !== 'proximal-finger-hypothesis' &&
              p.region !== 'dorsal-hand-hypothesis' &&
              p.region !== 'palmar-heel-hypothesis' &&
              p.region !== 'posterior-elbow-band-hypothesis') ||
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
