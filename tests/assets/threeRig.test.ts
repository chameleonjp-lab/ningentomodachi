import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import {
  Vector3,
  SkinnedMesh,
  MeshStandardMaterial,
  AnimationClip,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clipId } from '../../src/contracts';
import { createThreeAssetPack } from '../../src/assets/threeAssetPack';
const sources = ['movement', 'jump', 'punch', 'kick'].map(
  (category) =>
    new Uint8Array(
      readFileSync(
        `assets/android/motions/completed42-speed15/${category}/android_${category}.glb`,
      ),
    ),
);
test('real four category GLBs yield one actor skeleton, independent clones/materials and all 42 clips at rate one', async () => {
  const pack = await createThreeAssetPack(sources);
  expect(pack.clipNames()).toHaveLength(42);
  const a = pack.create('white'),
    b = pack.create('white');
  const bones = new Set();
  let skins = 0;
  a.node.traverse((node) => {
    if (node instanceof SkinnedMesh) {
      skins++;
      for (const bone of node.skeleton.bones) bones.add(bone);
    }
  });
  expect(skins).toBe(5);
  expect(bones.size).toBe(53);
  const hand =
    a.node.getObjectByName('handL') ?? a.node.getObjectByName('hand.L');
  expect(hand).toBeDefined();
  a.seek(clipId('Jab'), 0);
  a.node.updateMatrixWorld(true);
  const initial = hand?.getWorldPosition(new Vector3());
  const initialRoot = a.node.getObjectByName('root')?.position.clone();
  a.seek(clipId('Jab'), 0.244444444);
  a.node.updateMatrixWorld(true);
  expect(
    hand?.getWorldPosition(new Vector3()).distanceTo(initial ?? new Vector3()),
  ).toBeGreaterThan(0.05);
  expect(a.node.getObjectByName('root')?.position).toEqual(initialRoot);
  a.setEmissiveEnabled(false);
  const emissive = (root: typeof a.node) => {
    let sum = 0;
    root.traverse((node) => {
      if (node instanceof SkinnedMesh)
        for (const mat of Array.isArray(node.material)
          ? node.material
          : [node.material])
          if (mat instanceof MeshStandardMaterial)
            sum += Math.hypot(mat.emissive.r, mat.emissive.g, mat.emissive.b);
    });
    return sum;
  };
  expect(emissive(a.node)).toBe(0);
  expect(emissive(b.node)).toBeGreaterThan(0);
  expect(() => pack.create('blue')).toThrow('palette');
  pack.dispose();
  expect(() => pack.create('white')).toThrow();
  a.dispose();
  a.dispose();
  b.dispose();
});

test('all verified source palettes preserve red inlay base color, emission strength and isolated death state', async () => {
  const { SOURCE_PALETTES } = await import('../../src/assets/sourcePalettes');
  const pack = await createThreeAssetPack(sources, SOURCE_PALETTES);
  for (const color of ['black', 'blue', 'green', 'yellow'] as const) {
    const actor = pack.create(color);
    const palette = SOURCE_PALETTES[color];
    let checked = 0;
    actor.node.traverse((node) => {
      if (node instanceof SkinnedMesh)
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          if (
            material instanceof MeshStandardMaterial &&
            material.name.startsWith('04 |')
          ) {
            checked++;
            expect(material.color.toArray()).toEqual([...palette.inlayBaseRgb]);
            expect(material.emissive.toArray()).toEqual([
              ...palette.emissiveRgb,
            ]);
            expect(material.emissiveIntensity).toBe(palette.emissiveStrength);
          }
    });
    expect(checked).toBe(1);
    actor.dispose();
  }
  pack.dispose();
});

