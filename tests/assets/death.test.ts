import { expect, test } from 'vitest';
import { Bone, Group } from 'three';
import {
  authorDeathClips,
  deathClipSeconds,
} from '../../src/assets/deathAnimation';
import { durationMs, presentationTimeMs } from '../../src/contracts';
test('two distinct nonloop death clips have exactly 0.5 seconds and preserve source hierarchy', () => {
  const node = new Group();
  const root = new Bone();
  root.name = 'root';
  const pelvis = new Bone();
  pelvis.name = 'pelvis';
  root.add(pelvis);
  node.add(root);
  const original = node.toJSON();
  const clips = authorDeathClips(node);
  expect(clips.map((c) => c.name)).toEqual(['DefeatPunch', 'DefeatKick']);
  expect(clips.map((c) => c.duration)).toEqual([0.5, 0.5]);
  expect(clips[0]?.tracks[0]?.values).not.toEqual(clips[1]?.tracks[0]?.values);
  expect(node.toJSON()).toEqual(original);
});
test('authoritative death clock completes white in two real seconds and enemy remainder at full speed without resetting', () => {
  const white = {
    category: 'punch' as const,
    startedAt: presentationTimeMs(100),
    slowDurationMs: durationMs(2000),
    playbackRate: 0.25 as const,
  };
  const enemy = { ...white, slowDurationMs: durationMs(1500) };
  expect(deathClipSeconds(white, presentationTimeMs(2100))).toBe(0.5);
  expect(deathClipSeconds(enemy, presentationTimeMs(1600))).toBe(0.375);
  expect(deathClipSeconds(enemy, presentationTimeMs(1725))).toBe(0.5);
  expect(deathClipSeconds(enemy, presentationTimeMs(9000))).toBe(0.5);
});
