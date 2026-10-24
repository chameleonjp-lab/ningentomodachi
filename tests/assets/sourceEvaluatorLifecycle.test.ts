import {
  AnimationClip,
  AnimationMixer,
  BufferGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Texture,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  Vector3,
} from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import { createSourceEvaluator } from '../../src/assets/evaluateSource';
import {
  bakeMeasuredJoint,
  createMeasuredJointReceipt,
} from '../../tools/assets/measuredJointBake';
// Captured from unchanged de5 evaluator c56b9b1a; synthetic fixture only.
const baselineJson =
  '[{"rawRoot":{"position":{"x":0,"y":0,"z":0},"visualYawRad":0},"root":{"position":{"x":0,"y":0,"z":0},"visualYawRad":0},"shapes":[{"shapeId":"hand","volume":{"kind":"sphere","center":{"x":0,"y":2,"z":0},"radiusM":0.1}}]},{"rawRoot":{"position":{"x":1,"y":1.5,"z":2},"visualYawRad":0},"root":{"position":{"x":1,"y":1.5,"z":2},"visualYawRad":0},"shapes":[{"shapeId":"hand","volume":{"kind":"sphere","center":{"x":0,"y":4.440892098500626e-16,"z":1.9999999999999996},"radiusM":0.1}}]},{"rawRoot":{"position":{"x":2,"y":3,"z":4},"visualYawRad":3.141592653589793},"root":{"position":{"x":2,"y":3,"z":4},"visualYawRad":3.141592653589793},"shapes":[{"shapeId":"hand","volume":{"kind":"sphere","center":{"x":0,"y":-2,"z":0},"radiusM":0.1}}]}]';
const mocks = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    parseAsync = mocks.parse;
  },
}));
vi.mock('../../src/assets/source', () => ({
  inspectGlb: () => ({ clips: [{ name: 'synthetic' }] }),
}));
afterEach(() => vi.restoreAllMocks());
function scene() {
  const group = new Group(),
    root = new Group(),
    hand = new Group();
  root.name = 'root';
  hand.name = 'hand';
  hand.position.set(0, 1, 0);
  root.add(hand);
  group.add(root);
  const geometry = new BufferGeometry(),
    material = new MeshBasicMaterial();
  group.add(new Mesh(geometry, material), new Mesh(geometry, material));
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  const clip = new AnimationClip('synthetic', 1, [
    new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 2, 3, 4]),
    new QuaternionKeyframeTrack(
      'root.quaternion',
      [0, 1],
      [0, 0, 0, 1, ...q.toArray()],
    ),
    new VectorKeyframeTrack('root.scale', [0, 1], [2, 2, 2, 2, 2, 2]),
  ]);
  mocks.parse.mockResolvedValue({
    scene: group,
    animations: [clip],
    parser: { associations: new Map() },
  });
  return { geometry, material, group };
}
const shapes = [{ shapeId: 'hand', bone: 'hand', radiusM: 0.1 }] as const;
test('default path remains numerically identical with external accounting and full X geometry', async () => {
  scene();
  const original = await createSourceEvaluator(
    new Uint8Array(),
    'synthetic',
    shapes,
  );
  const expected = [0, 500, 1000].map((t) => original.sample(durationMs(t)));
  original.dispose();
  scene();
  const events: unknown[] = [];
  const observed = await createSourceEvaluator(
    new Uint8Array(),
    'synthetic',
    shapes,
    undefined,
    {
      beforeUpdate: (event) => {
        events.push(event);
      },
    },
  );
  const actual = [0, 500, 1000].map((t) => observed.sample(durationMs(t)));
  observed.dispose();
  expect(JSON.stringify(expected)).toBe(baselineJson);
  expect(JSON.stringify(actual)).toBe(baselineJson);
  expect(events).toEqual([
    { stage: 'startup', atMs: 0 },
    { stage: 'sample', atMs: 0 },
    { stage: 'sample', atMs: 500 },
    { stage: 'sample', atMs: 1000 },
  ]);
  expect(actual[2]?.shapes[0]?.volume).toMatchObject({
    center: { x: 0, y: -2, z: expect.any(Number) },
  });
});
test('known duplicate resources drain once independently after stop failure', async () => {
  const { geometry, material } = scene();
  const g = vi.spyOn(geometry, 'dispose'),
    m = vi.spyOn(material, 'dispose');
  const evaluator = await createSourceEvaluator(
    new Uint8Array(),
    'synthetic',
    shapes,
  );
  vi.spyOn(AnimationMixer.prototype, 'stopAllAction').mockImplementation(() => {
    throw new Error('stop');
  });
  const uncache = vi.spyOn(AnimationMixer.prototype, 'uncacheRoot');
  expect(() => evaluator.dispose()).toThrow(AggregateError);
  expect(uncache).toHaveBeenCalledOnce();
  expect(g).toHaveBeenCalledOnce();
  expect(m).toHaveBeenCalledOnce();
  evaluator.dispose();
  expect(g).toHaveBeenCalledOnce();
});
test('startup observer thrown undefined remains primary despite cleanup failure', async () => {
  const { geometry, material } = scene();
  vi.spyOn(geometry, 'dispose').mockImplementation(() => {
    throw new Error('cleanup');
  });
  const m = vi.spyOn(material, 'dispose');
  let failed = false,
    value: unknown = 'not thrown';
  try {
    await createSourceEvaluator(
      new Uint8Array(),
      'synthetic',
      shapes,
      undefined,
      {
        beforeUpdate: () => {
          throw undefined;
        },
        recordCleanupError: () => {
          throw new Error('observer');
        },
      },
    );
  } catch (error) {
    failed = true;
    value = error;
  }
  expect(failed).toBe(true);
  expect(value).toBeUndefined();
  expect(m).toHaveBeenCalledOnce();
});
test('parser rejection retains original value without claiming unavailable resources', async () => {
  mocks.parse.mockRejectedValueOnce(undefined);
  let failed = false;
  try {
    await createSourceEvaluator(new Uint8Array(), 'synthetic', shapes);
  } catch (error) {
    failed = true;
    expect(error).toBeUndefined();
  }
  expect(failed).toBe(true);
});
test('actual writer preserves constant nonrest tracks on repeated seeks and rejects backward seek', async () => {
  scene();
  const evaluator = await createSourceEvaluator(
    new Uint8Array(),
    'synthetic',
    shapes,
  );
  const first = evaluator.sample(durationMs(500));
  expect(evaluator.sample(durationMs(500))).toEqual(first);
  expect(() => evaluator.sample(durationMs(400))).toThrow(RangeError);
  evaluator.dispose();
});

