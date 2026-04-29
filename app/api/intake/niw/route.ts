import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}

export const maxDuration = 60 // Vercel Pro: 60s timeout

export async function POST(req: NextRequest) {
  let data: Record<string, string> = {}
  try {
    data = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: corsHeaders() })
  }

  const name = `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Unknown Client'

  // Respond to client immediately — processing happens after
  const responsePromise = processIntake(data, name)

  // Use waitUntil pattern if available, otherwise await directly
  try {
    await responsePromise
  } catch (err) {
    console.error('Intake processing error:', err)
    // Still return ok to client — don't fail their submission over server errors
  }

  return NextResponse.json({ ok: true, name }, { headers: corsHeaders() })
}

async function processIntake(data: Record<string, string>, name: string) {
  // Step 1: Claude assessment (always run)
  let assessment: Record<string, unknown> = {}
  try {
    assessment = await runAssessment(data, name)
  } catch (err) {
    console.error('Assessment failed:', err)
    assessment = {
      overall_score: 0,
      overall_verdict: 'ASSESSMENT PENDING',
      summary: 'AI assessment could not be completed. Attorney review required.',
      prong1: { score: 0, verdict: 'PENDING', analysis: 'Manual review required.', strengths: [], gaps: [] },
      prong2: { score: 0, verdict: 'PENDING', analysis: 'Manual review required.', strengths: [], gaps: [] },
      prong3: { score: 0, verdict: 'PENDING', analysis: 'Manual review required.', strengths: [], gaps: [] },
      priority_actions: [],
      recommendation: 'Attorney review required.',
      estimated_weeks: 12,
    }
  }

  // Step 2: Generate PDF (optional — fall back to email-only if it fails)
  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await generatePDF(name, data, assessment)
  } catch (err) {
    console.error('PDF generation failed, will send email without attachment:', err)
  }

  // Step 3: Send email (always run)
  try {
    await sendEmail(name, data, assessment, pdfBuffer)
  } catch (err) {
    console.error('Email send failed:', err)
  }
}

// ─── CLAUDE ASSESSMENT ─────────────────────────────────────────────────────
async function runAssessment(data: Record<string, string>, name: string): Promise<Record<string, unknown>> {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `You are a U.S. immigration attorney specializing in EB-2 NIW petitions.
Analyze this intake and return ONLY valid JSON — no markdown, no explanation.

CLIENT: ${name}
DOB: ${data.dob || 'N/A'} | Country: ${data.birth_country || 'N/A'} | Citizenship: ${data.citizenship || 'N/A'}
EB-2 Basis: ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}
Degree: ${data.degree_type_0 || 'N/A'} in ${data.field_0 || 'N/A'} from ${data.university_0 || 'N/A'} (${data.grad_year_0 || 'N/A'})
Role: ${data.job_title_0 || 'N/A'} at ${data.employer_0 || 'N/A'} | Salary: ${data.salary_0 || 'N/A'}

PRONG 1: ${data.endeavor || 'N/A'} | Field: ${data.field_of_work || 'N/A'} | National Importance: ${data.national_importance || 'N/A'}
PRONG 2: Publications: ${data.publications || 'None'} | Citations: ${data.citations || '0'} | Awards: ${data.awards || 'None'} | Patents: ${data.patents || 'None'} | Talks: ${data.talks || 'None'}
PRONG 3: Has employer: ${data.has_employer || 'N/A'} | Waiver reason: ${data.waiver_reason || 'N/A'} | National benefit: ${data.national_benefit || 'N/A'}
Status: ${data.current_status || 'N/A'} | Docs ready: ${data.checked_items || 'None'}

