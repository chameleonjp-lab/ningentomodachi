/** TEST ONLY: synthetic motion metadata and scene contacts. Not production source assets or C geometry. */
import { createGame } from '../../../src/app/createGame';
import { createCore } from '../../../src/core';
import { createInterface } from '../../../src/ui';
import {
  clipId,
  commandId,
  contactId,
  durationMs,
  gameTimeMs,
  type ActorColor,
  type CommittedFrame,
  type DomainEvent,
  type GameSnapshot,
  type GameplayCommand,
  type MotionDefinition,
  type MoveSet,
  type SpatialCandidate,
  type SpatialSnapshot,
  type ViewportMetrics,
} from '../../../src/contracts';
export const metrics: ViewportMetrics = {
  widthCssPx: 390,
  heightCssPx: 844,
  offsetLeftCssPx: 12,
  offsetTopCssPx: 20,
  devicePixelRatio: 3,
  safeAreaCssPx: { top: 47, right: 0, bottom: 34, left: 0 },
};
function metadata() {
  const definitions: MotionDefinition[] = [];
  for (const category of ['punch', 'kick'] as const)
    for (let i = 0; i < (category === 'punch' ? 12 : 19); i++)
      definitions.push({
        clipId: clipId(`test:${category}:${i}`),
        category,
        durationMs: durationMs(10),
        effectiveRangeM: 0.2,
        impacts: [
          {
            impactIndex: 0,
            startMs: durationMs(0),
            endMs: durationMs(10),
            damageShare: 1,
            shapeId: 'test-shape',
          },
        ],
        rootCurve: [
          {
            atMs: durationMs(0),
            position: { x: 0, y: 0, z: 0 },
            visualYawRad: 0,
          },
          {
            atMs: durationMs(10),
            position: { x: 0, y: 0, z: 0 },
            visualYawRad: 0,
          },
        ],
        sampling: {
          version: 1,
          sampleRateHz: 100,
          interpolation: 'piecewise-linear',
        },
      });
  const punches = definitions
    .filter((d) => d.category === 'punch')
    .map((d) => d.clipId);
  const kicks = definitions
    .filter((d) => d.category === 'kick')
    .map((d) => d.clipId);
  const moves: Record<ActorColor, MoveSet> = {
    white: { punches, kicks },
    black: { punches: [], kicks },
    blue: { punches: punches.slice(0, 4), kicks: kicks.slice(0, 4) },
    green: { punches: punches.slice(4, 8), kicks: kicks.slice(4, 8) },
    yellow: { punches: punches.slice(8, 12), kicks: kicks.slice(8, 12) },
  };
  return {
    moves,
    catalog: {
      list: () => definitions,
      get: (id: MotionDefinition['clipId']) =>
        definitions.find((d) => d.clipId === id),
    },
  };
}
export function pointer(
  target: HTMLElement,
  type: string,
  id: number,
  x = 80,
  y = 500,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
}
export function createIntegrationFixture(
  options: { failFirst?: boolean } = {},
) {
  const root = document.createElement('div');
  root.style.position = 'relative';
  document.body.append(root);
  const d = createInterface(root);
  const source = metadata();
  const events: DomainEvent[] = [];
  const frames: CommittedFrame[] = [];
  const intents: GameplayCommand[] = [];
  const sessions: string[] = [];
  const ended: string[] = [];
  let mode: 'none' | 'white' | 'enemy' | 'both' = 'none';
  let attempts = 0;
  let commandSequence = 0;
  let basisRevision = 1;
  let projectVisible = true;
  const spatial = (snapshot: GameSnapshot): SpatialSnapshot => ({
    runId: snapshot.runId,
    tick: snapshot.clocks.tick,
    vehicles: [],
    actors: snapshot.actors.map((a, i) => ({
      actorId: a.actorId,
      position: { x: i, y: 0, z: 0 },
      facing: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      locomotion: 'idle',
    })),
  });
  const game = createGame<never>(
    {
      ...d,
      core: (context) =>
        createCore(context, {
          ...source,
          enemyAi: (snapshot) => {
            if (
              (mode !== 'enemy' && mode !== 'both') ||
              !snapshot.currentOpponentId
            )
              return [];
            const actor = snapshot.actors.find(
              (a) => a.actorId === snapshot.currentOpponentId,
            );
            const category = actor?.color === 'black' ? 'kick' : 'punch';
            if (!actor?.actions[category].allowed) return [];
            return [
              {
                type: 'AttackRequested',
                runId: context.runId,
                actorId: actor.actorId,
                category,
                input: {
                  commandId: commandId(`test-enemy:${++commandSequence}`),
                  sequence: commandSequence,
                },
              },
            ];
          },
        }),
      catalog: () => ({
        ...source.catalog,
        prepare: async () => {
          attempts++;
          if (options.failFirst && attempts === 1)
            throw Error('TEST source unavailable');
        },
        sampleMotion: () => undefined,
        dispose: () => {},
      }),
      animation: () => ({ render: () => {}, dispose: () => {} }),
      spatial: (context) => ({
        renderHost: { runId: context.runId, mountActor: () => () => {} },
        beginMovementSession: (sessionId) => {
          sessions.push(sessionId);
          return {
            runId: context.runId,
            sessionId,
            revision: basisRevision,
            right: { x: 1, y: 0, z: 0 },
            depth: { x: 0, y: 0, z: 1 },
          };
        },
        endMovementSession: (sessionId) => {
          ended.push(sessionId);
        },
        step: (request) => {
          intents.push(...request.intents);
          const candidates: SpatialCandidate[] = [];
          const white = request.snapshot.actors.find(
            (a) => a.color === 'white',
          );
          const enemy = request.snapshot.actors.find(
            (a) => a.actorId === request.snapshot.currentOpponentId,
          );
          const attackers =
            mode === 'both'
              ? [white, enemy]
              : mode === 'white'
                ? [white]
                : mode === 'enemy'
                  ? [enemy]
                  : [];
          for (const attacker of attackers) {
            const target =
              attacker?.color === 'white' ? enemy?.actorId : white?.actorId;
            const attack = attacker?.attack;
            const binding = attack?.impactBindings[0];
            if (attacker && attack && binding && target) {
              const from = Math.max(
                attack.startedAt,
                request.snapshot.clocks.gameTimeMs - request.step.durationMs,
              );
              candidates.push({
                kind: 'body-hit',
                runId: context.runId,
                contactId: contactId(
                  `test-contact:${request.snapshot.clocks.tick}:${attacker.actorId}`,
                ),
                at: gameTimeMs(from),
                interval: {
                  from: gameTimeMs(from),
                  to: request.snapshot.clocks.gameTimeMs,
                },
                point: { x: 1, y: 1, z: 0 },
                evidence: 'overlap',
                source: {
                  actorId: attacker.actorId,
                  activationId: attack.activationId,
                  impactId: binding.impactId,
                },
                targetActorId: target,
              });
            }
          }
          return { snapshot: spatial(request.snapshot), candidates };
        },
        commit: (output) => spatial(output.snapshot),
        render: () => {},
        project: (frame) =>
          frame.events
            .filter((event) => event.type === 'HpChanged')
            .map((event) => ({
              runId: frame.snapshot.runId,
              eventId: event.eventId,
              actorId: event.actorId,
              viewportRevision: frame.viewport.revision,
              visibility: projectVisible
                ? ('visible' as const)
                : ('offscreen' as const),
              cssPoint: projectVisible ? { x: 150, y: 400 } : null,
            })),
        dispose: () => {},
      }),
      ui: (context) => {
        const ui = d.ui(context);
        return {
          render: (frame, projections) => {
            frames.push(frame);
            events.push(...frame.events);
            ui.render(frame, projections);
          },
          dispose: () => ui.dispose(),
        };
      },
    },
    { sessionId: 'd-integration', seed: 42, stepMs: 10, viewport: metrics },
  );
  const click = (label: string) => {
    const b = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === label,
    );
    if (!b) throw Error(`Missing button ${label}`);
    b.click();
  };
  const control = (name: 'punch' | 'kick' | 'jump' | 'move') => {
    const element = root.querySelector<HTMLElement>(
      name === 'move'
        ? '.nt-swipe'
        : `.nt-control:nth-of-type(${{ punch: 1, kick: 2, jump: 3 }[name]})`,
    );
    if (!element) throw Error('Missing control');
    return element;
  };
  const tap = (name: 'punch' | 'kick' | 'jump', id = 2) => {
    pointer(control(name), 'pointerdown', id);
    pointer(control(name), 'pointerup', id);
  };
  const bars = () => {
    root.querySelectorAll<HTMLElement>('.nt-hp').forEach((bar, i) => {
      bar.getBoundingClientRect = () => ({
        left: 12 + i * 200,
        top: 100,
        width: 100,
        height: 20,
        right: 112 + i * 200,
        bottom: 120,
        x: 12 + i * 200,
        y: 100,
        toJSON: () => ({}),
      });
    });
  };
  return {
    root,
    game,
    events,
    frames,
    intents,
    sessions,
    ended,
    click,
    tap,
    control,
    bars,
    setMode: (next: typeof mode) => {
      mode = next;
    },
    rotateBasis: () => {
      basisRevision++;
    },
    offscreen: () => {
      projectVisible = false;
    },
    dispose: () => {
      game.dispose();
      root.remove();
    },
  };
}
