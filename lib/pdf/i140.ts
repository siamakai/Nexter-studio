/**
 * USCIS Form I-140 — Immigrant Petition for Alien Workers
 * Accurate replica of Edition 06/07/24 | OMB No. 1615-0015
 * Pre-filled from client questionnaire data for attorney review.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

export async function generateI140PDF(name: string, data: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 0, size: 'LETTER', autoFirstPage: true })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      renderI140(doc, name, data)
      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const L = 40           // left margin
const R = 572          // right edge
const W = R - L        // usable width
const COL = (W / 2)   // half column width
const NAVY = '#1A3A6B' // USCIS official dark blue
const SHADE = '#D9E1F2' // light blue field shading
const LINE = '#7F9BC8'  // field border blue

// ─── HELPERS ─────────────────────────────────────────────────────────────────
type Doc = typeof PDFDocument & {
  page: { height: number }
  y: number
  addPage: () => Doc
}

let _doc: Doc
let y = 0
let pageNum = 1
const totalPages = 5

function checkPage(need = 40) {
  if (y + need > 720) {
    _doc.addPage()
    pageNum++
    y = 30
    pageFooter()
  }
}

function pageFooter() {
  _doc.fillColor('#555').fontSize(6.5).font('Helvetica')
    .text(`Form I-140 Edition 06/07/24 · OMB No. 1615-0015 · Page ${pageNum} of ${totalPages}`, L, 750, { width: W, align: 'center' })
  _doc.fillColor('#555').fontSize(6)
    .text('FOR ATTORNEY REVIEW ONLY — Pre-filled from client intake. Verify all fields before filing with USCIS.', L, 758, { width: W, align: 'center' })
}

// Draw a shaded part header (matches USCIS form style)
function partHeader(title: string, subtitle = '') {
  checkPage(24)
  _doc.rect(L, y, W, subtitle ? 22 : 16).fill(NAVY)
  _doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
    .text(title, L + 4, y + 3, { width: W - 8 })
  if (subtitle) {
    _doc.fillColor('#B8D0F0').fontSize(6.5).font('Helvetica')
      .text(subtitle, L + 4, y + 13, { width: W - 8 })
  }
  y += subtitle ? 24 : 18
}

// Draw a single labeled field box
function fieldBox(
  label: string, value: string,
  x: number, fieldY: number, w: number, h = 24,
  shade = false, note = ''
): number {
  _doc.rect(x, fieldY, w, h).fill(shade ? SHADE : '#FFFFFF').stroke(LINE)
  _doc.fillColor('#333').fontSize(6).font('Helvetica')
    .text(label, x + 3, fieldY + 3, { width: w - 6 })
  _doc.fillColor(value ? '#000000' : '#999999').fontSize(8.5).font(value ? 'Helvetica-Bold' : 'Helvetica')
    .text(value || '(not provided)', x + 3, fieldY + 12, { width: w - 6, lineBreak: false, ellipsis: true })
  if (note) {
    _doc.fillColor('#888').fontSize(5.5).font('Helvetica')
      .text(note, x + 3, fieldY + h - 8, { width: w - 6 })
  }
  return fieldY + h
}

// Draw a row of fields
function row(fields: { label: string; value: string; w?: number; note?: string }[], rowH = 24) {
  checkPage(rowH + 2)
  let x = L
  for (const f of fields) {
    const fw = f.w || Math.floor(W / fields.length)
    fieldBox(f.label, f.value, x, y, fw, rowH, false, f.note || '')
    x += fw
  }
  y += rowH + 1
}

// Draw a full-width field
function fullField(label: string, value: string, h = 24, note = '') {
  checkPage(h + 2)
  fieldBox(label, value, L, y, W, h, false, note)
  y += h + 1
}

// Draw a shaded info box
function infoBox(text: string) {
  checkPage(20)
  _doc.rect(L, y, W, 16).fill('#FFF8DC').stroke('#D4A017')
  _doc.fillColor('#7a5c1e').fontSize(7).font('Helvetica-BoldOblique')
    .text(text, L + 4, y + 4, { width: W - 8 })
  y += 18
}

// Draw a checkbox row
function checkbox(label: string, checked: boolean, indent = 0) {
  checkPage(14)
  const bx = L + indent
  _doc.rect(bx, y + 1, 9, 9).stroke('#333')
  if (checked) {
    _doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold').text('✓', bx + 1, y)
  }
  _doc.fillColor(checked ? '#000' : '#333').fontSize(8).font(checked ? 'Helvetica-Bold' : 'Helvetica')
    .text(label, bx + 13, y + 1, { width: W - 20 - indent })
  y += 14
}

// Draw the signature / certification block
function signatureBlock(who: string) {
  checkPage(60)
  _doc.rect(L, y, W, 55).fill('#FAFAFA').stroke(LINE)
  _doc.fillColor(NAVY).fontSize(7.5).font('Helvetica-Bold')
    .text(`${who} — Certification and Signature`, L + 4, y + 4)
  _doc.fillColor('#333').fontSize(7).font('Helvetica')
    .text('I certify, under penalty of perjury, that the contents of this petition and evidence submitted are complete, true, and correct to the best of my knowledge.', L + 4, y + 16, { width: W - 8 })
  _doc.fillColor('#555').fontSize(7).text('Signature of Petitioner/Preparer:', L + 4, y + 32)
  _doc.moveTo(L + 140, y + 40).lineTo(L + 340, y + 40).stroke('#333')
  _doc.fillColor('#555').fontSize(7).text('Date (MM/DD/YYYY):', L + 360, y + 32)
  _doc.moveTo(L + 430, y + 40).lineTo(L + 530, y + 40).stroke('#333')
  _doc.fillColor('#aaa').fontSize(6.5).text('(Sign in ink — do not print)', L + 140, y + 42)
  y += 58
}

// ─── MAIN RENDER ──────────────────────────────────────────────────────────────
function renderI140(doc: Doc, name: string, data: Record<string, string>) {
  _doc = doc
  y = 30

  const isAdvDeg = data.eb2_basis === 'advanced_degree'
  const inUS = data.current_status && data.current_status !== 'Not currently in the U.S.'
  const lastName = data.last_name || ''
  const firstName = data.first_name || ''
  const middleName = data.middle_name || ''

  // ══════════════════════════════════════════════════════════════════════
  // FORM HEADER
  // ══════════════════════════════════════════════════════════════════════
  _doc.rect(L, y, W, 52).fill(NAVY)

  // DHS eagle placeholder (simplified circle seal)
  _doc.circle(L + 26, y + 26, 18).fill('#FFFFFF').stroke('#B8D0F0')
  _doc.fillColor(NAVY).fontSize(7).font('Helvetica-Bold').text('DHS', L + 18, y + 22)

  _doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
    .text('Department of Homeland Security', L + 54, y + 6)
  _doc.fontSize(11).font('Helvetica')
    .text('U.S. Citizenship and Immigration Services', L + 54, y + 22)
  _doc.fillColor('#B8D0F0').fontSize(8.5).font('Helvetica-Bold')
    .text('Form I-140, Immigrant Petition for Alien Workers', L + 54, y + 36)

  _doc.fillColor('#B8D0F0').fontSize(7).font('Helvetica')
    .text('OMB No. 1615-0015', R - 110, y + 6)
    .text('Expires 08/31/2027', R - 110, y + 16)
    .text('Edition 06/07/24', R - 110, y + 26)
  _doc.fillColor('white').fontSize(7.5).font('Helvetica-Bold')
    .text('FOR ATTORNEY REVIEW', R - 120, y + 36)
  _doc.fillColor('#ffdd99').fontSize(7).font('Helvetica')
    .text('Pre-filled from client intake', R - 120, y + 46)

  y += 58

  infoBox('ATTORNEY NOTE: All pre-filled fields must be verified against official documents before filing with USCIS. This is a working draft only.')

  // ══════════════════════════════════════════════════════════════════════
  // PART 1 — REASON FOR FILING
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 1. Reason for Filing (Select only one box)')
  checkbox('1.a.  New Petition', true)
  checkbox('1.b.  Amendment to a pending petition — Provide USCIS Receipt Number:', false)
  fullField('USCIS Receipt Number (if amendment)', '', 18, 'Leave blank for new petition')
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 2 — PETITION TYPE
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 2. Petition Type (Select only one box)', 'For EB-2 National Interest Waiver: select box 2.e or 2.f (whichever applies) AND check the NIW box below')

  infoBox(`CLIENT QUALIFIES UNDER: ${isAdvDeg ? '2.e — Advanced Degree (member of professions holding an advanced degree)' : '2.f — Exceptional Ability (alien of exceptional ability in the sciences, arts, or business)'} + National Interest Waiver`)

  checkbox('2.a.  EB-1 — An alien with extraordinary ability in the sciences, arts, education, business, or athletics', false)
  checkbox('2.b.  EB-1 — An outstanding professor or researcher', false)
  checkbox('2.c.  EB-1 — A multinational executive or manager', false)
  checkbox('2.d.  EB-2 — A member of the professions holding an advanced degree or an alien of exceptional ability (NOT seeking a National Interest Waiver)', false)
  checkbox(`2.e.  EB-2 — A member of the professions holding an advanced degree (seeking a National Interest Waiver)${isAdvDeg ? '   ← APPLIES TO THIS PETITIONER' : ''}`, isAdvDeg)
  checkbox(`2.f.  EB-2 — An alien of exceptional ability in the sciences, arts, or business (seeking a National Interest Waiver)${!isAdvDeg ? '   ← APPLIES TO THIS PETITIONER' : ''}`, !isAdvDeg)
  checkbox('2.g.  EB-3 — A skilled worker (requires at least 2 years of training or experience)', false)
  checkbox('2.h.  EB-3 — A professional (requires a U.S. baccalaureate or foreign equivalent degree)', false)
  checkbox('2.i.  EB-3 — An unskilled worker (requires less than 2 years training or experience)', false)
  checkbox('2.j.  EB-4 — A special immigrant religious worker', false)
  checkbox('2.k.  EB-5 — An immigrant investor', false)
  y += 2
  _doc.rect(L, y, W, 14).fill('#E8F0FE').stroke(NAVY)
  _doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
    .text('☑  NATIONAL INTEREST WAIVER (NIW) — Job offer waived under INA § 203(b)(2)(B)(i). No PERM labor certification required.   ← APPLIES', L + 4, y + 3)
  y += 16

  // ══════════════════════════════════════════════════════════════════════
  // PART 3 — PETITIONER INFORMATION
  // ══════════════════════════════════════════════════════════════════════
  y += 4
  partHeader('Part 3. Information About the Person or Organization Filing This Petition (the Petitioner)',
    'For NIW self-petitions: the alien beneficiary IS the petitioner. Complete this section with the alien\'s information.')

  infoBox('SELF-PETITION: For National Interest Waiver, the alien files on their own behalf. Petitioner = Beneficiary.')

  row([
    { label: '3.1.a. Family Name (Last Name)', value: lastName },
    { label: '3.1.b. Given Name (First Name)', value: firstName },
    { label: '3.1.c. Middle Name', value: middleName || 'N/A' },
  ])
  fullField('3.2. Other Names Used (maiden name, alias, etc.)', data.other_names || 'None')
  row([
    { label: '3.3. Is the petitioner an organization?', value: 'No — Individual self-petitioner (NIW)' },
    { label: '3.4. IRS Tax Number (if organization)', value: 'N/A' },
  ])
  fullField('3.5. Petitioner\'s Mailing Address — Street Number and Name, Apt./Ste./Flr.', data.address || '', 28)
  row([
    { label: '3.6. FEIN (Federal Employer ID)', value: 'N/A — individual self-petition' },
    { label: '3.7. State/Province', value: '' },
    { label: '3.8. ZIP/Postal Code', value: '' },
    { label: '3.9. Country', value: data.birth_country || data.citizenship || '' },
  ])
  row([
    { label: '3.10. Petitioner\'s Email Address', value: data.email || '' },
    { label: '3.11. Petitioner\'s Daytime Phone', value: data.phone || '' },
  ])
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 4 — PROCESSING INFORMATION
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 4. Processing Information')

  checkbox(`4.1.  The person I am filing for is in the United States.${inUS ? '   ← YES' : ''}`, !!inUS)
  checkbox(`4.2.  The person I am filing for is NOT in the United States.${!inUS ? '   ← YES' : ''}`, !inUS)
  y += 2

  if (!inUS) {
    row([
      { label: '4.3. U.S. Embassy / Consulate City', value: '(to be determined by attorney)' },
      { label: '4.4. U.S. Embassy / Consulate Country', value: data.citizenship || data.birth_country || '' },
    ])
  } else {
    row([
      { label: '4.3. Has the beneficiary filed Form I-485?', value: 'To be confirmed by attorney' },
      { label: '4.4. I-485 Receipt Number (if filed)', value: '' },
    ])
  }

  checkbox('4.5.  Is the alien in exclusion, deportation, or removal proceedings?', data.removal_history === 'yes')
  checkbox('4.6.  Has a visa petition ever been filed for or by this person?', data.prior_petition !== 'no' && !!data.prior_petition)
  if (data.prior_petition && data.prior_petition !== 'no') {
    fullField('4.6. Details of prior petition', data.prior_petition_details || `Prior petition type: ${data.prior_petition}`, 28)
  }
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 5 — PETITIONER EMPLOYMENT (employer only, N/A for NIW self-petition)
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 5. Additional Information About the Petitioner', '(Complete only if petitioner is an employer — NOT applicable for NIW self-petitions)')
  infoBox('N/A — This petition is a self-petition under the National Interest Waiver. No employer petitioner. Leave blank.')
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 6 — PROPOSED EMPLOYMENT
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 6. Basic Information About the Proposed Employment')
  fullField('6.1. Job Title / Occupation for Which You Are Petitioning', data.job_title_0 || data.field_of_work || '')
  row([
    { label: '6.2. Standard Occupational Classification (SOC) Code', value: '(attorney to verify via O*NET)', note: 'See onetonline.org' },
    { label: '6.3. NAICS Industry Code', value: '(attorney to verify)', note: 'See census.gov/naics' },
  ])
  row([
    { label: '6.4. Is this a permanent position?', value: 'Yes' },
    { label: '6.5. Is this a full-time position?', value: 'Yes' },
    { label: '6.6. Hours per week (if part-time)', value: '40' },
  ])
  row([
    { label: '6.7. Wages per week (USD)', value: data.salary_0 ? `${data.salary_0} per year` : '' },
    { label: '6.8. Other compensation (USD)', value: '' },
    { label: '6.9. Value of other compensation', value: '' },
  ])
  fullField('6.10. Other Compensation Details (housing, meals, transportation, etc.)', 'None indicated', 18)
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 7 — BENEFICIARY INFORMATION (PAGE BREAK)
  // ══════════════════════════════════════════════════════════════════════
  checkPage(300)
  partHeader('Part 7. Information About the Beneficiary (the Alien)',
    'For NIW self-petition: Petitioner = Beneficiary. All fields from client questionnaire.')

  row([
    { label: '7.1.a. Family Name (Last Name)', value: lastName },
    { label: '7.1.b. Given Name (First Name)', value: firstName },
    { label: '7.1.c. Middle Name', value: middleName || 'N/A' },
  ])
  fullField('7.2. Other Names Used (maiden, aliases, other legal names)', data.other_names || 'None')
  row([
    { label: '7.3. Date of Birth (MM/DD/YYYY)', value: data.dob || '' },
    { label: '7.4. City/Town of Birth', value: data.birth_city || '' },
    { label: '7.5. Province/State of Birth', value: '' },
    { label: '7.6. Country of Birth', value: data.birth_country || '' },
  ])
  row([
    { label: '7.7. Country of Citizenship / Nationality', value: data.citizenship || '' },
    { label: '7.8. Class of Admission (current visa type)', value: data.current_status || 'Not in U.S.' },
  ])
  row([
    { label: '7.9. Date of Last Admission (MM/DD/YYYY)', value: '(if applicable)' },
    { label: '7.10. I-94 Arrival/Departure Record Number', value: '(if applicable)', note: 'Attach I-94 printout' },
  ])
  row([
    { label: '7.11. USCIS Online Account Number (if any)', value: '(if applicable)' },
    { label: '7.12. Alien Registration Number (A-Number)', value: data.a_number || 'None — not yet assigned' },
  ])
  row([
    { label: '7.13. U.S. Social Security Number (if any)', value: '(if applicable)', note: 'Attach SSN card' },
    { label: '7.14. Expiration Date of Current Status', value: data.status_expiry || '(if applicable)' },
  ])
  row([
    { label: '7.15. Passport or Travel Document Number', value: '(attach copy)' },
    { label: '7.16. Country That Issued the Passport/Document', value: data.citizenship || '' },
    { label: '7.17. Expiration Date of Passport/Document', value: '(from passport)' },
  ])
  fullField('7.18. Beneficiary\'s Current U.S. Mailing Address (if in the United States)', inUS ? data.address || '' : 'Outside the United States', 28)
  row([
    { label: '7.19. Beneficiary\'s Email Address', value: data.email || '' },
    { label: '7.20. Beneficiary\'s Daytime Phone', value: data.phone || '' },
    { label: '7.21. Beneficiary\'s Mobile Phone', value: '' },
  ])
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 8 — IMMIGRATION HISTORY
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 8. Beneficiary\'s Immigration History')
  checkbox('8.a.  Has a prior immigrant petition been filed by or on behalf of this beneficiary?', data.prior_petition !== 'no' && !!data.prior_petition)
  if (data.prior_petition && data.prior_petition !== 'no') {
    fullField('8.a. Prior petition details', data.prior_petition_details || `Status: ${data.prior_petition}`, 28)
  }
  checkbox('8.b.  Has this beneficiary EVER been in exclusion, deportation, or removal proceedings?', data.removal_history === 'yes')
  if (data.removal_history === 'yes') {
    fullField('8.b. Details of removal proceedings', '(attach explanation)', 18)
  }
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 9 — SPOUSE AND CHILDREN (derivatives)
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 9. Information About the Beneficiary\'s Spouse and Children',
    'List accompanying/following-to-join family members who may receive derivative immigrant status')

  if (data.family_members && data.family_members.trim().length > 2) {
    fullField('9.1. Accompanying family members (spouse and/or unmarried children under 21)', data.family_members, 36)
  } else {
    infoBox('No accompanying family members indicated by client.')
  }
  fullField('9.2. Number of derivative beneficiaries (spouse + children)', data.family_members && data.family_members.trim().length > 2 ? '(attorney to confirm count)' : '0', 18)
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 10 — EMPLOYMENT HISTORY
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 10. Basic Information About the Beneficiary\'s Employment History')
  fullField('10.1. Current or Most Recent Employer Name', data.employer_0 || '(outside U.S. or not currently employed in U.S.)')
  row([
    { label: '10.2. Current or Most Recent Job Title', value: data.job_title_0 || '' },
    { label: '10.3. Employment Start Date', value: data.job_start_0 || '' },
    { label: '10.4. Employment End Date', value: data.job_end_0 || 'Present' },
  ])
  row([
    { label: '10.5. Annual Salary / Income (USD)', value: data.salary_0 || '' },
    { label: '10.6. Salary vs. Peers in Field', value: data.salary_comp_0 || '' },
  ])
  fullField('10.7. Description of Duties and Responsibilities', data.job_desc_0 || '', 42)
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 11 — EDUCATION AND QUALIFICATIONS
  // ══════════════════════════════════════════════════════════════════════
  checkPage(200)
  partHeader('Part 11. Beneficiary\'s Education and Work Experience',
    'Complete for all EB-2 petitions. Documents (transcripts, diplomas) must be submitted as evidence.')

  // Education level checkboxes
  _doc.fillColor(NAVY).fontSize(7).font('Helvetica-Bold').text('11.1. Level of Education Attained:', L, y)
  y += 10
  for (const [label, check] of [
    ['None', false], ['High School / GED', false], ['Some College', false],
    ["Associate's Degree", false], ["Bachelor's Degree", data.degree_type_0?.includes("Bachelor") || false],
    ["Master's Degree", data.degree_type_0?.includes("Master") || false],
    ['Ph.D. or Professional Doctorate (Ph.D., J.D., M.D., etc.)', data.degree_type_0?.includes("PhD") || data.degree_type_0?.includes("Doctorate") || false],
    ['Other (specify below)', false],
  ] as [string, boolean][]) {
    checkbox(`   ${label}`, check, 4)
  }

  row([
    { label: '11.2. Field of Study', value: data.field_0 || data.field_of_work || '' },
    { label: '11.3. Year Degree or Certificate Granted', value: data.grad_year_0 || '' },
  ])
  fullField('11.4. Name of College, University, or Other School Attended', data.university_0 || '')
  row([
    { label: '11.5. City/Town of School', value: '' },
    { label: '11.6. State / Province', value: '' },
    { label: '11.7. Country of School', value: '' },
  ])

  if (!isAdvDeg && data.ea_criteria) {
    y += 4
    _doc.fillColor(NAVY).fontSize(7).font('Helvetica-Bold').text('11.8. Exceptional Ability Criteria Met (check all that apply — need at least 3 of 6):', L, y)
    y += 10
    const ea = data.ea_criteria || ''
    checkbox('   (1) Official academic record showing a degree, diploma, or certificate', ea.includes('degree'))
    checkbox('   (2) Letter(s) documenting at least 10 years of full-time experience', ea.includes('10_years'))
    checkbox('   (3) License to practice the profession or certification', ea.includes('license'))
    checkbox('   (4) Evidence of a salary demonstrating exceptional ability', ea.includes('salary'))
    checkbox('   (5) Membership in a professional association(s)', ea.includes('membership'))
    checkbox('   (6) Recognition for achievements from peers, government, or professional organizations', ea.includes('recognition'))
  }
  y += 4

  // Evidence summary
  partHeader('Part 11 (cont.) — Evidence of Distinction (NIW Prong 2)')
  fullField('Publications (peer-reviewed journals, conference papers, book chapters)', data.publications || 'None documented — attorney to advise', 40)
  row([
    { label: 'Total Citation Count (Google Scholar / Web of Science)', value: data.citations || '0', note: 'Attach screenshot' },
    { label: 'h-index', value: data.h_index || 'N/A' },
  ])
  fullField('Awards and Honors', data.awards || 'None documented')
  fullField('Patents (title, number, country, year)', data.patents || 'None documented')
  fullField('Invited Talks and Conference Presentations', data.talks || 'None documented', 36)
  fullField('Peer Review / Editorial Board / Grant Panel Activity', data.peer_review || 'None documented')
  fullField('Media Coverage (news articles, interviews, profiles)', data.media || 'None documented')
  fullField('Other Evidence of Distinction', data.other_evidence || 'None documented')
  y += 4

  // NIW Prong narrative
  partHeader('NIW Prong Narrative (Attach as Separate Cover Letter — Summary Below)')
  fullField('Proposed Endeavor in the United States (NIW Prong 1 — Substantial Merit)', data.endeavor || '', 50)
  fullField('Why this work is of National Importance (NIW Prong 1 cont.)', data.national_importance || '', 50)
  fullField('Why the waiver of job offer/PERM serves the national interest (NIW Prong 3)', data.national_benefit || '', 50)
  fullField('U.S. Government connections (grants, contracts, federal programmes)', data.gov_connections || 'None documented')
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 12 — PETITIONER SIGNATURE
  // ══════════════════════════════════════════════════════════════════════
  checkPage(80)
  partHeader('Part 12. Contact Information, Declaration, and Signature of the Petitioner')
  infoBox('The petitioner (for NIW: the alien themselves) must sign and date this form in ink. Electronic signatures are not accepted.')
  row([
    { label: '12.1. Petitioner\'s Daytime Phone', value: data.phone || '' },
    { label: '12.2. Petitioner\'s Email Address', value: data.email || '' },
  ])
  fullField('12.3. Petitioner\'s Mailing Address', data.address || '', 28)
  signatureBlock(`Petitioner (Self): ${name}`)
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 13 — INTERPRETER (if used)
  // ══════════════════════════════════════════════════════════════════════
  partHeader('Part 13. Contact Information, Declaration, and Signature of the Interpreter')
  infoBox('Complete only if an interpreter translated this form for the petitioner.')
  row([
    { label: '13.1. Interpreter Family Name', value: '' },
    { label: '13.2. Interpreter Given Name', value: '' },
  ])
  row([
    { label: '13.3. Interpreter\'s Business / Organization Name', value: '' },
    { label: '13.4. Interpreter\'s Phone', value: '' },
  ])
  fullField('13.5. Interpreter\'s Email', '')
  signatureBlock('Interpreter (if applicable)')
  y += 4

  // ══════════════════════════════════════════════════════════════════════
  // PART 14 — PREPARER (ATTORNEY)
  // ══════════════════════════════════════════════════════════════════════
  checkPage(120)
  partHeader('Part 14. Contact Information, Declaration, and Signature of the Person Preparing This Petition',
    'Complete if an attorney or accredited representative prepared or assisted in preparing this petition.')

  row([
    { label: '14.1. Preparer\'s Family Name', value: 'Shair' },
    { label: '14.2. Preparer\'s Given Name', value: 'Mohammad' },
  ])
  fullField('14.3. Business / Law Firm Name', 'MZS Law Firm')
  row([
    { label: '14.4. Preparer\'s Phone', value: '' },
    { label: '14.5. Preparer\'s Email', value: '' },
  ])
  fullField('14.6. Preparer\'s Mailing Address', '')
  row([
    { label: '14.7. Attorney State Bar Number (if attorney)', value: '' },
    { label: '14.8. USCIS Online Account Number (if any)', value: '' },
  ])

  checkbox('14.9.a.  I am an attorney or accredited representative.', true)
  checkbox('14.9.b.  I am not an attorney or accredited representative.', false)
  checkbox('14.10.  I have submitted Form G-28, Notice of Entry of Appearance as Attorney or Representative.', false, 4)

  signatureBlock('Attorney / Preparer: Mohammad Shair, MZS Law Firm')

  // ══════════════════════════════════════════════════════════════════════
  // FILING CHECKLIST (final page)
  // ══════════════════════════════════════════════════════════════════════
  checkPage(200)
  _doc.addPage()
  pageNum++
  y = 30

  _doc.rect(L, y, W, 22).fill(NAVY)
  _doc.fillColor('#B8963E').fontSize(12).font('Helvetica-Bold')
    .text('FILING CHECKLIST — USCIS Form I-140 (EB-2 NIW)', L + 8, y + 5)
  y += 28

  const checklistItems: [string, string][] = [
    ['Form I-140', 'Completed and signed by petitioner'],
    ['Filing Fee', '$700.00 + $600.00 Asylum Program Fee = $1,300.00 total (check payable to "U.S. Department of Homeland Security")'],
    ['Form I-907 (optional)', 'Premium Processing — $2,805.00 for 15 business day adjudication'],
    ['Passport Copy', 'Biographical page of valid passport (all pages with U.S. visa stamps)'],
    ['Degree Certificates', 'Official diplomas/certificates with certified English translation if not in English'],
    ['Academic Transcripts', 'Official transcripts from all institutions attended'],
    ['Credential Evaluation', 'If degree is foreign: evaluation by NACES member organization (e.g. WES, ECE)'],
    ['CV / Resume', 'Comprehensive curriculum vitae'],
    ['Evidence of Advanced Degree / Exceptional Ability', 'Documents establishing EB-2 basis'],
    ['NIW Petition Letter', 'Detailed cover letter arguing all three Dhanasar prongs (attorney-drafted, typically 10-25 pages)'],
    ['Publications List', 'Complete list with citations; copies of key papers'],
    ['Citation Evidence', 'Google Scholar / Web of Science printout showing citation counts and h-index'],
    ['Expert Recommendation Letters', '3-5 letters from independent U.S.-based experts (not co-authors or employers)'],
    ['Award Certificates', 'Certificates, letters, or official notifications of all awards'],
    ['Patent Documents', 'USPTO certificates or application confirmations'],
    ['Media Coverage', 'Printed articles, news coverage, or digital screenshots'],
    ['I-94 Record', 'Printout from i94.cbp.dhs.gov (if currently in U.S.)'],
    ['Prior Approval Notices', 'Copies of any prior visa approvals (H-1B, O-1, etc.)'],
  ]

  const docs = (data.checked_items || '').toLowerCase()

  for (const [item, desc] of checklistItems) {
    checkPage(18)
    const have = docs.includes(item.toLowerCase().split('(')[0].trim().toLowerCase())
    _doc.rect(L, y, 12, 12).stroke('#333').fill(have ? '#16a34a' : '#fff')
    if (have) _doc.fillColor('white').fontSize(8).font('Helvetica-Bold').text('✓', L + 2, y + 1)
    _doc.fillColor(have ? '#16a34a' : '#333').fontSize(8).font('Helvetica-Bold').text(item, L + 16, y + 1)
    _doc.fillColor('#555').fontSize(7).font('Helvetica').text(desc, L + 16, y + 10, { width: W - 20 })
    y += 22
  }

  y += 8
  _doc.rect(L, y, W, 40).fill('#FFF8DC').stroke('#D4A017')
  _doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text('FILING ADDRESS (check uscis.gov for current address):', L + 6, y + 5)
  _doc.fillColor('#333').fontSize(7.5).font('Helvetica')
    .text('Standard mail: USCIS — Nebraska or Texas Service Center (based on petitioner location)', L + 6, y + 16)
    .text('Premium Processing: Same service center address — attach I-907', L + 6, y + 26)
    .text('⚠ Always verify current filing address at uscis.gov/i-140 before submitting — addresses change.', L + 6, y + 35)
  y += 48

  pageFooter()
}
