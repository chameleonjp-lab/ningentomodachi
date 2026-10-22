import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { expect, test } from 'vitest';
import {
  measureSkinSurface,
  selectSkinSurface,
} from '../../src/assets/skinSurface';

test('surface selection excludes unrendered vertices and other skin clusters, resolving equal weights deterministically', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0, 99, 99, 99], 3),
  );
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0],
      4,
    ),
  );
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      [0.5, 0.5, 0, 0, 0.4, 0.6, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
      4,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  const contact = new Bone(),
    other = new Bone(),
    unused = new Bone();
  const material = new MeshBasicMaterial(),
    mesh = new SkinnedMesh(geometry, material);
  const scene = new Group();
  scene.add(contact, other, unused, mesh);
  mesh.bind(new Skeleton([contact, other]));
  scene.updateMatrixWorld(true);
  try {
    const selected = selectSkinSurface(scene, contact);
    expect(selected[0]?.vertexIndices).toEqual([0, 2]);
    const volume = measureSkinSurface(selected);
    expect(volume.center.toArray()).toEqual([-0.5, 0.5, 0]);
    expect(volume.radiusM).toBeCloseTo(Math.sqrt(0.5));
    expect(() => selectSkinSurface(scene, unused)).toThrow(
      'no rendered vertices',
    );
    expect(() => measureSkinSurface([])).toThrow('Invalid measured');
  } finally {
    geometry.dispose();
    material.dispose();
  }
});
