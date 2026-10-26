import { requirePhysicalValue } from '../../src/world/character-motor';
import { describe, expect, test } from 'vitest';
import {
  actorId,
  attackActivationId,
  impactId,
  runId,
  durationMs,
  gameTimeMs,
  clipId,
  tick,
  type HitVolume,
  type SpatialActor,
  type FightingClock,
  type FightingRecipeSamplerPort,
} from '../../src/contracts';
import {
  projectFightingContacts,
  fightingMotionAt,
  sampleFightingPoseGeometry,
  type FightingLinearContactTrajectory,
} from '../../src/world/contact-candidates';
import { fightingHurtProxy } from '../../src/world/combat-hurt';
const run = runId('declared-linear-contact');
const p = (x = 0, y = 0, z = 0) => ({ x, y, z });
const sphere = (x = 0, y = 1, z = 0, r = 0.1): HitVolume => ({
  kind: 'sphere',
  center: p(x, y, z),
  radiusM: r,
});
function trajectory(
  id: string,
  root = p(),
  facing = p(0, 0, 1),
  posture: 'standing' | 'crouching' | 'airborne' = 'standing',
): FightingLinearContactTrajectory {
  const actor: SpatialActor = {
    actorId: actorId(id),
    position: root,
    facing,
    velocity: p(),
    grounded: posture !== 'airborne',
    locomotion:
      posture === 'airborne'
        ? 'jump'
        : posture === 'crouching'
          ? 'crouch'
          : 'idle',
  };
  return {
    actor,
    epochId: `${id}:epoch0`,
    posture,
    path: [
      { at: 0, position: root },
      { at: 100, position: root },
    ],
    impacts: [],
  };
}
function armed(
  t: FightingLinearContactTrajectory,
  a: HitVolume,
  b = a,
  end = 100,
): FightingLinearContactTrajectory {
  return {
    ...t,
    impacts: [
      {
        source: {
          actorId: t.actor.actorId,
          activationId: attackActivationId(`${t.actor.actorId}:activation`),
          impactId: impactId(`${t.actor.actorId}:impact`),
        },
        activeFrom: 0,
        activeTo: end,
        shapes: [
          {
            shapeId: 'declared-sphere',
            keys: [
              { at: 0, volume: a },
              { at: 100, volume: b },
            ],
          },
        ],
      },
    ],
  };
}
function project(
  trajectories: readonly FightingLinearContactTrajectory[],
  extra = {},
) {
  return projectFightingContacts({
    runId: run,
    from: 0,
    to: 100,
    originalTo: 100,
    trajectories,
    episodes: [],
    settledOccurrenceIds: [],
    maxWork: 8192,
    ...extra,
  });
}
/** Synthetic declared exact linear geometry ONLY. Not actual C/robot evidence. */
describe('fighting exact linear contact frontiers', () => {
  test('C1 actual body TOI samples both actor witnesses at 55ms', () => {
    const source = armed(trajectory('A'), sphere(0), sphere(1));
    const result = project([source, trajectory('B', p(1))]);
    expect(result.at).toBeCloseTo(55, 11);
    expect(result.candidates).toHaveLength(1);
    expect(result.witnesses[0]).toMatchObject({
      sourcePosition: p(),
      targetPosition: p(1),
      sourceFacing: p(0, 0, 1),
    });
    expect(result.witnesses[0]?.atGameMs).toBe(result.at);
    expect(result.candidates[0]?.at).toBe(result.at);
    expect(result.witnesses[0]?.contactId).toBe(
      result.candidates[0]?.contactId,
    );
  });
  test.each([
    { toi: 54.999, hit: true },
    { toi: 55, hit: false },
    { toi: 55.001, hit: false },
  ])('C2 active end excludes exact end: $toi', ({ toi, hit }) => {
    const source = armed(trajectory('A'), sphere(0), sphere(1), 55);
    const result = project([source, trajectory('B', p((toi + 45) / 100))]);
    expect(result.candidates.length > 0).toBe(hit);
    if (hit) expect(result.at).toBeCloseTo(toi, 10);
  });
  test('C3 accepted crouching posture keeps low proxy through attack/hit phase, both facings', () => {
    for (const sign of [-1, 1])
      for (const posture of ['standing', 'crouching'] as const) {
        const source = armed(
          trajectory('A', p(), p(0, 0, sign)),
          sphere(0, 1.6, 0.7),
        );
        const target = trajectory('B', p(0, 0, sign), p(0, 0, -sign), posture);
        expect(project([source, target]).candidates.length > 0).toBe(
          posture === 'standing',
        );
        expect(fightingHurtProxy(p(), posture).posture).toBe(posture);
      }
  });
  test('C4 returns complete exact-time clash and both body candidates, independent of array order', () => {
    const a = armed(trajectory('A'), sphere(0, 1, 0.6));
    const b = armed(
      trajectory('B', p(0, 0, 1), p(0, 0, -1)),
      sphere(0, 1, 0.6),
    );
    for (const actors of [
      [a, b],
      [b, a],
    ]) {
      const result = project(actors);
      expect(result.at).toBe(0);
      expect(result.candidates.map((c) => c.kind).sort()).toEqual([
        'body-hit',
        'body-hit',
        'clash',
      ]);
      expect(result.witnesses).toHaveLength(2);
    }
  });
  test('C5 returns simultaneous mutual body contacts without inventing a sphere clash', () => {
    const a = armed(trajectory('A'), sphere(0.2, 1, 0.7, 0.05));
    const b = armed(
      trajectory('B', p(0, 0, 1), p(0, 0, -1)),
      sphere(0.2, 1, 0.7, 0.05),
    );
    expect(project([a, b]).candidates.map((c) => c.kind)).toEqual([
      'body-hit',
      'body-hit',
    ]);
  });
  test('C6 suppresses only settled persistent episode, finds exact separation/re-entry and stable IDs', () => {
    const source = armed(trajectory('A'), sphere());
    const target = {
      ...trajectory('B'),
      path: [
        { at: 0, position: p() },
        { at: 20, position: p(1) },
        { at: 40, position: p() },
        { at: 100, position: p() },
      ],
    };
    const first = project([source, target]);
    expect(first.at).toBe(0);
    const next = project([source, target], {
      episodes: first.episodes,
      settledOccurrenceIds: first.occurrenceIds,
    });
    expect(next.at).toBeCloseTo(31, 11);
    expect(next.candidates[0]?.contactId).not.toBe(
      first.candidates[0]?.contactId,
    );
    const again = project([source, target], {
      episodes: first.episodes,
      settledOccurrenceIds: first.occurrenceIds,
    });
    expect(again.occurrenceIds).toEqual(next.occurrenceIds);
    expect(next.episodes[0]?.serial).toBe(1);
  });
  test('companion shapes share a single Core impact occurrence; no duplicate damage authority', () => {
    const a = armed(trajectory('A'), sphere(0, 1, 0.6));
    const impact = requirePhysicalValue(a.impacts[0]);
    const multi = {
      ...a,
      impacts: [
        {
          ...impact,
          shapes: [
            ...impact.shapes,
            { ...requirePhysicalValue(impact.shapes[0]), shapeId: 'companion' },
          ],
        },
      ],
    };
    expect(
      project([multi, trajectory('B', p(0, 0, 1))]).candidates,
    ).toHaveLength(1);
  });
  test('original E is body-inactive even for a settled point query', () => {
    const a = armed(trajectory('A'), sphere(0, 1, 0.6));
    const b = trajectory('B', p(0, 0, 1));
    expect(project([a, b], { from: 100, to: 100 }).candidates).toEqual([]);
  });
  test('fails closed for unsupported nonvertical laws and budget exhaustion, with unchanged episode input', () => {
    const capsule: HitVolume = {
      kind: 'capsule',
      start: p(0, 1, 0),
      end: p(1, 1, 0),
      radiusM: 0.1,
    };
    expect(() =>
      project([armed(trajectory('A'), capsule), trajectory('B', p(1))]),
    ).toThrow();
    const episodes: import('../../src/world/contact-candidates').FightingContactEpisode[] =
      [];
    expect(() =>
      project([armed(trajectory('A'), sphere()), trajectory('B')], {
        episodes,
        maxWork: 0,
      }),
    ).toThrow();
    expect(episodes).toEqual([]);
  });
});

