'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import FileTree from '@/components/FileTree'
import { SKILLS } from '@/lib/skills'

type ToolEvent = { type: 'tool_start' | 'tool_result'; tool: string; result?: string }
type SkillEvent = { type: 'skill'; skill: { trigger: string; label: string; icon: string } }

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  tools?: ToolEvent[]
  skill?: { trigger: string; label: string; icon: string }
  streaming?: boolean
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖', write_file: '✏️', list_directory: '📁',
  search_files: '🔍', create_directory: '📁', delete_file: '🗑️',
  move_file: '🚚', run_command: '⚡', save_memory: '🧠',
  recall_memory: '🧠', list_memories: '🧠', web_fetch: '🌐',
}

export default function StudioPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: `# Welcome to Nexter Studio

I'm your personal AI assistant running locally on your machine.

I have full access to:
- **Filesystem** — read, write, list, search any file
- **Terminal** — run any shell command
- **Memory** — save and recall knowledge across sessions
- **Web** — fetch pages and content

**Skills** — type a slash command to activate a mode:
${SKILLS.map((s) => `\`${s.trigger}\` ${s.icon} ${s.label} — ${s.description}`).join('\n')}

What would you like to work on?`,
    },
  ])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showFiles, setShowFiles] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const insertPath = useCallback((path: string) => {
    setInput((prev) => prev + path + ' ')
    setShowFiles(false)
    inputRef.current?.focus()
  }, [])

  async function send(text?: string) {
    const msg = (text ?? input).trim()
    if (!msg || streaming) return
    setInput('')
    setShowSkills(false)

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msg }
    const assistantId = (Date.now() + 1).toString()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', tools: [], streaming: true }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    try {
      const history = messages
        .filter((m) => !m.streaming)
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content || '...' }))

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history, workspaceRoot }),
      })

      if (!res.body) throw new Error('No stream')

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += dec.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.type === 'text_delta') {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, content: m.content + event.text } : m)
              )
            } else if (event.type === 'tool_start') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, tools: [...(m.tools || []), { type: 'tool_start', tool: event.tool }] }
                    : m
                )
              )
            } else if (event.type === 'tool_result') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, tools: [...(m.tools || []), { type: 'tool_result', tool: event.tool, result: event.result }] }
                    : m
                )
              )
            } else if (event.type === 'skill') {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, skill: (event as SkillEvent).skill } : m)
              )
            } else if (event.type === 'done' || event.type === 'error') {
              if (event.type === 'error') {
                setMessages((prev) =>
                  prev.map((m) => m.id === assistantId ? { ...m, content: m.content || `Error: ${event.message}` } : m)
                )
              }
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, content: `Connection error: ${String(err)}` } : m)
      )
    } finally {
      setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m))
      setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    if (e.key === '/' && input === '') setShowSkills(true)
    if (e.key === 'Escape') setShowSkills(false)
  }

  const activeSkill = messages.filter((m) => m.role === 'user').slice(-1)[0]
    ? null
    : null

  return (
    <div className="flex h-screen overflow-hidden">
      {/* File Tree Sidebar */}
      {showFiles && (
        <aside className="w-56 border-r border-gray-800 bg-gray-950 flex-shrink-0 overflow-hidden flex flex-col">
          <FileTree onPathSelect={insertPath} />
        </aside>
      )}

      {/* Main Chat */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="border-b border-gray-800 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFiles(!showFiles)}
              className={`p-1.5 rounded text-sm transition-colors ${showFiles ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              title="Toggle file browser"
            >
              📁
            </button>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-semibold text-sm text-white">Nexter Studio</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Workspace path input */}
            <input
              type="text"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="Workspace path (optional)"
              className="text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1 text-gray-400 w-48 focus:outline-none focus:border-emerald-600"
            />
            <div className="flex gap-1">
              {SKILLS.slice(0, 4).map((s) => (
                <button
                  key={s.trigger}
                  onClick={() => { setInput(s.trigger + ' '); inputRef.current?.focus() }}
                  title={s.label}
                  className="p-1.5 rounded text-sm text-gray-600 hover:text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  {s.icon}
                </button>
              ))}
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'items-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-emerald-700 flex items-center justify-center flex-shrink-0 text-xs font-bold text-white mt-0.5">
                  N
                </div>
              )}

              <div className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end max-w-[80%]' : 'flex-1 min-w-0'}`}>
                {/* Skill badge */}
                {msg.skill && (
                  <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full self-start">
                    {msg.skill.icon} {msg.skill.label}
                  </span>
                )}

                {/* Tool call log */}
                {msg.tools && msg.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.tools
                      .filter((t) => t.type === 'tool_start')
                      .map((t, i) => (
                        <span key={i} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded font-mono">
                          {TOOL_ICONS[t.tool] || '🔧'} {t.tool}
                        </span>
                      ))}
                  </div>
                )}

                {/* Message content */}
                {msg.role === 'user' ? (
                  <div className="bg-emerald-700 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <div className="min-w-0">
                    {msg.content ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : msg.streaming ? (
                      <div className="flex gap-1 py-2">
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce [animation-delay:300ms]" />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 text-xs font-bold text-gray-300 mt-0.5">
                  S
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Skills popup */}
        {showSkills && (
          <div className="mx-4 mb-2 bg-gray-900 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
            {SKILLS.map((s) => (
              <button
                key={s.trigger}
                onClick={() => { setInput(s.trigger + ' '); setShowSkills(false); inputRef.current?.focus() }}
                className="w-full text-left px-4 py-2.5 hover:bg-gray-800 transition-colors flex items-center gap-3"
              >
                <span className="text-lg">{s.icon}</span>
                <div>
                  <span className="text-sm font-medium text-white">{s.trigger}</span>
                  <span className="text-xs text-gray-400 ml-2">{s.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-gray-800 px-4 py-3 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <button
              onClick={() => setShowSkills(!showSkills)}
              className="p-2.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors flex-shrink-0"
              title="Skills (or type /)"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
              </svg>
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                if (e.target.value === '/') setShowSkills(true)
                else if (!e.target.value.startsWith('/')) setShowSkills(false)
              }}
              onKeyDown={handleKey}
              disabled={streaming}
              placeholder={streaming ? 'Working...' : 'Chat with Claude, or type / for skills...'}
              rows={1}
              style={{ maxHeight: '120px', resize: 'none' }}
              className="flex-1 bg-gray-900 border border-gray-700 focus:border-emerald-600 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none transition-colors disabled:opacity-50"
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={() => send()}
              disabled={streaming || !input.trim()}
              className="p-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl transition-colors flex-shrink-0"
            >
              {streaming ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          <p className="text-[10px] text-gray-700 mt-1.5 pl-10">Enter to send · Shift+Enter for new line · / for skills</p>
        </div>
      </div>

      {activeSkill && <div>{activeSkill}</div>}
    </div>
  )
}
