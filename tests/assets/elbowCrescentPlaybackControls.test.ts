import { Triangle, Vector3 } from 'three';
import { expect, test } from 'vitest';
import {
  deferredAssertions,
  diagnosticPatch,
  requireNondegeneratePatch,
} from '../integration/fixtures/elbowCrescentAttribution';

test('deferred matcher retains context and snapshots before mutation', () => {
  const checks: (() => void)[] = [];
  const check = deferredAssertions(checks);
  const input = { x: 1 };
  check(input).toEqual({ x: 1 });
  input.x = 2;
  expect(checks).toHaveLength(1);
  checks[0]?.();
  check(1).toBe(2);
  expect(() => checks[1]?.()).toThrow();
});
test('degenerate patch reports exact original identity without inventing distance', () => {
  const identity = {
    primitive: 3,
    triangleIndex: 42,
    fan: 1,
    region: 'posterior-elbow-band-hypothesis',
  };
  const result = diagnosticPatch(() => {
    requireNondegeneratePatch(
      new Triangle(new Vector3(), new Vector3(1, 0, 0), new Vector3(2, 0, 0)),
      identity,
    );
    return [];
  });
  expect(result).toMatchObject({
    status: 'unresolved',
    identity,
    reason: 'Degenerate posed source patch',
  });
  expect(result).not.toHaveProperty('faces');
  expect(result).not.toHaveProperty('regionGapM');
});
test('non-attribution failures remain fatal, not swallowed', () => {
  expect(() =>
    diagnosticPatch(() => {
      throw new Error('Source topology differs');
    }),
  ).toThrow('Source topology differs');
});
