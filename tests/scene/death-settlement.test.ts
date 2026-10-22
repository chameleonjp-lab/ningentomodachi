import { expect, test } from 'vitest';
import { Group, Vector3 } from 'three';
import {
  actorId,
  durationMs,
  type ActorColor,
  type CommittedFrame,
} from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { publicStack } from './fixtures/public-stack';

for (const victim of ['white', 'blue'] as const)
  test(`actual ${victim} airborne defeat settles visual child on the mapped clip clock only`, async () => {
    const base = createParisStreetLayout(),
      h = await publicStack(
        {
          ...base,
          objects: [],
          vehicles: [],
          actorSpawns: {
            ...base.actorSpawns,
            white: { x: 0, y: victim === 'white' ? 0.5 : 0, z: 0 },
            blue: { x: 0, y: victim === 'blue' ? 0.5 : 0, z: 1.4 },
          },
        },
        0,
      );
    try {
      const attacker: ActorColor = victim === 'white' ? 'blue' : 'white';
      let hitFrame: CommittedFrame | undefined;
      for (let i = 0; i < 5; i++) {
        h.attack(attacker);
        hitFrame = h.step().frame;
      }
      if (!hitFrame) throw Error('No death frame');
      const state = h.core.read().actors.find((a) => a.color === victim),
        death = state?.defeatPresentation;
      if (!state || !death) throw Error('Missing actual A death record');
      expect(state.defeated).toBe(true);
      const historicalHit = hitFrame.events.find(
        (e) => e.type === 'HpChanged' && e.actorId === state.actorId,
      );
      if (!historicalHit || historicalHit.type !== 'HpChanged')
        throw Error('Missing historical hit');
      const physical = hitFrame.spatial.actors.find(
        (a) => a.actorId === state.actorId,
      );
      if (!physical) throw Error('No actor pose');
      expect(physical.position.y).toBeGreaterThan(0);
      const original = JSON.stringify(hitFrame),
        node = h.nodes.get(victim);
      if (!node) throw Error('No B node');
      const visual = node.parent,
        anchor = visual?.parent;
      expect(visual?.name).toBe(`actor-presentation:${state.actorId}`);
      expect(anchor?.name).toBe(`actor-anchor:${state.actorId}`);
      const savedFrames: { frame: typeof hitFrame; offset: number }[] = [];
      const points =
        victim === 'white'
          ? [
              [1000, 0.25],
              [1999, 0.49975],
              [2000, 0.5],
              [2500, 0.5],
            ]
          : [
              [1000, 0.25],
              [1500, 0.375],
              [1624, 0.499],
              [1625, 0.5],
              [2000, 0.5],
            ];
      for (const [elapsed, seconds] of points) {
        if (elapsed === undefined || seconds === undefined)
          throw Error('Missing test key');
        const delta =
          death.startedAt + elapsed - h.core.read().clocks.presentationTimeMs;
        h.core.present(durationMs(delta));
        const draws = h.draws(),
          frame = h.render();
        expect(h.draws()).toBe(draws + 1);
        expect(h.seeks.get(victim)).toBeCloseTo(seconds, 8);
        expect(visual?.position.y).toBeCloseTo(
          (-physical.position.y * seconds) / 0.5,
          8,
        );
        expect(anchor?.position.y).toBe(physical.position.y);
        expect(node.position.y).toBe(0);
        expect(node.rotation.y).toBe(0.7);
        expect(
          frame.spatial.actors.find((a) => a.actorId === state.actorId)
            ?.position,
        ).toEqual(physical.position);
        expect(JSON.stringify(hitFrame)).toBe(original);
        const camera = h.drawn()?.camera;
        if (!camera) throw Error('No draw');
        const oldPoint = historicalHit.contact.point;
        const projectedOldPoint = new Vector3(
          oldPoint.x,
          oldPoint.y,
          oldPoint.z,
        ).project(camera);
        const historicalProjection = h.scene
          .project(hitFrame)
          .find((p) => p.eventId === historicalHit.eventId);
        expect(historicalProjection?.cssPoint?.x).toBeCloseTo(
          (projectedOldPoint.x + 1) * 200,
          7,
        );
        expect(historicalProjection?.cssPoint?.y).toBeCloseTo(
          (1 - projectedOldPoint.y) * 400,
          7,
        );
        const world = node
          .getWorldPosition(new Vector3())
          .add(new Vector3(0, 1, 0))
          .project(camera);
        expect(Math.abs(world.x)).toBeLessThan(1);
        expect(Math.abs(world.y)).toBeLessThan(1);
        expect(Math.abs(world.z)).toBeLessThan(1);
        const y = visual?.position.y;
        if (y === undefined) throw Error('Missing visual anchor');
        savedFrames.push({ frame, offset: y });
        const extra = new Group();
        const detach = h.scene.renderHost.mountActor({
          runId: h.context.runId,
          actorId: actorId(`test-extra:${elapsed}`),
          node: extra,
        });
        expect(visual?.position.y).toBe(y);
        detach();
        expect(extra.parent).toBeNull();
        expect(visual?.position.y).toBe(y);
        expect(h.nodes.get(attacker)?.parent?.position.y).toBe(0);
        h.scene.render(frame);
        expect(visual?.position.y).toBe(y);
        h.core.handle({
          type: 'PauseRequested',
          runId: h.context.runId,
          reason: 'manual',
        });
        const paused = h.core.read().clocks.presentationTimeMs;
        h.core.present(durationMs(10000));
        h.render();
        expect(h.core.read().clocks.presentationTimeMs).toBe(paused);
        expect(visual?.position.y).toBe(y);
        h.core.handle({
          type: 'ResumeRequested',
          runId: h.context.runId,
          reason: 'manual',
        });
      }
      expect(node.getWorldPosition(new Vector3()).y).toBeCloseTo(0, 8);
      for (const saved of [...savedFrames].reverse()) {
        h.scene.render(saved.frame);
        expect(visual?.position.y).toBe(saved.offset);
        // Cross-product: a later commit must not overwrite this replayed display
        // merely because an unrelated actor mounts or detaches.
        const replaySibling = new Group();
        const detachReplaySibling = h.scene.renderHost.mountActor({
          runId: h.context.runId,
          actorId: actorId(`replay-sibling:${saved.offset}`),
          node: replaySibling,
        });
        expect(visual?.position.y).toBe(saved.offset);
        detachReplaySibling();
        expect(visual?.position.y).toBe(saved.offset);
        expect(replaySibling.parent).toBeNull();
        expect(anchor?.position.y).toBe(physical.position.y);
        expect(JSON.stringify(hitFrame)).toBe(original);
      }
      h.dispose();
      expect(node.parent).toBeNull();
      expect(anchor?.parent).toBeNull();
    } finally {
      h.dispose();
    }
  });
