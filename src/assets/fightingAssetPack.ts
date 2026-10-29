import {
  captureFightingActualRecipeGeometrySample,
  type FightingActualRecipeGeometrySample,
  type FightingGeometrySampleContext,
  type FightingRecipeQuery,
} from '../contracts/fighting';
import type { Vector3 } from '../contracts';

export interface FightingReadyHoldIdentity {
  readonly runId: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly holdId: string;
  readonly facingBasis: Vector3;
  readonly maxQueries: number;
  readonly maxDataNodes: number;
}
export interface FightingReadyHoldRequest {
  readonly runId: string;
  readonly actorId: string;
  readonly epochId: string;
  readonly holdId: string;
  readonly geometryBindingId: string;
  readonly fromU: number;
  readonly toU: number;
  readonly motionMs: number;
  readonly acceptedRoot: FightingRecipeQuery['acceptedRoot'];
  readonly groundClearanceM: number;
  readonly facingBasis: Vector3;
}
export type FightingReadyHoldResult =
  | {
      readonly kind: 'covered';
      readonly law: 'captured-ready-hold-constant-v1';
      readonly holdId: string;
      readonly query: FightingRecipeQuery;
      readonly request: FightingReadyHoldRequest;
      readonly context: FightingGeometrySampleContext;
      readonly sample: FightingActualRecipeGeometrySample;
      readonly derivative: 0;
      readonly completeGeometry: false;
      readonly productionQualified: false;
    }
  | {
      readonly kind: 'unqualified';
      readonly reason:
        | 'invalid-input'
        | 'unsupported-domain'
        | 'work-budget'
        | 'disposed';
    };

class InvalidHoldData extends Error {}
/** Descriptor-only, bounded detached data; never invokes getters or iterators. */
function copyData<T>(value: T, limit: number): T {
  let left = limit;
  const ancestors = new Set<object>();
  function visit(v: unknown, depth = 0): unknown {
    // Structural safety ceiling, not a geometry/numerical qualification budget.
    if (depth > 64) throw new InvalidHoldData('Data depth exceeded');
    if (--left < 0) throw new InvalidHoldData('Data budget exceeded');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object' || ancestors.has(v))
      throw new InvalidHoldData('Invalid data');
    const array = Array.isArray(v);
    if (
      Object.getPrototypeOf(v) !==
        (array ? Array.prototype : Object.prototype) ||
      Object.getOwnPropertySymbols(v).length
    )
      throw new InvalidHoldData('Nonplain data');
    ancestors.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (
      array &&
      (Object.keys(descriptors).length !== v.length + 1 || v.length > left)
    )
      throw new InvalidHoldData('Invalid array');
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of Object.keys(descriptors)) {
      if (array && key === 'length') continue;
      const d = descriptors[key];
      if (!d || !('value' in d) || !d.enumerable)
        throw new InvalidHoldData('Data property required');
      Object.defineProperty(result, key, {
        value: visit(d.value, depth + 1),
        enumerable: true,
      });
    }
    ancestors.delete(v);
    return Object.freeze(result);
  }
  return visit(value) as T;
}
function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        equal(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
function fields(v: object, keys: readonly string[]) {
  if (
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw new InvalidHoldData('Unexpected fields');
}
/** Captures a fixed realization, NOT the time-varying Ready source law.
 * Structural capture does not authenticate supplied source pins or a hold ID.
 * Caller must supply independent source authority. No production factory/binder is exposed.
 */
export function captureFightingReadyHold(
  sample: FightingActualRecipeGeometrySample,
  context: FightingGeometrySampleContext,
  identity: FightingReadyHoldIdentity,
) {
  // Read budgets by descriptor before copying; no caller getters execute.
  const budget = (key: string) => {
    const d = Object.getOwnPropertyDescriptor(identity, key);
    if (!d || !('value' in d) || !Number.isSafeInteger(d.value) || d.value <= 0)
      throw new InvalidHoldData('Explicit positive budget required');
    return d.value as number;
  };
  const maxDataNodes = budget('maxDataNodes'),
    maxQueries = budget('maxQueries');
  const captured = copyData({ sample, context, identity }, maxDataNodes);
  const c = captured.context,
    i = captured.identity;
  fields(i, [
    'runId',
    'actorId',
    'epochId',
    'holdId',
    'facingBasis',
    'maxQueries',
    'maxDataNodes',
  ]);
  for (const key of ['runId', 'actorId', 'epochId', 'holdId'] as const)
    if (typeof i[key] !== 'string' || !i[key])
      throw new InvalidHoldData('Missing identity');
  // Initial bounded domain is identity horizontal facing, neutral non-attacking, no incoming.
  if (
    !equal(i.facingBasis, { x: 0, y: 0, z: 1 }) ||
    c.query.phase !== 'neutral' ||
    c.query.posture !== 'standing' ||
    Object.hasOwn(c.query, 'incoming') ||
    c.impacts.length !== 0
  )
    throw new InvalidHoldData('Unsupported hold source');
  const s = captureFightingActualRecipeGeometrySample(captured.sample, c);
  if (s.active || s.shape !== null || s.hitShapes.length !== 0)
    throw new InvalidHoldData('Ready hold cannot carry attack geometry');
  let calls = 0,
    disposed = false;
  return Object.freeze({
    interval(input: unknown): FightingReadyHoldResult {
      if (disposed)
        return Object.freeze({ kind: 'unqualified', reason: 'disposed' });
      if (calls >= maxQueries)
        return Object.freeze({ kind: 'unqualified', reason: 'work-budget' });
      calls++;
      let q: FightingReadyHoldRequest;
      try {
        q = copyData(input, maxDataNodes) as FightingReadyHoldRequest;
        if (!q || typeof q !== 'object' || Array.isArray(q))
          throw new InvalidHoldData('Request object required');
        fields(q, [
          'runId',
          'actorId',
          'epochId',
          'holdId',
          'geometryBindingId',
          'fromU',
          'toU',
          'motionMs',
          'acceptedRoot',
          'groundClearanceM',
          'facingBasis',
        ]);
      } catch (error) {
        if (!(error instanceof InvalidHoldData)) throw error;
        return Object.freeze({ kind: 'unqualified', reason: 'invalid-input' });
      }
      const expected = {
        runId: i.runId,
        actorId: i.actorId,
        epochId: i.epochId,
        holdId: i.holdId,
        geometryBindingId: s.geometryBindingId,
        fromU: q.fromU,
        toU: q.toU,
        motionMs: c.query.atMs,
        acceptedRoot: c.query.acceptedRoot,
        groundClearanceM: c.query.groundClearanceM,
        facingBasis: i.facingBasis,
      };
      if (
        typeof q.fromU !== 'number' ||
        typeof q.toU !== 'number' ||
        q.fromU < 0 ||
        q.toU > 1 ||
        q.fromU >= q.toU ||
        !equal(q, expected)
      )
        return Object.freeze({
          kind: 'unqualified',
          reason: 'unsupported-domain',
        });
      return Object.freeze({
        kind: 'covered',
        law: 'captured-ready-hold-constant-v1',
        holdId: i.holdId,
        query: c.query,
        request: q,
        context: c,
        sample: s,
        derivative: 0,
        completeGeometry: false,
        productionQualified: false,
      });
    },
    dispose() {
      disposed = true;
    },
  });
}
