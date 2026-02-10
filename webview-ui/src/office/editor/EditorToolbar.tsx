import { useState, useEffect, useRef, useCallback } from 'react'
import { EditTool, TileType } from '../types.js'
import type { TileType as TileTypeVal, FloorColor } from '../types.js'
import { getCatalogByCategory, buildDynamicCatalog, getActiveCategories } from '../layout/furnitureCatalog.js'
import type { FurnitureCategory, LoadedAssetData } from '../layout/furnitureCatalog.js'
import { getCachedSprite } from '../sprites/spriteCache.js'
import { getColorizedFloorSprite, getFloorPatternCount, hasFloorSprites } from '../floorTiles.js'

const btnStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: '11px',
  background: 'var(--vscode-button-secondaryBackground, #3A3D41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid transparent',
  borderRadius: 3,
  cursor: 'pointer',
}

const activeBtnStyle: React.CSSProperties = {
  ...btnStyle,
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: '1px solid var(--vscode-focusBorder, #007fd4)',
}

const tabStyle: React.CSSProperties = {
  padding: '2px 6px',
  fontSize: '10px',
  background: 'transparent',
  color: 'var(--vscode-button-secondaryForeground, #999)',
  border: '1px solid transparent',
  borderRadius: 2,
  cursor: 'pointer',
}

const activeTabStyle: React.CSSProperties = {
  ...tabStyle,
  background: 'var(--vscode-button-secondaryBackground, #3A3D41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: '1px solid var(--vscode-focusBorder, #007fd4)',
}

interface EditorToolbarProps {
  activeTool: EditTool
  selectedTileType: TileTypeVal
  selectedFurnitureType: string
  selectedFurnitureUid: string | null
  floorColor: FloorColor
  onToolChange: (tool: EditTool) => void
  onTileTypeChange: (type: TileTypeVal) => void
  onFloorColorChange: (color: FloorColor) => void
  onFurnitureTypeChange: (type: string) => void
  onDeleteSelected: () => void
  onUndo: () => void
  onReset: () => void
  onSave: () => void
  loadedAssets?: LoadedAssetData
}

/** Render a 3×3 tiled preview of a floor pattern at the given color */
function FloorPatternPreview({ patternIndex, color, selected, onClick }: {
  patternIndex: number
  color: FloorColor
  selected: boolean
  onClick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = 48 // 3×16 = 48, shown at 48px
  const tileZoom = 1 // render each sprite pixel as 1 canvas pixel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = size
    canvas.height = size
    ctx.imageSmoothingEnabled = false

    if (!hasFloorSprites()) {
      ctx.fillStyle = '#444'
      ctx.fillRect(0, 0, size, size)
      return
    }

    const sprite = getColorizedFloorSprite(patternIndex, color)
    const cached = getCachedSprite(sprite, tileZoom)

    // Draw 3×3 grid of the tile
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.drawImage(cached, c * 16, r * 16)
      }
    }
  }, [patternIndex, color])

  return (
    <button
      onClick={onClick}
      title={`Floor ${patternIndex}`}
      style={{
        width: size,
        height: size,
        padding: 0,
        border: selected ? '2px solid var(--vscode-focusBorder, #007fd4)' : '1px solid #555',
        borderRadius: 3,
        cursor: 'pointer',
        overflow: 'hidden',
        flexShrink: 0,
        background: '#2A2A3A',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, display: 'block' }}
      />
    </button>
  )
}

/** Slider control for a single color parameter */
function ColorSlider({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: '10px', color: '#999', width: 14, textAlign: 'right', flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, height: 12, accentColor: 'var(--vscode-focusBorder, #007fd4)' }}
      />
      <span style={{ fontSize: '10px', color: '#999', width: 28, textAlign: 'right', flexShrink: 0 }}>{value}</span>
    </div>
  )
}

