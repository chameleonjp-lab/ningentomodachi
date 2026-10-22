import {
  AnimationClip,
  Bone,
  InterpolateLinear,
  NormalAnimationBlendMode,
  type Object3D,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { artifactRecord } from './skinBoundsArtifact';

export interface DeathClipArtifact {
  readonly algorithm: 'articulated-death-500ms-v1';
  readonly clips: readonly {
    readonly name: string;
    readonly duration: number;
    readonly tracks: readonly {
      readonly name: string;
      readonly type: string;
      readonly interpolation: number;
      readonly times: readonly (number | '-0')[];
      readonly values: readonly (number | '-0')[];
    }[];
  }[];
}
/** UUIDs are intentionally absent: this is a deterministic exact FLOAT track artifact. */
export function exportDeathClipArtifact(
  clips: readonly AnimationClip[],
): DeathClipArtifact {
  return {
    algorithm: 'articulated-death-500ms-v1',
    clips: clips.map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map((track) => ({
        name: track.name,
        type: track.ValueTypeName,
        interpolation: track.getInterpolation(),
        times: Array.from(track.times, (value) =>
          Object.is(value, -0) ? ('-0' as const) : value,
        ),
        values: Array.from(track.values, (value) =>
          Object.is(value, -0) ? ('-0' as const) : value,
        ),
      })),
    })),
  };
}
function floats(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length)
    throw new Error('Invalid death artifact FLOAT values');
  const result: number[] = [];
  for (const raw of value) {
    // JSON numbers alone lose the FLOAT sign bit of zero.
    const number = raw === '-0' ? -0 : raw;
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      Math.fround(number) !== number
    )
      throw new Error('Invalid death artifact FLOAT values');
    result.push(number);
  }
  return result;
}
export async function importDeathClipArtifact(
  data: unknown,
  checkpoint: () => Promise<void>,
): Promise<readonly AnimationClip[]> {
  const payload = artifactRecord(data);
  if (
    payload.algorithm !== 'articulated-death-500ms-v1' ||
    !Array.isArray(payload.clips) ||
    payload.clips.length !== 2
  )
    throw new Error('Invalid death artifact clips');
  const clips: AnimationClip[] = [],
    names = new Set(['DefeatPunch', 'DefeatKick']);
  for (const raw of payload.clips) {
    const clip = artifactRecord(raw);
    if (
      typeof clip.name !== 'string' ||
      !names.delete(clip.name) ||
      clip.duration !== 0.5 ||
      !Array.isArray(clip.tracks) ||
      clip.tracks.length !== 158
    )
      throw new Error('Invalid death artifact identity');
    const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = [],
      trackNames = new Set<string>();
    for (const rawTrack of clip.tracks) {
      const track = artifactRecord(rawTrack);
      if (
        typeof track.name !== 'string' ||
        trackNames.has(track.name) ||
        track.interpolation !== InterpolateLinear ||
        (track.type !== 'quaternion' && track.type !== 'vector') ||
        !Array.isArray(track.times) ||
        (track.times.length !== 2 && track.times.length !== 121)
      )
        throw new Error('Invalid death artifact track');
      trackNames.add(track.name);
      const suffix = track.name.slice(track.name.lastIndexOf('.') + 1);
      if (
        (track.type === 'quaternion' && suffix !== 'quaternion') ||
        (track.type === 'vector' && suffix !== 'position' && suffix !== 'scale')
      )
        throw new Error('Invalid death artifact binding');
      const times = floats(track.times, track.times.length),
        size = track.type === 'quaternion' ? 4 : 3;
      const values = floats(track.values, times.length * size);
      if (
        times[0] !== 0 ||
        times.at(-1) !== 0.5 ||
        times.some((time, i) => i > 0 && time <= (times[i - 1] ?? Infinity))
      )
        throw new Error('Invalid death artifact sampling');
      if (size === 4)
        for (let i = 0; i < values.length; i += 4)
          if (Math.abs(Math.hypot(...values.slice(i, i + 4)) - 1) > 1e-5)
            throw new Error('Invalid death artifact quaternion');
      tracks.push(
        track.type === 'quaternion'
          ? new QuaternionKeyframeTrack(track.name, times, values)
          : new VectorKeyframeTrack(track.name, times, values),
      );
      if (tracks.length % 16 === 0) await checkpoint();
    }
    clips.push(
      new AnimationClip(clip.name, 0.5, tracks, NormalAnimationBlendMode),
    );
  }
  return clips;
}
/** Exact canonical track coverage, not permissive engine property-path parsing. */
export function verifyDeathClipTargets(
  root: Object3D,
  clips: readonly AnimationClip[],
): void {
  const expected = new Map<string, number>();
  root.traverse((node) => {
    if (!(node instanceof Bone)) return;
    if (expected.has(`${node.name}.quaternion`))
      throw new Error('Duplicate death artifact bone');
    expected.set(`${node.name}.quaternion`, 121);
    expected.set(`${node.name}.scale`, 2);
    if (node.name !== 'root')
      expected.set(`${node.name}.position`, node.name === 'pelvis' ? 121 : 2);
  });
  if (expected.size !== 158)
    throw new Error('Incompatible canonical death skeleton');
  for (const clip of clips) {
    const targets = new Map(expected);
    for (const track of clip.tracks) {
      if (targets.get(track.name) !== track.times.length)
        throw new Error('Unknown or mismatched death artifact bone track');
      targets.delete(track.name);
    }
    if (targets.size)
      throw new Error('Incomplete death artifact bone coverage');
  }
}
