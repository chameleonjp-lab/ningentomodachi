import { upperBound, intervalKeyTimes } from './keyIndex';
import { capturePoseBindings } from './poseBindings';
import {
  durationMs,
  MOTION_SPACE,
  validateMotionDefinition,
  type DurationMs,
  type HitVolume,
  type MotionCatalogPort,
  type PoseCatalogBindings,
  type MotionDefinition,
  type MotionIntervalSample,
  type MotionRootSegment,
  type RootSample,
  type Vector3,
} from '../contracts';
export interface ShapeCurve {
  readonly shapeId: string;
  readonly keys: readonly {
    readonly atMs: DurationMs;
    readonly volume: HitVolume;
  }[];
}
export interface MotionAsset {
  readonly definition: MotionDefinition;
  readonly shapes: readonly ShapeCurve[];
  readonly ownership: readonly {
    readonly atMs: DurationMs;
    readonly horizontalOwner: MotionRootSegment['horizontalOwner'];
    readonly verticalOwner: MotionRootSegment['verticalOwner'];
  }[];
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const vector = (a: Vector3, b: Vector3, t: number): Vector3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});
function between<T extends { readonly atMs: DurationMs }>(
  keys: readonly T[],
  time: number,
): [T, T, number] {
  const index = upperBound(keys, time);
  const a = keys[Math.max(0, index - 1)];
  const b = keys[index] ?? a;
  if (!a || !b) throw new Error('Missing curve');
  return [a, b, a === b ? 0 : (time - a.atMs) / (b.atMs - a.atMs)];
}
function rootAt(keys: readonly RootSample[], time: DurationMs): RootSample {
  const [a, b, t] = between(keys, time);
  return {
    atMs: time,
    position: vector(a.position, b.position, t),
    visualYawRad: lerp(a.visualYawRad, b.visualYawRad, t),
  };
}
function shapeAt(curve: ShapeCurve, time: number): HitVolume {
  const [a, b, t] = between(curve.keys, time);
  if (a.volume.kind === 'sphere' && b.volume.kind === 'sphere')
    return {
      kind: 'sphere',
      center: vector(a.volume.center, b.volume.center, t),
      radiusM: lerp(a.volume.radiusM, b.volume.radiusM, t),
    };
  if (a.volume.kind === 'capsule' && b.volume.kind === 'capsule')
    return {
      kind: 'capsule',
      start: vector(a.volume.start, b.volume.start, t),
      end: vector(a.volume.end, b.volume.end, t),
      radiusM: lerp(a.volume.radiusM, b.volume.radiusM, t),
    };
  throw new Error('Shape kind changed');
}
function validVector(v: Vector3): boolean {
  return [v.x, v.y, v.z].every(Number.isFinite);
}
function validate(asset: MotionAsset): void {
  const { definition: d } = asset;
  const result = validateMotionDefinition(d);
  if (!result.valid)
    throw new Error(`Invalid motion: ${result.errors.join(',')}`);
  const shapeIds = new Set<string>();
  for (const shape of asset.shapes) {
    if (!shape.shapeId.trim() || shapeIds.has(shape.shapeId))
      throw new Error('Duplicate/empty shape');
    shapeIds.add(shape.shapeId);
    let previous = -1;
    for (const key of shape.keys) {
      const v = key.volume;
      if (
        (v.kind !== 'sphere' && v.kind !== 'capsule') ||
        !Number.isFinite(key.atMs) ||
        key.atMs <= previous ||
        key.atMs > d.durationMs ||
        !Number.isFinite(v.radiusM) ||
        v.radiusM <= 0 ||
        (v.kind === 'sphere'
          ? !validVector(v.center)
          : !validVector(v.start) || !validVector(v.end)) ||
        v.kind !== shape.keys[0]?.volume.kind
      )
        throw new Error('Invalid shape curve');
      previous = key.atMs;
    }
    if (shape.keys[0]?.atMs !== 0 || shape.keys.at(-1)?.atMs !== d.durationMs)
      throw new Error('Incomplete shape coverage');
  }
  if (d.impacts.some((impact) => !shapeIds.has(impact.shapeId)))
    throw new Error('Unresolved impact shape');
  if (asset.ownership[0]?.atMs !== 0) throw new Error('Missing root ownership');
  let previous = -1;
  for (const key of asset.ownership) {
    if (
      !Number.isFinite(key.atMs) ||
      key.atMs <= previous ||
      key.atMs >= d.durationMs ||
      !['authored-root', 'spatial-movement'].includes(key.horizontalOwner) ||
      !['authored-root', 'spatial-jump'].includes(key.verticalOwner)
    )
      throw new Error('Invalid ownership');
    previous = key.atMs;
  }
}
function sample(
  asset: MotionAsset,
  fromMs: DurationMs,
  toMs: DurationMs,
): MotionIntervalSample {
  const d = asset.definition;
  if (
    ![fromMs, toMs].every(Number.isFinite) ||
    fromMs < 0 ||
    fromMs > toMs ||
    toMs > d.durationMs
  )
    throw new RangeError('Invalid clip interval');
  const result: MotionIntervalSample = {
    clipId: d.clipId,
    fromMs,
    toMs,
    space: MOTION_SPACE,
    rootSegments: [],
    hitVolumeSegments: [],
  };
  if (fromMs === toMs) return freeze(result);
  const roots: MotionRootSegment[] = [];
  const times = intervalKeyTimes(fromMs, toMs, d.rootCurve, asset.ownership);
  for (let i = 1; i < times.length; i++) {
    const start = times[i - 1],
      end = times[i];
    if (start === undefined || end === undefined) continue;
    const from = rootAt(d.rootCurve, durationMs(start)),
      to = rootAt(d.rootCurve, durationMs(end));
    const owner = asset.ownership[upperBound(asset.ownership, start) - 1];
    if (!owner) throw new Error('Missing owner');
    roots.push({
      from,
      to,
      deltaTranslation: {
        x: to.position.x - from.position.x,
        y: to.position.y - from.position.y,
        z: to.position.z - from.position.z,
      },
      horizontalOwner: owner.horizontalOwner,
      verticalOwner: owner.verticalOwner,
      yawOwner: 'visual-only',
    });
  }
  const hits: MotionIntervalSample['hitVolumeSegments'][number][] = [];
  for (const impact of d.impacts) {
    const start = Math.max(fromMs, impact.startMs),
      end = Math.min(toMs, impact.endMs);
    if (start >= end) continue;
    const curve = asset.shapes.find(
      (shape) => shape.shapeId === impact.shapeId,
    );
    if (!curve) throw new Error('Missing shape');
    const times = intervalKeyTimes(start, end, curve.keys);
    for (let i = 1; i < times.length; i++) {
      const from = times[i - 1],
        to = times[i];
      if (from === undefined || to === undefined) continue;
      hits.push({
        impactIndex: impact.impactIndex,
        shapeId: impact.shapeId,
        fromMs: durationMs(from),
        toMs: durationMs(to),
        activeWindow: { startMs: impact.startMs, endMs: impact.endMs },
        from: shapeAt(curve, from),
        to: shapeAt(curve, to),
      });
    }
  }
  return freeze({ ...result, rootSegments: roots, hitVolumeSegments: hits });
}
/** Per-run catalog. Atomic publication only after every referenced curve passes validation. */
export function createMotionCatalog(
  load: (signal: AbortSignal) => Promise<readonly MotionAsset[]>,
  options: {
    readonly timeoutMs?: number;
    /** Read only after the same asset load completes; absent keeps explicit legacy behavior. */
    readonly poseBindings?: () => PoseCatalogBindings | undefined;
  } = {},
): MotionCatalogPort {
  const timeoutMs = options.timeoutMs ?? 30000;
  const readPoseBindings = options.poseBindings;
  let pose: PoseCatalogBindings | undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('Invalid timeout');
  let disposed = false,
    generation = 0;
  let active: AbortController | undefined;
  let assets: readonly MotionAsset[] = [];
  return {
    get pose() {
      return pose;
    },
    async prepare(signal) {
      if (disposed) throw new Error('Catalog disposed');
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const current = ++generation;
      assets = [];
      pose = undefined;
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let rejectAbort: (() => void) | undefined;
      try {
        const cancelled = new Promise<never>((_resolve, reject) => {
          rejectAbort = () => reject(new Error('Asset load aborted'));
          controller.signal.addEventListener('abort', rejectAbort, {
            once: true,
          });
          if (controller.signal.aborted) rejectAbort();
          timer = setTimeout(() => {
            reject(new Error('Asset load timeout'));
            controller.abort();
          }, timeoutMs);
        });
        const loaded = await Promise.race([
          controller.signal.aborted
            ? Promise.reject(new Error('Asset load aborted'))
            : load(controller.signal),
          cancelled,
        ]);
        if (disposed || current !== generation || controller.signal.aborted)
          throw new Error('Stale asset generation');
        const copy = structuredClone(loaded);
        const ids = new Set<string>();
        if (!copy.length) throw new Error('Empty asset catalog');
        for (const asset of copy) {
          validate(asset);
          if (ids.has(asset.definition.clipId))
            throw new Error('Duplicate clip');
          ids.add(asset.definition.clipId);
        }
        const capturedPose = readPoseBindings
          ? capturePoseBindings(readPoseBindings())
          : undefined;
        if (capturedPose) {
          const bindings = new Map(
            capturedPose.clips.map((binding) => [binding.clipId, binding]),
          );
          for (const asset of copy)
            if (
              bindings.get(asset.definition.clipId)?.durationMs !==
              asset.definition.durationMs
            )
              throw new Error('Missing or mismatched attack pose binding');
        }
        if (disposed || current !== generation || controller.signal.aborted)
          throw new Error('Stale pose binding generation');
        assets = freeze(copy);
        pose = capturedPose;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (rejectAbort)
          controller.signal.removeEventListener('abort', rejectAbort);
        if (active === controller) active = undefined;
      }
    },
    get: (id) =>
      assets.find((asset) => asset.definition.clipId === id)?.definition,
    list: () => Object.freeze(assets.map((asset) => asset.definition)),
    sampleMotion: (id, from, to) => {
      const asset = assets.find((asset) => asset.definition.clipId === id);
      return asset ? sample(asset, from, to) : undefined;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      active?.abort();
      assets = [];
      pose = undefined;
    },
  };
}