export function EditorToolbar({
  activeTool,
  selectedTileType,
  selectedFurnitureType,
  selectedFurnitureUid,
  floorColor,
  onToolChange,
  onTileTypeChange,
  onFloorColorChange,
  onFurnitureTypeChange,
  onDeleteSelected,
  onUndo,
  onReset,
  onSave,
  loadedAssets,
}: EditorToolbarProps) {
  const [activeCategory, setActiveCategory] = useState<FurnitureCategory>('desks')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showColor, setShowColor] = useState(false)

  // Build dynamic catalog from loaded assets
  useEffect(() => {
    if (loadedAssets) {
      try {
        console.log(`[EditorToolbar] Building dynamic catalog with ${loadedAssets.catalog.length} assets...`)
        const success = buildDynamicCatalog(loadedAssets)
        console.log(`[EditorToolbar] Catalog build result: ${success}`)

        // Reset to first available category if current doesn't exist
        const activeCategories = getActiveCategories()
        if (activeCategories.length > 0) {
          const firstCat = activeCategories[0]?.id
          if (firstCat) {
            console.log(`[EditorToolbar] Setting active category to: ${firstCat}`)
            setActiveCategory(firstCat)
          }
        }
      } catch (err) {
        console.error(`[EditorToolbar] Error building dynamic catalog:`, err)
      }
    }
  }, [loadedAssets])

  const handleColorChange = useCallback((key: keyof FloorColor, value: number) => {
    onFloorColorChange({ ...floorColor, [key]: value })
  }, [floorColor, onFloorColorChange])

  const categoryItems = getCatalogByCategory(activeCategory)

  const patternCount = getFloorPatternCount()
  // Wall is TileType 0, floor patterns are 1..patternCount
  const floorPatterns = Array.from({ length: patternCount }, (_, i) => i + 1)

  return (
    <div
      style={{
        position: 'absolute',
        top: 36,
        left: 8,
        zIndex: 50,
        background: 'rgba(30,30,46,0.85)',
        border: '1px solid var(--vscode-editorWidget-border, #454545)',
        borderRadius: 4,
        padding: '6px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: 380,
      }}
    >
      {/* Tool row */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button
          style={activeTool === EditTool.SELECT ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.SELECT)}
          title="Select furniture"
        >
          Select
        </button>
        <button
          style={(activeTool === EditTool.TILE_PAINT || activeTool === EditTool.EYEDROPPER) ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.TILE_PAINT)}
          title="Paint floor tiles"
        >
          Floor
        </button>
        <button
          style={activeTool === EditTool.FURNITURE_PLACE ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.FURNITURE_PLACE)}
          title="Place furniture"
        >
          Place
        </button>
        <button
          style={activeTool === EditTool.ERASER ? activeBtnStyle : btnStyle}
          onClick={() => onToolChange(EditTool.ERASER)}
          title="Erase furniture"
        >
          Erase
        </button>
        <button style={btnStyle} onClick={onUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button style={btnStyle} onClick={onSave} title="Save layout now">
          Save
        </button>
        <button style={btnStyle} onClick={() => setShowResetConfirm(true)} title="Reset to last saved layout">
          Reset
        </button>
      </div>

      {/* Reset confirmation popup */}
      {showResetConfirm && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 6px',
          background: 'rgba(80,30,30,0.9)',
          border: '1px solid #a44',
          borderRadius: 4,
        }}>
          <span style={{ fontSize: '11px', color: '#ecc' }}>Reset to last saved layout?</span>
          <button
            style={{ ...btnStyle, background: '#a33', color: '#fff' }}
            onClick={() => { setShowResetConfirm(false); onReset() }}
          >
            Yes
          </button>
          <button
            style={btnStyle}
            onClick={() => setShowResetConfirm(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Sub-panel: Floor tiles */}
      {(activeTool === EditTool.TILE_PAINT || activeTool === EditTool.EYEDROPPER) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Wall button + Color toggle + Pick */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button
              onClick={() => onTileTypeChange(TileType.WALL)}
              title="Wall"
              style={{
                width: 48,
                height: 24,
                background: '#3A3A5C',
                border: selectedTileType === TileType.WALL ? '2px solid var(--vscode-focusBorder, #007fd4)' : '1px solid #555',
                borderRadius: 3,
                cursor: 'pointer',
                padding: 0,
                fontSize: '10px',
                color: '#aaa',
              }}
            >
              Wall
            </button>
            <button
              style={showColor ? activeBtnStyle : btnStyle}
              onClick={() => setShowColor((v) => !v)}
              title="Adjust floor color"
            >
              Color
            </button>
            <button
              style={activeTool === EditTool.EYEDROPPER ? activeBtnStyle : btnStyle}
              onClick={() => onToolChange(EditTool.EYEDROPPER)}
              title="Pick floor pattern + color from existing tile"
            >
              Pick
            </button>
          </div>

          {/* Color controls (collapsible) */}
          {showColor && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '4px 6px',
              background: 'rgba(20,20,36,0.8)',
              border: '1px solid #555',
              borderRadius: 3,
            }}>
              <ColorSlider label="H" value={floorColor.h} min={0} max={360} onChange={(v) => handleColorChange('h', v)} />
              <ColorSlider label="S" value={floorColor.s} min={0} max={100} onChange={(v) => handleColorChange('s', v)} />
              <ColorSlider label="B" value={floorColor.b} min={-100} max={100} onChange={(v) => handleColorChange('b', v)} />
              <ColorSlider label="C" value={floorColor.c} min={-100} max={100} onChange={(v) => handleColorChange('c', v)} />
            </div>
          )}

          {/* Floor pattern grid */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {floorPatterns.map((patIdx) => (
              <FloorPatternPreview
                key={patIdx}
                patternIndex={patIdx}
                color={floorColor}
                selected={selectedTileType === patIdx}
                onClick={() => onTileTypeChange(patIdx as TileTypeVal)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sub-panel: Furniture types with category tabs */}
      {activeTool === EditTool.FURNITURE_PLACE && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Category tabs */}
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {getActiveCategories().map((cat) => (
              <button
                key={cat.id}
                style={activeCategory === cat.id ? activeTabStyle : tabStyle}
                onClick={() => setActiveCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>
          {/* Furniture items in active category */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
            {categoryItems.map((entry) => {
              const cached = getCachedSprite(entry.sprite, 2)
              const thumbSize = 28
              const isSelected = selectedFurnitureType === entry.type
              return (
                <button
                  key={entry.type}
                  onClick={() => onFurnitureTypeChange(entry.type)}
                  title={entry.label}
                  style={{
                    width: thumbSize,
                    height: thumbSize,
                    background: '#2A2A3A',
                    border: isSelected ? '2px solid var(--vscode-focusBorder, #007fd4)' : '1px solid #555',
                    borderRadius: 3,
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  <canvas
                    ref={(el) => {
                      if (!el) return
                      const ctx = el.getContext('2d')
                      if (!ctx) return
                      const scale = Math.min(thumbSize / cached.width, thumbSize / cached.height) * 0.8
                      el.width = thumbSize
                      el.height = thumbSize
                      ctx.imageSmoothingEnabled = false
                      ctx.clearRect(0, 0, thumbSize, thumbSize)
                      const dw = cached.width * scale
                      const dh = cached.height * scale
                      ctx.drawImage(cached, (thumbSize - dw) / 2, (thumbSize - dh) / 2, dw, dh)
                    }}
                    style={{ width: thumbSize, height: thumbSize }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Sub-panel: Selection actions */}
      {activeTool === EditTool.SELECT && selectedFurnitureUid && (
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={btnStyle} onClick={onDeleteSelected} title="Delete selected furniture (Del)">
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
