import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { filesystemTools, execFilesystemTool } from '@/lib/tools/filesystem'
import { bashTools, execBashTool } from '@/lib/tools/bash'
import { memoryTools, execMemoryTool } from '@/lib/tools/memory'
import { webTools, execWebTool } from '@/lib/tools/web'
import { gmailTools, execGmailTool } from '@/lib/tools/gmail'
import { calendarTools, execCalendarTool } from '@/lib/tools/calendar'
import { calendlyTools, execCalendlyTool } from '@/lib/tools/calendly'
import { zoomTools, execZoomTool } from '@/lib/tools/zoom'
import { ghlTools, execGhlTool } from '@/lib/tools/ghl'
import { microsoftTools, execMicrosoftTool } from '@/lib/tools/microsoft'
import { parseSkillFromMessage, SKILLS } from '@/lib/skills'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = 'claude-sonnet-4-6'

const ALL_TOOLS = [...filesystemTools, ...bashTools, ...memoryTools, ...webTools, ...ghlTools, ...gmailTools, ...calendarTools, ...microsoftTools, ...calendlyTools, ...zoomTools]

const BASE_SYSTEM = `You are Nexter Studio — an AI assistant running locally on the user's machine.

You have full access to:
- The local filesystem (read, write, list, search files)
- Bash/terminal (run any shell command)
- Long-term memory (save and recall information across sessions)
- Web (fetch URLs and pages)
- Go High Level CRM (create/search contacts, add notes, manage pipeline opportunities)
- Gmail (read inbox, send emails)
- Google Calendar (list events, create events)
- Microsoft 365 / Outlook (read inbox, send email, calendar — use ms_* tools with account_email)
- Calendly (list upcoming bookings, get invitee details)
- Zoom (create meetings and get join links)

When a Calendly booking comes in, proactively: create a Zoom meeting, add a Google Calendar event with the Zoom link, and send a confirmation email to the invitee.

Your working directory and home folder are fully accessible.

Rules:
- Always read files before editing them
- Be direct and action-oriented — use tools proactively
- Show file paths when referencing files
- For code: write complete implementations, not snippets
- After writing files, confirm with the exact path
- For destructive operations (delete, overwrite), briefly confirm intent first

Available skills the user can activate with slash commands:
${SKILLS.map((s) => `${s.trigger} — ${s.description}`).join('\n')}`

export async function POST(req: NextRequest) {
  const { message, history = [], workspaceRoot, attachments = [] } = await req.json()

  if (workspaceRoot) process.env.WORKSPACE_ROOT = workspaceRoot

  const { skill, cleanMessage } = parseSkillFromMessage(message)
  const systemPrompt = skill
    ? `${BASE_SYSTEM}\n\n## Active Skill: ${skill.label}\n${skill.systemPrompt}`
    : BASE_SYSTEM

  // Build user content — text + any image/file attachments
  type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

  const userContent: ContentBlock[] = []
  if (attachments.length > 0) {
    for (const att of attachments as { name: string; type: string; data: string }[]) {
      if (att.type.startsWith('image/')) {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: att.type, data: att.data } })
      } else {
        // Text file — decode and include as text
        const text = Buffer.from(att.data, 'base64').toString('utf-8')
        userContent.push({ type: 'text', text: `[File: ${att.name}]\n${text}` })
      }
    }
  }
  userContent.push({ type: 'text', text: cleanMessage || message })

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-20),
    { role: 'user', content: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : (userContent as Anthropic.MessageParam['content']) },
  ]

  // Stream the response using SSE
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const write = (data: object) =>
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

  // Run agentic loop in background
  ;(async () => {
    try {
      if (skill) {
        await write({ type: 'skill', skill: { trigger: skill.trigger, label: skill.label, icon: skill.icon } })
      }

      while (true) {
        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 8096,
          system: systemPrompt,
          tools: ALL_TOOLS,
          messages,
          stream: true,
        })

        let fullText = ''
        const toolUses: Array<{ id: string; name: string; input: string }> = []
        let currentToolId = ''
        let currentToolName = ''
        let currentToolInput = ''
        let stopReason = ''

        for await (const event of response) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              currentToolId = event.content_block.id
              currentToolName = event.content_block.name
              currentToolInput = ''
              await write({ type: 'tool_start', tool: currentToolName })
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              fullText += event.delta.text
              await write({ type: 'text_delta', text: event.delta.text })
            } else if (event.delta.type === 'input_json_delta') {
              currentToolInput += event.delta.partial_json
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolName) {
              toolUses.push({ id: currentToolId, name: currentToolName, input: currentToolInput })
              currentToolName = ''
            }
          } else if (event.type === 'message_delta') {
            stopReason = event.delta.stop_reason || ''
          }
        }

        if (stopReason === 'end_turn' || toolUses.length === 0) break

        // Execute tools
        type AssistantBlock =
          | Anthropic.TextBlockParam
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        const assistantContent: AssistantBlock[] = []
        if (fullText) assistantContent.push({ type: 'text', text: fullText })
        for (const tu of toolUses) {
          let parsedInput: Record<string, unknown> = {}
          try { parsedInput = JSON.parse(tu.input) } catch { /* empty input */ }
          assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: parsedInput })
        }
        messages.push({ role: 'assistant', content: assistantContent as Anthropic.MessageParam['content'] })

        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const tu of toolUses) {
          let parsedInput: Record<string, unknown> = {}
          try { parsedInput = JSON.parse(tu.input) } catch { /* empty */ }

          let result: string
          if (filesystemTools.find((t) => t.name === tu.name)) {
            result = await execFilesystemTool(tu.name, parsedInput)
          } else if (bashTools.find((t) => t.name === tu.name)) {
            result = await execBashTool(tu.name, parsedInput)
          } else if (memoryTools.find((t) => t.name === tu.name)) {
            result = await execMemoryTool(tu.name, parsedInput)
          } else if (webTools.find((t) => t.name === tu.name)) {
            result = await execWebTool(tu.name, parsedInput)
          } else if (ghlTools.find((t) => t.name === tu.name)) {
            result = await execGhlTool(tu.name, parsedInput)
          } else if (gmailTools.find((t) => t.name === tu.name)) {
            result = await execGmailTool(tu.name, parsedInput)
          } else if (calendarTools.find((t) => t.name === tu.name)) {
            result = await execCalendarTool(tu.name, parsedInput)
          } else if (microsoftTools.find((t) => t.name === tu.name)) {
            result = await execMicrosoftTool(tu.name, parsedInput)
          } else if (calendlyTools.find((t) => t.name === tu.name)) {
            result = await execCalendlyTool(tu.name, parsedInput)
          } else if (zoomTools.find((t) => t.name === tu.name)) {
            result = await execZoomTool(tu.name, parsedInput)
          } else {
            result = `Unknown tool: ${tu.name}`
          }

          await write({ type: 'tool_result', tool: tu.name, result: result.slice(0, 500) })
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result })
        }

        messages.push({ role: 'user', content: toolResults })
      }

      await write({ type: 'done' })
    } catch (err) {
      await write({ type: 'error', message: String(err) })
    } finally {
      await writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
