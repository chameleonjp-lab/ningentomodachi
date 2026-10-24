/** Offline four-event kick chain diagnostics. Never a production registry. */
import { createHash } from 'node:crypto';
import { copyRootPolicy, inspectGlb, type MotionAsset } from '../../src/assets';
import {
  clipId,
  durationMs,
  type Vector3,
  validateMotionDefinition,
} from '../../src/contracts';
import { inclusiveFrameWindow } from './annotationPolicy';
/** Exact correspondence for this pinned two-stage Float32 retimed export only.
 * Labels remain one-based; binary first-key hold and following inclusive cell
 * are preserved. This is not a wider shared clock tolerance. */
export function kickChainAccessorWindow(
  times: readonly number[],
  firstFrame: number,
  lastFrame: number,
  peakFrame: number,
  clipDurationMs: number,
) {
  if (times.length !== 191)
    throw new Error('Chain accessor cardinality mismatch');
  for (let i = 0; i < 191; i++) {
    if (!Object.is(times[i], Math.fround(Math.fround((i + 1) / 30) / 1.5)))
      throw new Error('Unproven exact chain accessor correspondence');
  }
  const relativeClock = inclusiveFrameWindow({
    sourceStartFrame: 1,
    fps: 45,
    firstFrame,
    lastFrame,
    peakFrame,
    durationMs: clipDurationMs,
  });
  const at = (frame: number) => {
    const time = times[frame - 1];
    if (time === undefined)
      throw new Error('Missing inclusive endpoint accessor');
    return time * 1000;
  };
  const startMs = at(firstFrame),
    endMs = at(lastFrame + 1),
    peakMs = at(peakFrame);
  if (
    endMs > clipDurationMs ||
    startMs >= endMs ||
    peakMs < startMs ||
    peakMs >= endMs
  )
    throw new Error('Accessor window exceeds actual clip');
  return {
    policy: 'inclusive-accessor-frame-cells-v1' as const,
    acceptance: 'provisional-policy' as const,
    startMs,
    endMs,
    peakMs,
    relativeClock,
    initialHoldEndMs: at(1),
  };
}
export const KICK_CHAIN_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
export interface KickChainSourceInput {
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
export const kickChainHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const KICK_CHAIN_ORIGINAL_RECIPE_SHA256 =
  '3da264bbb57550c552302c5e36de197c5151f7687e49986ce6e3f8529537b8e1';
export function validateKickChainRecipe(bytes: Uint8Array) {
  if (kickChainHash(bytes) !== KICK_CHAIN_DIAGNOSTIC_PINS.recipeSha256)
    throw new Error('Diagnostic recipe hash mismatch');
  const wrapper = record(JSON.parse(new TextDecoder().decode(bytes)));
  if (
    wrapper.status !== 'diagnostic-broadphase-only' ||
    wrapper.acceptance !== null ||
    wrapper.gameplayAllowance !== null ||
    typeof wrapper.originalRecipeText !== 'string' ||
    kickChainHash(new TextEncoder().encode(wrapper.originalRecipeText)) !==
      KICK_CHAIN_ORIGINAL_RECIPE_SHA256
  )
    throw new Error('Original recipe hash/state mismatch');
  return freeze(record(JSON.parse(wrapper.originalRecipeText)));
}
const selections = [
  {
    id: 'S6_chain_02_front',
    side: 'L',
    first: 24,
    last: 28,
    peak: 26,
    type: 'front_heel_sole_thrust',
    region: 'left-heel-sole-hypothesis',
  },
  {
    id: 'S6_chain_04_side',
    side: 'R',
    first: 64,
    last: 68,
    peak: 66,
    type: 'lateral_heel_sole_push',
    region: 'right-heel-sole-hypothesis',
  },
  {
    id: 'S6_chain_06_crescent',
    side: 'L',
    first: 106,
    last: 118,
    peak: 113,
    type: 'inside_to_outside_high_crescent',
    region: 'left-outer-foot-edge-hypothesis',
  },
  {
    id: 'S6_chain_08_continuation',
    side: 'R',
    first: 158,
    last: 162,
    peak: 160,
    type: 'diagonal_side_like_heel_followup',
    region: 'right-heel-only-hypothesis',
  },
] as const;
export function readKickChainSource(input: KickChainSourceInput) {
  const pins = KICK_CHAIN_SOURCE_PINS;
  if (
    kickChainHash(input.sourceBytes) !== pins.sourceSha256 ||
    kickChainHash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('Kick chain source hash mismatch');
  const manifest = record(
    JSON.parse(new TextDecoder().decode(input.manifestBytes)),
  );
  if (
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5
  )
    throw new Error('Already retimed runtime one required');
  const source = record(list(manifest.clips)[12]),
    range = list(source.source_frame_range);
  if (
    source.clip !== 'KungFuKickChain4' ||
    source.primary_category !== 'kick' ||
    source.fps !== 45 ||
    range[0] !== 1 ||
    range[1] !== 191
  )
    throw new Error('Exact chain identity required');
  const binary = inspectGlb(input.sourceBytes).clips.find(
    (c) => c.name === 'KungFuKickChain4',
  );
  if (binary?.sampleTimes.length !== 191)
    throw new Error('Exact accessor union required');
  const sourceEvents = list(
    record(source.attack_and_timeline_events).attack_events,
  );
  if (sourceEvents.length !== 4)
    throw new Error('All four source events required');
  const events = selections.map((s, index) => {
    const event = record(sourceEvents[index]);
    if (
      event.event_id !== s.id ||
      event.side !== s.side ||
      event.peak_frame !== s.peak ||
      event.type !== s.type ||
      event.hit_count !== 1 ||
      JSON.stringify(event.active_frames) !== JSON.stringify([s.first, s.last])
    )
      throw new Error('Exact chain event required');
    const window = kickChainAccessorWindow(
      binary.sampleTimes,
      s.first,
      s.last,
      s.peak,
      binary.durationSeconds * 1000,
    );
    return {
      impactIndex: index,
      side: s.side,
      boneName: `foot.${s.side}`,
      sourceEventId: s.id,
      sourceType: s.type,
      peakFrame: s.peak,
      sourceFrames: [s.first, s.last] as const,
      diagnosticFrames: [s.first, s.last] as const,
      windowOrigin: 'authored-labels-developer-inclusive-cell' as const,
      surfaceOrigin:
        index === 2
          ? 'developer-hypothesis-not-source-surface'
          : 'source-named-surface/developer-geometric-hypothesis',
      sourceEventPointer: `/clips/12/attack_and_timeline_events/attack_events/${index}`,
      sourceEvent: event,
      window,
      intendedRegion: s.region,
      acceptance: null,
    };
  });
  return freeze({
    clipId: clipId('KungFuKickChain4'),
    category: 'kick' as const,
    durationMs: durationMs(binary.durationSeconds * 1000),
    sourceClipPointer: '/clips/12',
    sourceTimesSeconds: [...binary.sampleTimes],
    events,
    sourceSupport: record(source.support_contacts),
    sourceRoot: source.root_motion,
    sourcePhases: source.phases,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'KungFuKickChain4',
      sourceSha256: pins.sourceSha256,
      mode: 'in-place-posture-xyz',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/12',
        supportPointer: '/clips/12/support_contacts/support_contacts',
      },
    }),
    rootPolicyAcceptance: null,
    acceptance: null,
  });
}

