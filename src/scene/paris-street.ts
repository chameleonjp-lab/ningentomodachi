import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { GameSnapshot, SpatialSnapshot } from '../contracts';
import type { StreetLayout } from '../world/street-layout';
/** Procedural first-pass art. Does not replace B's character models or claim final art acceptance. */
export function createParisStreet(layout: StreetLayout) {
  const root = new Group();
  root.name = 'paris-street';
  const geometries = new Set<BufferGeometry>(),
    materials = new Set<Material>();
  const cube = new BoxGeometry(1, 1, 1),
    sphere = new SphereGeometry(1, 8, 6),
    trunk = new CylinderGeometry(1, 1, 1, 6);
  geometries.add(cube);
  geometries.add(sphere);
  geometries.add(trunk);
  const material = (color: number, roughness = 0.8) => {
    const m = new MeshStandardMaterial({ color, roughness });
    materials.add(m);
    return m;
  };
  const stone = material(0xd8cab6),
    trim = material(0xf2e8d4),
    road = material(0x343945),
    paving = material(0xa6a4a0),
    glass = material(0x263c4b, 0.25),
    gold = material(0xbaa06a, 0.45),
    iron = material(0x202a31),
    leaf = material(0x355843),
    bark = material(0x675244),
    charred = material(0x494747);
  function mesh(
    parent: Group,
    mat: Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    geometry: BufferGeometry = cube,
  ) {
    const m = new Mesh(geometry, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = false;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  if (layout.battleStage) {
    const ground = mesh(root, paving, 0, -0.12, 0, 20, 0.2, 30);
    ground.name = 'battle-stage-ground';
    const backdrop = new Group();
    backdrop.name = 'battle-stage-backdrop';
    root.add(backdrop);
    // All vertical scenery, including facade trim and balconies, stays beyond
    // the battle area's far edge. The fixed camera ray approaches from -X.
    const facadeX = layout.battleStage.backdropMinX + 3;
    for (const z of [-12, 0, 12]) {
      const building = new Group();
      building.position.set(facadeX, 0, z);
      backdrop.add(building);
      mesh(building, stone, 0, 4, 0, 4, 8, 11.8);
      for (const y of [3, 6, 8.1])
        mesh(building, trim, 0, y, 0, 4.25, 0.18, 12);
      for (const dz of [-4, -2, 0, 2, 4]) {
        mesh(building, glass, -2.03, 1.6, dz, 0.08, 2.5, 1.5);
        for (const y of [4.5, 6.9]) {
          mesh(building, glass, -2.04, y, dz, 0.08, 1.5, 1.2);
          mesh(building, iron, -2.32, y - 0.5, dz, 0.45, 0.1, 1.5);
        }
      }
      mesh(building, gold, -2.12, 2.95, 0, 0.12, 0.4, 10);
      mesh(building, iron, -2.4, 2.55, 0, 0.9, 0.16, 10);
    }
    return {
      root,
      update(_snapshot: GameSnapshot, _spatial: SpatialSnapshot) {},
      dispose() {
        for (const geometry of geometries) geometry.dispose();
        for (const mat of materials) mat.dispose();
        root.clear();
      },
    };
  }
  mesh(root, road, 0, -0.12, 31, 14, 0.2, 76);
  for (const side of [-1, 1]) {
    mesh(root, paving, side * 5.5, -0.015, 31, 3, 0.08, 76);
    for (let z = -4; z < 68; z += 4)
      mesh(root, trim, 0, 0.001, z, 0.12, 0.01, 1.7);
  }
  const shops = new Map<string, Group>();
  for (const object of layout.objects) {
    const group = new Group();
    group.position.set(object.position.x, 0, object.position.z);
    group.name = object.objectId;
    root.add(group);
    shops.set(object.objectId, group);
    const inward = object.position.x < 0 ? 1 : -1;
    mesh(group, stone, 0, 4, 0, 4, 8, 15);
    for (const y of [3, 6, 8.1])
      mesh(group, trim, inward * 0.1, y, 0, 4.25, 0.18, 15.2);
    for (const z of [-5, -2.5, 0, 2.5, 5]) {
      mesh(group, glass, inward * 2.03, 1.6, z, 0.08, 2.5, 2);
      for (const y of [4.5, 6.9]) {
        mesh(group, glass, inward * 2.04, y, z, 0.08, 1.5, 1.2);
        mesh(group, iron, inward * 2.32, y - 0.5, z, 0.45, 0.1, 1.5);
        for (const dz of [-0.6, 0, 0.6])
          mesh(group, iron, inward * 2.5, y - 0.2, z + dz, 0.05, 0.6, 0.045);
      }
    }
    mesh(group, gold, inward * 2.12, 2.95, 0, 0.12, 0.4, 10);
    mesh(group, iron, inward * 2.4, 2.55, 0, 0.9, 0.16, 12);
  }
  for (const side of [-1, 1])
    for (let z = 0; z < 65; z += 12) {
      mesh(root, bark, side * 5, 0.9, z, 0.12, 1.8, 0.12, trunk);
      mesh(root, leaf, side * 5, 2.6, z, 1, 1.2, 1, sphere);
      mesh(root, iron, side * 4.5, 1.8, z + 5, 0.065, 3.6, 0.065, trunk);
      mesh(root, gold, side * 4.5, 3.7, z + 5, 0.25, 0.35, 0.25);
    }
  const cars = new Map<string, Group>();
  for (const item of layout.vehicles) {
    const group = new Group();
    group.name = item.vehicleId;
    root.add(group);
    cars.set(item.vehicleId, group);
    const paint = material(
      [0x5e7480, 0x9f7b66, 0x294a51, 0x6d626d][cars.size - 1] ?? 0x607080,
      0.4,
    );
    mesh(group, paint, 0, 0.6, 0, 1.7, 0.65, 3.6);
    mesh(group, glass, 0, 1.15, -0.15, 1.45, 0.65, 1.8);
    mesh(group, trim, 0, 0.55, 1.8, 1.3, 0.18, 0.05);
    for (const x of [-0.9, 0.9])
      for (const z of [-1.1, 1.1])
        mesh(group, iron, x, 0.35, z, 0.22, 0.35, 0.35, sphere);
    group.position.set(item.position.x, item.position.y, item.position.z);
  }
  const people: Array<{ group: Group; side: number; start: number }> = [];
  for (let i = 0; i < 8; i++) {
    const group = new Group();
    group.name = `civilian-${i}`;
    root.add(group);
    const cloth = material(
      [0x456475, 0x927969, 0x55634a, 0x684f60][i % 4] ?? 0x456475,
    );
    mesh(group, cloth, 0, 0.95, 0, 0.32, 0.65, 0.25);
    mesh(group, stone, 0, 1.48, 0, 0.18, 0.2, 0.18, sphere);
    for (const x of [-0.12, 0.12])
      mesh(group, iron, x, 0.35, 0, 0.1, 0.7, 0.12);
    people.push({ group, side: i % 2 ? 1 : -1, start: 6 + i * 7 });
  }
  return {
    root,
    update(snapshot: GameSnapshot, spatial: SpatialSnapshot) {
      for (const p of spatial.vehicles) {
        const car = cars.get(p.vehicleId);
        if (car) {
          car.position.set(p.position.x, p.position.y, p.position.z);
          const authority = snapshot.world.vehicles.find(
            (a) => a.vehicleId === p.vehicleId,
          );
          car.scale.y = authority?.broken ? 0.55 : 1;
        }
      }
      for (const item of snapshot.world.objects) {
        const shop = shops.get(item.objectId);
        if (shop)
          for (const child of shop.children)
            if (child instanceof Mesh && item.destroyed)
              child.material = charred;
      }
      const seconds = snapshot.clocks.presentationTimeMs / 1000;
      for (const person of people) {
        person.group.position.set(
          person.side * 5.9,
          0,
          Math.min(
            66,
            person.start +
              (snapshot.currentOpponentId
                ? seconds * 0.8
                : Math.sin(seconds * 0.3) * 0.5),
          ),
        );
        person.group.rotation.y = 0;
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      root.clear();
    },
  };
}
