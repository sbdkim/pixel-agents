import { EditTool, TileType } from '../types.js'
import type { TileType as TileTypeVal, OfficeLayout, FloorColor } from '../types.js'

export class EditorState {
  isEditMode = false
  activeTool: EditTool = EditTool.SELECT
  selectedTileType: TileTypeVal = TileType.FLOOR_1
  selectedFurnitureType: string = 'desk' // FurnitureType.DESK or asset ID

  // Floor color settings (applied to new tiles when painting)
  floorColor: FloorColor = { h: 35, s: 30, b: 15, c: 0 }

  // Ghost preview position
  ghostCol = -1
  ghostRow = -1
  ghostValid = false

  // Selection
  selectedFurnitureUid: string | null = null

  // Mouse drag state
  isDragging = false

  // Undo stack
  undoStack: OfficeLayout[] = []

  pushUndo(layout: OfficeLayout): void {
    this.undoStack.push(layout)
    // Limit undo stack size
    if (this.undoStack.length > 50) {
      this.undoStack.shift()
    }
  }

  popUndo(): OfficeLayout | null {
    return this.undoStack.pop() || null
  }

  clearSelection(): void {
    this.selectedFurnitureUid = null
  }

  clearGhost(): void {
    this.ghostCol = -1
    this.ghostRow = -1
    this.ghostValid = false
  }

  reset(): void {
    this.activeTool = EditTool.SELECT
    this.selectedFurnitureUid = null
    this.ghostCol = -1
    this.ghostRow = -1
    this.ghostValid = false
    this.isDragging = false
    this.undoStack = []
  }
}
