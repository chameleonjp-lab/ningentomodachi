import { expect, test } from 'vitest';
import { createDamageTimeline } from '../../src/ui/damageTimeline';
import {
  actor,
  frame,
  opponent,
  player,
  run,
  snapshot,
  viewport,
} from './fixtures/core';
import {
  batchId,
  vehicleId,
  launchId,
  contactId,
  domainEventId,
  gameTimeMs,
  presentationTimeMs,
  runId,
  type HpChanged,
  type Projection,
} from '../../src/contracts';
function loss(
  sequence = 1,
  target = player,
  before = 500,
  after = 450,
  max = 500,
): HpChanged {
  return {
    type: 'HpChanged',
    runId: run,
    eventId: domainEventId(`event-${sequence}`),
    sequence,
    at: gameTimeMs(0),
    actorId: target,
    maxHp: max,
    beforeHp: before,
    afterHp: after,
    actualHpLost: before - after,
    batchId: batchId('batch'),
    cause: {
      kind: 'vehicle',
      actorId: opponent,
      vehicleId: vehicleId('car'),
      launchId: launchId('launch'),
    },
    contact: {
      contactId: contactId('contact'),
      point: { x: 1, y: 0, z: 0 },
      impacts: [],
    },
  };
}
function projection(event: HpChanged): Projection {
  return {
    runId: run,
    eventId: event.eventId,
    actorId: event.actorId,
    viewportRevision: viewport.revision,
    visibility: 'visible',
    cssPoint: { x: 150, y: 400 },
  };
}
const at = (time: number, hp = 450) =>
  snapshot({
    revision: time + 1,
    actors: [actor(player, hp), actor(opponent, 700, 700)],
    clocks: {
      ...snapshot().clocks,
      presentationTimeMs: presentationTimeMs(time),
    },
  });
