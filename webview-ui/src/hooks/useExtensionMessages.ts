import { useState, useEffect, useRef } from 'react'
import type { OfficeState } from '../office/engine/officeState.js'
import type { OfficeLayout, ToolActivity } from '../office/types.js'
import { extractToolName } from '../office/toolUtils.js'
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js'
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js'
import { setFloorSprites } from '../office/floorTiles.js'
import { setWallSprites } from '../office/wallTiles.js'
import { setCharacterTemplates } from '../office/sprites/spriteData.js'
import { vscode } from '../vscodeApi.js'
import { playDoneSound, setSoundEnabled } from '../notificationSound.js'

export interface FurnitureAsset {
  id: string
  name: string
  label: string
  category: string
  file: string
  width: number
  height: number
  footprintW: number
  footprintH: number
  isDesk: boolean
  canPlaceOnWalls: boolean
  partOfGroup?: boolean
  groupId?: string
  canPlaceOnSurfaces?: boolean
  backgroundTiles?: number
}

export interface WorkspaceFolder {
  name: string
  path: string
}

export interface AgentBindState {
  bound: boolean
  sessionFile: string | null
  reason: string | null
  lastEvent?: string
  lastEventAtMs?: number
}

export type SubagentLifecycle = 'started' | 'active' | 'done' | 'orphaned' | 'expired'

export interface SubagentCharacter {
  id: number
  parentAgentId: number
  parentToolId: string
  label: string
  lifecycle: SubagentLifecycle
}

export interface SubagentSnapshot {
  callId: string
  label: string
  status: string
  state: SubagentLifecycle
  startedAtMs: number
  updatedAtMs: number
}

export interface ExtensionMessageState {
  agents: number[]
  selectedAgent: number | null
  agentTools: Record<number, ToolActivity[]>
  subagentTools: Record<number, Record<string, ToolActivity[]>>
  subagentCharacters: SubagentCharacter[]
  agentStatuses: Record<number, string>
  agentBindStates: Record<number, AgentBindState>
  layoutReady: boolean
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> }
  workspaceFolders: WorkspaceFolder[]
}

