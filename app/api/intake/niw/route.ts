import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// ─── CORS (questionnaire is hosted on Netlify) ─────────────────────────────
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

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const data = await req.json()
    const name = `${data.first_name || ''} ${data.last_name || ''}`.trim()

    // 1. Claude assessment
    const assessment = await runAssessment(data, name)

    // 2. Generate PDF (assessment + I-140 pre-fill)
    const pdfBuffer = await generatePDF(name, data, assessment)

    // 3. Send email with PDF attachment
    await sendEmailWithPDF(name, data, assessment, pdfBuffer)

    return NextResponse.json({ ok: true, name }, { headers: corsHeaders() })
  } catch (err) {
    console.error('NIW intake error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500, headers: corsHeaders() })
  }
}

// ─── CLAUDE ASSESSMENT ─────────────────────────────────────────────────────
async function runAssessment(data: Record<string, string>, name: string) {
  const prompt = `You are an experienced U.S. immigration attorney specializing in EB-2 NIW petitions.
Analyze this client intake and return ONLY a valid JSON object — no markdown, no explanation.

CLIENT: ${name}
DOB: ${data.dob || 'N/A'} | Country of Birth: ${data.birth_country || 'N/A'} | Citizenship: ${data.citizenship || 'N/A'}
EB-2 Basis: ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}
Degree: ${data.degree_type_0 || 'N/A'} in ${data.field_0 || 'N/A'} from ${data.university_0 || 'N/A'} (${data.grad_year_0 || 'N/A'})
Current Role: ${data.job_title_0 || 'N/A'} at ${data.employer_0 || 'N/A'} | Salary: ${data.salary_0 || 'N/A'} (${data.salary_comp_0 || 'N/A'})

PRONG 1 — Proposed Endeavor: ${data.endeavor || 'N/A'}
Field: ${data.field_of_work || 'N/A'}
National Importance: ${data.national_importance || 'N/A'}
Citations of work: ${data.work_cited || 'N/A'}

PRONG 2 — Evidence:
Publications: ${data.publications || 'None'} | Citations: ${data.citations || '0'} | h-index: ${data.h_index || 'N/A'}
Awards: ${data.awards || 'None'} | Peer Review: ${data.peer_review || 'None'}
Talks: ${data.talks || 'None'} | Patents: ${data.patents || 'None'} | Media: ${data.media || 'None'}
Other: ${data.other_evidence || 'None'}

PRONG 3 — Waiver:
Has Employer: ${data.has_employer || 'N/A'}
Why PERM Impractical: ${data.waiver_reason || 'N/A'}
National Benefit: ${data.national_benefit || 'N/A'}
Gov Connections: ${data.gov_connections || 'None'}

Immigration Status: ${data.current_status || 'N/A'} | Prior Petitions: ${data.prior_petition || 'No'}
Documents Ready: ${data.checked_items || 'None listed'}

Return this exact JSON structure:
{
  "overall_score": <0-100>,
  "overall_verdict": "<STRONG CASE|VIABLE CASE|NEEDS DEVELOPMENT>",
  "summary": "<3 sentence executive summary>",
  "prong1": { "score": <0-100>, "verdict": "<STRONG|MODERATE|WEAK>", "analysis": "<3 sentences>", "strengths": ["...","..."], "gaps": ["...","..."] },
  "prong2": { "score": <0-100>, "verdict": "<STRONG|MODERATE|WEAK>", "analysis": "<3 sentences>", "strengths": ["...","..."], "gaps": ["...","..."] },
  "prong3": { "score": <0-100>, "verdict": "<STRONG|MODERATE|WEAK>", "analysis": "<3 sentences>", "strengths": ["...","..."], "gaps": ["...","..."] },
  "priority_actions": [
    { "priority": "HIGH", "title": "<title>", "action": "<specific step to take>" },
    { "priority": "HIGH", "title": "<title>", "action": "<specific step to take>" },
    { "priority": "MEDIUM", "title": "<title>", "action": "<specific step to take>" }
  ],
  "recommendation": "<attorney strategic recommendation in 3-4 sentences>",
  "estimated_weeks": <8-20>
}`

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }]
  })

  const raw = (msg.content[0] as { text: string }).text.trim()
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Assessment JSON not returned')
  return JSON.parse(match[0])
}

