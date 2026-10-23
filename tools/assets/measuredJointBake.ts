import { bakeMotion, type BakeInput } from '../../src/assets/bakeMotion';
import {
  createSourceEvaluator,
  type EvaluatedSourcePose,
  type SourceEvaluator,
  type SourceStrikeShape,
} from '../../src/assets/evaluateSource';
import type { ClipRootPolicy } from '../../src/assets/rootPolicy';
import type { MotionAsset } from '../../src/assets/motionCatalog';
import { durationMs } from '../../src/contracts';

export interface MeasuredJointReceipt {
  readonly maxSourceUpdates: number;
  attemptedSourceUpdates: number;
  startupUpdates: number;
  sampleUpdates: number;
  rejectedUpdates: number;
  readonly attemptedTimesMs: number[];
  readonly rootQuaternionObservations: {
    stage: 'startup' | 'sample';
    atMs: number;
    quaternion: readonly [number, number, number, number];
  }[];
  readonly cleanupErrors: unknown[];
  readonly scalarYawInterpretation: 'Euler-YXZ observation; not arbitrary-axis heading';
}
export function createMeasuredJointReceipt(
  maxSourceUpdates: number,
): MeasuredJointReceipt {
  if (!Number.isSafeInteger(maxSourceUpdates) || maxSourceUpdates < 1)
    throw new RangeError('Invalid source update budget');
  return {
    maxSourceUpdates,
    attemptedSourceUpdates: 0,
    startupUpdates: 0,
    sampleUpdates: 0,
    rejectedUpdates: 0,
    attemptedTimesMs: [],
    rootQuaternionObservations: [],
    cleanupErrors: [],
    scalarYawInterpretation:
      'Euler-YXZ observation; not arbitrary-axis heading',
  };
}
function freeze<T>(value: T): T {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Nonfinite cached pose');
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function facade<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const view: ReadonlyMap<K, V> = Object.freeze({
    get size() {
      return map.size;
    },
    get: (key: K) => map.get(key),
    has: (key: K) => map.has(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    [Symbol.iterator]: () => map.entries(),
    forEach(
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ) {
      map.forEach((value, key) => {
        callback.call(thisArg, value, key, view);
      });
    },
  });
  return view;
}
export async function bakeMeasuredJoint(
  input: {
    readonly sourceBytes: Uint8Array;
    readonly clipName: string;
    readonly shapes: readonly SourceStrikeShape[];
    readonly rootPolicy?: ClipRootPolicy;
    readonly bakeInput: BakeInput;
    readonly sampleTimesMs: readonly number[];
    readonly receipt: MeasuredJointReceipt;
  },
  evaluatorFactory: typeof createSourceEvaluator = createSourceEvaluator,
): Promise<{
  asset: MotionAsset;
  poses: ReadonlyMap<number, EvaluatedSourcePose>;
  surfaceSelections: SourceEvaluator['surfaceSelections'];
}> {
  const times = [...input.sampleTimesMs],
    receipt = input.receipt;
  if (
    !times.length ||
    times.some(
      (time, index) =>
        !Number.isFinite(time) ||
        time < 0 ||
        time > input.bakeInput.durationMs ||
        (index > 0 && time <= (times[index - 1] ?? Infinity)),
    )
  )
    throw new RangeError('Invalid ascending sample union');
  if (
    !Number.isSafeInteger(receipt.maxSourceUpdates) ||
    receipt.maxSourceUpdates < 1 ||
    receipt.attemptedSourceUpdates !== 0
  )
    throw new Error('Invalid or already used source receipt');
  let evaluator: SourceEvaluator | undefined,
    primary: unknown,
    failed = false;
  let result:
    | {
        asset: MotionAsset;
        poses: ReadonlyMap<number, EvaluatedSourcePose>;
        surfaceSelections: SourceEvaluator['surfaceSelections'];
      }
    | undefined;
  const cleanupErrors: unknown[] = [];
  try {
    evaluator = await evaluatorFactory(
      input.sourceBytes,
      input.clipName,
      input.shapes,
      input.rootPolicy,
      {
        beforeUpdate(event) {
          if (receipt.attemptedSourceUpdates >= receipt.maxSourceUpdates) {
            receipt.rejectedUpdates++;
            throw new RangeError('Source update budget exceeded');
          }
          receipt.attemptedSourceUpdates++;
          receipt.attemptedTimesMs.push(event.atMs);
          if (event.stage === 'startup') receipt.startupUpdates++;
          else receipt.sampleUpdates++;
        },
        observeRootQuaternion(event) {
          receipt.rootQuaternionObservations.push(
            freeze(structuredClone(event)),
          );
        },
        recordCleanupError(error) {
          receipt.cleanupErrors.push(error);
        },
      },
    );
    const cache = new Map<number, EvaluatedSourcePose>();
    for (const time of times)
      cache.set(
        time,
        freeze(structuredClone(evaluator.sample(durationMs(time)))),
      );
    const asset = bakeMotion(input.bakeInput, (atMs) => {
      const pose = cache.get(atMs);
      if (!pose) throw new Error(`Missing exact cache key: ${atMs}`);
      return pose;
    });
    result = {
      asset,
      poses: facade(cache),
      surfaceSelections: freeze(structuredClone(evaluator.surfaceSelections)),
    };
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    if (evaluator)
      try {
        evaluator.dispose();
      } catch (error) {
        cleanupErrors.push(error);
        receipt.cleanupErrors.push(error);
      }
  }
  if (failed) throw primary;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'Measured joint cleanup failed');
  if (!result) throw new Error('Missing measured joint result');
  return result;
}
