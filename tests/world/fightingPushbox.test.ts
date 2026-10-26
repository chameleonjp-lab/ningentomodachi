import { requirePhysicalValue } from '../../src/world/character-motor';
import { describe, expect, test } from 'vitest';
import { actorId, type SpatialActor, type Vector3 } from '../../src/contracts';
import { resolveFightingPushbox } from '../../src/world/fightingPushbox';
import { createParisBattleLayout } from '../../src/world/street-layout';
const p = (x: number, y = 0, z = 0): Vector3 => ({ x, y, z });
const actor = (id: string, position: Vector3): SpatialActor => ({
  actorId: actorId(id),
  position,
  velocity: p(0),
  facing: p(0, 0, 1),
  grounded: true,
  locomotion: 'idle',
});
function trajectory(
  id: string,
  keys: readonly [number, Vector3][],
  height = 1.85,
) {
  return {
    actor: actor(id, requirePhysicalValue(keys[0])[1]),
    path: keys.map(([at, position]) => ({ at, position })),
    verticalBounds: { min: 0, max: height },
  };
}
function solve(
  trajectories: ReturnType<typeof trajectory>[],
  to = 500,
  layout = createParisBattleLayout(),
  obstacles = [] as { min: Vector3; max: Vector3 }[],
) {
  return resolveFightingPushbox({
    from: 0,
    to,
    trajectories,
    layout,
    obstacles,
  });
}
/** Exact synthetic continuous-path cases, not actual attack/mesh qualification. */
describe('simultaneous fighting pushbox paths', () => {
  test('P1 stops symmetric crossing at centre distance .70 without actor-order priority', () => {
    const a = trajectory('A', [
        [0, p(-1)],
        [500, p(1)],
      ]),
      b = trajectory('B', [
        [0, p(1)],
        [500, p(-1)],
      ]);
    for (const input of [
      [a, b],
      [b, a],
    ]) {
      const out = solve(input);
      const left = requirePhysicalValue(
        out.trajectories.find((t) => t.actor.actorId === a.actor.actorId),
      );
      const right = requirePhysicalValue(
        out.trajectories.find((t) => t.actor.actorId === b.actor.actorId),
      );
      expect(left.actor.position.x).toBeCloseTo(-0.35, 12);
      expect(right.actor.position.x).toBeCloseTo(0.35, 12);
      expect(left.path.some((k) => Math.abs(k.at - 162.5) < 1e-9)).toBe(true);
    }
  });
  test('P2 rechecks bounds so a pinned target cannot transfer motion through the wall', () => {
    const out = solve([
      trajectory('A', [
        [0, p(0, 0, 3)],
        [500, p(0, 0, 5)],
      ]),
      trajectory('B', [
        [0, p(0, 0, 4.65)],
        [500, p(0, 0, 4.65)],
      ]),
    ]);
    expect(out.trajectories[0]?.actor.position.z).toBeCloseTo(3.95, 12);
    expect(out.trajectories[1]?.actor.position.z).toBeCloseTo(4.65, 12);
    expect(
      out.trajectories[0]?.path.some((k) => Math.abs(k.at - 237.5) < 1e-9),
    ).toBe(true);
  });
  test('P3 preserves a bent path and distinguishes it from a same-endpoint control', () => {
    const b = trajectory('B', [
      [0, p(0)],
      [16, p(0)],
    ]);
    const layout = {
      ...createParisBattleLayout(),
      bounds: { min: p(-10, 0, -10), max: p(10, 12, 10) },
    };
    const crossed = solve(
      [
        trajectory('A', [
          [0, p(-1)],
          [8, p(1)],
          [16, p(-1)],
        ]),
        b,
      ],
      16,
      layout,
    );
    const control = solve(
      [
        trajectory('A', [
          [0, p(-1)],
          [8, p(-2)],
          [16, p(-1)],
        ]),
        b,
      ],
      16,
      layout,
    );
    expect(
      crossed.trajectories[0]?.path.some((k) => Math.abs(k.at - 1.2) < 1e-9),
    ).toBe(true);
    expect(control.trajectories[1]?.actor.position.x).toBe(0);
    expect(control.seams).toEqual([]);
  });
  test('P4 retains wall-slide bend instead of replacing it with an endpoint chord', () => {
    const layout = {
      ...createParisBattleLayout(),
      bounds: { min: p(-10, 0, -10), max: p(10, 12, 10) },
    };
    const result = solve(
      [
        trajectory('A', [
          [0, p(0)],
          [20, p(4, 0, 10)],
        ]),
      ],
      20,
      layout,
      [{ min: p(-10, 0, 1.99), max: p(10, 3, 2.01) }],
    );
    const out = requirePhysicalValue(result.trajectories[0]);
    expect(
      out.path.some(
        (k) =>
          Math.abs(k.at - 3.28) < 1e-9 &&
          Math.abs(k.position.x - 0.656) < 1e-9 &&
          Math.abs(k.position.z - 1.64) < 1e-9,
      ),
    ).toBe(true);
    expect(out.actor.position.x).toBeCloseTo(4, 12);
    expect(out.actor.position.z).toBeCloseTo(1.64, 12);
  });
  test('P5 treats bounds as continuous collision planes, not endpoint clamps', () => {
    const out = requirePhysicalValue(
      solve(
        [
          trajectory('A', [
            [0, p(0)],
            [20, p(20)],
          ]),
        ],
        20,
      ).trajectories[0],
    );
    expect(out.actor.position.x).toBeCloseTo(1.65, 12);
    expect(out.path.some((k) => Math.abs(k.at - 1.65) < 1e-9)).toBe(true);
    expect(out.actor.velocity.x).toBe(0);
  });
  test('P6 respects height separation and reports initial overlap as an unswept seam', () => {
    const high = solve([
      trajectory('A', [
        [0, p(-1)],
        [500, p(1)],
      ]),
      trajectory('B', [
        [0, p(1, 3)],
        [500, p(-1, 3)],
      ]),
    ]);
    expect(high.trajectories[0]?.actor.position.x).toBe(1);
    const overlap = solve([
      trajectory('A', [
        [0, p(-0.2)],
        [500, p(-0.2)],
      ]),
      trajectory('B', [
        [0, p(0.2)],
        [500, p(0.2)],
      ]),
    ]);
    expect(
      requirePhysicalValue(overlap.trajectories[1]).actor.position.x -
        requirePhysicalValue(overlap.trajectories[0]).actor.position.x,
    ).toBeCloseTo(0.7, 12);
    expect(overlap.seams[0]?.kind).toBe('initial-overlap');
    expect(overlap.seams[0]?.at).toBe(0);
    expect(overlap.trajectories[0]?.path[0]?.position.x).toBeCloseTo(-0.35, 12);
  });
  test('does not mutate inputs and rejects unsupported or malformed paths', () => {
    const input = [
      trajectory('A', [
        [0, p(-1)],
        [500, p(1)],
      ]),
      trajectory('B', [
        [0, p(1)],
        [500, p(-1)],
      ]),
    ];
    const before = structuredClone(input);
    solve(input);
    expect(input).toEqual(before);
    expect(() =>
      solve([
        trajectory('A', [
          [0, p(0)],
          [0, p(1)],
          [500, p(1)],
        ]),
      ]),
    ).toThrow();
  });
});

