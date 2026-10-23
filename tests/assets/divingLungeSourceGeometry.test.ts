/** Preparation-only pure tests. No baker invocation, loader, mixer or posed geometry. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import {
  createDivingLungeCounter,
  createDivingLungeLifecycleReceipt,
  createDivingLungeStageBudgets,
  runDivingLungeCleanupTasks,
  runDivingLungeLifecycle,
  validateDivingLungeExecutionGate,
  DIVING_LUNGE_STAGE_LIMITS,
  planDivingLungeCandidateCalls,
  deriveDivingLungeRecipe,
} from '../../tools/assets/bakeDivingLungeDiagnostic';
import {
  readDivingLungeSource,
  DIVING_LUNGE_SOURCE_PINS,
} from '../../tools/assets/divingLungeDiagnostic';
const descriptor = () =>
  readDivingLungeSource({
    sourceBytes: readFileSync(DIVING_LUNGE_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(DIVING_LUNGE_SOURCE_PINS.manifestPath),
  });

test('pure budget charges before attempted action and never refunds a failed attempt', () => {
  const counter = createDivingLungeCounter(1);
  let attempts = 0;
  const action = () => {
    counter.charge();
    attempts++;
    throw new Error('action failed');
  };
  expect(action).toThrow('action failed');
  expect(counter.used).toBe(1);
  expect(action).toThrow('Pre-call budget');
  expect(attempts).toBe(1);
  for (const invalid of [-1, NaN, Infinity, 0.5])
    expect(() => createDivingLungeCounter(invalid)).toThrow();
});

test('pure lifecycle preserves undefined primary failure while independently attempting stop and uncache', async () => {
  const receipt = createDivingLungeLifecycleReceipt();
  const calls: string[] = [];
  const stopFailure = new Error('stop failed'),
    uncacheFailure = new Error('uncache failed');
  let caught = false;
  try {
    await runDivingLungeLifecycle(
      async () => {
        throw undefined;
      },
      () =>
        runDivingLungeCleanupTasks(
          [
            () => {
              calls.push('stop');
              throw stopFailure;
            },
            () => {
              calls.push('uncache');
              throw uncacheFailure;
            },
            () => {
              calls.push('dispose');
            },
          ],
          receipt,
        ),
      receipt,
    );
  } catch (error) {
    caught = true;
    expect(error).toBeUndefined();
  }
  expect(caught).toBe(true);
  expect(receipt.hasPrimaryFailure).toBe(true);
  expect(receipt.primaryFailure).toBeUndefined();
  expect(receipt.cleanupFailures).toEqual([stopFailure, uncacheFailure]);
  expect(calls).toEqual(['stop', 'uncache', 'dispose']);
});

test('pure cleanup-only failure rejects successful body rather than returning a candidate', async () => {
  const receipt = createDivingLungeLifecycleReceipt();
  const error = new Error('dispose');
  await expect(
    runDivingLungeLifecycle(
      async () => 'candidate',
      () => {
        throw error;
      },
      receipt,
    ),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(receipt.hasPrimaryFailure).toBe(false);
  expect(receipt.cleanupFailures).toEqual([error]);
});

test('pure candidate schedule reserves 762 attempts separately from 538 unique bake times', () => {
  const plan = planDivingLungeCandidateCalls(descriptor());
  expect(
    Object.values(DIVING_LUNGE_STAGE_LIMITS).reduce((a, b) => a + b, 0),
  ).toBe(762);
  const budgets = createDivingLungeStageBudgets();
  for (const stage of [
    'origin',
    'fit',
    'reset',
    'bake',
    'enclosure',
  ] as const) {
    expect(plan[stage]).toHaveLength(budgets[stage].limit);
    expect(Object.isFrozen(plan[stage])).toBe(true);
  }
  const bytes = Buffer.alloc(plan.enclosure.length * 8);
  plan.enclosure.forEach((time, i) => {
    bytes.writeDoubleLE(time, i * 8);
  });
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    '775c4cc2dd663273f8dd0a8ab4049bfc24d5e8faf9d858f0ca0595203f02b8c5',
  );
  expect(() =>
    validateDivingLungeExecutionGate({
      sourceExecutionReleased: false,
    } as never),
  ).toThrow(/release/);
});

test('pure recipe preserves helper provenance and right distal fist hypothesis without proxy copying', () => {
  const recipe = deriveDivingLungeRecipe(descriptor());
  expect(
    createHash('sha256').update(readFileSync(recipe.helperPath)).digest('hex'),
  ).toBe(recipe.helperSha256);
  expect(recipe.side).toBe('R');
  expect(recipe.region).toBe('distal-hand-proximal-finger-rim-hypothesis');
  expect(recipe.acceptance).toBeNull();
  expect(recipe.visualAcceptance).toBeNull();
  expect(recipe.fittedProxyCopied).toBe(false);
  expect(recipe.rootPolicy.mode).toBe('full-translation');
});
