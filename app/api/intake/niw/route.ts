import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { generateI140PDF } from '@/lib/pdf/i140'

const client = new Anthropic()

export const maxDuration = 60

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() })
}

export async function POST(req: NextRequest) {
  let data: Record<string, string> = {}
  try { data = await req.json() } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: cors() })
  }

  const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown Client'

  // Process in background — respond to client immediately
  processIntake(data, name).catch(e => console.error('Intake error:', e))

  return NextResponse.json({ ok: true, name }, { headers: cors() })
}

// ─── PIPELINE ───────────────────────────────────────────────────────────────
async function processIntake(data: Record<string, string>, name: string) {
  // Step 1: Assessment
  const assessment = await runAssessment(data, name).catch(e => {
    console.error('Assessment failed:', e)
    return null
  })

  if (!assessment) {
    // Send raw intake email only if assessment fails completely
    await sendRawIntakeEmail(name, data).catch(console.error)
    return
  }

  // Step 2: Generate both PDFs
  const [pdf1, pdf2] = await Promise.all([
    generateAssessmentPDF(name, data, assessment).catch(e => { console.error('PDF1 failed:', e); return null }),
    generateI140PDF(name, data).catch(e => { console.error('PDF2 failed:', e); return null }),
  ])

  // Step 3: Send email with both PDFs
  await sendEmail(name, data, assessment, pdf1, pdf2).catch(console.error)
}

// ─── CLAUDE ASSESSMENT ───────────────────────────────────────────────────────
async function runAssessment(data: Record<string, string>, name: string): Promise<Record<string, unknown>> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',  // use sonnet for reliability
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are a U.S. immigration attorney. Analyze this EB-2 NIW intake and return ONLY valid JSON (no markdown).

CLIENT: ${name} | ${data.citizenship || data.birth_country || ''} | ${data.current_status || 'Outside U.S.'}
EB-2 BASIS: ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}
DEGREE: ${data.degree_type_0 || 'N/A'} in ${data.field_0 || 'N/A'} from ${data.university_0 || 'N/A'} (${data.grad_year_0 || 'N/A'})
ROLE: ${data.job_title_0 || 'N/A'} at ${data.employer_0 || 'N/A'} | Salary: ${data.salary_0 || 'N/A'}
PRONG1: ${(data.endeavor || 'N/A').slice(0, 300)} | Field: ${data.field_of_work || 'N/A'}
PRONG2: Pubs: ${data.publications || 'None'} | Citations: ${data.citations || '0'} | Awards: ${data.awards || 'None'} | Patents: ${data.patents || 'None'}
PRONG3: ${(data.national_benefit || 'N/A').slice(0, 200)} | Employer: ${data.has_employer || 'N/A'}

