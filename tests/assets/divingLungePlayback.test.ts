/** Pure playback reservation contract only. Actual playback remains unexecuted. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planDivingLungeParity } from '../../tools/assets/bakeDivingLungeDiagnostic';
import {
  readDivingLungeSource,
  DIVING_LUNGE_SOURCE_PINS,
} from '../../tools/assets/divingLungeDiagnostic';

test('pure parity reservation keeps source public mixer and head costs separate and unapproved', () => {
  const descriptor = readDivingLungeSource({
    sourceBytes: readFileSync(DIVING_LUNGE_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(DIVING_LUNGE_SOURCE_PINS.manifestPath),
  });
  const plan = planDivingLungeParity(descriptor);
  expect(plan.timesMs).toHaveLength(171);
  expect(
    plan.sourceInitialization +
      plan.sourceSeeks +
      plan.sourceEscapeReproduction,
  ).toBe(173);
  expect(plan.publicSeekCalls).toBe(513);
  expect(plan.publicMixerUpperBound).toBe(1026);
  expect(plan.headPreparationClipLimit).toBe(42);
  expect(plan.headQueries).toBe(171);
  expect(plan.executionAuthorized).toBe(false);
  expect(plan.productionOwnershipAcceptance).toBeNull();
  expect(plan.translatedParentTest).toBe('separate release required');
  expect(Object.isFrozen(plan)).toBe(true);
});
