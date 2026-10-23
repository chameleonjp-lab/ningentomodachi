/** Proposed parity reservations only; no replay or source execution. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planFlyingParity } from '../../tools/assets/bakeFlyingDiagnostic';
import {
  readFlyingSource,
  FLYING_SOURCE_PINS,
} from '../../tools/assets/flyingDiagnostic';

test('pure parity reservation keeps source public mixer and head costs separate and unapproved', () => {
  const descriptor = readFlyingSource({
    sourceBytes: readFileSync(FLYING_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(FLYING_SOURCE_PINS.manifestPath),
  });
  const plan = planFlyingParity(descriptor);
  expect(plan.timesMs).toHaveLength(157);
  expect(
    plan.sourceInitialization +
      plan.sourceSeeks +
      plan.sourceEscapeReproduction,
  ).toBe(159);
  expect(plan.publicSeekCalls).toBe(471);
  expect(plan.publicMixerUpperBound).toBe(942);
  expect(plan.headPreparationClipLimit).toBe(42);
  expect(plan.headQueries).toBe(157);
  expect(plan.executionAuthorized).toBe(false);
  expect(plan.productionOwnershipAcceptance).toBeNull();
  expect(plan.translatedParentTest).toBe('separate release required');
  expect(Object.isFrozen(plan)).toBe(true);
});
