import { Group } from 'three';
import { expect, test } from 'vitest';
import {
  actorId,
  durationMs,
  presentationTimeMs,
  type CommittedFrame,
} from '../../src/contracts';
import { createSceneAdapter, createParisStreetLayout } from '../../src/scene';
import { actor, run, state, viewport } from '../world/fixtures';
test('retirement hides excluded nodes, rejects obsolete replay and never recreates detached nodes', () => {
  let draws = 0;
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render() {
          draws++;
        },
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    },
  );
  const blue = new Group();
  let frees = 0;
  blue.addEventListener('removed', () => frees++);
  const detach = scene.renderHost.mountActor({
    runId: run,
    actorId: actorId('blue'),
    node: blue,
  });
  let revision = 0;
  const frame = (ids: string[]): CommittedFrame => {
    const snapshot = state(0, {
      revision: revision++,
      actors: [actor('white'), actor('blue'), actor('green')],
      residentActorIds: ids.map(actorId),
      currentOpponentId: actorId(ids[1] ?? 'blue'),
    });
    return {
      snapshot,
      spatial: scene.commit({ snapshot, events: [] }, viewport),
      events: [],
      viewport,
    };
  };
  try {
    const old = frame(['white', 'blue']);
    expect(() =>
      scene.renderHost.mountActor({
        runId: run,
        actorId: actorId('green'),
        node: new Group(),
      }),
    ).toThrow();
    scene.render(old);
    scene.render(old);
    expect(draws).toBe(2);
    const next = frame(['white', 'green']);
    expect(blue.parent!.parent!.visible).toBe(false);
    expect(() => scene.render(old)).toThrow();
    expect(draws).toBe(2);
    detach();
    detach();
    expect(frees).toBe(1);
    expect(blue.parent).toBeNull();
    expect(() =>
      scene.renderHost.mountActor({
        runId: run,
        actorId: actorId('blue'),
        node: blue,
      }),
    ).toThrow();
    scene.render(next);
    expect(draws).toBe(3);
    expect(blue.parent).toBeNull();
  } finally {
    scene.dispose();
  }
});

test('enemy finishing stage retains the original support clock and side-on camera until retirement', () => {
  const layout = createParisStreetLayout();
  const scene = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      layout: {
        ...layout,
        objects: [],
        vehicles: [],
        actorSpawns: {
          ...layout.actorSpawns,
          white: { x: 0, y: 0, z: 0 },
          blue: { x: 0, y: 2.3, z: 8 },
        },
      },
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render() {},
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    },
  );
  const node = new Group(),
    id = actorId('blue'),
    start = presentationTimeMs(100);
  const detach = scene.renderHost.mountActor({
    runId: run,
    actorId: id,
    node,
    defeatPoseSupport: 'bounds-v1',
  });
  try {
    for (const [elapsed, progress] of [
      [1500, 0.75],
      [1562.5, 0.875],
      [1625, 1],
    ]) {
      const base = state(0, {
        actors: [
          actor('white'),
          {
            ...actor('blue'),
            defeated: true,
            defeatPresentation: {
              category: 'kick',
              startedAt: start,
              slowDurationMs: durationMs(1500),
              playbackRate: 0.25,
            },
          },
        ],
        residentActorIds: [actorId('white'), id],
        currentOpponentId: null,
        presentation: {
          kind: 'opponent-defeat-finish',
          actorId: id,
          startedAt: start,
          endsAt: presentationTimeMs(1725),
        },
      });
      const snapshot = {
        ...base,
        clocks: {
          ...base.clocks,
          presentationTimeMs: presentationTimeMs(100 + elapsed!),
        },
      };
      const frame = {
        snapshot,
        spatial: scene.commit({ snapshot, events: [] }, viewport),
        events: [],
        viewport,
      };
      expect(
        scene.renderHost.publishDefeatPoseSupport?.({
          runId: run,
          actorId: id,
          defeatStartedAt: start,
          tick: snapshot.clocks.tick,
          presentationTimeMs: snapshot.clocks.presentationTimeMs,
          entryLocalMinY: -2.25,
          currentLocalBounds: {
            min: { x: -0.5, y: 0.002, z: -0.5 },
            max: { x: 0.5, y: 1, z: 0.5 },
          },
        }),
      ).toBe(true);
      scene.render(frame);
      expect(node.parent!.position.y + 2.3 + 0.002).toBeCloseTo(
        0.05 + (0.002 - 0.05) * progress!,
        9,
      );
      const basis = scene.beginMovementSession(`finish-${elapsed}`);
      expect(Math.abs(basis.right.z)).toBeGreaterThan(0.9);
      scene.endMovementSession(`finish-${elapsed}`, 'released');
    }
    const retired = state(0, {
      revision: 1,
      actors: [actor('white'), { ...actor('blue'), defeated: true }],
      residentActorIds: [actorId('white')],
      currentOpponentId: null,
    });
    scene.commit({ snapshot: retired, events: [] }, viewport);
    detach();
    expect(node.parent).toBeNull();
  } finally {
    scene.dispose();
  }
});
