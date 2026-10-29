import { expect, test } from 'vitest';
import * as recipes from '../../src/assets/fightingMotionRecipes';

test('defines only source-pinned Ready0 fixed realization, never a dynamic recipe', () => {
  expect(recipes.FIGHTING_READY_REALIZATION).toBeDefined();
  const r = recipes.FIGHTING_READY_REALIZATION;
  expect(r.pose).toHaveLength(53);
  expect(new Set(r.pose.map((p) => p.name)).size).toBe(53);
  expect(r.soles.map((s) => s.members.length)).toEqual([36, 36]);
  expect(r.sourceSha256).toBe(
    '78113b6f409633a8ae127a0c4cf149e6e0db8a8f023da53693f5976ddeaac37b',
  );
  expect(r.motionMs).toBe(0);
  expect(r.productionQualified).toBe(false);
  expect(r.kind).toBe('captured-ready0-realization');
  expect(Object.isFrozen(r.pose[0]?.position)).toBe(true);
});

test('captured realization data identity matches exact JSON data rather than claiming code qualification', async () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify(recipes.FIGHTING_READY_REALIZATION),
  );
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  expect(digest).toBe(recipes.FIGHTING_READY_REALIZATION_DATA_SHA256);
});
