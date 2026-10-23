/** Private, opt-in source diagnostics. Real-arithmetic model, NOT a rounded CCD certificate. */
import { Quaternion } from 'three';
import {
  durationMs,
  type DurationMs,
  type PoseClipBinding,
} from '../contracts';
import type { SourceHeadSample } from './headSurface';
import type { ClipRootPolicy } from './rootPolicy';

export interface IntervalChannel {
  readonly node: number;
  readonly property: 'translation' | 'rotation' | 'scale';
  readonly mode: 'STEP' | 'LINEAR';
  readonly times: Float32Array;
  readonly values: Float32Array;
}
export interface IntervalPlan {
  readonly binding: PoseClipBinding;
  readonly sourceSha256: string;
  readonly sourceClipIndex: number;
  readonly rootMode: ClipRootPolicy['mode'];
  readonly rootOrigin: readonly number[];
  readonly channels: readonly IntervalChannel[];
}
type Reason =
  | 'disposed'
  | 'invalid-binding'
  | 'invalid-interval'
  | 'unsupported-scope'
  | 'unsupported-layout'
  | 'unsupported-branch'
  | 'unsupported-affine'
  | 'unsupported-root-policy'
  | 'foreign-cell'
  | 'invalid-boundary'
  | 'unsupported-scale'
  | 'resource-limit'
  | 'cancelled';
type Unavailable = Readonly<{
  kind: 'unavailable';
  reason: Reason;
  resolution: 'unresolved';
}>;
export type IntervalScope =
  | 'idle-uppercut-f21-f24-v1'
  | 'pinned42-source-cells-v1';
type Segment = Readonly<{ kind: 'first-hold' | 'segment'; keyIndex: number }>;
export interface SourceHeadUnsupportedCell {
  readonly kind: 'unsupported';
  readonly binding: PoseClipBinding;
  readonly sourceSha256: string;
  readonly sourceClipIndex: number;
  readonly geometryId: string;
  readonly fromMs: DurationMs;
  readonly toMs: DurationMs;
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly reason:
    | 'unsupported-branch'
    | 'unsupported-scale'
    | 'unsupported-affine';
  readonly resolution: 'unresolved';
}
export type SourceHeadIntervalPiece =
  | SourceHeadIntervalCell
  | SourceHeadUnsupportedCell;
export interface SourceHeadIntervalCell {
  readonly kind: 'bounded';
  readonly binding: PoseClipBinding;
  readonly sourceSha256: string;
  readonly sourceClipIndex: number;
  readonly geometryId: string;
  readonly fromMs: DurationMs;
  readonly toMs: DurationMs;
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly speedMPerSourceSecond: number;
  readonly boundModel: 'real-arithmetic-source-envelope-v1';
  readonly floatingCertification: 'not-certified';
  readonly branches: readonly (
    | 'first-hold'
    | 'constant-copy'
    | 'normalized-lerp'
  )[];
  readonly endpointSemantics: 'open-interior-with-explicit-boundary-samples';
}
export type SourceHeadIntervalResult =
  | Unavailable
  | Readonly<{ kind: 'cells'; cells: readonly SourceHeadIntervalCell[] }>
  | Readonly<{ kind: 'partition'; pieces: readonly SourceHeadIntervalPiece[] }>;
type Semantics = 'canonical-point' | 'interior-limit';
export type SourceHeadBoundaryResult =
  | Unavailable
  | Readonly<{
      kind: 'transform';
      matrix: readonly number[];
      sourceSeconds: number;
      semantics: Semantics;
      numerics: 'cpu-float64-not-certified';
    }>;
