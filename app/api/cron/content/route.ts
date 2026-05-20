/**
 * Content Pipeline — unified daily cron (6:00 AM)
 *
 * Does three things in one pass:
 * 1. DRAFT  — any 'ready' item due within 2 days: generate post copy (Claude)
 *             + image (DALL-E 3), save as draft_ready, email drafts for approval
 * 2. ALERT  — if pipeline has overdue items or fewer than 3 days scheduled
 *             in the next 7: send a sharp alert with one action suggestion
 * 3. SILENT — if pipeline is healthy and no drafts to generate, do nothing
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/google'
import { listContent, updateContent, getContentSummary } from '@/lib/supabase'

function isAuthorized(req: NextRequest) {
  return req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

// ── DALL-E 3 image generation ─────────────────────────────────────────────────

async function generateImage(title: string, type: string, notes: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const promptRes = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Create a DALL-E 3 image prompt for a ${type} post titled "${title}".
Notes: ${notes || 'none'}
The image must be: professional, modern, dark navy (#0F2347) background, gold (#B8963E) accents, abstract/conceptual, no faces, no text, suitable for LinkedIn.
Output ONLY the prompt. Max 150 words.`,
      }],
    })
    const imagePrompt = (promptRes.content[0] as { text: string }).text.trim()

    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt: imagePrompt, n: 1, size: '1024x1024', quality: 'standard', response_format: 'url' }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.data?.[0]?.url as string) || null
  } catch { return null }
}

// ── Claude post copy generation ───────────────────────────────────────────────

async function generatePostCopy(title: string, type: string, notes: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  const platformGuidance = type === 'linkedin'
    ? 'Write for LinkedIn: strong hook in first line, insight or story in middle, soft CTA at end. 150–250 words. Use line breaks for readability. Max 3 relevant hashtags.'
    : `Write for ${type}: engaging, concise, platform-appropriate.`
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are the content writer for Dr. Siamak Goudarzi, Founder of Nexter AI Group.
Write a ${type} post about: "${title}"
${notes ? `Context: ${notes}` : ''}
Voice: direct, confident, thought leader in AI for business. First person. Not salesy.
${platformGuidance}
Write only the post text — no intro, no explanation.`,
    }],
  })
  return (res.content[0] as { text: string }).text.trim()
}

// ── HTML email: draft review ──────────────────────────────────────────────────

function buildDraftEmail(drafts: { title: string; id: string; type: string; text: string; imageUrl: string | null }[]): string {
  const items = drafts.map(d => `
    <tr><td style="padding:20px 0;border-bottom:1px solid #e8e8e8">
      <p style="margin:0 0 4px;font-size:11px;color:#B8963E;font-weight:700;letter-spacing:1px;text-transform:uppercase">${d.type.toUpperCase()}</p>
      <h3 style="margin:0 0 12px;color:#0F2347;font-size:16px">${d.title}</h3>
      ${d.imageUrl ? `<img src="${d.imageUrl}" style="width:100%;max-width:400px;border-radius:6px;margin-bottom:12px;display:block" alt="Generated image">` : '<p style="margin:0 0 12px;font-size:12px;color:#999">No image (OPENAI_API_KEY not set)</p>'}
      <div style="background:#f8f8f8;border-left:3px solid #0F2347;padding:12px 16px;border-radius:0 4px 4px 0;font-size:13px;line-height:1.6;color:#333;white-space:pre-wrap">${d.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      <p style="margin:10px 0 0;font-size:12px;color:#666">To post: tell VA <em>"post content ${d.id}"</em> &nbsp;|&nbsp; To edit: <em>"update content ${d.id} notes [feedback]"</em></p>
    </td></tr>`).join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0">
<tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#0F2347;padding:28px 32px">
    <p style="margin:0;color:#B8963E;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">NEXTER AI GROUP</p>
    <h1 style="margin:8px 0 0;color:#fff;font-size:22px;font-weight:700">✍️ Content Drafts Ready</h1>
    <p style="margin:6px 0 0;color:#8899aa;font-size:13px">${drafts.length} post${drafts.length > 1 ? 's' : ''} waiting for your approval</p>
  </td></tr>
  <tr><td style="padding:24px 32px"><table width="100%" cellpadding="0" cellspacing="0">${items}</table></td></tr>
  <tr><td style="background:#0F2347;padding:16px 32px;text-align:center">
    <p style="margin:0;color:#556677;font-size:11px">Nexter AI VA · Content Pipeline</p>
  </td></tr>
</table></td></tr></table></body></html>`
}

// ── HTML email: pipeline alert ────────────────────────────────────────────────

function buildAlertEmail(alert: string, summary: string, overdue: number, emptySlots: number): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:20px 0">
<tr><td align="center"><table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#0F2347;padding:28px 32px">
    <p style="margin:0;color:#B8963E;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700">NEXTER AI GROUP</p>
    <h1 style="margin:8px 0 0;color:#fff;font-size:22px;font-weight:700">📱 Content Pipeline Alert</h1>
    <p style="margin:6px 0 0;color:#8899aa;font-size:13px">${overdue} overdue · ${emptySlots} empty days next week</p>
  </td></tr>
  <tr><td style="padding:28px 32px;color:#1a1a2e;font-size:14px;line-height:1.7">
    <p style="margin:0 0 20px">${alert.replace(/\n/g,'<br>')}</p>
    <div style="background:#f8f8f8;border-left:3px solid #B8963E;padding:12px 16px;border-radius:0 4px 4px 0;font-size:12px;color:#555;font-family:monospace;white-space:pre-wrap">${summary}</div>
  </td></tr>
  <tr><td style="background:#0F2347;padding:16px 32px;text-align:center">
    <p style="margin:0;color:#556677;font-size:11px">Nexter AI VA · Content Pipeline</p>
  </td></tr>
</table></td></tr></table></body></html>`
}

// ── Send HTML email via Gmail ─────────────────────────────────────────────────

async function sendEmail(subject: string, html: string, plain: string) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) return
  const auth  = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })
  const to    = process.env.BRIEFING_EMAIL || process.env.GOOGLE_ACCOUNT_EMAIL || 'info@i-review.ai'
  const boundary = 'boundary_content_cron'
  const raw = Buffer.from([
    `To: ${to}`,
    `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    plain,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n')).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items  = await listContent()
  const summary = await getContentSummary()

  // ── Phase 1: Draft generation ─────────────────────────────────────────────
  const cutoff = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const readyToDraft = items.filter(i =>
    i.status === 'ready' && (!i.scheduled_date || i.scheduled_date <= cutoff)
  )

  const generatedDrafts: { title: string; id: string; type: string; text: string; imageUrl: string | null }[] = []
  for (const item of readyToDraft) {
    try {
      const [postText, imageUrl] = await Promise.all([
        generatePostCopy(item.title, item.type, item.notes || ''),
        (item.type === 'linkedin' || item.type === 'reel')
          ? generateImage(item.title, item.type, item.notes || '')
          : Promise.resolve(null),
      ])
      await updateContent(item.id!, {
        status: 'draft_ready',
        draft_text: postText,
        draft_image_url: imageUrl || undefined,
      })
      generatedDrafts.push({ title: item.title, id: item.id!, type: item.type, text: postText, imageUrl })
    } catch (err) {
      console.error(`[content-cron] Draft failed for "${item.title}":`, err)
    }
  }

  if (generatedDrafts.length) {
    try {
      const subject = `✍️ ${generatedDrafts.length} Content Draft${generatedDrafts.length > 1 ? 's' : ''} Ready for Review`
      await sendEmail(
        subject,
        buildDraftEmail(generatedDrafts),
        generatedDrafts.map(d => `${d.title}\n\n${d.text}\n\nTo post: tell VA "post content ${d.id}"`).join('\n\n---\n\n')
      )
    } catch (err) { console.error('[content-cron] Draft email error:', err) }
  }

  // ── Phase 2: Pipeline health check ───────────────────────────────────────
  const overdue = items.filter(i =>
    i.scheduled_date && new Date(i.scheduled_date) < new Date() && i.status !== 'published'
  )
  const next7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + 1)
    return d.toISOString().split('T')[0]
  })
  const scheduledDates = items.filter(i => i.status === 'scheduled' || i.status === 'draft_ready').map(i => i.scheduled_date)
  const emptySlots = next7Days.filter(d => !scheduledDates.includes(d)).length

  const pipelineHealthy = !overdue.length && emptySlots < 5 && items.length > 0

  if (pipelineHealthy && !generatedDrafts.length) {
    return NextResponse.json({ ok: true, message: 'Pipeline healthy, nothing to do', items: items.length })
  }

  if (!pipelineHealthy) {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a brief content pipeline alert for Siamak (Founder, Nexter AI Group). Direct, max 4 sentences.
Pipeline: ${summary}
Overdue: ${overdue.length} | Empty days next week: ${emptySlots}
Flag what needs attention and suggest one specific action.`,
        }],
      })
      const alert = (res.content[0] as { text: string }).text
      await sendEmail(
        `📱 Content Pipeline — ${overdue.length} overdue, ${emptySlots} empty slots`,
        buildAlertEmail(alert, summary, overdue.length, emptySlots),
        alert + '\n\n---\n' + summary
      )
    } catch (err) { console.error('[content-cron] Alert email error:', err) }
  }

  return NextResponse.json({
    ok: true,
    drafted: generatedDrafts.length,
    overdue: overdue.length,
    emptySlots,
  })
}
