import { TileType, FurnitureType, MAP_COLS, MAP_ROWS, TILE_SIZE, Direction } from '../types.js'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, Seat, FurnitureInstance } from '../types.js'
import { getCatalogEntry } from './furnitureCatalog.js'

/** Convert flat tile array from layout into 2D grid */
export function layoutToTileMap(layout: OfficeLayout): TileTypeVal[][] {
  const map: TileTypeVal[][] = []
  for (let r = 0; r < layout.rows; r++) {
    const row: TileTypeVal[] = []
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c])
    }
    map.push(row)
  }
  return map
}

/** Convert placed furniture into renderable FurnitureInstance[] */
export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  const instances: FurnitureInstance[] = []
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const x = item.col * TILE_SIZE
    const y = item.row * TILE_SIZE
    const spriteH = entry.sprite.length
    instances.push({
      sprite: entry.sprite,
      x,
      y,
      zY: y + spriteH,
    })
  }
  return instances
}

/** Get all tiles blocked by furniture footprints, optionally excluding a set of tiles */
export function getBlockedTiles(furniture: PlacedFurniture[], excludeTiles?: Set<string>): Set<string> {
  const tiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        if (excludeTiles && excludeTiles.has(key)) continue
        tiles.add(key)
      }
    }
  }
  return tiles
}

/** Generate seats from chair furniture placed adjacent to desks */
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>()

  // Build set of all desk tiles
  const deskTiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`)
      }
    }
  }

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP },    // desk is above chair → face UP
    { dc: 0, dr: 1, facing: Direction.DOWN },   // desk is below chair → face DOWN
    { dc: -1, dr: 0, facing: Direction.LEFT },   // desk is left of chair → face LEFT
    { dc: 1, dr: 0, facing: Direction.RIGHT },   // desk is right of chair → face RIGHT
  ]

  // For each chair furniture, check adjacency to desks
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || entry.category !== 'chairs') continue

    let found = false
    // Iterate all footprint tiles of this chair
    for (let dr = 0; dr < entry.footprintH && !found; dr++) {
      for (let dc = 0; dc < entry.footprintW && !found; dc++) {
        const tileCol = item.col + dc
        const tileRow = item.row + dr
        // Check 4 cardinal neighbors for desk tiles
        for (const d of dirs) {
          const neighborKey = `${tileCol + d.dc},${tileRow + d.dr}`
          if (deskTiles.has(neighborKey)) {
            seats.set(item.uid, {
              uid: item.uid,
              seatCol: tileCol,
              seatRow: tileRow,
              facingDir: d.facing,
              assigned: false,
            })
            found = true
            break
          }
        }
      }
    }
  }

  return seats
}

/** Get the set of tiles occupied by seats (so they can be excluded from blocked tiles) */
export function getSeatTiles(seats: Map<string, Seat>): Set<string> {
  const tiles = new Set<string>()
  for (const seat of seats.values()) {
    tiles.add(`${seat.seatCol},${seat.seatRow}`)
  }
  return tiles
}

/** Create the default office layout matching the current hardcoded office */
export function createDefaultLayout(): OfficeLayout {
  const W = TileType.WALL
  const T = TileType.TILE_FLOOR
  const F = TileType.WOOD_FLOOR
  const C = TileType.CARPET
  const D = TileType.DOORWAY

  const tiles: TileTypeVal[] = []
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (r === 0 || r === MAP_ROWS - 1) { tiles.push(W); continue }
      if (c === 0 || c === MAP_COLS - 1) { tiles.push(W); continue }
      if (c === 10) { tiles.push(r >= 4 && r <= 6 ? D : W); continue }
      if (c >= 15 && c <= 18 && r >= 7 && r <= 9) { tiles.push(C); continue }
      tiles.push(c < 10 ? T : F)
    }
  }

  const furniture: PlacedFurniture[] = [
    { uid: 'desk-left', type: FurnitureType.DESK, col: 4, row: 3 },
    { uid: 'desk-right', type: FurnitureType.DESK, col: 13, row: 3 },
    { uid: 'bookshelf-1', type: FurnitureType.BOOKSHELF, col: 1, row: 5 },
    { uid: 'plant-left', type: FurnitureType.PLANT, col: 1, row: 1 },
    { uid: 'cooler-1', type: FurnitureType.COOLER, col: 17, row: 7 },
    { uid: 'plant-right', type: FurnitureType.PLANT, col: 18, row: 1 },
    { uid: 'whiteboard-1', type: FurnitureType.WHITEBOARD, col: 15, row: 0 },
    // Left desk chairs
    { uid: 'chair-l-top', type: FurnitureType.CHAIR, col: 4, row: 2 },
    { uid: 'chair-l-bottom', type: FurnitureType.CHAIR, col: 5, row: 5 },
    { uid: 'chair-l-left', type: FurnitureType.CHAIR, col: 3, row: 4 },
    { uid: 'chair-l-right', type: FurnitureType.CHAIR, col: 6, row: 3 },
    // Right desk chairs
    { uid: 'chair-r-top', type: FurnitureType.CHAIR, col: 13, row: 2 },
    { uid: 'chair-r-bottom', type: FurnitureType.CHAIR, col: 14, row: 5 },
    { uid: 'chair-r-left', type: FurnitureType.CHAIR, col: 12, row: 4 },
    { uid: 'chair-r-right', type: FurnitureType.CHAIR, col: 15, row: 3 },
  ]

  return { version: 1, cols: MAP_COLS, rows: MAP_ROWS, tiles, furniture }
}

/** Serialize layout to JSON string */
export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout)
}

/** Deserialize layout from JSON string */
export function deserializeLayout(json: string): OfficeLayout | null {
  try {
    const obj = JSON.parse(json)
    if (obj && obj.version === 1 && Array.isArray(obj.tiles) && Array.isArray(obj.furniture)) {
      return obj as OfficeLayout
    }
  } catch { /* ignore parse errors */ }
  return null
}
