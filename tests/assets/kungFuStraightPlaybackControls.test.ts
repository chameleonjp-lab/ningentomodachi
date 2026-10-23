import { expect, test } from 'vitest';
import { actorId, attackActivationId, impactId } from '../../src/contracts';
import {
  deferredAssertions,
  diagnosticPatch,
  distinctImpactSources,
  extractedXZ,
  retainedPosture,
  transportedXZ,
} from '../integration/fixtures/kungFuStraightAttribution';

test('single impact remains event-bound with no invented extra impacts', () => {
  const bindings = [{ impactIndex: 0, impactId: impactId('event-0') }];
  expect(
    distinctImpactSources(actorId('white'), attackActivationId('a'), bindings),
  ).toHaveLength(1);
  expect(() =>
    distinctImpactSources(actorId('white'), attackActivationId('a'), []),
  ).toThrow();
});
test('grounded XZ extracted once retains original Y and reconstructs native position', () => {
  const origin = { x: 0, y: -0.19, z: 0 };
  const raw = { x: 0.01, y: -0.215, z: 0.073 };
  const delta = extractedXZ(raw, origin);
  const posture = retainedPosture(raw, origin);
  expect(delta).toEqual({ x: 0.01, y: 0, z: 0.073 });
  expect(posture).toEqual({ x: 0, y: -0.215, z: 0 });
  expect({
    x: posture.x + delta.x,
    y: posture.y,
    z: posture.z + delta.z,
  }).toEqual(raw);
  expect(
    transportedXZ({ x: 5, y: 0, z: 8 }, { x: 0, y: 0, z: 1 }, delta),
  ).toEqual({ x: 5.01, y: 0, z: 8.073 });
  expect(
    transportedXZ({ x: 5, y: 0, z: 8 }, { x: 1, y: 0, z: 0 }, delta),
  ).toEqual({ x: 5.073, y: 0, z: 7.99 });
});
test('record-before-assertion preserves snapshots, unrelated failures stay fatal', () => {
  const checks: (() => void)[] = [];
  const check = deferredAssertions(checks);
  const raw = { advance: 0.073 };
  check(raw).toEqual({ advance: 0.073 });
  raw.advance = 0;
  checks[0]!();
  expect(() =>
    diagnosticPatch(() => {
      throw new Error('C failed');
    }),
  ).toThrow('C failed');
});

import { fixedWallPoint } from '../integration/fixtures/kungFuStraightAttribution';

test('wall metric distinguishes inside thin solid, beyond face, and outside cross section', () => {
  const wall = { min: { x: -5, y: 0, z: 1.99 }, max: { x: 5, y: 4, z: 2.01 } };
  expect(fixedWallPoint({ x: 0, y: 1, z: 2 }, wall)).toEqual({
    beyondNearPlaneM: 0.010000000000000009,
    insideSolid: true,
  });
  expect(fixedWallPoint({ x: 0, y: 1, z: 2.1 }, wall).insideSolid).toBe(false);
  expect(fixedWallPoint({ x: 6, y: 1, z: 2.1 }, wall).beyondNearPlaneM).toBe(0);
});
