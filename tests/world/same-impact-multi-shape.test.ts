import { expect, test } from 'vitest';
import {
  contactId,
  worldObjectId,
  durationMs,
  MOTION_SPACE,
  type HitVolume,
  type SpatialCandidate,
} from '../../src/contracts';
import { requireValue } from '../../src/core/invariant';
import {
  combatContacts,
  type ActorTrajectory,
  type CombatHurtRegions,
} from '../../src/world/contact-candidates';
import { attack, setup, step } from '../core/fixtures/scenarios';

// Synthetic API regression only: no source anatomy, fit, catalog admission or production wiring.
// A2's exit requires candidate-order independence (01-agent-A-core-combat.md:217).
// No particular winning witness is prescribed; reversing the same set must preserve the event.
const sphere = (x: number, radiusM: number): HitVolume => ({
  kind: 'sphere',
  center: { x, y: 1, z: 0 },
  radiusM,
});
const capsule = (x: number, radiusM: number): HitVolume => ({
  kind: 'capsule',
  start: { x, y: 0.8, z: 0 },
  end: { x, y: 1.2, z: 0 },
  radiusM,
});
function evaluate(
  shapes: readonly HitVolume[],
  targetX: number,
  reverseSegments = false,
  reverseCandidates = false,
  transform: (c: readonly SpatialCandidate[]) => readonly SpatialCandidate[] = (
    c,
  ) => c,
) {
  const core = setup();
  attack(core, 'white', 'kick');
  const snapshot = core.read();
  const source = requireValue(snapshot.actors.find((a) => a.color === 'white'));
  const binding = requireValue(source.attack);
  const segments = shapes.map((volume, index) => ({
    impactIndex: 0,
    shapeId: `synthetic-part-${index}`,
    fromMs: durationMs(0),
    toMs: durationMs(10),
    activeWindow: { startMs: durationMs(0), endMs: durationMs(10) },
    from: volume,
    to: volume,
  }));
  const actors: ActorTrajectory[] = (['white', 'blue'] as const).map(
    (color) => {
      const state = requireValue(
        snapshot.actors.find((a) => a.color === color),
      );
      const position = { x: 0, y: 0, z: 0 };
      return {
        state,
        actor: {
          actorId: state.actorId,
          position,
          facing: { x: 0, y: 0, z: 1 },
          velocity: position,
          grounded: true,
          locomotion: 'idle',
        },
        path: [
          { at: 0, position },
          { at: 10, position },
        ],
        ...(color === 'white'
          ? {
              sample: {
                clipId: binding.clipId,
                fromMs: durationMs(0),
                toMs: durationMs(10),
                space: MOTION_SPACE,
                rootSegments: [],
                hitVolumeSegments: reverseSegments
                  ? [...segments].reverse()
                  : segments,
              },
            }
          : { sample: undefined }),
      };
    },
  );
  const regions: CombatHurtRegions[] = actors.map((target) => ({
    runId: snapshot.runId,
    target,
    sourceId: 'synthetic-only',
    poseId: 'static',
    space: 'actor-local-metres',
    interpolation: 'piecewise-linear',
    segments: [
      {
        partId: 'body',
        from: 0,
        to: 10,
        start: sphere(targetX, 0.05),
        end: sphere(targetX, 0.05),
      },
    ],
  }));
  const candidates = combatContacts(snapshot.runId, actors, regions);
  const prepared = transform(candidates);
  const submitted = reverseCandidates ? [...prepared].reverse() : prepared;
  const output = step(core, () => submitted);
  return {
    candidates,
    submitted,
    events: output.events.filter((e) => e.type === 'HpChanged'),
    snapshot: output.snapshot,
  };
}

test('same-impact sphere and capsule preserve gap, single damage and order-independent contact evidence', () => {
  const separated = [sphere(-0.6, 0.1), capsule(0.6, 0.1)];
  const footOnly = evaluate([requireValue(separated[0])], 0.6);
  const shinOnly = evaluate([requireValue(separated[1])], 0.6);
  const combined = evaluate(separated, 0.6);
  const gap = evaluate(separated, 0);
  const simultaneous = [sphere(-0.15, 0.2), capsule(0.15, 0.2)];
  const permutations = [false, true].flatMap((reverseSegments) =>
    [false, true].map((reverseCandidates) => ({
      reverseSegments,
      reverseCandidates,
      result: evaluate(simultaneous, 0, reverseSegments, reverseCandidates),
    })),
  );
  // Full raw input/candidate/event evidence is retained in the caller's redirected test log.
  console.log(
    'SAME_IMPACT_EVIDENCE',
    JSON.stringify({
      separated,
      simultaneous,
      footOnly,
      shinOnly,
      combined,
      gap,
      permutations,
    }),
  );
  expect(footOnly.candidates).toEqual([]);
  expect(shinOnly.events).toHaveLength(1);
  expect(combined.events).toHaveLength(1);
  expect(combined.events[0]?.actualHpLost).toBe(
    shinOnly.events[0]?.actualHpLost,
  );
  expect(gap.candidates).toEqual([]);
  expect(gap.events).toEqual([]);
  const baseline = requireValue(permutations[0]).result;
  for (const { result } of permutations) {
    expect(result.candidates).toHaveLength(2);
    const [a, b] = result.candidates;
    expect(a?.at).toBe(b?.at);
    expect(a?.point).not.toEqual(b?.point);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.actualHpLost).toBe(
      baseline.events[0]?.actualHpLost,
    );
    expect.soft(result.snapshot).toStrictEqual(baseline.snapshot);
    expect.soft(result.events).toStrictEqual(baseline.events);
  }
});

