import { expect, test } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import type { BakeInput } from '../../src/assets/bakeMotion';
import type { createSourceEvaluator } from '../../src/assets/evaluateSource';
import {
  bakeMeasuredJoint,
  createMeasuredJointReceipt,
} from '../../tools/assets/measuredJointBake';
const bakeInput: BakeInput = {
  clipId: clipId('synthetic'),
  category: 'punch',
  durationMs: durationMs(100),
  sampleRateHz: 10,
  sourceTimesMs: [0, 23.456789, 100],
  impacts: [
    {
      impactIndex: 0,
      startMs: durationMs(0),
      endMs: durationMs(100),
      shapeId: 'hand',
      damageShare: 1,
    },
  ],
  ownership: [
    {
      atMs: durationMs(0),
      horizontalOwner: 'authored-root',
      verticalOwner: 'authored-root',
    },
  ],
};
function setup(limit = 5, times = [0, 23.456789, 50, 100]) {
  const calls: number[] = [];
  let closed = false,
    opened = 0;
  const factory: typeof createSourceEvaluator = async (
    _b,
    _c,
    _s,
    _p,
    execution,
  ) => {
    opened++;
    execution?.beforeUpdate({ stage: 'startup', atMs: 0 });
    return {
      surfaceSelections: [],
      sample(atMs) {
        execution?.beforeUpdate({ stage: 'sample', atMs });
        calls.push(atMs);
        return {
          root: { position: { x: 0, y: 0, z: 0 }, visualYawRad: Math.PI },
          rawRoot: { position: { x: 0, y: 0, z: 0 }, visualYawRad: Math.PI },
          shapes: [
            {
              shapeId: 'hand',
              volume: {
                kind: 'sphere',
                center: { x: 0, y: -1, z: atMs },
                radiusM: 0.1,
              },
            },
          ],
        };
      },
      dispose() {
        closed = true;
      },
    };
  };
  const receipt = createMeasuredJointReceipt(limit);
  return {
    input: {
      sourceBytes: new Uint8Array(),
      clipName: 'synthetic',
      shapes: [{ shapeId: 'hand', bone: 'hand', radiusM: 0.1 }],
      bakeInput,
      sampleTimesMs: times,
      receipt,
    },
    factory,
    calls,
    closed: () => closed,
    opened: () => opened,
  };
}
test('ascending union executes once and full X geometry survives immutable cached access', async () => {
  const state = setup();
  const result = await bakeMeasuredJoint(state.input, state.factory);
  expect(state.calls).toEqual([0, 23.456789, 50, 100]);
  expect(state.closed()).toBe(true);
  const pose = result.poses.get(23.456789);
  expect(pose?.shapes[0]?.volume).toMatchObject({
    center: { y: -1, z: 23.456789 },
  });
  expect(Object.isFrozen(pose)).toBe(true);
  expect(Object.isFrozen(pose?.shapes[0]?.volume)).toBe(true);
  expect('set' in result.poses).toBe(false);
  result.poses.get(0);
  result.poses.get(100);
  result.poses.get(0);
  expect(state.calls).toHaveLength(4);
  expect(state.input.receipt.attemptedSourceUpdates).toBe(5);
  expect(JSON.stringify(result.asset)).not.toContain('attemptedSourceUpdates');
});
test('budget rejects before an extra sample and closes known evaluator', async () => {
  const state = setup(2);
  await expect(bakeMeasuredJoint(state.input, state.factory)).rejects.toThrow(
    'budget',
  );
  expect(state.calls).toEqual([0]);
  expect(state.closed()).toBe(true);
});
test('missing bake key rejects without implicit source sample', async () => {
  const state = setup(5, [0, 100]);
  await expect(bakeMeasuredJoint(state.input, state.factory)).rejects.toThrow(
    'cache',
  );
  expect(state.calls).toEqual([0, 100]);
  expect(state.closed()).toBe(true);
});
test('duplicate or backward union is rejected before evaluator creation', async () => {
  for (const times of [
    [0, 0, 100],
    [100, 0],
  ]) {
    const state = setup(5, times);
    await expect(
      bakeMeasuredJoint(state.input, state.factory),
    ).rejects.toThrow();
    expect(state.calls).toEqual([]);
    expect(state.opened()).toBe(0);
  }
});

test('invalid zero budget is rejected before evaluator invocation', () => {
  expect(() => setup(0)).toThrow('budget');
  expect(() => setup(NaN)).toThrow('budget');
});
test('adapter retains thrown undefined when disposal also fails', async () => {
  const state = setup();
  const factory: typeof createSourceEvaluator = async (...args) => {
    const evaluator = await state.factory(...args);
    return {
      ...evaluator,
      sample() {
        throw undefined;
      },
      dispose() {
        evaluator.dispose();
        throw new Error('cleanup');
      },
    };
  };
  let failed = false,
    primary: unknown = 'unset';
  try {
    await bakeMeasuredJoint(state.input, factory);
  } catch (error) {
    failed = true;
    primary = error;
  }
  expect(failed).toBe(true);
  expect(primary).toBeUndefined();
  expect(state.closed()).toBe(true);
  expect(state.input.receipt.cleanupErrors).toHaveLength(1);
});
test('cleanup-only failure rejects rather than returning a completed artifact', async () => {
  const state = setup();
  const factory: typeof createSourceEvaluator = async (...args) => {
    const evaluator = await state.factory(...args);
    return {
      ...evaluator,
      dispose() {
        evaluator.dispose();
        throw undefined;
      },
    };
  };
  await expect(bakeMeasuredJoint(state.input, factory)).rejects.toThrow(
    AggregateError,
  );
  expect(state.closed()).toBe(true);
});
