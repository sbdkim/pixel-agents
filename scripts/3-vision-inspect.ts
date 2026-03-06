/**
 * Stage 3: Metadata Draft Generation
 *
 * This Codex-first variant creates a draft metadata file from the edited assets
 * without external vision APIs. You can refine all metadata in Stage 4.
 */

import { readFileSync, writeFileSync } from 'fs'

interface EditedAsset {
  id: string
  paddedX: number
  paddedY: number
  paddedWidth: number
  paddedHeight: number
  erasedPixels?: Array<{ x: number; y: number }>
}

const inputJsonPath = './scripts/.tileset-working/asset-editor-output.json'
const outputJsonPath = './scripts/.tileset-working/tileset-metadata-draft.json'

function toLabel(id: string): string {
  return id
    .toLowerCase()
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function inferCategory(id: string): string {
  const key = id.toLowerCase()
  if (key.includes('desk') || key.includes('table')) return 'desks'
  if (key.includes('chair') || key.includes('sofa') || key.includes('seat')) return 'chairs'
  if (key.includes('cabinet') || key.includes('shelf') || key.includes('drawer') || key.includes('locker')) return 'storage'
  if (key.includes('monitor') || key.includes('computer') || key.includes('keyboard') || key.includes('lamp') || key.includes('phone')) return 'electronics'
  if (key.includes('plant') || key.includes('poster') || key.includes('clock') || key.includes('picture')) return 'decor'
  return 'misc'
}

function main() {
  console.log('\nStage 3: Metadata Draft Generation\n')

  const inputData = JSON.parse(readFileSync(inputJsonPath, 'utf-8')) as {
    sourceFile?: string
    tileset?: string
    backgroundColor?: string
    assets: EditedAsset[]
  }

  const assets = inputData.assets || []
  if (assets.length === 0) {
    console.error('No assets found in asset-editor-output.json')
    process.exit(1)
  }

  const output = {
    version: 1,
    timestamp: new Date().toISOString(),
    sourceFile: inputData.sourceFile,
    tileset: inputData.tileset,
    backgroundColor: inputData.backgroundColor,
    assets: assets.map((a) => ({
      id: a.id,
      paddedX: a.paddedX,
      paddedY: a.paddedY,
      paddedWidth: a.paddedWidth,
      paddedHeight: a.paddedHeight,
      erasedPixels: a.erasedPixels,
      name: a.id,
      label: toLabel(a.id),
      category: inferCategory(a.id),
      footprintW: Math.max(1, Math.round(a.paddedWidth / 16)),
      footprintH: Math.max(1, Math.round(a.paddedHeight / 16)),
      isDesk: a.id.toLowerCase().includes('desk') || a.id.toLowerCase().includes('table'),
      canPlaceOnWalls: false,
      discard: false,
    })),
  }

  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2))
  console.log(`Draft metadata saved: ${outputJsonPath}`)
  console.log('Next: open Stage 4 metadata review and adjust labels/categories/flags.')
}

main()
