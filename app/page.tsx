'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
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
  gmail_read_inbox: '📧', gmail_send_email: '📤', gmail_get_email: '📧',
  calendar_list_events: '📅', calendar_create_event: '📅',
  ms_read_inbox: '📧', ms_send_email: '📤', ms_list_calendar: '📅',
  ghl_create_contact: '👤', ghl_search_contacts: '🔍', ghl_add_note: '📝',
  zoom_create_meeting: '📹', calendly_list_events: '📅',
}

export default function StudioPage() {
  const router = useRouter()
  type Attachment = { name: string; type: string; data: string; preview?: string }
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [showFiles, setShowFiles] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Hi! I'm your Nexter AI assistant. I have access to your email, calendar, CRM, and more.

**What I can do:**
- 📧 Read and send email (Gmail & Outlook)
- 📅 Check and create calendar events
- 👤 Search and manage GHL contacts
- 📁 Read and write files
- 🌐 Browse the web

Type **/** to see all available skills, or just ask me anything.`,
    },
  ])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)

  async function handleLogout() {
    await fetch('/api/auth/login', { method: 'DELETE' })
    router.push('/login')
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        const data = result.split(',')[1]
        const preview = file.type.startsWith('image/') ? result : undefined
        setAttachments((prev) => [...prev, { name: file.name, type: file.type, data, preview }])
      }
      reader.readAsDataURL(file)
    })
  }

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
    setShowMenu(false)

    const currentAttachments = [...attachments]
    setAttachments([])
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
        body: JSON.stringify({ message: msg, history, workspaceRoot, attachments: currentAttachments }),
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
            } else if (event.type === 'error') {
              setMessages((prev) =>
                prev.map((m) => m.id === assistantId ? { ...m, content: m.content || `Error: ${event.message}` } : m)
              )
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
    if (e.key === 'Escape') { setShowSkills(false); setShowMenu(false) }
  }

  return (
    // h-dvh fixes iOS address bar collapsing viewport
    <div className="flex h-dvh overflow-hidden bg-gray-50">

      {/* File Tree Sidebar — overlay on mobile, sidebar on desktop */}
      {showFiles && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-20 md:hidden"
            onClick={() => setShowFiles(false)}
          />
          <aside className="fixed left-0 top-0 bottom-0 z-30 w-64 md:relative md:z-auto md:w-56 border-r border-gray-200 bg-white flex-shrink-0 overflow-hidden flex flex-col shadow-sm">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 md:hidden">
              <span className="text-sm font-medium text-gray-700">Files</span>
              <button onClick={() => setShowFiles(false)} className="text-gray-400 p-1">✕</button>
            </div>
            <FileTree onPathSelect={insertPath} />
          </aside>
        </>
      )}

      {/* Main Chat */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <header className="border-b border-gray-200 bg-white px-3 md:px-4 py-2.5 flex items-center justify-between flex-shrink-0 shadow-sm">
          {/* Left: file toggle + logo */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFiles(!showFiles)}
              className={`p-2 rounded-lg text-sm transition-colors ${showFiles ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:text-gray-600'}`}
              title="Toggle file browser"
            >
              📁
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/na-logo.svg" alt="Nexter AI Agency" className="w-24 md:w-40 h-auto" />
          </div>

          {/* Right: desktop controls + mobile menu button */}
          <div className="flex items-center gap-2">
            {/* Desktop only */}
            <input
              type="text"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="Workspace path"
              className="hidden md:block text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-500 w-40 focus:outline-none focus:border-gray-400"
            />
            <div className="hidden md:flex gap-1">
              {SKILLS.slice(0, 4).map((s) => (
                <button
                  key={s.trigger}
                  onClick={() => { setInput(s.trigger + ' '); inputRef.current?.focus() }}
                  title={s.label}
                  className="p-1.5 rounded text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  {s.icon}
                </button>
              ))}
            </div>
            <div className="hidden md:flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs text-gray-400">Online</span>
            </div>
            <button
              onClick={handleLogout}
              className="hidden md:block text-xs text-gray-400 hover:text-gray-700 hover:bg-gray-100 px-2.5 py-1 rounded-lg transition-colors border border-gray-200"
            >
              Log out
            </button>

            {/* Mobile menu button */}
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="md:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Mobile dropdown menu */}
        {showMenu && (
          <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-gray-500">Online</span>
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-red-500 hover:text-red-700 font-medium"
              >
                Log out
              </button>
            </div>
            <input
              type="text"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="Workspace path (optional)"
              className="w-full text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-gray-400"
            />
            <div className="flex flex-wrap gap-2">
              {SKILLS.slice(0, 6).map((s) => (
                <button
                  key={s.trigger}
                  onClick={() => { setInput(s.trigger + ' '); setShowMenu(false); inputRef.current?.focus() }}
                  className="flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full transition-colors"
                >
                  {s.icon} {s.trigger}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-3 md:px-4 py-4 md:py-6 space-y-4 md:space-y-5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        >
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-2 md:gap-3 ${msg.role === 'user' ? 'justify-end' : 'items-start'}`}>

              {msg.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0 text-xs font-bold text-white mt-0.5">
                  N
                </div>
              )}

              <div className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end max-w-[88%] md:max-w-[80%]' : 'flex-1 min-w-0 max-w-full md:max-w-3xl'}`}>
                {msg.skill && (
                  <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full self-start">
                    {msg.skill.icon} {msg.skill.label}
                  </span>
                )}

                {msg.tools && msg.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {msg.tools
                      .filter((t) => t.type === 'tool_start')
                      .map((t, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-500 border border-gray-200 px-2 py-0.5 rounded font-mono">
                          {TOOL_ICONS[t.tool] || '🔧'} {t.tool}
                        </span>
                      ))}
                  </div>
                )}

                {msg.role === 'user' ? (
                  <div className="bg-gray-900 text-white px-3.5 py-2.5 md:px-4 rounded-2xl rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <div className="min-w-0 bg-white rounded-2xl rounded-tl-sm px-3.5 py-3 md:px-4 shadow-sm border border-gray-100 text-sm">
                    {msg.content ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : msg.streaming ? (
                      <div className="flex gap-1 py-1">
                        <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:300ms]" />
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-xs font-bold text-gray-600 mt-0.5">
                  S
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Skills popup */}
        {showSkills && (
          <div className="mx-3 md:mx-4 mb-2 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-lg max-h-64 overflow-y-auto">
            {SKILLS.map((s) => (
              <button
                key={s.trigger}
                onClick={() => { setInput(s.trigger + ' '); setShowSkills(false); inputRef.current?.focus() }}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center gap-3 border-b border-gray-100 last:border-0"
              >
                <span className="text-xl">{s.icon}</span>
                <div>
                  <span className="text-sm font-medium text-gray-900">{s.trigger}</span>
                  <span className="text-xs text-gray-400 ml-2 hidden sm:inline">{s.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Input — pb accounts for iOS safe area (home bar) */}
        <div className="border-t border-gray-200 bg-white px-3 md:px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex-shrink-0">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachments.map((att, i) => (
                <div key={i} className="relative">
                  {att.preview ? (
                    <img src={att.preview} alt={att.name} className="h-14 w-14 md:h-16 md:w-16 object-cover rounded-lg border border-gray-200" />
                  ) : (
                    <div className="h-14 w-24 bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-500 px-2 text-center">{att.name}</div>
                  )}
                  {/* Always visible on mobile (no hover) */}
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center"
                  >×</button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {/* Attach */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-xl transition-colors flex-shrink-0"
              title="Attach file"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            {/* Skills */}
            <button
              onClick={() => setShowSkills(!showSkills)}
              className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 active:bg-gray-200 rounded-xl transition-colors flex-shrink-0"
              title="Skills"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
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
              placeholder={streaming ? 'Working...' : 'Ask anything…'}
              rows={1}
              style={{ maxHeight: '120px', resize: 'none' }}
              className="flex-1 bg-gray-50 border border-gray-200 focus:border-gray-400 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none transition-colors disabled:opacity-50"
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />

            <button
              onClick={() => send()}
              disabled={streaming || !input.trim()}
              className="p-2.5 bg-gray-900 hover:bg-gray-700 active:bg-gray-600 disabled:opacity-30 text-white rounded-xl transition-colors flex-shrink-0"
            >
              {streaming ? (
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83" />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
          <p className="hidden md:block text-[10px] text-gray-400 mt-1.5 text-center">
            Enter to send · Shift+Enter for new line · / for skills
          </p>
        </div>
      </div>
    </div>
  )
}
