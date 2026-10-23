import { expect, test } from 'vitest';
import { actorId, attackActivationId, impactId } from '../../src/contracts';
import { distinctImpactSources } from '../integration/fixtures/kickChainAttribution';

test('all four impact bindings remain independently eligible, never combo-global dedup', () => {
  const actor = actorId('white'),
    activation = attackActivationId('activation');
  const bindings = [0, 1, 2, 3].map((impactIndex) => ({
    impactIndex,
    impactId: impactId(`event-${impactIndex}`),
  }));
  const sources = distinctImpactSources(actor, activation, bindings);
  expect(sources).toHaveLength(4);
  expect(new Set(sources.map((s) => s.impactId)).size).toBe(4);
  expect(sources.map((s) => s.impactId)).toEqual(
    bindings.map((b) => b.impactId),
  );
  expect(() =>
    distinctImpactSources(actor, activation, bindings.slice(0, 3)),
  ).toThrow();
  expect(() =>
    distinctImpactSources(
      actor,
      activation,
      bindings.map((b) => ({ ...b, impactId: bindings[0]!.impactId })),
    ),
  ).toThrow();
});

import { Triangle, Vector3 } from 'three';
import {
  deferredAssertions,
  diagnosticPatch,
  requireNondegeneratePatch,
} from '../integration/fixtures/kickChainAttribution';

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
    region: 'heel-hypothesis',
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
