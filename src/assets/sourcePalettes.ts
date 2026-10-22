// Exact material values from four read-only source GLBs. See source receipt.
import type { ActorColor } from '../contracts';
import type { VerifiedPalette } from './threeAssetPack';
export const SOURCE_PALETTES = {
  black: {
    armorRgb: [0.012, 0.012, 0.014],
    emissiveRgb: [1, 0, 0],
    inlayBaseRgb: [0.9100000262260437, 0, 0],
    emissiveStrength: 2.9120001273155225,
    sourceSha256:
      '81e7b286b3b485b7b76452fe921cb9280693fe9155114834f594690ab44e04a5',
  },
  blue: {
    armorRgb: [0.025, 0.15, 0.65],
    emissiveRgb: [1, 0, 0],
    inlayBaseRgb: [0.9100000262260437, 0, 0],
    emissiveStrength: 2.9120001273155225,
    sourceSha256:
      '977f24d30591f63d22a42a0b201b98107cd1af231f25d02503567441063f74b6',
  },
  green: {
    armorRgb: [0.025, 0.45, 0.09],
    emissiveRgb: [1, 0, 0],
    inlayBaseRgb: [0.9100000262260437, 0, 0],
    emissiveStrength: 2.9120001273155225,
    sourceSha256:
      '7c578c7b65c0c383043fb2e1a4935b054cf71a089b51128be4f1e3af0cd44a13',
  },
  yellow: {
    armorRgb: [0.9, 0.62, 0.015],
    emissiveRgb: [1, 0, 0],
    inlayBaseRgb: [0.9100000262260437, 0, 0],
    emissiveStrength: 2.9120001273155225,
    sourceSha256:
      '15b9abbfc26b11c08957cd43120e54b049c6858be1e8dcb1b8f39f42d1fdf9bb',
  },
} as const satisfies Partial<Record<ActorColor, VerifiedPalette>>;
