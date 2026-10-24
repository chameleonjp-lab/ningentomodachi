/** Offline raw metadata only. Never loads/poses an actor or accepts collision geometry. */
import { createHash } from 'node:crypto';
import { copyRootPolicy } from '../../src/assets/rootPolicy';
import { inclusiveAccessorFrameWindow } from './annotationPolicy';

export const CARTWHEEL_KICK_SOURCE_PINS = Object.freeze({
  sourcePath:
    'assets/android/motions/completed42-speed15/kick/android_kick.glb',
  manifestPath: 'assets/android/motions/completed42-speed15/kick/manifest.json',
  sourceSha256:
    '697eb9cfc9dbfd353b6257659bb3d4132b1b0c9cd67e0612581549a5ac862afd',
  manifestSha256:
    'f0e69488d0a2b72fb4cf00cf4cbba1f36b643a6450056458c50e4dd974bfdeed',
});
const nativeTimesHash =
  'f7ed2b2dad18130a46c367605595063afc2c63073b14e30a788fb3a6a6c68f85';
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
export function validateCartwheelKickAccessorTimes(times: readonly number[]) {
  if (
    times.length !== 91 ||
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
      strikes: {
        limb: string;
        frame: number;
        type: string;
        window?: unknown;
      }[];
    };
    phases: { phases: { name: string; frames: number[] }[] };
    root_motion: Record<string, unknown>;
    support_contacts: {
      contacts: {
        limb: string;
        frames: number[];
        armature_wrist_target: number[];
      }[];
    };
  }[];
}
export function readCartwheelKickSource(input: {
  readonly sourceBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}) {
  const pins = CARTWHEEL_KICK_SOURCE_PINS;
  if (
    input.sourceBytes.byteLength !== 5685720 ||
    input.manifestBytes.byteLength !== 75327 ||
    hash(input.sourceBytes) !== pins.sourceSha256 ||
    hash(input.manifestBytes) !== pins.manifestSha256
  )
    throw new Error('CartwheelKick source hash mismatch');
  // Typed JSON is safe only after both complete immutable original byte pins pass.
  const manifest = JSON.parse(
    new TextDecoder().decode(input.manifestBytes),
  ) as SourceManifest;
  const source = manifest.clips[7];
  const event = source?.attack_and_timeline_events.strikes[0];
  const phase = source?.phases.phases[3];
  if (
    !source ||
    !event ||
    !phase ||
    manifest.runtime_playback_speed !== 1 ||
    manifest.baked_speed_multiplier !== 1.5 ||
    source.clip !== 'CartwheelKick' ||
    source.primary_category !== 'kick' ||
    source.loop !== false ||
    source.fps !== 45 ||
    JSON.stringify(source.source_frame_range) !== '[1,91]' ||
    source.attack_and_timeline_events.strikes.length !== 1 ||
    event.limb !== 'foot.L' ||
    event.frame !== 66 ||
    event.type !== 'lateral exit kick' ||
    Object.hasOwn(event, 'window') ||
    phase.name !== 'kick impact' ||
    JSON.stringify(phase.frames) !== '[59,68]'
  )
    throw new Error('Exact source event and separate phase required');
  const bytes = input.sourceBytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as SourceDocument;
  const animation = document.animations[7];
  if (
    !animation ||
    animation.name !== 'CartwheelKick' ||
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
  const sourceTimesSeconds = accessor(514).values.map(
    (row) => row[0] as number,
  );
  validateCartwheelKickAccessorTimes(sourceTimesSeconds);
  const durationMs = (sourceTimesSeconds[90] as number) * 1000;
  const rotation = accessor(516),
    translation = accessor(515);
  if (
    rotation.rawSha256 !==
      '3babf3d6af904d9dae59cd2d39a667bc5f54a8caed2122667d4a84bf7e240341' ||
    translation.rawSha256 !==
      '123dafeeb371035c3fa0f269b96fad4112ee9b65fa034cf05547301763bd0031'
  )
    throw new Error('Root accessor hash mismatch');
  let unwrappedZRollRad = 0;
  for (const q of rotation.values) {
    if (q[0] !== 0 || q[1] !== 0) throw new Error('Pinned Z roll required');
    let angle = 2 * Math.atan2(q[2] as number, q[3] as number);
    while (angle - unwrappedZRollRad > Math.PI) angle -= 2 * Math.PI;
    while (angle - unwrappedZRollRad < -Math.PI) angle += 2 * Math.PI;
    unwrappedZRollRad = angle;
  }
  return freeze({
    clipId: 'CartwheelKick' as const,
    sourceClipPointer: '/clips/7',
    sourcePins: pins,
    acceptance: null,
    gameplayAllowance: null,
    durationMs,
    sourceTimesSeconds,
    timeProvenance: {
      animationPointer: '/animations/7',
      fullTimeAccessorPointer: '/accessors/514',
      endpointAccessorPointer: '/accessors/517',
      nativeTimesSha256: nativeTimesHash,
      manifestSeconds: source.seconds,
    },
    events: [
      {
        impactIndex: 0,
        boneName: 'foot.L' as const,
        peakFrame: 66,
        sourceFrames: null,
        diagnosticFrames: [59, 68] as const,
        windowOrigin: 'developer-provisional-phase-derived' as const,
        sourcePhasePointer: '/clips/7/phases/phases/3',
        sourceEventPointer: '/clips/7/attack_and_timeline_events/strikes/0',
        sourceEvent: event,
        acceptance: null,
        window: inclusiveAccessorFrameWindow({
          sourceStartFrame: 1,
          sourceEndFrame: 91,
          fps: 45,
          firstFrame: 59,
          lastFrame: 68,
          peakFrame: 66,
          accessorTimesSeconds: sourceTimesSeconds,
          durationMs,
        }),
      },
    ],
    sourceRoot: source.root_motion,
    sourceSupport: source.support_contacts,
    sourcePhases: source.phases,
    supportValidation: 'unverified-metadata-only' as const,
    rootPolicy: copyRootPolicy({
      version: 1,
      clipId: 'CartwheelKick',
      sourceSha256: pins.sourceSha256,
      mode: 'full-translation',
      provenance: {
        manifestSha256: pins.manifestSha256,
        clipPointer: '/clips/7',
        supportPointer: '/clips/7/support_contacts',
      },
    }),
    nativeRootRotation: {
      accessorPointer: '/accessors/516',
      rawSha256: rotation.rawSha256,
      quaternions: rotation.values,
      unwrappedZRollRad,
      rollIsNotYaw: true,
    },
    nativeRootTranslation: {
      accessorPointer: '/accessors/515',
      rawSha256: translation.rawSha256,
      positions: translation.values,
    },
    nativeChannels,
    nativeNodes: document.nodes,
  });
}