test('pinned role, opposite wall and corner preserve symmetric no-tunnel physics', () => {
  for (const sign of [-1, 1])
    for (const x of [0, 1.65]) {
      const a = trajectory('Z', [
        [0, p(x, 0, sign * 3)],
        [500, p(x, 0, sign * 5)],
      ]);
      const b = trajectory('A', [
        [0, p(x, 0, sign * 4.65)],
        [500, p(x, 0, sign * 4.65)],
      ]);
      const out = solve([b, a]);
      expect(
        requirePhysicalValue(out.trajectories[0]).actor.position.z,
      ).toBeCloseTo(sign * 4.65, 12);
      expect(
        requirePhysicalValue(out.trajectories[1]).actor.position.z,
      ).toBeCloseTo(sign * 3.95, 12);
      expect(requirePhysicalValue(out.trajectories[1]).actor.position.x).toBe(
        x,
      );
    }
});
test('endpoint wall collision cancels instantaneous velocity before the next interval', () => {
  const out = requirePhysicalValue(
    solve(
      [
        trajectory('A', [
          [0, p(0)],
          [20, p(1.65)],
        ]),
      ],
      20,
    ).trajectories[0],
  );
  expect(out.actor.position.x).toBeCloseTo(1.65, 12);
  expect(out.actor.velocity.x).toBe(0);
});
test('initial overlap redistributes correction into available free space near a wall', () => {
  const out = solve([
    trajectory('A', [
      [0, p(-1.6)],
      [500, p(-1.6)],
    ]),
    trajectory('B', [
      [0, p(-1.2)],
      [500, p(-1.2)],
    ]),
  ]);
  expect(
    requirePhysicalValue(out.trajectories[0]).actor.position.x,
  ).toBeCloseTo(-1.65, 12);
  expect(
    requirePhysicalValue(out.trajectories[1]).actor.position.x,
  ).toBeCloseTo(-0.95, 12);
});
test('vertical overlap changes are cut without an endpoint-height shortcut', () => {
  const out = solve([
    trajectory('A', [
      [0, p(-1)],
      [500, p(1)],
    ]),
    trajectory('B', [
      [0, p(1, 3)],
      [500, p(-1, 0)],
    ]),
  ]);
  expect(
    requirePhysicalValue(out.trajectories[1]).actor.position.x -
      requirePhysicalValue(out.trajectories[0]).actor.position.x,
  ).toBeGreaterThanOrEqual(0.7 - 1e-10);
});

