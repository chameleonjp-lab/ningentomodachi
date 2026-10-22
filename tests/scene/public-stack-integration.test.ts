import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { durationMs, vehicleId, worldObjectId } from '../../src/contracts';
import { createParisStreetLayout } from '../../src/world/street-layout';
import { publicStack } from './fixtures/public-stack';

test('test-source public B sampler -> C root/contact -> A HP -> B mounted pose/C draw and HUD', async () => {
  const h = await publicStack();
  try {
    h.attack();
    const { result, output, frame } = h.step();
    const hit = result.candidates.find((c) => c.kind === 'body-hit');
    expect(hit).toBeDefined();
    const hp = output.events.find((e) => e.type === 'HpChanged');
    expect(hp).toBeDefined();
    if (!hp || !hit) throw Error('Missing contact');
    expect(hp.contact.contactId).toBe(hit.contactId);
    expect(hp.contact.point).toEqual(hit.point);
    expect(output.snapshot.actors.find((a) => a.color === 'blue')?.hp).toBe(
      400,
    );
    const white = frame.spatial.actors.find(
      (a) =>
        a.actorId ===
        output.snapshot.actors.find((a) => a.color === 'white')?.actorId,
    );
    expect(white?.position.z).toBeCloseTo(0.4);
    expect(white?.facing.z).toBe(1);
    expect(h.nodes.get('white')?.parent?.parent?.position.z).toBeCloseTo(0.4);
    expect(h.nodes.get('white')?.rotation.y).toBe(0.7);
    const projection = h.scene
      .project(frame)
      .find((p) => p.eventId === hp.eventId);
    expect(projection?.visibility).toBe('visible');
    const camera = h.drawn()?.camera;
    if (!camera) throw Error('Missing draw');
    const point = new Vector3(hit.point.x, hit.point.y, hit.point.z).project(
      camera,
    );
    expect(projection?.cssPoint?.x).toBeCloseTo((point.x + 1) * 200, 6);
    expect(projection?.cssPoint?.y).toBeCloseTo((1 - point.y) * 400, 6);
    const next = h.step();
    expect(next.output.events.some((e) => e.type === 'HpChanged')).toBe(false);
    expect(
      next.frame.spatial.actors.find((a) => a.actorId === white?.actorId)
        ?.position.z,
    ).toBeCloseTo(0.4);
  } finally {
    h.dispose();
  }
});
test('actual kick contact requires A approval before car motion and car collision damage', async () => {
  const base = createParisStreetLayout(),
    id = vehicleId('TEST-ONLY:car');
  const h = await publicStack({
    ...base,
    objects: [],
    vehicles: [
      {
        vehicleId: id,
        position: { x: 0, y: 0, z: 1.8 },
        halfExtents: { x: 0.9, y: 0.7, z: 1.8 },
      },
    ],
    actorSpawns: { ...base.actorSpawns, blue: { x: 0, y: 0, z: 4 } },
  });
  try {
    h.attack('white', 'kick');
    const first = h.step();
    expect(
      first.result.candidates.some((c) => c.kind === 'vehicle-launch'),
    ).toBe(true);
    expect(
      first.output.events.some((e) => e.type === 'VehicleLaunchApproved'),
    ).toBe(true);
    expect(first.output.snapshot.world.vehicles[0]?.hp).toBe(80);
    expect(first.frame.spatial.vehicles[0]?.position.z).toBe(1.8);
    const second = h.step();
    expect(second.frame.spatial.vehicles[0]?.position.z).toBeGreaterThan(1.8);
    expect(
      second.result.candidates.some((c) => c.kind === 'vehicle-contact'),
    ).toBe(true);
    expect(
      second.output.snapshot.actors.find((a) => a.color === 'blue')?.hp,
    ).toBe(450);
  } finally {
    h.dispose();
  }
});
test('direct sampled strike breaks an A-owned street ledger entry without C durability authority', async () => {
  const base = createParisStreetLayout(),
    id = worldObjectId('TEST-ONLY:wall');
  const h = await publicStack({
    ...base,
    vehicles: [],
    objects: [
      {
        objectId: id,
        position: { x: 0, y: 0.8, z: 1.5 },
        halfExtents: { x: 1, y: 0.8, z: 0.1 },
      },
    ],
  });
  try {
    h.attack();
    const first = h.step();
    expect(
      first.result.candidates.some((c) => c.kind === 'destruction' && c.source),
    ).toBe(true);
    expect(first.output.snapshot.world.objects[0]?.destroyed).toBe(true);
    expect(first.output.snapshot.world.objects[0]?.durability).toBe(0);
    expect(
      first.output.events.some((e) => e.type === 'DestructionCounted'),
    ).toBe(true);
  } finally {
    h.dispose();
  }
});
test('actual enemy contacts reach terminal state, then committed physics remains frozen during presentation', async () => {
  const base = createParisStreetLayout();
  const h = await publicStack(
    {
      ...base,
      vehicles: [],
      objects: [],
      actorSpawns: {
        ...base.actorSpawns,
        white: { x: 0, y: 0.5, z: 0 },
        blue: { x: 0, y: 0, z: 1.4 },
      },
    },
    0,
  );
  try {
    for (let i = 0; i < 7 && h.core.read().phase === 'running'; i++) {
      h.attack('blue');
      h.step();
    }
    expect(h.core.read().result?.outcome).toBe('defeat');
    const before = h.render();
    h.core.present(durationMs(5000));
    const after = h.render();
    expect(after.spatial.actors).toEqual(before.spatial.actors);
    expect(after.spatial.vehicles).toEqual(before.spatial.vehicles);
    expect(after.snapshot.clocks.gameTimeMs).toBe(
      before.snapshot.clocks.gameTimeMs,
    );
    expect(after.snapshot.result).toEqual(before.snapshot.result);
  } finally {
    h.dispose();
  }
});
