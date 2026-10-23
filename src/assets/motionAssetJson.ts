import {
  clipId,
  durationMs,
  type HitVolume,
  type Vector3,
  validateMotionDefinition,
} from '../contracts';
import type { MotionAsset } from './motionCatalog';

function fail(): never {
  throw new Error('Invalid MotionAsset JSON record');
}
/** Capture only own data properties, never invoke ordinary accessors. */
function captureRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail();
  const descriptors: Record<string, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.some((key) => typeof key !== 'string')) return fail();
  const captured: Record<string, unknown> = Object.create(null);
  for (const key of actual as string[]) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail();
    captured[key] = descriptor.value;
  }
  return captured;
}
function exactKeys(
  captured: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const actual = Object.keys(captured);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    return fail();
  return captured;
}
function record(value: unknown, keys: readonly string[]) {
  return exactKeys(captureRecord(value), keys);
}
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail();
  const descriptors: Record<string, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length;
  if (
    !length ||
    !Object.hasOwn(length, 'value') ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0
  )
    return fail();
  const count = length.value as number;
  if (Reflect.ownKeys(descriptors).length !== count + 1) return fail();
  const captured: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail();
    captured.push(descriptor.value);
  }
  return captured;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return fail();
  return value;
}
function choice<const T extends readonly (string | number)[]>(
  value: unknown,
  choices: T,
): T[number] {
  if (!choices.some((option) => option === value)) return fail();
  return value as T[number];
}
function vector(value: unknown): Vector3 {
  const v = record(value, ['x', 'y', 'z']);
  return { x: number(v.x), y: number(v.y), z: number(v.z) };
}
function volume(value: unknown): HitVolume {
  const captured = captureRecord(value);
  if (captured.kind === 'sphere') {
    const v = exactKeys(captured, ['kind', 'center', 'radiusM']);
    return {
      kind: 'sphere',
      center: vector(v.center),
      radiusM: number(v.radiusM),
    };
  }
  if (captured.kind === 'capsule') {
    const v = exactKeys(captured, ['kind', 'start', 'end', 'radiusM']);
    return {
      kind: 'capsule',
      start: vector(v.start),
      end: vector(v.end),
      radiusM: number(v.radiusM),
    };
  }
  return fail();
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}
/**
 * Decode only an existing diagnostic/metadata asset member, never its envelope.
 * The caller retains status, provenance, root-policy and qualification evidence.
 * This is a representation/definition check, not source authentication or admission.
 * Shape-curve and ownership relations still require createMotionCatalog.prepare.
 * Input is already-materialized plain JSON data; no hostile-Proxy, byte/size-budget
 * or allocation-failure guarantee is made. Values are copied without normalization.
 */
export function decodeMotionAssetJson(value: unknown): MotionAsset {
  const a = record(value, ['definition', 'shapes', 'ownership']);
  const d = record(a.definition, [
    'clipId',
    'category',
    'durationMs',
    'effectiveRangeM',
    'impacts',
    'rootCurve',
    'sampling',
  ]);
  const s = record(d.sampling, ['version', 'sampleRateHz', 'interpolation']);
  const asset: MotionAsset = {
    definition: {
      clipId: clipId(text(d.clipId)),
      category: choice(d.category, ['punch', 'kick']),
      durationMs: durationMs(number(d.durationMs)),
      effectiveRangeM: number(d.effectiveRangeM),
      impacts: list(d.impacts).map((value) => {
        const i = record(value, [
          'impactIndex',
          'startMs',
          'endMs',
          'damageShare',
          'shapeId',
        ]);
        return {
          impactIndex: number(i.impactIndex),
          startMs: durationMs(number(i.startMs)),
          endMs: durationMs(number(i.endMs)),
          damageShare: number(i.damageShare),
          shapeId: text(i.shapeId),
        };
      }),
      rootCurve: list(d.rootCurve).map((value) => {
        const r = record(value, ['atMs', 'position', 'visualYawRad']);
        return {
          atMs: durationMs(number(r.atMs)),
          position: vector(r.position),
          visualYawRad: number(r.visualYawRad),
        };
      }),
      sampling: {
        version: choice(s.version, [1]),
        sampleRateHz: number(s.sampleRateHz),
        interpolation: choice(s.interpolation, ['piecewise-linear']),
      },
    },
    shapes: list(a.shapes).map((value) => {
      const s = record(value, ['shapeId', 'keys']);
      return {
        shapeId: text(s.shapeId),
        keys: list(s.keys).map((value) => {
          const k = record(value, ['atMs', 'volume']);
          return { atMs: durationMs(number(k.atMs)), volume: volume(k.volume) };
        }),
      };
    }),
    ownership: list(a.ownership).map((value) => {
      const o = record(value, ['atMs', 'horizontalOwner', 'verticalOwner']);
      return {
        atMs: durationMs(number(o.atMs)),
        horizontalOwner: choice(o.horizontalOwner, [
          'authored-root',
          'spatial-movement',
        ]),
        verticalOwner: choice(o.verticalOwner, [
          'authored-root',
          'spatial-jump',
        ]),
      };
    }),
  };
  const result = validateMotionDefinition(asset.definition);
  if (!result.valid)
    throw new Error(
      `Invalid MotionAsset definition: ${result.errors.join(',')}`,
    );
  return freeze(asset);
}
