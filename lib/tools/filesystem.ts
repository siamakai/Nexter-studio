import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'

const HOME = process.env.HOME || process.env.USERPROFILE || '/'
const WORKSPACE = process.env.WORKSPACE_ROOT || HOME

export const filesystemTools = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Use absolute or relative paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute or home-relative path (~/)' },
        start_line: { type: 'number', description: 'Start line (1-indexed, optional)' },
        end_line: { type: 'number', description: 'End line (optional)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file with content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Absolute or home-relative path' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir_path: { type: 'string', description: 'Directory path (default: workspace root)' },
        show_hidden: { type: 'boolean', description: 'Show hidden files (default: false)' },
      },
    },
  },
  {
    name: 'search_files',
    description: 'Search for text/pattern inside files recursively.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Text or regex to search for' },
        dir_path: { type: 'string', description: 'Directory to search in (default: workspace)' },
        file_glob: { type: 'string', description: 'File pattern like *.ts or *.md (optional)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'create_directory',
    description: 'Create a directory (and parents if needed).',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir_path: { type: 'string', description: 'Directory path to create' },
      },
      required: ['dir_path'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file. Use carefully — this is permanent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'File path to delete' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_path: { type: 'string', description: 'Source path' },
        to_path: { type: 'string', description: 'Destination path' },
      },
      required: ['from_path', 'to_path'],
    },
  },
]

function resolvePath(p: string): string {
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2))
  if (path.isAbsolute(p)) return p
  return path.join(WORKSPACE, p)
}

export async function execFilesystemTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case 'read_file': {
        const fullPath = resolvePath(input.file_path as string)
        if (!existsSync(fullPath)) return `File not found: ${fullPath}`
        const content = await fs.readFile(fullPath, 'utf-8')
        const lines = content.split('\n')
        const start = (input.start_line as number | undefined) ?? 1
        const end = (input.end_line as number | undefined) ?? lines.length
        const slice = lines.slice(start - 1, end)
        return `File: ${fullPath} (lines ${start}-${end} of ${lines.length})\n\n${slice.map((l, i) => `${start + i}: ${l}`).join('\n')}`
      }

      case 'write_file': {
        const fullPath = resolvePath(input.file_path as string)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, input.content as string, 'utf-8')
        return `Written: ${fullPath}`
      }

      case 'list_directory': {
        const dirPath = resolvePath((input.dir_path as string) || WORKSPACE)
        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        const showHidden = input.show_hidden as boolean | undefined
        const filtered = entries.filter((e) => showHidden || !e.name.startsWith('.'))
        const lines = await Promise.all(
          filtered.map(async (e) => {
            const icon = e.isDirectory() ? '📁' : '📄'
            if (e.isFile()) {
              const stat = await fs.stat(path.join(dirPath, e.name))
              const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`
              return `${icon} ${e.name} (${size})`
            }
            return `${icon} ${e.name}/`
          })
        )
        return `Contents of ${dirPath}:\n${lines.join('\n')}`
      }

      case 'search_files': {
        const { execSync } = await import('child_process')
        const dirPath = resolvePath((input.dir_path as string) || WORKSPACE)
        const glob = input.file_glob ? `--include="${input.file_glob}"` : ''
        try {
          const result = execSync(
            `grep -rn "${(input.pattern as string).replace(/"/g, '\\"')}" "${dirPath}" ${glob} --max-count=5 2>/dev/null | head -50`,
            { encoding: 'utf-8', timeout: 10000 }
          )
          return result || 'No matches found.'
        } catch {
          return 'No matches found.'
        }
      }

      case 'create_directory': {
        const fullPath = resolvePath(input.dir_path as string)
        await fs.mkdir(fullPath, { recursive: true })
        return `Created: ${fullPath}`
      }

      case 'delete_file': {
        const fullPath = resolvePath(input.file_path as string)
        await fs.unlink(fullPath)
        return `Deleted: ${fullPath}`
      }

      case 'move_file': {
        const from = resolvePath(input.from_path as string)
        const to = resolvePath(input.to_path as string)
        await fs.rename(from, to)
        return `Moved: ${from} → ${to}`
      }

      default:
        return `Unknown filesystem tool: ${name}`
    }
  } catch (err) {
    return `Error: ${String(err)}`
  }
}
