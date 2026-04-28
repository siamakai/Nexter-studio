'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import FileTree from '@/components/FileTree'
import { SKILLS } from '@/lib/skills'

type ToolEvent = { type: 'tool_start' | 'tool_result'; tool: string; result?: string }
type SkillEvent = { type: 'skill'; skill: { trigger: string; label: string; icon: string } }
type Message = {
  id: string; role: 'user' | 'assistant'; content: string
  tools?: ToolEvent[]; skill?: { trigger: string; label: string; icon: string }; streaming?: boolean
}

const TOOL_ICONS: Record<string, string> = {
  read_file: '📖', write_file: '✏️', list_directory: '📁', search_files: '🔍',
  create_directory: '📁', delete_file: '🗑️', move_file: '🚚', run_command: '⚡',
  save_memory: '🧠', recall_memory: '🧠', list_memories: '🧠', web_fetch: '🌐',
  gmail_read_inbox: '📧', gmail_send_email: '📤', gmail_get_email: '📧',
  calendar_list_events: '📅', calendar_create_event: '📅',
  ms_read_inbox: '📧', ms_send_email: '📤', ms_list_calendar: '📅',
  ghl_create_contact: '👤', ghl_search_contacts: '🔍', ghl_add_note: '📝',
  zoom_create_meeting: '📹', calendly_list_events: '📅',
}