Return this JSON:
{"overall_score":0,"overall_verdict":"NEEDS DEVELOPMENT","summary":"...","prong1":{"score":0,"verdict":"WEAK","analysis":"...","strengths":[],"gaps":[]},"prong2":{"score":0,"verdict":"WEAK","analysis":"...","strengths":[],"gaps":[]},"prong3":{"score":0,"verdict":"WEAK","analysis":"...","strengths":[],"gaps":[]},"priority_actions":[{"priority":"HIGH","title":"...","action":"..."}],"recommendation":"...","estimated_weeks":12}`
    }]
  })

  const raw = (msg.content[0] as { text: string }).text.trim()
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON returned')
  return JSON.parse(match[0])
}

// ─── PDF 1: ASSESSMENT REPORT ────────────────────────────────────────────────
async function generateAssessmentPDF(name: string, data: Record<string, string>, a: Record<string, unknown>): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit')
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 55, size: 'LETTER', autoFirstPage: true })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const navy = '#0F2347', gold = '#B8963E', W = 502

      // Header
      doc.rect(0, 0, 612, 62).fill(navy)
      doc.fillColor(gold).fontSize(16).font('Helvetica-Bold').text('MZS LAW FIRM', 55, 16)
      doc.fillColor('white').fontSize(9).font('Helvetica').text('EB-2 NIW Case Assessment Report — Confidential', 55, 36)
      doc.fillColor('#aaa').fontSize(7).text(`${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })} · AI-Generated · For attorney review only`, 55, 50)

      let y = 76

      // Score card
      const score = (a.overall_score as number) || 0
      const sc = score >= 75 ? '#16a34a' : score >= 55 ? '#b45309' : '#dc2626'
      doc.rect(55, y, W, 30).fill('#F5F1EA')
      doc.fillColor(navy).fontSize(13).font('Helvetica-Bold').text(name, 64, y + 9)
      doc.fillColor(sc).fontSize(22).font('Helvetica-Bold').text(String(score), 520, y + 4, { width: 35, align: 'right' })
      doc.fillColor('#999').fontSize(7).font('Helvetica').text('/100', 520, y + 22, { width: 35, align: 'right' })
      y += 38

      doc.fillColor(sc).fontSize(10).font('Helvetica-Bold').text(String(a.overall_verdict || ''), 55, y)
      doc.fillColor('#666').fontSize(8.5).font('Helvetica').text(
        `   ·   ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}   ·   ${data.citizenship || data.birth_country || ''}   ·   ${data.current_status || 'Outside U.S.'}`, 55, y
      )
      y += 14
      doc.fillColor('#333').fontSize(8.5).font('Helvetica').text(String(a.summary || ''), 55, y, { width: W, lineGap: 3 })
      y = doc.y + 14

      // Prongs
      doc.rect(55, y, W, 14).fill(navy)
      doc.fillColor(gold).fontSize(7.5).font('Helvetica-Bold').text('NIW THREE-PRONG ANALYSIS  ·  Matter of Dhanasar (2016)', 62, y + 3)
      y += 18

      for (const [i, { key, title }] of [
        { key: 'prong1', title: 'Substantial Merit & National Importance' },
        { key: 'prong2', title: 'Well Positioned to Advance the Endeavor' },
        { key: 'prong3', title: 'National Interest Waiver Justification' },
      ].entries()) {
        if (y > 680) { doc.addPage(); y = 55 }
        const p = (a[key] as Record<string, unknown>) || {}
        const ps = (p.score as number) || 0
        const pv = String(p.verdict || 'WEAK').toUpperCase()
        const pc = pv === 'STRONG' ? '#16a34a' : pv === 'WEAK' ? '#dc2626' : '#b45309'

        doc.rect(55, y, W, 17).fill('#F0EBE0')
        doc.fillColor(gold).fontSize(6.5).font('Helvetica-Bold').text(`PRONG ${i+1}`, 62, y + 5)
        doc.fillColor(navy).fontSize(8.5).font('Helvetica-Bold').text(title, 106, y + 5)
        doc.fillColor(pc).fontSize(8).font('Helvetica-Bold').text(`${pv}  ·  ${ps}/100`, 400, y + 5, { width: 110, align: 'right' })
        y += 19
        doc.rect(55, y, W, 4).fill('#EEEEEE')
        doc.rect(55, y, W * (ps / 100), 4).fill(pc)
        y += 8
        doc.fillColor('#333').fontSize(8).font('Helvetica').text(String(p.analysis || ''), 55, y, { width: W, lineGap: 2 })
        y = doc.y + 4

        for (const s of (p.strengths as string[]) || []) {
          doc.fillColor('#16a34a').fontSize(8).font('Helvetica-Bold').text('✓', 55, y)
          doc.fillColor('#333').fontSize(8).font('Helvetica').text(s, 68, y, { width: W - 13 }); y = doc.y + 2
        }
        for (const g of (p.gaps as string[]) || []) {
          doc.fillColor('#b45309').fontSize(8).font('Helvetica-Bold').text('⚠', 55, y)
          doc.fillColor('#555').fontSize(8).font('Helvetica').text(g, 68, y, { width: W - 13 }); y = doc.y + 2
        }
        y += 8
      }

      // Actions
      if (y > 650) { doc.addPage(); y = 55 }
      doc.rect(55, y, W, 14).fill(navy)
      doc.fillColor(gold).fontSize(7.5).font('Helvetica-Bold').text('PRIORITY ACTIONS BEFORE FILING', 62, y + 3)
      y += 18
      for (const act of (a.priority_actions as Array<Record<string, string>>) || []) {
        if (y > 700) { doc.addPage(); y = 55 }
        const hi = act.priority === 'HIGH'
        doc.rect(55, y, 3, 12).fill(hi ? '#dc2626' : '#3b82f6')
        doc.fillColor(hi ? '#dc2626' : '#3b82f6').fontSize(6.5).font('Helvetica-Bold').text(act.priority, 63, y + 2)
        doc.fillColor(navy).fontSize(8).font('Helvetica-Bold').text(act.title || '', 100, y + 2)
        y += 13
        doc.fillColor('#444').fontSize(7.5).font('Helvetica').text(act.action || '', 63, y, { width: W - 8, lineGap: 2 })
        y = doc.y + 6
      }

      // Recommendation
      if (y > 650) { doc.addPage(); y = 55 }
      y += 4
      doc.rect(55, y, W, 13).fill(navy)
      doc.fillColor(gold).fontSize(7.5).font('Helvetica-Bold').text('ATTORNEY STRATEGIC RECOMMENDATION', 62, y + 3)
      y += 17
      doc.fillColor('#222').fontSize(8.5).font('Helvetica').text(String(a.recommendation || ''), 55, y, { width: W, lineGap: 3 })
      y = doc.y + 6
      doc.fillColor('#888').fontSize(7.5).font('Helvetica').text(`Estimated timeline to filing: ${(a.estimated_weeks as number) || 12} weeks`, 55, y)

      doc.end()
    } catch (e) { reject(e) }
  })
}

// ─── EMAIL WITH BOTH PDFs ────────────────────────────────────────────────────
async function sendEmail(
  name: string, data: Record<string, string>,
  a: Record<string, unknown>, pdf1: Buffer | null, pdf2: Buffer | null
) {
  const { getAuthedClient } = await import('@/lib/google')
  const { google } = await import('googleapis')
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const score = (a.overall_score as number) || 0
  const sc = score >= 75 ? '#16a34a' : score >= 55 ? '#b45309' : '#dc2626'
  const subject = `NIW Intake: ${name} — ${a.overall_verdict || ''} (${score}/100)`

  const prongHtml = ['prong1','prong2','prong3'].map((pk, i) => {
    const p = (a[pk] as Record<string, unknown>) || {}
    const pv = String(p.verdict || '').toUpperCase()
    const pc = pv === 'STRONG' ? '#16a34a' : pv === 'WEAK' ? '#dc2626' : '#b45309'
    return `<div style="border:1px solid #ddd4c0;border-radius:6px;padding:12px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
        <strong style="color:#0F2347;font-size:0.88rem;">Prong ${i+1}: ${['Substantial Merit & National Importance','Well Positioned to Advance','National Interest Waiver'][i]}</strong>
        <span style="background:${pc};color:#fff;padding:2px 9px;border-radius:12px;font-size:0.7rem;font-family:monospace;">${pv} · ${p.score}/100</span>
      </div>
      <p style="color:#444;font-size:0.83rem;line-height:1.55;margin:0;">${p.analysis || ''}</p>
    </div>`
  }).join('')

  const html = `<div style="font-family:Georgia,serif;max-width:660px;margin:0 auto;color:#1a2035;">
  <div style="background:#0F2347;padding:20px 26px;border-radius:8px 8px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1.15rem;">MZS Law Firm — New EB-2 NIW Client Intake</h2>
    <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:0.78rem;font-family:monospace;">AI Assessment + USCIS I-140 Pre-Fill${pdf1 && pdf2 ? ' — 2 PDFs attached' : pdf1 ? ' — Assessment PDF attached' : pdf2 ? ' — I-140 PDF attached' : ' — see data below'}</p>
  </div>
  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:22px 26px;border-radius:0 0 8px 8px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:0.86rem;">
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;width:36%;">Client</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${name}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Email</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${data.email || '—'}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Phone</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${data.phone || '—'}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Country</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${data.citizenship || data.birth_country || '—'}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Current Status</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${data.current_status || 'Not in U.S.'}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">EB-2 Basis</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Degree</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${[data.degree_type_0, data.field_0, data.university_0, data.grad_year_0].filter(Boolean).join(' · ') || '—'}</td></tr>
      <tr><td style="padding:6px 9px;background:#f5f1ea;font-weight:700;color:#0F2347;">Field of Work</td><td style="padding:6px 9px;border:1px solid #ede5d6;">${data.field_of_work || '—'}</td></tr>
    </table>
    <div style="background:#0F2347;border-radius:6px;padding:16px;margin-bottom:16px;">
      <span style="font-size:1.8rem;font-weight:700;color:${sc};font-family:monospace;">${score}</span>
      <span style="color:rgba(255,255,255,0.35);font-size:0.8rem;">/100  </span>
      <span style="color:#B8963E;font-weight:700;font-family:monospace;font-size:0.9rem;">${a.overall_verdict || ''}</span>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:0.85rem;line-height:1.6;">${a.summary || ''}</p>
    </div>
    ${prongHtml}
    <div style="background:#fffbf0;border:1px solid #e8d9a0;border-radius:6px;padding:12px;margin-top:12px;">
      <strong style="color:#7a5c1e;font-size:0.85rem;">⚖️ Attorney Recommendation</strong>
      <p style="color:#5a4a2a;font-size:0.83rem;line-height:1.6;margin:6px 0 0;">${a.recommendation || ''}</p>
    </div>
    <p style="margin-top:16px;font-size:0.72rem;color:#aaa;font-family:monospace;border-top:1px solid #ede5d6;padding-top:10px;">
      📎 PDF 1: Case Assessment Report${!pdf1 ? ' (failed to generate)' : ''}<br/>
      📎 PDF 2: USCIS Form I-140 Pre-Fill (Rev. 11/09/23)${!pdf2 ? ' (failed to generate)' : ''}<br/>
      Nexter Studio AI · MZS Law Firm · Confidential · Not legal advice
    </p>
  </div>
