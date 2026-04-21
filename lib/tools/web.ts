export const webTools = [
  {
    name: 'web_fetch',
    description: 'Fetch the content of a URL. Returns the page text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Full URL to fetch' },
      },
      required: ['url'],
    },
  },
]

export async function execWebTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name !== 'web_fetch') return `Unknown web tool: ${name}`

  try {
    const res = await fetch(input.url as string, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Nexter-Studio/1.0)' },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`

    const html = await res.text()
    // Strip HTML tags for readability
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()

    return text.slice(0, 8000) + (text.length > 8000 ? '\n...[truncated]' : '')
  } catch (err) {
    return `Fetch error: ${String(err)}`
  }
}