const gold = '#B8963E'
const goldLt = '#B8963E'
const ink = '#F0EBE0'
const surface = '#FAFAF7'
const surface2 = '#E8E2D4'
const border = 'rgba(184,150,62,0.3)'
const cream = '#1C2B4A'
const muted = 'rgba(28,43,74,0.5)'

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

  const [messages, setMessages] = useState<Message[]>([{
    id: '0', role: 'assistant',
    content: `Welcome. I'm your Nexter AI assistant — connected to your email, calendar, CRM, and more.

**What I can do:**
- 📧 Read and send email (Gmail & Outlook)
- 📅 Check and create calendar events
- 👤 Search and manage GHL contacts
- 📹 Create Zoom meetings
- 📅 View Calendly bookings
- 📁 Read and write files
- 🌐 Browse the web

Type **/** to see all available skills, or just ask me anything.`,
  }])
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const insertPath = useCallback((path: string) => {
    setInput((prev) => prev + path + ' ')
    setShowFiles(false)
    inputRef.current?.focus()
  }, [])

  async function send(text?: string) {
    const msg = (text ?? input).trim()
    if (!msg || streaming) return
    setInput(''); setShowSkills(false); setShowMenu(false)
    const currentAttachments = [...attachments]; setAttachments([])
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: msg }
    const assistantId = (Date.now() + 1).toString()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', tools: [], streaming: true }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setStreaming(true)
    try {
      const history = messages.filter((m) => !m.streaming).slice(-20).map((m) => ({ role: m.role, content: m.content || '...' }))
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history, workspaceRoot, attachments: currentAttachments }),
      })
      if (!res.body) throw new Error('No stream')
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buffer = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buffer += dec.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'text_delta') {
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content + event.text } : m))
            } else if (event.type === 'tool_start') {
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, tools: [...(m.tools || []), { type: 'tool_start', tool: event.tool }] } : m))
            } else if (event.type === 'tool_result') {
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, tools: [...(m.tools || []), { type: 'tool_result', tool: event.tool, result: event.result }] } : m))
            } else if (event.type === 'skill') {
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, skill: (event as SkillEvent).skill } : m))
            } else if (event.type === 'error') {
              setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: m.content || `Error: ${event.message}` } : m))
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: `Connection error: ${String(err)}` } : m))
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
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: ink }}>

      {/* Sidebar overlay on mobile */}
      {showFiles && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 20 }} className="md:hidden" onClick={() => setShowFiles(false)} />
          <aside style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 30, width: 240, background: surface, borderRight: `1px solid ${border}`, display: 'flex', flexDirection: 'column' }} className="md:relative md:z-auto">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${border}` }}>
              <span style={{ fontSize: 11, letterSpacing: '0.12em', color: muted, fontFamily: 'Courier New, monospace', textTransform: 'uppercase' }}>Files</span>
              <button onClick={() => setShowFiles(false)} style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <FileTree onPathSelect={insertPath} />
          </aside>
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>

        {/* Header */}
        <header style={{ borderBottom: `1px solid ${border}`, background: surface, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => setShowFiles(!showFiles)} style={{ background: showFiles ? 'rgba(184,150,62,0.15)' : 'none', border: 'none', borderRadius: 6, padding: 6, cursor: 'pointer', color: showFiles ? gold : muted, fontSize: 14 }}>
              📁
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nexter-group-logo.svg" alt="Nexter AI Group" style={{ height: 32, width: 'auto' }} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Desktop */}
            <input type="text" value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} placeholder="Workspace path" className="hidden md:block" style={{ fontSize: 11, background: ink, border: `1px solid ${border}`, borderRadius: 6, padding: '4px 10px', color: muted, width: 160, outline: 'none', fontFamily: 'Courier New, monospace' }} />
            <div className="hidden md:flex" style={{ gap: 4 }}>
              {SKILLS.slice(0, 4).map((s) => (
                <button key={s.trigger} onClick={() => { setInput(s.trigger + ' '); inputRef.current?.focus() }} title={s.label} style={{ background: 'none', border: 'none', borderRadius: 6, padding: '4px 6px', cursor: 'pointer', color: muted, fontSize: 14, transition: 'color 0.15s' }}>
                  {s.icon}
                </button>
              ))}
            </div>
            <div className="hidden md:flex" style={{ alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#2A7D4F' }} />
              <span style={{ fontSize: 11, color: muted, fontFamily: 'Courier New, monospace' }}>Online</span>
            </div>
            <button onClick={handleLogout} className="hidden md:block" style={{ fontSize: 11, color: muted, background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontFamily: 'Courier New, monospace', letterSpacing: '0.08em', transition: 'color 0.15s' }}>
              Log out
            </button>
            {/* Mobile menu */}
            <button onClick={() => setShowMenu(!showMenu)} className="md:hidden" style={{ background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: 6 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </header>

        {/* Mobile dropdown */}
        {showMenu && (
          <div className="md:hidden" style={{ background: surface, borderBottom: `1px solid ${border}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#2A7D4F' }} />
                <span style={{ fontSize: 11, color: muted, fontFamily: 'Courier New, monospace' }}>Online</span>
              </div>
              <button onClick={handleLogout} style={{ fontSize: 12, color: cream, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'Courier New, monospace' }}>Log out</button>
            </div>
            <input type="text" value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} placeholder="Workspace path (optional)" style={{ fontSize: 11, background: ink, border: `1px solid ${border}`, borderRadius: 8, padding: '8px 12px', color: cream, outline: 'none', fontFamily: 'Courier New, monospace', width: '100%', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {SKILLS.slice(0, 6).map((s) => (
                <button key={s.trigger} onClick={() => { setInput(s.trigger + ' '); setShowMenu(false); inputRef.current?.focus() }} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, background: 'rgba(184,150,62,0.1)', border: `1px solid ${border}`, borderRadius: 20, padding: '5px 12px', color: goldLt, cursor: 'pointer', fontFamily: 'Courier New, monospace' }}>
                  {s.icon} {s.trigger}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}>
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', gap: 12, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start' }}>

              {msg.role === 'assistant' && (
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: gold, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#fff', fontFamily: 'Georgia, serif', marginTop: 2 }}>N</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: msg.role === 'user' ? 'min(88%, 520px)' : 'min(100%, 720px)', minWidth: 0 }}>
                {msg.skill && (
                  <span style={{ fontSize: 11, color: goldLt, background: 'rgba(184,150,62,0.1)', border: `1px solid ${border}`, padding: '2px 10px', borderRadius: 20, alignSelf: 'flex-start', fontFamily: 'Courier New, monospace', letterSpacing: '0.08em' }}>
                    {msg.skill.icon} {msg.skill.label}
                  </span>
                )}
                {msg.tools && msg.tools.filter(t => t.type === 'tool_start').length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {msg.tools.filter(t => t.type === 'tool_start').map((t, i) => (
                      <span key={i} style={{ fontSize: 11, background: 'rgba(184,150,62,0.08)', border: `1px solid ${border}`, color: muted, padding: '2px 8px', borderRadius: 4, fontFamily: 'Courier New, monospace' }}>
                        {TOOL_ICONS[t.tool] || '🔧'} {t.tool}
                      </span>
                    ))}
                  </div>
                )}
                {msg.role === 'user' ? (
                  <div style={{ background: surface2, border: `1px solid ${border}`, padding: '10px 16px', borderRadius: 16, borderTopRightRadius: 4, fontSize: 14, lineHeight: 1.6, color: cream, whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif' }}>
                    {msg.content}
                  </div>
                ) : (
                  <div style={{ background: surface, border: `1px solid ${border}`, padding: '14px 18px', borderRadius: 16, borderTopLeftRadius: 4 }}>
                    {msg.content ? <MarkdownRenderer content={msg.content} /> : msg.streaming ? (
                      <div style={{ display: 'flex', gap: 5, padding: '4px 0' }}>
                        {[0, 150, 300].map((d) => (
                          <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: gold, display: 'inline-block', animation: 'bounce 1s infinite', animationDelay: `${d}ms` }} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {msg.role === 'user' && (
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: surface2, border: `1px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 700, color: goldLt, fontFamily: 'Georgia, serif', marginTop: 2 }}>S</div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Skills popup */}
        {showSkills && (
          <div style={{ margin: '0 16px 8px', background: surface, border: `1px solid ${border}`, borderRadius: 12, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
            {SKILLS.map((s) => (
              <button key={s.trigger} onClick={() => { setInput(s.trigger + ' '); setShowSkills(false); inputRef.current?.focus() }}
                style={{ width: '100%', textAlign: 'left', padding: '11px 16px', background: 'none', border: 'none', borderBottom: `1px solid ${border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.15s', color: cream }}>
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: goldLt, fontFamily: 'Courier New, monospace' }}>{s.trigger}</span>
                  <span style={{ fontSize: 11, color: muted, marginLeft: 8 }} className="hidden sm:inline">{s.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ borderTop: `1px solid ${border}`, background: surface, padding: '12px 16px', paddingBottom: 'max(12px, env(safe-area-inset-bottom))', flexShrink: 0 }}>
          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {attachments.map((att, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {att.preview
                    ? <img src={att.preview} alt={att.name} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: `1px solid ${border}` }} />
                    : <div style={{ width: 96, height: 56, background: ink, border: `1px solid ${border}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: muted, padding: '0 6px', textAlign: 'center', fontFamily: 'Courier New, monospace' }}>{att.name}</div>
                  }
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, background: gold, border: 'none', borderRadius: '50%', color: '#fff', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>×</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py" style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
            <button onClick={() => fileInputRef.current?.click()} title="Attach file" style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 10, padding: 10, cursor: 'pointer', color: muted, flexShrink: 0, display: 'flex', transition: 'color 0.15s' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <button onClick={() => setShowSkills(!showSkills)} title="Skills" style={{ background: 'none', border: `1px solid ${border}`, borderRadius: 10, padding: 10, cursor: 'pointer', color: showSkills ? gold : muted, flexShrink: 0, display: 'flex', transition: 'color 0.15s' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
              </svg>
            </button>
            <textarea ref={inputRef} value={input}
              onChange={(e) => { setInput(e.target.value); if (e.target.value === '/') setShowSkills(true); else if (!e.target.value.startsWith('/')) setShowSkills(false) }}
              onKeyDown={handleKey} disabled={streaming}
              placeholder={streaming ? 'Working…' : 'Ask anything — read email, check calendar, search CRM…'}
              rows={1} style={{ flex: 1, background: ink, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, color: cream, fontFamily: 'Georgia, serif', outline: 'none', resize: 'none', maxHeight: 120, lineHeight: 1.5, transition: 'border-color 0.15s' }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }}
            />
            <button onClick={() => send()} disabled={streaming || !input.trim()} style={{ background: streaming || !input.trim() ? 'rgba(184,150,62,0.3)' : gold, border: 'none', borderRadius: 10, padding: 10, cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer', color: '#fff', flexShrink: 0, display: 'flex', transition: 'background 0.2s' }}>
              {streaming ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          </div>
          <p className="hidden md:block" style={{ fontSize: 10, color: 'rgba(28,43,74,0.35)', marginTop: 8, textAlign: 'center', fontFamily: 'Courier New, monospace', letterSpacing: '0.08em' }}>
            ENTER TO SEND · SHIFT+ENTER FOR NEW LINE · / FOR SKILLS
          </p>
        </div>
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        textarea::placeholder { color: rgba(28,43,74,0.35); }
        input::placeholder { color: rgba(28,43,74,0.35); }
        button:hover { opacity: 0.85; }
      `}</style>
    </div>
  )
}
