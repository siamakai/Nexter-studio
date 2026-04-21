import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

const MEMORY_DIR = path.join(process.cwd(), 'memory')

export const memoryTools = [
  {
    name: 'save_memory',
    description: 'Save a piece of information to long-term memory for future sessions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title for this memory' },
        content: { type: 'string', description: 'What to remember' },
        category: { type: 'string', description: 'Category: user | project | feedback | reference' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'recall_memory',
    description: 'Search saved memories for relevant information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What to look for in memories' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_memories',
    description: 'List all saved memory files.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
]

export async function execMemoryTool(name: string, input: Record<string, unknown>): Promise<string> {
  await fs.mkdir(MEMORY_DIR, { recursive: true })

  switch (name) {
    case 'save_memory': {
      const filename = `${(input.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`
      const filepath = path.join(MEMORY_DIR, filename)
      const content = `---\ntitle: ${input.title}\ncategory: ${input.category || 'general'}\nsaved: ${new Date().toISOString()}\n---\n\n${input.content}`
      await fs.writeFile(filepath, content, 'utf-8')
      return `Memory saved: ${filename}`
    }

    case 'recall_memory': {
      if (!existsSync(MEMORY_DIR)) return 'No memories saved yet.'
      const files = await fs.readdir(MEMORY_DIR)
      const query = (input.query as string).toLowerCase()
      const results: string[] = []

      for (const file of files.filter((f) => f.endsWith('.md'))) {
        const content = await fs.readFile(path.join(MEMORY_DIR, file), 'utf-8')
        if (content.toLowerCase().includes(query)) {
          results.push(`--- ${file} ---\n${content}`)
        }
      }

      return results.length > 0
        ? results.join('\n\n')
        : `No memories found matching: ${input.query}`
    }

    case 'list_memories': {
      if (!existsSync(MEMORY_DIR)) return 'No memories saved yet.'
      const files = await fs.readdir(MEMORY_DIR)
      const mdFiles = files.filter((f) => f.endsWith('.md'))
      if (mdFiles.length === 0) return 'No memories saved yet.'
      return `Saved memories (${mdFiles.length}):\n${mdFiles.map((f) => `• ${f}`).join('\n')}`
    }

    default:
      return `Unknown memory tool: ${name}`
  }
}
