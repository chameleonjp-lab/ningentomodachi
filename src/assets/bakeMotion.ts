import {
  durationMs,
  type AttackCategory,
  type ClipId,
  type DurationMs,
  type HitVolume,
  type MotionImpact,
  type RootSample,
} from '../contracts';
import type { MotionAsset, ShapeCurve } from './motionCatalog';
export interface BakeInput {
  readonly clipId: ClipId;
  readonly category: AttackCategory;
  readonly durationMs: DurationMs;
  readonly sampleRateHz: number;
  readonly sourceTimesMs: readonly number[];
  /** Explicit annotations, never inferred from clip names. Acceptance of annotations is separate. */
  readonly impacts: readonly MotionImpact[];
  readonly ownership: MotionAsset['ownership'];
}
export interface EvaluatedPose {
  readonly root: Omit<RootSample, 'atMs'>;
  /** Actor-local geometry with root translation already removed, visual spin retained. */
  readonly shapes: readonly {
    readonly shapeId: string;
    readonly volume: HitVolume;
  }[];
}
/** Offline only. Adds fixed keys without rounding away source accessor timestamps. */
export function bakeMotion(
  input: BakeInput,
  evaluate: (atMs: DurationMs) => EvaluatedPose,
): MotionAsset {
  if (
    !Number.isFinite(input.durationMs) ||
    input.durationMs <= 0 ||
    !Number.isFinite(input.sampleRateHz) ||
    input.sampleRateHz <= 0
  )
    throw new RangeError('Invalid bake timing');
  const keys = new Set<number>([
    0,
    input.durationMs,
    ...input.sourceTimesMs,
    ...input.impacts.flatMap((i) => [i.startMs, i.endMs]),
    ...input.ownership.map((key) => key.atMs),
  ]);
  for (const key of keys)
    if (!Number.isFinite(key) || key < 0 || key > input.durationMs)
      throw new RangeError('Invalid source time');
  const count = Math.ceil((input.durationMs * input.sampleRateHz) / 1000);
  if (count > 1000000) throw new RangeError('Excessive bake resolution');
  for (let i = 1; i < count; i++) keys.add((i * 1000) / input.sampleRateHz);
  const times = [...keys].sort((a, b) => a - b);
  const rootCurve: RootSample[] = [];
  const shapes = new Map<string, ShapeCurve['keys'][number][]>();
  for (const impact of input.impacts) shapes.set(impact.shapeId, []);
  let effectiveRangeM = 0;
  for (const time of times) {
    const atMs = durationMs(time),
      pose = evaluate(atMs);
    if (
      ![
        pose.root.position.x,
        pose.root.position.y,
        pose.root.position.z,
        pose.root.visualYawRad,
      ].every(Number.isFinite)
    )
      throw new Error('Nonfinite root');
    rootCurve.push({ atMs, ...pose.root });
    for (const [shapeId, curve] of shapes) {
      const matches = pose.shapes.filter((shape) => shape.shapeId === shapeId);
      const shape = matches[0];
      if (matches.length !== 1 || !shape)
        throw new Error('Unresolved/duplicate shape');
      curve.push({ atMs, volume: shape.volume });
      // Include limiting end geometry for conservative half-open swept reach.
      if (
        input.impacts.some(
          (impact) =>
            impact.shapeId === shapeId &&
            impact.startMs <= time &&
            time <= impact.endMs,
        )
      ) {
        const volume = shape.volume;
        const points =
          volume.kind === 'sphere'
            ? [volume.center]
            : [volume.start, volume.end];
        if (!Number.isFinite(volume.radiusM) || volume.radiusM <= 0)
          throw new Error('Invalid shape radius');
        for (const point of points) {
          if (![point.x, point.y, point.z].every(Number.isFinite))
            throw new Error('Invalid shape point');
          effectiveRangeM = Math.max(
            effectiveRangeM,
            Math.hypot(
              pose.root.position.x + point.x,
              pose.root.position.z + point.z,
            ) + volume.radiusM,
          );
        }
      }
    }
  }
  return {
    definition: {
      clipId: input.clipId,
      category: input.category,
      durationMs: input.durationMs,
      effectiveRangeM,
      impacts: structuredClone(input.impacts),
      rootCurve,
      sampling: {
        version: 1,
        sampleRateHz: input.sampleRateHz,
        interpolation: 'piecewise-linear',
      },
    },
    ownership: structuredClone(input.ownership),
    shapes: [...shapes].map(([shapeId, keys]) => ({ shapeId, keys })),
  };
}