</div>`

  const boundary = `niw_${Date.now()}`
  const parts = [
    `To: info@i-review.ai`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
    ``,
  ]

  if (pdf1) {
    const safeName = name.replace(/\s+/g, '-')
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeName}-NIW-Assessment.pdf"`,
      ``,
      pdf1.toString('base64'),
      ``,
    )
  }
  if (pdf2) {
    const safeName = name.replace(/\s+/g, '-')
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeName}-I140-PreFill.pdf"`,
      ``,
      pdf2.toString('base64'),
      ``,
    )
  }

  parts.push(`--${boundary}--`)
  const raw = Buffer.from(parts.join('\r\n')).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

// ─── FALLBACK: raw intake email when assessment fails ────────────────────────
async function sendRawIntakeEmail(name: string, data: Record<string, string>) {
  const { getAuthedClient } = await import('@/lib/google')
  const { google } = await import('googleapis')
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  let body = `New EB-2 NIW intake received — AI assessment could not run.\n\nClient: ${name}\n\n`
  for (const [k, v] of Object.entries(data)) {
    if (v) body += `${k}: ${v}\n`
  }

  const raw = Buffer.from([
    `To: info@i-review.ai`,
    `Subject: NIW Intake (manual review needed): ${name}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join('\r\n')).toString('base64url')

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}
