import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const bashTools = [
  {
    name: 'run_command',
    description: 'Run a bash/shell command on the local machine. Returns stdout and stderr.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        working_dir: { type: 'string', description: 'Working directory (optional, defaults to HOME)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
      },
      required: ['command'],
    },
  },
]

// Commands that are never allowed regardless of user request
const BLOCKED = ['rm -rf /', 'format', 'mkfs', 'dd if=', '> /dev/sd']

export async function execBashTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name !== 'run_command') return `Unknown bash tool: ${name}`

  const command = input.command as string
  const workingDir = (input.working_dir as string) || process.env.HOME || '/'
  const timeout = (input.timeout_ms as number) || 30000

  // Safety check
  if (BLOCKED.some((b) => command.includes(b))) {
    return `Blocked: this command is not allowed for safety reasons.`
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      timeout,
      env: { ...process.env, TERM: 'dumb' },
    })

    const out = [
      stdout ? `stdout:\n${stdout.trim()}` : '',
      stderr ? `stderr:\n${stderr.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')

    return out || '(no output)'
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; message?: string }
    const out = [
      error.stdout ? `stdout:\n${error.stdout.trim()}` : '',
      error.stderr ? `stderr:\n${error.stderr.trim()}` : '',
      `error: ${error.message || String(err)}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    return out
  }
}
