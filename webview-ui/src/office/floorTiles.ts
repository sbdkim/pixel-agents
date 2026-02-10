/**
 * Floor tile pattern storage, colorization, and caching.
 *
 * Stores 7 grayscale floor patterns loaded from floors.png.
 * Provides colorize() to tint patterns via HSL (Photoshop-style Colorize).
 * Caches colorized SpriteData by (pattern, h, s, b, c) key.
 */

import type { SpriteData, FloorColor } from './types.js'

/** Module-level storage for the 7 floor tile sprites (set once on load) */
let floorSprites: SpriteData[] = []

/** Cache: "patternIdx-h-s-b-c" → colorized SpriteData */
const colorizeCache = new Map<string, SpriteData>()

/** Wall color constant */
export const WALL_COLOR = '#3A3A5C'

/** Set floor tile sprites (called once when extension sends floorTilesLoaded) */
export function setFloorSprites(sprites: SpriteData[]): void {
  floorSprites = sprites
  colorizeCache.clear()
}

/** Get the raw (grayscale) floor sprite for a pattern index (1-7 → array index 0-6) */
export function getFloorSprite(patternIndex: number): SpriteData | null {
  const idx = patternIndex - 1
  if (idx < 0 || idx >= floorSprites.length) return null
  return floorSprites[idx]
}

/** Check if floor sprites have been loaded */
export function hasFloorSprites(): boolean {
  return floorSprites.length > 0
}

/** Get count of available floor patterns */
export function getFloorPatternCount(): number {
  return floorSprites.length
}

/** Get all floor sprites (for preview rendering) */
export function getAllFloorSprites(): SpriteData[] {
  return floorSprites
}

/**
 * Get a colorized version of a floor sprite.
 * Uses Photoshop-style Colorize: grayscale → HSL with given hue/saturation,
 * then brightness/contrast adjustment.
 */
export function getColorizedFloorSprite(patternIndex: number, color: FloorColor): SpriteData {
  const key = `${patternIndex}-${color.h}-${color.s}-${color.b}-${color.c}`
  const cached = colorizeCache.get(key)
  if (cached) return cached

  const base = getFloorSprite(patternIndex)
  if (!base) {
    // Return a 16x16 magenta error tile
    const err: SpriteData = Array.from({ length: 16 }, () => Array(16).fill('#FF00FF'))
    return err
  }

  const result: SpriteData = colorizeSprite(base, color)
  colorizeCache.set(key, result)
  return result
}

/**
 * Colorize a grayscale sprite using HSL transformation.
 *
 * Algorithm (Photoshop Colorize-style):
 * 1. Parse each pixel's grayscale value as lightness (0-1)
 * 2. Apply contrast: stretch/compress around midpoint 0.5
 * 3. Apply brightness: shift lightness up/down
 * 4. Create HSL color with user's hue + saturation
 * 5. Convert HSL → RGB → hex
 */
function colorizeSprite(sprite: SpriteData, color: FloorColor): SpriteData {
  const { h, s, b, c } = color
  const result: SpriteData = []

  for (const row of sprite) {
    const newRow: string[] = []
    for (const pixel of row) {
      if (pixel === '') {
        newRow.push('')
        continue
      }

      // Parse hex to get grayscale value (use the red channel)
      const r = parseInt(pixel.slice(1, 3), 16)
      const g = parseInt(pixel.slice(3, 5), 16)
      const bv = parseInt(pixel.slice(5, 7), 16)
      // Use perceived luminance for grayscale
      let lightness = (0.299 * r + 0.587 * g + 0.114 * bv) / 255

      // Apply contrast: expand/compress around 0.5
      if (c !== 0) {
        const factor = (100 + c) / 100
        lightness = 0.5 + (lightness - 0.5) * factor
      }

      // Apply brightness: shift up/down
      if (b !== 0) {
        lightness = lightness + b / 200
      }

      // Clamp
      lightness = Math.max(0, Math.min(1, lightness))

      // Convert HSL to RGB
      const satFrac = s / 100
      const hex = hslToHex(h, satFrac, lightness)
      newRow.push(hex)
    }
    result.push(newRow)
  }

  return result
}

/** Convert HSL (h: 0-360, s: 0-1, l: 0-1) to #RRGGBB hex string */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs(hp % 2 - 1))
  let r1 = 0, g1 = 0, b1 = 0

  if (hp < 1) { r1 = c; g1 = x; b1 = 0 }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0 }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }

  const m = l - c / 2
  const r = Math.round((r1 + m) * 255)
  const g = Math.round((g1 + m) * 255)
  const bOut = Math.round((b1 + m) * 255)

  return `#${clamp255(r).toString(16).padStart(2, '0')}${clamp255(g).toString(16).padStart(2, '0')}${clamp255(bOut).toString(16).padStart(2, '0')}`.toUpperCase()
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v))
}