test('returned scene textures and skeleton resources drain despite geometry failure', async () => {
  const { geometry, material, group } = scene();
  const texture = new Texture();
  material.map = texture;
  const skeleton = new Skeleton([]);
  const boneTexture = new DataTexture();
  skeleton.boneTexture = boneTexture;
  const skin = new SkinnedMesh(geometry, material);
  skin.skeleton = skeleton;
  group.add(skin);
  const t = vi.spyOn(texture, 'dispose'),
    bone = vi.spyOn(boneTexture, 'dispose'),
    skeletonDispose = vi.spyOn(skeleton, 'dispose');
  const evaluator = await createSourceEvaluator(
    new Uint8Array(),
    'synthetic',
    shapes,
  );
  vi.spyOn(geometry, 'dispose').mockImplementation(() => {
    throw undefined;
  });
  expect(() => evaluator.dispose()).toThrow(AggregateError);
  expect(t).toHaveBeenCalledOnce();
  expect(skeletonDispose).toHaveBeenCalledOnce();
  expect(bone).toHaveBeenCalledOnce();
});
test('actual synthetic X rotation and translation survive cached measured-joint baking', async () => {
  scene();
  const receipt = createMeasuredJointReceipt(4);
  const result = await bakeMeasuredJoint({
    sourceBytes: new Uint8Array(),
    clipName: 'synthetic',
    shapes,
    receipt,
    sampleTimesMs: [0, 500, 1000],
    bakeInput: {
      clipId: clipId('synthetic'),
      category: 'punch',
      durationMs: durationMs(1000),
      sampleRateHz: 2,
      sourceTimesMs: [0, 500, 1000],
      impacts: [
        {
          impactIndex: 0,
          startMs: durationMs(0),
          endMs: durationMs(1000),
          shapeId: 'hand',
          damageShare: 1,
        },
      ],
      ownership: [
        {
          atMs: durationMs(0),
          horizontalOwner: 'authored-root',
          verticalOwner: 'authored-root',
        },
      ],
    },
  });
  expect(JSON.stringify([...result.poses.values()])).toBe(baselineJson);
  expect(receipt.rootQuaternionObservations).toHaveLength(4);
  expect(receipt.rootQuaternionObservations[3]?.quaternion[0]).toBeCloseTo(1);
  expect(receipt.attemptedSourceUpdates).toBe(4);
});
