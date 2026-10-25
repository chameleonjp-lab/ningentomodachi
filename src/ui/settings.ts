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
  readonly version: 1 | 2;
  readonly buttons: Readonly<Record<ButtonName, ButtonSetting>>;
}
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export const legacySettingsKey = 'ningentomodachi.controls.v1';
export const settingsKey = 'ningentomodachi.controls.v2';
export const defaultSettings: ControlSettings = Object.freeze({
  version: 2,
  buttons: Object.freeze({
    punch: Object.freeze({ x: 0.8, y: 0.65, size: 80, opacity: 0.85 }),
    kick: Object.freeze({ x: 0.8, y: 0.85, size: 80, opacity: 0.85 }),
    jump: Object.freeze({ x: 0.55, y: 0.85, size: 48, opacity: 0.85 }),
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
  if (
    !record(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !record(value.buttons)
  )
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
/** Upgrade only in memory. The original v1 key and bytes are never written. */
function currentSettings(settings: ControlSettings): ControlSettings {
  if (settings.version === 2) return settings;
  const one = (name: ButtonName): ButtonSetting => ({
    ...settings.buttons[name],
    size:
      settings.buttons[name].size === 64
        ? defaultSettings.buttons[name].size
        : settings.buttons[name].size,
  });
  return {
    version: 2,
    buttons: { punch: one('punch'), kick: one('kick'), jump: one('jump') },
  };
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
    const raw =
      storage.getItem(settingsKey) ?? storage.getItem(legacySettingsKey);
    if (raw === null) return { settings: defaultSettings, warning: null };
    const value: unknown = JSON.parse(raw);
    if (validateSettings(value))
      return { settings: currentSettings(value), warning: null };
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
  const safe = validateSettings(settings)
    ? currentSettings(settings)
    : defaultSettings;
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
  const gap = 12;
  const controlsLeft = Math.max(left, viewport.widthCssPx * 0.4 + gap);
  const source = validateSettings(settings)
    ? currentSettings(settings)
    : defaultSettings;
  const one = (name: ButtonName): ButtonLayout => {
    const b = source.buttons[name];
    return {
      x: left + Math.max(0, width - b.size) * b.x,
      y: top + Math.max(0, height - b.size) * b.y,
      size: b.size,
      opacity: b.opacity,
    };
  };
  const fits = (buttons: Record<ButtonName, ButtonLayout>) => {
    const list = Object.values(buttons);
    // Normalizing an explicitly saved layout may introduce subpixel roundoff.
    const epsilon = 1e-7;
    return (
      list.every(
        (b) =>
          b.size >= 44 &&
          b.x >= controlsLeft - epsilon &&
          b.y >= top - epsilon &&
          b.x + b.size <= right + epsilon &&
          b.y + b.size <= bottom + epsilon,
      ) &&
      list.every((a, i) =>
        list
          .slice(i + 1)
          .every(
            (b) =>
              a.x + a.size + gap <= b.x + epsilon ||
              b.x + b.size + gap <= a.x + epsilon ||
              a.y + a.size + gap <= b.y + epsilon ||
              b.y + b.size + gap <= a.y + epsilon,
          ),
      )
    );
  };
  const candidate = {
    punch: one('punch'),
    kick: one('kick'),
    jump: one('jump'),
  };
  const initialPlacement = buttonNames.every(
    (name) =>
      source.buttons[name].x === defaultSettings.buttons[name].x &&
      source.buttons[name].y === defaultSettings.buttons[name].y,
  );
  if (!initialPlacement && fits(candidate))
    return { buttons: candidate, usable: true, warning: null };
  // Right-thumb cluster. Keep a separate left-side swipe region and never
  // shrink any target below 44px, even when the viewport cannot fit the result.
  const availableWidth = right - controlsLeft;
  const jumpSize = Math.max(
    44,
    Math.min(source.buttons.jump.size, 48, availableWidth - gap - 44, height),
  );
  const desiredPunch = initialPlacement
    ? source.buttons.punch.size
    : Math.min(source.buttons.punch.size, 80);
  const desiredKick = initialPlacement
    ? source.buttons.kick.size
    : Math.min(source.buttons.kick.size, 80);
  const maxAttackSize = Math.max(44, availableWidth - gap - jumpSize);
  const boundedPunch = Math.min(desiredPunch, maxAttackSize);
  const boundedKick = Math.min(desiredKick, maxAttackSize);
  // Reserve both minimum targets before sharing the remaining vertical space.
  // Scaling whole unequal targets then clamping one to 44 could falsely fail.
  const extra = boundedPunch + boundedKick - 88;
  const scale =
    extra > 0 ? Math.max(0, Math.min(1, (height - gap - 88) / extra)) : 1;
  const punchSize = 44 + Math.floor((boundedPunch - 44) * scale);
  const kickSize = 44 + Math.floor((boundedKick - 44) * scale);
  const buttons = {
    punch: {
      x: right - punchSize,
      y: bottom - kickSize - gap - punchSize,
      size: punchSize,
      opacity: source.buttons.punch.opacity,
    },
    kick: {
      x: right - kickSize,
      y: bottom - kickSize,
      size: kickSize,
      opacity: source.buttons.kick.opacity,
    },
    jump: {
      x: right - Math.max(punchSize, kickSize) - gap - jumpSize,
      y: bottom - jumpSize,
      size: jumpSize,
      opacity: source.buttons.jump.opacity,
    },
  };
  const usable = fits(buttons);
  return {
    buttons,
    usable,
    warning: !usable
      ? '画面が小さすぎます。画面を広げてください。'
      : initialPlacement
        ? null
        : '画面に収まる初期配置へ調整しました。',
  };
}
/** Resolve in memory; only an explicit save may persist this displayed layout. */
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
    version: 2,
    buttons: { punch: one('punch'), kick: one('kick'), jump: one('jump') },
  };
}