export const KICK_CHAIN_DIAGNOSTIC_PINS = Object.freeze({
  candidateSha256:
    '3e0a9c27eeee97c7a56a6c1865d870c7ba58b367b7273fc836d854f473e490cb',
  recipeSha256:
    'f36a308d73cf36aa0cb6d40872792fc897dd4fd56ef59ed547e2176943361019',
});
export interface KickChainDiagnosticInput extends KickChainSourceInput {
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
export function loadKickChainDiagnostic(input: KickChainDiagnosticInput) {
  const pins = KICK_CHAIN_DIAGNOSTIC_PINS;
  if (
    kickChainHash(input.candidateBytes) !== pins.candidateSha256 ||
    kickChainHash(input.recipeBytes) !== pins.recipeSha256
  )
    throw new Error('Kick chain diagnostic hash mismatch');
  validateKickChainRecipe(input.recipeBytes);
  const descriptors = [readKickChainSource(input)];
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
        definition.category !== descriptor.category ||
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
            if (volume.kind !== 'capsule' || radiusM <= 0)
              throw new Error('Diagnostic capsule required');
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
          category: descriptor.category,
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
            (p.region !== 'heel-hypothesis' &&
              p.region !== 'sole-hypothesis' &&
              p.region !== 'left-outer-foot-edge-hypothesis') ||
            (p.coverage !== 'full' && p.coverage !== 'clipped') ||
            p.restoredLeadingRim !== false
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
            kind: 'capsule' as const,
            start: vector(seed.start),
            end: vector(seed.end),
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
