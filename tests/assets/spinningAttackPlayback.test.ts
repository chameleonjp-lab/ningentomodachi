/** Pure playback reservation contract only. Actual playback remains unexecuted. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planSpinningAttackParity } from '../../tools/assets/bakeSpinningAttackDiagnostic';
import {
  readSpinningAttackSource,
  SPINNING_ATTACK_SOURCE_PINS,
} from '../../tools/assets/spinningAttackDiagnostic';

test('pure parity reservation keeps source public mixer and head costs separate and unapproved', () => {
  const descriptor = readSpinningAttackSource({
    sourceBytes: readFileSync(SPINNING_ATTACK_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(SPINNING_ATTACK_SOURCE_PINS.manifestPath),
  });
  const plan = planSpinningAttackParity(descriptor);
  expect(plan.timesMs).toHaveLength(177);
  expect(
    plan.sourceInitialization +
      plan.sourceSeeks +
      plan.sourceEscapeReproduction,
  ).toBe(178);
  expect(plan.publicSeekCalls).toBe(531);
  expect(plan.publicMixerUpperBound).toBe(1062);
  expect(plan.headPreparationClipLimit).toBe(42);
  expect(plan.headQueries).toBe(177);
  expect(plan.executionAuthorized).toBe(false);
  expect(plan.productionOwnershipAcceptance).toBeNull();
  expect(plan.translatedParentTest).toBe('separate release required');
  expect(Object.isFrozen(plan)).toBe(true);
});
