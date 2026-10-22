import { Group, Vector3, type Camera } from 'three';
import { expect, test } from 'vitest';
import { deathClipSeconds } from '../../src/assets';
import {
  actorId,
  attackActivationId,
  batchId,
  contactId,
  domainEventId,
  gameTimeMs,
  impactId,
  type DomainEvent,
  durationMs,
  presentationTimeMs,
  tick,
  type CommittedFrame,
  type DefeatPoseSupportObservation,
} from '../../src/contracts';
import { createSceneAdapter, createParisStreetLayout } from '../../src/scene';
import { actor, run, state, viewport } from '../world/fixtures';

// Contract-only source fixtures. These are NOT measured/source-qualified B bounds.
function harness(slowDuration = 2000, physicalY = 2.3) {
  let draws = 0,
    camera: Camera | undefined;
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
          white: { x: 0, y: physicalY, z: 0 },
        },
      },
      onInterruption() {},
      createRenderer: () => ({
        domElement: new EventTarget() as HTMLCanvasElement,
        render(s, c) {
          draws++;
          camera = c;
          s.updateMatrixWorld(true);
          c.updateMatrixWorld(true);
        },
        dispose() {},
        setSize() {},
        setPixelRatio() {},
      }),
    },
  );
  const node = new Group();
  const death = {
    category: 'kick' as const,
    startedAt: presentationTimeMs(100),
    slowDurationMs: durationMs(slowDuration),
    playbackRate: 0.25 as const,
  };
  function frame(elapsed: number): CommittedFrame {
    const base = state(5, {
      actors: [
        { ...actor('white'), defeated: true, defeatPresentation: death },
      ],
      currentOpponentId: null,
    });
    const snapshot = {
      ...base,
      clocks: {
        ...base.clocks,
        presentationTimeMs: presentationTimeMs(100 + elapsed),
      },
    };
    return {
      snapshot,
      spatial: scene.commit({ snapshot, events: [] }, viewport),
      events: [],
      viewport,
    };
  }
  const detach = scene.renderHost.mountActor({
    runId: run,
    actorId: actorId('white'),
    node,
    defeatPoseSupport: 'bounds-v1',
  });
  function observation(
    f: CommittedFrame,
    minY = -2.25,
  ): DefeatPoseSupportObservation {
    return {
      runId: run,
      actorId: actorId('white'),
      defeatStartedAt: death.startedAt,
      tick: f.snapshot.clocks.tick,
      presentationTimeMs: f.snapshot.clocks.presentationTimeMs,
      entryLocalMinY: -2.25,
      currentLocalBounds: {
        min: { x: -3, y: minY, z: -0.5 },
        max: { x: 4, y: minY + 1.7, z: 0.5 },
      },
    };
  }
  const publish = (o: DefeatPoseSupportObservation) =>
    scene.renderHost.publishDefeatPoseSupport?.(o);
  return {
    scene,
    node,
    death,
    frame,
    observation,
    publish,
    detach,
    draws: () => draws,
    camera: () => camera,
  };
}
for (const slow of [1500, 2000])
  test(`one world support trajectory compensates local canonicalization, slow=${slow}`, () => {
    const h = harness(slow);
    try {
      const saved: {
        frame: CommittedFrame;
        observation: DefeatPoseSupportObservation;
        offset: number;
      }[] = [];
      for (const elapsed of [0, 200, 400, 1000, 1500, 1625, 1999, 2000, 2500]) {
        const f = h.frame(elapsed),
          progress =
            deathClipSeconds(h.death, f.snapshot.clocks.presentationTimeMs) /
            0.5;
        const localMin = -2.25 + 2.252 * Math.min(1, progress / 0.2);
        const o = h.observation(f, localMin),
          before = JSON.stringify(f);
        expect(h.publish(o)).toBe(true);
        const count = h.draws();
        h.scene.render(f);
        expect(h.draws()).toBe(count + 1);
        const expected = 0.05 + (0.002 - 0.05) * progress;
        const visual = h.node.parent!,
          anchor = visual.parent!;
        expect(anchor.position.y).toBe(2.3);
        expect(h.node.position.y).toBe(0);
        expect(anchor.position.y + visual.position.y + localMin).toBeCloseTo(
          expected,
          10,
        );
        if (elapsed === 0) expect(visual.position.y).toBeCloseTo(0, 10);
        const camera = h.camera()!;
        for (const x of [-3, 4])
          for (const y of [localMin, localMin + 1.7])
            for (const z of [-0.5, 0.5]) {
              const p = visual
                .localToWorld(new Vector3(x, y, z))
                .project(camera);
              expect(Math.abs(p.x)).toBeLessThan(1);
              expect(Math.abs(p.y)).toBeLessThan(1);
              expect(Math.abs(p.z)).toBeLessThan(1);
            }
        expect(JSON.stringify(f)).toBe(before);
        saved.push({ frame: f, observation: o, offset: visual.position.y });
      }
      for (const old of saved.reverse()) {
        expect(h.publish(old.observation)).toBe(true);
        h.scene.render(old.frame);
        expect(h.node.parent!.position.y).toBe(old.offset);
        const detach = h.scene.renderHost.mountActor({
          runId: run,
          actorId: actorId('sibling'),
          node: new Group(),
        });
        expect(h.node.parent!.position.y).toBe(old.offset);
        detach();
        h.scene.render(old.frame);
        expect(h.node.parent!.position.y).toBe(old.offset);
      }
    } finally {
      h.scene.dispose();
    }
  });
