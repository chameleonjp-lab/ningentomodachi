/** LowSweep diagnostic preparation dated 2026-10-23. No source execution authority. */
/** Proposed parity reservations only; no replay or source execution. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planLowSweepParity } from '../../tools/assets/bakeLowSweepDiagnostic';
import {
  readLowSweepSource,
  LOW_SWEEP_SOURCE_PINS,
} from '../../tools/assets/lowSweepDiagnostic';

test('pure parity reservation keeps source public mixer and head costs separate and unapproved', () => {
  const descriptor = readLowSweepSource({
    sourceBytes: readFileSync(LOW_SWEEP_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(LOW_SWEEP_SOURCE_PINS.manifestPath),
  });
  const plan = planLowSweepParity(descriptor);
  expect(plan.timesMs).toHaveLength(111);
  expect(
    plan.sourceInitialization +
      plan.sourceSeeks +
      plan.sourceEscapeReproduction,
  ).toBe(113);
  expect(plan.publicSeekCalls).toBe(333);
  expect(plan.publicMixerUpperBound).toBe(666);
  expect(plan.headPreparationClipLimit).toBe(42);
  expect(plan.headQueries).toBe(111);
  expect(plan.executionAuthorized).toBe(false);
  expect(plan.productionOwnershipAcceptance).toBeNull();
  expect(plan.translatedParentTest).toBe('separate release required');
  expect(Object.isFrozen(plan)).toBe(true);
});
