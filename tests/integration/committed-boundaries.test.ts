import { expect, test } from 'vitest';
import {
  activeRealTimeMs,
  actorId,
  attackActivationId,
  batchId,
  contactId,
  domainEventId,
  durationMs,
  gameTimeMs,
  impactId,
  launchId,
  presentationTimeMs,
  runId,
  vehicleId,
  worldObjectId,
  type ActorState,
  type CommittedFrame,
  type DomainEvent,
  type EventEnvelope,
  type Projection,
  type SpatialActor,
  type SpatialCandidate,
  type TerminalResult,
} from '../../src/contracts';
import { createGame } from '../../src/app/createGame';
import { createScriptedCore } from '../core/fixtures/scriptedCore';
import { createFixturePorts } from '../core/fixtures/ports';
import { fixtureMotion } from '../core/fixtures/catalog';
const permitted = { allowed: true, reason: null } as const;
function actor(name: string, amount = 0, locked = false): ActorState {
  return {
    actorId: actorId(name),
    color: name === 'white' ? 'white' : 'blue',
    hp: 80,
    maxHp: 100,
    heat: {
      amount,
      capacity: 7,
      lockedUntil: locked ? activeRealTimeMs(3000) : null,
    },
    defeated: false,
    attack: {
      activationId: attackActivationId(`${name}:activation`),
      clipId: fixtureMotion.clipId,
      category: 'kick',
      startedAt: gameTimeMs(0),
      consumedImpacts: [],
      impactBindings: [
        { impactIndex: 0, impactId: impactId(`${name}:runtime-impact`) },
      ],
    },
    actions: {
      punch: locked ? { allowed: false, reason: 'cooling-lock' } : permitted,
      kick: locked ? { allowed: false, reason: 'cooling-lock' } : permitted,
      jump: permitted,
      move: permitted,
    },
  };
}
const result: TerminalResult = {
  outcome: 'clear',
  finalizedAt: gameTimeMs(20),
  score: {
    defeatedEnemies: 4,
    remainingHp: 80,
    survivalTime: gameTimeMs(20),
    clearTime: gameTimeMs(20),
    destructionPenalty: 100,
    streetDestructionRate: 0.25,
    vehicleDestructionRate: 0.5,
    total: 900,
  },
};