test('opted-in missing/stale identities fail before draw, legacy remains explicitly compatible', () => {
  const h = harness();
  try {
    const f = h.frame(400),
      good = h.observation(f, 0.002);
    expect(() => h.scene.render(f)).toThrow();
    expect(h.draws()).toBe(0);
    for (const bad of [
      { ...good, tick: tick(999) },
      { ...good, presentationTimeMs: presentationTimeMs(999) },
      { ...good, defeatStartedAt: presentationTimeMs(0) },
    ]) {
      expect(h.publish(bad)).toBe(true);
      expect(() => h.scene.render(f)).toThrow();
      expect(h.draws()).toBe(0);
    }
    expect(h.publish(good)).toBe(true);
    h.scene.render(f);
    const next = h.frame(500);
    expect(() => h.scene.render(next)).toThrow();
    expect(h.draws()).toBe(1);
    h.detach();
    h.scene.renderHost.mountActor({
      runId: run,
      actorId: actorId('white'),
      node: h.node,
    });
    expect(() => h.scene.render(next)).not.toThrow();
  } finally {
    h.scene.dispose();
  }
});
test('publication clones input, rejects malformed/unmounted/disposed data, remount never reuses observations', () => {
  const h = harness();
  const f = h.frame(400),
    good = h.observation(f, 0.002);
  try {
    for (const bad of [
      { ...good, actorId: actorId('missing') },
      { ...good, entryLocalMinY: NaN },
      {
        ...good,
        currentLocalBounds: {
          min: { x: 2, y: 0, z: 0 },
          max: { x: 1, y: 1, z: 1 },
        },
      },
      {
        ...good,
        currentLocalBounds: {
          min: { x: 0, y: 0, z: 0 },
          max: { x: Infinity, y: 1, z: 1 },
        },
      },
    ])
      expect(h.publish(bad)).toBe(false);
    expect(h.publish(good)).toBe(true);
    Object.assign(good.currentLocalBounds.min, { y: 999 }); // Publication takes a value snapshot, not producer-owned mutable data.
    h.scene.render(f);
    h.detach();
    expect(h.publish(h.observation(f))).toBe(false);
    h.scene.renderHost.mountActor({
      runId: run,
      actorId: actorId('white'),
      node: h.node,
      defeatPoseSupport: 'bounds-v1',
    });
    expect(() => h.scene.render(f)).toThrow();
  } finally {
    h.scene.dispose();
  }
  expect(h.publish(good)).toBe(false);
});
test('skipped first draw and negative entry support preserve the explicit inherited datum', () => {
  const h = harness(1500, 2.2);
  try {
    const f = h.frame(1000),
      o = h.observation(f, 0.002);
    expect(h.publish(o)).toBe(true);
    h.scene.render(f);
    expect(
      h.node.parent!.parent!.position.y + h.node.parent!.position.y + 0.002,
    ).toBeCloseTo(-0.024, 10);
    const initial = h.frame(0);
    expect(h.publish(h.observation(initial))).toBe(true);
    h.scene.render(initial);
    expect(h.node.parent!.position.y).toBeCloseTo(0, 10);
  } finally {
    h.scene.dispose();
  }
});

