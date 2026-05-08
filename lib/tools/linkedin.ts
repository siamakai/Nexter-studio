import Anthropic from '@anthropic-ai/sdk'

const BASE         = 'https://api.linkedin.com/v2'
const ACCESS_TOKEN = process.env.LINKEDIN_ACCESS_TOKEN!
const PERSON_URN   = process.env.LINKEDIN_PERSON_URN!  // urn:li:person:XXXXXXX

async function liGet(path: string) {
  if (!ACCESS_TOKEN) throw new Error('LINKEDIN_ACCESS_TOKEN not configured')
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'LinkedIn-Version': '202401', 'X-Restli-Protocol-Version': '2.0.0' },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(json))
  return json
}

async function liPost(path: string, body: object) {
  if (!ACCESS_TOKEN) throw new Error('LINKEDIN_ACCESS_TOKEN not configured')
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'LinkedIn-Version': '202401', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(JSON.stringify(json))
  return json
}

async function getProfile(): Promise<string> {
  if (!ACCESS_TOKEN) return 'LinkedIn not configured. Add LINKEDIN_ACCESS_TOKEN and LINKEDIN_PERSON_URN to environment variables.'
  const data = await liGet('/me?projection=(id,localizedFirstName,localizedLastName,localizedHeadline,vanityName)')
  return `LinkedIn Profile:
Name: ${data.localizedFirstName} ${data.localizedLastName}
Headline: ${data.localizedHeadline || 'N/A'}
URL: https://linkedin.com/in/${data.vanityName || data.id}`
}

async function createPost(text: string, visibility: 'PUBLIC' | 'CONNECTIONS' = 'PUBLIC'): Promise<string> {
  if (!ACCESS_TOKEN || !PERSON_URN) return 'LinkedIn not configured.'
  await liPost('/ugcPosts', {
    author: PERSON_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': visibility },
  })
  return `✅ LinkedIn post published (${visibility}).`
}

async function createPostWithLink(text: string, url: string, title: string, description: string): Promise<string> {
  if (!ACCESS_TOKEN || !PERSON_URN) return 'LinkedIn not configured.'
  await liPost('/ugcPosts', {
    author: PERSON_URN,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: url, title: { text: title }, description: { text: description } }],
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  })
  return `✅ LinkedIn article post published with link: ${url}`
}

async function getRecentPosts(): Promise<string> {
  if (!ACCESS_TOKEN || !PERSON_URN) return 'LinkedIn not configured.'
  const personId = PERSON_URN.split(':').pop()
  const data = await liGet(`/ugcPosts?q=authors&authors=List(${encodeURIComponent(PERSON_URN)})&count=10`)
  if (!data.elements || data.elements.length === 0) return 'No recent LinkedIn posts found.'
  const lines = data.elements.map((p: Record<string,unknown>, i: number) => {
    const content = (p.specificContent as Record<string,unknown>)?.['com.linkedin.ugc.ShareContent'] as Record<string,unknown>
    const text = (content?.shareCommentary as Record<string,unknown>)?.text || '(no text)'
    const created = new Date((p.created as Record<string,number>)?.time || 0).toLocaleDateString('en-GB')
    return `${i+1}. [${created}] ${String(text).slice(0, 120)}${String(text).length > 120 ? '…' : ''}`
  })
  void personId
  return `Recent LinkedIn Posts (${lines.length}):\n\n${lines.join('\n\n')}`
}

async function searchPeople(keywords: string): Promise<string> {
  if (!ACCESS_TOKEN) return 'LinkedIn not configured.'
  // People search using the People API
  const encoded = encodeURIComponent(keywords)
  const data = await liGet(`/people?q=keywords&keywords=${encoded}&count=10`)
  if (!data.elements || data.elements.length === 0) return `No LinkedIn profiles found for "${keywords}".`
  const lines = data.elements.map((p: Record<string,unknown>, i: number) =>
    `${i+1}. ${p.localizedFirstName} ${p.localizedLastName} — ${p.localizedHeadline || ''}`
  )
  return `LinkedIn People Search: "${keywords}"\n\n${lines.join('\n')}`
}

// ─── Tool definitions ─────────────────────────────────────────────────────────
export const linkedinTools: Anthropic.Tool[] = [
  {
    name: 'linkedin_get_profile',
    description: 'Get the connected LinkedIn profile details.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'linkedin_create_post',
    description: 'Publish a text post to LinkedIn.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text:       { type: 'string', description: 'The post text content' },
        visibility: { type: 'string', description: '"PUBLIC" or "CONNECTIONS" (default: PUBLIC)', enum: ['PUBLIC','CONNECTIONS'] },
      },
      required: ['text'],
    },
  },
  {
    name: 'linkedin_create_post_with_link',
    description: 'Publish a LinkedIn post with an article/link preview.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text:        { type: 'string', description: 'Post commentary text' },
        url:         { type: 'string', description: 'URL to share' },
        title:       { type: 'string', description: 'Article title' },
        description: { type: 'string', description: 'Article description' },
      },
      required: ['text', 'url', 'title', 'description'],
    },
  },
  {
    name: 'linkedin_get_recent_posts',
    description: 'Get your recent LinkedIn posts and their engagement.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'linkedin_search_people',
    description: 'Search LinkedIn for people by name or keywords.',
    input_schema: {
      type: 'object' as const,
      properties: { keywords: { type: 'string', description: 'Search terms e.g. "AI lawyer Budapest"' } },
      required: ['keywords'],
    },
  },
]

export async function execLinkedInTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'linkedin_get_profile':         return await getProfile()
      case 'linkedin_create_post':         return await createPost(input.text as string, (input.visibility as 'PUBLIC'|'CONNECTIONS') || 'PUBLIC')
      case 'linkedin_create_post_with_link': return await createPostWithLink(input.text as string, input.url as string, input.title as string, input.description as string)
      case 'linkedin_get_recent_posts':    return await getRecentPosts()
      case 'linkedin_search_people':       return await searchPeople(input.keywords as string)
      default:                             return `Unknown LinkedIn tool: ${name}`
    }
  } catch (e) {
    return `LinkedIn error: ${String(e)}`
  }
}
