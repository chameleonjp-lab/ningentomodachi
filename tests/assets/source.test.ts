import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { inspectGlb } from '../../src/assets/source';

const base = 'assets/android/motions/';
const categories = { movement: 9, jump: 1, punch: 13, kick: 19 };
test('real sources retain 42 unique clips, exact accessor times, compatible skeletons and baked speed ratio', () => {
  const names = new Set<string>();
  const signatures = new Set<string>();
  for (const [category, count] of Object.entries(categories)) {
    const path = `${category}/android_${category}.glb`;
    const original = inspectGlb(readFileSync(`${base}completed42/${path}`));
    const speed = inspectGlb(
      readFileSync(`${base}completed42-speed15/${path}`),
    );
    expect(speed.clips).toHaveLength(count);
    expect(speed.boneCount).toBe(53);
    expect(speed.triangleCount).toBe(47198);
    signatures.add(speed.skeletonSignature);
    for (const clip of speed.clips) {
      expect(names.has(clip.name)).toBe(false);
      names.add(clip.name);
      expect(clip.durationSeconds).toBeGreaterThan(0);
      const source = original.clips.find((entry) => entry.name === clip.name);
      expect(source).toBeDefined();
      expect(clip.durationSeconds / (source?.durationSeconds ?? 0)).toBeCloseTo(
        2 / 3,
        6,
      );
      expect(clip.sampleTimes.every(Number.isFinite)).toBe(true);
      if (clip.name === 'AcrobaticCombo') {
        expect(
          clip.sampleTimes.some(
            (time) => Math.abs(time * 45 - Math.round(time * 45)) > 0.01,
          ),
        ).toBe(true);
      }
    }
  }
  expect(names.size).toBe(42);
  expect(signatures.size).toBe(1);
});
test('source inspection rejects truncated, empty and counterfeit GLBs', () => {
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode('not a GLB'),
    readFileSync(`${base}completed42-speed15/jump/android_jump.glb`).subarray(
      0,
      100,
    ),
  ]) {
    expect(() => inspectGlb(bytes)).toThrow();
  }
});

function alterSource(
  edit: (document: Record<string, unknown>) => void,
): Uint8Array {
  const input = readFileSync(
    `${base}completed42-speed15/jump/android_jump.glb`,
  );
  const jsonLength = input.readUInt32LE(12);
  const document: Record<string, unknown> = JSON.parse(
    input.subarray(20, 20 + jsonLength).toString(),
  );
  edit(document);
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const tail = input.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + tail.length);
  input.copy(output, 0, 0, 12);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  tail.copy(output, 20 + padded.length);
  return output;
}
test('source validation rejects invalid animation output accessors and external image dependencies', () => {
  const invalidOutput = alterSource((document) => {
    const animations = document.animations as {
      samplers: { output: number }[];
    }[];
    const sampler = animations[0]?.samplers[0];
    if (sampler) sampler.output = 999999;
  });
  expect(() => inspectGlb(invalidOutput)).toThrow();
  const externalImage = alterSource((document) => {
    document.images = [{ uri: 'missing.png' }];
  });
  expect(() => inspectGlb(externalImage)).toThrow();
});

test('source validation fails closed on missing skin weights and invalid rest transforms', () => {
  const weights = alterSource((document) => {
    const meshes = document.meshes as {
      primitives: { attributes: Record<string, number> }[];
    }[];
    const attributes = meshes[0]?.primitives[0]?.attributes;
    if (attributes) attributes.WEIGHTS_0 = 999999;
  });
  expect(() => inspectGlb(weights)).toThrow();
  const rest = alterSource((document) => {
    const nodes = document.nodes as { translation?: unknown }[];
    const node = nodes[0];
    if (node) node.translation = [null, 0, 0];
  });
  expect(() => inspectGlb(rest)).toThrow();
});

test('skeleton compatibility includes non-joint ancestor transforms, not merely joint names and bind matrices', () => {
  const original = inspectGlb(
    readFileSync(`${base}completed42-speed15/jump/android_jump.glb`),
  );
  const moved = alterSource((document) => {
    const nodes = document.nodes as { name: string; translation?: number[] }[];
    const rig = nodes.find((node) => node.name === 'ANDROID_RIG');
    if (!rig) throw new Error('Fixture rig');
    rig.translation = [1, 0, 0];
  });
  expect(inspectGlb(moved).skeletonSignature).not.toBe(
    original.skeletonSignature,
  );
});

test.each([
  [
    'declared buffer domain',
    (d: Record<string, unknown>) => {
      const buffer = (d.buffers as { byteLength: number }[])[0];
      if (buffer) buffer.byteLength = 4;
    },
  ],
  [
    'mesh node transform',
    (d: Record<string, unknown>) => {
      const node = (d.nodes as Record<string, unknown>[]).find(
        (n) => n.mesh !== undefined,
      );
      if (node) node.scale = [null, 1, 1];
    },
  ],
  [
    'material reference',
    (d: Record<string, unknown>) => {
      const p = (d.meshes as { primitives: Record<string, unknown>[] }[])[0]
        ?.primitives[0];
      if (p) p.material = 999999;
    },
  ],
  [
    'normal reference',
    (d: Record<string, unknown>) => {
      const p = (
        d.meshes as { primitives: { attributes: Record<string, unknown> }[] }[]
      )[0]?.primitives[0];
      if (p) p.attributes.NORMAL = 999999;
    },
  ],
  [
    'skin reference',
    (d: Record<string, unknown>) => {
      const node = (d.nodes as Record<string, unknown>[]).find(
        (n) => n.mesh !== undefined,
      );
      if (node) node.skin = 999999;
    },
  ],
  [
    'zero quaternion',
    (d: Record<string, unknown>) => {
      const node = (d.nodes as Record<string, unknown>[])[0];
      if (node) node.rotation = [0, 0, 0, 0];
    },
  ],
] as const)('strict source gate rejects malformed %s', (_name, edit) => {
  expect(() => inspectGlb(alterSource(edit))).toThrow();
});

test('legal omitted optional normal and material references remain accepted', () => {
  const source = alterSource((d) => {
    for (const mesh of d.meshes as {
      primitives: { material?: number; attributes: { NORMAL?: number } }[];
    }[])
      for (const primitive of mesh.primitives) {
        delete primitive.material;
        delete primitive.attributes.NORMAL;
      }
    delete d.materials;
  });
  expect(inspectGlb(source).clips).toHaveLength(1);
});