describe('source-clock geometry point sampling', () => {
  const clock: FightingClock = {
    stepTick: tick(1),
    activeEpochId: 'e',
    slices: [
      {
        actorId: actorId('A'),
        epochId: 'e',
        clipId: clipId('declared'),
        activationId: null,
        fromGameMs: gameTimeMs(100),
        toGameMs: gameTimeMs(200),
        fromMotionMs: durationMs(50),
        toMotionMs: durationMs(150),
        frozen: false,
      },
    ],
  };
  test('T1 maps accepted motion clock without using attack.startedAt', () => {
    expect(fightingMotionAt(clock, 140)?.motionMs).toBe(90);
    expect(fightingMotionAt(clock, 200)).toBeNull();
    const frozen = {
      ...clock,
      slices: [
        {
          ...requirePhysicalValue(clock.slices[0]),
          fromMotionMs: durationMs(90),
          toMotionMs: durationMs(90),
          frozen: true,
        },
      ],
    };
    expect(fightingMotionAt(frozen, 175)?.motionMs).toBe(90);
  });
  test('T2 supplies actual epoch-local XZ and transforms root-stripped shape exactly once in both facings', () => {
    for (const sign of [-1, 1]) {
      const t = trajectory('A', p(0, 0, sign * 0.025), p(0, 0, sign));
      let query: import('../../src/contracts').FightingRecipeQuery | undefined;
      const sampler: FightingRecipeSamplerPort = {
        runId: run,
        actorId: t.actor.actorId,
        sample(q) {
          query = q;
          return {
            recipeVersion: 'actual53-ik-surface-v1',
            clipId: q.clipId,
            atMs: q.atMs,
            pose: [],
            support: [],
            durationMs: 200,
            active: true,
            intendedRoot: p(0, 0, 0.1),
            acceptedRoot: p(q.acceptedRoot.x, 0, q.acceptedRoot.z),
            shape: sphere(0, 1, 0.3),
          };
        },
        dispose() {},
      };
      const result = sampleFightingPoseGeometry({
        runId: run,
        sampler,
        clipId: clipId('declared'),
        phase: 'active',
        posture: 'standing',
        motionMs: 90,
        actor: t.actor,
        epochOrigin: p(),
        groundClearanceM: 0,
      });
      expect(query).toMatchObject({
        atMs: 90,
        acceptedRoot: { x: 0, z: 0.025 },
      });
      expect(result.worldShape).toMatchObject({
        center: p(0, 1, sign * 0.325),
      });
    }
  });
});