Return exactly:
{"overall_score":<0-100>,"overall_verdict":"<STRONG CASE|VIABLE CASE|NEEDS DEVELOPMENT>","summary":"<3 sentences>","prong1":{"score":<0-100>,"verdict":"<STRONG|MODERATE|WEAK>","analysis":"<2 sentences>","strengths":["..."],"gaps":["..."]},"prong2":{"score":<0-100>,"verdict":"<STRONG|MODERATE|WEAK>","analysis":"<2 sentences>","strengths":["..."],"gaps":["..."]},"prong3":{"score":<0-100>,"verdict":"<STRONG|MODERATE|WEAK>","analysis":"<2 sentences>","strengths":["..."],"gaps":["..."]},"priority_actions":[{"priority":"HIGH","title":"<title>","action":"<step>"},{"priority":"HIGH","title":"<title>","action":"<step>"},{"priority":"MEDIUM","title":"<title>","action":"<step>"}],"recommendation":"<3 sentences>","estimated_weeks":<8-20>}`
    }]
  })

  const raw = (msg.content[0] as { text: string }).text.trim()
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in assessment response')
  return JSON.parse(match[0])
}

// ─── PDF GENERATION ────────────────────────────────────────────────────────
async function generatePDF(name: string, data: Record<string, string>, a: Record<string, unknown>): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit')

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 55, size: 'A4', autoFirstPage: true })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const navy = '#0F2347'
      const gold = '#B8963E'
      const pageW = 485

      // ── PAGE 1: ASSESSMENT ──
      doc.rect(0, 0, 595, 65).fill(navy)
      doc.fillColor(gold).fontSize(17).font('Helvetica-Bold').text('MZS LAW FIRM', 55, 18)
      doc.fillColor('white').fontSize(9).font('Helvetica').text('EB-2 NIW Case Assessment Report', 55, 38)
      doc.fillColor('#aaa').fontSize(7.5).text(`Prepared: ${new Date().toLocaleString('en-US')} · Confidential`, 55, 51)

      let y = 80

      // Score card
      const score = (a.overall_score as number) || 0
      const sc = score >= 75 ? '#16a34a' : score >= 55 ? '#b45309' : '#dc2626'
      doc.rect(55, y, pageW, 32).fill('#F5F1EA')
      doc.fillColor(navy).fontSize(13).font('Helvetica-Bold').text(name, 65, y + 9)
      doc.fillColor(sc).fontSize(20).font('Helvetica-Bold').text(String(score), 460, y + 4, { width: 70, align: 'right' })
      doc.fillColor('#888').fontSize(7).font('Helvetica').text('/100', 462, y + 23, { width: 70, align: 'right' })
      y += 40

      doc.fillColor(sc).fontSize(10).font('Helvetica-Bold').text(String(a.overall_verdict || ''), 55, y)
      doc.fillColor('#666').fontSize(9).font('Helvetica')
        .text(`  ·  ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}  ·  ${data.citizenship || data.birth_country || ''}  ·  ${data.current_status || 'Outside U.S.'}`, 55, y)
      y += 14
      doc.fillColor('#333').fontSize(8.5).font('Helvetica')
        .text(String(a.summary || ''), 55, y, { width: pageW, lineGap: 3 })
      y = doc.y + 16

      // Prong Analysis
      doc.rect(55, y, pageW, 15).fill(navy)
      doc.fillColor(gold).fontSize(8).font('Helvetica-Bold').text('NIW THREE-PRONG ANALYSIS  —  Matter of Dhanasar (2016)', 62, y + 4)
      y += 19

      const prongs = [
        { key: 'prong1', num: '1', title: 'Substantial Merit & National Importance' },
        { key: 'prong2', num: '2', title: 'Well Positioned to Advance the Endeavor' },
        { key: 'prong3', num: '3', title: 'National Interest Waiver Justification' },
      ]
      for (const { key, num, title } of prongs) {
        if (y > 700) { doc.addPage(); y = 55 }
        const p = (a[key] as Record<string, unknown>) || {}
        const ps = (p.score as number) || 0
        const pv = String(p.verdict || 'MODERATE').toUpperCase()
        const pc = pv === 'STRONG' ? '#16a34a' : pv === 'WEAK' ? '#dc2626' : '#b45309'

        doc.rect(55, y, pageW, 18).fill('#F0EBE0')
        doc.fillColor(gold).fontSize(7).font('Helvetica-Bold').text(`PRONG ${num}`, 62, y + 5)
        doc.fillColor(navy).fontSize(8.5).font('Helvetica-Bold').text(title, 110, y + 5)
        doc.fillColor(pc).fontSize(8).font('Helvetica-Bold').text(`${pv} · ${ps}/100`, 380, y + 5, { width: 110, align: 'right' })
        y += 20
        doc.rect(55, y, pageW, 4).fill('#EEEEEE')
        doc.rect(55, y, pageW * (ps / 100), 4).fill(pc)
        y += 8
        doc.fillColor('#333').fontSize(8).font('Helvetica')
          .text(String(p.analysis || ''), 55, y, { width: pageW, lineGap: 2 })
        y = doc.y + 4

        for (const s of (p.strengths as string[]) || []) {
          doc.fillColor('#16a34a').fontSize(8).font('Helvetica-Bold').text('✓', 55, y)
          doc.fillColor('#333').fontSize(8).font('Helvetica').text(s, 68, y, { width: pageW - 13 })
          y = doc.y + 2
        }
        for (const g of (p.gaps as string[]) || []) {
          doc.fillColor('#b45309').fontSize(8).font('Helvetica-Bold').text('⚠', 55, y)
          doc.fillColor('#555').fontSize(8).font('Helvetica').text(g, 68, y, { width: pageW - 13 })
          y = doc.y + 2
        }
        y += 8
      }

      // Priority Actions
      if (y > 650) { doc.addPage(); y = 55 }
      doc.rect(55, y, pageW, 15).fill(navy)
      doc.fillColor(gold).fontSize(8).font('Helvetica-Bold').text('PRIORITY ACTIONS BEFORE FILING', 62, y + 4)
      y += 19

      for (const act of (a.priority_actions as Array<Record<string, string>>) || []) {
        if (y > 700) { doc.addPage(); y = 55 }
        const isHigh = act.priority === 'HIGH'
        doc.rect(55, y, 3, 12).fill(isHigh ? '#dc2626' : '#3b82f6')
        doc.fillColor(isHigh ? '#dc2626' : '#3b82f6').fontSize(7).font('Helvetica-Bold').text(act.priority, 63, y + 1)
        doc.fillColor(navy).fontSize(8).font('Helvetica-Bold').text(act.title || '', 100, y + 1)
        y += 13
        doc.fillColor('#444').fontSize(7.5).font('Helvetica').text(act.action || '', 63, y, { width: pageW - 8, lineGap: 2 })
        y = doc.y + 7
      }

      // Recommendation
      if (y > 660) { doc.addPage(); y = 55 }
      y += 4
      doc.rect(55, y, pageW, 14).fill(navy)
      doc.fillColor(gold).fontSize(8).font('Helvetica-Bold').text('ATTORNEY STRATEGIC RECOMMENDATION', 62, y + 3)
      y += 18
      doc.fillColor('#222').fontSize(8.5).font('Helvetica')
        .text(String(a.recommendation || ''), 55, y, { width: pageW, lineGap: 3 })
      y = doc.y + 8
      doc.fillColor('#888').fontSize(7.5).font('Helvetica')
        .text(`Estimated preparation timeline: ${(a.estimated_weeks as number) || 12} weeks`, 55, y)

      // ── PAGE 2: I-140 PRE-FILL ──
      doc.addPage()
      y = 0
      doc.rect(0, 0, 595, 58).fill(navy)
      doc.fillColor(gold).fontSize(15).font('Helvetica-Bold').text('USCIS FORM I-140 — PRE-FILL DATA EXTRACT', 55, 14)
      doc.fillColor('white').fontSize(8.5).font('Helvetica').text('Immigrant Petition for Alien Workers · EB-2 National Interest Waiver · For attorney review before filing', 55, 34)
      doc.fillColor('#888').fontSize(7.5).text('All fields must be verified against official documents. This extract does not constitute a filed petition.', 55, 47)
      y = 68

      doc.rect(55, y, pageW, 20).fill('#FFFBF0').stroke('#E8D9A0')
      doc.fillColor('#7a5c1e').fontSize(7.5).font('Helvetica-Bold')
        .text('ATTORNEY NOTE: Verify all pre-filled fields against official documents before filing with USCIS. Filing fee: $1,300 base ($700 I-140 + $600 Asylum Program Fee). Optional premium processing: $2,805.', 62, y + 4, { width: pageW - 14 })
      y += 28

      const i140Section = (title: string) => {
        doc.rect(55, y, pageW, 13).fill('#E8E2D4')
        doc.fillColor(navy).fontSize(7.5).font('Helvetica-Bold').text(title, 62, y + 3)
        y += 15
      }

      const i140Row = (label: string, value: string, highlight = false) => {
        if (y > 760) { doc.addPage(); y = 55 }
        doc.rect(55, y, pageW, 14).fill(highlight ? '#E8F5E9' : '#FAFAF7').stroke('#DDD4C0')
        doc.fillColor('#888').fontSize(6.5).font('Helvetica').text(label, 62, y + 3)
        doc.fillColor(highlight ? '#166534' : navy).fontSize(8).font('Helvetica-Bold')
          .text(value || '—', 220, y + 3, { width: pageW - 170 })
        y += 15
      }

      i140Section('PART 1 — PETITION TYPE')
      i140Row('Visa Classification', 'EB-2 — Members of Professions Holding Advanced Degrees or Persons of Exceptional Ability', true)
      i140Row('Petition Basis', 'National Interest Waiver (NIW) — 8 CFR § 204.5(k)(4) — Self-Petition', true)
      i140Row('Job Offer Required', 'NO — Waived. NIW exempts petitioner from job offer requirement.', true)
      i140Row('Labor Certification (PERM)', 'NOT REQUIRED — National Interest Waiver exception applies', true)

      y += 4
      i140Section('PART 2 — PETITIONER  (Self-Petition for NIW — Petitioner = Beneficiary)')
      i140Row('Legal Name', name)
      i140Row('Petitioner Type', 'Individual Self-Petitioner — Alien files on own behalf under NIW')
      i140Row('Federal Employer ID (FEIN)', 'N/A — Individual self-petition, no employer required')

      y += 4
      i140Section('PART 3 — BENEFICIARY INFORMATION  (I-140 Part 3 Fields)')
      i140Row('3.1  Family Name (Last)', data.last_name || '')
      i140Row('3.2  Given Name (First)', data.first_name || '')
      i140Row('3.3  Middle Name', data.middle_name || 'N/A')
      i140Row('3.4  Other Names Used (maiden, alias)', data.other_names || 'None')
      i140Row('3.5  Current Mailing Address', data.address || '')
      i140Row('3.6  Date of Birth', data.dob || '')
      i140Row('3.7  City / Town of Birth', data.birth_city || '')
      i140Row('3.8  Country of Birth', data.birth_country || '')
      i140Row('3.9  Country of Citizenship / Nationality', data.citizenship || '')
      i140Row('3.10 Alien Registration Number (A-Number)', data.a_number || 'None — not yet assigned')
      i140Row('3.11 Current Immigration Status', data.current_status || 'Not currently in the United States')
      i140Row('3.12 Email Address', data.email || '')
      i140Row('3.13 Daytime Telephone Number', data.phone || '')

      y += 4
      i140Section('PART 5 — PROPOSED EMPLOYMENT')
      i140Row('5.1  Proposed Job Title / Occupation', data.job_title_0 || data.field_of_work || '')
      i140Row('5.2  Current Employer Name', data.employer_0 || '')
      i140Row('5.3  Annual Wage (Current)', data.salary_0 || 'Not specified')
      i140Row('5.4  Employment Type', 'Full Time')
      i140Row('5.5  SOC Occupation Code', 'Attorney to verify per O*NET / BLS')

      y += 4
      i140Section('PART 6 — BENEFICIARY QUALIFICATIONS  (EB-2 Basis)')
      i140Row('EB-2 Pathway', data.eb2_basis === 'advanced_degree' ? 'Advanced Degree (Master\'s, PhD, or Bachelor\'s + 5 yrs)' : 'Exceptional Ability — 3 of 6 USCIS criteria met')
      i140Row('Highest Degree Attained', data.degree_type_0 || 'N/A')
      i140Row('Field of Study', data.field_0 || '')
      i140Row('Institution / University', data.university_0 || '')
      i140Row('Year Degree Conferred', data.grad_year_0 || '')
      i140Row('Proposed Field of Work (NIW)', data.field_of_work || '')
      if (data.ea_criteria) i140Row('Exceptional Ability Criteria Met', data.ea_criteria)
      i140Row('Publications / Citations', data.publications ? `Yes — see evidence package (${data.citations || '?'} citations)` : 'To be documented')
      i140Row('Awards & Recognition', data.awards || 'See evidence package')
      i140Row('Patents', data.patents || 'None listed')

      y += 4
      i140Section('PART 8 — FILING FEES & PROCESSING')
      i140Row('I-140 Filing Fee', '$700.00')
      i140Row('Asylum Program Fee', '$600.00')
      i140Row('Total Base Fee', '$1,300.00  (payable to "U.S. Department of Homeland Security")')
      i140Row('Premium Processing (Optional, Form I-907)', '$2,805.00 — 15 business day adjudication')
      i140Row('Filing Location', 'USCIS Nebraska or Texas Service Center (per petitioner\'s jurisdiction)')
      i140Row('Priority Date', 'Assigned by USCIS upon receipt — petition receipt date becomes priority date')

      // Footer
      doc.fillColor('#bbb').fontSize(6.5).font('Helvetica')
        .text('MZS Law Firm  ·  EB-2 NIW AI Case Assessment  ·  Confidential  ·  For attorney review only  ·  Not legal advice  ·  ' + new Date().toLocaleDateString(), 55, 822, { width: pageW, align: 'center' })

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

// ─── EMAIL ─────────────────────────────────────────────────────────────────
async function sendEmail(name: string, data: Record<string, string>, a: Record<string, unknown>, pdfBuffer: Buffer | null) {
  const { getAuthedClient } = await import('@/lib/google')
  const { google } = await import('googleapis')
  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const score = (a.overall_score as number) || 0
  const sc = score >= 75 ? '#16a34a' : score >= 55 ? '#b45309' : '#dc2626'
  const subject = `NIW Intake: ${name} — Score ${score}/100 · ${a.overall_verdict || ''}`

  const prongs = ['prong1', 'prong2', 'prong3'].map((pk, i) => {
    const p = (a[pk] as Record<string, unknown>) || {}
    const pv = String(p.verdict || '').toUpperCase()
    const pc = pv === 'STRONG' ? '#16a34a' : pv === 'WEAK' ? '#dc2626' : '#b45309'
    return `<div style="border:1px solid #ddd4c0;border-radius:8px;padding:14px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="color:#0F2347;font-size:0.9rem;">Prong ${i+1}: ${['Substantial Merit & National Importance','Well Positioned to Advance','National Interest Waiver'][i]}</strong>
        <span style="background:${pc};color:#fff;padding:2px 10px;border-radius:20px;font-size:0.72rem;font-family:monospace;">${pv} · ${p.score}/100</span>
      </div>
      <p style="color:#444;font-size:0.85rem;line-height:1.6;margin:0;">${p.analysis || ''}</p>
    </div>`
  }).join('')

  const htmlBody = `<div style="font-family:Georgia,serif;max-width:680px;margin:0 auto;color:#1a2035;">
  <div style="background:#0F2347;padding:22px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1.2rem;letter-spacing:0.03em;">MZS LAW FIRM — New EB-2 NIW Intake</h2>
    <p style="color:rgba(255,255,255,0.55);margin:5px 0 0;font-size:0.8rem;font-family:monospace;">AI Case Assessment${pdfBuffer ? ' + I-140 Pre-Fill PDF attached' : ' (PDF unavailable — data below)'}</p>
  </div>
  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:24px 28px;border-radius:0 0 10px 10px;">

    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:0.88rem;">
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;width:38%;">Client Name</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${name}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Email</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${data.email || '—'}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Phone</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${data.phone || '—'}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Country / Citizenship</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${data.citizenship || data.birth_country || '—'}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Current Status</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${data.current_status || 'Not in U.S.'}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">EB-2 Basis</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}</td></tr>
      <tr><td style="padding:7px 10px;background:#f5f1ea;font-weight:700;color:#0F2347;">Field of Work</td><td style="padding:7px 10px;border:1px solid #ede5d6;">${data.field_of_work || '—'}</td></tr>
    </table>

    <div style="background:#0F2347;border-radius:8px;padding:18px;margin-bottom:18px;">
      <span style="font-size:2rem;font-weight:700;color:${sc};font-family:monospace;">${score}</span><span style="color:rgba(255,255,255,0.4);font-size:0.85rem;">/100</span>
      <span style="display:inline-block;margin-left:16px;color:#B8963E;font-weight:700;font-family:monospace;font-size:0.9rem;">${a.overall_verdict || ''}</span>
      <p style="margin:10px 0 0;color:rgba(255,255,255,0.8);font-size:0.88rem;line-height:1.65;">${a.summary || ''}</p>
    </div>

    ${prongs}

    <div style="background:#fffbf0;border:1px solid #e8d9a0;border-radius:8px;padding:14px;margin-top:14px;">
      <strong style="color:#7a5c1e;font-size:0.88rem;">⚖️ Attorney Recommendation</strong>
      <p style="color:#5a4a2a;font-size:0.85rem;line-height:1.6;margin:8px 0 0;">${a.recommendation || ''}</p>
    </div>

    <p style="margin-top:18px;font-size:0.75rem;color:#aaa;font-family:monospace;border-top:1px solid #ede5d6;padding-top:12px;">
      ${pdfBuffer ? '📎 PDF attached: Full assessment + USCIS I-140 pre-fill data' : '⚠ PDF could not be generated — data is in this email'}<br/>
      Generated by Nexter Studio AI · MZS Law Firm · Confidential · Not legal advice
    </p>
  </div>
</div>`

  const boundary = `niw_${Date.now()}`
  const parts: string[] = [
    `To: info@i-review.ai`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    htmlBody,
    ``,
  ]

  if (pdfBuffer) {
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${name.replace(/\s+/g, '-')}-NIW-Assessment.pdf"`,
      ``,
      pdfBuffer.toString('base64'),
      ``,
    )
  }

  parts.push(`--${boundary}--`)

  const raw = Buffer.from(parts.join('\r\n')).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}