test('canonical duplicate zeros do not mutate inputs or normalize unique witnesses', () => {
  const shapes = [sphere(-0.15, 0.2), capsule(0.15, 0.2)];
  const transform = (cs: readonly SpatialCandidate[]) =>
    cs.map((c, i) =>
      Object.freeze({
        ...c,
        point: Object.freeze({ x: i ? 0 : -0, y: 1, z: 0 }),
      }),
    );
  const a = evaluate(shapes, 0, false, false, transform);
  const b = evaluate(shapes, 0, false, true, transform);
  expect(a.events).toStrictEqual(b.events);
  expect(Object.is(a.submitted[0]?.point.x, -0)).toBe(true);
  expect(Object.is(a.events[0]?.contact.point.x, 0)).toBe(true);
  const unique = evaluate(
    [requireValue(shapes[0])],
    0,
    false,
    false,
    transform,
  );
  expect(Object.is(unique.events[0]?.contact.point.x, -0)).toBe(true);
  const invalidSibling = evaluate(shapes, 0, false, false, (cs) =>
    cs.map((c, i) => ({
      ...c,
      point: { x: i ? NaN : -0, y: 1, z: 0 },
    })),
  );
  expect(invalidSibling.events).toHaveLength(1);
  expect(Object.is(invalidSibling.events[0]?.contact.point.x, -0)).toBe(true);
});

test('nonfinite points remain rejected and existing contact ID priority wins over geometry', () => {
  const shapes = [sphere(-0.15, 0.2), capsule(0.15, 0.2)];
  for (const x of [NaN, Infinity, -Infinity]) {
    const result = evaluate(shapes, 0, false, false, (cs) =>
      cs.map((c) => ({ ...c, point: { ...c.point, x } })),
    );
    expect(result.events).toEqual([]);
  }
  const transform = (cs: readonly SpatialCandidate[]) =>
    cs.map((c, i) => ({
      ...c,
      contactId: contactId(i ? 'b' : 'a'),
      point: { x: i ? -9 : 9, y: 1, z: 0 },
    }));
  const a = evaluate(shapes, 0, false, false, transform);
  const b = evaluate(shapes, 0, false, true, transform);
  expect(a.events).toStrictEqual(b.events);
  expect(a.events[0]?.contact.point.x).toBe(9);
});

test('mixed candidate kind does not enter body witness tie-break', () => {
  const shape = [sphere(-0.15, 0.2)];
  const mixed = (cs: readonly SpatialCandidate[]): SpatialCandidate[] => {
    const c = requireValue(cs[0]);
    if (c.kind !== 'body-hit') throw Error('Expected synthetic body hit');
    return [
      c,
      {
        ...c,
        kind: 'destruction',
        sourceActorId: c.source.actorId,
        targetId: worldObjectId('missing-synthetic-object'),
        source: c.source,
        launchId: null,
        contactSpeedMps: 0,
        point: { x: -9, y: 1, z: 0 },
      },
    ];
  };
  const baseline = evaluate(shape, 0);
  const a = evaluate(shape, 0, false, false, mixed);
  const b = evaluate(shape, 0, false, true, mixed);
  expect(a.events).toStrictEqual(baseline.events);
  expect(b.events).toStrictEqual(baseline.events);
});

test('equivalent witnesses sort only in their existing slots around another evidence group', () => {
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const results = orders.map((order) => ({
    order,
    result: evaluate(
      [sphere(-0.15, 0.2), capsule(0.15, 0.2)],
      0,
      false,
      false,
      (cs) => {
        const other = {
          ...requireValue(cs[0]),
          evidence: 'overlap' as const,
          point: { x: 9, y: 1, z: 0 },
        };
        const all = [...cs, other];
        return order.map((i) => requireValue(all[i]));
      },
    ),
  }));
  console.log('INTERLEAVED_GROUP_EVIDENCE', JSON.stringify(results));
  for (const { order, result } of results) {
    // Another evidence group retains its old slot; no new cross-group winner policy.
    const expected = order[0] === 2 ? 9 : -0.05000000000000002;
    expect.soft(result.events[0]?.contact.point.x).toBe(expected);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.actualHpLost).toBe(100);
  }
});
