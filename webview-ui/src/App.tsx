import { useState, useEffect } from 'react'

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

const vscode = acquireVsCodeApi()

interface ToolActivity {
  toolId: string
  status: string
  done: boolean
}

function App() {
  const [agents, setAgents] = useState<number[]>([])
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null)
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({})
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({})

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'agentCreated') {
        const id = msg.id as number
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]))
        setSelectedAgent(id)
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
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev
          const next = { ...prev }
          delete next[id]
          return next
        })
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[]
        setAgents((prev) => {
          const ids = new Set(prev)
          const merged = [...prev]
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id)
            }
          }
          return merged.sort((a, b) => a - b)
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
    vscode.postMessage({ type: 'openClaude' })
  }

  const renderAgentCard = (id: number) => {
    const isSelected = selectedAgent === id
    const tools = agentTools[id] || []
    const status = agentStatuses[id]
    const hasActiveTools = tools.some((t) => !t.done)
    return (
      <div
        key={id}
        style={{
          border: `1px solid ${isSelected ? 'var(--vscode-focusBorder, #007fd4)' : 'var(--vscode-widget-border, transparent)'}`,
          borderRadius: 4,
          padding: '6px 8px',
          background: isSelected ? 'var(--vscode-list-activeSelectionBackground, rgba(255,255,255,0.04))' : undefined,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => handleSelectAgent(id)}
            style={{
              borderRadius: '3px 0 0 3px',
              padding: '6px 10px',
              fontSize: '13px',
              background: isSelected ? 'var(--vscode-button-background)' : undefined,
              color: isSelected ? 'var(--vscode-button-foreground)' : undefined,
              fontWeight: isSelected ? 'bold' : undefined,
            }}
          >
            Agent #{id}
          </button>
          <button
            onClick={() => vscode.postMessage({ type: 'closeAgent', id })}
            style={{
              borderRadius: '0 3px 3px 0',
              padding: '6px 8px',
              fontSize: '13px',
              opacity: 0.7,
              background: isSelected ? 'var(--vscode-button-background)' : undefined,
              color: isSelected ? 'var(--vscode-button-foreground)' : undefined,
            }}
            title="Close agent"
          >
            ✕
          </button>
        </span>
        {(tools.length > 0 || status === 'waiting') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 4, paddingLeft: 4 }}>
            {tools.map((tool) => (
              <span
                key={tool.toolId}
                style={{
                  fontSize: '11px',
                  opacity: tool.done ? 0.5 : 0.8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  className={tool.done ? undefined : 'arcadia-pulse'}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: tool.done
                      ? 'var(--vscode-charts-green, #89d185)'
                      : 'var(--vscode-charts-blue, #3794ff)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                {tool.status}
              </span>
            ))}
            {status === 'waiting' && !hasActiveTools && (
              <span
                style={{
                  fontSize: '11px',
                  opacity: 0.85,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--vscode-charts-yellow, #cca700)',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                Waiting for input
              </span>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: 12, fontSize: '14px' }}>
      <style>{`
        @keyframes arcadia-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .arcadia-pulse { animation: arcadia-pulse 1.5s ease-in-out infinite; }
      `}</style>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={handleOpenClaude} style={{ padding: '8px 14px', fontSize: '14px' }}>
          Open Claude Code
        </button>
        <button
          onClick={() => vscode.postMessage({ type: 'openSessionsFolder' })}
          style={{ padding: '8px 14px', fontSize: '14px' }}
          title="Open JSONL sessions folder in file explorer"
        >
          Sessions
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {agents.map(renderAgentCard)}
      </div>
    </div>
  )
}

export default App
