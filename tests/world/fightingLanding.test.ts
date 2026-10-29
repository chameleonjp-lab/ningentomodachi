import { requirePhysicalValue } from '../../src/world/character-motor';
import { describe, expect, test } from 'vitest';
import { actorId, type SpatialActor } from '../../src/contracts';
import {
  projectFightingMotor,
  sampleFightingMotor,
} from '../../src/world/character-motor';
import { createParisBattleLayout } from '../../src/world/street-layout';

const floor = { supportId: 'declared:test-floor', planeY: 0 };
const actor = (y = 1, grounded = false): SpatialActor => ({
  actorId: actorId('motor:A'),
  position: { x: 0, y, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  facing: { x: 0, y: 0, z: 1 },
  grounded,
  locomotion: grounded ? 'idle' : 'jump',
});
function fall(to: number, extra = {}) {
  return projectFightingMotor({
    actor: actor(),
    from: 0,
    to,
    slices: [{ from: 0, to, frozen: false }],
    support: floor,
    layout: createParisBattleLayout(),
    obstacles: [],
    ...extra,
  });
}
/** Declared numerical mechanism fixtures. These do NOT certify C soles/assets. */
describe('fighting exact fixed-plane motor', () => {
  test('M1 resolves quadratic landing at its actual time and preserves interior velocity', () => {
    const result = fall(500);
    expect(result.seams).toHaveLength(1);
    expect(result.seams[0]?.kind).toBe('landing');
    expect(result.seams[0]?.at).toBeCloseTo(451.523640985731, 9);
    expect(result.actor.position.y).toBe(0);
    expect(result.actor.velocity.y).toBe(0);
    const cut = sampleFightingMotor(result, 400);
    expect(cut.position.y).toBeCloseTo(0.2152, 12);
    expect(cut.velocity.y).toBeCloseTo(-3.924, 12);
    expect(cut.grounded).toBe(false);
  });
  test('M2 owns an exact-E landing once, with no inferred next-step landing', () => {
    const end = Math.sqrt(2 / 9.81) * 1000;
    const first = fall(end);
    expect(first.seams).toHaveLength(1);
    expect(first.seams[0]?.at).toBeCloseTo(end, 10);
    const next = fall(end + 10, {
      actor: first.actor,
      from: end,
      slices: [{ from: end, to: end + 10, frozen: false }],
    });
    expect(next.seams).toEqual([]);
    expect(next.actor.grounded).toBe(true);
  });
  test('M3 frozen accepted action holds Y and instantaneous velocity, then shifts landing', () => {
    const first = fall(500, {
      slices: [
        { from: 0, to: 400, frozen: false },
        { from: 400, to: 500, frozen: true },
      ],
    });
    expect(first.seams).toEqual([]);
    for (const at of [400, 450, 500]) {
      expect(sampleFightingMotor(first, at).position.y).toBeCloseTo(0.2152, 12);
      expect(sampleFightingMotor(first, at).velocity.y).toBeCloseTo(-3.924, 12);
    }
    const next = fall(600, {
      actor: first.actor,
      from: 500,
      slices: [{ from: 500, to: 600, frozen: false }],
    });
    expect(next.seams[0]?.at).toBeCloseTo(551.523640985731, 9);
    expect(fall(500).seams[0]?.at).toBeCloseTo(451.523640985731, 9);
  });
  test('M4 uses the declared elevated fixed support plane, not implicit zero', () => {
    const result = fall(400, {
      actor: actor(1.5),
      support: { supportId: 'fixed:platform', planeY: 1 },
    });
    expect(result.seams[0]?.at).toBeCloseTo(319.27542840705, 9);
    expect(result.actor.position.y).toBe(1);
    expect(result.actor.grounded).toBe(true);
  });
  test('M5 admits physical jump once, records exact apex/return, and rejects denied jump', () => {
    const result = fall(1200, {
      actor: actor(0, true),
      jumpRequested: true,
      jumpAllowed: true,
    });
    expect(result.seams.map((s) => s.kind)).toEqual(['takeoff', 'landing']);
    expect(result.seams[0]?.at).toBe(0);
    expect(result.seams[1]?.at).toBeCloseTo(1121.304791029562, 9);
    const apex = sampleFightingMotor(result, 560.652395514781);
    expect(apex.position.y).toBeCloseTo(1.541794087666, 11);
    expect(apex.velocity.y).toBeCloseTo(0, 10);
    expect(
      fall(50, {
        actor: actor(0, true),
        jumpRequested: true,
        jumpAllowed: false,
      }).seams,
    ).toEqual([]);
  });
  test('airborne motion inherits accepted horizontal velocity and cannot be steered by later intent', () => {
    const old = { ...actor(), velocity: { x: 1, y: 0, z: 2 } };
    const result = fall(100, {
      actor: old,
      movement: { x: -1, y: 0, z: -1 },
      movementAllowed: true,
    });
    expect(result.actor.position.x).toBeCloseTo(0.1, 12);
    expect(result.actor.position.z).toBeCloseTo(0.2, 12);
  });
  test('rejects missing clock coverage, unsupported plane and nonfinite arithmetic without mutating input', () => {
    const old = actor();
    const before = structuredClone(old);
    expect(() =>
      fall(100, { actor: old, slices: [{ from: 1, to: 100, frozen: false }] }),
    ).toThrow();
    expect(() =>
      fall(100, { support: { supportId: '', planeY: 0 } }),
    ).toThrow();
    expect(() => fall(Infinity)).toThrow();
    expect(old).toEqual(before);
  });
});

test('fighting motor rejects an initially out-of-bounds physical anchor before motion', () => {
  expect(() =>
    fall(100, { actor: { ...actor(), position: { x: 2, y: 1, z: 0 } } }),
  ).toThrow();
});

// A1 resource envelope does not authenticate actual sole/multishape/interval geometry.
// These wrapper negatives must stay negative until an approved A2 implementation.
import {
  clipId,
  durationMs,
  gameTimeMs,
  tick,
  worldObjectId,
  type FightingPreparedSpatialBinding,
} from '../../src/contracts';
import { createSpatialEngine } from '../../src/world/spatial-engine';
import { catalog, run, state } from './fixtures';
const policy = { version: 1, mode: 'deterministic-pose-v1' } as const;
function a1Binding(): FightingPreparedSpatialBinding {
  const layout = createParisBattleLayout();
  return {
    readyDescriptor: {
      version: 1,
      bindingSetId: 'explicit-a1-not-qualified',
      clipId: clipId('declared:ready'),
      supportPlane: { supportId: 'floor', planeY: 0 },
      actors: [
        {
          actorId: actorId('white'),
          position: layout.actorSpawns.white,
          facingBasis: { x: 0, y: 0, z: 1 },
        },
      ],
      surfaceToleranceM: 0.00002,
    },
    transactionPolicy: {
      mode: 'battle-transaction-v1',
      maxFrontiers: 100,
      maxSameTimeFrontiers: 20,
    },
    recipeSamplerFactory: {
      runId: run,
      bindingSetId: 'explicit-a1-not-qualified',
      create() {
        throw new Error('must not acquire an unqualified lease');
      },
    },
  };
}
describe('actual spatial wrapper keeps A1 unqualified', () => {
  test('exposes the explicit existing fighting binder but fails closed before creating sampler leases', () => {
    const engine = createSpatialEngine(run, createParisBattleLayout(), policy);
    const capability = engine.poseProtocol?.fighting;
    expect(capability?.mode).toBe('battle-transaction-v1');
    expect(() =>
      requirePhysicalValue(capability).bindPrepared(a1Binding()),
    ).toThrow(/A2.*geometry.*interval/i);
    expect(() =>
      requirePhysicalValue(capability).bindPrepared(a1Binding()),
    ).toThrow(/A2.*geometry.*interval/i);
    engine.dispose();
  });
  test('rejects mixed layout and foreign factory authority before resource acquisition', () => {
    const binding = a1Binding();
    const mixed = {
      ...createParisBattleLayout(),
      objects: [
        {
          objectId: worldObjectId('synthetic:object'),
          position: { x: 1, y: 1, z: 1 },
          halfExtents: { x: 1, y: 1, z: 1 },
        },
      ],
    };
    const engine = createSpatialEngine(run, mixed, policy);
    expect(() =>
      requirePhysicalValue(
        requirePhysicalValue(engine.poseProtocol).fighting,
      ).bindPrepared(binding),
    ).toThrow(/empty battle/i);
    engine.dispose();
    const other = createSpatialEngine(run, createParisBattleLayout(), policy);
    expect(() =>
      requirePhysicalValue(
        requirePhysicalValue(other.poseProtocol).fighting,
      ).bindPrepared({
        ...binding,
        recipeSamplerFactory: {
          ...binding.recipeSamplerFactory,
          bindingSetId: 'foreign',
        },
      }),
    ).toThrow(/binding/i);
    other.dispose();
  });
  test('cannot call an already accepted legacy/loading world a pristine bootstrap', () => {
    const engine = createSpatialEngine(run, createParisBattleLayout(), policy);
    engine.commit({ snapshot: state(0, { phase: 'loading' }), events: [] });
    expect(() =>
      requirePhysicalValue(
        requirePhysicalValue(engine.poseProtocol).fighting,
      ).bindPrepared(a1Binding()),
    ).toThrow(/pristine/i);
    engine.dispose();
  });
  test('transactional endpoint step cannot silently take legacy mutation path; corrected legacy tick remains usable', () => {
    const engine = createSpatialEngine(run, createParisBattleLayout());
    const before = engine.commit({ snapshot: state(), events: [] });
    const planned = state(1);
    const actor = requirePhysicalValue(planned.actors[0]);
    const endpoint = {
      runId: run,
      actorId: actor.actorId,
      stepTick: tick(1),
      atGameMs: gameTimeMs(20),
      epochId: 'declared:e',
      clipId: clipId('declared:ready'),
      activationId: null,
      motionMs: durationMs(20),
      phase: 'neutral' as const,
      posture: 'standing' as const,
    };
    const snapshot = {
      ...planned,
      actors: [
        {
          ...actor,
          fightingClock: {
            stepTick: tick(1),
            activeEpochId: 'declared:e',
            slices: [],
            endpoint,
          },
        },
        requirePhysicalValue(planned.actors[1]),
      ],
    };
    expect(() =>
      engine.step(
        { snapshot, step: { durationMs: durationMs(20) }, intents: [] },
        catalog(),
      ),
    ).toThrow(/A2.*geometry.*interval/i);
    expect(engine.commit({ snapshot: state(), events: [] })).toEqual(before);
    expect(
      engine.step(
        {
          snapshot: planned,
          step: { durationMs: durationMs(20) },
          intents: [],
        },
        catalog(),
      ).snapshot.tick,
    ).toBe(tick(1));
    engine.dispose();
  });
  test('guarded binder rejects accessor/reentrant mutation and leaves the engine pristine', () => {
    const engine = createSpatialEngine(run, createParisBattleLayout(), policy);
    const binding = a1Binding();
    let blocked = false;
    const hostile = new Proxy(binding, {
      getOwnPropertyDescriptor(target, key) {
        try {
          engine.begin(
            'foreign-binding-callback',
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
          );
        } catch {
          blocked = true;
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(() =>
      requirePhysicalValue(
        requirePhysicalValue(engine.poseProtocol).fighting,
      ).bindPrepared(hostile),
    ).toThrow();
    expect(blocked).toBe(true);
    expect(
      engine.begin(
        'foreign-binding-callback',
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ).sessionId,
    ).toBe('foreign-binding-callback');
    engine.dispose();
  });
});

test('finite motor input whose physical integration overflows is rejected, not installed as Infinity', () => {
  const old = { ...actor(1e308), velocity: { x: 0, y: 1e308, z: 0 } };
  expect(() => fall(1000, { actor: old })).toThrow();
});

describe('review fix1 exact physical boundary regressions', () => {
  test.each([
    { axis: 'x', sign: 1 },
    { axis: 'x', sign: -1 },
    { axis: 'z', sign: 1 },
    { axis: 'z', sign: -1 },
  ])(
    'I1 horizontal $axis/$sign wall preserves the ballistic Y and adjacent piece continuity',
    ({ axis, sign }) => {
      const position = { x: 0, y: 1, z: 0 },
        velocity = { x: 0, y: 0, z: 0 };
      if (axis === 'x') {
        position.x = sign * 1.55;
        velocity.x = sign;
      } else {
        position.z = sign * 4.55;
        velocity.z = sign;
      }
      const result = fall(200, { actor: { ...actor(), position, velocity } });
      expect(sampleFightingMotor(result, 100).position.y).toBeCloseTo(
        0.95095,
        12,
      );
      expect(result.actor.position.y).toBeCloseTo(0.8038, 12);
      expect(result.actor.velocity.y).toBeCloseTo(-1.962, 12);
      for (let i = 1; i < result.pieces.length; i++) {
        const before = requirePhysicalValue(result.pieces[i - 1]),
          after = requirePhysicalValue(result.pieces[i]);
        const dt = (before.to - before.from) / 1000;
        for (const component of ['x', 'y', 'z'] as const)
          expect(after.position[component]).toBeCloseTo(
            before.position[component] +
              before.velocity[component] * dt +
              (before.acceleration[component] * dt * dt) / 2,
            12,
          );
      }
    },
  );
  test('I1 a flat obstacle side retains physical ballistic integration at its wall TOI', () => {
    const result = fall(200, {
      actor: {
        ...actor(),
        position: { x: 0, y: 1, z: 0 },
        velocity: { x: 1, y: 0, z: 0 },
      },
      obstacles: [{ min: { x: 0.45, y: 0, z: -1 }, max: { x: 1, y: 4, z: 1 } }],
    });
    expect(sampleFightingMotor(result, 100).position.y).toBeCloseTo(
      0.95095,
      12,
    );
    expect(result.actor.position.x).toBeCloseTo(0.1, 12);
    expect(result.actor.position.y).toBeCloseTo(0.8038, 12);
  });
  test.each([
    1, 2, 5, 10, 16, 20, 25, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300, 400,
    500,
  ])('I2 ordinary jump resumes through apex after %dms partition', (cut) => {
    const first = fall(cut, {
      actor: actor(0, true),
      jumpRequested: true,
      jumpAllowed: true,
    });
    const next = fall(1200, {
      actor: first.actor,
      from: cut,
      slices: [{ from: cut, to: 1200, frozen: false }],
    });
    expect(sampleFightingMotor(next, 560.652395514781).position.y).toBeCloseTo(
      1.541794087666,
      11,
    );
    expect(next.seams[0]?.kind).toBe('landing');
    expect(next.seams[0]?.at).toBeCloseTo(1121.304791029562, 9);
  });
  test('I2 exact airborne apex and frozen resume are not interpreted as a support change', () => {
    const old = { ...actor(), velocity: { x: 0, y: 9.81, z: 0 } };
    const frozen = fall(100, {
      actor: old,
      slices: [{ from: 0, to: 100, frozen: true }],
    });
    const next = fall(1200, {
      actor: frozen.actor,
      from: 100,
      slices: [{ from: 100, to: 1200, frozen: false }],
    });
    expect(sampleFightingMotor(next, 1100).position.y).toBeCloseTo(5.905, 12);
    expect(sampleFightingMotor(next, 1100).velocity.y).toBe(0);
    expect(next.seams).toEqual([]);
  });
  test('I6 initial downward floor contact emits its actual from-time landing before the grounded piece', () => {
    const result = fall(100, {
      actor: { ...actor(0), velocity: { x: 0, y: -1, z: 0 } },
    });
    expect(result.seams).toEqual([
      { kind: 'landing', at: 0, supportId: 'declared:test-floor', planeY: 0 },
    ]);
    expect(result.pieces[0]?.grounded).toBe(true);
    expect(sampleFightingMotor(result, 0).grounded).toBe(true);
    const next = fall(110, {
      actor: result.actor,
      from: 100,
      slices: [{ from: 100, to: 110, frozen: false }],
    });
    expect(next.seams).toEqual([]);
  });
});

describe('I1/I6 coincident physical surface batches', () => {
  const coincident = (to: number) =>
    fall(to, { actor: { ...actor(4.905), velocity: { x: 1.65, y: 0, z: 0 } } });
  test('exact-E bound and floor contacts are both processed in the same physical batch', () => {
    const result = coincident(1000);
    expect(result.actor.grounded).toBe(true);
    expect(result.actor.position).toEqual({ x: 1.65, y: 0, z: 0 });
    expect(result.actor.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.seams).toEqual([
      {
        kind: 'landing',
        at: 1000,
        supportId: 'declared:test-floor',
        planeY: 0,
      },
    ]);
  });
  test('strictly before E has no landing; E and after own one real landing with no next-step duplicate', () => {
    const before = coincident(999.999);
    expect(before.seams).toEqual([]);
    expect(before.actor.grounded).toBe(false);
    expect(before.actor.position.y).toBeGreaterThan(0);
    for (const end of [1000, 1000.001]) {
      const result = coincident(end);
      expect(result.seams).toHaveLength(1);
      expect(result.seams[0]?.at).toBeCloseTo(1000, 10);
      expect(result.actor.grounded).toBe(true);
      expect(
        fall(end + 1, {
          actor: result.actor,
          from: end,
          slices: [{ from: end, to: end + 1, frozen: false }],
        }).seams,
      ).toEqual([]);
    }
  });
  test.each([
    { x: 1.65, z: 0 },
    { x: -1.65, z: 0 },
    { x: 0, z: 4.65 },
    { x: 0, z: -4.65 },
    { x: 1.65, z: 4.65 },
  ])(
    'signed/corner bound with floor keeps the same exact landing: $x/$z',
    ({ x, z }) => {
      const result = fall(1000, {
        actor: { ...actor(4.905), velocity: { x, y: 0, z } },
      });
      expect(result.actor.grounded).toBe(true);
      expect(result.actor.position).toEqual({ x, y: 0, z });
      expect(result.actor.velocity).toEqual({ x: 0, y: 0, z: 0 });
      expect(result.seams[0]?.at).toBe(1000);
    },
  );
  test('wall at the apex is not a floor contact and its next ballistic piece remains continuous', () => {
    const result = fall(1100, {
      actor: { ...actor(), velocity: { x: 1.65, y: 9.81, z: 0 } },
    });
    const apex = sampleFightingMotor(result, 1000);
    expect(apex.position.y).toBeCloseTo(5.905, 12);
    expect(apex.velocity.y).toBe(0);
    expect(apex.grounded).toBe(false);
    expect(result.actor.position.y).toBeCloseTo(5.85595, 12);
    expect(result.seams).toEqual([]);
  });
  test('accepted freeze shifts both coincident physical contacts without dropping the endpoint landing', () => {
    const result = fall(1100, {
      actor: { ...actor(4.905), velocity: { x: 1.65, y: 0, z: 0 } },
      slices: [
        { from: 0, to: 900, frozen: false },
        { from: 900, to: 1000, frozen: true },
        { from: 1000, to: 1100, frozen: false },
      ],
    });
    expect(result.actor.grounded).toBe(true);
    expect(result.actor.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.seams).toHaveLength(1);
    expect(result.seams[0]?.at).toBeCloseTo(1100, 10);
  });
});

describe('review fix2 exact grounded admission domain', () => {
  test.each([false, true])(
    'nonmatching grounded starts reject atomically for frozen=%s',
    (frozen) => {
      for (const y of [
        -2e-8,
        -1e-8,
        -5e-9,
        -Number.MIN_VALUE,
        Number.MIN_VALUE,
        5e-9,
        1e-8,
        2e-8,
      ]) {
        const old = actor(y, true),
          before = structuredClone(old);
        expect(() =>
          fall(100, { actor: old, slices: [{ from: 0, to: 100, frozen }] }),
        ).toThrow(/fixed-plane/);
        expect(old).toEqual(before);
      }
    },
  );
  test.each([
    { planeY: 0, frozen: false },
    { planeY: 0, frozen: true },
    { planeY: 1, frozen: false },
    { planeY: 1, frozen: true },
  ])(
    'exact support plane $planeY stays grounded for frozen=$frozen without a seam',
    ({ planeY, frozen }) => {
      const old = actor(planeY, true),
        before = structuredClone(old);
      const result = fall(100, {
        actor: old,
        support: { supportId: 'explicit:fixed', planeY },
        slices: [{ from: 0, to: 100, frozen }],
      });
      expect(result.actor.grounded).toBe(true);
      expect(result.actor.position.y).toBe(planeY);
      expect(result.actor.locomotion).toBe('idle');
      expect(result.seams).toEqual([]);
      expect(result.pieces[0]?.grounded).toBe(true);
      expect(old).toEqual(before);
    },
  );
  test.each([false, true])(
    'elevated near-plane grounded starts use the same reject domain for frozen=%s',
    (frozen) => {
      for (const delta of [-5e-9, 5e-9]) {
        const old = actor(1 + delta, true),
          before = structuredClone(old);
        expect(() =>
          fall(100, {
            actor: old,
            support: { supportId: 'explicit:fixed', planeY: 1 },
            slices: [{ from: 0, to: 100, frozen }],
          }),
        ).toThrow(/fixed-plane/);
        expect(old).toEqual(before);
      }
    },
  );
});

import { captureFightingMotorGeometryPath } from '../../src/world/spatial-engine';
import { fightingHurtProxy } from '../../src/world/combat-hurt';
/** D numerical mechanism only: not C source/interval admission. */
describe('D same-time motor geometry path preparation', () => {
  const evaluate = (c: readonly [number, number, number], u: number) =>
    c[0] + c[1] * u + c[2] * u * u;
  test('restricts the actual quadratic to common game time rather than its endpoint chord', () => {
    const projected = fall(400);
    const path = captureFightingMotorGeometryPath(
      projected,
      100,
      300,
      0,
      'airborne',
    );
    expect(path.from).toBe(100);
    expect(path.to).toBe(300);
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const actual = sampleFightingMotor(projected, 100 + 200 * u);
      expect(evaluate(path.position.y, u)).toBeCloseTo(actual.position.y, 14);
      expect(evaluate(path.groundClearanceM, u)).toBeCloseTo(
        actual.position.y,
        14,
      );
    }
    expect(path.position.y[2]).not.toBe(0);
    expect(path.expectedHurtProxy).toEqual(
      fightingHurtProxy({ x: 0, y: 0, z: 0 }, 'airborne'),
    );
    expect(Object.isFrozen(path.position.y)).toBe(true);
    expect(Object.isFrozen(path.expectedHurtProxy.volume.start)).toBe(true);
  });
  test('frozen piece is constant despite retained physical velocity and uses fixed elevated plane', () => {
    const projected = fall(400, {
      actor: actor(2),
      support: { ...floor, planeY: 1 },
      slices: [
        { from: 0, to: 200, frozen: false },
        { from: 200, to: 400, frozen: true },
      ],
    });
    const path = captureFightingMotorGeometryPath(
      projected,
      200,
      400,
      1,
      'crouching',
    );
    expect(sampleFightingMotor(projected, 250).velocity.y).not.toBe(0);
    expect(path.position.y.slice(1)).toEqual([0, 0]);
    expect(path.groundClearanceM[0]).toBe(path.position.y[0] - 1);
    expect(path.expectedHurtProxy).toEqual(
      fightingHurtProxy({ x: 0, y: 0, z: 0 }, 'crouching'),
    );
  });
  test('rejects a landing endpoint whose left polynomial differs from installed floor state', () => {
    // Real motor projections, not a forged endpoint or an epsilon allowance.
    const projected = [1, 1.1, 1.3, 2, 2.4]
      .map((y) => fall(1000, { actor: actor(y) }))
      .find((result) => {
        const piece = requirePhysicalValue(result.pieces[0]);
        const seconds = (piece.to - piece.from) / 1000;
        const leftY =
          piece.position.y +
          piece.velocity.y * seconds +
          (piece.acceleration.y * seconds * seconds) / 2;
        return leftY !== sampleFightingMotor(result, piece.to).position.y;
      });
    expect(projected).toBeDefined();
    const result = requirePhysicalValue(projected);
    const end = requirePhysicalValue(result.pieces[0]).to;
    expect(sampleFightingMotor(result, end).position.y).toBe(0);
    expect(() =>
      captureFightingMotorGeometryPath(result, 0, end, 0, 'airborne'),
    ).toThrow(/endpoint.*qualification/i);
    // The following installed grounded piece remains independently admissible.
    expect(
      captureFightingMotorGeometryPath(result, end, result.to, 0, 'standing')
        .groundClearanceM,
    ).toEqual([0, 0, 0]);
  });
  test('refuses seam crossing, extrapolation, empty windows and nonfinite plane', () => {
    const projected = fall(500);
    for (const [from, to, plane] of [
      [0, 500, 0],
      [-1, 100, 0],
      [200, 100, 0],
      [100, 100, 0],
      [0, 100, NaN],
    ] as const)
      expect(() =>
        captureFightingMotorGeometryPath(
          projected,
          from,
          to,
          plane,
          'standing',
        ),
      ).toThrow();
  });
});
