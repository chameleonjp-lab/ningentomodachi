import { expect, test, vi } from 'vitest';
import {
  actorId,
  clipId,
  durationMs,
  MOTION_SPACE,
  type MotionIntervalSample,
  type SpatialActor,
} from '../../src/contracts';
import { stepCharacter } from '../../src/world/character-motor';
import { createParisStreetLayout } from '../../src/world/street-layout';
import * as shapes from '../../src/world/swept-shapes';
import { actor } from './fixtures';

const v = (x = 0, y = 0, z = 0) => ({ x, y, z }),
  layout = { ...createParisStreetLayout(), objects: [], vehicles: [] },
  state = actor('white');
const initial = (y = 0, vy = 0): SpatialActor => ({
  actorId: actorId('white'),
  position: v(0, y, 0),
  velocity: v(0, vy, 0),
  facing: v(0, 0, 1),
  grounded: y === 0,
  locomotion: y === 0 ? ('idle' as const) : ('jump' as const),
});

test('RED: a ceiling cancels ordinary jump momentum at contact, not after obstacle removal', () => {
  const box = { min: v(-3, 2.05, -3), max: v(3, 2.3, 3) };
  const hit = stepCharacter(
    initial(),
    state,
    0,
    100,
    v(),
    true,
    undefined,
    0,
    layout,
    [box],
  ).actor;
  expect(hit.velocity.y).toBeLessThanOrEqual(0);
  const removed = stepCharacter(
    hit,
    state,
    100,
    110,
    v(),
    false,
    undefined,
    0,
    layout,
    [],
  ).actor;
  expect(removed.position.y).toBeLessThanOrEqual(hit.position.y);
});
test('RED: a flat support cancels downward momentum before support disappears', () => {
  const box = { min: v(-3, 0, -3), max: v(3, 1, 3) };
  let p = initial(3, -2);
  for (let t = 0; t < 1000; t += 20)
    p = stepCharacter(p, state, t, t + 20, v(), false, undefined, 0, layout, [
      box,
    ]).actor;
  expect(p.position.y).toBeCloseTo(1, 7);
  expect(p.velocity.y).toBeCloseTo(0, 8);
});
const ceiling = { min: v(-3, 2.05, -3), max: v(3, 2.3, 3) };
const platform = { min: v(-1, 0, -1), max: v(1, 1, 1) };
const advance = (
  p: SpatialActor,
  from: number,
  to: number,
  boxes = [ceiling],
  movement = v(),
  jump = false,
  sample?: MotionIntervalSample,
) =>
  stepCharacter(p, state, from, to, movement, jump, sample, 0, layout, boxes);
test('flat ceiling uses the quadratic contact time and gravity during the remaining interval', () => {
  const result = advance(initial(), 0, 100, [ceiling], v(), true);
  const t = (5.5 - Math.sqrt(5.5 ** 2 - 2 * 9.81 * 0.2)) / 9.81;
  expect(result.path.some((k) => Math.abs(k.at - t * 1000) < 1e-6)).toBe(true);
  expect(result.actor.velocity.y).toBeCloseTo(-9.81 * (0.1 - t), 8);
  expect(result.actor.position.y).toBeCloseTo(0.2 - 4.905 * (0.1 - t) ** 2, 8);
});
test('support removal cannot grant another jump from a stale grounded snapshot', () => {
  const p = { ...initial(1), grounded: true };
  const result = advance(p, 0, 100, [], v(), true).actor;
  expect(result.velocity.y).toBeCloseTo(-0.981, 9);
  expect(result.position.y).toBeCloseTo(1 - 0.04905, 9);
  expect(result.grounded).toBe(false);
});
test('walking off elevated support resumes gravity instead of retaining ground state', () => {
  const result = advance(
    { ...initial(1), grounded: true },
    0,
    500,
    [platform],
    v(1, 0, 0),
  ).actor;
  expect(result.position.x).toBeCloseTo(2, 8);
  expect(result.position.y).toBeLessThan(0.99);
  expect(result.velocity.y).toBeLessThan(0);
  expect(result.grounded).toBe(false);
});
test('side wall cannot cancel vertical velocity', () => {
  const wall = { min: v(0.5, 0, -3), max: v(0.6, 10, 3) };
  const result = advance(initial(3, 2), 0, 100, [wall], v(1, 0, 0)).actor;
  expect(result.velocity.y).toBeCloseTo(2 - 0.981, 7);
  expect(result.position.y).toBeCloseTo(3 + 0.2 - 0.04905, 6);
});
test('free gravity and apex retain endpoint agreement across ordinary partitions', () => {
  const whole = advance(initial(10, 2), 0, 500, []).actor;
  for (const hz of [30, 60, 120]) {
    let p = initial(10, 2),
      time = 0;
    while (time < 500) {
      const end = Math.min(500, time + 1000 / hz);
      p = advance(p, time, end, []).actor;
      time = end;
    }
    expect(p.position.y).toBeCloseTo(whole.position.y, 10);
    expect(p.velocity.y).toBeCloseTo(whole.velocity.y, 10);
  }
});
function authoredRelease(): MotionIntervalSample {
  return {
    clipId: clipId('test-root'),
    fromMs: durationMs(0),
    toMs: durationMs(200),
    space: MOTION_SPACE,
    hitVolumeSegments: [],
    rootSegments: [
      {
        from: { atMs: durationMs(0), position: v(), visualYawRad: 0 },
        to: { atMs: durationMs(100), position: v(0, 1, 0), visualYawRad: 0 },
        deltaTranslation: v(0, 1, 0),
        horizontalOwner: 'authored-root',
        verticalOwner: 'authored-root',
        yawOwner: 'visual-only',
      },
    ],
  };
}
test('blocked authored ascent does not store transport velocity past ownership release', () => {
  const result = advance(
    initial(),
    0,
    200,
    [ceiling],
    v(),
    false,
    authoredRelease(),
  ).actor;
  expect(result.velocity.y).toBeLessThanOrEqual(0);
  const removed = advance(result, 200, 210, []).actor;
  expect(removed.position.y).toBeLessThanOrEqual(result.position.y);
});
test('normal, slow and long durations have bounded path work and consume the full interval', () => {
  for (const duration of [1000 / 60, 1000 / 240, 10_000]) {
    const result = advance(initial(1000), 0, duration, []);
    const slices = Math.min(256, Math.ceil((duration / 1000) * 240));
    expect(result.path.length).toBeLessThanOrEqual(2 * slices + 2);
    expect(result.path.at(-1)?.at).toBe(duration);
    expect(result.actor.position.y).toBeCloseTo(
      1000 - 4.905 * (duration / 1000) ** 2,
      7,
    );
    expect(result.actor.velocity.y).toBeCloseTo((-9.81 * duration) / 1000, 8);
  }
});

