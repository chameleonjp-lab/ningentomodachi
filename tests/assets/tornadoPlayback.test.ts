/** Reconstruction dated 2026-10-23T21:17Z from published main e69c98aa.
 * New unverified implementation, not recovered historical Tornado bytes or test evidence. */
/** Proposed parity reservations only; no replay or source execution. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { planTornadoParity } from '../../tools/assets/bakeTornadoDiagnostic';
import {
  readTornadoSource,
  TORNADO_SOURCE_PINS,
} from '../../tools/assets/tornadoDiagnostic';

test('pure parity reservation keeps source public mixer and head costs separate and unapproved', () => {
  const descriptor = readTornadoSource({
    sourceBytes: readFileSync(TORNADO_SOURCE_PINS.sourcePath),
    manifestBytes: readFileSync(TORNADO_SOURCE_PINS.manifestPath),
  });
  const plan = planTornadoParity(descriptor);
  expect(plan.timesMs).toHaveLength(201);
  expect(
    plan.sourceInitialization +
      plan.sourceSeeks +
      plan.sourceEscapeReproduction,
  ).toBe(203);
  expect(plan.publicSeekCalls).toBe(603);
  expect(plan.publicMixerUpperBound).toBe(1206);
  expect(plan.headPreparationClipLimit).toBe(42);
  expect(plan.headQueries).toBe(201);
  expect(plan.executionAuthorized).toBe(false);
  expect(plan.productionOwnershipAcceptance).toBeNull();
  expect(plan.translatedParentTest).toBe('separate release required');
  expect(Object.isFrozen(plan)).toBe(true);
});