test('actor disposal releases generated bone textures without disposing shared geometry while another actor lives', async () => {
  const pack = await createThreeAssetPack(sources);
  const a = pack.create('white'),
    b = pack.create('white');
  let geometryDisposed = 0,
    boneDisposed = 0;
  const geometries = new Set();
  const skeletons = new Set();
  a.node.traverse((node) => {
    if (node instanceof SkinnedMesh) {
      if (!geometries.has(node.geometry)) {
        geometries.add(node.geometry);
        node.geometry.addEventListener('dispose', () => {
          geometryDisposed++;
        });
      }
      if (!skeletons.has(node.skeleton)) {
        skeletons.add(node.skeleton);
        node.skeleton.computeBoneTexture();
        node.skeleton.boneTexture?.addEventListener('dispose', () => {
          boneDisposed++;
        });
      }
    }
  });
  pack.dispose();
  a.dispose();
  expect(boneDisposed).toBe(skeletons.size);
  expect(geometryDisposed).toBe(0);
  b.dispose();
  expect(geometryDisposed).toBe(geometries.size);
});

test('all 42 actual source clips seek start/mid/end with finite bone matrices; two derived death candidates extend the inventory to44', async () => {
  const { authorDeathClips } = await import('../../src/assets/deathAnimation');
  const { SOURCE_PALETTES } = await import('../../src/assets/sourcePalettes');
  const pack = await createThreeAssetPack(sources, SOURCE_PALETTES);
  const actor = pack.create('white');
  for (const name of pack.clipNames()) {
    const id = clipId(name),
      duration = pack.clipDuration(id);
    if (duration === undefined) throw new Error('Missing duration');
    for (const seconds of [0, duration / 2000, duration / 1000]) {
      actor.seek(id, seconds);
      actor.node.traverse((node) => {
        expect(node.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      });
    }
  }
  actor.seek(clipId('Idle'), 0);
  const death = authorDeathClips(actor.node);
  actor.dispose();
  pack.dispose();
  const derived = await createThreeAssetPack(sources, SOURCE_PALETTES, death);
  expect(derived.clipNames()).toHaveLength(44);
  for (const color of ['white', 'black', 'blue', 'green', 'yellow'] as const) {
    const candidate = derived.create(color);
    for (const name of ['DefeatPunch', 'DefeatKick']) {
      expect(derived.clipDuration(clipId(name))).toBe(500);
      candidate.seek(clipId(name), 0.5);
    }
    candidate.dispose();
  }
  derived.dispose();
});

test('duplicate derived clips reject before any source scenes are allocated', async () => {
  const parse = vi.spyOn(GLTFLoader.prototype, 'parseAsync');
  try {
    await expect(
      createThreeAssetPack(sources, {}, [new AnimationClip('Idle', 0.5, [])]),
    ).rejects.toThrow('Duplicate derived clip');
    expect(parse).not.toHaveBeenCalled();
    await expect(
      createThreeAssetPack(sources, {}, [
        new AnimationClip('Derived', 0.5, []),
        new AnimationClip('Derived', 0.5, []),
      ]),
    ).rejects.toThrow('Duplicate derived clip');
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});

test('later source parser failure releases all geometry and materials of already parsed scenes', async () => {
  const original = GLTFLoader.prototype.parseAsync;
  const geometries = new Set(),
    materials = new Set(),
    disposedGeometries = new Set(),
    disposedMaterials = new Set();
  let calls = 0;
  const parse = vi
    .spyOn(GLTFLoader.prototype, 'parseAsync')
    .mockImplementation(async function (this: GLTFLoader, data, path) {
      if (++calls === 2) throw new Error('Injected second parser failure');
      const gltf = await original.call(this, data, path);
      gltf.scene.traverse((node) => {
        if (node instanceof SkinnedMesh) {
          geometries.add(node.geometry);
          node.geometry.addEventListener('dispose', () =>
            disposedGeometries.add(node.geometry),
          );
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material]) {
            materials.add(material);
            material.addEventListener('dispose', () =>
              disposedMaterials.add(material),
            );
          }
        }
      });
      return gltf;
    });
  try {
    await expect(createThreeAssetPack(sources)).rejects.toThrow(
      'Injected second parser failure',
    );
    expect(calls).toBe(2);
    expect(geometries.size).toBeGreaterThan(0);
    expect(materials.size).toBeGreaterThan(0);
    expect(disposedGeometries).toEqual(geometries);
    expect(disposedMaterials).toEqual(materials);
  } finally {
    parse.mockRestore();
  }
});