test('C joins two same-clip actors to A impact IDs and B/C/UI share the committed collision/world frame', async () => {
  const fixtures = createFixturePorts();
  let scripted: ReturnType<typeof createScriptedCore> | undefined;
  const frames: CommittedFrame[] = [];
  const contacts: SpatialCandidate[] = [];
  const animation = fixtures.factories.animation;
  const spatial = fixtures.factories.spatial;
  const white = actor('white');
  const blue = actor('blue');
  const pose: SpatialActor = {
    actorId: white.actorId,
    position: { x: 2, y: 0, z: 3 },
    facing: { x: 0, y: 0, z: 1 },
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
    locomotion: 'jump',
  };
  const wreck = vehicleId('car');
  const launch = launchId('approved-launch');
  let appliedWorld: unknown;
  const game = createGame(
    {
      ...fixtures.factories,
      core: (context) => {
        scripted = createScriptedCore(context);
        return scripted.core;
      },
      animation: (context) => ({
        ...animation(context),
        render: (frame) => frames.push(frame),
      }),
      spatial: (context) => ({
        ...spatial(context),
        step: (request, catalog) => {
          for (const state of request.snapshot.actors) {
            const attack = state.attack;
            if (!attack) continue;
            const sample = catalog.sampleMotion(
              attack.clipId,
              durationMs(100),
              durationMs(200),
            );
            for (const volume of sample?.hitVolumeSegments ?? []) {
              const binding = attack.impactBindings.find(
                (entry) => entry.impactIndex === volume.impactIndex,
              );
              if (!binding) throw new Error('Unbound A impact');
              contacts.push({
                kind: 'body-hit',
                runId: context.runId,
                contactId: contactId(`${state.actorId}:contact`),
                at: gameTimeMs(10),
                interval: { from: gameTimeMs(0), to: gameTimeMs(10) },
                point: { x: 1, y: 1, z: 1 },
                evidence: 'swept-shape',
                source: {
                  actorId: state.actorId,
                  activationId: attack.activationId,
                  impactId: binding.impactId,
                },
                targetActorId:
                  state.actorId === white.actorId
                    ? blue.actorId
                    : white.actorId,
              });
            }
          }
          return {
            snapshot: {
              runId: context.runId,
              tick: request.snapshot.clocks.tick,
              actors: [pose],
              vehicles: [
                {
                  vehicleId: wreck,
                  launchId: launch,
                  position: { x: 5, y: 0, z: 2 },
                  velocity: { x: 0, y: 0, z: 0 },
                  grounded: true,
                },
              ],
            },
            candidates: contacts,
          };
        },
        commit: (output) => {
          appliedWorld = output.snapshot.world;
          return {
            runId: context.runId,
            tick: output.snapshot.clocks.tick,
            actors: [pose],
            vehicles: [],
          };
        },
      }),
    },
    { sessionId: 'bc-boundary', seed: 1, stepMs: 10 },
  );
  await game.start();
  const initial = game.read();
  if (!initial || !scripted) throw new Error('Missing run');
  scripted.script({
    actors: [white, blue],
    world: {
      vehicles: [
        {
          vehicleId: wreck,
          hp: 0,
          maxHp: 10,
          broken: true,
          canLaunch: false,
          activeLaunchId: launch,
        },
      ],
      objects: [
        {
          objectId: worldObjectId('street-object'),
          durability: 3,
          maxDurability: 10,
          destroyed: false,
        },
      ],
    },
  });
  game.dispatch({ type: 'StartRequested', runId: initial.runId });
  game.advance(10);
  expect(
    contacts.map((candidate) =>
      candidate.kind === 'body-hit' ? candidate.source.impactId : null,
    ),
  ).toEqual([
    impactId('white:runtime-impact'),
    impactId('blue:runtime-impact'),
  ]);
  expect(frames.at(-1)?.spatial.actors[0]).toEqual(pose);
  expect(frames.at(-1)?.snapshot.world).toBe(appliedWorld);
  expect(frames.at(-1)?.snapshot.world.vehicles[0]).toMatchObject({
    broken: true,
    canLaunch: false,
  });
  expect(frames.at(-1)?.snapshot.world.objects[0]?.durability).toBe(3);
  game.dispose();
});

