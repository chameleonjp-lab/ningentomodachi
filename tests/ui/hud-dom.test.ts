// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { createInterface } from '../../src/ui';
import {
  frame,
  run,
  snapshot,
  viewport,
  player,
  opponent,
  actor,
} from './fixtures/core';
import {
  batchId,
  contactId,
  domainEventId,
  gameTimeMs,
  launchId,
  vehicleId,
  presentationTimeMs,
  type HpChanged,
  type Projection,
} from '../../src/contracts';
function loss(target = opponent): HpChanged {
  return {
    type: 'HpChanged',
    runId: run,
    eventId: domainEventId('damage'),
    sequence: 1,
    at: gameTimeMs(0),
    actorId: target,
    maxHp: 700,
    beforeHp: 700,
    afterHp: 630,
    actualHpLost: 70,
    batchId: batchId('damage'),
    cause: {
      kind: 'vehicle',
      actorId: player,
      vehicleId: vehicleId('car'),
      launchId: launchId('launch'),
    },
    contact: {
      contactId: contactId('hit'),
      point: { x: 1, y: 1, z: 1 },
      impacts: [],
    },
  };
}
function setup() {
  const root = document.createElement('div');
  document.body.append(root);
  let currentViewport = viewport;
  const factories = createInterface(root);
  const reader = { read: () => currentViewport, subscribe: () => () => {} };
  const host = factories.host(reader);
  const ui = factories.ui({
    runId: run,
    seed: 1,
    viewport: reader,
    request: () => {},
  });
  ui.render(frame(), []);
  const bars = root.querySelectorAll<HTMLElement>('.nt-hp');
  bars.forEach((bar, i) => {
    bar.getBoundingClientRect = () => ({
      x: 12 + i * 250,
      y: 100,
      left: 12 + i * 250,
      top: 100,
      right: 112 + i * 250,
      bottom: 120,
      width: 100,
      height: 20,
      toJSON: () => ({}),
    });
  });
  return {
    root,
    ui,
    host,
    setViewport: () => {
      currentViewport = { ...viewport, revision: 2 };
    },
    finish: () => {
      ui.dispose();
      host.dispose();
      root.remove();
    },
  };
}
test('DOM particles absorb only into damaged actor bar using root CSS offsets, not device pixels', () => {
  const s = setup();
  const event = loss();
  const projection: Projection = {
    runId: run,
    eventId: event.eventId,
    actorId: opponent,
    viewportRevision: 1,
    visibility: 'visible',
    cssPoint: { x: 150, y: 400 },
  };
  const base = snapshot({ actors: [actor(), actor(opponent, 630, 700)] });
  s.ui.render(frame({ snapshot: base, events: [event] }), [projection]);
  s.ui.render(
    frame({
      snapshot: {
        ...base,
        revision: 2,
        clocks: { ...base.clocks, presentationTimeMs: presentationTimeMs(380) },
      },
    }),
    [],
  );
  const particle = s.root.querySelector<HTMLElement>(
    '.nt-particle:not([hidden])',
  );
  expect(particle).not.toBeNull();
  const values = particle?.style.transform.match(
    /translate\(([^p]+)px,([^p]+)px\)/,
  );
  expect(Number(values?.[1])).toBeGreaterThan(275);
  expect(Number(values?.[1])).toBeLessThan(310);
  expect(Number(values?.[2])).toBeLessThan(140);
  expect(
    s.root.querySelectorAll('.nt-hp')[0]?.getAttribute('aria-valuenow'),
  ).toBe('500');
  expect(
    s.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
  ).toBe('630');
  s.finish();
});
test('a committed projection older than current DOM viewport must never fly, but keeps HP/red semantics', () => {
  const s = setup();
  s.setViewport();
  const event = loss();
  s.ui.render(frame({ events: [event] }), [
    {
      runId: run,
      eventId: event.eventId,
      actorId: opponent,
      viewportRevision: 1,
      visibility: 'visible',
      cssPoint: { x: 150, y: 400 },
    },
  ]);
  expect(s.root.querySelector('.nt-particle:not([hidden])')).toBeNull();
  expect(s.root.querySelector('.nt-hp-red:not([hidden])')).not.toBeNull();
  s.finish();
});
test('HUD no-tick permissions and clocks remain authoritative and disposal removes every particle/bar', () => {
  const s = setup();
  const locked = { allowed: false, reason: 'cooling-lock' } as const;
  s.ui.render(
    frame({
      snapshot: snapshot({
        actors: [
          {
            ...actor(),
            heat: { amount: 0, capacity: 7, lockedUntil: null },
            actions: { ...actor().actions, punch: locked },
          },
        ],
      }),
    }),
    [],
  );
  expect(
    s.root
      .querySelector('[aria-label="パンチ：冷却中"]')
      ?.getAttribute('aria-disabled'),
  ).toBe('true');
  s.ui.dispose();
  expect(s.root.querySelectorAll('.nt-particle,.nt-actor')).toHaveLength(0);
  s.finish();
});
test('stale snapshot cannot restore earlier attack permissions or opponent HUD', () => {
  const s = setup();
  const locked = { allowed: false, reason: 'cooling-lock' } as const;
  s.ui.render(
    frame({
      snapshot: snapshot({
        revision: 5,
        currentOpponentId: null,
        actors: [
          { ...actor(), actions: { ...actor().actions, punch: locked } },
        ],
      }),
    }),
    [],
  );
  s.ui.render(frame(), []);
  expect(
    s.root
      .querySelector('[aria-label="パンチ：冷却中"]')
      ?.getAttribute('aria-disabled'),
  ).toBe('true');
  expect(s.root.querySelectorAll('.nt-actor')).toHaveLength(1);
  s.finish();
});
test('larger confirmed loss increases particle density within the fixed pool, never changes actual HP', () => {
  const counts: number[] = [];
  for (const amount of [10, 350]) {
    const s = setup();
    const event = { ...loss(), afterHp: 700 - amount, actualHpLost: amount };
    s.ui.render(
      frame({
        snapshot: snapshot({
          actors: [actor(), actor(opponent, 700 - amount, 700)],
        }),
        events: [event],
      }),
      [
        {
          runId: run,
          eventId: event.eventId,
          actorId: opponent,
          viewportRevision: 1,
          visibility: 'visible',
          cssPoint: { x: 150, y: 400 },
        },
      ],
    );
    counts.push(s.root.querySelectorAll('.nt-particle:not([hidden])').length);
    expect(s.root.querySelectorAll('.nt-particle')).toHaveLength(64);
    expect(
      s.root.querySelectorAll('.nt-hp')[1]?.getAttribute('aria-valuenow'),
    ).toBe(String(700 - amount));
    s.finish();
  }
  expect(counts[1]).toBeGreaterThan(counts[0] ?? 0);
});
