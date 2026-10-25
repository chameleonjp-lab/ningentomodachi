import type { HitVolume, Vector3 } from '../contracts';
import { add, v } from './math';

/** Provisional melee hurt proxy. Standing stays identical to the legacy capsule.
 * Kept independent of navigation/vehicle geometry so future qualified anatomy
 * cannot silently change movement or car collisions. This is not head coverage.
 */
export function combatHurt(position: Vector3, crouching = false) {
  return {
    kind: 'capsule' as const,
    start: add(position, v(0, 0.35, 0)),
    end: add(position, v(0, crouching ? 0.85 : 1.5, 0)),
    radiusM: 0.35,
  };
}

/** Explicit synthetic/gameplay model, not source-mesh or animated CCD certification.
 * Coordinates are actor-local metres; each part is linear inside one segment.
 * Adjacent segments may be discontinuous and must never be swept across a seam.
 */
export interface HurtRegionSegment {
  readonly partId: string;
  readonly from: number;
  readonly to: number;
  readonly start: HitVolume;
  readonly end: HitVolume;
}

export function validateHurtRegions(
  segments: readonly HurtRegionSegment[],
  from: number,
  to: number,
): readonly HurtRegionSegment[] {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to <= from ||
    !segments.length
  )
    throw new RangeError('Missing hurt region coverage');
  const sorted = [...segments].sort((a, b) =>
    a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : a.from - b.from,
  );
  let previous: HurtRegionSegment | undefined;
  for (const segment of sorted) {
    if (
      !segment.partId ||
      !Number.isFinite(segment.from) ||
      !Number.isFinite(segment.to) ||
      segment.to <= segment.from ||
      segment.start.kind !== segment.end.kind
    )
      throw new RangeError('Invalid hurt region segment');
    for (const shape of [segment.start, segment.end]) {
      if (shape.kind !== 'sphere' && shape.kind !== 'capsule')
        throw new RangeError('Unsupported hurt region shape');
      const points =
        shape.kind === 'sphere' ? [shape.center] : [shape.start, shape.end];
      if (
        !Number.isFinite(shape.radiusM) ||
        shape.radiusM < 0 ||
        points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
      )
        throw new RangeError('Invalid hurt region geometry');
    }
    if (previous?.partId === segment.partId) {
      if (previous.to !== segment.from)
        throw new RangeError('Gapped or overlapping hurt region coverage');
    } else {
      if (previous && previous.to < to)
        throw new RangeError('Incomplete hurt region coverage');
      if (segment.from > from)
        throw new RangeError('Incomplete hurt region coverage');
    }
    previous = segment;
  }
  if (!previous || previous.to < to)
    throw new RangeError('Incomplete hurt region coverage');
  return sorted;
}
