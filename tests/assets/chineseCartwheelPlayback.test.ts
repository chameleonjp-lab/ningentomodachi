/** Committed test covers pure reservation only. Actual identity-parent playback parity
 * was executed once in external evidence, not replayed by this test. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planChineseCartwheelKickParity } from '../../tools/assets/bakeChineseCartwheelDiagnostic';
import {
  readChineseCartwheelKickSource,
  CHINESE_CARTWHEEL_SOURCE_PINS,
} from '../../tools/assets/chineseCartwheelDiagnostic';

test('pure parity reservation keeps source public mixer and head costs separate and unapproved', () => {
  const descriptor = readChineseCartwheelKickSource({
    sourceBytes: readFileSync(CHINESE_CARTWHEEL_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(CHINESE_CARTWHEEL_SOURCE_PINS.manifestPath),
  });
  const plan = planChineseCartwheelKickParity(descriptor);
  expect(plan.timesMs).toHaveLength(203);
  expect(
    plan.sourceInitialization +
      plan.sourceSeeks +
      plan.sourceEscapeReproduction,
  ).toBe(205);
  expect(plan.publicSeekCalls).toBe(609);
  expect(plan.publicMixerUpperBound).toBe(1218);
  expect(plan.headPreparationClipLimit).toBe(42);
  expect(plan.headQueries).toBe(203);
  expect(plan.executionAuthorized).toBe(false);
  expect(plan.productionOwnershipAcceptance).toBeNull();
  expect(plan.translatedParentTest).toBe('separate release required');
  expect(Object.isFrozen(plan)).toBe(true);
});