test('companion-only contact chooses the contacting surface point, not an inactive first companion', () => {
  const a = armed(trajectory('A'), sphere(10, 1, 0));
  const impact = requirePhysicalValue(a.impacts[0]);
  const multi = {
    ...a,
    impacts: [
      {
        ...impact,
        shapes: [
          ...impact.shapes,
          {
            shapeId: 'contacting',
            keys: [
              { at: 0, volume: sphere(0, 1, 0.6) },
              { at: 100, volume: sphere(0, 1, 0.6) },
            ],
          },
        ],
      },
    ],
  };
  const out = project([multi, trajectory('B', p(0, 0, 1))]);
  expect(out.candidates[0]?.point.x).toBeCloseTo(0, 12);
  expect(out.candidates[0]?.point.z).toBeCloseTo(0.7, 12);
});
test('episode IDs persist when the accepted cursor moves into the same episode', () => {
  const a = armed(trajectory('A'), sphere(0, 1, 0.6)),
    b = trajectory('B', p(0, 0, 1));
  const first = project([a, b]);
  const settled = project([a, b], {
    from: 0,
    to: 10,
    originalTo: 100,
    episodes: first.episodes,
    settledOccurrenceIds: first.occurrenceIds,
  });
  expect(settled.candidates).toEqual([]);
  const next = project([a, b], {
    from: 10,
    to: 20,
    originalTo: 100,
    episodes: settled.episodes,
    settledOccurrenceIds: first.occurrenceIds,
  });
  expect(next.candidates).toEqual([]);
  expect(next.episodes[0]?.serial).toBe(0);
  expect(next.episodes[0]?.onset).toBe(0);
});
test('actual separation followed by a query at the new epoch starts a new stable occurrence', () => {
  const a = armed(trajectory('A'), sphere(0, 1, 0.6)),
    b = trajectory('B', p(0, 0, 1));
  const first = project([a, b]);
  const changed = { ...b, epochId: 'B:accepted-new-hit-epoch' };
  const next = project([a, changed], {
    episodes: first.episodes,
    settledOccurrenceIds: first.occurrenceIds,
  });
  expect(next.candidates).toHaveLength(1);
  expect(next.candidates[0]?.contactId).not.toBe(
    first.candidates[0]?.contactId,
  );
});

test('point geometry query cannot be rewritten by the sampler to relabel an unaccepted root', () => {
  const t = trajectory('A', p(0, 0, 0.025));
  const sampler: FightingRecipeSamplerPort = {
    runId: run,
    actorId: t.actor.actorId,
    sample(q) {
      try {
        Object.assign(q.acceptedRoot, { z: 999 });
      } catch {}
      return {
        recipeVersion: 'actual53-ik-surface-v1',
        clipId: q.clipId,
        atMs: q.atMs,
        pose: [],
        support: [],
        durationMs: 200,
        active: true,
        intendedRoot: p(),
        acceptedRoot: p(q.acceptedRoot.x, 0, q.acceptedRoot.z),
        shape: sphere(),
      };
    },
    dispose() {},
  };
  const out = sampleFightingPoseGeometry({
    runId: run,
    sampler,
    clipId: clipId('declared'),
    phase: 'active',
    posture: 'standing',
    motionMs: 90,
    actor: t.actor,
    epochOrigin: p(),
    groundClearanceM: 0,
  });
  expect(out.query.acceptedRoot.z).toBe(0.025);
  expect(Object.isFrozen(out.query)).toBe(true);
  expect(Object.isFrozen(out.query.acceptedRoot)).toBe(true);
});