// ─── PDF GENERATION ────────────────────────────────────────────────────────
async function generatePDF(name: string, data: Record<string, string>, a: Record<string, unknown>): Promise<Buffer> {
  // Dynamic import to avoid edge runtime issues
  const PDFDocument = (await import('pdfkit')).default

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 55, size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const navy = '#0F2347'
    const gold = '#B8963E'
    const gray = '#666666'
    const lightGray = '#EEEEEE'
    const pageW = 595 - 110 // A4 width minus margins

    // ── HEADER ──
    doc.rect(0, 0, 595, 70).fill(navy)
    doc.fillColor(gold).fontSize(18).font('Helvetica-Bold')
       .text('MZS LAW FIRM', 55, 22)
    doc.fillColor('white').fontSize(9).font('Helvetica')
       .text('EB-2 NIW Case Assessment & Form I-140 Pre-Fill', 55, 44)
    doc.fillColor(gray).fontSize(8)
       .text(`Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`, 55, 56)

    let y = 90

    // ── CASE OVERVIEW ──
    doc.rect(55, y, pageW, 28).fill('#F5F1EA')
    doc.fillColor(navy).fontSize(13).font('Helvetica-Bold')
       .text(name, 65, y + 7)
    const score = (a.overall_score as number) || 0
    const scoreColor = score >= 75 ? '#16a34a' : score >= 55 ? '#b45309' : '#dc2626'
    doc.fillColor(scoreColor).fontSize(22).font('Helvetica-Bold')
       .text(`${score}`, 480, y + 3, { width: 60, align: 'right' })
    doc.fillColor(gray).fontSize(7).font('Helvetica')
       .text('/100 score', 480, y + 18, { width: 60, align: 'right' })
    y += 40

    // Verdict + basis
    doc.fillColor(navy).fontSize(10).font('Helvetica-Bold')
       .text(String(a.overall_verdict || ''), 55, y)
    doc.fillColor(gray).fontSize(9).font('Helvetica')
       .text(`  ·  ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}  ·  ${data.citizenship || ''}  ·  ${data.current_status || 'Outside U.S.'}`, 55, y, { continued: false })
    y += 14

    // Summary
    doc.fillColor('#333').fontSize(9).font('Helvetica')
       .text(String(a.summary || ''), 55, y, { width: pageW, lineGap: 3 })
    y = doc.y + 16

    // ── NIW PRONG ANALYSIS ──
    sectionHeader(doc, 'NIW THREE-PRONG ANALYSIS  —  Matter of Dhanasar (2016)', y, navy, gold)
    y += 24

    const prongs = [
      { key: 'prong1', label: 'PRONG 1', title: 'Substantial Merit & National Importance' },
      { key: 'prong2', label: 'PRONG 2', title: 'Well Positioned to Advance the Endeavor' },
      { key: 'prong3', label: 'PRONG 3', title: 'National Interest Waiver Justification' },
    ]

    for (const { key, label, title } of prongs) {
      const p = (a[key] as Record<string, unknown>) || {}
      const ps = (p.score as number) || 0
      const pv = String(p.verdict || 'MODERATE').toUpperCase()
      const vColor = pv === 'STRONG' ? '#16a34a' : pv === 'WEAK' ? '#dc2626' : '#b45309'

      // Prong header row
      doc.rect(55, y, pageW, 20).fill('#F0EBE0')
      doc.fillColor(gold).fontSize(7).font('Helvetica-Bold')
         .text(label, 62, y + 6)
      doc.fillColor(navy).fontSize(9).font('Helvetica-Bold')
         .text(title, 108, y + 6)
      doc.fillColor(vColor).fontSize(8).font('Helvetica-Bold')
         .text(pv, 430, y + 6, { width: 70, align: 'right' })
      y += 22

      // Score bar
      doc.rect(55, y, pageW, 4).fill(lightGray)
      doc.rect(55, y, pageW * (ps / 100), 4).fill(vColor)
      y += 10

      // Analysis text
      doc.fillColor('#333').fontSize(8.5).font('Helvetica')
         .text(String(p.analysis || ''), 55, y, { width: pageW, lineGap: 2 })
      y = doc.y + 6

      // Strengths
      const strengths = (p.strengths as string[]) || []
      for (const s of strengths) {
        doc.fillColor('#16a34a').fontSize(8).font('Helvetica-Bold').text('✓', 55, y)
        doc.fillColor('#333').fontSize(8).font('Helvetica').text(s, 68, y, { width: pageW - 13 })
        y = doc.y + 2
      }
      // Gaps
      const gaps = (p.gaps as string[]) || []
      for (const g of gaps) {
        doc.fillColor('#b45309').fontSize(8).font('Helvetica-Bold').text('⚠', 55, y)
        doc.fillColor('#555').fontSize(8).font('Helvetica').text(g, 68, y, { width: pageW - 13 })
        y = doc.y + 2
      }
      y += 10

      // Page break if needed
      if (y > 740) { doc.addPage(); y = 55 }
    }

    // ── PRIORITY ACTIONS ──
    if (y > 660) { doc.addPage(); y = 55 }
    sectionHeader(doc, 'PRIORITY ACTIONS BEFORE FILING', y, navy, gold)
    y += 24

    const actions = (a.priority_actions as Array<Record<string, string>>) || []
    for (const act of actions) {
      const isHigh = act.priority === 'HIGH'
      doc.rect(55, y, 4, 14).fill(isHigh ? '#dc2626' : '#3b82f6')
      doc.fillColor(isHigh ? '#dc2626' : '#3b82f6').fontSize(7).font('Helvetica-Bold')
         .text(act.priority + ' PRIORITY', 65, y + 1)
      doc.fillColor(navy).fontSize(8.5).font('Helvetica-Bold')
         .text(act.title || '', 145, y + 1)
      y += 14
      doc.fillColor('#444').fontSize(8).font('Helvetica')
         .text(act.action || '', 65, y, { width: pageW - 10, lineGap: 2 })
      y = doc.y + 8
      if (y > 740) { doc.addPage(); y = 55 }
    }

    // ── ATTORNEY RECOMMENDATION ──
    if (y > 640) { doc.addPage(); y = 55 }
    y += 6
    doc.rect(55, y, pageW, 14).fill(navy)
    doc.fillColor(gold).fontSize(9).font('Helvetica-Bold')
       .text('ATTORNEY STRATEGIC RECOMMENDATION', 62, y + 3)
    y += 18
    doc.fillColor('#222').fontSize(8.5).font('Helvetica')
       .text(String(a.recommendation || ''), 55, y, { width: pageW, lineGap: 3 })
    y = doc.y + 20

    // ── NEW PAGE: I-140 PRE-FILL ──
    doc.addPage()
    y = 55

    // I-140 header
    doc.rect(0, 0, 595, 55).fill(navy)
    doc.fillColor(gold).fontSize(16).font('Helvetica-Bold')
       .text('USCIS FORM I-140', 55, 14)
    doc.fillColor('white').fontSize(9).font('Helvetica')
       .text('Immigrant Petition for Alien Workers  —  Pre-Fill Data Extract', 55, 34)
    doc.fillColor(gray).fontSize(8)
       .text('For attorney review before official filing  ·  EB-2 National Interest Waiver', 55, 46)
    y = 70

    // I-140 notice box
    doc.rect(55, y, pageW, 26).fill('#FFFBF0').stroke('#E8D9A0')
    doc.fillColor('#7a5c1e').fontSize(8).font('Helvetica-Bold')
       .text('NOTE:', 62, y + 8)
    doc.font('Helvetica')
       .text('This pre-fill is generated from client questionnaire data. All fields must be verified against official documents before filing with USCIS.', 95, y + 8, { width: pageW - 50 })
    y += 36

    // Part 1 — Petition Type
    i140Part(doc, 'PART 1 — PETITION TYPE', y, navy, gold)
    y += 20
    const part1fields: [string, string][] = [
      ['Visa Classification', 'EB-2 — Advanced Degree or Exceptional Ability'],
      ['Petition Basis', 'National Interest Waiver (NIW) — 8 CFR § 204.5(k)(4)'],
      ['Job Offer Required?', 'No — Waived per National Interest Waiver'],
      ['Labor Certification Required?', 'No — NIW exempts petitioner from PERM process'],
    ]
    y = i140Fields(doc, part1fields, y, pageW, '#e8f5e9', '#16a34a')

    // Part 2 — Petitioner (self for NIW)
    y += 8
    i140Part(doc, 'PART 2 — PETITIONER INFORMATION  (Self-Petition for NIW)', y, navy, gold)
    y += 20
    const part2fields: [string, string][] = [
      ['Legal Name (Petitioner)', name],
      ['Petitioner Type', 'Self-Petitioner — Alien is both Petitioner and Beneficiary for NIW'],
      ['Federal Employer ID', 'N/A — Individual self-petition, no employer FEIN required'],
    ]
    y = i140Fields(doc, part2fields, y, pageW)

    if (y > 680) { doc.addPage(); y = 55 }

    // Part 3 — Beneficiary Info
    y += 8
    i140Part(doc, 'PART 3 — BENEFICIARY INFORMATION', y, navy, gold)
    y += 20
    const part3fields: [string, string][] = [
      ['3.1 — Family Name (Last)', data.last_name || ''],
      ['3.2 — Given Name (First)', data.first_name || ''],
      ['3.3 — Middle Name', data.middle_name || 'N/A'],
      ['3.4 — Other Names Used', data.other_names || 'None'],
      ['3.5 — Mailing Address', data.address || ''],
      ['3.6 — Date of Birth', data.dob || ''],
      ['3.7 — City of Birth', data.birth_city || ''],
      ['3.8 — Country of Birth', data.birth_country || ''],
      ['3.9 — Country of Citizenship', data.citizenship || ''],
      ['3.10 — Alien Registration (A-Number)', data.a_number || 'None — not yet assigned'],
      ['3.11 — Current Immigration Status', data.current_status || 'Not currently in the U.S.'],
      ['3.12 — Email Address', data.email || ''],
      ['3.13 — Daytime Phone', data.phone || ''],
    ]
    y = i140Fields(doc, part3fields, y, pageW)

    if (y > 660) { doc.addPage(); y = 55 }

    // Part 5 — Employment
    y += 8
    i140Part(doc, 'PART 5 — PROPOSED EMPLOYMENT INFORMATION', y, navy, gold)
    y += 20
    const part5fields: [string, string][] = [
      ['5.1 — Job Title / Proposed Occupation', data.job_title_0 || data.field_of_work || ''],
      ['5.2 — Current Employer', data.employer_0 || 'Self-employed / Research'],
      ['5.3 — Annual Wage (Current)', data.salary_0 || 'Not specified'],
      ['5.4 — Full Time / Part Time', 'Full Time'],
    ]
    y = i140Fields(doc, part5fields, y, pageW)

    // Part 6 — Beneficiary Qualifications
    y += 8
    i140Part(doc, 'PART 6 — BENEFICIARY QUALIFICATIONS (EB-2 Basis)', y, navy, gold)
    y += 20
    const part6fields: [string, string][] = [
      ['EB-2 Pathway', data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability (≥ 3 of 6 USCIS criteria)'],
      ['Highest Degree', data.degree_type_0 || 'N/A'],
      ['Field of Study', data.field_0 || ''],
      ['Institution / University', data.university_0 || ''],
      ['Year Degree Conferred', data.grad_year_0 || ''],
      ['Proposed Field of Work (NIW)', data.field_of_work || ''],
    ]
    if (data.ea_criteria) {
      part6fields.push(['Exceptional Ability Criteria Met', data.ea_criteria])
    }
    y = i140Fields(doc, part6fields, y, pageW)

    if (y > 660) { doc.addPage(); y = 55 }

    // Part 8 — Filing
    y += 8
    i140Part(doc, 'PART 8 — FILING INFORMATION', y, navy, gold)
    y += 20
    const part8fields: [string, string][] = [
      ['Filing Fee (I-140)', '$700.00'],
      ['Asylum Program Fee', '$600.00'],
      ['Total Base Fee', '$1,300.00'],
      ['Premium Processing (Optional)', '$2,805.00 — I-907, 15 business day adjudication'],
      ['Filing Location', 'USCIS Nebraska or Texas Service Center (per petitioner jurisdiction)'],
      ['Priority Date', 'Assigned by USCIS upon receipt — petition date becomes priority date'],
    ]
    y = i140Fields(doc, part8fields, y, pageW)

    // ── FOOTER ──
    const pages = (doc as unknown as { _pageBuffer: unknown[] })._pageBuffer?.length || 1
    doc.fillColor('#aaa').fontSize(7).font('Helvetica')
       .text(`MZS Law Firm  ·  EB-2 NIW AI Assessment  ·  Confidential  ·  For attorney review only  ·  ${new Date().toLocaleDateString()}`, 55, 820, { width: pageW, align: 'center' })

    doc.end()
  })
}