test('confirmed contact provenance distinguishes simultaneous clashes and HP loss from later healing', async () => {
  const fixtures = createFixturePorts();
  let scripted: ReturnType<typeof createScriptedCore> | undefined;
  const frames: CommittedFrame[] = [];
  const game = createGame(
    {
      ...fixtures.factories,
      core: (context) => {
        scripted = createScriptedCore(context);
        return scripted.core;
      },
      ui: () => ({ render: (frame) => frames.push(frame), dispose: () => {} }),
    },
    { sessionId: 'resolved', seed: 1 },
  );
  await game.start();
  const initial = game.read();
  if (!initial || !scripted) throw new Error('Missing run');
  const white = actor('white');
  const blue = actor('blue');
  const envelope = (sequence: number): EventEnvelope => ({
    sequence,
    eventId: domainEventId(`resolved:${sequence}`),
    runId: initial.runId,
    at: gameTimeMs(10),
  });
  const impacts = [white, blue].map((state) => {
    if (!state.attack?.impactBindings[0]) throw new Error('Missing mapping');
    return {
      actorId: state.actorId,
      activationId: state.attack.activationId,
      impactId: state.attack.impactBindings[0].impactId,
    };
  });
  const first = {
    contactId: contactId('first-contact'),
    point: { x: 1, y: 1, z: 1 },
    impacts,
  };
  const second = {
    ...first,
    contactId: contactId('second-contact'),
    point: { x: 2, y: 1, z: 1 },
  };
  const events: readonly DomainEvent[] = [
    {
      ...envelope(10),
      type: 'ClashResolved',
      firstActorId: white.actorId,
      secondActorId: blue.actorId,
      difference: 30,
      batchId: batchId('same-tick'),
      contact: first,
    },
    {
      ...envelope(11),
      type: 'ClashResolved',
      firstActorId: white.actorId,
      secondActorId: blue.actorId,
      difference: 0,
      batchId: batchId('same-tick'),
      contact: second,
    },
    {
      ...envelope(12),
      type: 'HpChanged',
      actorId: white.actorId,
      beforeHp: 100,
      afterHp: 70,
      actualHpLost: 30,
      maxHp: 100,
      batchId: batchId('same-tick'),
      contact: first,
      cause: {
        kind: 'clash',
        ...impacts[1],
        actorId: blue.actorId,
        activationId: attackActivationId('blue:activation'),
        impactId: impactId('blue:runtime-impact'),
        category: 'kick',
      },
    },
    {
      ...envelope(13),
      type: 'Healed',
      actorId: white.actorId,
      beforeHp: 70,
      afterHp: 80,
      actualHpGained: 10,
      maxHp: 100,
      batchId: batchId('same-tick'),
    },
    {
      ...envelope(14),
      type: 'OpponentChanged',
      previousActorId: blue.actorId,
      currentActorId: actorId('green-new-id'),
    },
  ];
  scripted.script(
    {
      actors: [
        { ...actor('white', 6.5), attack: null },
        { ...actor('blue', 0, true), attack: null },
      ],
      currentOpponentId: actorId('green-new-id'),
    },
    events,
  );
  game.advance(0);
  const frame = frames.at(-1);
  if (!frame) throw new Error('Missing committed frame');
  expect(frame.events.map((event) => event.sequence)).toEqual([
    10, 11, 12, 13, 14,
  ]);
  expect(
    frame.events
      .filter((event) => event.type === 'ClashResolved')
      .map((event) => event.contact.point.x),
  ).toEqual([1, 2]);
  expect(frame.snapshot.actors[0]?.actions.punch.allowed).toBe(true);
  expect(frame.snapshot.actors[1]?.actions.punch).toEqual({
    allowed: false,
    reason: 'cooling-lock',
  });
  // Synthetic D consumer: transport provides the exact ordering/identity, not inferred net HP loss.
  let lastSequence = 0;
  let loss = 0;
  let gain = 0;
  const stale = events.find((event) => event.type === 'HpChanged');
  if (!stale) throw new Error('Missing HP event');
  for (const event of [
    ...frame.events,
    ...frame.events,
    { ...stale, runId: runId('old-run') },
  ]) {
    if (
      event.runId !== frame.snapshot.runId ||
      !event.sequence ||
      event.sequence <= lastSequence
    )
      continue;
    lastSequence = event.sequence;
    if (event.type === 'HpChanged') loss += event.actualHpLost;
    if (event.type === 'Healed') gain += event.actualHpGained;
  }
  expect({ loss, gain }).toEqual({ loss: 30, gain: 10 });
  game.dispose();
});

