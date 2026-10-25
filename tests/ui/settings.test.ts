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

test('default attack targets are 80 pixels and at least 44 after responsive fallback', () => {
  expect(defaultSettings.version).toBe(2);
  expect(defaultSettings.buttons.punch.size).toBe(80);
  expect(defaultSettings.buttons.kick.size).toBe(80);
  expect(defaultSettings.buttons.jump.size).toBe(48);
  for (const [widthCssPx, heightCssPx, safeAreaCssPx] of [
    [390, 844, { top: 47, bottom: 34, left: 0, right: 0 }],
    [844, 390, { top: 0, bottom: 21, left: 44, right: 44 }],
    [320, 568, { top: 24, bottom: 20, left: 8, right: 8 }],
    [200, 250, { top: 0, bottom: 0, left: 0, right: 0 }],
  ] as const) {
    const v = { ...viewport, widthCssPx, heightCssPx, safeAreaCssPx };
    const layout = resolveLayout(defaultSettings, v);
    expect(layout.usable).toBe(true);
    if (widthCssPx >= 320) {
      expect(layout.buttons.punch.size).toBe(80);
      expect(layout.buttons.kick.size).toBe(80);
      expect(layout.buttons.jump.size).toBe(48);
    }
    const buttons = Object.values(layout.buttons);
    for (const b of buttons) {
      expect(b.size).toBeGreaterThanOrEqual(44);
      expect(b.x).toBeGreaterThanOrEqual(
        Math.max(safeAreaCssPx.left + 8, widthCssPx * 0.4 + 12),
      );
      expect(b.y).toBeGreaterThanOrEqual(safeAreaCssPx.top + 80);
      expect(b.x + b.size).toBeLessThanOrEqual(
        widthCssPx - safeAreaCssPx.right - 8,
      );
      expect(b.y + b.size).toBeLessThanOrEqual(
        heightCssPx - safeAreaCssPx.bottom - 8,
      );
    }
    for (const [index, a] of buttons.entries())
      for (const b of buttons.slice(index + 1))
        expect(
          a.x + a.size + 12 <= b.x ||
            b.x + b.size + 12 <= a.x ||
            a.y + a.size + 12 <= b.y ||
            b.y + b.size + 12 <= a.y,
        ).toBe(true);
  }
  expect(
    resolveLayout(defaultSettings, {
      ...viewport,
      widthCssPx: 160,
      heightCssPx: 180,
    }).usable,
  ).toBe(false);
});

test('v1 saved bytes are unchanged after reading rendering and rotating', () => {
  const legacyKey = 'ningentomodachi.controls.v1';
  const currentKey = 'ningentomodachi.controls.v2';
  const legacy = {
    version: 1,
    buttons: Object.fromEntries(
      ['punch', 'kick', 'jump'].map((name) => [
        name,
        { x: 1, y: 1, size: 64, opacity: 0.7 },
      ]),
    ),
  };
  const raw = JSON.stringify(legacy, null, 3);
  const bytes = new Map([[legacyKey, raw]]);
  const writes: string[] = [];
  const storage = {
    getItem: (key: string) => bytes.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      bytes.set(key, value);
    },
  };
  expect(validateSettings(legacy)).toBe(true);
  const loaded = readSettings(storage);
  expect(loaded.settings.version).toBe(2);
  expect(loaded.settings.buttons.punch).toMatchObject({
    size: 80,
    opacity: 0.7,
  });
  expect(loaded.settings.buttons.jump).toMatchObject({
    size: 48,
    opacity: 0.7,
  });
  for (const [widthCssPx, heightCssPx] of [
    [390, 844],
    [844, 390],
    [320, 568],
  ])
    expect(
      resolveLayout(loaded.settings, {
        ...viewport,
        widthCssPx: widthCssPx ?? 0,
        heightCssPx: heightCssPx ?? 0,
      }).usable,
    ).toBe(true);
  expect(bytes.get(legacyKey)).toBe(raw);
  expect(bytes.has(currentKey)).toBe(false);
  expect(writes).toEqual([]);
  expect(saveSettings(loaded.settings, storage).saved).toBe(true);
  expect(writes).toEqual([currentKey]);
  expect(bytes.get(legacyKey)).toBe(raw);
  const customized = {
    ...defaultSettings,
    buttons: {
      ...defaultSettings.buttons,
      punch: { ...defaultSettings.buttons.punch, size: 92 },
    },
  };
  saveSettings(customized, storage);
  expect(readSettings(storage).settings).toEqual(customized);
});

test('asymmetric custom targets compact to a feasible layout instead of a false unusable warning', () => {
  const custom = {
    ...defaultSettings,
    buttons: {
      ...defaultSettings.buttons,
      punch: { ...defaultSettings.buttons.punch, size: 140 },
      kick: { ...defaultSettings.buttons.kick, size: 44 },
      jump: { ...defaultSettings.buttons.jump, size: 44 },
    },
  };
  const small = {
    ...viewport,
    widthCssPx: 320,
    heightCssPx: 200,
    safeAreaCssPx: { top: 0, bottom: 0, left: 0, right: 0 },
  };
  const layout = resolveLayout(custom, small);
  expect(layout.usable).toBe(true);
  expect(layout.buttons.punch.size).toBeGreaterThanOrEqual(44);
  expect(layout.buttons.kick.size).toBeGreaterThanOrEqual(44);
  expect(layout.buttons.punch.y).toBeGreaterThanOrEqual(80);
  expect(
    layout.buttons.punch.y + layout.buttons.punch.size + 12,
  ).toBeLessThanOrEqual(layout.buttons.kick.y);
});