function sectionHeader(doc: InstanceType<typeof import('pdfkit')['default']>, title: string, y: number, navy: string, gold: string) {
  doc.rect(55, y, 485, 16).fill(navy)
  doc.fillColor(gold).fontSize(8).font('Helvetica-Bold').text(title, 62, y + 4)
}

function i140Part(doc: InstanceType<typeof import('pdfkit')['default']>, title: string, y: number, navy: string, gold: string) {
  doc.rect(55, y, 485, 14).fill('#E8E2D4')
  doc.fillColor(navy).fontSize(7.5).font('Helvetica-Bold').text(title, 62, y + 3)
}

function i140Fields(
  doc: InstanceType<typeof import('pdfkit')['default']>,
  fields: [string, string][],
  y: number,
  pageW: number,
  bgColor = '#FAFAF7',
  valColor = '#0F2347'
): number {
  for (const [label, value] of fields) {
    doc.rect(55, y, pageW, 14).fill(bgColor).stroke('#DDD4C0')
    doc.fillColor('#888').fontSize(7).font('Helvetica').text(label, 62, y + 3)
    doc.fillColor(valColor || '#1a2035').fontSize(8).font('Helvetica-Bold')
       .text(value || '—', 230, y + 3, { width: pageW - 180 })
    y += 15
    if (y > 760) {
      doc.addPage()
      y = 55
    }
  }
  return y
}