function saveAgentSeats(os: OfficeState): void {
  const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {}
  for (const ch of os.characters.values()) {
    seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId }
  }
  vscode.postMessage({ type: 'saveAgentSeats', seats })
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({})
  const [subagentTools, setSubagentTools] = useState<Record<number, Record<string, ToolActivity[]>>>({})
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([])
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({})
  const [agentBindStates, setAgentBindStates] = useState<Record<number, AgentBindState>>({})
  const [layoutReady, setLayoutReady] = useState(false)
  const [loadedAssets, setLoadedAssets] = useState<{ catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined>()
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([])

  const layoutReadyRef = useRef(false)

  useEffect(() => {
    let pendingAgents: Array<{ id: number; palette?: number; hueShift?: number; seatId?: string; folderName?: string }> = []
    let pendingSubagents: Array<{ parentAgentId: number; parentToolId: string; label: string; lifecycle: SubagentLifecycle; status: string; done: boolean }> = []

    const handler = (e: MessageEvent) => {
      const msg = e.data
      const os = getOfficeState()

      if (msg.type === 'layoutLoaded') {
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update - editor has unsaved changes')
          return
        }
        const rawLayout = msg.layout as OfficeLayout | null
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null
        if (layout) {
          os.rebuildFromLayout(layout)
          onLayoutLoaded?.(layout)
        } else {
          onLayoutLoaded?.(os.getLayout())
        }

        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName)
        }
        const hydratedSubIds = new Map<string, number>()
        for (const sub of pendingSubagents) {
          const subId = os.addSubagent(sub.parentAgentId, sub.parentToolId)
          hydratedSubIds.set(`${sub.parentAgentId}:${sub.parentToolId}`, subId)
        }
        if (hydratedSubIds.size > 0) {
          setSubagentCharacters((prev) => prev.map((s) => {
            const key = `${s.parentAgentId}:${s.parentToolId}`
            const id = hydratedSubIds.get(key)
            return id !== undefined ? { ...s, id } : s
          }))
        }
        pendingAgents = []
        pendingSubagents = []
        layoutReadyRef.current = true
        setLayoutReady(true)
        if (os.characters.size > 0) {
          saveAgentSeats(os)
        }
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number
        const folderName = msg.folderName as string | undefined
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]))
        setSelectedAgent(id)
        setAgentBindStates((prev) => ({
          ...prev,
          [id]: { bound: false, sessionFile: null, reason: 'pending' },
        }))
        os.addAgent(id, undefined, undefined, undefined, undefined, folderName)
        saveAgentSeats(os)
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number
        setAgents((prev) => prev.filter((a) => a !== id))
        setSelectedAgent((prev) => (prev === id ? null : prev))
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id))
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        setAgentBindStates((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        os.removeAgent(id)
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[]
        const meta = (msg.agentMeta || {}) as Record<number, { palette?: number; hueShift?: number; seatId?: string }>
        const folderNames = (msg.folderNames || {}) as Record<number, string>
        const bindStates = (msg.bindStates || {}) as Record<number, AgentBindState>

        for (const id of incoming) {
          const m = meta[id]
          pendingAgents.push({ id, palette: m?.palette, hueShift: m?.hueShift, seatId: m?.seatId, folderName: folderNames[id] })
        }
        setAgents((prev) => {
          const ids = new Set(prev)
          const merged = [...prev]
          for (const id of incoming) {
            if (!ids.has(id)) merged.push(id)
          }
          return merged.sort((a, b) => a - b)
        })
        setAgentBindStates((prev) => ({ ...prev, ...bindStates }))
        const subStates = (msg.subagentStates || {}) as Record<number, SubagentSnapshot[]>
        const nextSubTools: Record<number, Record<string, ToolActivity[]>> = {}
        const nextSubCharacters: SubagentCharacter[] = []
        for (const [key, entries] of Object.entries(subStates)) {
          const parentAgentId = Number(key)
          if (!Number.isFinite(parentAgentId)) continue
          if (!nextSubTools[parentAgentId]) nextSubTools[parentAgentId] = {}
          for (const entry of entries) {
            const done = entry.state === 'done' || entry.state === 'expired' || entry.state === 'orphaned'
            nextSubTools[parentAgentId][entry.callId] = [{
              toolId: entry.callId,
              status: entry.status || entry.label || 'Task',
              done,
            }]
            let subId = -1
            if (layoutReadyRef.current) {
              subId = os.addSubagent(parentAgentId, entry.callId)
            }
            nextSubCharacters.push({
              id: subId,
              parentAgentId,
              parentToolId: entry.callId,
              label: entry.label || 'Task',
              lifecycle: entry.state,
            })
            if (!layoutReadyRef.current) {
              pendingSubagents.push({
                parentAgentId,
                parentToolId: entry.callId,
                label: entry.label || 'Task',
                lifecycle: entry.state,
                status: entry.status || entry.label || 'Task',
                done,
              })
            }
          }
        }
        setSubagentTools((prev) => ({ ...prev, ...nextSubTools }))
        setSubagentCharacters((prev) => {
          const keep = prev.filter((s) => !nextSubTools[s.parentAgentId])
          return [...keep, ...nextSubCharacters]
        })
      } else if (msg.type === 'agentBindState') {
        const id = msg.id as number
        setAgentBindStates((prev) => ({
          ...prev,
          [id]: {
            ...(prev[id] || { bound: false, sessionFile: null, reason: null }),
            bound: !!msg.bound,
            sessionFile: (msg.sessionFile as string | null) ?? null,
            reason: (msg.reason as string | null) ?? null,
          },
        }))
      } else if (msg.type === 'agentDebugEvent') {
        const id = msg.id as number
        const event = msg.event as string
        const atMs = msg.atMs as number
        setAgentBindStates((prev) => {
          const current = prev[id] || { bound: false, sessionFile: null, reason: null }
          return {
            ...prev,
            [id]: {
              ...current,
              lastEvent: event,
              lastEventAtMs: atMs,
            },
          }
        })
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        const status = msg.status as string
        setAgentTools((prev) => {
          const list = prev[id] || []
          if (list.some((t) => t.toolId === toolId)) return prev
          return { ...prev, [id]: [...list, { toolId, status, done: false }] }
        })
        const toolName = extractToolName(status)
        os.setAgentTool(id, toolName)
        os.setAgentActive(id, true)
        os.clearPermissionBubble(id)
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        const status = (msg.status as string) || 'Task'
        const label = (msg.label as string) || 'Task'
        const lifecycle = ((msg.lifecycle as SubagentLifecycle) || 'active')
        setSubagentTools((prev) => {
          const byAgent = prev[id] || {}
          const list = byAgent[parentToolId] || []
          if (list.some((t) => t.toolId === toolId)) {
            const updated = list.map((t) => t.toolId === toolId ? { ...t, status } : t)
            return { ...prev, [id]: { ...byAgent, [parentToolId]: updated } }
          }
          return {
            ...prev,
            [id]: { ...byAgent, [parentToolId]: [...list, { toolId, status, done: false }] },
          }
        })
        setSubagentCharacters((prev) => {
          const existing = prev.find((s) => s.parentAgentId === id && s.parentToolId === parentToolId)
          if (existing) {
            return prev.map((s) => s.parentAgentId === id && s.parentToolId === parentToolId
              ? { ...s, label, lifecycle }
              : s)
          }
          return [...prev, { id: -1, parentAgentId: id, parentToolId, label, lifecycle }]
        })
        const subId = os.addSubagent(id, parentToolId)
        setSubagentCharacters((prev) => prev.map((s) => (
          s.parentAgentId === id && s.parentToolId === parentToolId ? { ...s, id: subId } : s
        )))
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        const toolId = msg.toolId as string
        const lifecycle = ((msg.lifecycle as SubagentLifecycle) || 'done')
        setSubagentTools((prev) => {
          const byAgent = prev[id]
          if (!byAgent) return prev
          const list = byAgent[parentToolId]
          if (!list) return prev
          return {
            ...prev,
            [id]: {
              ...byAgent,
              [parentToolId]: list.map((t) => t.toolId === toolId ? { ...t, done: true } : t),
            },
          }
        })
        setSubagentCharacters((prev) => prev.map((s) => (
          s.parentAgentId === id && s.parentToolId === parentToolId ? { ...s, lifecycle } : s
        )))
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number
        const parentToolId = msg.parentToolId as string
        setSubagentTools((prev) => {
          const byAgent = prev[id]
          if (!byAgent || !(parentToolId in byAgent)) return prev
          const nextByAgent = { ...byAgent }
          delete nextByAgent[parentToolId]
          if (Object.keys(nextByAgent).length === 0) {
            const next = { ...prev }
            delete next[id]
            return next
          }
          return { ...prev, [id]: nextByAgent }
        })
        setSubagentCharacters((prev) => prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)))
        os.removeSubagent(id, parentToolId)
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number
        const toolId = msg.toolId as string
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          }
        })
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number
        setAgentTools((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
        os.setAgentTool(id, null)
        os.clearPermissionBubble(id)
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number
        setSelectedAgent(id)
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number
        const status = msg.status as string
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev
            const next = { ...prev }
            delete next[id]
            return next
          }
          return { ...prev, [id]: status }
        })
        os.setAgentActive(id, status === 'active')
        if (status === 'waiting') {
          os.showWaitingBubble(id)
          playDoneSound()
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          }
        })
        os.showPermissionBubble(id)
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number
        setAgentTools((prev) => {
          const list = prev[id]
          if (!list) return prev
          const hasPermission = list.some((t) => t.permissionWait)
          if (!hasPermission) return prev
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          }
        })
        os.clearPermissionBubble(id)
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{ down: string[][][]; up: string[][][]; right: string[][][] }>
        setCharacterTemplates(characters)
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][]
        setFloorSprites(sprites)
      } else if (msg.type === 'wallTilesLoaded') {
        const sprites = msg.sprites as string[][][]
        setWallSprites(sprites)
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[]
        setWorkspaceFolders(folders)
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean
        setSoundEnabled(soundOn)
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[]
          const sprites = msg.sprites as Record<string, string[][]>
          buildDynamicCatalog({ catalog, sprites })
          setLoadedAssets({ catalog, sprites })
        } catch (err) {
          console.error('[Webview] Error processing furnitureAssetsLoaded:', err)
        }
      }
    }

    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'webviewReady' })
    return () => window.removeEventListener('message', handler)
  }, [getOfficeState, isEditDirty, onLayoutLoaded])

  return {
    agents,
    selectedAgent,
    agentTools,
    subagentTools,
    subagentCharacters,
    agentStatuses,
    agentBindStates,
    layoutReady,
    loadedAssets,
    workspaceFolders,
  }
}
