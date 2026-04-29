import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

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

// ─── PDF 2: USCIS FORM I-140 REPLICA ─────────────────────────────────────────
// Based on USCIS Form I-140 (Rev. 11/09/23) — Immigrant Petition for Alien Workers
async function generateI140PDF(name: string, data: Record<string, string>): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFDocument = require('pdfkit')
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 45, size: 'LETTER', autoFirstPage: true })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      const navy = '#0F2347', W = 522
      let y = 0

      // ── FORM HEADER (mimics actual USCIS form header) ──
      doc.rect(0, 0, 612, 52).fill(navy)
      doc.fillColor('white').fontSize(11).font('Helvetica-Bold').text('USCIS Form I-140', 45, 10)
      doc.fillColor('#B8963E').fontSize(8).font('Helvetica').text('Immigrant Petition for Alien Workers', 45, 25)
      doc.fillColor('white').fontSize(8).text('Department of Homeland Security', 45, 37)
      doc.fillColor('#aaa').fontSize(7).text('Rev. 11/09/23  ·  Edition 11/09/23', 380, 10)
      doc.fillColor('#ccc').fontSize(7).text('OMB No. 1615-0015; Expires 11/30/2026', 380, 22)
      doc.fillColor('white').fontSize(8).font('Helvetica-Bold').text('FOR ATTORNEY REVIEW — PRE-FILL FROM CLIENT INTAKE', 380, 34)
      y = 62

      // Utility functions
      const partHeader = (title: string) => {
        if (y > 680) { doc.addPage(); y = 45 }
        doc.rect(45, y, W, 16).fill('#1C2B4A')
        doc.fillColor('#B8963E').fontSize(8).font('Helvetica-Bold').text(title, 52, y + 4)
        y += 18
      }

      const field = (label: string, value: string, full = false) => {
        if (y > 700) { doc.addPage(); y = 45 }
        const h = 20
        const fw = full ? W : W / 2
        doc.rect(45, y, fw, h).stroke('#CCCCCC').fill('#FAFAFA')
        doc.fillColor('#666').fontSize(6).font('Helvetica').text(label, 48, y + 3)
        doc.fillColor(value ? navy : '#bbb').fontSize(8.5).font(value ? 'Helvetica-Bold' : 'Helvetica')
          .text(value || '(not provided)', 48, y + 11, { width: fw - 10 })
        if (full) y += h + 1
        return y
      }

      const fieldRow = (pairs: [string, string][]) => {
        if (y > 700) { doc.addPage(); y = 45 }
        const fw = W / pairs.length
        const h = 20
        for (let i = 0; i < pairs.length; i++) {
          const [label, value] = pairs[i]
          doc.rect(45 + i * fw, y, fw, h).stroke('#CCCCCC').fill('#FAFAFA')
          doc.fillColor('#666').fontSize(6).font('Helvetica').text(label, 48 + i * fw, y + 3)
          doc.fillColor(value ? navy : '#bbb').fontSize(8.5).font(value ? 'Helvetica-Bold' : 'Helvetica')
            .text(value || '(not provided)', 48 + i * fw, y + 11, { width: fw - 10 })
        }
        y += h + 1
      }

      const checkbox = (label: string, checked: boolean) => {
        if (y > 710) { doc.addPage(); y = 45 }
        doc.rect(45, y, 10, 10).stroke('#333')
        if (checked) {
          doc.fillColor(navy).fontSize(9).font('Helvetica-Bold').text('✓', 46, y + 1)
        }
        doc.fillColor('#222').fontSize(8).font('Helvetica').text(label, 60, y + 1)
        y += 14
      }

      const note = (text: string) => {
        doc.rect(45, y, W, 14).fill('#FFF8E7')
        doc.fillColor('#7a5c1e').fontSize(7).font('Helvetica').text(text, 50, y + 4, { width: W - 10 })
        y += 16
      }

      // ── PART 1: REASON FOR FILING ──
      partHeader('PART 1.  Reason for Filing (select one)')
      checkbox('1.a  New petition', true)
      checkbox('1.b  Amendment to a pending petition (USCIS receipt number required below)', false)
      y += 4

      // ── PART 2: PETITION TYPE ──
      partHeader('PART 2.  Petition Type — Select all that apply')
      note('For EB-2 National Interest Waiver: check BOTH boxes 2.d and 2.j')
      const isAdvDeg = data.eb2_basis === 'advanced_degree'
      checkbox('2.a  An alien with extraordinary ability', false)
      checkbox('2.b  An outstanding professor or researcher', false)
      checkbox('2.c  A multinational executive or manager', false)
      checkbox(`2.d  An alien who is a member of the professions holding an advanced degree${isAdvDeg ? ' ←  APPLIES TO THIS PETITIONER' : ''}`, isAdvDeg)
      checkbox(`2.e  An alien of exceptional ability${!isAdvDeg ? ' ←  APPLIES TO THIS PETITIONER' : ''}`, !isAdvDeg)
      checkbox('2.f  Skilled worker (requiring at least 2 years training or experience)', false)
      checkbox('2.g  Professional (requiring a baccalaureate degree)', false)
      checkbox('2.h  Other worker (requiring less than 2 years training or experience)', false)
      checkbox('2.i  A physician under INA sections 203(b)(2)(B) or INA 214(l)', false)
      checkbox('2.j  National Interest Waiver (EB-2) — JOB OFFER WAIVED  ←  APPLIES TO THIS PETITIONER', true)
      y += 4

      // ── PART 3: PETITIONER INFO (self for NIW) ──
      partHeader('PART 3.  Information About the Petitioner  (Self-Petition for NIW — Petitioner = Beneficiary)')
      note('For NIW self-petition: the alien is both the Petitioner and the Beneficiary. No employer petitioner required.')
      fieldRow([['3.1.a  Family Name (Last Name)', data.last_name || ''], ['3.1.b  Given Name (First Name)', data.first_name || ''], ['3.1.c  Middle Name', data.middle_name || '']])
      field('3.2  Other Names Used (including maiden name)', data.other_names || 'None', true)
      field('3.3  Current Mailing Address', data.address || '', true)
      fieldRow([['3.4  IRS Tax Number', 'N/A — individual self-petition'], ['3.5  Federal Employer ID (FEIN)', 'N/A — no employer required for NIW']])
      y += 4

      // ── PART 4: PROCESSING INFO ──
      partHeader('PART 4.  Processing Information')
      checkbox('4.a  I want the petition and supporting documents returned to me', false)
      checkbox('4.b  Beneficiary is in the United States and will apply for adjustment of status', data.current_status !== '' && data.current_status !== 'Not currently in the U.S.')
      checkbox(`4.c  Beneficiary is outside the United States and will apply at a U.S. consulate or embassy`, !data.current_status || data.current_status === 'Not currently in the U.S.')
      fieldRow([['City/Town of Proposed Consulate', '(to be determined)'], ['Country of Consulate', data.birth_country || data.citizenship || '']])
      y += 4

      // ── PART 5: PETITIONER EMPLOYMENT (not applicable for NIW self-petition) ──
      partHeader('PART 5.  Additional Information About the Petitioner  (Skip — self-petition)')
      note('Part 5 is for employer-petitioners. Not applicable for NIW self-petitions under 8 CFR § 204.5(k)(4).')
      y += 4

      // ── PART 6: PROPOSED EMPLOYMENT ──
      if (y > 580) { doc.addPage(); y = 45 }
      partHeader('PART 6.  Basic Information About the Proposed Employment')
      field('6.1  Proposed Job Title / Occupation in the U.S.', data.job_title_0 || data.field_of_work || '', true)
      fieldRow([['6.2  SOC Occupation Code', 'See O*NET — attorney to verify'], ['6.3  NAICS Industry Code', 'Attorney to determine']])
      fieldRow([['6.4  Hours Per Week', '40'], ['6.5  Wages Per Year', data.salary_0 || '(to be determined)']])
      checkbox('6.6.a  Full Time Position', true)
      checkbox('6.6.b  Part Time Position', false)
      field('6.7  Other Special Requirements for the Job', 'None — NIW waives standard labor requirements', true)
      y += 4

      // ── PART 7: BENEFICIARY INFO ──
      if (y > 500) { doc.addPage(); y = 45 }
      partHeader('PART 7.  Information About the Beneficiary (Alien Worker)  [I-140 Part 3 Fields]')
      note('For NIW: Petitioner and Beneficiary are the same person. All fields below are from the client questionnaire.')
      fieldRow([['7.1.a  Family Name (Last)', data.last_name || ''], ['7.1.b  Given Name (First)', data.first_name || ''], ['7.1.c  Middle Name', data.middle_name || '']])
      field('7.2  Other Names Used (maiden, alias, other)', data.other_names || 'None', true)
      fieldRow([['7.3  Date of Birth (MM/DD/YYYY)', data.dob || ''], ['7.4  City/Town of Birth', data.birth_city || ''], ['7.5  Country of Birth', data.birth_country || '']])
      fieldRow([['7.6  Country of Citizenship / Nationality', data.citizenship || ''], ['7.7  Class of Admission (current visa)', data.current_status || 'Not in U.S.']])
      fieldRow([['7.8  Date of Last Admission (MM/DD/YYYY)', '(if applicable)'], ['7.9  I-94 Arrival/Departure Record Number', '(if applicable)']])
      fieldRow([['7.10  USCIS Alien Registration Number (A-Number)', data.a_number || 'None — not yet assigned'], ['7.11  U.S. Social Security Number', '(if applicable)']])
      fieldRow([['7.12  Passport Number', '(attach copy of passport)'], ['7.13  Travel Document Number', 'N/A']])
      fieldRow([['7.14  Country of Issuance', data.citizenship || data.birth_country || ''], ['7.15  Expiration Date', '(from passport)']])
      field('7.16  Current U.S. Mailing Address (if in U.S.)', data.address || '(outside U.S.)', true)
      fieldRow([['7.17  Email Address', data.email || ''], ['7.18  Daytime Phone', data.phone || '']])
      y += 4

      // ── PART 8: IMMIGRATION HISTORY ──
      if (y > 580) { doc.addPage(); y = 45 }
      partHeader('PART 8.  Beneficiary\'s Immigration History')
      checkbox('8.1  No prior immigrant petition has been filed for this beneficiary', data.prior_petition === 'no' || !data.prior_petition)
      checkbox('8.2  A prior immigrant petition has been filed for this beneficiary', data.prior_petition !== 'no' && !!data.prior_petition)
      if (data.prior_petition_details) {
        field('8.2  Details of Prior Petition', data.prior_petition_details, true)
      }
      checkbox('8.3  Beneficiary has NEVER been in removal, exclusion, or deportation proceedings', data.removal_history === 'no' || !data.removal_history)
      checkbox('8.4  Beneficiary HAS been in removal, exclusion, or deportation proceedings', data.removal_history === 'yes')
      y += 4

      // ── PART 9: FAMILY ──
      if (y > 580) { doc.addPage(); y = 45 }
      partHeader('PART 9.  Accompanying / Following-to-Join Relatives')
      if (data.family_members && data.family_members.length > 2) {
        field('9.1  Accompanying family members (spouse and/or children)', data.family_members, true)
      } else {
        note('No accompanying family members indicated by client.')
        y += 2
      }

      // ── PART 10: BENEFICIARY EMPLOYMENT ──
      if (y > 580) { doc.addPage(); y = 45 }
      partHeader('PART 10.  Basic Information About the Beneficiary\'s Employment')
      field('10.1  Current Employer Name', data.employer_0 || '(outside U.S. / not yet employed in U.S.)', true)
      fieldRow([['10.2  Current Job Title', data.job_title_0 || ''], ['10.3  Employment Start Date', data.job_start_0 || '']])
      fieldRow([['10.4  Annual Salary (USD)', data.salary_0 || ''], ['10.5  Salary vs. Peers', data.salary_comp_0 || '']])
      field('10.6  Description of Duties', data.job_desc_0 || '', true)
      y += 4

      // ── PART 11: EDUCATION & QUALIFICATIONS ──
      if (y > 540) { doc.addPage(); y = 45 }
      partHeader('PART 11.  Beneficiary\'s Education and Work History')
      note(`EB-2 Basis: ${data.eb2_basis === 'advanced_degree' ? 'Advanced Degree — meets I-140 Part 2.d requirement' : 'Exceptional Ability — meets I-140 Part 2.e requirement'}`)
      fieldRow([['11.1  Highest Degree Attained', data.degree_type_0 || ''], ['11.2  Field of Study', data.field_0 || ''], ['11.3  Year Conferred', data.grad_year_0 || '']])
      field('11.4  Institution / University Name', data.university_0 || '', true)
      if (data.ea_criteria) field('11.5  Exceptional Ability Criteria Met (of 6 required, need 3)', data.ea_criteria, true)
      field('11.6  Publications (list)', data.publications || 'None documented', true)
      fieldRow([['11.7  Total Citation Count', data.citations || '0'], ['11.8  h-index', data.h_index || 'N/A']])
      field('11.9  Awards & Honors', data.awards || 'None documented', true)
      field('11.10  Patents', data.patents || 'None documented', true)
      field('11.11  Invited Talks / Presentations', data.talks || 'None documented', true)
      field('11.12  Peer Review / Judging Activity', data.peer_review || 'None documented', true)
      field('11.13  Media Coverage', data.media || 'None documented', true)
      y += 4

      // ── FILING SUMMARY ──
      if (y > 560) { doc.addPage(); y = 45 }
      doc.rect(45, y, W, 14).fill('#0F2347')
      doc.fillColor('#B8963E').fontSize(7.5).font('Helvetica-Bold').text('FILING FEES & NEXT STEPS', 52, y + 3)
      y += 18
      fieldRow([['I-140 Filing Fee', '$700.00'], ['Asylum Program Fee', '$600.00'], ['Total Base Fee', '$1,300.00']])
      fieldRow([['Premium Processing (I-907) — Optional', '$2,805.00 — 15 business day'], ['Filing Location', 'Nebraska or Texas Service Center']])
      fieldRow([['Priority Date', 'Assigned upon USCIS receipt'], ['Estimated Preparation', `${12} weeks to filing`]])

      // Footer
      doc.fillColor('#aaa').fontSize(6.5).font('Helvetica')
        .text(`USCIS Form I-140  ·  EB-2 NIW Pre-Fill  ·  MZS Law Firm  ·  ${name}  ·  ${new Date().toLocaleDateString()}  ·  For attorney review only — not a filed petition`, 45, 748, { width: W, align: 'center' })

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