// ─── EMAIL WITH PDF ATTACHMENT ─────────────────────────────────────────────
async function sendEmailWithPDF(
  name: string,
  data: Record<string, string>,
  assessment: Record<string, unknown>,
  pdfBuffer: Buffer
) {
  const { getAuthedClient } = await import('@/lib/google')
  const { google } = await import('googleapis')

  const auth = await getAuthedClient()
  const gmail = google.gmail({ version: 'v1', auth })

  const to = 'info@i-review.ai'
  const score = assessment.overall_score as number
  const verdict = assessment.overall_verdict as string
  const subject = `NIW Intake + Assessment: ${name} — Score ${score}/100 (${verdict})`

  const htmlBody = `
<div style="font-family:Georgia,serif;max-width:700px;color:#1a2035;">
  <div style="background:#0F2347;padding:24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#B8963E;margin:0;font-size:1.3rem;">MZS Law Firm — New EB-2 NIW Intake</h2>
    <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:0.85rem;font-family:monospace;">AI Case Assessment + I-140 Pre-Fill · PDF attached</p>
  </div>
  <div style="background:#fff;border:1px solid #ddd4c0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;width:35%;color:#0F2347;">Client Name</td><td style="padding:8px;border:1px solid #ddd4c0;">${name}</td></tr>
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;color:#0F2347;">Email</td><td style="padding:8px;border:1px solid #ddd4c0;">${data.email || '—'}</td></tr>
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;color:#0F2347;">Phone</td><td style="padding:8px;border:1px solid #ddd4c0;">${data.phone || '—'}</td></tr>
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;color:#0F2347;">Country</td><td style="padding:8px;border:1px solid #ddd4c0;">${data.citizenship || data.birth_country || '—'}</td></tr>
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;color:#0F2347;">Current Status</td><td style="padding:8px;border:1px solid #ddd4c0;">${data.current_status || 'Not in U.S.'}</td></tr>
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;color:#0F2347;">EB-2 Basis</td><td style="padding:8px;border:1px solid #ddd4c0;">${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree' : 'Exceptional Ability'}</td></tr>
      <tr><td style="padding:8px;background:#f5f1ea;font-weight:700;color:#0F2347;">Field of Work</td><td style="padding:8px;border:1px solid #ddd4c0;">${data.field_of_work || '—'}</td></tr>
    </table>

    <div style="background:#0F2347;color:#fff;border-radius:8px;padding:16px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:1.4rem;font-weight:700;color:${score >= 75 ? '#4ade80' : score >= 55 ? '#fbbf24' : '#f87171'}">${score}/100</div>
          <div style="color:#B8963E;font-weight:700;font-family:monospace;">${verdict}</div>
        </div>
      </div>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.8);font-size:0.9rem;line-height:1.6;">${assessment.summary || ''}</p>
    </div>

    ${['prong1','prong2','prong3'].map((pk, i) => {
      const p = assessment[pk] as Record<string, unknown> || {}
      const pv = String(p.verdict || '').toUpperCase()
      const pc = pv === 'STRONG' ? '#16a34a' : pv === 'WEAK' ? '#dc2626' : '#b45309'
      return `<div style="border:1px solid #ddd4c0;border-radius:8px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#0F2347;">Prong ${i+1}: ${['Substantial Merit & National Importance','Well Positioned to Advance','National Interest Waiver'][i]}</strong>
          <span style="background:${pc};color:#fff;padding:2px 10px;border-radius:20px;font-size:0.75rem;font-family:monospace;">${pv} · ${p.score}/100</span>
        </div>
        <p style="color:#444;font-size:0.88rem;line-height:1.6;margin:0;">${p.analysis || ''}</p>
      </div>`
    }).join('')}

    <div style="background:#fffbf0;border:1px solid #e8d9a0;border-radius:8px;padding:16px;margin-top:16px;">
      <strong style="color:#7a5c1e;">⚖️ Attorney Recommendation</strong>
      <p style="color:#5a4a2a;font-size:0.88rem;line-height:1.6;margin:8px 0 0;">${assessment.recommendation || ''}</p>
    </div>

    <p style="margin-top:20px;font-size:0.8rem;color:#888;font-family:monospace;">📎 Attached: Full assessment report + USCIS Form I-140 pre-fill data (PDF)<br/>Generated by Nexter Studio AI · MZS Law Firm · Confidential</p>
  </div>
</div>`

  const pdfBase64 = pdfBuffer.toString('base64')
  const boundary = 'boundary_niw_' + Date.now()

  const rawEmail = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    htmlBody,
    ``,
    `--${boundary}`,
    `Content-Type: application/pdf`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${name.replace(/\s+/g,'-')}-NIW-Assessment.pdf"`,
    ``,
    pdfBase64,
    ``,
    `--${boundary}--`,
  ].join('\r\n')

  const encoded = Buffer.from(rawEmail).toString('base64url')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded } })
}
