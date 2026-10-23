import { expect, test } from 'vitest';
import {
  attackActivationId,
  clipId,
  durationMs,
  gameTimeMs,
  impactId,
  MOTION_SPACE,
  type HitVolume,
  type RunId,
} from '../../src/contracts';
import {
  combatContacts,
  type ActorTrajectory,
} from '../../src/world/contact-candidates';
import { requireValue } from '../../src/core/invariant';
import { actor, run } from './fixtures';

// Synthetic gameplay-model fixtures only. These values are not anatomical fits.
type TargetRegions =
  import('../../src/world/contact-candidates').CombatHurtRegions;
type Segment = import('../../src/world/combat-hurt').HurtRegionSegment;
const query = combatContacts;
const sphere = (x = 0, y = 2.2, z = 0): HitVolume => ({
  kind: 'sphere',
  center: { x, y, z },
  radiusM: 0.1,
});
function fixtures() {
  const actors: ActorTrajectory[] = (['white', 'blue'] as const).map(
    (color, i) => {
      const position = { x: 0, y: 0, z: i * 2 };
      return {
        state: {
          ...actor(color),
          attack: i
            ? null
            : {
                activationId: attackActivationId('activation'),
                clipId: clipId('kick'),
                category: 'kick',
                startedAt: gameTimeMs(0),
                consumedImpacts: [],
                impactBindings: [
                  { impactIndex: 0, impactId: impactId('first') },
                ],
              },
        },
        actor: {
          actorId: actor(color).actorId,
          position,
          facing: { x: 0, y: 0, z: 1 },
          velocity: { x: 0, y: 0, z: 0 },
          grounded: true,
          locomotion: 'idle',
        },
        path: [
          { at: 0, position },
          { at: 10, position },
        ],
        sample: i
          ? undefined
          : {
              clipId: clipId('kick'),
              fromMs: durationMs(0),
              toMs: durationMs(10),
              space: MOTION_SPACE,
              rootSegments: [],
              hitVolumeSegments: [
                {
                  impactIndex: 0,
                  shapeId: 'hand',
                  fromMs: durationMs(0),
                  toMs: durationMs(10),
                  activeWindow: {
                    startMs: durationMs(0),
                    endMs: durationMs(10),
                  },
                  from: sphere(0, 2.2, 0),
                  to: sphere(0, 2.2, 4),
                },
              ],
            },
      };
    },
  );
  const regions: TargetRegions[] = actors.map((target) => ({
    runId: run,
    target,
    sourceId: 'synthetic-source',
    poseId: 'synthetic-pose',
    space: 'actor-local-metres',
    interpolation: 'piecewise-linear',
    segments: [
      { partId: 'head', from: 0, to: 10, start: sphere(), end: sphere() },
    ],
  }));
  return { actors, regions };
}
function changeTarget(regions: TargetRegions[], segments: readonly Segment[]) {
  regions[1] = { ...requireValue(regions[1]), segments };
}

test('explicit head region hits above the unchanged legacy capsule', () => {
  const { actors, regions } = fixtures();
  expect(combatContacts(run, actors)).toEqual([]);
  const hits = query(run, actors, regions);
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({
    kind: 'body-hit',
    targetActorId: actor('blue').actorId,
  });
  expect(hits[0]?.at).toBeCloseTo(4.5, 6);
});

test('near misses remain clear on both lateral sides and above the head', () => {
  for (const shape of [sphere(-0.25), sphere(0.25), sphere(0, 2.45)]) {
    const { actors, regions } = fixtures();
    changeTarget(regions, [
      { partId: 'head', from: 0, to: 10, start: shape, end: shape },
    ]);
    expect(query(run, actors, regions)).toEqual([]);
  }
});

test('overlapping parts select one deterministic earliest contact independent of order', () => {
  const { actors, regions } = fixtures();
  const head = requireValue(requireValue(regions[1]).segments[0]);
  const parts = [head, { ...head, partId: 'torso' }];
  changeTarget(regions, parts);
  const first = query(run, actors, regions);
  changeTarget(regions, [...parts].reverse());
  expect(first).toHaveLength(1);
  expect(query(run, actors, regions)).toStrictEqual(first);
});

test('initial overlap is emitted at original interval start', () => {
  const { actors, regions } = fixtures();
  const shape = sphere(0, 2.2, -2);
  changeTarget(regions, [
    { partId: 'head', from: 0, to: 10, start: shape, end: shape },
  ]);
  expect(query(run, actors, regions)[0]?.at).toBe(0);
});

test('region discontinuity is not swept through an artificial connecting chord', () => {
  const { actors, regions } = fixtures();
  changeTarget(regions, [
    { partId: 'head', from: 0, to: 5, start: sphere(-1), end: sphere(-1) },
    { partId: 'head', from: 5, to: 10, start: sphere(1), end: sphere(1) },
  ]);
  expect(query(run, actors, regions)).toEqual([]);
});

test('a supplied empty or missing region set rejects rather than using legacy geometry', () => {
  const { actors, regions } = fixtures();
  expect(() => query(run, actors, [])).toThrow();
  expect(() => query(run, actors, regions.slice(0, 1))).toThrow();
  changeTarget(regions, []);
  expect(() => query(run, actors, regions)).toThrow();
});

