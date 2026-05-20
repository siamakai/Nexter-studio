import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Lazy singleton — created on first use, not at module load time.
// This prevents build failures when env vars aren't available during Next.js static analysis.
let _client: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase env vars not set (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
    _client = createClient(url, key, { auth: { persistSession: false } })
  }
  return _client
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// ── Tasks ─────────────────────────────────────────────────────────────────────

export interface Task {
  id: string
  content: string
  done: boolean
  source: string // 'manual' | 'meeting' | 'email' | 'ai'
  contact_name?: string
  due_date?: string
  created_at: string
  updated_at: string
}

export async function getTasks(doneOnly = false): Promise<Task[]> {
  const q = supabase.from('tasks').select('*').order('created_at', { ascending: false })
  const { data } = doneOnly ? await q.eq('done', true) : await q.eq('done', false)
  return (data as Task[]) || []
}

export async function addTask(content: string, opts: Partial<Task> = {}): Promise<Task | null> {
  const { data } = await supabase.from('tasks').insert({
    content,
    done: false,
    source: opts.source || 'manual',
    contact_name: opts.contact_name,
    due_date: opts.due_date,
  }).select().single()
  return data as Task | null
}

export async function markTaskDone(id: string): Promise<void> {
  await supabase.from('tasks').update({ done: true, updated_at: new Date().toISOString() }).eq('id', id)
}

export async function getOpenTasksText(): Promise<string> {
  const tasks = await getTasks(false)
  if (!tasks.length) return 'No open tasks.'
  return tasks.slice(0, 10).map((t, i) =>
    `${i + 1}. ${t.content}${t.contact_name ? ` (re: ${t.contact_name})` : ''}${t.due_date ? ` — due ${t.due_date}` : ''}`
  ).join('\n')
}

export async function extractAndSaveTasksFromText(text: string, source: string, contactName?: string): Promise<void> {
  // Extract action items from AI-generated text
  const lines = text.split('\n')
  const actionLines = lines.filter(l =>
    /^[-•*]\s/.test(l) || /^\d+\.\s/.test(l) || /follow.?up|send|schedule|call|email|review|prepare|complete/i.test(l)
  ).slice(0, 5)
  for (const line of actionLines) {
    const content = line.replace(/^[-•*\d.]\s*/, '').trim()
    if (content.length > 10) {
      await addTask(content, { source, contact_name: contactName })
    }
  }
}

// ── Conversations (Chat Memory) ───────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function saveConversation(messages: ChatMessage[]): Promise<void> {
  await supabase.from('conversations').upsert({
    id: 'main',
    messages: messages.slice(-60), // keep last 60 messages
    updated_at: new Date().toISOString(),
  })
}

export async function loadConversation(): Promise<ChatMessage[]> {
  const { data } = await supabase.from('conversations').select('messages').eq('id', 'main').single()
  return (data?.messages as ChatMessage[]) || []
}

// ── Meeting Reports ───────────────────────────────────────────────────────────

export interface MeetingReport {
  id?: string
  title: string
  date: string
  attendees: string
  summary: string
  action_items: string
  drive_url?: string
  contact_name?: string
  contact_email?: string
  created_at?: string
}

export async function saveMeetingReport(report: MeetingReport): Promise<void> {
  await supabase.from('meeting_reports').insert({
    title: report.title,
    date: report.date,
    attendees: report.attendees,
    summary: report.summary,
    action_items: report.action_items,
    drive_url: report.drive_url,
    contact_name: report.contact_name,
    contact_email: report.contact_email,
  })
}

export async function getRecentMeetings(days = 7): Promise<MeetingReport[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const { data } = await supabase.from('meeting_reports')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10)
  return (data as MeetingReport[]) || []
}

// ── Content Pipeline ──────────────────────────────────────────────────────────

export interface ContentItem {
  id?: string
  title: string
  type: string        // linkedin | reel | blog | email | other
  platform?: string
  status: string      // idea | drafting | ready | draft_ready | scheduled | published
  scheduled_date?: string
  published_date?: string
  notes?: string
  draft_text?: string      // AI-generated post copy, ready for approval
  draft_image_url?: string // DALL-E generated image URL
  created_at?: string
  updated_at?: string
}

export async function addContent(item: Omit<ContentItem, 'id' | 'created_at' | 'updated_at'>): Promise<ContentItem | null> {
  const { data } = await supabase.from('content_pipeline').insert(item).select().single()
  return data as ContentItem | null
}

