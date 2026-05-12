'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import MarkdownRenderer from '@/components/MarkdownRenderer'
import FileTree from '@/components/FileTree'
import { SKILLS } from '@/lib/skills'

// ─── Types ────────────────────────────────────────────────────────────────────
type View = 'chat' | 'dashboard' | 'workflows' | 'agents' | 'connections' | 'docs' | 'done' | 'feedback' | 'support'
type ToolEvent   = { type: 'tool_start' | 'tool_result'; tool: string; result?: string }
type SkillEvent  = { type: 'skill'; skill: { trigger: string; label: string; icon: string } }
type Message     = { id: string; role: 'user' | 'assistant'; content: string; tools?: ToolEvent[]; skill?: { trigger: string; label: string; icon: string }; streaming?: boolean }
type SessionMeta = { id: string; title: string; updated_at: string }

// ─── Theme tokens ─────────────────────────────────────────────────────────────
const LOGO_GOLD = '#B8963E'  // exact from nexter-ai-group-logo.svg

function tokens(dark: boolean) {
  return dark ? {
    bg:       '#06080F',
    sidebar:  '#0C0E18',
    sideHov:  'rgba(184,150,62,0.08)',
    sideAct:  'rgba(184,150,62,0.13)',
    panel:    '#0A0C14',
    topbar:   '#09090F',
    compose:  '#0C0E18',
    card:     '#0F1220',
    cardBord: 'rgba(255,255,255,0.07)',
    border:   'rgba(255,255,255,0.07)',
    bordmd:   'rgba(255,255,255,0.11)',
    text:     '#EDE8E0',
    textmd:   'rgba(237,232,224,0.58)',
    textdim:  'rgba(237,232,224,0.30)',
    gold:     LOGO_GOLD,
    golddim:  'rgba(184,150,62,0.11)',
    goldbrdr: 'rgba(184,150,62,0.28)',
    goldglo:  'rgba(184,150,62,0.32)',
    green:    '#22C55E',
    blue:     '#3B82F6',
    red:      '#EF4444',
    orange:   '#F59E0B',
    inputbg:  'rgba(255,255,255,0.03)',
    shadow:   '0 4px 24px rgba(0,0,0,0.5)',
    shadowsm: '0 1px 4px rgba(0,0,0,0.4)',
    userMsg:  'rgba(255,255,255,0.06)',
    divider:  'rgba(255,255,255,0.07)',
  } : {
    bg:       '#F7F5F1',
    sidebar:  '#FFFFFF',
    sideHov:  'rgba(184,150,62,0.06)',
    sideAct:  'rgba(184,150,62,0.11)',
    panel:    '#F2EFEA',
    topbar:   '#FFFFFF',
    compose:  '#FFFFFF',
    card:     '#FFFFFF',
    cardBord: 'rgba(26,23,20,0.09)',
    border:   'rgba(26,23,20,0.08)',
    bordmd:   'rgba(26,23,20,0.13)',
    text:     '#1A1714',
    textmd:   'rgba(26,23,20,0.58)',
    textdim:  'rgba(26,23,20,0.34)',
    gold:     '#9A7C1E',
    golddim:  'rgba(154,124,30,0.09)',
    goldbrdr: 'rgba(154,124,30,0.28)',
    goldglo:  'rgba(154,124,30,0.18)',
    green:    '#15803D',
    blue:     '#1D4ED8',
    red:      '#DC2626',
    orange:   '#D97706',
    inputbg:  '#FAFAF8',
    shadow:   '0 4px 24px rgba(26,23,20,0.10)',
    shadowsm: '0 1px 4px rgba(26,23,20,0.07)',
    userMsg:  '#F2EFEA',
    divider:  'rgba(26,23,20,0.07)',
  }
}

// ─── Tool labels ──────────────────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  gmail_read_inbox:'Reading Gmail', gmail_send_email:'Sending email',
  calendar_list_events:'Checking calendar', calendar_create_event:'Creating event',
  ghl_search_contacts:'Searching CRM', ghl_list_contacts_by_tag:'Fetching leads',
  ghl_create_contact:'Creating contact', ghl_update_contact:'Updating contact',
  ghl_add_note:'Adding note', ms_read_inbox:'Reading Outlook', ms_send_email:'Sending Outlook',
  zoom_create_meeting:'Creating Zoom', calendly_list_events:'Fetching Calendly',
  calendly_list_contacts:'Loading contacts', calendly_sync_to_crm:'Syncing to CRM',
  web_fetch:'Browsing web', save_memory:'Saving memory',
  whatsapp_read_inbox:'Reading WhatsApp', whatsapp_send_message:'Sending WhatsApp', whatsapp_get_contacts:'Loading WA contacts', whatsapp_send_template:'Sending WA template',
  linkedin_get_profile:'Reading LinkedIn', linkedin_create_post:'Posting to LinkedIn', linkedin_get_recent_posts:'Loading LinkedIn posts', linkedin_search_people:'Searching LinkedIn',
}

// ─── Nav items ────────────────────────────────────────────────────────────────
const NAV_TOP: { id: View; icon: string; label: string }[] = [
  { id:'dashboard',   icon:'#',  label:'Dashboard' },
  { id:'workflows',   icon:'⚙',  label:'Workflows' },
  { id:'agents',      icon:'🤖', label:'Agents' },
  { id:'connections', icon:'🔌', label:'Connections' },
  { id:'docs',        icon:'📁', label:'Docs' },
]
const NAV_MID: { id: View; icon: string; label: string }[] = [
  { id:'done',     icon:'✅', label:'Done For You' },
]
const NAV_BOT: { id: View; icon: string; label: string }[] = [
  { id:'feedback', icon:'💬', label:'Feedback' },
  { id:'support',  icon:'🆘', label:'Support' },
]

const CONNECTIONS: { id:string; name:string; icon:string; desc:string; color:string; connected:boolean; manageUrl:string; addUrl:string }[] = [
  { id:'gmail',     name:'Gmail',             icon:'📧', desc:'Primary inbox · info@i-review.ai',         color:'#EA4335', connected:true,  manageUrl:'https://mail.google.com',            addUrl:'/api/auth/connect?service=google' },
  { id:'outlook',   name:'Microsoft Outlook', icon:'💼', desc:'siamak.goudarzi@nexterlaw.com',             color:'#0078D4', connected:true,  manageUrl:'https://outlook.com',               addUrl:'/api/auth/microsoft/connect' },
  { id:'gcal',      name:'Google Calendar',   icon:'📅', desc:'Personal & business events',               color:'#4285F4', connected:true,  manageUrl:'https://calendar.google.com',        addUrl:'/api/auth/connect?service=google' },
  { id:'ghl',       name:'GHL CRM',           icon:'🏢', desc:'Contacts, pipeline, tasks, tags',          color:'#F59E0B', connected:true,  manageUrl:'https://app.gohighlevel.com',        addUrl:'https://app.gohighlevel.com' },
  { id:'calendly',  name:'Calendly',          icon:'📞', desc:'Booking pages & invitee sync',             color:'#006BFF', connected:true,  manageUrl:'https://calendly.com/app',           addUrl:'https://calendly.com' },
  { id:'zoom',      name:'Zoom',              icon:'📹', desc:'Cloud-recorded meetings',                  color:'#2D8CFF', connected:true,  manageUrl:'https://zoom.us/profile',            addUrl:'https://zoom.us' },
  { id:'salesforce',name:'Salesforce',        icon:'☁️', desc:'Enterprise CRM integration',              color:'#00A1E0', connected:false, manageUrl:'https://login.salesforce.com',       addUrl:'https://login.salesforce.com' },
  { id:'hubspot',   name:'HubSpot',           icon:'🟠', desc:'Marketing & sales hub',                   color:'#FF7A59', connected:false, manageUrl:'https://app.hubspot.com',            addUrl:'https://app.hubspot.com/oauth/authorize' },
  { id:'slack',     name:'Slack',             icon:'💬', desc:'Team messaging & notifications',           color:'#4A154B', connected:false, manageUrl:'https://slack.com',                  addUrl:'https://slack.com/oauth/v2/authorize' },
  { id:'drive',     name:'Google Drive',      icon:'💾', desc:'Files, docs & cloud storage',             color:'#34A853', connected:false, manageUrl:'https://drive.google.com',           addUrl:'/api/auth/connect?service=google' },
  { id:'whatsapp',  name:'WhatsApp Business', icon:'📱', desc:'Client messaging channel',               color:'#25D366', connected:false, manageUrl:'https://business.facebook.com',      addUrl:'https://business.whatsapp.com/get-started' },
  { id:'linkedin',  name:'LinkedIn',          icon:'🔗', desc:'Professional network outreach',          color:'#0A66C2', connected:false, manageUrl:'https://www.linkedin.com/company-admin', addUrl:'https://www.linkedin.com/developers/apps' },
]

const WORKFLOWS = [
  { id:'w1', name:'New Booking Flow',      desc:'Calendly booking → Zoom → CRM → Confirmation email', icon:'📅', active:true,  runs:47  },
  { id:'w2', name:'Hot Lead Alert',        desc:'New CRM contact tagged hot → Task → Email alert',     icon:'🔥', active:true,  runs:23  },
  { id:'w3', name:'Weekly Pipeline Report',desc:'Every Monday → Pull pipeline → Email summary',        icon:'📊', active:false, runs:8   },
  { id:'w4', name:'Stale Lead Nudge',      desc:'No contact in 7 days → Draft follow-up → Alert',      icon:'😴', active:true,  runs:31  },
  { id:'w5', name:'Meeting Prep Brief',    desc:'1 hour before event → Pull CRM contact → Show brief', icon:'📋', active:true,  runs:19  },
  { id:'w6', name:'Lead Qualification',    desc:'New contact → Score → Tag → Create task in CRM',      icon:'⭐', active:false, runs:12  },
]

const AGENTS = [
  { id:'a1', name:'Email Assistant',    desc:'Reads inbox, drafts replies, manages follow-ups',       icon:'📬', active:true  },
  { id:'a2', name:'CRM Manager',        desc:'Updates contacts, tags leads, tracks pipeline',          icon:'🏢', active:true  },
  { id:'a3', name:'Meeting Coordinator',desc:'Books Zoom, adds to calendar, sends confirmations',      icon:'📅', active:true  },
  { id:'a4', name:'Lead Qualifier',     desc:'Scores new leads, assigns tags, creates CRM tasks',      icon:'🎯', active:false },
  { id:'a5', name:'Morning Briefer',    desc:'Daily 8am summary: email + calendar + leads',            icon:'☀️', active:true  },
  { id:'a6', name:'Content Creator',    desc:'Drafts LinkedIn posts, email campaigns, proposals',      icon:'✍️', active:false },
]

const DONE_LOG = [
  { id:'d1', time:'Today 14:32', icon:'📬', label:'Sent follow-up email',  detail:'To Arlene McCoy re: proposal review',     cat:'Email'    },
  { id:'d2', time:'Today 13:15', icon:'🔄', label:'Synced 12 contacts',    detail:'Calendly → GHL CRM · 12 new contacts',    cat:'CRM'      },
  { id:'d3', time:'Today 11:50', icon:'📅', label:'Created Zoom meeting',  detail:'Discovery Call with James Lee at 3pm',    cat:'Calendar' },
  { id:'d4', time:'Today 10:22', icon:'🔥', label:'Tagged 3 hot leads',    detail:'Auto-qualified from pipeline stage',       cat:'CRM'      },
  { id:'d5', time:'Yesterday',   icon:'📊', label:'Pipeline report sent',  detail:'Weekly summary · €48,500 active pipeline',cat:'CRM'      },
  { id:'d6', time:'Yesterday',   icon:'📋', label:'Meeting brief prepared',detail:'Before call with Marco Rossi at 14:00',   cat:'AI'       },
  { id:'d7', time:'2 days ago',  icon:'✉️', label:'Draft follow-up ready', detail:'For 4 stale leads · not contacted in 7d', cat:'Email'    },
  { id:'d8', time:'2 days ago',  icon:'🤖', label:'Lead qualified',        detail:'Sarah Chen · Score 87/100 · Tagged warm', cat:'AI'       },
]