test('A-owned presentation deadline survives paused/backgrounded time and low-fps result transition', async () => {
  const fixtures = createFixturePorts();
  let scripted: ReturnType<typeof createScriptedCore> | undefined;
  const game = createGame(
    {
      ...fixtures.factories,
      core: (context) => {
        scripted = createScriptedCore(context);
        return scripted.core;
      },
    },
    { sessionId: 'terminal-clock', seed: 1, stepMs: 10 },
  );
  await game.start();
  const initial = game.read();
  if (!initial || !scripted) throw new Error('Missing run');
  game.request({ type: 'StartRequested', requestId: 'start' });
  game.advance(3000); // Explicit UI start finishes its host countdown before gameplay.
  scripted.script({
    phase: 'terminal',
    result,
    actors: [actor('white', 6.5)],
    presentation: {
      kind: 'clear-slow',
      actorId: actorId('white'),
      startedAt: presentationTimeMs(0),
      endsAt: presentationTimeMs(2000),
    },
  });
  game.advance(500);
  game.dispatch({
    type: 'PauseRequested',
    runId: initial.runId,
    reason: 'settings',
  });
  game.advance(100000);
  expect(game.read()?.clocks.presentationTimeMs).toBe(500);
  game.dispatch({ type: 'Backgrounded', runId: initial.runId });
  game.dispatch({
    type: 'ResumeRequested',
    runId: initial.runId,
    reason: 'settings',
  });
  game.advance(100000);
  game.dispatch({ type: 'Foregrounded', runId: initial.runId });
  game.dispatch({
    type: 'ResumeRequested',
    runId: initial.runId,
    reason: 'interruption',
  });
  game.advance(1600);
  expect(game.hostState().phase).toBe('results');
  expect(game.read()?.result).toStrictEqual(result);
  expect(game.read()?.clocks.gameTimeMs).toBe(0);
  expect(game.read()?.clocks.activeRealTimeMs).toBe(0);
  expect(game.read()?.actors[0]?.heat.amount).toBe(6.5);
  expect(game.read()?.result?.score).toMatchObject({
    streetDestructionRate: 0.25,
    vehicleDestructionRate: 0.5,
  });
  game.request({ type: 'ReturnToTitleRequested', requestId: 'title' });
  game.request({ type: 'PrepareRequested', requestId: 'new-game' });
  await expect.poll(() => game.hostState().phase).toBe('ready');
  expect(game.read()?.runId).not.toBe(initial.runId);
  game.dispose();
});

test('shared viewport revision/root CSS coordinates allow stale hit flights to be skipped without losing HP', async () => {
  const fixtures = createFixturePorts();
  let scripted: ReturnType<typeof createScriptedCore> | undefined;
  let stale = false;
  let hp = 0;
  const origins: { x: number; y: number }[] = [];
  const revisions: number[] = [];
  const spatial = fixtures.factories.spatial;
  const game = createGame(
    {
      ...fixtures.factories,
      core: (context) => {
        scripted = createScriptedCore(context);
        return scripted.core;
      },
      spatial: (context) => ({
        ...spatial(context),
        project: (frame): readonly Projection[] => [
          {
            runId: context.runId,
            eventId: domainEventId('visible-hit'),
            actorId: actorId('white'),
            visibility: 'visible',
            cssPoint: { x: 40, y: 80 },
            viewportRevision: frame.viewport.revision - (stale ? 1 : 0),
          },
        ],
      }),
      ui: (context) => ({
        render: (frame, projections) => {
          revisions.push(context.viewport.read().revision);
          hp = frame.snapshot.actors[0]?.hp ?? 0;
          for (const projection of projections) {
            if (
              projection.viewportRevision ===
                context.viewport.read().revision &&
              projection.visibility === 'visible' &&
              projection.cssPoint
            )
              origins.push(projection.cssPoint);
          }
        },
        dispose: () => {},
      }),
    },
    { sessionId: 'viewport-contract', seed: 1 },
  );
  await game.start();
  if (!scripted) throw new Error('Missing scripted core');
  scripted.script({ actors: [actor('white')] });
  origins.length = 0;
  game.advance(0);
  expect(origins).toEqual([{ x: 40, y: 80 }]);
  stale = true;
  game.updateViewport({
    widthCssPx: 800,
    heightCssPx: 600,
    offsetLeftCssPx: 25,
    offsetTopCssPx: 10,
    devicePixelRatio: 2,
    safeAreaCssPx: { top: 0, right: 0, bottom: 10, left: 0 },
  });
  expect(game.viewport.read().offsetLeftCssPx).toBe(25);
  expect(revisions.at(-1)).toBe(game.viewport.read().revision);
  expect(origins).toHaveLength(1);
  expect(hp).toBe(80);
  game.dispose();
});