test('real loss changes green immediately; red precedes absorption then shrinks on authority time only', () => {
  const t = createDamageTimeline(run);
  const event = loss();
  t.update(frame({ snapshot: at(0), events: [event] }), [projection(event)]);
  let view = t.read(player);
  if (!view) throw Error('Missing player');
  expect(view.hp).toBe(450);
  expect(view.greenRatio).toBe(0.9);
  expect(view.losses[0]).toMatchObject({ low: 0.9, high: 1, phase: 'red' });
  expect(view.shakePx).toBeGreaterThan(0);
  t.update(frame({ snapshot: at(200) }), []);
  view = t.read(player);
  if (!view) throw Error('Missing player');
  expect(view.losses[0]?.phase).toBe('absorbing');
  expect(view.losses[0]?.origin).toEqual({ x: 150, y: 400 });
  t.update(frame({ snapshot: at(500) }), []);
  expect(t.read(player)?.losses[0]?.phase).toBe('shrinking');
  t.update(frame({ snapshot: at(700) }), []);
  expect(t.read(player)?.losses).toEqual([]);
  expect(t.read(player)?.hp).toBe(450);
});
test('zero damage has no fake effects; black70/700 and lethal clamp have correct red lengths', () => {
  const t = createDamageTimeline(run);
  const zero = loss(1, player, 500, 500);
  const black = loss(2, opponent, 700, 630, 700);
  t.update(frame({ events: [zero, black] }), []);
  expect(t.read(player)?.losses).toEqual([]);
  expect(t.read(opponent)?.losses[0]).toMatchObject({ low: 0.9, high: 1 });
  const lethal = { ...loss(3, player, 20, 0), actualHpLost: 100 };
  t.update(frame({ snapshot: at(1, 0), events: [lethal] }), []);
  expect(t.read(player)?.losses[0]).toMatchObject({ low: 0, high: 0.04 });
});
test('dedup is independent of snapshot revision; heal clears only target, old opponent and run cannot leak', () => {
  const t = createDamageTimeline(run);
  const first = loss();
  const second = loss(2, player, 450, 420);
  t.update(frame({ events: [first] }), []);
  t.update(frame({ events: [first, second] }), []);
  expect(t.read(player)?.losses).toHaveLength(2);
  t.update(
    frame({
      events: [
        {
          type: 'Healed',
          runId: run,
          eventId: domainEventId('heal'),
          sequence: 3,
          at: gameTimeMs(0),
          actorId: player,
          beforeHp: 420,
          afterHp: 500,
          maxHp: 500,
          actualHpGained: 80,
          batchId: batchId('batch'),
        },
      ],
    }),
    [],
  );
  expect(t.read(player)?.losses).toEqual([]);
  t.update(frame({ events: [{ ...loss(4), runId: runId('old') }] }), []);
  expect(t.read(player)?.losses).toEqual([]);
  t.update(frame({ events: [loss(5, opponent, 700, 600, 700)] }), []);
  t.update(
    frame({ snapshot: snapshot({ revision: 2, currentOpponentId: null }) }),
    [],
  );
  expect(t.read(opponent)).toBeNull();
});
test('stale, offscreen or mismatched projection is skipped without dropping HP update', () => {
  for (const change of [
    { viewportRevision: 0 },
    { actorId: opponent },
    { runId: runId('old') },
    { visibility: 'offscreen' as const },
    { cssPoint: { x: -1, y: 5 } },
  ]) {
    const t = createDamageTimeline(run);
    const event = loss();
    t.update(frame({ snapshot: at(0), events: [event] }), [
      { ...projection(event), ...change },
    ]);
    expect(t.read(player)?.hp).toBe(450);
    expect(t.read(player)?.losses[0]?.origin).toBeNull();
  }
});
test('terminal deadlines truncate queued display and frozen clock does not advance; viewport invalidates flight', () => {
  const t = createDamageTimeline(run);
  const event = loss();
  t.update(frame({ snapshot: at(0), events: [event] }), [projection(event)]);
  const state = {
    ...at(100),
    presentation: {
      kind: 'defeat-slow' as const,
      actorId: player,
      startedAt: presentationTimeMs(0),
      endsAt: presentationTimeMs(300),
    },
  };
  t.update(
    frame({ snapshot: state, viewport: { ...viewport, revision: 2 } }),
    [],
  );
  expect(t.read(player)?.losses[0]?.origin).toBeNull();
  const before = t.read(player);
  t.update(frame({ snapshot: state }), []);
  expect(t.read(player)).toEqual(before);
  t.update(
    frame({
      snapshot: {
        ...state,
        revision: 301,
        clocks: {
          ...state.clocks,
          presentationTimeMs: presentationTimeMs(300),
        },
      },
    }),
    [],
  );
  expect(t.read(player)?.losses).toEqual([]);
});
test('effect budget bounds display only without changing authoritative HP', () => {
  const t = createDamageTimeline(run);
  t.update(
    frame({
      snapshot: at(0, 400),
      events: Array.from({ length: 100 }, (_, i) =>
        loss(i + 1, player, 500 - i, 499 - i),
      ),
    }),
    [],
  );
  expect(t.read(player)?.hp).toBe(400);
  expect(t.read(player)?.losses.length).toBeLessThanOrEqual(16);
});
test('replayed event identity cannot create a second effect even with a newer sequence', () => {
  const t = createDamageTimeline(run);
  const event = loss();
  t.update(frame({ events: [event] }), []);
  t.update(frame({ events: [{ ...event, sequence: 2 }] }), []);
  expect(t.read(player)?.losses).toHaveLength(1);
});

test('finish stage retains same defeated HUD through1625 but never extends completed loss animation', () => {
  const t = createDamageTimeline(run);
  const event = loss(1, opponent, 50, 0, 700);
  const initial = snapshot({
    actors: [actor(), { ...actor(opponent, 0, 700), defeated: true }],
    currentOpponentId: null,
    presentation: {
      kind: 'opponent-defeat',
      actorId: opponent,
      startedAt: presentationTimeMs(0),
      endsAt: presentationTimeMs(1500),
    },
  });
  t.update(frame({ snapshot: initial, events: [event] }), [projection(event)]);
  expect(t.read(opponent)?.losses).toHaveLength(1);
  for (const now of [1500, 1624]) {
    const next = {
      ...initial,
      revision: now,
      clocks: {
        ...initial.clocks,
        presentationTimeMs: presentationTimeMs(now),
      },
      presentation: {
        kind: 'opponent-defeat-finish' as const,
        actorId: opponent,
        startedAt: presentationTimeMs(0),
        endsAt: presentationTimeMs(1625),
      },
    };
    t.update(frame({ snapshot: next }), []);
    expect(t.read(opponent)).toMatchObject({ hp: 0, maxHp: 700, losses: [] });
  }
  t.update(
    frame({
      snapshot: {
        ...initial,
        revision: 1625,
        clocks: {
          ...initial.clocks,
          presentationTimeMs: presentationTimeMs(1625),
        },
        presentation: {
          kind: 'opponent-defeat-finish',
          actorId: opponent,
          startedAt: presentationTimeMs(0),
          endsAt: presentationTimeMs(1625),
        },
      },
    }),
    [],
  );
  expect(t.read(opponent)).toBeNull();
});
