/** Offline raw metadata only. Never loads/poses an actor or accepts collision geometry. */
import { createHash } from 'node:crypto';
import { copyRootPolicy } from '../../src/assets/rootPolicy';

export const KUNG_FU_ACROBATIC_COMBO_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
const nativeTimesHash =
  'd824e865aa044308a10ce468d1ac1e454e61e1c66d6fd4713de404890c19b53e';
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function validateKungFuAcrobaticComboAccessorTimes(
  times: readonly number[],
) {
  if (
    times.length !== 208 ||
    times.some(
      (time, i) =>
        !Number.isFinite(time) ||
        time !== Math.fround(time) ||
        time <= 0 ||
        (i > 0 && time <= (times[i - 1] ?? Infinity)),
    )
  )
    throw new Error('Exact ordered native float32 times required');
  const bytes = new Uint8Array(times.length * 4);
  const view = new DataView(bytes.buffer);
  times.forEach((time, i) => {
    view.setFloat32(i * 4, time, true);
  });
  if (hash(bytes) !== nativeTimesHash)
    throw new Error('Native accessor hash mismatch');
}
interface SourceDocument {
  accessors: {
    componentType: number;
    count: number;
    type: string;
    bufferView: number;
    byteOffset?: number;
    sparse?: unknown;
  }[];
  bufferViews: {
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    buffer: number;
  }[];
  animations: {
    name: string;
    channels: { sampler: number; target: { node: number; path: string } }[];
    samplers: { input: number; output: number; interpolation: string }[];
  }[];
  nodes: ({ name?: string } & Record<string, unknown>)[];
}
interface SourceManifest {
  runtime_playback_speed: number;
  baked_speed_multiplier: number;
  clips: {
    clip: string;
    primary_category: string;
    loop: boolean;
    fps: number;
    source_frame_range: number[];
    seconds: number;
    attack_and_timeline_events: {
      attacks: {
        limb: string;
        peak_frame: number;
        type: string;
        window?: unknown;
      }[];
    };
    phases: {
      phases: { phase: string; frames: number[] }[];
      airborne_intervals: number[][];
    };
    root_motion: Record<string, unknown>;
    support_contacts: Record<string, unknown>;
  }[];
}
const definitions = [
  {
    impactId: 'kung-fu-acrobatic-flying-forward-right',
    peakFrame: 40,
    frames: [27, 53],
    phaseIndex: 2,
    phase: 'flying kick',
    type: 'flying forward kick',
  },
  {
    impactId: 'kung-fu-acrobatic-aerial-crescent-right',
    peakFrame: 94,
    frames: [79, 106],
    phaseIndex: 4,
    phase: 'spinning kick',
    type: 'aerial crescent spinning kick',
  },
  {
    impactId: 'kung-fu-acrobatic-twist-follow-right',
    peakFrame: 140,
    frames: [135, 153],
    phaseIndex: 6,
    phase: 'follow kick',
    type: 'twist follow kick',
  },
] as const;
export function readKungFuAcrobaticComboSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = KUNG_FU_ACROBATIC_COMBO_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('KungFuAcrobaticCombo source hash mismatch');
  // Typed JSON is safe only after both complete immutable original byte pins pass.
  const manifest = JSON.parse(
    new TextDecoder().decode(input.manifestBytes),
  ) as SourceManifest;
  const source = manifest.clips[18];
  if (
    !source ||
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    source.clip !== 'KungFuAcrobaticCombo' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,208]' ||
    source.attack_and_timeline_events.attacks.length !== 3 ||
    JSON.stringify(source.phases.airborne_intervals) !==
      '[[27,53],[79,105],[117,153]]' ||
    definitions.some((d, i) => {
      const e = source.attack_and_timeline_events.attacks[i],
        p = source.phases.phases[d.phaseIndex];
      return (
        !e ||
        !p ||
        e.limb !== 'foot.R' ||
        e.peak_frame !== d.peakFrame ||
        e.type !== d.type ||
        Object.hasOwn(e, 'window') ||
        p.phase !== d.phase ||
        JSON.stringify(p.frames) !== JSON.stringify(d.frames)
      );
    })
  )
    throw new Error('Exact three source events and separate phases required');
  const bytes = input.sourceBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as SourceDocument;
  const animation = document.animations[18];
  if (
    !animation ||
    animation.name !== 'KungFuAcrobaticCombo' ||
    animation.channels.length !== 159
  )
    throw new Error('Pinned animation required');
  const accessor = (index: number) => {
    const a = document.accessors[index];
    if (!a || a.componentType !== 5126 || a.sparse)
      throw new Error('Dense float32 accessor required');
    const width =
      a.type === 'SCALAR'
        ? 1
        : a.type === 'VEC3'
          ? 3
          : a.type === 'VEC4'
            ? 4
            : 0;
    const bv = document.bufferViews[a.bufferView];
    if (!width || !bv || bv.buffer !== 0)
      throw new Error('Pinned accessor view required');
    const relativeOffset = a.byteOffset ?? 0;
    const stride = bv.byteStride ?? width * 4;
    const offset = 28 + jsonLength + (bv.byteOffset ?? 0) + relativeOffset;
    if (
      stride < width * 4 ||
      relativeOffset + (a.count - 1) * stride + width * 4 > bv.byteLength
    )
      throw new Error('Accessor bounds');
    const packed = new Uint8Array(a.count * width * 4);
    const values = Array.from({ length: a.count }, (_, row) => {
      packed.set(
        bytes.subarray(
          offset + row * stride,
          offset + row * stride + width * 4,
        ),
        row * width * 4,
      );
      return Array.from({ length: width }, (_, column) =>
        view.getFloat32(offset + row * stride + column * 4, true),
      );
    });
    return { values, rawSha256: hash(packed) };
  };
  const nativeChannels = animation.channels.map((channel) => {
    const sampler = animation.samplers[channel.sampler];
    if (!sampler) throw new Error('Native sampler required');
    const output = accessor(sampler.output);
    return {
      nodeIndex: channel.target.node,
      nodeName: document.nodes[channel.target.node]?.name,
      path: channel.target.path,
      interpolation: sampler.interpolation,
      inputAccessor: sampler.input,
      outputAccessor: sampler.output,
      timesSeconds: accessor(sampler.input).values.map(
        (row) => row[0] as number,
      ),
      values: output.values,
      rawSha256: output.rawSha256,
    };
  });
  const sourceTimesSeconds = accessor(3402).values.map(
    (row) => row[0] as number,
  );
  validateKungFuAcrobaticComboAccessorTimes(sourceTimesSeconds);
  const durationMs = (sourceTimesSeconds[207] as number) * 1000;
  const rotation = accessor(3404),
    translation = accessor(3403);
  if (
    rotation.rawSha256 !==
      '056c20a76415d51e65eb1e246b51f8fded24743c1a533289cfdb3034102bcf6e' ||
    translation.rawSha256 !==
      'ffdfc66f8f715eaf8d7f86a6db80679884050f146fdeb2a7b46e520284c1e64c'
  )
    throw new Error('Root accessor hash mismatch');
  return freeze({
    clipId: 'KungFuAcrobaticCombo' as const,
    sourceClipPointer: '/clips/18',
    sourcePins: pins,
    acceptance: null,
    model: null,
    geometryPolicy: 'unresolved-no-helper-or-whole-foot-assumption' as const,
    gameplayAllowance: null,
    durationMs,
    sourceTimesSeconds,
    timeProvenance: {
      animationPointer: '/animations/18',
      fullTimeAccessorPointer: '/accessors/3402',
      endpointAccessorPointer: '/accessors/3405',
      nativeTimesSha256: nativeTimesHash,
      manifestSeconds: source.seconds,
    },
    // Complete clock hash pins integer-frame correspondence. The shared helper's
    // fixed 2e-7 tolerance rejects this original at frame187 (3.0783e-7).
    // Preserve every original float32 value; do not trim, reconstruct or round it.
    events: definitions.map((definition, impactIndex) => ({
      impactId: definition.impactId,
      impactIndex,
      boneName: 'foot.R' as const,
      peakFrame: definition.peakFrame,
      sourceFrames: null,
      diagnosticFrames: definition.frames,
      windowOrigin: 'developer-provisional-phase-derived' as const,
      sourcePhasePointer: `/clips/18/phases/phases/${definition.phaseIndex}`,
      sourceEventPointer: `/clips/18/attack_and_timeline_events/attacks/${impactIndex}`,
      sourceEvent: source.attack_and_timeline_events.attacks[impactIndex]!,
      acceptance: null,
      window: {
        policy: 'inclusive-accessor-frame-cells-v1' as const,
        acceptance: 'provisional-policy' as const,
        startMs: sourceTimesSeconds[definition.frames[0] - 1]! * 1000,
        peakMs: sourceTimesSeconds[definition.peakFrame - 1]! * 1000,
        endMs: sourceTimesSeconds[definition.frames[1]]! * 1000,
        initialHoldEndMs: sourceTimesSeconds[0]! * 1000,
      },
    })),
    sourceRoot: source.root_motion,
    sourceSupport: source.support_contacts,
    sourcePhases: source.phases,
    supportValidation: 'unverified-metadata-only' as const,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'KungFuAcrobaticCombo',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/18',
        supportPointer: '/clips/18/support_contacts',
      },
    }),
    nativeRootRotation: {
      accessorPointer: '/accessors/3404',
      rawSha256: rotation.rawSha256,
      quaternions: rotation.values,
      fullQuaternionRequired: true,
      authoredYawIsNotReconstruction: true,
    },
    nativeRootTranslation: {
      accessorPointer: '/accessors/3403',
      rawSha256: translation.rawSha256,
      positions: translation.values,
    },
    nativeChannels,
    nativeNodes: document.nodes,
  });
}