const WELCOME: Message = { id: '0', role: 'assistant', content: '__WELCOME__' }
function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2,7)}` }

// ─── Nexter AI Group logo mark (exact from nexter-ai-group-logo.svg) ────────
function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 84 84" style={{flexShrink:0,display:'block'}}>
      <rect width="84" height="84" fill={LOGO_GOLD}/>
      <rect x="7" y="7" width="70" height="70" fill="none" stroke="#ffffff" strokeWidth="2"/>
      <text x="42" y="66" fontFamily="Georgia,'Times New Roman',serif" fontSize="52" fontWeight="700" fill="#ffffff" textAnchor="middle">N</text>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function StudioPage() {
  const router = useRouter()
  const [dark,          setDark]          = useState(false)
  const [view,          setView]          = useState<View>('chat')
  const [activePanel,   setActivePanel]   = useState<'history'|'files'|null>(null)
  const [sessionId,     setSessionId]     = useState(newId)
  const [sessions,      setSessions]      = useState<SessionMeta[]>([])
  const [messages,      setMessages]      = useState<Message[]>([WELCOME])
  const [input,         setInput]         = useState('')
  const [streaming,     setStreaming]      = useState(false)
  const [showSkills,    setShowSkills]    = useState(false)
  const [workspaceRoot, setWorkspaceRoot] = useState('')
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [wfState,       setWfState]       = useState<Record<string, boolean>>(
    Object.fromEntries(WORKFLOWS.map(w=>[w.id,w.active]))
  )
  const [agentState,    setAgentState]    = useState<Record<string, boolean>>(
    Object.fromEntries(AGENTS.map(a=>[a.id,a.active]))
  )
  const [feedbackText,  setFeedbackText]  = useState('')
  const [feedbackSent,  setFeedbackSent]  = useState(false)
  const [dateStr,       setDateStr]       = useState('')
  const [nowStr,        setNowStr]        = useState('')
  const [showMoreDrawer,setShowMoreDrawer]= useState(false)

  // ── State lifted from view functions (required for function-call syntax) ────
  const docsFileRef = useRef<HTMLInputElement>(null)
  const [docsUploadedFiles, setDocsUploadedFiles] = useState<string[]>([])
  const [doneFilter,  setDoneFilter]  = useState('All')
  const [feedbackRating, setFeedbackRating] = useState(-1)
  const [supportGuide,   setSupportGuide]   = useState<string|null>(null)
  const [connWizard,     setConnWizard]     = useState<'whatsapp'|'linkedin'|null>(null)
  const [connWaStep,     setConnWaStep]     = useState(1)
  const [connWaFields,   setConnWaFields]   = useState({ phone_number_id:'', access_token:'', business_account_id:'' })
  const [connWaCopied,   setConnWaCopied]   = useState(false)

  type Att = { name: string; type: string; data: string; preview?: string }
  const [attachments, setAttachments] = useState<Att[]>([])

  const bottomRef   = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLTextAreaElement>(null)
  const fileInputRef= useRef<HTMLInputElement>(null)

  const T = tokens(dark)
  const FONT  = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  const MONO  = "'JetBrains Mono','Fira Code',monospace"

  // Load dark preference from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('nexter-theme')
    if (saved === 'dark') setDark(true)
  }, [])

  useEffect(() => {
    localStorage.setItem('nexter-theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setNowStr(now.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Budapest' }))
      setDateStr(now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Budapest' }))
    }
    tick(); const t = setInterval(tick, 30000); return () => clearInterval(t)
  }, [])

  useEffect(() => { if (activePanel==='history') fetchSessions() }, [activePanel])
  const msgCount = messages.length
  // Scroll to bottom when a new message is added (not on every streaming token)
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [msgCount])
  // Follow bottom while streaming — instant, no animation so it doesn't fight itself
  useEffect(() => {
    if (!streaming) return
    const el = chatScrollRef.current
    if (!el) return
    const id = setInterval(() => { el.scrollTop = el.scrollHeight }, 60)
    return () => clearInterval(id)
  }, [streaming])

  async function fetchSessions() {
    try { const r=await fetch('/api/conversations'); if(r.ok) setSessions(await r.json()) } catch { /**/ }
  }
  async function saveSession(msgs: Message[], sid: string) {
    const u=msgs.filter(m=>m.role==='user'&&m.content); if(!u.length) return
    fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:sid,title:u[0].content.slice(0,80),messages:msgs.filter(m=>!m.streaming&&m.content&&m.content!=='__WELCOME__').map(m=>({role:m.role,content:m.content}))})}).catch(()=>{})
  }
  async function loadSession(id: string) {
    try {
      const r=await fetch(`/api/conversations?id=${id}`); const s=await r.json(); if(!s?.messages) return
      setSessionId(id); setMessages([WELCOME,...s.messages.map((m:{role:string;content:string},i:number)=>({id:`l${i}`,role:m.role as 'user'|'assistant',content:m.content}))]); setActivePanel(null)
    } catch { /**/ }
  }
  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation(); await fetch(`/api/conversations?id=${id}`,{method:'DELETE'}); setSessions(p=>p.filter(s=>s.id!==id)); if(sessionId===id) startNew()
  }
  function startNew() { setSessionId(newId()); setMessages([WELCOME]); setInput(''); setView('chat') }
  async function handleLogout() { await fetch('/api/auth/login',{method:'DELETE'}); router.push('/login') }
  function handleFiles(files: FileList|null) {
    if(!files) return
    Array.from(files).forEach(f=>{
      const r=new FileReader(); r.onload=e=>{ const d=(e.target?.result as string); setAttachments(p=>[...p,{name:f.name,type:f.type,data:d.split(',')[1],preview:f.type.startsWith('image/')?d:undefined}]) }; r.readAsDataURL(f)
    })
  }
  const insertPath = useCallback((path: string) => { setInput(p=>p+path+' '); setActivePanel(null); inputRef.current?.focus() }, [])

  async function send(text?: string) {
    const msg=(text??input).trim(); if(!msg||streaming) return
    setInput(''); setShowSkills(false); setView('chat')
    const atts=[...attachments]; setAttachments([])
    const uid=newId(), aid=newId()
    setMessages(p=>[...p,{id:uid,role:'user',content:msg},{id:aid,role:'assistant',content:'',tools:[],streaming:true}])
    setStreaming(true)
    try {
      const history=messages.filter(m=>!m.streaming&&m.content&&m.content!=='__WELCOME__').slice(-20).map(m=>({role:m.role,content:m.content||'…'}))
      const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,history,workspaceRoot,attachments:atts})})
      if(!res.body) throw new Error('No stream')
      const rdr=res.body.getReader(); const dec=new TextDecoder(); let buf=''
      while(true){
        const{done,value}=await rdr.read(); if(done) break
        buf+=dec.decode(value,{stream:true})
        const lines=buf.split('\n'); buf=lines.pop()||''
        for(const line of lines){
          if(!line.startsWith('data: ')) continue
          try{
            const ev=JSON.parse(line.slice(6))
            if(ev.type==='text_delta') setMessages(p=>p.map(m=>m.id===aid?{...m,content:m.content+ev.text}:m))
            else if(ev.type==='tool_start') setMessages(p=>p.map(m=>m.id===aid?{...m,tools:[...(m.tools||[]),{type:'tool_start',tool:ev.tool}]}:m))
            else if(ev.type==='tool_result') setMessages(p=>p.map(m=>m.id===aid?{...m,tools:[...(m.tools||[]),{type:'tool_result',tool:ev.tool,result:ev.result}]}:m))
            else if(ev.type==='skill') setMessages(p=>p.map(m=>m.id===aid?{...m,skill:(ev as SkillEvent).skill}:m))
            else if(ev.type==='error') setMessages(p=>p.map(m=>m.id===aid?{...m,content:(m.content||'')+'⚠️ '+ev.message}:m))
          }catch{ /**/ }
        }
      }
    } catch(err) { setMessages(p=>p.map(m=>m.id===aid?{...m,content:`Connection error: ${String(err)}`}:m)) }
    finally {
      setMessages(p=>{const f=p.map(m=>m.id===aid?{...m,streaming:false}:m); saveSession(f,sessionId); return f}); setStreaming(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}
    if(e.key==='/'&&input==='') setShowSkills(true)
    if(e.key==='Escape'){setShowSkills(false)}
  }
  function fmtDate(iso: string) {
    const d=new Date(iso),now=new Date(),diff=Math.floor((now.getTime()-d.getTime())/86400000)
    if(diff===0) return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
    if(diff===1) return 'Yesterday'
    if(diff<7)   return d.toLocaleDateString('en-GB',{weekday:'short'})
    return d.toLocaleDateString('en-GB',{day:'numeric',month:'short'})
  }

  const hour     = new Date().getHours()
  const greeting = hour<12 ? 'Good morning' : hour<17 ? 'Good afternoon' : 'Good evening'
  const sideW    = sideCollapsed ? 60 : 220

  // ─── NavItem component ────────────────────────────────────────────────────
  function NavItem({ id, icon, label }: { id: View; icon: string; label: string }) {
    const isActive = view === id
    return (
      <button onClick={()=>setView(id)}
        style={{width:'100%',textAlign:'left',display:'flex',alignItems:'center',gap:10,padding:sideCollapsed?'9px 0':'9px 14px',justifyContent:sideCollapsed?'center':'flex-start',background:isActive?T.sideAct:'transparent',borderRadius:8,border:`1px solid ${isActive?T.goldbrdr:'transparent'}`,cursor:'pointer',color:isActive?T.gold:T.textmd,fontSize:13,fontWeight:isActive?600:400,transition:'all 0.14s',fontFamily:FONT,marginBottom:1}}>
        <span style={{fontSize:15,flexShrink:0,lineHeight:1}}>{icon}</span>
        {!sideCollapsed && <span>{label}</span>}
        {!sideCollapsed && isActive && <span style={{marginLeft:'auto',width:5,height:5,borderRadius:'50%',background:T.gold,flexShrink:0}}/>}
      </button>
    )
  }

  // ─── Section label ────────────────────────────────────────────────────────
  function SectionLabel({ text }: { text: string }) {
    if (sideCollapsed) return null
    return <p style={{margin:'10px 0 4px 14px',fontSize:10,fontWeight:600,color:T.textdim,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>{text}</p>
  }

  // ─── Divider ──────────────────────────────────────────────────────────────
  function Divider() {
    return <div style={{height:1,background:T.divider,margin:'8px 0'}}/>
  }

  // ─── Toggle switch ────────────────────────────────────────────────────────
  function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
    return (
      <div onClick={onChange} style={{width:34,height:18,borderRadius:999,background:on?T.gold:'rgba(150,150,150,0.25)',cursor:'pointer',position:'relative',transition:'background 0.2s',flexShrink:0}}>
        <div style={{position:'absolute',top:2,left:on?'auto':'2px',right:on?'2px':'auto',width:14,height:14,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,0.3)',transition:'all 0.2s'}}/>
      </div>
    )
  }

  // ─── Badge ────────────────────────────────────────────────────────────────
  function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
    return <span style={{fontSize:10,fontWeight:600,color,background:bg,borderRadius:999,padding:'2px 8px',fontFamily:MONO,flexShrink:0}}>{label}</span>
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEWS
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Dashboard ─────────────────────────────────────────────────────────────
  function ViewDashboard() {
    const stats = [
      { label:'Hot Leads',     value:'12',    delta:'+3 today',  icon:'🔥', color:T.orange },
      { label:'Pipeline',      value:'€48.5k',delta:'+€6k week', icon:'💰', color:T.green  },
      { label:'Emails Today',  value:'34',    delta:'8 unread',  icon:'📬', color:T.blue   },
      { label:'Meetings Today',value:'3',     delta:'Next: 3pm', icon:'📅', color:T.gold   },
    ]
    return (
      <div className="dash-pad" style={{maxWidth:900,width:'100%',margin:'0 auto',padding:'32px 28px 80px'}}>
        <div style={{marginBottom:28}}>
          <p style={{margin:0,fontSize:12,color:T.textdim,fontFamily:MONO,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.1em'}}>{dateStr}</p>
          <h1 style={{margin:'6px 0 4px',fontSize:26,fontWeight:700,color:T.text,letterSpacing:'-0.025em'}}>{greeting}, Siamak</h1>
          <p style={{margin:0,fontSize:14,color:T.textmd}}>Here&apos;s your business overview for today.</p>
        </div>

        {/* Stats */}
        <div className="stats-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:28}}>
          {stats.map(s=>(
            <div key={s.label} style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'18px 20px',boxShadow:T.shadowsm,cursor:'pointer',transition:'all 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=T.shadow}}
              onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow=T.shadowsm}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <span style={{fontSize:11,color:T.textdim,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:MONO}}>{s.label}</span>
                <span style={{fontSize:18}}>{s.icon}</span>
              </div>
              <p style={{margin:'0 0 4px',fontSize:28,fontWeight:700,color:s.color,letterSpacing:'-0.03em',lineHeight:1}}>{s.value}</p>
              <p style={{margin:0,fontSize:11,color:T.textdim}}>{s.delta}</p>
            </div>
          ))}
        </div>

        <div className="dash-two-col" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          {/* Quick actions */}
          <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'20px',boxShadow:T.shadowsm}}>
            <p style={{margin:'0 0 14px',fontSize:12,fontWeight:700,color:T.textmd,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Quick Actions</p>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {[
                {icon:'🔥',label:'Show hot leads',       prompt:'Show me all hot leads from CRM'},
                {icon:'📬',label:'Check my inbox',       prompt:'Show my latest emails'},
                {icon:'📅',label:"Today's schedule",     prompt:"What's on my calendar today?"},
                {icon:'💰',label:'Revenue pipeline',     prompt:"Show this month's revenue pipeline"},
                {icon:'☀️',label:'Morning brief',        prompt:'Give me a full morning briefing'},
                {icon:'🔄',label:'Sync Calendly → CRM',  prompt:'Sync my Calendly contacts to CRM'},
              ].map(a=>(
                <button key={a.label} onClick={()=>send(a.prompt)}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'transparent',border:`1px solid ${T.border}`,borderRadius:8,cursor:'pointer',textAlign:'left',fontSize:13,color:T.textmd,transition:'all 0.12s',fontFamily:FONT}}
                  onMouseEnter={e=>{e.currentTarget.style.background=T.sideAct;e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.color=T.text}}
                  onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.textmd}}>
                  <span>{a.icon}</span><span>{a.label}</span>
                  <svg style={{marginLeft:'auto',flexShrink:0}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textdim} strokeWidth={2.5}><path d="M9 18l6-6-6-6" strokeLinecap="round"/></svg>
                </button>
              ))}
            </div>
          </div>

          {/* Done for you preview */}
          <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'20px',boxShadow:T.shadowsm}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
              <p style={{margin:0,fontSize:12,fontWeight:700,color:T.textmd,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Done For You</p>
              <button onClick={()=>setView('done')} style={{fontSize:11,color:T.gold,background:'none',border:'none',cursor:'pointer',fontFamily:MONO,fontWeight:600}}>See all →</button>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {DONE_LOG.slice(0,6).map(d=>(
                <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:`1px solid ${T.divider}`}}>
                  <span style={{fontSize:14,flexShrink:0}}>{d.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:13,color:T.text,fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.label}</p>
                    <p style={{margin:0,fontSize:11,color:T.textdim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.detail}</p>
                  </div>
                  <span style={{fontSize:10,color:T.textdim,fontFamily:MONO,flexShrink:0,whiteSpace:'nowrap'}}>{d.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Workflows ─────────────────────────────────────────────────────────────
  function ViewWorkflows() {
    return (
      <div className="view-pad" style={{maxWidth:840,width:'100%',margin:'0 auto',padding:'32px 28px 80px'}}>
        <div className="wf-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28}}>
          <div>
            <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>Workflows</h1>
            <p style={{margin:0,fontSize:14,color:T.textmd}}>Automated sequences that run in the background, 24/7.</p>
          </div>
          <button onClick={()=>send('I want to create a new workflow. Walk me through the options.')}
            style={{background:T.gold,color:'#fff',border:'none',borderRadius:8,padding:'9px 18px',cursor:'pointer',fontSize:13,fontWeight:600,boxShadow:`0 2px 8px ${T.goldglo}`,flexShrink:0}}>+ New Workflow</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {WORKFLOWS.map(w=>(
            <div key={w.id} style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'18px 20px',display:'flex',alignItems:'center',gap:16,boxShadow:T.shadowsm,transition:'all 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldbrdr}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBord}}>
              <span style={{fontSize:22,flexShrink:0}}>{w.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:'0 0 3px',fontSize:14,fontWeight:600,color:T.text}}>{w.name}</p>
                <p style={{margin:0,fontSize:12,color:T.textmd,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{w.desc}</p>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
                <span style={{fontSize:11,color:T.textdim,fontFamily:MONO}}>{w.runs} runs</span>
                <Badge label={wfState[w.id]?'Active':'Paused'} color={wfState[w.id]?T.green:T.textdim} bg={wfState[w.id]?`${T.green}18`:`${T.textdim}18`}/>
                <Toggle on={wfState[w.id]} onChange={()=>setWfState(p=>({...p,[w.id]:!p[w.id]}))}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─── Agents ────────────────────────────────────────────────────────────────
  function ViewAgents() {
    return (
      <div className="view-pad" style={{maxWidth:840,width:'100%',margin:'0 auto',padding:'32px 28px 80px'}}>
        <div className="agents-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28}}>
          <div>
            <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>AI Agents</h1>
            <p style={{margin:0,fontSize:14,color:T.textmd}}>Specialized AI assistants — activate the ones you need.</p>
          </div>
          <button onClick={()=>send('I want to create a new AI agent. What options do I have?')}
            style={{background:T.gold,color:'#fff',border:'none',borderRadius:8,padding:'9px 18px',cursor:'pointer',fontSize:13,fontWeight:600,boxShadow:`0 2px 8px ${T.goldglo}`,flexShrink:0}}>+ New Agent</button>
        </div>
        <div className="agents-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
          {AGENTS.map(a=>(
            <div key={a.id} style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'20px',boxShadow:T.shadowsm,transition:'all 0.15s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.transform='translateY(-1px)'}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBord;e.currentTarget.style.transform='translateY(0)'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                <span style={{fontSize:24}}>{a.icon}</span>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <Badge label={agentState[a.id]?'Active':'Off'} color={agentState[a.id]?T.green:T.textdim} bg={agentState[a.id]?`${T.green}18`:`${T.textdim}18`}/>
                  <Toggle on={agentState[a.id]} onChange={()=>setAgentState(p=>({...p,[a.id]:!p[a.id]}))}/>
                </div>
              </div>
              <p style={{margin:'0 0 4px',fontSize:14,fontWeight:600,color:T.text}}>{a.name}</p>
              <p style={{margin:'0 0 12px',fontSize:12,color:T.textmd,lineHeight:1.5}}>{a.desc}</p>
              <button onClick={()=>send(`Act as ${a.name} and help me now`)}
                style={{fontSize:11,color:T.gold,background:T.golddim,border:`1px solid ${T.goldbrdr}`,borderRadius:6,padding:'5px 12px',cursor:'pointer',fontWeight:600,fontFamily:MONO}}>
                Use now →
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─── Connections ───────────────────────────────────────────────────────────
  function ViewConnections() {
    const connected = CONNECTIONS.filter(c=>c.connected)
    const available = CONNECTIONS.filter(c=>!c.connected)
    const open = (url: string) => window.open(url, '_blank', 'noopener')

    const wizard  = connWizard;  const setWizard  = setConnWizard
    const waStep  = connWaStep;  const setWaStep  = setConnWaStep
    const waFields= connWaFields;const setWaFields= setConnWaFields
    const waCopied= connWaCopied;const setWaCopied= setConnWaCopied

    const WEBHOOK_URL = 'https://va.nexterai.agency/api/webhooks/whatsapp'
    const VERIFY_TOKEN = 'nexterai_whatsapp_2026'

    function copyText(text: string, setCopied: (v:boolean)=>void) {
      navigator.clipboard.writeText(text).then(()=>{ setCopied(true); setTimeout(()=>setCopied(false),2000) })
    }

    function WizardOverlay({ children }: { children: React.ReactNode }) {
      return (
        <div style={{position:'fixed',inset:0,zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)'}}
          onClick={()=>{setWizard(null);setWaStep(1);setWaFields({phone_number_id:'',access_token:'',business_account_id:''})}}>
          <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:16,padding:'32px 36px',maxWidth:540,width:'90%',boxShadow:T.shadow,position:'relative'}}
            onClick={e=>e.stopPropagation()}>
            <button onClick={()=>{setWizard(null);setWaStep(1)}}
              style={{position:'absolute',top:16,right:16,background:'none',border:'none',color:T.textdim,fontSize:20,cursor:'pointer',lineHeight:1}}>✕</button>
            {children}
          </div>
        </div>
      )
    }

    function WhatsAppWizard() {
      const steps = [
        { num:1, title:'Create a Meta App', body: <>Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener" style={{color:T.gold}}>developers.facebook.com/apps</a> → Create App → Choose <strong style={{color:T.text}}>Business</strong> type → Add <strong style={{color:T.text}}>WhatsApp</strong> product.</> },
        { num:2, title:'Get your credentials', body: <>In WhatsApp → API Setup, copy:<br/><br/><strong style={{color:T.text}}>Phone Number ID</strong> — shown under "From" number<br/><strong style={{color:T.text}}>Access Token</strong> — temporary token (or generate permanent)<br/><strong style={{color:T.text}}>WhatsApp Business Account ID</strong> — shown at top of the page</> },
        { num:3, title:'Register webhook', body: <>In WhatsApp → Configuration → Webhook, paste these values:<br/><br/>
          <div style={{background:T.inputbg,border:`1px solid ${T.border}`,borderRadius:8,padding:'12px 14px',marginTop:8}}>
            <p style={{margin:'0 0 6px',fontSize:11,color:T.textdim,fontFamily:MONO}}>CALLBACK URL</p>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <code style={{flex:1,fontSize:12,color:T.text,fontFamily:MONO,wordBreak:'break-all'}}>{WEBHOOK_URL}</code>
              <button onClick={()=>copyText(WEBHOOK_URL,setWaCopied)}
                style={{fontSize:11,padding:'4px 10px',background:T.golddim,border:`1px solid ${T.goldbrdr}`,borderRadius:6,color:T.gold,cursor:'pointer',fontFamily:MONO,flexShrink:0}}>
                {waCopied?'Copied!':'Copy'}
              </button>
            </div>
            <hr style={{border:'none',borderTop:`1px solid ${T.border}`,margin:'10px 0'}}/>
            <p style={{margin:'0 0 4px',fontSize:11,color:T.textdim,fontFamily:MONO}}>VERIFY TOKEN</p>
            <code style={{fontSize:12,color:T.text,fontFamily:MONO}}>{VERIFY_TOKEN}</code>
          </div>
          <p style={{margin:'10px 0 0',fontSize:12,color:T.textmd}}>Subscribe to the <strong style={{color:T.text}}>messages</strong> webhook field.</p>
        </> },
        { num:4, title:'Enter your credentials', body: (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {(['phone_number_id','access_token','business_account_id'] as const).map(key=>(
              <div key={key}>
                <label style={{display:'block',fontSize:11,color:T.textdim,fontFamily:MONO,marginBottom:4,textTransform:'uppercase',letterSpacing:'0.08em'}}>{key.replace(/_/g,' ')}</label>
                <input value={waFields[key]} onChange={e=>setWaFields(p=>({...p,[key]:e.target.value}))}
                  placeholder={key==='phone_number_id'?'123456789012345':key==='access_token'?'EAAxxxxxx...':'987654321098765'}
                  style={{width:'100%',padding:'9px 12px',background:T.inputbg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontSize:13,fontFamily:MONO,outline:'none',boxSizing:'border-box'}}/>
              </div>
            ))}
            <p style={{margin:'4px 0 0',fontSize:12,color:T.textmd}}>Add these to Vercel → Environment Variables, then redeploy.</p>
          </div>
        ) },
      ]
      const step = steps[waStep-1]
      return (
        <WizardOverlay>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
            <span style={{fontSize:28}}>📱</span>
            <div>
              <h2 style={{margin:0,fontSize:18,fontWeight:700,color:T.text}}>Connect WhatsApp Business</h2>
              <p style={{margin:'2px 0 0',fontSize:12,color:T.textmd}}>Step {waStep} of {steps.length}</p>
            </div>
          </div>

          <div style={{display:'flex',gap:6,marginBottom:24}}>
            {steps.map(s=>(
              <div key={s.num} style={{flex:1,height:3,borderRadius:2,background:waStep>=s.num?T.gold:T.border,transition:'background 0.2s'}}/>
            ))}
          </div>

          <h3 style={{margin:'0 0 12px',fontSize:15,fontWeight:600,color:T.text}}>{step.num}. {step.title}</h3>
          <div style={{fontSize:13,color:T.textmd,lineHeight:1.7}}>{step.body}</div>

          <div style={{display:'flex',gap:10,marginTop:24,justifyContent:'flex-end'}}>
            {waStep>1 && <button onClick={()=>setWaStep(s=>s-1)}
              style={{padding:'8px 18px',background:'none',border:`1px solid ${T.border}`,borderRadius:8,color:T.textmd,cursor:'pointer',fontSize:13}}>Back</button>}
            {waStep<steps.length
              ? <button onClick={()=>setWaStep(s=>s+1)}
                  style={{padding:'8px 20px',background:T.gold,border:'none',borderRadius:8,color:'#fff',cursor:'pointer',fontSize:13,fontWeight:600}}>Next →</button>
              : <button onClick={()=>{setWizard(null);setWaStep(1)}}
                  style={{padding:'8px 20px',background:T.gold,border:'none',borderRadius:8,color:'#fff',cursor:'pointer',fontSize:13,fontWeight:600}}>Done ✓</button>
            }
          </div>
        </WizardOverlay>
      )
    }

    function LinkedInWizard() {
      return (
        <WizardOverlay>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
            <span style={{fontSize:28}}>🔗</span>
            <div>
              <h2 style={{margin:0,fontSize:18,fontWeight:700,color:T.text}}>Connect LinkedIn</h2>
              <p style={{margin:'2px 0 0',fontSize:12,color:T.textmd}}>One-click OAuth connection</p>
            </div>
          </div>

          <div style={{background:T.inputbg,border:`1px solid ${T.border}`,borderRadius:10,padding:'16px 18px',marginBottom:20}}>
            <p style={{margin:'0 0 8px',fontSize:13,fontWeight:600,color:T.text}}>Before connecting:</p>
            <ol style={{margin:0,paddingLeft:18,fontSize:13,color:T.textmd,lineHeight:1.8}}>
              <li>Go to <a href="https://www.linkedin.com/developers/apps/new" target="_blank" rel="noopener" style={{color:T.gold}}>LinkedIn Developer Apps</a> → Create app</li>
              <li>Add products: <strong style={{color:T.text}}>Share on LinkedIn</strong> + <strong style={{color:T.text}}>Sign In with LinkedIn</strong></li>
              <li>Set redirect URL to: <code style={{fontSize:11,fontFamily:MONO,color:T.gold}}>https://va.nexterai.agency/api/auth/linkedin/callback</code></li>
              <li>Copy Client ID and Client Secret → add to Vercel env vars:<br/>
                <code style={{fontSize:11,fontFamily:MONO,color:T.text}}>LINKEDIN_CLIENT_ID</code> and <code style={{fontSize:11,fontFamily:MONO,color:T.text}}>LINKEDIN_CLIENT_SECRET</code>
              </li>
            </ol>
          </div>

          <p style={{margin:'0 0 16px',fontSize:13,color:T.textmd}}>Once credentials are in Vercel, click below to authorize:</p>

          <button onClick={()=>open('/api/auth/linkedin')}
            style={{width:'100%',padding:'12px',background:'#0A66C2',border:'none',borderRadius:10,color:'#fff',fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
            <span style={{fontSize:18}}>🔗</span> Connect with LinkedIn
          </button>

          <p style={{margin:'12px 0 0',fontSize:11,color:T.textdim,textAlign:'center'}}>You'll be redirected to LinkedIn to approve access, then brought back with your access token.</p>
        </WizardOverlay>
      )
    }

    function handleConnect(c: typeof CONNECTIONS[0]) {
      if (c.id === 'whatsapp') { setWizard('whatsapp'); setWaStep(1) }
      else if (c.id === 'linkedin') { setWizard('linkedin') }
      else open(c.addUrl)
    }

    return (
      <div className="view-pad" style={{maxWidth:840,width:'100%',margin:'0 auto',padding:'32px 28px 80px'}}>
        {wizard === 'whatsapp' && <WhatsAppWizard/>}
        {wizard === 'linkedin' && <LinkedInWizard/>}

        <div style={{marginBottom:28}}>
          <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>Connections</h1>
          <p style={{margin:0,fontSize:14,color:T.textmd}}>Manage your integrations. Connect in under 30 seconds.</p>
        </div>

        <p style={{margin:'0 0 10px',fontSize:11,fontWeight:700,color:T.textdim,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Active · {connected.length} connected</p>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:24}}>
          {connected.map(c=>(
            <div key={c.id} style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'16px 20px',display:'flex',alignItems:'center',gap:14,boxShadow:T.shadowsm}}>
              <span style={{fontSize:22,flexShrink:0}}>{c.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:14,fontWeight:600,color:T.text}}>{c.name}</p>
                <p style={{margin:'2px 0 0',fontSize:12,color:T.textmd}}>{c.desc}</p>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:T.green}}/>
                <span style={{fontSize:11,color:T.green,fontFamily:MONO,fontWeight:600}}>Connected</span>
                <button onClick={()=>open(c.manageUrl)}
                  style={{fontSize:11,color:T.textdim,background:'none',border:`1px solid ${T.border}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',fontFamily:MONO,transition:'all 0.12s'}}
                  onMouseEnter={e=>{e.currentTarget.style.color=T.gold;e.currentTarget.style.borderColor=T.goldbrdr}}
                  onMouseLeave={e=>{e.currentTarget.style.color=T.textdim;e.currentTarget.style.borderColor=T.border}}>
                  Manage ↗
                </button>
              </div>
            </div>
          ))}
        </div>

        <p style={{margin:'0 0 10px',fontSize:11,fontWeight:700,color:T.textdim,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Available — click to connect</p>
        <div className="avail-grid" style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8}}>
          {available.map(c=>(
            <div key={c.id} style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'16px 18px',display:'flex',alignItems:'center',gap:12,cursor:'pointer',opacity:0.8,transition:'all 0.15s'}}
              onClick={()=>handleConnect(c)}
              onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.borderColor=T.goldbrdr}}
              onMouseLeave={e=>{e.currentTarget.style.opacity='0.8';e.currentTarget.style.borderColor=T.cardBord}}>
              <span style={{fontSize:20,flexShrink:0}}>{c.icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:13,fontWeight:600,color:T.text}}>{c.name}</p>
                <p style={{margin:'1px 0 0',fontSize:11,color:T.textmd,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.desc}</p>
              </div>
              <button onClick={e=>{e.stopPropagation();handleConnect(c)}}
                style={{fontSize:11,color:T.gold,background:T.golddim,border:`1px solid ${T.goldbrdr}`,borderRadius:6,padding:'5px 12px',cursor:'pointer',fontFamily:MONO,fontWeight:600,flexShrink:0}}>
                + Connect
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─── Docs ──────────────────────────────────────────────────────────────────
  function ViewDocs() {
    const folders = ['Contracts', 'Proposals', 'Meeting Notes', 'Templates', 'Reports']
    function handleDocFiles(files: FileList | null) {
      if (!files) return
      const names = Array.from(files).map(f => f.name)
      setDocsUploadedFiles(p => [...p, ...names])
    }
    return (
      <div style={{maxWidth:840,width:'100%',margin:'0 auto',padding:'32px 28px 100px'}}>
        <input ref={docsFileRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.png,.jpg,.jpeg" style={{display:'none'}} onChange={e=>handleDocFiles(e.target.files)}/>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28,flexWrap:'wrap',gap:12}}>
          <div>
            <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>Docs</h1>
            <p style={{margin:0,fontSize:14,color:T.textmd}}>Upload documents and reference them in any AI conversation.</p>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>window.open('https://drive.google.com','_blank','noopener')}
              style={{background:'transparent',color:T.textmd,border:`1px solid ${T.border}`,borderRadius:8,padding:'9px 16px',cursor:'pointer',fontSize:13,fontWeight:600,transition:'all 0.12s'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.color=T.text}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.textmd}}>
              💾 Open Drive ↗
            </button>
            <button onClick={()=>docsFileRef.current?.click()}
              style={{background:T.gold,color:'#fff',border:'none',borderRadius:8,padding:'9px 18px',cursor:'pointer',fontSize:13,fontWeight:600,boxShadow:`0 2px 8px ${T.goldglo}`}}>
              + Upload
            </button>
          </div>
        </div>
        {docsUploadedFiles.length > 0 && (
          <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:10,padding:'14px 18px',marginBottom:16,boxShadow:T.shadowsm}}>
            <p style={{margin:'0 0 8px',fontSize:11,fontWeight:700,color:T.textdim,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Uploaded this session</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {docsUploadedFiles.map((f,i)=>(
                <span key={i} style={{fontSize:12,background:T.golddim,color:T.gold,border:`1px solid ${T.goldbrdr}`,borderRadius:6,padding:'3px 10px',fontFamily:MONO}}>📄 {f}</span>
              ))}
            </div>
          </div>
        )}
        <div className="docs-folders" style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:24}}>
          {folders.map(f=>(
            <div key={f} onClick={()=>docsFileRef.current?.click()}
              style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'18px',cursor:'pointer',transition:'all 0.15s',boxShadow:T.shadowsm}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.transform='translateY(-2px)'}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBord;e.currentTarget.style.transform='translateY(0)'}}>
              <span style={{fontSize:28,display:'block',marginBottom:8}}>📁</span>
              <p style={{margin:0,fontSize:13,fontWeight:600,color:T.text}}>{f}</p>
              <p style={{margin:'3px 0 0',fontSize:11,color:T.textdim}}>0 documents · click to upload</p>
            </div>
          ))}
        </div>
        <div
          onDragOver={e=>e.preventDefault()}
          onDrop={e=>{e.preventDefault();handleDocFiles(e.dataTransfer.files)}}
          style={{background:T.card,border:`2px dashed ${T.border}`,borderRadius:12,padding:'40px',textAlign:'center',cursor:'pointer',transition:'border-color 0.15s'}}
          onMouseEnter={e=>e.currentTarget.style.borderColor=T.goldbrdr}
          onMouseLeave={e=>e.currentTarget.style.borderColor=T.border}>
          <span style={{fontSize:36,display:'block',marginBottom:12}}>☁️</span>
          <p style={{margin:'0 0 6px',fontSize:15,fontWeight:600,color:T.text}}>Drop files here or click to upload</p>
          <p style={{margin:'0 0 16px',fontSize:13,color:T.textmd}}>PDF, Word, Excel, images · Max 25MB per file</p>
          <button onClick={()=>docsFileRef.current?.click()}
            style={{background:T.gold,color:'#fff',border:'none',borderRadius:8,padding:'9px 20px',cursor:'pointer',fontSize:13,fontWeight:600,boxShadow:`0 2px 8px ${T.goldglo}`}}>
            Choose files
          </button>
        </div>
      </div>
    )
  }

  // ─── Done For You ──────────────────────────────────────────────────────────
  function ViewDone() {
    const cats = ['All','Email','CRM','Calendar','AI']
    const filter = doneFilter; const setFilter = setDoneFilter
    const filtered = filter==='All' ? DONE_LOG : DONE_LOG.filter(d=>d.cat===filter)
    const catColors: Record<string,{bg:string;color:string}> = {
      Email:   {bg:`${T.blue}18`,    color:T.blue   },
      CRM:     {bg:`${T.orange}18`,  color:T.orange },
      Calendar:{bg:`${T.green}18`,   color:T.green  },
      AI:      {bg:`${T.gold}18`,    color:T.gold   },
    }
    return (
      <div style={{maxWidth:840,width:'100%',margin:'0 auto',padding:'32px 28px 100px'}}>
        <div style={{marginBottom:24}}>
          <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>Done For You</h1>
          <p style={{margin:0,fontSize:14,color:T.textmd}}>Everything your AI executed automatically — full audit trail.</p>
        </div>
        <div style={{display:'flex',gap:6,marginBottom:20,flexWrap:'wrap'}}>
          {cats.map(c=>(
            <button key={c} onClick={()=>setFilter(c)}
              style={{fontSize:12,fontWeight:600,color:filter===c?T.gold:T.textmd,background:filter===c?T.golddim:'transparent',border:`1px solid ${filter===c?T.goldbrdr:T.border}`,borderRadius:999,padding:'5px 14px',cursor:'pointer',fontFamily:MONO,transition:'all 0.12s'}}>
              {c}
            </button>
          ))}
          <span style={{marginLeft:'auto',fontSize:12,color:T.textdim,fontFamily:MONO,alignSelf:'center'}}>{filtered.length} actions</span>
        </div>
        <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,overflow:'hidden',boxShadow:T.shadowsm}}>
          {filtered.map((d,i)=>(
            <div key={d.id} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 20px',borderBottom:i<filtered.length-1?`1px solid ${T.divider}`:'none',transition:'background 0.1s'}}
              onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.background=T.sideHov}
              onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.background='transparent'}>
              <div style={{width:36,height:36,borderRadius:9,background:catColors[d.cat]?.bg||T.golddim,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{d.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <p style={{margin:0,fontSize:13,fontWeight:600,color:T.text}}>{d.label}</p>
                <p style={{margin:'2px 0 0',fontSize:12,color:T.textmd,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.detail}</p>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                <Badge label={d.cat} color={catColors[d.cat]?.color||T.gold} bg={catColors[d.cat]?.bg||T.golddim}/>
                <span style={{fontSize:11,color:T.textdim,fontFamily:MONO,whiteSpace:'nowrap'}}>{d.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ─── Feedback ──────────────────────────────────────────────────────────────
  function ViewFeedback() {
    const emojis = ['😞','😐','🙂','😊','🤩']
    const rating = feedbackRating; const setRating = setFeedbackRating
    function sendFeedback() {
      if (!feedbackText.trim()) return
      const ratingLabel = rating >= 0 ? `Rating: ${emojis[rating]} (${rating+1}/5)\n\n` : ''
      const subject = encodeURIComponent('VA App Feedback')
      const body = encodeURIComponent(`${ratingLabel}${feedbackText}`)
      window.location.href = `mailto:info@i-review.ai?subject=${subject}&body=${body}`
      setFeedbackSent(true)
    }
    return (
      <div className="view-pad" style={{maxWidth:600,width:'100%',margin:'0 auto',padding:'32px 28px 80px'}}>
        <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>Feedback</h1>
        <p style={{margin:'0 0 28px',fontSize:14,color:T.textmd}}>Help us improve VA App. Sent directly to info@i-review.ai.</p>
        {feedbackSent ? (
          <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'48px',textAlign:'center',boxShadow:T.shadowsm}}>
            <span style={{fontSize:40,display:'block',marginBottom:12}}>🙏</span>
            <p style={{margin:'0 0 6px',fontSize:16,fontWeight:700,color:T.text}}>Thank you!</p>
            <p style={{margin:'0 0 16px',fontSize:14,color:T.textmd}}>Your feedback is on its way to info@i-review.ai.</p>
            <button onClick={()=>{setFeedbackSent(false);setFeedbackText('');setRating(-1)}}
              style={{fontSize:13,color:T.gold,background:'none',border:`1px solid ${T.goldbrdr}`,borderRadius:8,padding:'8px 20px',cursor:'pointer'}}>
              Send more feedback
            </button>
          </div>
        ) : (
          <div style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'24px',boxShadow:T.shadowsm}}>
            <p style={{margin:'0 0 8px',fontSize:13,fontWeight:600,color:T.textmd}}>How would you rate your experience?</p>
            <div style={{display:'flex',gap:8,marginBottom:20}}>
              {emojis.map((e,i)=>(
                <button key={i} onClick={()=>setRating(i)}
                  style={{fontSize:24,background:rating===i?T.golddim:'none',border:`1px solid ${rating===i?T.goldbrdr:T.border}`,borderRadius:8,padding:'8px 14px',cursor:'pointer',transition:'all 0.12s',transform:rating===i?'scale(1.15)':'scale(1)'}}
                  onMouseEnter={e2=>{if(rating!==i){e2.currentTarget.style.borderColor=T.goldbrdr;e2.currentTarget.style.background=T.golddim}}}
                  onMouseLeave={e2=>{if(rating!==i){e2.currentTarget.style.borderColor=T.border;e2.currentTarget.style.background='none'}}}>
                  {e}
                </button>
              ))}
            </div>
            <p style={{margin:'0 0 6px',fontSize:13,fontWeight:600,color:T.textmd}}>What&apos;s on your mind?</p>
            <textarea value={feedbackText} onChange={e=>setFeedbackText(e.target.value)} placeholder="Feature request, bug report, or general thoughts…"
              style={{width:'100%',background:T.inputbg,border:`1px solid ${T.bordmd}`,borderRadius:8,padding:'12px 14px',fontSize:14,color:T.text,fontFamily:FONT,outline:'none',resize:'vertical',minHeight:100,marginBottom:14,boxSizing:'border-box'}}/>
            <button onClick={sendFeedback} disabled={!feedbackText.trim()}
              style={{background:feedbackText.trim()?T.gold:'transparent',color:feedbackText.trim()?'#fff':T.textdim,border:`1px solid ${feedbackText.trim()?T.gold:T.border}`,borderRadius:8,padding:'10px 24px',cursor:feedbackText.trim()?'pointer':'not-allowed',fontSize:14,fontWeight:600,boxShadow:feedbackText.trim()?`0 2px 8px ${T.goldglo}`:'none',transition:'all 0.15s'}}>
              Send Feedback → info@i-review.ai
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── Support ───────────────────────────────────────────────────────────────
  function ViewSupport() {
    const activeGuide = supportGuide; const setActiveGuide = setSupportGuide

    const setupSteps = [
      {
        id:'anthropic', icon:'🤖', title:'Step 1 — Get Your Claude API Key',
        time:'5 min', required:true,
        steps:[
          'Go to console.anthropic.com and create an account',
          'Click "Get API Keys" → Create new key → copy it',
          'Send the key to your Nexter AI setup contact',
          'This key is private — never share it publicly',
          'You are billed directly by Anthropic based on usage',
        ],
        link:'https://console.anthropic.com',linkLabel:'Open Anthropic Console ↗',
      },
      {
        id:'gmail', icon:'📧', title:'Step 2 — Connect Gmail',
        time:'3 min', required:true,
        steps:[
          'In this app, go to Connections → click "Connect" next to Gmail',
          'Sign in with your Google account and allow the requested permissions',
          'The app needs: read emails, send emails, read calendar',
          'Once connected, the green dot appears — the AI can now read and send email on your behalf',
          'To disconnect at any time: Google Account → Security → Third-party access',
        ],
        link:'https://myaccount.google.com/permissions',linkLabel:'Manage Google Permissions ↗',
      },
      {
        id:'outlook', icon:'💼', title:'Step 3 — Connect Microsoft Outlook (optional)',
        time:'3 min', required:false,
        steps:[
          'In Connections → click "Connect" next to Microsoft Outlook',
          'Sign in with your Microsoft 365 account',
          'The app reads both your Outlook inbox and your Outlook Calendar',
          'If you use both Gmail and Outlook, the AI checks both automatically',
        ],
        link:'https://myaccount.microsoft.com',linkLabel:'Manage Microsoft Permissions ↗',
      },
      {
        id:'ghl', icon:'🏢', title:'Step 4 — Connect GHL CRM (optional)',
        time:'5 min', required:false,
        steps:[
          'Log into your Go High Level account',
          'Go to Settings → Integrations → Private Integrations',
          'Create a new integration and copy the token (starts with pit-...)',
          'Also copy your Location ID from Settings → Business Info',
          'Send both to your Nexter AI setup contact to add to the system',
        ],
        link:'https://app.gohighlevel.com',linkLabel:'Open GHL ↗',
      },
      {
        id:'zoom', icon:'📹', title:'Step 5 — Connect Zoom (optional)',
        time:'5 min', required:false,
        steps:[
          'Go to marketplace.zoom.us → Build App → Server-to-Server OAuth',
          'Create an app, copy Account ID, Client ID, and Client Secret',
          'Enable scopes: meeting:write, meeting:read, cloud_recording:read',
          'Send credentials to your Nexter AI setup contact',
          'Once connected, the AI can create Zoom meetings and read recording summaries',
        ],
        link:'https://marketplace.zoom.us',linkLabel:'Open Zoom Marketplace ↗',
      },
      {
        id:'calendly', icon:'📅', title:'Step 6 — Connect Calendly (optional)',
        time:'2 min', required:false,
        steps:[
          'Log into Calendly → Integrations → API & Webhooks',
          'Create a Personal Access Token and copy it',
          'Send to your Nexter AI setup contact',
          'The AI will sync booking contacts directly to your CRM',
        ],
        link:'https://calendly.com/integrations/api_webhooks',linkLabel:'Open Calendly API ↗',
      },
    ]

    const faqs = [
      { q:'How do I activate a workflow?',           a:'Go to Workflows → find the workflow → toggle the switch. It runs automatically from that point forward.' },
      { q:'Can I use the AI in multiple languages?', a:'Yes. Just write in your preferred language — the AI responds in the same language.' },
      { q:'Where are my conversations stored?',      a:'Conversations are stored securely in your own private database. No data is shared with other clients.' },
      { q:'How do I get a morning briefing?',        a:'Ask: "Give me my morning briefing" or click Morning Brief in Dashboard Quick Actions. It pulls email, calendar, and leads together.' },
      { q:'What does the AI cost me?',               a:'You pay Anthropic directly per message. Typical usage costs $5–30/month depending on volume. You control your own API key and budget.' },
      { q:'Can I request custom workflows?',         a:'Yes. Contact info@i-review.ai describing what you need. Custom workflows are built and added to your instance.' },
      { q:'How do I disconnect a service?',          a:'Go to the service settings (e.g. Google Account → Security → Third-party access) and remove the app. The connection will stop immediately.' },
    ]

    return (
      <div className="view-pad" style={{maxWidth:780,width:'100%',margin:'0 auto',padding:'32px 28px 80px'}}>
        <h1 style={{margin:'0 0 6px',fontSize:22,fontWeight:700,color:T.text,letterSpacing:'-0.02em'}}>Help Center</h1>
        <p style={{margin:'0 0 28px',fontSize:14,color:T.textmd}}>Setup guides, FAQs, and how to reach us.</p>

        {/* Contact cards */}
        <div className="support-cards" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:32}}>
          {[
            {icon:'📧',label:'Email Support',    desc:'info@i-review.ai',        action:()=>{ window.location.href='mailto:info@i-review.ai?subject=VA App Support' }},
            {icon:'💬',label:'WhatsApp',         desc:'Quick reply, usually same day', action:()=>window.open('https://wa.me/message/placeholder','_blank','noopener')},
          ].map(item=>(
            <button key={item.label} onClick={item.action}
              style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:12,padding:'16px 18px',textAlign:'left',cursor:'pointer',boxShadow:T.shadowsm,transition:'all 0.15s',display:'flex',alignItems:'center',gap:14}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.transform='translateY(-1px)'}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBord;e.currentTarget.style.transform='translateY(0)'}}>
              <span style={{fontSize:28}}>{item.icon}</span>
              <div>
                <p style={{margin:'0 0 2px',fontSize:13,fontWeight:600,color:T.text}}>{item.label}</p>
                <p style={{margin:0,fontSize:12,color:T.textmd}}>{item.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Setup Guide */}
        <p style={{margin:'0 0 10px',fontSize:11,fontWeight:700,color:T.textdim,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Setup Guide — Connect Your Tools</p>
        <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:28}}>
          {setupSteps.map(step=>(
            <div key={step.id} style={{background:T.card,border:`1px solid ${activeGuide===step.id?T.goldbrdr:T.cardBord}`,borderRadius:12,overflow:'hidden',boxShadow:T.shadowsm,transition:'all 0.15s'}}>
              <button onClick={()=>setActiveGuide(activeGuide===step.id?null:step.id)}
                style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'14px 18px',background:'none',border:'none',cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:20,flexShrink:0}}>{step.icon}</span>
                <div style={{flex:1,minWidth:0}}>
                  <p style={{margin:0,fontSize:13,fontWeight:600,color:T.text}}>{step.title}</p>
                  <p style={{margin:'2px 0 0',fontSize:11,color:T.textdim,fontFamily:MONO}}>~{step.time} · {step.required?'Recommended':'Optional'}</p>
                </div>
                <span style={{fontSize:16,color:T.textdim,transition:'transform 0.2s',transform:activeGuide===step.id?'rotate(180deg)':'rotate(0deg)',display:'inline-block'}}>›</span>
              </button>
              {activeGuide===step.id && (
                <div style={{padding:'0 18px 16px',borderTop:`1px solid ${T.divider}`}}>
                  <ol style={{margin:'12px 0 0',paddingLeft:20,display:'flex',flexDirection:'column',gap:8}}>
                    {step.steps.map((s,i)=>(
                      <li key={i} style={{fontSize:13,color:T.textmd,lineHeight:1.6}}>{s}</li>
                    ))}
                  </ol>
                  <a href={step.link} target="_blank" rel="noopener noreferrer"
                    style={{display:'inline-block',marginTop:12,fontSize:12,color:T.gold,fontWeight:600,fontFamily:MONO,textDecoration:'none',border:`1px solid ${T.goldbrdr}`,borderRadius:6,padding:'5px 12px',background:T.golddim}}>
                    {step.linkLabel}
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* FAQ */}
        <p style={{margin:'0 0 10px',fontSize:11,fontWeight:700,color:T.textdim,textTransform:'uppercase',letterSpacing:'0.1em',fontFamily:MONO}}>Frequently Asked Questions</p>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {faqs.map((f,i)=>(
            <details key={i} style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:10,padding:'13px 16px',cursor:'pointer'}}>
              <summary style={{fontSize:13,fontWeight:600,color:T.text,listStyle:'none',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                {f.q}<span style={{color:T.textdim,fontWeight:400,marginLeft:8}}>+</span>
              </summary>
              <p style={{margin:'10px 0 0',fontSize:13,color:T.textmd,lineHeight:1.65}}>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    )
  }

  // ─── Chat View ─────────────────────────────────────────────────────────────
  function ViewChat() {
    return (
      <>
        {/* Thread */}
        <div ref={chatScrollRef} style={{flex:1,overflowY:'auto',background:T.bg,overflowAnchor:'none'}}
          onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();handleFiles(e.dataTransfer.files)}}>
          <div className="chat-thread-inner" style={{maxWidth:760,width:'100%',margin:'0 auto',padding:'32px 28px 20px',display:'flex',flexDirection:'column'}}>

            {messages.map((msg,idx)=>{
              const isWelcome = msg.content === '__WELCOME__'
              const isUser    = msg.role === 'user'

              if (isWelcome) return (
                <div key={msg.id} style={{padding:'20px 0 40px'}}>
                  <h1 style={{margin:'0 0 6px',fontSize:28,fontWeight:700,color:T.text,letterSpacing:'-0.03em'}}>{greeting}, Siamak.</h1>
                  <p style={{margin:'0 0 24px',fontSize:15,color:T.textmd,lineHeight:1.6}}>Your executive assistant is connected and ready. Ask me anything.</p>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}} className="qa-grid">
                    {[
                      {icon:'🔥',label:'Hot leads',       prompt:'Show me all hot leads from CRM'},
                      {icon:'📬',label:'Check inbox',      prompt:'Show my latest emails'},
                      {icon:'📅',label:"Today's schedule", prompt:"What's on my calendar today?"},
                      {icon:'💰',label:'Pipeline',         prompt:"Show this month's revenue pipeline"},
                      {icon:'☀️',label:'Morning brief',    prompt:'Give me a full morning briefing'},
                      {icon:'🔄',label:'Sync Calendly',    prompt:'Sync my Calendly contacts to CRM'},
                    ].map(a=>(
                      <button key={a.label} onClick={()=>send(a.prompt)}
                        style={{background:T.card,border:`1px solid ${T.cardBord}`,borderRadius:10,padding:'12px 14px',cursor:'pointer',textAlign:'left',display:'flex',alignItems:'center',gap:9,transition:'all 0.14s',boxShadow:T.shadowsm}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.transform='translateY(-1px)'}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.cardBord;e.currentTarget.style.transform='translateY(0)'}}>
                        <span style={{fontSize:16}}>{a.icon}</span>
                        <span style={{fontSize:13,fontWeight:500,color:T.textmd}}>{a.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )

              if (isUser) return (
                <div key={msg.id}>
                  {idx>0 && <div style={{height:1,background:T.divider,margin:'20px 0'}}/>}
                  <div style={{display:'flex',justifyContent:'flex-end'}}>
                    <div style={{maxWidth:'76%',background:T.userMsg,border:`1px solid ${T.cardBord}`,borderRadius:'14px 14px 4px 14px',padding:'11px 16px',fontSize:14,lineHeight:1.65,color:T.text,whiteSpace:'pre-wrap',boxShadow:T.shadowsm}}>
                      {msg.content}
                    </div>
                  </div>
                </div>
              )

              return (
                <div key={msg.id}>
                  {idx>0 && <div style={{height:1,background:T.divider,margin:'20px 0'}}/>}
                  <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:10}}>
                    <LogoMark size={24}/>
                    <span style={{fontSize:13,fontWeight:600,color:T.gold}}>VA</span>
                    {msg.skill && <span style={{fontSize:11,color:T.gold,background:T.golddim,border:`1px solid ${T.goldbrdr}`,padding:'2px 8px',borderRadius:999,fontWeight:600}}>{msg.skill.icon} {msg.skill.label}</span>}
                    {msg.content && !msg.streaming && msg.content.length>400 && (
                      <button onClick={()=>send('Give me a 3-bullet TL;DR of the previous response')}
                        style={{marginLeft:'auto',fontSize:11,color:T.textdim,background:T.card,border:`1px solid ${T.border}`,borderRadius:6,padding:'3px 10px',cursor:'pointer',boxShadow:T.shadowsm,transition:'all 0.12s'}}
                        onMouseEnter={e=>{e.currentTarget.style.color=T.gold;e.currentTarget.style.borderColor=T.goldbrdr}}
                        onMouseLeave={e=>{e.currentTarget.style.color=T.textdim;e.currentTarget.style.borderColor=T.border}}>
                        ⚡ TL;DR
                      </button>
                    )}
                  </div>
                  {msg.tools && msg.tools.filter(t=>t.type==='tool_start').length>0 && (
                    <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:10,paddingLeft:33}}>
                      {msg.tools.filter(t=>t.type==='tool_start').map((t,i)=>(
                        <span key={i} style={{fontSize:11,background:T.golddim,color:T.gold,padding:'3px 9px',borderRadius:999,fontFamily:MONO,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                          <span style={{width:4,height:4,borderRadius:'50%',background:T.gold,display:'inline-block'}}/>
                          {TOOL_LABELS[t.tool]||t.tool.replace(/_/g,' ')}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{paddingLeft:33,fontSize:14.5,lineHeight:1.8,color:T.text}}>
                    {msg.content ? <MarkdownRenderer content={msg.content}/> : msg.streaming ? (
                      <div style={{display:'flex',gap:5,alignItems:'center',padding:'4px 0'}}>
                        {[0,150,300].map(d=>(
                          <span key={d} style={{width:6,height:6,borderRadius:'50%',background:T.gold,display:'inline-block',animation:'throb 1.3s ease-in-out infinite',animationDelay:`${d}ms`}}/>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
            <div ref={bottomRef} style={{height:8}}/>
          </div>
        </div>

        {/* Skills popup */}
        {showSkills && (
          <div style={{maxWidth:760,width:'100%',margin:'0 auto',padding:'0 28px 6px',flexShrink:0}}>
            <div style={{background:T.card,border:`1px solid ${T.bordmd}`,borderRadius:12,overflow:'hidden',maxHeight:300,overflowY:'auto',boxShadow:T.shadow}}>
              <div style={{padding:'10px 16px 8px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',background:T.panel}}>
                <span style={{fontSize:10,color:T.textdim,fontFamily:MONO,letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600}}>Slash Skills</span>
                <span style={{fontSize:10,color:T.textdim,fontFamily:MONO}}>Esc to close</span>
              </div>
              {SKILLS.map(s=>(
                <button key={s.trigger} onClick={()=>{setInput(s.trigger+' ');setShowSkills(false);inputRef.current?.focus()}}
                  style={{width:'100%',textAlign:'left',padding:'10px 16px',background:'none',border:'none',borderBottom:`1px solid ${T.border}`,cursor:'pointer',display:'flex',alignItems:'center',gap:12,color:T.text,transition:'background 0.08s'}}
                  onMouseEnter={e=>(e.currentTarget.style.background=T.sideHov)}
                  onMouseLeave={e=>(e.currentTarget.style.background='none')}>
                  <span style={{fontSize:14,width:20,textAlign:'center',flexShrink:0}}>{s.icon}</span>
                  <span style={{fontSize:12,fontWeight:700,color:T.gold,fontFamily:MONO,minWidth:100}}>{s.trigger}</span>
                  <span style={{fontSize:12,color:T.textmd}} className="hidden sm:inline">{s.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Compose */}
        <div className="compose-area" style={{background:T.compose,borderTop:`1px solid ${T.border}`,padding:'14px 28px',paddingBottom:'max(14px,env(safe-area-inset-bottom))',flexShrink:0}}>
          <div style={{maxWidth:760,margin:'0 auto'}}>
            {attachments.length>0 && (
              <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
                {attachments.map((a,i)=>(
                  <div key={i} style={{position:'relative'}}>
                    {a.preview ? <img src={a.preview} alt={a.name} style={{width:52,height:52,objectFit:'cover',borderRadius:8,border:`1px solid ${T.border}`}}/> :
                      <div style={{padding:'7px 12px',background:T.inputbg,border:`1px solid ${T.border}`,borderRadius:8,fontSize:11,color:T.textdim,fontFamily:MONO}}>{a.name}</div>}
                    <button onClick={()=>setAttachments(p=>p.filter((_,j)=>j!==i))} style={{position:'absolute',top:-6,right:-6,width:18,height:18,background:T.red,border:'none',borderRadius:'50%',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:900}}>×</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{border:`1.5px solid ${streaming?T.goldbrdr:T.bordmd}`,borderRadius:12,background:T.inputbg,overflow:'hidden',transition:'border-color 0.2s,box-shadow 0.2s',boxShadow:streaming?`0 0 0 3px ${T.golddim}`:T.shadowsm}}>
              <textarea ref={inputRef} value={input}
                onChange={e=>{setInput(e.target.value);if(e.target.value==='/') setShowSkills(true);else if(!e.target.value.startsWith('/')) setShowSkills(false)}}
                onKeyDown={handleKey} disabled={streaming}
                placeholder={streaming?'Working on it…':'Ask anything — check email, show hot leads, create a meeting, tag a contact…'}
                rows={3}
                style={{width:'100%',background:'transparent',border:'none',padding:'14px 16px 10px',fontSize:14.5,color:T.text,fontFamily:FONT,outline:'none',resize:'none',lineHeight:1.65,caretColor:T.gold,minHeight:78,maxHeight:200,display:'block'}}
                onFocus={e=>{e.currentTarget.parentElement!.style.borderColor=T.goldbrdr;e.currentTarget.parentElement!.style.boxShadow=`0 0 0 3px ${T.golddim}`}}
                onBlur={e=>{if(!streaming){e.currentTarget.parentElement!.style.borderColor=T.bordmd;e.currentTarget.parentElement!.style.boxShadow=T.shadowsm}}}
                onInput={e=>{const el=e.currentTarget;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,200)+'px'}}
              />
              <div style={{borderTop:`1px solid ${T.border}`,padding:'8px 12px',display:'flex',alignItems:'center',justifyContent:'space-between',background:T.panel}}>
                <div style={{display:'flex',gap:2,alignItems:'center'}}>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py" style={{display:'none'}} onChange={e=>handleFiles(e.target.files)}/>
                  <button onClick={()=>fileInputRef.current?.click()} style={{background:'none',border:'none',borderRadius:6,padding:'5px 8px',cursor:'pointer',color:T.textdim,display:'flex',alignItems:'center',gap:5,fontSize:12,transition:'color 0.12s'}}
                    onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.color=T.text}
                    onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.color=T.textdim}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <span className="hidden sm:inline">Attach</span>
                  </button>
                  <button onClick={()=>setShowSkills(!showSkills)}
                    style={{background:showSkills?T.golddim:'none',border:showSkills?`1px solid ${T.goldbrdr}`:'1px solid transparent',borderRadius:6,padding:'5px 8px',cursor:'pointer',color:showSkills?T.gold:T.textdim,display:'flex',alignItems:'center',gap:5,fontSize:12,transition:'all 0.12s'}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                    <span className="hidden sm:inline">Skills</span>
                  </button>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span className="hidden md:inline" style={{fontSize:10,color:T.textdim,fontFamily:MONO}}>Shift+↵ new line</span>
                  <button onClick={()=>send()} disabled={streaming||!input.trim()}
                    style={{background:streaming||!input.trim()?'transparent':T.gold,border:`1px solid ${streaming||!input.trim()?T.border:T.gold}`,borderRadius:8,padding:'8px 20px',cursor:streaming||!input.trim()?'not-allowed':'pointer',color:streaming||!input.trim()?T.textdim:'#fff',fontSize:13,fontWeight:700,fontFamily:FONT,display:'flex',alignItems:'center',gap:7,transition:'all 0.15s',boxShadow:streaming||!input.trim()?'none':`0 2px 8px ${T.goldglo}`}}>
                    {streaming ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} style={{animation:'spin 0.8s linear infinite'}}><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/></svg>
                       : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    {streaming?'Working':'Send'}
                  </button>
                </div>
              </div>
            </div>

            {/* Skill chips below compose — as sketched */}
            <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
              {SKILLS.slice(0,6).map(s=>(
                <button key={s.trigger} onClick={()=>{setInput(s.trigger+' ');inputRef.current?.focus()}}
                  style={{fontSize:11,color:T.textdim,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:'4px 12px',cursor:'pointer',fontFamily:MONO,transition:'all 0.12s',display:'flex',alignItems:'center',gap:4}}
                  onMouseEnter={e=>{e.currentTarget.style.color=T.gold;e.currentTarget.style.borderColor=T.goldbrdr;e.currentTarget.style.background=T.golddim}}
                  onMouseLeave={e=>{e.currentTarget.style.color=T.textdim;e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.card}}>
                  {s.icon} {s.trigger}
                </button>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  // ─── File tree panel ───────────────────────────────────────────────────────
  function FilesPanel() {
    if (activePanel !== 'files') return null
    return (
      <aside style={{width:240,background:T.panel,borderRight:`1px solid ${T.border}`,display:'flex',flexDirection:'column',flexShrink:0}}>
        <div style={{padding:'16px 14px 10px',borderBottom:`1px solid ${T.border}`}}>
          <span style={{fontSize:11,fontWeight:600,color:T.textmd}}>Workspace Files</span>
        </div>
        <FileTree onPathSelect={insertPath}/>
      </aside>
    )
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{display:'flex',height:'100dvh',overflow:'hidden',background:T.bg,color:T.text,fontFamily:FONT,fontSize:15}}>

      {/* ────────────── LEFT SIDEBAR ────────────── */}
      <aside style={{width:sideW,background:T.sidebar,borderRight:`1px solid ${T.border}`,flexDirection:'column',flexShrink:0,transition:'width 0.2s',overflow:'hidden'}} className="hidden md:flex">

        {/* Logo + app name */}
        <div style={{padding:sideCollapsed?'16px 0 10px':'20px 14px 14px',borderBottom:`1px solid ${T.divider}`,display:'flex',alignItems:'center',gap:10,justifyContent:sideCollapsed?'center':'flex-start'}}>
          <LogoMark size={32}/>
          {!sideCollapsed && (
            <div style={{minWidth:0,flex:1}}>
              <p style={{margin:0,fontSize:14,fontWeight:700,color:T.text,letterSpacing:'-0.01em',lineHeight:1.1}}>VA</p>
              <p style={{margin:0,fontSize:10,color:T.textdim,letterSpacing:'0.02em',lineHeight:1.2}}>Nexter AI Group</p>
            </div>
          )}
          {!sideCollapsed && (
            <button onClick={()=>setSideCollapsed(true)} style={{background:'none',border:'none',color:T.textdim,cursor:'pointer',padding:4,flexShrink:0,display:'flex'}}
              onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.color=T.text}
              onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.color=T.textdim}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M15 18l-6-6 6-6" strokeLinecap="round"/></svg>
            </button>
          )}
          {sideCollapsed && (
            <button onClick={()=>setSideCollapsed(false)} style={{display:'none'}}/>
          )}
        </div>

        {/* Collapse expander when collapsed */}
        {sideCollapsed && (
          <button onClick={()=>setSideCollapsed(false)} style={{margin:'8px auto 0',width:32,height:24,background:'none',border:'none',color:T.textdim,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
            onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.color=T.text}
            onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.color=T.textdim}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M9 18l6-6-6-6" strokeLinecap="round"/></svg>
          </button>
        )}

        {/* Nav */}
        <nav style={{flex:1,overflowY:'auto',padding:'10px 8px 8px'}}>
          {/* New Chat */}
          <button onClick={startNew}
            style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:sideCollapsed?'9px 0':'10px 14px',justifyContent:sideCollapsed?'center':'flex-start',background:T.gold,border:'none',borderRadius:8,cursor:'pointer',color:'#fff',fontSize:13,fontWeight:700,marginBottom:10,transition:'all 0.14s',boxShadow:`0 2px 8px ${T.goldglo}`,fontFamily:FONT}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
            {!sideCollapsed && <span>New Chat</span>}
          </button>

          <SectionLabel text="Menu"/>
          {NAV_TOP.map(n=><NavItem key={n.id} {...n}/>)}

          <Divider/>
          {NAV_MID.map(n=><NavItem key={n.id} {...n}/>)}

          <Divider/>
          {NAV_BOT.map(n=><NavItem key={n.id} {...n}/>)}
        </nav>

        {/* Bottom: history shortcut, dark/light, sign out */}
        <div style={{padding:'8px',borderTop:`1px solid ${T.divider}`}}>
          {/* History */}
          <button onClick={()=>setActivePanel(p=>p==='history'?null:'history')}
            style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:sideCollapsed?'9px 0':'9px 14px',justifyContent:sideCollapsed?'center':'flex-start',background:activePanel==='history'?T.sideAct:'transparent',borderRadius:8,border:`1px solid ${activePanel==='history'?T.goldbrdr:'transparent'}`,cursor:'pointer',color:activePanel==='history'?T.gold:T.textmd,fontSize:13,fontWeight:400,transition:'all 0.14s',fontFamily:FONT,marginBottom:4}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {!sideCollapsed && <span>Chat History</span>}
          </button>

          {/* Dark / Light toggle */}
          {!sideCollapsed ? (
            <div style={{display:'flex',alignItems:'center',gap:8,padding:'9px 14px',borderRadius:8}}>
              <span style={{fontSize:13}}>{dark?'🌙':'☀️'}</span>
              <span style={{fontSize:13,color:T.textmd,flex:1}}>{dark?'Dark mode':'Light mode'}</span>
              <Toggle on={dark} onChange={()=>setDark(d=>!d)}/>
            </div>
          ) : (
            <button onClick={()=>setDark(d=>!d)} style={{width:'100%',display:'flex',justifyContent:'center',padding:'9px 0',background:'none',border:'none',cursor:'pointer',borderRadius:8,fontSize:16}}>
              {dark?'☀️':'🌙'}
            </button>
          )}

          {/* Sign out */}
          <button onClick={handleLogout}
            style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:sideCollapsed?'9px 0':'9px 14px',justifyContent:sideCollapsed?'center':'flex-start',background:'transparent',border:'none',cursor:'pointer',color:T.textdim,fontSize:13,borderRadius:8,transition:'color 0.14s',fontFamily:FONT,marginTop:2}}
            onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.color=T.red}
            onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.color=T.textdim}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {!sideCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {/* ────────────── HISTORY PANEL (slide-in) ────────────── */}
      {activePanel === 'history' && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.3)',zIndex:29,backdropFilter:'blur(2px)'}} className="md:hidden" onClick={()=>setActivePanel(null)}/>
          <aside style={{width:248,background:T.sidebar,borderRight:`1px solid ${T.border}`,display:'flex',flexDirection:'column',flexShrink:0,zIndex:30}} className="md:relative">
            <div style={{padding:'16px 14px 10px',borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontSize:11,fontWeight:600,color:T.textmd}}>Conversations</span>
              <div style={{display:'flex',gap:6}}>
                <button onClick={startNew} style={{fontSize:11,color:T.gold,background:T.golddim,border:`1px solid ${T.goldbrdr}`,borderRadius:6,padding:'4px 10px',cursor:'pointer',fontWeight:600}}>+ New</button>
                <button onClick={()=>setActivePanel(null)} style={{background:'none',border:'none',color:T.textdim,cursor:'pointer',fontSize:13}}>✕</button>
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'6px 8px'}}>
              {sessions.length===0 ? (
                <p style={{textAlign:'center',padding:'32px 16px',color:T.textdim,fontSize:12,margin:0,lineHeight:1.7}}>No conversations yet.<br/>Start chatting below.</p>
              ) : sessions.map(s=>(
                <div key={s.id} onClick={()=>loadSession(s.id)}
                  style={{display:'flex',alignItems:'center',gap:8,padding:'9px 10px',borderRadius:8,cursor:'pointer',background:s.id===sessionId?T.sideAct:'transparent',marginBottom:1,borderLeft:`2px solid ${s.id===sessionId?T.gold:'transparent'}`,transition:'all 0.1s'}}
                  onMouseEnter={e=>{if(s.id!==sessionId)(e.currentTarget as HTMLDivElement).style.background=T.sideHov}}
                  onMouseLeave={e=>{if(s.id!==sessionId)(e.currentTarget as HTMLDivElement).style.background='transparent'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:13,color:s.id===sessionId?T.text:T.textmd,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:s.id===sessionId?600:400}}>{s.title}</p>
                    <p style={{margin:'2px 0 0',fontSize:10,color:T.textdim,fontFamily:MONO}}>{fmtDate(s.updated_at)}</p>
                  </div>
                  <button onClick={e=>deleteSession(s.id,e)} style={{background:'none',border:'none',color:T.textdim,cursor:'pointer',padding:'3px 5px',borderRadius:4,fontSize:13,flexShrink:0}}
                    onMouseEnter={e=>(e.currentTarget as HTMLButtonElement).style.color=T.red}
                    onMouseLeave={e=>(e.currentTarget as HTMLButtonElement).style.color=T.textdim}>✕</button>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}

      {/* ────────────── FILE TREE PANEL ────────────── */}
      <FilesPanel/>

      {/* ────────────── MAIN CONTENT ────────────── */}
      <div style={{display:'flex',flexDirection:'column',flex:1,minWidth:0,overflow:'hidden'}}>

        {/* Top bar */}
        <div style={{height:50,borderBottom:`1px solid ${T.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px',flexShrink:0,background:T.topbar}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {/* Mobile: show logo + product name */}
            <div className="md:hidden" style={{display:'flex',alignItems:'center',gap:8}}>
              <LogoMark size={28}/>
              <span style={{fontSize:14,fontWeight:700,color:T.gold,letterSpacing:'0.02em'}}>VA</span>
            </div>
            <span style={{fontSize:14,fontWeight:600,color:T.text,letterSpacing:'-0.01em'}} className="hidden md:inline">
              {view === 'chat' ? 'AI Assistant' : view === 'dashboard' ? 'Dashboard' : view === 'workflows' ? 'Workflows' : view === 'agents' ? 'Agents' : view === 'connections' ? 'Connections' : view === 'docs' ? 'Docs' : view === 'done' ? 'Done For You' : view === 'feedback' ? 'Feedback' : 'Support'}
            </span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {view === 'chat' && (
              <input type="text" value={workspaceRoot} onChange={e=>setWorkspaceRoot(e.target.value)} placeholder="Workspace path"
                style={{fontSize:11,background:T.inputbg,border:`1px solid ${T.border}`,borderRadius:7,padding:'5px 10px',color:T.textmd,width:130,outline:'none',fontFamily:MONO}} className="hidden md:block"/>
            )}
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div style={{width:6,height:6,borderRadius:'50%',background:streaming?T.orange:T.green,boxShadow:`0 0 6px ${streaming?T.orange:T.green}88`,transition:'all 0.4s'}}/>
              <span style={{fontSize:11,color:T.textdim,fontFamily:MONO}}>{streaming?'Working…':'Connected'}</span>
            </div>
            {nowStr && <span style={{fontSize:11,color:T.textdim,fontFamily:MONO}} className="hidden md:inline">{nowStr}</span>}
            {/* Mobile menu */}
            <button onClick={()=>setActivePanel(p=>p==='history'?null:'history')} className="md:hidden"
              style={{background:'none',border:'none',color:T.textdim,cursor:'pointer',padding:4,display:'flex'}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {/* View content */}
        <div className={view!=='chat'?'view-scroll':''} style={{flex:1,overflowY:view==='chat'?'hidden':'auto',display:'flex',flexDirection:'column',background:T.bg}}>
          {view === 'chat'        && ViewChat()}
          {view === 'dashboard'   && <ViewDashboard/>}
          {view === 'workflows'   && <ViewWorkflows/>}
          {view === 'agents'      && <ViewAgents/>}
          {view === 'connections' && <ViewConnections/>}
          {view === 'docs'        && <ViewDocs/>}
          {view === 'done'        && <ViewDone/>}
          {view === 'feedback'    && <ViewFeedback/>}
          {view === 'support'     && <ViewSupport/>}
        </div>
      </div>

      {/* ── Mobile Bottom Nav ── */}
      {showMoreDrawer && (
        <div style={{position:'fixed',inset:0,zIndex:49,background:'rgba(0,0,0,0.5)',backdropFilter:'blur(4px)'}} className="md:hidden" onClick={()=>setShowMoreDrawer(false)}/>
      )}
      <nav className="md:hidden" style={{position:'fixed',bottom:0,left:0,right:0,zIndex:50,background:T.sidebar,borderTop:`1px solid ${T.border}`,paddingBottom:'env(safe-area-inset-bottom)'}}>
        {/* More drawer — slides up */}
        {showMoreDrawer && (
          <div style={{background:T.sidebar,borderTop:`1px solid ${T.border}`,padding:'8px 0 4px'}}>
            {([
              {id:'agents' as View,icon:'🤖',label:'Agents'},
              {id:'docs'   as View,icon:'📁',label:'Docs'},
              {id:'done'   as View,icon:'✅',label:'Done For You'},
              {id:'feedback' as View,icon:'💬',label:'Feedback'},
              {id:'support'  as View,icon:'🆘',label:'Support'},
            ] as {id:View;icon:string;label:string}[]).map(n=>(
              <button key={n.id} onClick={()=>{setView(n.id);setShowMoreDrawer(false)}}
                style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 24px',background:view===n.id?T.sideAct:'none',border:'none',cursor:'pointer',color:view===n.id?T.gold:T.textmd,fontSize:15,fontFamily:FONT,textAlign:'left'}}>
                <span style={{fontSize:20,width:26,textAlign:'center'}}>{n.icon}</span>
                <span style={{fontWeight:view===n.id?600:400}}>{n.label}</span>
              </button>
            ))}
            <div style={{borderTop:`1px solid ${T.border}`,margin:'6px 0'}}/>
            <button onClick={()=>{setActivePanel(p=>p==='history'?null:'history');setShowMoreDrawer(false)}}
              style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 24px',background:'none',border:'none',cursor:'pointer',color:T.textmd,fontSize:15,fontFamily:FONT}}>
              <span style={{fontSize:20,width:26,textAlign:'center'}}>📝</span>
              <span>Chat History</span>
            </button>
            <div style={{display:'flex',alignItems:'center',gap:14,padding:'8px 24px 12px'}}>
              <span style={{fontSize:20,width:26,textAlign:'center'}}>{dark?'🌙':'☀️'}</span>
              <span style={{fontSize:15,color:T.textmd,flex:1}}>{dark?'Dark':'Light'} mode</span>
              <Toggle on={dark} onChange={()=>setDark(d=>!d)}/>
            </div>
            <div style={{borderTop:`1px solid ${T.border}`,margin:'4px 0'}}/>
            <button onClick={()=>{if(typeof window!=='undefined'){localStorage.clear();window.location.href='/'}}}
              style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'13px 24px 16px',background:'none',border:'none',cursor:'pointer',color:T.red,fontSize:15,fontFamily:FONT}}>
              <span style={{fontSize:20,width:26,textAlign:'center'}}>🚪</span>
              <span>Sign Out</span>
            </button>
          </div>
        )}
        {/* 5-tab bar */}
        <div style={{display:'flex',alignItems:'stretch',height:56}}>
          {([
            {id:'chat'        as View,icon:'💬',label:'Chat'},
            {id:'dashboard'   as View,icon:'#', label:'Dashboard'},
            {id:'connections' as View,icon:'🔌',label:'Connect'},
            {id:'workflows'   as View,icon:'⚙', label:'Workflows'},
          ] as {id:View;icon:string;label:string}[]).map(n=>(
            <button key={n.id} onClick={()=>{setView(n.id);setShowMoreDrawer(false)}}
              style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,background:'none',border:'none',cursor:'pointer',color:view===n.id&&!showMoreDrawer?T.gold:T.textdim,padding:'6px 2px',transition:'color 0.15s',WebkitTapHighlightColor:'transparent'}}>
              <span style={{fontSize:n.icon==='#'||n.icon==='⚙'?17:20,lineHeight:1,fontWeight:n.icon==='#'||n.icon==='⚙'?700:400}}>{n.icon}</span>
              <span style={{fontSize:10,fontWeight:view===n.id&&!showMoreDrawer?700:400,letterSpacing:'0.01em'}}>{n.label}</span>
              {view===n.id&&!showMoreDrawer&&<div style={{position:'absolute',bottom:0,width:24,height:2,background:T.gold,borderRadius:1}}/>}
            </button>
          ))}
          <button onClick={()=>setShowMoreDrawer(m=>!m)}
            style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,background:'none',border:'none',cursor:'pointer',color:showMoreDrawer?T.gold:T.textdim,padding:'6px 2px',transition:'color 0.15s',WebkitTapHighlightColor:'transparent'}}>
            <span style={{fontSize:18,lineHeight:1}}>☰</span>
            <span style={{fontSize:10,fontWeight:showMoreDrawer?700:400}}>More</span>
            {showMoreDrawer&&<div style={{position:'absolute',bottom:0,width:24,height:2,background:T.gold,borderRadius:1}}/>}
          </button>
        </div>
      </nav>

      <style>{`
        @keyframes throb { 0%,100%{opacity:0.15;transform:scale(0.7)} 50%{opacity:1;transform:scale(1)} }
        @keyframes spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        textarea::placeholder { color:${T.textdim}; }
        input::placeholder    { color:${T.textdim}; }
        ::-webkit-scrollbar        { width:4px; }
        ::-webkit-scrollbar-track  { background:transparent; }
        ::-webkit-scrollbar-thumb  { background:${T.divider}; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:${T.goldbrdr}; }
        * { box-sizing:border-box; }
        details summary::-webkit-details-marker { display:none; }
        .qa-grid { grid-template-columns: repeat(3,1fr); }
        .stats-grid { grid-template-columns: repeat(4,1fr); }
        .dash-two-col { grid-template-columns: 1fr 1fr; }
        .agents-grid { grid-template-columns: repeat(2,1fr); }
        .docs-folders { grid-template-columns: repeat(3,1fr); }
        .avail-grid { grid-template-columns: repeat(2,1fr); }
        .support-cards { grid-template-columns: 1fr 1fr; }
        /* mobile: add bottom padding to all non-chat scrolling views */
        @media(max-width:767px){
          .qa-grid          { grid-template-columns:1fr 1fr !important; }
          .stats-grid       { grid-template-columns:1fr 1fr !important; }
          .dash-two-col     { grid-template-columns:1fr !important; }
          .agents-grid      { grid-template-columns:1fr !important; }
          .docs-folders     { grid-template-columns:1fr 1fr !important; }
          .avail-grid       { grid-template-columns:1fr !important; }
          .support-cards    { grid-template-columns:1fr !important; }
          .view-scroll      { padding-bottom:56px; }
          .compose-area     { padding-bottom:calc(56px + max(14px, env(safe-area-inset-bottom))) !important; }
          .compose-inner    { padding-left:12px !important; padding-right:12px !important; }
          .chat-thread-inner{ padding:16px 12px 16px !important; }
          .skill-chips      { padding-bottom: 4px !important; }
          .wf-header        { flex-direction:column; align-items:flex-start !important; gap:10px !important; }
          .agents-header    { flex-direction:column; align-items:flex-start !important; gap:10px !important; }
          .docs-header      { flex-direction:column; align-items:flex-start !important; gap:10px !important; }
          .view-pad         { padding:20px 14px 80px !important; }
          .dash-pad         { padding:20px 14px 80px !important; }
        }
      `}</style>
    </div>
  )
}
