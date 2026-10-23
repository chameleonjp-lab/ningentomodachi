import { expect, test } from 'vitest';
import { clipId, durationMs } from '../../src/contracts';
import type {
  AnimationPort,
  MotionCatalogPort,
  PoseCatalogBindings,
  PoseDisplayCapability,
} from '../../src/contracts';

test('deferred catalog getter explicitly represents unprepared descriptor absence', () => {
  let descriptor: PoseCatalogBindings | undefined;
  const port = {
    get pose() {
      return descriptor;
    },
  } satisfies Pick<MotionCatalogPort, 'pose'>;
  expect(port.pose).toBeUndefined();
  descriptor = {
    version: 1,
    bindingSetId: 'trusted-test-descriptor',
    clips: ['idle', 'walk', 'run', 'jump'].map((id) => ({
      clipId: clipId(id),
      durationMs: durationMs(1000),
      sourceBindingId: `trusted:${id}`,
    })),
    locomotion: {
      idle: clipId('idle'),
      walk: clipId('walk'),
      run: clipId('run'),
      jump: clipId('jump'),
    },
  };
  expect(port.pose).toBe(descriptor);
});
test('deferred display getter does not claim capability before its real delegate exists', () => {
  let capability: PoseDisplayCapability | undefined;
  const port = {
    get poseProtocol() {
      return capability;
    },
  } satisfies Pick<AnimationPort, 'poseProtocol'>;
  expect(port.poseProtocol).toBeUndefined();
  capability = { version: 1, protocol: 'deterministic-pose-v1' };
  expect(port.poseProtocol).toBe(capability);
  capability = undefined;
  expect(port.poseProtocol).toBeUndefined();
});
