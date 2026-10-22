import { expect, test } from 'vitest';
import {
  defaultSettings,
  readSettings,
  saveSettings,
  resolveLayout,
  validateSettings,
} from '../../src/ui/settings';
import { viewport } from './fixtures/core';
test('invalid JSON, unknown versions, missing and nonfinite values recover safely', () => {
  for (const raw of [
    '{',
    '{}',
    '{"version":999}',
    JSON.stringify({
      ...defaultSettings,
      buttons: { punch: { x: NaN, y: 0, size: 10, opacity: 0 } },
    }),
  ]) {
    const result = readSettings({ getItem: () => raw, setItem: () => {} });
    expect(result.settings).toEqual(defaultSettings);
    expect(result.warning).not.toBeNull();
  }
  expect(validateSettings(defaultSettings)).toBe(true);
});
test('storage denial keeps changed settings in memory and reports failure honestly', () => {
  const changed = {
    ...defaultSettings,
    buttons: {
      ...defaultSettings.buttons,
      punch: { ...defaultSettings.buttons.punch, opacity: 0.7 },
    },
  };
  expect(
    saveSettings(changed, {
      getItem: () => null,
      setItem: () => {
        throw Error('quota');
      },
    }),
  ).toMatchObject({ settings: changed, saved: false });
  expect(
    readSettings({
      getItem: () => {
        throw Error('denied');
      },
      setItem: () => {},
    }).settings,
  ).toEqual(defaultSettings);
});
test('layout preserves minimum touch size, safe area, nonoverlap and required top controls in portrait and landscape', () => {
  for (const v of [
    viewport,
    { ...viewport, widthCssPx: 844, heightCssPx: 390 },
    { ...viewport, widthCssPx: 320, heightCssPx: 568 },
  ]) {
    const layout = resolveLayout(defaultSettings, v);
    expect(layout.usable).toBe(true);
    const buttons = Object.values(layout.buttons);
    for (const b of buttons) {
      expect(b.size).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(v.safeAreaCssPx.left);
      expect(b.y).toBeGreaterThanOrEqual(v.safeAreaCssPx.top + 80);
      expect(b.x + b.size).toBeLessThanOrEqual(
        v.widthCssPx - v.safeAreaCssPx.right,
      );
      expect(b.y + b.size).toBeLessThanOrEqual(
        v.heightCssPx - v.safeAreaCssPx.bottom,
      );
    }
    for (let i = 0; i < buttons.length; i++)
      for (let j = i + 1; j < buttons.length; j++) {
        const a = buttons[i];
        const b = buttons[j];
        if (!a || !b) throw Error('Missing layout');
        expect(
          a.x + a.size <= b.x ||
            b.x + b.size <= a.x ||
            a.y + a.size <= b.y ||
            b.y + b.size <= a.y,
        ).toBe(true);
      }
  }
});
test('overlapping custom positions fallback visibly; impossibly small viewport stays honest', () => {
  const settings = {
    ...defaultSettings,
    buttons: {
      punch: { x: 1, y: 1, size: 140, opacity: 0.5 },
      kick: { x: 1, y: 1, size: 140, opacity: 0.5 },
      jump: { x: 1, y: 1, size: 140, opacity: 0.5 },
    },
  };
  expect(resolveLayout(settings, viewport).warning).not.toBeNull();
  expect(resolveLayout(settings, viewport).usable).toBe(true);
  expect(
    resolveLayout(defaultSettings, {
      ...viewport,
      widthCssPx: 50,
      heightCssPx: 60,
    }).usable,
  ).toBe(false);
});
test('resolved settings persist actual safe fallback rather than an overlapping request', async () => {
  const { settingsForLayout } = await import('../../src/ui/settings');
  const requested = {
    ...defaultSettings,
    buttons: {
      punch: { x: 1, y: 1, size: 140, opacity: 0.5 },
      kick: { x: 1, y: 1, size: 140, opacity: 0.5 },
      jump: { x: 1, y: 1, size: 140, opacity: 0.5 },
    },
  };
  const saved = settingsForLayout(requested, viewport);
  expect(saved).not.toEqual(requested);
  expect(resolveLayout(saved, viewport).warning).toBeNull();
});
