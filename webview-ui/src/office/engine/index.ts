export { createCharacter, updateCharacter, getCharacterSprite, isReadingTool } from './characters.js'
export { OfficeState } from './officeState.js'
export { startGameLoop } from './gameLoop.js'
export type { GameLoopCallbacks } from './gameLoop.js'
export {
  renderFrame,
  renderTileGrid,
  renderScene,
  renderGridOverlay,
  renderGhostPreview,
  renderSelectionHighlight,
} from './renderer.js'
export type { EditorRenderState, SelectionRenderState } from './renderer.js'