test('point geometry rejects a foreign run sampler before invoking it', () => {
  const t = trajectory('A');
  let invoked = false;
  const sampler: FightingRecipeSamplerPort = {
    runId: runId('foreign-run'),
    actorId: t.actor.actorId,
    sample() {
      invoked = true;
      throw new Error('foreign sampler invoked');
    },
    dispose() {},
  };
  expect(() =>
    sampleFightingPoseGeometry({
      runId: run,
      sampler,
      clipId: clipId('declared'),
      phase: 'active',
      posture: 'standing',
      motionMs: 90,
      actor: t.actor,
      epochOrigin: p(),
      groundClearanceM: 0,
    }),
  ).toThrow();
  expect(invoked).toBe(false);
});

test('finite declared geometry whose squared-distance arithmetic overflows fails closed instead of dropping contact', () => {
  expect(() =>
    project([
      armed(trajectory('A'), sphere(1e200), sphere(-1e200)),
      trajectory('B'),
    ]),
  ).toThrow();
});

describe('review fix1 declared-linear singleton boundaries', () => {
  function touching() {
    const a = armed(trajectory('A'), sphere(0, 1, 0, 0.15));
    const impact = requirePhysicalValue(a.impacts[0]);
    return {
      ...a,
      impacts: [
        {
          ...impact,
          shapes: [
            {
              shapeId: 'touch-retreat',
              keys: [
                { at: 0, volume: sphere(0, 1, 0, 0.15) },
                { at: 50, volume: sphere(0.5, 1, 0, 0.15) },
                { at: 100, volume: sphere(0, 1, 0, 0.15) },
              ],
            },
          ],
        },
      ],
    };
  }
  test('I3 internal key touch-and-retreat remains a body occurrence in both actor orders', () => {
    const a = touching(),
      b = trajectory('B', p(1));
    for (const ts of [
      [a, b],
      [b, a],
    ]) {
      const out = project(ts);
      expect(out.at).toBe(50);
      expect(out.candidates).toHaveLength(1);
      expect(out.witnesses[0]?.atGameMs).toBe(50);
      const settled = project(ts, {
        from: 50,
        to: 100,
        episodes: out.episodes,
        settledOccurrenceIds: out.occurrenceIds,
      });
      expect(settled.candidates).toEqual([]);
    }
  });
  test('I3 start touch then departure remains eligible without widening the active or original end', () => {
    const a = armed(
        trajectory('A'),
        sphere(0.5, 1, 0, 0.15),
        sphere(0, 1, 0, 0.15),
      ),
      b = trajectory('B', p(1));
    const out = project([a, b]);
    expect(out.at).toBe(0);
    expect(out.candidates).toHaveLength(1);
    const touch = touching();
    expect(project([touch, b], { from: 50, to: 50 }).candidates).toHaveLength(
      1,
    );
    expect(
      project([touch, b], { from: 50, to: 50, originalTo: 50 }).candidates,
    ).toEqual([]);
    expect(
      project(
        [
          {
            ...touch,
            impacts: touch.impacts.map((i) => ({ ...i, activeTo: 50 })),
          },
          b,
        ],
        { from: 50, to: 50 },
      ).candidates,
    ).toEqual([]);
  });
  test('I3 partial horizon owns its touch endpoint when strictly before original E', () => {
    const a = armed(
        trajectory('A'),
        sphere(0, 1, 0, 0.15),
        sphere(1, 1, 0, 0.15),
      ),
      b = trajectory('B', p(1));
    const out = project([a, b], { to: 50 });
    expect(out.at).toBe(50);
    expect(out.candidates).toHaveLength(1);
  });
  test('M1 declared linear sweeps reject a collapsed, nonhorizontal or nonunit fixed facing before evidence', () => {
    for (const facing of [p(), p(0, 1, 0), p(0, 0, 2)]) {
      const a = armed(trajectory('A'), sphere());
      expect(() =>
        project([{ ...a, actor: { ...a.actor, facing } }, trajectory('B')]),
      ).toThrow();
    }
    const malformed = armed(trajectory('A'), sphere());
    Reflect.set(malformed, 'posture', 'not-a-posture');
    expect(() => project([malformed, trajectory('B')])).toThrow();
  });
});