export async function updateContent(id: string, updates: Partial<ContentItem>): Promise<void> {
  await supabase.from('content_pipeline').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
}

export async function listContent(status?: string): Promise<ContentItem[]> {
  const q = supabase.from('content_pipeline').select('*').order('scheduled_date', { ascending: true })
  const { data } = status ? await q.eq('status', status) : await q.neq('status', 'published')
  return (data as ContentItem[]) || []
}

export async function getContentSummary(): Promise<string> {
  const items = await listContent()
  if (!items.length) return 'No content in pipeline.'
  const byStatus: Record<string, ContentItem[]> = {}
  for (const i of items) {
    if (!byStatus[i.status]) byStatus[i.status] = []
    byStatus[i.status].push(i)
  }
  const lines: string[] = []
  const order = ['idea', 'drafting', 'ready', 'scheduled']
  for (const s of order) {
    if (byStatus[s]?.length) {
      lines.push(`${s.toUpperCase()} (${byStatus[s].length}): ${byStatus[s].map(i => i.title).join(', ')}`)
    }
  }
  const overdue = items.filter(i => i.scheduled_date && new Date(i.scheduled_date) < new Date() && i.status !== 'published')
  if (overdue.length) lines.push(`⚠️ OVERDUE: ${overdue.map(i => i.title).join(', ')}`)
  return lines.join('\n') || 'Pipeline clear.'
}

// ── Delegation Tracker ────────────────────────────────────────────────────────

export interface Delegation {
  id?: string
  task: string
  assigned_to: string
  assigned_by?: string
  due_date?: string
  status: string      // assigned | in_progress | done | overdue
  notes?: string
  nudge_count?: number
  created_at?: string
  updated_at?: string
}

export async function assignTask(delegation: Omit<Delegation, 'id' | 'created_at' | 'updated_at'>): Promise<Delegation | null> {
  const { data } = await supabase.from('delegations').insert({ ...delegation, nudge_count: 0 }).select().single()
  return data as Delegation | null
}

export async function updateDelegation(id: string, updates: Partial<Delegation>): Promise<void> {
  await supabase.from('delegations').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
}

export async function listDelegations(status?: string): Promise<Delegation[]> {
  const q = supabase.from('delegations').select('*').order('due_date', { ascending: true })
  const { data } = status ? await q.eq('status', status) : await q.neq('status', 'done')
  return (data as Delegation[]) || []
}

export async function getOverdueDelegations(): Promise<Delegation[]> {
  const today = new Date().toISOString().split('T')[0]
  const { data } = await supabase.from('delegations')
    .select('*')
    .neq('status', 'done')
    .lt('due_date', today)
  return (data as Delegation[]) || []
}

export async function getDelegationSummary(): Promise<string> {
  const active = await listDelegations()
  if (!active.length) return 'No active delegations.'
  const overdue = active.filter(d => d.due_date && new Date(d.due_date) < new Date())
  const lines = active.map(d => {
    const due = d.due_date ? `due ${d.due_date}` : 'no deadline'
    const flag = d.due_date && new Date(d.due_date) < new Date() ? '⚠️ OVERDUE — ' : ''
    return `${flag}${d.assigned_to}: ${d.task} (${due}) [${d.status}]`
  })
  return `${active.length} active delegations, ${overdue.length} overdue:\n${lines.join('\n')}`
}

// ── Chat Sessions ─────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string
  title: string
  messages: Array<{ role: string; content: string }>
  created_at?: string
  updated_at?: string
}

export async function saveChatSession(id: string, title: string, messages: Array<{ role: string; content: string }>): Promise<void> {
  await supabase.from('chat_sessions').upsert({
    id,
    title: title.slice(0, 100),
    messages,
    updated_at: new Date().toISOString(),
  })
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const { data } = await supabase.from('chat_sessions').select('id, title, created_at, updated_at').order('updated_at', { ascending: false }).limit(50)
  return (data as ChatSession[]) || []
}

export async function loadChatSession(id: string): Promise<ChatSession | null> {
  const { data } = await supabase.from('chat_sessions').select('*').eq('id', id).single()
  return (data as ChatSession) || null
}

export async function deleteChatSession(id: string): Promise<void> {
  await supabase.from('chat_sessions').delete().eq('id', id)
}