test('gapped or overlapping same-part interval coverage rejects', () => {
  for (const boundary of [4, 6]) {
    const { actors, regions } = fixtures();
    const head = requireValue(requireValue(regions[1]).segments[0]);
    changeTarget(regions, [
      { ...head, to: boundary },
      { ...head, from: 5 },
    ]);
    expect(() => query(run, actors, regions)).toThrow();
  }
});

test('wrong run and detached stale target identity reject', () => {
  for (const stale of [false, true]) {
    const { actors, regions } = fixtures();
    regions[1] = stale
      ? { ...requireValue(regions[1]), target: { ...requireValue(actors[1]) } }
      : { ...requireValue(regions[1]), runId: 'wrong-run' as RunId };
    expect(() => query(run, actors, regions)).toThrow();
  }
});

test('invalid geometry and undeclared provenance reject before returning candidates', () => {
  for (const invalid of ['geometry', 'source', 'pose'] as const) {
    const { actors, regions } = fixtures();
    if (invalid === 'geometry') {
      const head = requireValue(requireValue(regions[1]).segments[0]);
      changeTarget(regions, [{ ...head, end: sphere(Number.NaN) }]);
    } else
      regions[1] = {
        ...requireValue(regions[1]),
        [invalid === 'source' ? 'sourceId' : 'poseId']: '',
      };
    expect(() => query(run, actors, regions)).toThrow();
  }
});

test('separate combo impacts are not globally collapsed', () => {
  const { actors, regions } = fixtures();
  const first = requireValue(actors[0]);
  const attack = requireValue(first.state.attack);
  const sample = requireValue(first.sample);
  actors[0] = {
    ...first,
    state: {
      ...first.state,
      attack: {
        ...attack,
        impactBindings: [
          ...attack.impactBindings,
          { impactIndex: 1, impactId: impactId('second') },
        ],
      },
    },
    sample: {
      ...sample,
      hitVolumeSegments: [
        ...sample.hitVolumeSegments,
        { ...requireValue(sample.hitVolumeSegments[0]), impactIndex: 1 },
      ],
    },
  };
  regions[0] = { ...requireValue(regions[0]), target: requireValue(actors[0]) };
  const hits = query(run, actors, regions).filter((c) => c.kind === 'body-hit');
  expect(hits.map((c) => c.source.impactId).sort()).toEqual([
    'first',
    'second',
  ]);
});

test('attack sweep beyond otherwise valid target path coverage rejects', () => {
  const { actors, regions } = fixtures();
  const attacker = requireValue(actors[0]);
  const sample = requireValue(attacker.sample);
  actors[0] = {
    ...attacker,
    sample: {
      ...sample,
      toMs: durationMs(20),
      hitVolumeSegments: sample.hitVolumeSegments.map((h) => ({
        ...h,
        toMs: durationMs(20),
        activeWindow: { startMs: durationMs(0), endMs: durationMs(20) },
      })),
    },
  };
  regions[0] = { ...requireValue(regions[0]), target: requireValue(actors[0]) };
  expect(() => query(run, actors, regions)).toThrow(
    'Incomplete hurt region coverage',
  );
});

test('a discontinuous seam point belongs to the right-hand interval', () => {
  const { actors, regions } = fixtures();
  changeTarget(regions, [
    { partId: 'head', from: 0, to: 5, start: sphere(1), end: sphere(1) },
    { partId: 'head', from: 5, to: 10, start: sphere(), end: sphere() },
  ]);
  const hits = query(run, actors, regions);
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ at: 5, interval: { from: 5, to: 10 } });
});

test('moving capsule uses relative motion instead of its static first pose', () => {
  const { actors, regions } = fixtures();
  const capsule = (z: number): HitVolume => ({
    kind: 'capsule',
    start: { x: 0, y: 2.1, z },
    end: { x: 0, y: 2.3, z },
    radiusM: 0.1,
  });
  changeTarget(regions, [
    { partId: 'head', from: 0, to: 10, start: capsule(1), end: capsule(-1) },
  ]);
  const hits = query(run, actors, regions);
  expect(hits).toHaveLength(1);
  expect(hits[0]?.at).toBeCloseTo(2.8 / 0.6, 6);
});

test('target facing and translated physical placement are applied exactly once', () => {
  const baseline = fixtures();
  const before = requireValue(query(run, baseline.actors, baseline.regions)[0]);
  const { actors, regions } = fixtures();
  for (let i = 0; i < actors.length; i++) {
    const current = requireValue(actors[i]);
    const position = { x: 7, y: 1, z: i ? 12 : 9 };
    actors[i] = {
      ...current,
      actor: {
        ...current.actor,
        position,
        facing: i ? { x: 1, y: 0, z: 0 } : current.actor.facing,
      },
      path: current.path.map((k) => ({ ...k, position })),
    };
    regions[i] = {
      ...requireValue(regions[i]),
      target: requireValue(actors[i]),
    };
  }
  changeTarget(regions, [
    { partId: 'head', from: 0, to: 10, start: sphere(1), end: sphere(1) },
  ]);
  const hits = query(run, actors, regions);
  expect(hits).toHaveLength(1);
  const after = requireValue(hits[0]);
  expect(after.at).toBeCloseTo(before.at, 6);
  expect(after.point.x).toBeCloseTo(before.point.x + 7, 6);
  expect(after.point.y).toBeCloseTo(before.point.y + 1, 6);
  expect(after.point.z).toBeCloseTo(before.point.z + 9, 6);
});