test('exact interval-end ceiling contact cancels velocity before obstacle removal', () => {
  const end = ((5.5 - Math.sqrt(5.5 ** 2 - 2 * 9.81 * 0.2)) / 9.81) * 1000;
  const result = advance(initial(), 0, end, [ceiling], v(), true).actor;
  expect(result.position.y).toBeCloseTo(0.2, 8);
  expect(result.velocity.y).toBeCloseTo(0, 7);
  expect(
    advance(result, end, end + 10, []).actor.position.y,
  ).toBeLessThanOrEqual(0.2);
});

test('rounded box edges are not promoted to an infinite flat supporting face', () => {
  const p = { ...initial(2, -1), position: v(1.2, 2, 0) };
  const result = advance(p, 0, 250, [platform]).actor;
  // Axis is outside the top footprint, so a flat-face y=1 snap is invalid.
  expect(result.position.y).toBeLessThan(1.5);
  expect(result.grounded).toBe(false);
  expect(result.position.y).toBeGreaterThan(1);
});
test('landing exactly at a top-face endpoint grounds without a delayed extra fall', () => {
  const end = Math.sqrt(2 / 9.81) * 1000;
  const result = advance(initial(2), 0, end, [platform]).actor;
  expect(result.position.y).toBeCloseTo(1, 7);
  expect(result.velocity.y).toBeCloseTo(0, 7);
  expect(result.grounded).toBe(true);
});
test('blocked jump contact agrees at admitted default and slow-step partitions', () => {
  const whole = advance(initial(), 0, 100, [ceiling], v(), true).actor;
  for (const step of [1000 / 60, 1000 / 240]) {
    let p = initial(),
      time = 0;
    while (time < 100) {
      const end = Math.min(100, time + step);
      p = advance(p, time, end, [ceiling], v(), time === 0).actor;
      time = end;
    }
    expect(p.position.y).toBeCloseTo(whole.position.y, 7);
    expect(p.velocity.y).toBeCloseTo(whole.velocity.y, 7);
  }
});

test('query budget is bounded for default, slow, and long public durations', () => {
  const query = vi.spyOn(shapes, 'sweepBox');
  try {
    const distant = { min: v(100, 0, 100), max: v(101, 1, 101) };
    for (const duration of [1000 / 60, 1000 / 240, 10_000]) {
      query.mockClear();
      advance(initial(1000), 0, duration, [distant]);
      expect(query.mock.calls.length).toBeLessThanOrEqual(
        Math.min(256, Math.ceil((duration / 1000) * 240)),
      );
    }
    query.mockClear();
    advance(initial(), 0, 100, [ceiling], v(), true);
    expect(query.mock.calls.length).toBeLessThanOrEqual(12 * 2 * 24);
  } finally {
    query.mockRestore();
  }
});

test('authored key and ownership release preserve free transport across partitions', () => {
  const sample = authoredRelease();
  for (const partitions of [[200], [50, 50, 50, 50], [17, 23, 60, 41, 59]]) {
    let p = initial(),
      time = 0;
    for (const dt of partitions) {
      p = advance(p, time, time + dt, [], v(), false, sample).actor;
      time += dt;
    }
    expect(p.position.y).toBeCloseTo(1 + 1 - 0.04905, 9);
    expect(p.velocity.y).toBeCloseTo(10 - 0.981, 9);
  }
});
test('zero-time ceiling contact cancels only inward motion; a departure remains free', () => {
  const blocked = advance(initial(0.2, 3), 0, 20, [ceiling]).actor;
  expect(blocked.velocity.y).toBeCloseTo(-9.81 * 0.02, 8);
  expect(blocked.position.y).toBeCloseTo(0.2 - 4.905 * 0.02 ** 2, 8);
  const departing = advance(initial(0.2, -1), 0, 20, [ceiling]).actor;
  expect(departing.velocity.y).toBeCloseTo(-1 - 0.1962, 8);
});