test('initial overlap redistributes correction away from a nearby obstacle instead of rejecting available space', () => {
  const out = solve(
    [
      trajectory('A', [
        [0, p(-0.2)],
        [500, p(-0.2)],
      ]),
      trajectory('B', [
        [0, p(0.2)],
        [500, p(0.2)],
      ]),
    ],
    500,
    createParisBattleLayout(),
    [{ min: p(0.6, 0, -1), max: p(1.6, 3, 1) }],
  );
  expect(out.trajectories[0]?.actor.position.x).toBeCloseTo(-0.45, 12);
  expect(out.trajectories[1]?.actor.position.x).toBeCloseTo(0.25, 12);
});

describe('review fix1 vertical departure and arithmetic boundaries', () => {
  test('I4 pair touching vertically at from can immediately separate and cross without horizontal constraint', () => {
    const result = solve(
      [
        trajectory('A', [
          [0, p(-0.35)],
          [1000, p(1)],
        ]),
        trajectory('B', [
          [0, p(0.35, 1.85)],
          [1000, p(-1, 3.85)],
        ]),
      ],
      1000,
    );
    expect(result.trajectories[0]?.actor.position.x).toBeCloseTo(1, 12);
    expect(result.trajectories[1]?.actor.position.x).toBeCloseTo(-1, 12);
    expect(result.seams).toEqual([]);
  });
  test('I4 a vertical-overlap exit inside the piece releases the right-hand interval', () => {
    const result = solve(
      [
        trajectory('A', [
          [0, p(-0.35)],
          [1000, p(1)],
        ]),
        trajectory('B', [
          [0, p(0.35, 0.85)],
          [1000, p(-1, 2.85)],
        ]),
      ],
      1000,
    );
    expect(result.trajectories[0]?.actor.position.x).toBeCloseTo(0.325, 12);
    expect(result.trajectories[1]?.actor.position.x).toBeCloseTo(-0.325, 12);
  });
  test('I5 finite source coordinates cannot install infinite derived velocity or positions', () => {
    for (const [duration, endY] of [
      [1000, -1e308],
      [1, 0],
    ]) {
      const to = requirePhysicalValue(duration),
        end = requirePhysicalValue(endY);
      const input = [
          trajectory('A', [
            [0, p(0, 1e308)],
            [to, p(0, end)],
          ]),
        ],
        before = structuredClone(input);
      expect(() => solve(input, to)).toThrow();
      expect(input).toEqual(before);
    }
  });
});

test('I4 exact-E height departure retains the free instantaneous suffix velocity without moving its accepted prefix', () => {
  const result = solve(
    [
      trajectory('A', [
        [0, p(-0.35)],
        [1000, p(1)],
      ]),
      trajectory('B', [
        [0, p(0.35, 0.85)],
        [1000, p(-1, 1.85)],
      ]),
    ],
    1000,
  );
  expect(result.trajectories[0]?.actor.position.x).toBeCloseTo(-0.35, 12);
  expect(result.trajectories[1]?.actor.position.x).toBeCloseTo(0.35, 12);
  expect(result.trajectories[0]?.actor.velocity.x).toBeCloseTo(1.35, 12);
  expect(result.trajectories[1]?.actor.velocity.x).toBeCloseTo(-1.35, 12);
});
