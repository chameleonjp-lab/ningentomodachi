import { type Camera, Group, type Scene } from 'three';
import { expect, test } from 'vitest';
import {
  actorId,
  attackActivationId,
  batchId,
  type CommittedFrame,
  contactId,
  type DomainEvent,
  domainEventId,
  gameTimeMs,
  impactId,
} from '../../src/contracts';
import { createSceneAdapter, type SceneRenderer } from '../../src/scene';
import { run, state, viewport } from '../world/fixtures';

function harness() {
  let draws = 0,
    disposed = 0,
    scene: Scene | undefined;
  const target = new EventTarget();
  let interruptions = 0;
  const renderer: SceneRenderer = {
    domElement: target as HTMLCanvasElement,
    render(s: Scene, _c: Camera) {
      scene = s;
      draws++;
    },
    dispose() {
      disposed++;
    },
    setPixelRatio() {},
    setSize() {},
  };
  const adapter = createSceneAdapter(
    {
      runId: run,
      seed: 1,
      viewport: { read: () => viewport, subscribe: () => () => {} },
    },
    {
      createRenderer: () => renderer,
      onInterruption: () => {
        interruptions++;
      },
    },
  );
  const commit = () => {
    const snapshot = state();
    const spatial = adapter.commit({ snapshot, events: [] }, viewport);
    return { snapshot, events: [], spatial, viewport } satisfies CommittedFrame;
  };
  return {
    adapter,
    commit,
    target,
    read: () => ({ draws, disposed, scene, interruptions }),
  };
}
test('one shared scene draw and committed physical parent preserve B node spin', () => {
  const h = harness(),
    frame = h.commit(),
    node = new Group();
  node.rotation.y = 2;
  const detach = h.adapter.renderHost.mountActor({
    runId: run,
    actorId: actorId('white'),
    node,
  });
  h.adapter.render(frame);
  h.adapter.render(frame);
  expect(h.read().draws).toBe(2);
  expect(node.rotation.y).toBe(2);
  expect(node.parent?.position.z).toBe(0);
  expect(() =>
    h.adapter.renderHost.mountActor({
      runId: run,
      actorId: actorId('white'),
      node: new Group(),
    }),
  ).toThrow();
  detach();
  detach();
  expect(node.parent).toBeNull();
  h.adapter.dispose();
  h.adapter.dispose();
  expect(h.read().disposed).toBe(1);
  expect(() =>
    h.adapter.renderHost.mountActor({
      runId: run,
      actorId: actorId('white'),
      node,
    }),
  ).toThrow();
});
test('context loss requests interruption, restoration never resumes or starts another loop', () => {
  const h = harness();
  h.target.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  h.target.dispatchEvent(new Event('webglcontextrestored'));
  expect(h.read().interruptions).toBe(1);
  expect(h.read().draws).toBe(0);
  h.adapter.dispose();
  h.target.dispatchEvent(new Event('webglcontextlost'));
  expect(h.read().interruptions).toBe(1);
});
test('gesture basis stays held through camera transition and cannot be reused', () => {
  const h = harness();
  const basis = h.adapter.beginMovementSession('held');
  const frame = h.commit();
  h.adapter.render(frame);
  expect(basis.right).toEqual({ x: -1, y: 0, z: 0 });
  expect(basis.depth).toEqual({ x: 0, y: 0, z: 1 });
  h.adapter.endMovementSession('held', 'released');
  expect(() => h.adapter.beginMovementSession('held')).toThrow();
  const next = h.adapter.beginMovementSession('new');
  expect(next.revision).toBeGreaterThan(basis.revision);
  h.adapter.dispose();
});
test('only confirmed hit points project with run actor event and shared CSS revision', () => {
  const h = harness();
  const frame = h.commit();
  h.adapter.render(frame);
  expect(h.adapter.project(frame)).toEqual([]);
  const event: DomainEvent = {
    type: 'HpChanged',
    sequence: 1,
    eventId: domainEventId('hit'),
    runId: run,
    at: gameTimeMs(0),
    actorId: actorId('blue'),
    beforeHp: 500,
    afterHp: 490,
    actualHpLost: 10,
    maxHp: 500,
    batchId: batchId('batch'),
    cause: {
      kind: 'attack',
      actorId: actorId('white'),
      activationId: attackActivationId('attack'),
      impactId: impactId('impact'),
      category: 'kick',
    },
    contact: {
      contactId: contactId('contact'),
      point: { x: 0, y: 1, z: 8 },
      impacts: [],
    },
  };
  const next = { ...frame, events: [event] };
  h.adapter.commit(next, viewport);
  h.adapter.render(next);
  const p = h.adapter.project(next)[0];
  expect(p?.eventId).toBe('hit');
  expect(p?.actorId).toBe('blue');
  expect(p?.viewportRevision).toBe(0);
  expect(p?.visibility).toBe('visible');
  h.adapter.commit(next, viewport);
  h.adapter.render(next);
  expect(
    h.read().scene?.getObjectByName('world-effects')?.children.length,
  ).toBe(1);
  h.adapter.dispose();
});
test('a mounted actor stays hidden until its committed pose exists', () => {
  const h = harness(),
    node = new Group();
  h.adapter.renderHost.mountActor({
    runId: run,
    actorId: actorId('white'),
    node,
  });
  expect(node.parent?.visible).toBe(false);
  h.commit();
  expect(node.parent?.visible).toBe(true);
  h.adapter.dispose();
});
test('an unrendered viewport cannot fabricate a screen projection', () => {
  const h = harness(),
    frame = h.commit();
  const event: DomainEvent = {
    type: 'HpChanged',
    sequence: 1,
    eventId: domainEventId('unrendered'),
    runId: run,
    at: gameTimeMs(0),
    actorId: actorId('blue'),
    beforeHp: 500,
    afterHp: 490,
    actualHpLost: 10,
    maxHp: 500,
    batchId: batchId('batch'),
    cause: {
      kind: 'attack',
      actorId: actorId('white'),
      activationId: attackActivationId('attack'),
      impactId: impactId('impact'),
      category: 'kick',
    },
    contact: {
      contactId: contactId('contact'),
      point: { x: 0, y: 1, z: 8 },
      impacts: [],
    },
  };
  const next = { ...frame, events: [event] };
  h.adapter.commit(next, viewport);
  const p = h.adapter.project(next)[0];
  expect(p?.visibility).toBe('unprojectable');
  expect(p?.cssPoint).toBeNull();
  h.adapter.dispose();
});
test('factory failure unregisters context listeners and disposes the unreturned renderer', () => {
  const target = new EventTarget();
  let disposed = 0,
    interrupted = 0;
  const root = {
    appendChild() {
      throw new Error('root attach failed');
    },
  } as unknown as HTMLElement;
  expect(() =>
    createSceneAdapter(
      {
        runId: run,
        seed: 1,
        viewport: { read: () => viewport, subscribe: () => () => {} },
      },
      {
        root,
        onInterruption() {
          interrupted++;
        },
        createRenderer: () => ({
          domElement: target as HTMLCanvasElement,
          render() {},
          dispose() {
            disposed++;
          },
          setPixelRatio() {},
          setSize() {},
        }),
      },
    ),
  ).toThrow('root attach failed');
  target.dispatchEvent(new Event('webglcontextlost'));
  expect(disposed).toBe(1);
  expect(interrupted).toBe(0);
});