export interface SourceHeadIntervalDiagnostics {
  readonly scope: IntervalScope;
  query(
    binding: PoseClipBinding,
    from: DurationMs,
    to: DurationMs,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): SourceHeadIntervalResult;
  sampleBoundary(
    cell: SourceHeadIntervalPiece,
    endpoint: 'from' | 'to',
    semantics: Semantics,
  ): SourceHeadBoundaryResult;
}
export interface IntervalValue {
  readonly node: number;
  readonly property: IntervalChannel['property'];
  readonly value: readonly number[];
}
export interface IntervalContext {
  readonly geometryId: string;
  readonly radiusM: number;
  readonly layoutSupported: boolean;
  alive(): boolean;
  resolve(binding: PoseClipBinding): IntervalPlan | undefined;
  sampleCanonical(binding: PoseClipBinding, time: DurationMs): SourceHeadSample;
  sampleValues(
    binding: PoseClipBinding,
    values: readonly IntervalValue[],
  ): SourceHeadSample;
}
const ids = [0, 1, 40, 41, 42, 51, 52] as const;
const scopes: Readonly<Record<string, readonly [string, number, number]>> =
  Object.freeze({
    Idle: Object.freeze([
      'pose-v1:40a42d3a6dfd776b19f48d7d2bcaf115e52e4e2b59c410f75e5d5ae8fc01f889',
      567.6666686534882,
      634.3333611488342,
    ] as const),
    // Ends at F24, NOT the full authored [F21,F25) active window.
    Uppercut: Object.freeze([
      'pose-v1:0702c78fa1ad60f70151008b1178bcfe74e1e8dc271127cb4861c61018536a4a',
      466.66666865348816,
      533.3333611488342,
    ] as const),
  });
const unavailable = (reason: Reason): Unavailable =>
  Object.freeze({ kind: 'unavailable', reason, resolution: 'unresolved' });
const norm = (a: readonly number[]) => Math.hypot(...a);
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((s, x, i) => s + x * required(b[i]), 0);
const subtract = (a: readonly number[], b: readonly number[]) =>
  a.map((x, i) => x - required(b[i]));
const size = (c: IntervalChannel) => (c.property === 'rotation' ? 4 : 3);
const key = (c: IntervalChannel, i: number) =>
  Array.from(c.values.slice(i * size(c), (i + 1) * size(c)));
