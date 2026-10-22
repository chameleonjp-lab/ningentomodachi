import type { ViewportSnapshot } from '../contracts';
export const buttonNames = ['punch', 'kick', 'jump'] as const;
export type ButtonName = (typeof buttonNames)[number];
export interface ButtonSetting {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
}
export interface ControlSettings {
  readonly version: 1;
  readonly buttons: Readonly<Record<ButtonName, ButtonSetting>>;
}
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const settingsKey = 'ningentomodachi.controls.v1';
export const defaultSettings: ControlSettings = Object.freeze({
  version: 1,
  buttons: Object.freeze({
    punch: Object.freeze({ x: 0.8, y: 0.65, size: 64, opacity: 0.85 }),
    kick: Object.freeze({ x: 0.8, y: 0.85, size: 64, opacity: 0.85 }),
    jump: Object.freeze({ x: 0.55, y: 0.85, size: 64, opacity: 0.85 }),
  }),
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const range = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;
export function validateSettings(value: unknown): value is ControlSettings {
  if (!record(value) || value.version !== 1 || !record(value.buttons))
    return false;
  return buttonNames.every((name) => {
    const b = value.buttons;
    if (!record(b)) return false;
    const v = b[name];
    return (
      record(v) &&
      range(v.x, 0, 1) &&
      range(v.y, 0, 1) &&
      range(v.size, 44, 140) &&
      range(v.opacity, 0.3, 1)
    );
  });
}
export function readSettings(storage: SettingsStorage | undefined): {
  settings: ControlSettings;
  warning: string | null;
} {
  try {
    if (!storage)
      return {
        settings: defaultSettings,
        warning: '端末内保存を利用できません。',
      };
    const raw = storage.getItem(settingsKey);
    if (raw === null) return { settings: defaultSettings, warning: null };
    const value: unknown = JSON.parse(raw);
    if (validateSettings(value)) return { settings: value, warning: null };
  } catch {
    /* Storage and corrupt data cannot block play. */
  }
  return {
    settings: defaultSettings,
    warning: '保存設定を読み込めないため初期配置を使います。',
  };
}
export function saveSettings(
  settings: ControlSettings,
  storage: SettingsStorage | undefined,
): { settings: ControlSettings; saved: boolean } {
  const safe = validateSettings(settings) ? settings : defaultSettings;
  try {
    if (!storage) return { settings: safe, saved: false };
    storage.setItem(settingsKey, JSON.stringify(safe));
    return { settings: safe, saved: true };
  } catch {
    return { settings: safe, saved: false };
  }
}
export interface ButtonLayout {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly opacity: number;
}
export interface ControlsLayout {
  readonly buttons: Readonly<Record<ButtonName, ButtonLayout>>;
  readonly usable: boolean;
  readonly warning: string | null;
}
export function resolveLayout(
  settings: ControlSettings,
  viewport: ViewportSnapshot,
): ControlsLayout {
  const left = viewport.safeAreaCssPx.left + 8;
  const right = viewport.widthCssPx - viewport.safeAreaCssPx.right - 8;
  const top = viewport.safeAreaCssPx.top + 80;
  const bottom = viewport.heightCssPx - viewport.safeAreaCssPx.bottom - 8;
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const make = (source: ControlSettings): Record<ButtonName, ButtonLayout> => {
    const one = (name: ButtonName) => {
      const b = source.buttons[name];
      return {
        x: left + Math.max(0, width - b.size) * b.x,
        y: top + Math.max(0, height - b.size) * b.y,
        size: b.size,
        opacity: b.opacity,
      };
    };
    return { punch: one('punch'), kick: one('kick'), jump: one('jump') };
  };
  const fits = (buttons: Record<ButtonName, ButtonLayout>) => {
    const list = Object.values(buttons);
    return (
      list.every(
        (b) => b.size <= width && b.size <= height && b.x >= left + width * 0.4,
      ) &&
      list.every((a, i) =>
        list
          .slice(i + 1)
          .every(
            (b) =>
              a.x + a.size + 8 <= b.x ||
              b.x + b.size + 8 <= a.x ||
              a.y + a.size + 8 <= b.y ||
              b.y + b.size + 8 <= a.y,
          ),
      )
    );
  };
  const candidate = make(
    validateSettings(settings) ? settings : defaultSettings,
  );
  if (fits(candidate))
    return { buttons: candidate, usable: true, warning: null };
  // Compact fallback reserves the left half for swipe and the top for HUD/navigation.
  const size = Math.max(
    44,
    Math.min(64, (width * 0.6 - 8) / 2, (height - 8) / 2),
  );
  const x = right - size;
  const y = bottom - size;
  const buttons = {
    punch: { x, y: y - size - 8, size, opacity: 0.85 },
    kick: { x, y, size, opacity: 0.85 },
    jump: { x: x - size - 8, y, size, opacity: 0.85 },
  };
  return {
    buttons,
    usable: fits(buttons),
    warning: fits(buttons)
      ? '画面に収まる初期配置へ調整しました。'
      : '画面が小さすぎます。画面を広げるか横向きにしてください。',
  };
}
/** Persist the safe layout actually displayed, not rejected overlapping/offscreen coordinates. */
export function settingsForLayout(
  settings: ControlSettings,
  viewport: ViewportSnapshot,
): ControlSettings {
  const result = resolveLayout(settings, viewport);
  if (!result.usable) return defaultSettings;
  const left = viewport.safeAreaCssPx.left + 8;
  const top = viewport.safeAreaCssPx.top + 80;
  const width = viewport.widthCssPx - viewport.safeAreaCssPx.right - 8 - left;
  const height = viewport.heightCssPx - viewport.safeAreaCssPx.bottom - 8 - top;
  const one = (name: ButtonName): ButtonSetting => {
    const b = result.buttons[name];
    return {
      x: (b.x - left) / Math.max(1, width - b.size),
      y: (b.y - top) / Math.max(1, height - b.size),
      size: b.size,
      opacity: b.opacity,
    };
  };
  return {
    version: 1,
    buttons: { punch: one('punch'), kick: one('kick'), jump: one('jump') },
  };
}
