import { useState, useCallback, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { EditorState } from '../office/editor/editorState.js'
import { EditTool } from '../office/types.js'
import { TileType } from '../office/types.js'
import type { OfficeLayout, EditTool as EditToolType, TileType as TileTypeVal, FloorColor } from '../office/types.js'
import { paintTile, placeFurniture, removeFurniture, canPlaceFurniture } from '../office/editor/editorActions.js'
import { getCatalogEntry } from '../office/layout/furnitureCatalog.js'
import { defaultZoom } from '../office/toolUtils.js'
import { vscode } from '../vscodeApi.js'

export interface EditorActions {
  isEditMode: boolean
  editorTick: number
  zoom: number
  panRef: React.MutableRefObject<{ x: number; y: number }>
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  setLastSavedLayout: (layout: OfficeLayout) => void
  handleOpenClaude: () => void
  handleToggleEditMode: () => void
  handleToolChange: (tool: EditToolType) => void
  handleTileTypeChange: (type: TileTypeVal) => void
  handleFloorColorChange: (color: FloorColor) => void
  handleFurnitureTypeChange: (type: string) => void // FurnitureType enum or asset ID
  handleDeleteSelected: () => void
  handleUndo: () => void
  handleReset: () => void
  handleSave: () => void
  handleZoomChange: (zoom: number) => void
  handleEditorTileAction: (col: number, row: number) => void
}

export function useEditorActions(
  getOfficeState: () => OfficeState,
  editorState: EditorState,
): EditorActions {
  const [isEditMode, setIsEditMode] = useState(false)
  const [editorTick, setEditorTick] = useState(0)
  const [zoom, setZoom] = useState(defaultZoom)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panRef = useRef({ x: 0, y: 0 })
  const lastSavedLayoutRef = useRef<OfficeLayout | null>(null)

  // Called by useExtensionMessages on layoutLoaded to set the initial checkpoint
  const setLastSavedLayout = useCallback((layout: OfficeLayout) => {
    lastSavedLayoutRef.current = structuredClone(layout)
  }, [])

  // Debounced layout save
  const saveLayout = useCallback((layout: OfficeLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      vscode.postMessage({ type: 'saveLayout', layout })
    }, 500)
  }, [])

  // Apply a layout edit: push undo, rebuild state, save
  const applyEdit = useCallback((newLayout: OfficeLayout) => {
    const os = getOfficeState()
    editorState.pushUndo(os.getLayout())
    os.rebuildFromLayout(newLayout)
    saveLayout(newLayout)
    setEditorTick((n) => n + 1)
  }, [getOfficeState, editorState, saveLayout])

  const handleOpenClaude = useCallback(() => {
    vscode.postMessage({ type: 'openClaude' })
  }, [])

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((prev) => {
      const next = !prev
      editorState.isEditMode = next
      if (!next) {
        editorState.clearSelection()
        editorState.clearGhost()
      }
      return next
    })
  }, [editorState])

  const handleToolChange = useCallback((tool: EditToolType) => {
    editorState.activeTool = tool
    editorState.clearSelection()
    editorState.clearGhost()
    setEditorTick((n) => n + 1)
  }, [editorState])

  const handleTileTypeChange = useCallback((type: TileTypeVal) => {
    editorState.selectedTileType = type
    setEditorTick((n) => n + 1)
  }, [editorState])

  const handleFloorColorChange = useCallback((color: FloorColor) => {
    editorState.floorColor = color
    setEditorTick((n) => n + 1)
  }, [editorState])

  const handleFurnitureTypeChange = useCallback((type: string) => {
    editorState.selectedFurnitureType = type
    setEditorTick((n) => n + 1)
  }, [editorState])

  const handleDeleteSelected = useCallback(() => {
    const uid = editorState.selectedFurnitureUid
    if (!uid) return
    const os = getOfficeState()
    const newLayout = removeFurniture(os.getLayout(), uid)
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout)
      editorState.clearSelection()
    }
  }, [getOfficeState, editorState, applyEdit])

  const handleUndo = useCallback(() => {
    const prev = editorState.popUndo()
    if (!prev) return
    const os = getOfficeState()
    os.rebuildFromLayout(prev)
    saveLayout(prev)
    setEditorTick((n) => n + 1)
  }, [getOfficeState, editorState, saveLayout])

  const handleReset = useCallback(() => {
    if (!lastSavedLayoutRef.current) return
    const saved = structuredClone(lastSavedLayoutRef.current)
    applyEdit(saved)
    editorState.reset()
  }, [editorState, applyEdit])

  const handleSave = useCallback(() => {
    // Flush any pending debounced save immediately
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const os = getOfficeState()
    const layout = os.getLayout()
    lastSavedLayoutRef.current = structuredClone(layout)
    vscode.postMessage({ type: 'saveLayout', layout })
  }, [getOfficeState])

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(Math.max(1, Math.min(10, newZoom)))
  }, [])

  const handleEditorTileAction = useCallback((col: number, row: number) => {
    const os = getOfficeState()
    const layout = os.getLayout()

    if (editorState.activeTool === EditTool.TILE_PAINT) {
      const newLayout = paintTile(layout, col, row, editorState.selectedTileType, editorState.floorColor)
      if (newLayout !== layout) {
        applyEdit(newLayout)
      }
    } else if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const type = editorState.selectedFurnitureType
      if (canPlaceFurniture(layout, type, col, row)) {
        const uid = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        const newLayout = placeFurniture(layout, { uid, type, col, row })
        if (newLayout !== layout) {
          applyEdit(newLayout)
        }
      }
    } else if (editorState.activeTool === EditTool.ERASER) {
      const hit = layout.furniture.find((f) => {
        const entry = getCatalogEntry(f.type)
        if (!entry) return false
        return col >= f.col && col < f.col + entry.footprintW && row >= f.row && row < f.row + entry.footprintH
      })
      if (hit) {
        const newLayout = removeFurniture(layout, hit.uid)
        if (newLayout !== layout) {
          applyEdit(newLayout)
        }
      }
    } else if (editorState.activeTool === EditTool.EYEDROPPER) {
      const idx = row * layout.cols + col
      const tile = layout.tiles[idx]
      if (tile !== undefined && tile !== TileType.WALL) {
        editorState.selectedTileType = tile
        const color = layout.tileColors?.[idx]
        if (color) {
          editorState.floorColor = { ...color }
        }
        editorState.activeTool = EditTool.TILE_PAINT
      } else if (tile === TileType.WALL) {
        editorState.selectedTileType = TileType.WALL
        editorState.activeTool = EditTool.TILE_PAINT
      }
      setEditorTick((n) => n + 1)
    } else if (editorState.activeTool === EditTool.SELECT) {
      const hit = layout.furniture.find((f) => {
        const entry = getCatalogEntry(f.type)
        if (!entry) return false
        return col >= f.col && col < f.col + entry.footprintW && row >= f.row && row < f.row + entry.footprintH
      })
      editorState.selectedFurnitureUid = hit ? hit.uid : null
      setEditorTick((n) => n + 1)
    }
  }, [getOfficeState, editorState, applyEdit])

  return {
    isEditMode,
    editorTick,
    zoom,
    panRef,
    saveTimerRef,
    setLastSavedLayout,
    handleOpenClaude,
    handleToggleEditMode,
    handleToolChange,
    handleTileTypeChange,
    handleFloorColorChange,
    handleFurnitureTypeChange,
    handleDeleteSelected,
    handleUndo,
    handleReset,
    handleSave,
    handleZoomChange,
    handleEditorTileAction,
  }
}