function indexAt(c: IntervalChannel, t: number): number {
  let i = 0;
  while (i + 1 < c.times.length && required(c.times[i + 1]) <= t) i++;
  return i;
}
/** Fixed-segment branch endpoint, not Interpolant.evaluate(t +/- epsilon). */
export function channelEndpoint(
  c: IntervalChannel,
  i: number,
  t: number,
): number[] {
  const a = key(c, i);
  if (c.mode === 'STEP' || i === c.times.length - 1 || t < required(c.times[0]))
    return a;
  const b = key(c, i + 1),
    u =
      (t - required(c.times[i])) /
      (required(c.times[i + 1]) - required(c.times[i]));
  if (c.property === 'rotation') {
    const out = new Array<number>(4);
    Quaternion.slerpFlat(out, 0, a, 0, b, 0, u);
    return out;
  }
  return a.map((x, k) => x * (1 - u) + required(b[k]) * u);
}
function layout(plan: IntervalPlan, piecewise = false): boolean {
  if (
    plan.channels.length !== 21 ||
    plan.rootOrigin.length !== 3 ||
    !plan.rootOrigin.every(Number.isFinite) ||
    (plan.rootMode !== 'full-translation' &&
      plan.rootMode !== 'grounded-posture-y' &&
      plan.rootMode !== 'in-place-posture-xyz')
  )
    return false;
  for (const id of ids)
    for (const property of ['translation', 'rotation', 'scale'] as const) {
      const matches = plan.channels.filter(
        (c) => c.node === id && c.property === property,
      );
      if (matches.length !== 1) return false;
      const c = required(matches[0]);
      if (
        c.times.length < 2 ||
        c.values.length !== c.times.length * size(c) ||
        !c.values.every(Number.isFinite) ||
        !c.times.every(
          (t, i) =>
            Number.isFinite(t) && (i === 0 || t > required(c.times[i - 1])),
        )
      )
        return false;
      if (c.mode !== 'LINEAR' && c.mode !== 'STEP') return false;
      if (
        !piecewise &&
        property === 'scale' &&
        !c.values.every((v, i) => v === c.values[i % 3])
      )
        return false;
    }
  return true;
}
/** Limits are deliberate fail-closed caps, not claims about arbitrary future assets. */
function validateStage(
  plan: IntervalPlan,
  signal?: AbortSignal,
): Reason | undefined {
  if (plan.channels.length !== 21) return 'unsupported-layout';
  const cuts = new Set<number>();
  for (const c of plan.channels) {
    if (signal?.aborted) return 'cancelled';
    if (c.times.length > 512 || c.values.length > 2048) return 'resource-limit';
    if (c.times.length < 2 || c.values.length !== c.times.length * size(c))
      return 'unsupported-layout';
    if (
      !(required(c.times[0]) > 0) ||
      required(c.times.at(-1)) * 1000 !== plan.binding.durationMs
    )
      return 'unsupported-layout';
    if (c.property === 'scale' && !c.values.every((v) => v > 0))
      return 'unsupported-layout';
    for (const t of c.times) {
      cuts.add(t);
      if (cuts.size > 512) return 'resource-limit';
    }
  }
  return undefined;
}
interface Bounds {
  speed: number;
  branches: ('first-hold' | 'constant-copy' | 'normalized-lerp')[];
}
function bounds(
  plan: IntervalPlan,
  segments: readonly Segment[],
  lo: number,
  hi: number,
  radius: number,
  piecewise = false,
): Bounds | Reason {
  let rho = radius,
    speed = 0;
  const branches: Bounds['branches'] = [];
  for (const id of ids) {
    const get = (property: IntervalChannel['property']) => {
      const k = plan.channels.findIndex(
        (c) => c.node === id && c.property === property,
      );
      const segment = required(segments[k]);
      return {
        c: required(plan.channels[k]),
        i: segment.keyIndex,
        hold: segment.kind === 'first-hold',
      };
    };
    const translation = get('translation'),
      scale = get('scale'),
      rotation = get('rotation');
    const vector = ({
      c,
      i,
      hold,
    }: {
      c: IntervalChannel;
      i: number;
      hold: boolean;
    }) => {
      const a = hold ? key(c, 0) : channelEndpoint(c, i, lo),
        b = hold ? key(c, 0) : channelEndpoint(c, i, hi);
      const slope =
        hold || c.mode === 'STEP' || i === c.times.length - 1
          ? a.map(() => 0)
          : subtract(key(c, i + 1), key(c, i)).map(
              (x) => x / (required(c.times[i + 1]) - required(c.times[i])),
            );
      return { a, b, slope };
    };
    for (const { c, i, hold } of [translation, scale, rotation]) {
      if (hold) {
        if (lo < 0 || hi > required(c.times[0])) return 'unsupported-layout';
        continue;
      }
      if (
        lo < required(c.times[0]) ||
        i === c.times.length - 1 ||
        hi > required(c.times[i + 1])
      )
        return 'unsupported-layout';
      if (
        !piecewise &&
        c.mode === 'STEP' &&
        !key(c, i).every((x, k) => x === key(c, i + 1)[k])
      )
        return 'unsupported-branch';
    }
    if (
      piecewise &&
      !scale.hold &&
      scale.c.mode === 'LINEAR' &&
      !key(scale.c, scale.i).every((x, k) => x === key(scale.c, scale.i + 1)[k])
    )
      return 'unsupported-scale';
    const t = vector(translation),
      s = vector(scale),
      { c, i } = rotation;
    const a = key(c, i),
      rawB = key(c, i + 1),
      qa = dot(a, a);
    let matrixNorm: number, matrixSpeed: number;
    if (
      rotation.hold ||
      c.mode === 'STEP' ||
      a.every((x, k) => x === rawB[k])
    ) {
      matrixNorm = Math.sqrt(1 + 4 * qa * Math.max(qa - 1, 0));
      matrixSpeed = 0;
      branches.push(rotation.hold ? 'first-hold' : 'constant-copy');
    } else {
      const b = dot(a, rawB) < 0 ? rawB.map((x) => -x) : rawB,
        d = dot(a, b);
      if (d < 0.9995) return 'unsupported-branch';
      const lower = Math.sqrt(Math.min(qa, d, dot(b, b)));
      if (!(lower > 0)) return 'unsupported-branch';
      matrixNorm = 1;
      matrixSpeed =
        (2 * norm(subtract(b, a))) /
        (lower * (required(c.times[i + 1]) - required(c.times[i])));
      branches.push('normalized-lerp');
    }
    if (id === 52) {
      let extractedAxes: readonly number[];
      switch (plan.rootMode) {
        case 'full-translation':
          extractedAxes = [0, 1, 2];
          break;
        case 'grounded-posture-y':
          extractedAxes = [0, 2];
          break;
        case 'in-place-posture-xyz':
          extractedAxes = [];
          break;
        default:
          return 'unsupported-layout';
      }
      for (const k of extractedAxes) {
        t.a[k] = required(plan.rootOrigin[k]);
        t.b[k] = required(plan.rootOrigin[k]);
        t.slope[k] = 0;
      }
    }
    const scaleNorm = Math.max(...s.a.map(Math.abs), ...s.b.map(Math.abs));
    const A = matrixNorm * scaleNorm,
      D =
        matrixSpeed * scaleNorm +
        matrixNorm * Math.max(...s.slope.map(Math.abs));
    speed = A * speed + D * rho + norm(t.slope);
    rho = A * rho + Math.max(norm(t.a), norm(t.b));
  }
  return Number.isFinite(speed) && speed >= 0 && Number.isFinite(rho)
    ? { speed, branches }
    : 'unsupported-affine';
}
/** Only the provider supplies this context; public cells never expose its arrays. */
export function createHeadIntervalDiagnostics(
  context: IntervalContext,
  scope: IntervalScope = 'idle-uppercut-f21-f24-v1',
): SourceHeadIntervalDiagnostics {
  // Values contain indices, not channel buffers. The context resolves only live plans.
  const owned = new WeakMap<SourceHeadIntervalPiece, readonly Segment[]>();
  return Object.freeze({
    scope,
    query(
      binding: PoseClipBinding,
      from: DurationMs,
      to: DurationMs,
      options?: Readonly<{ signal?: AbortSignal }>,
    ): SourceHeadIntervalResult {
      const signal = options?.signal;
      if (!context.alive()) return unavailable('disposed');
      if (signal?.aborted) return unavailable('cancelled');
      const piecewise = scope === 'pinned42-source-cells-v1';
      const plan = context.resolve(binding);
      if (!plan) return unavailable('invalid-binding');
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < 0 ||
        from >= to ||
        from / 1000 >= to / 1000 ||
        (piecewise && to > binding.durationMs)
      )
        return unavailable('invalid-interval');
      const study = scopes[binding.clipId];
      if (
        !piecewise &&
        (!study ||
          binding.sourceBindingId !== study[0] ||
          from < study[1] ||
          to > study[2])
      )
        return unavailable('unsupported-scope');
      if (piecewise) {
        const validation = validateStage(plan, signal);
        if (validation) return unavailable(validation);
      }
      if (
        !context.layoutSupported ||
        !Number.isFinite(context.radiusM) ||
        context.radiusM < 0 ||
        !layout(plan, piecewise)
      )
        return unavailable('unsupported-layout');
      const lo = from / 1000,
        hi = to / 1000;
      const cuts = [
        ...new Set([
          lo,
          hi,
          ...plan.channels.flatMap((c) =>
            Array.from(c.times).filter((t) => t > lo && t < hi),
          ),
        ]),
      ].sort((a, b) => a - b);
      if (piecewise && cuts.length > 514) return unavailable('resource-limit');
      const cells: SourceHeadIntervalCell[] = [];
      const pieces: SourceHeadIntervalPiece[] = [];
      for (let j = 0; j + 1 < cuts.length; j++) {
        if (signal?.aborted) return unavailable('cancelled');
        if (!context.alive()) return unavailable('disposed');
        const a = required(cuts[j]),
          b = required(cuts[j + 1]),
          segments = Object.freeze(
            plan.channels.map(
              (c): Segment =>
                Object.freeze({
                  kind:
                    piecewise && a < required(c.times[0])
                      ? 'first-hold'
                      : 'segment',
                  keyIndex: indexAt(c, a),
                }),
            ),
          );
        const bound = bounds(plan, segments, a, b, context.radiusM, piecewise);
        const identity = {
          binding: plan.binding,
          sourceSha256: plan.sourceSha256,
          sourceClipIndex: plan.sourceClipIndex,
          geometryId: context.geometryId,
          fromMs: j === 0 ? from : durationMs(a * 1000),
          toMs: j === cuts.length - 2 ? to : durationMs(b * 1000),
          fromSeconds: a,
          toSeconds: b,
        };
        if (typeof bound === 'string') {
          if (
            !piecewise ||
            (bound !== 'unsupported-branch' &&
              bound !== 'unsupported-scale' &&
              bound !== 'unsupported-affine')
          )
            return unavailable(bound);
          const cell: SourceHeadUnsupportedCell = Object.freeze({
            ...identity,
            kind: 'unsupported',
            reason: bound,
            resolution: 'unresolved',
          });
          owned.set(cell, segments);
          pieces.push(cell);
          continue;
        }
        const cell: SourceHeadIntervalCell = Object.freeze({
          ...identity,
          kind: 'bounded',
          speedMPerSourceSecond: bound.speed,
          boundModel: 'real-arithmetic-source-envelope-v1',
          floatingCertification: 'not-certified',
          branches: Object.freeze(bound.branches),
          endpointSemantics: 'open-interior-with-explicit-boundary-samples',
        });
        owned.set(cell, segments);
        cells.push(cell);
        pieces.push(cell);
      }
      if (signal?.aborted) return unavailable('cancelled');
      if (!context.alive()) return unavailable('disposed');
      return piecewise
        ? Object.freeze({ kind: 'partition', pieces: Object.freeze(pieces) })
        : Object.freeze({ kind: 'cells', cells: Object.freeze(cells) });
    },
    sampleBoundary(
      cell: SourceHeadIntervalPiece,
      endpoint: 'from' | 'to',
      semantics: Semantics,
    ): SourceHeadBoundaryResult {
      if (!context.alive()) return unavailable('disposed');
      const segments = owned.get(cell);
      if (!segments) return unavailable('foreign-cell');
      if (
        (endpoint !== 'from' && endpoint !== 'to') ||
        (semantics !== 'canonical-point' && semantics !== 'interior-limit')
      )
        return unavailable('invalid-boundary');
      if (cell.kind === 'unsupported' && semantics === 'interior-limit')
        return unavailable(cell.reason);
      const plan = context.resolve(cell.binding);
      if (!plan) return unavailable('invalid-binding');
      const t = endpoint === 'from' ? cell.fromSeconds : cell.toSeconds;
      const result =
        semantics === 'canonical-point'
          ? context.sampleCanonical(
              cell.binding,
              endpoint === 'from' ? cell.fromMs : cell.toMs,
            )
          : context.sampleValues(
              cell.binding,
              plan.channels.map((c, k) => ({
                node: c.node,
                property: c.property,
                value:
                  required(segments[k]).kind === 'first-hold'
                    ? key(c, 0)
                    : channelEndpoint(c, required(segments[k]).keyIndex, t),
              })),
            );
      if (result.kind === 'unavailable')
        return unavailable(
          result.reason === 'invalid-time' ? 'invalid-interval' : result.reason,
        );
      return Object.freeze({ ...result, sourceSeconds: t, semantics });
    },
  });
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing interval value');
  return value;
}
