import { useState, useEffect, useCallback } from 'react'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vscode = acquireVsCodeApi()

interface Folder {
  id: string
  name: string
  path: string
}

interface AgentInfo {
  id: number
  folderId: string
}

interface ContextMenu {
  agentId: number
  x: number
  y: number
}

interface MoveDialog {
  agentId: number
  targetFolder: Folder
  sourceFolderPath: string
  keepAccess: boolean
  continueConversation: boolean
}

function App() {
  const [folders, setFolders] = useState<Folder[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [moveDialog, setMoveDialog] = useState<MoveDialog | null>(null)

  // Dismiss context menu on click outside
  const dismissContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  useEffect(() => {
    if (contextMenu) {
      window.addEventListener('click', dismissContextMenu)
      return () => window.removeEventListener('click', dismissContextMenu)
    }
  }, [contextMenu, dismissContextMenu])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'agentCreated') {
        const newAgent: AgentInfo = { id: msg.id as number, folderId: msg.folderId as string }
        setAgents((prev) =>
          prev.some((a) => a.id === newAgent.id) ? prev : [...prev, newAgent]
        )
        setSelectedAgent(msg.id as number)
      } else if (msg.type === 'agentClosed') {
        setAgents((prev) => prev.filter((a) => a.id !== msg.id))
        setSelectedAgent((prev) => (prev === msg.id ? null : prev))
      } else if (msg.type === 'existingAgents') {
        const incomingFolders = msg.folders as Folder[]
        const incomingAgents = (msg.agents as { agentId: number; folderId: string }[]).map(
          (a) => ({ id: a.agentId, folderId: a.folderId })
        )
        setFolders(incomingFolders)
        setAgents((prev) => {
          const ids = new Set(prev.map((a) => a.id))
          const merged = [...prev]
          for (const a of incomingAgents) {
            if (!ids.has(a.id)) {
              merged.push(a)
            }
          }
          return merged.sort((a, b) => a.id - b.id)
        })
      } else if (msg.type === 'folderAdded') {
        const newFolder: Folder = {
          id: msg.id as string,
          name: msg.name as string,
          path: msg.path as string,
        }
        setFolders((prev) => (prev.some((f) => f.id === newFolder.id) ? prev : [...prev, newFolder]))
      } else if (msg.type === 'agentMoved') {
        const agentId = msg.agentId as number
        const targetFolderId = msg.targetFolderId as string
        setAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, folderId: targetFolderId } : a))
        )
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'webviewReady' })
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleSelectAgent = (id: number) => {
    setSelectedAgent(id)
    vscode.postMessage({ type: 'focusAgent', id })
  }

  const handleOpenClaude = () => {
    const folder = folders.length > 0 ? folders[0] : null
    vscode.postMessage({
      type: 'openClaude',
      folderId: folder?.id,
      folderPath: folder?.path,
    })
  }

  const handleAddFolder = () => {
    vscode.postMessage({ type: 'addFolder' })
  }

  const handleAgentContextMenu = (e: React.MouseEvent, agentId: number) => {
    e.preventDefault()
    if (folders.length <= 1) return // no other folder to move to
    setContextMenu({ agentId, x: e.clientX, y: e.clientY })
  }

  const handleMoveAgent = (agentId: number, targetFolder: Folder) => {
    const agent = agents.find((a) => a.id === agentId)
    const sourceFolder = agent ? folders.find((f) => f.id === agent.folderId) : null
    setMoveDialog({
      agentId,
      targetFolder,
      sourceFolderPath: sourceFolder?.path || '',
      keepAccess: false,
      continueConversation: true,
    })
    setContextMenu(null)
  }

  const handleConfirmMove = () => {
    if (!moveDialog) return
    vscode.postMessage({
      type: 'moveAgent',
      agentId: moveDialog.agentId,
      targetFolderId: moveDialog.targetFolder.id,
      targetPath: moveDialog.targetFolder.path,
      keepAccess: moveDialog.keepAccess,
      sourcePath: moveDialog.sourceFolderPath,
      continueConversation: moveDialog.continueConversation,
    })
    setMoveDialog(null)
  }

  const agentsByFolder = (folderId: string) => agents.filter((a) => a.folderId === folderId)

  const renderAgentButton = (agent: AgentInfo) => {
    const isSelected = selectedAgent === agent.id
    return (
      <span
        key={agent.id}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}
      >
        <button
          onClick={() => handleSelectAgent(agent.id)}
          onContextMenu={(e) => handleAgentContextMenu(e, agent.id)}
          style={{
            borderRadius: '3px 0 0 3px',
            background: isSelected ? 'var(--vscode-button-background)' : undefined,
            color: isSelected ? 'var(--vscode-button-foreground)' : undefined,
            fontWeight: isSelected ? 'bold' : undefined,
          }}
        >
          Agent #{agent.id}
        </button>
        <button
          onClick={() => vscode.postMessage({ type: 'closeAgent', id: agent.id })}
          style={{
            borderRadius: '0 3px 3px 0',
            padding: '4px 6px',
            opacity: 0.7,
            background: isSelected ? 'var(--vscode-button-background)' : undefined,
            color: isSelected ? 'var(--vscode-button-foreground)' : undefined,
          }}
          title="Close agent"
        >
          ✕
        </button>
      </span>
    )
  }

  const currentAgent = contextMenu ? agents.find((a) => a.id === contextMenu.agentId) : null
  const moveTargets = currentAgent
    ? folders.filter((f) => f.id !== currentAgent.folderId)
    : []

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <button onClick={handleAddFolder}>+ Add Folder</button>
        <button onClick={handleOpenClaude}>Open Claude Code</button>
      </div>

      {folders.map((folder) => {
        const folderAgents = agentsByFolder(folder.id)
        return (
          <div key={folder.id} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: '0.85em',
                opacity: 0.8,
                marginBottom: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={folder.path}
            >
              📁 {folder.name}{' '}
              <span style={{ opacity: 0.6, fontSize: '0.9em' }}>({folder.path})</span>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 8 }}>
              {folderAgents.length === 0 && (
                <span style={{ opacity: 0.5, fontSize: '0.85em' }}>No agents</span>
              )}
              {folderAgents.map(renderAgentButton)}
            </div>
          </div>
        )
      })}

      {contextMenu && moveTargets.length > 0 && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: 'var(--vscode-menu-background, var(--vscode-editor-background))',
            border: '1px solid var(--vscode-menu-border, var(--vscode-widget-border))',
            borderRadius: 4,
            padding: '4px 0',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            minWidth: 150,
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              fontSize: '0.8em',
              opacity: 0.6,
            }}
          >
            Move to…
          </div>
          {moveTargets.map((folder) => (
            <div
              key={folder.id}
              onClick={() => handleMoveAgent(contextMenu.agentId, folder)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: '0.9em',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  'var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground))'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              📁 {folder.name}
            </div>
          ))}
        </div>
      )}

      {moveDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)',
            zIndex: 2000,
          }}
          onClick={() => setMoveDialog(null)}
        >
          <div
            style={{
              background: 'var(--vscode-editor-background)',
              border: '1px solid var(--vscode-widget-border)',
              borderRadius: 6,
              padding: 16,
              minWidth: 280,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 12 }}>
              Move Agent #{moveDialog.agentId} to {moveDialog.targetFolder.name}
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
                cursor: 'pointer',
                fontSize: '0.9em',
              }}
            >
              <input
                type="checkbox"
                checked={moveDialog.continueConversation}
                onChange={(e) =>
                  setMoveDialog({ ...moveDialog, continueConversation: e.target.checked })
                }
              />
              Continue the conversation
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                cursor: 'pointer',
                fontSize: '0.9em',
              }}
            >
              <input
                type="checkbox"
                checked={moveDialog.keepAccess}
                onChange={(e) =>
                  setMoveDialog({ ...moveDialog, keepAccess: e.target.checked })
                }
              />
              Keep access to previous directory
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setMoveDialog(null)}>Cancel</button>
              <button
                onClick={handleConfirmMove}
                style={{
                  background: 'var(--vscode-button-background)',
                  color: 'var(--vscode-button-foreground)',
                }}
              >
                Move
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