test('invalid replacement cannot reuse staged support and entry datum cannot drift within one death', () => {
  const h = harness();
  try {
    const f = h.frame(400),
      good = h.observation(f, 0.002);
    expect(h.publish(good)).toBe(true);
    expect(h.publish({ ...good, entryLocalMinY: NaN })).toBe(false);
    expect(() => h.scene.render(f)).toThrow();
    expect(h.draws()).toBe(0);
    expect(h.publish(good)).toBe(true);
    h.scene.render(f);
    expect(h.publish({ ...good, entryLocalMinY: -1 })).toBe(true);
    expect(() => h.scene.render(f)).toThrow();
    expect(h.draws()).toBe(1);
  } finally {
    h.scene.dispose();
  }
});
test('rotated display bounds use all eight transformed corners with the actual camera', () => {
  const h = harness();
  try {
    const base = h.frame(1000),
      f = {
        ...base,
        spatial: {
          ...base.spatial,
          actors: base.spatial.actors.map((a) => ({
            ...a,
            facing: { x: 1, y: 0, z: 0 },
          })),
        },
      };
    const o = h.observation(f, 0.002);
    expect(h.publish(o)).toBe(true);
    h.scene.render(f);
    for (const x of [-3, 4])
      for (const y of [0.002, 1.702])
        for (const z of [-0.5, 0.5]) {
          const p = h.node
            .parent!.localToWorld(new Vector3(x, y, z))
            .project(h.camera()!);
          expect(Math.abs(p.x)).toBeLessThan(1);
          expect(Math.abs(p.y)).toBeLessThan(1);
          expect(Math.abs(p.z)).toBeLessThan(1);
        }
  } finally {
    h.scene.dispose();
  }
});

test('bounds settlement never relocates historical hit coordinates or terminal physical data', () => {
  const h = harness();
  try {
    const base = h.frame(0);
    const event: DomainEvent = {
      type: 'HpChanged',
      sequence: 1,
      eventId: domainEventId('old-hit'),
      runId: run,
      at: gameTimeMs(0),
      actorId: actorId('white'),
      beforeHp: 10,
      afterHp: 0,
      actualHpLost: 10,
      maxHp: 500,
      batchId: batchId('old-batch'),
      cause: {
        kind: 'attack',
        actorId: actorId('blue'),
        activationId: attackActivationId('old-attack'),
        impactId: impactId('old-impact'),
        category: 'kick',
      },
      contact: {
        contactId: contactId('old-contact'),
        point: { x: 0.3, y: 1.3, z: 0.2 },
        impacts: [],
      },
    };
    const historical = { ...base, events: [event] },
      original = JSON.stringify(historical);
    for (const elapsed of [0, 400, 2000]) {
      const f = h.frame(elapsed);
      expect(h.publish(h.observation(f, elapsed === 0 ? -2.25 : 0.002))).toBe(
        true,
      );
      h.scene.render(f);
      expect(f.spatial.actors).toEqual(base.spatial.actors);
      const actual = new Vector3(0.3, 1.3, 0.2).project(h.camera()!);
      const projected = h.scene.project(historical)[0];
      expect(projected?.cssPoint?.x).toBeCloseTo(
        ((actual.x + 1) * viewport.widthCssPx) / 2,
        8,
      );
      expect(projected?.cssPoint?.y).toBeCloseTo(
        ((1 - actual.y) * viewport.heightCssPx) / 2,
        8,
      );
      expect(JSON.stringify(historical)).toBe(original);
    }
  } finally {
    h.scene.dispose();
  }
});

test('malformed current-actor payloads return false and clear only their own staged record', () => {
  const h = harness();
  try {
    const f = h.frame(400),
      good = h.observation(f, 0.002);
    for (const currentLocalBounds of [
      null,
      undefined,
      {},
      { min: null, max: { x: 1, y: 1, z: 1 } },
      { min: { x: 0, y: 0, z: 0 }, max: null },
      { min: 'invalid', max: 3 },
      { min: { x: '0', y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: NaN, z: 1 } },
    ]) {
      expect(h.publish(good)).toBe(true);
      const malformed = {
        ...good,
        currentLocalBounds,
      } as unknown as DefeatPoseSupportObservation;
      expect(() => expect(h.publish(malformed)).toBe(false)).not.toThrow();
      expect(() => h.scene.render(f)).toThrow();
      expect(h.draws()).toBe(0);
    }
    expect(h.publish(good)).toBe(true);
    expect(h.publish({ ...good, runId: 'other-run' as typeof run })).toBe(
      false,
    );
    h.scene.renderHost.mountActor({
      runId: run,
      actorId: actorId('other-actor'),
      node: new Group(),
      defeatPoseSupport: 'bounds-v1',
    });
    expect(
      h.publish({
        ...good,
        actorId: actorId('other-actor'),
        currentLocalBounds: null,
      } as unknown as DefeatPoseSupportObservation),
    ).toBe(false);
    // Rejection must be treated as unavailable by its producer. Here the actual
    // producer's prior record is preserved against a different run/actor's write.
    expect(() => h.scene.render(f)).not.toThrow();
    expect(h.draws()).toBe(1);
  } finally {
    h.scene.dispose();
  }
});
