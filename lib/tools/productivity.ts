/**
 * Productivity tools: Tasks, Content Pipeline, Revenue Dashboard, Delegation Tracker
 */

import { addTask, getTasks, markTaskDone, addContent, updateContent, listContent, getContentSummary, assignTask, updateDelegation, listDelegations } from '@/lib/supabase'

export const productivityTools = [
  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    name: 'task_add',
    description: 'Add a task to the to-do list. Use for any action item Siamak needs to do himself.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content:      { type: 'string', description: 'What needs to be done' },
        contact_name: { type: 'string', description: 'Related person or meeting (optional)' },
        due_date:     { type: 'string', description: 'ISO date e.g. 2026-05-20 (optional)' },
      },
      required: ['content'],
    },
  },
  {
    name: 'task_list',
    description: 'List all open tasks from the to-do list. Call this when asked about tasks, to-dos, or what needs to be done.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'task_done',
    description: 'Mark a task as completed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Task ID to mark as done' },
      },
      required: ['id'],
    },
  },

  // ── Content Pipeline ──────────────────────────────────────────────────────
  {
    name: 'content_add',
    description: 'Add a new piece of content to the pipeline (LinkedIn post, reel, blog, email, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Content title or topic' },
        type: { type: 'string', description: 'linkedin | reel | blog | email | other' },
        platform: { type: 'string', description: 'linkedin | instagram | website | newsletter' },
        status: { type: 'string', description: 'idea | drafting | ready | scheduled | published (default: idea)' },
        scheduled_date: { type: 'string', description: 'ISO date e.g. 2026-05-10' },
        notes: { type: 'string' },
      },
      required: ['title', 'type'],
    },
  },
  {
    name: 'content_list',
    description: 'List content in the pipeline — all active, or filter by status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'idea | drafting | ready | scheduled | published (omit for all active)' },
      },
    },
  },
  {
    name: 'content_update',
    description: 'Update a content item — change status, add scheduled date, mark published.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Content item ID' },
        title: { type: 'string' },
        status: { type: 'string', description: 'idea | drafting | ready | scheduled | published' },
        scheduled_date: { type: 'string' },
        published_date: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'content_summary',
    description: 'Get a summary of the full content pipeline — what is in each stage, what is overdue.',
    input_schema: { type: 'object' as const, properties: {} },
  },

  // ── Revenue Dashboard ─────────────────────────────────────────────────────
  {
    name: 'revenue_dashboard',
    description: 'Show the revenue dashboard — this month pipeline value, closed deals, gap to monthly goal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        goal: { type: 'number', description: 'Monthly revenue goal in EUR (default 5000)' },
      },
    },
  },

  // ── Delegation Tracker ────────────────────────────────────────────────────
  {
    name: 'delegation_assign',
    description: 'Assign a task to a team member (employee or intern). Tracks it until done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'What needs to be done' },
        assigned_to: { type: 'string', description: 'Name of the person assigned' },
        due_date: { type: 'string', description: 'ISO date e.g. 2026-05-10' },
        notes: { type: 'string', description: 'Context or instructions' },
      },
      required: ['task', 'assigned_to'],
    },
  },
  {
    name: 'delegation_list',
    description: 'List all active delegations — who is doing what, what is overdue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'assigned | in_progress | done | overdue (omit for all active)' },
        assigned_to: { type: 'string', description: 'Filter by team member name' },
      },
    },
  },
  {
    name: 'delegation_update',
    description: 'Update a delegation — mark done, change status, add notes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Delegation ID' },
        status: { type: 'string', description: 'assigned | in_progress | done | overdue' },
        notes: { type: 'string' },
        due_date: { type: 'string' },
      },
      required: ['id'],
    },
  },
]

export async function execProductivityTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {

    case 'task_add': {
      const task = await addTask(input.content as string, {
        source:       'manual',
        contact_name: input.contact_name as string | undefined,
        due_date:     input.due_date as string | undefined,
      })
      return `✅ Task added: "${task?.content}"${task?.due_date ? ` — due ${task.due_date}` : ''} | ID: ${task?.id}`
    }

    case 'task_list': {
      const tasks = await getTasks(false)
      if (!tasks.length) return 'No open tasks. All clear!'
      return `📋 Open Tasks (${tasks.length}):\n\n` + tasks.map((t, i) => {
        const due     = t.due_date ? ` | Due: ${t.due_date}` : ''
        const overdue = t.due_date && new Date(t.due_date) < new Date() ? ' ⚠️ OVERDUE' : ''
        const contact = t.contact_name ? ` (re: ${t.contact_name})` : ''
        const source  = t.source !== 'manual' ? ` [${t.source}]` : ''
        return `${i + 1}. ${t.content}${contact}${due}${overdue}${source} | ID: ${t.id}`
      }).join('\n')
    }

    case 'task_done': {
      await markTaskDone(input.id as string)
      return `✅ Task ${input.id} marked as done.`
    }

    case 'content_add': {
      const item = await addContent({
        title: input.title as string,
        type: input.type as string,
        platform: input.platform as string | undefined,
        status: (input.status as string) || 'idea',
        scheduled_date: input.scheduled_date as string | undefined,
        notes: input.notes as string | undefined,
      })
      return `✅ Added to content pipeline: "${item?.title}" — Status: ${item?.status}${item?.scheduled_date ? ` | Scheduled: ${item.scheduled_date}` : ''} | ID: ${item?.id}`
    }

    case 'content_list': {
      const items = await listContent(input.status as string | undefined)
      if (!items.length) return `No content found${input.status ? ` with status "${input.status}"` : ''}.`
      return `📱 Content Pipeline (${items.length} items):\n\n` + items.map(i => {
        const date = i.scheduled_date ? ` | 📅 ${i.scheduled_date}` : ''
        const overdue = i.scheduled_date && new Date(i.scheduled_date) < new Date() && i.status !== 'published' ? ' ⚠️ OVERDUE' : ''
        return `• [${i.status.toUpperCase()}] ${i.title} (${i.type})${date}${overdue} | ID: ${i.id}`
      }).join('\n')
    }

    case 'content_update': {
      const updates: Record<string, string> = {}
      if (input.title) updates.title = input.title as string
      if (input.status) updates.status = input.status as string
      if (input.scheduled_date) updates.scheduled_date = input.scheduled_date as string
      if (input.published_date) updates.published_date = input.published_date as string
      if (input.notes) updates.notes = input.notes as string
      await updateContent(input.id as string, updates)
      return `✅ Content item ${input.id} updated.`
    }

    case 'content_summary': {
      const summary = await getContentSummary()
      return `📱 Content Pipeline Summary:\n\n${summary}`
    }

    case 'revenue_dashboard': {
      const goal = (input.goal as number) || 5000
      if (!process.env.GHL_API_KEY) return 'CRM not connected — cannot pull revenue data.'

      try {
        // Get pipelines
        const pipeRes = await fetch(
          `https://services.leadconnectorhq.com/opportunities/pipelines/?locationId=${process.env.GHL_LOCATION_ID}`,
          { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
        )
        const pipeData = await pipeRes.json()
        const pipeline = (pipeData.pipelines || [])[0]
        if (!pipeline) return 'No pipeline found in CRM.'

        // Get open opportunities
        const oppRes = await fetch(
          `https://services.leadconnectorhq.com/opportunities/search/?locationId=${process.env.GHL_LOCATION_ID}&pipelineId=${pipeline.id}&status=open&limit=100`,
          { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
        )
        const oppData = await oppRes.json()
        const opps = oppData.opportunities || []

        // Get won this month
        const wonRes = await fetch(
          `https://services.leadconnectorhq.com/opportunities/search/?locationId=${process.env.GHL_LOCATION_ID}&pipelineId=${pipeline.id}&status=won&limit=100`,
          { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: '2021-07-28' } }
        )
        const wonData = await wonRes.json()
        const thisMonth = new Date(); thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0)
        const wonThisMonth = (wonData.opportunities || []).filter((o: Record<string, unknown>) =>
          new Date((o.updatedAt || o.createdAt) as string) >= thisMonth
        )
        const closedRevenue = wonThisMonth.reduce((s: number, o: Record<string, unknown>) => s + ((o.monetaryValue as number) || 0), 0)
        const pipelineValue = opps.reduce((s: number, o: Record<string, unknown>) => s + ((o.monetaryValue as number) || 0), 0)
        const gap = Math.max(0, goal - closedRevenue)
        const pct = Math.min(100, Math.round((closedRevenue / goal) * 100))

        const topOpps = opps.slice(0, 5).map((o: Record<string, unknown>) =>
          `  • ${o.name} — €${(o.monetaryValue as number || 0).toLocaleString()} [${(o.pipelineStage as Record<string, string>)?.name || '?'}]`
        ).join('\n')

        return [
          `💰 Revenue Dashboard — ${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`,
          ``,
          `Monthly Goal:     €${goal.toLocaleString()}`,
          `Closed This Month: €${closedRevenue.toLocaleString()} (${pct}%) — ${wonThisMonth.length} deal(s)`,
          `Gap to Goal:      €${gap.toLocaleString()}`,
          ``,
          `Open Pipeline:    €${pipelineValue.toLocaleString()} across ${opps.length} deals`,
          ``,
          `Top Open Deals:`,
          topOpps || '  None',
          ``,
          gap > 0
            ? `⚠️ You need €${gap.toLocaleString()} more to hit goal. Focus on closing pipeline deals.`
            : `🎉 Goal achieved! €${(closedRevenue - goal).toLocaleString()} above target.`,
        ].join('\n')
      } catch (err) {
        return `Revenue dashboard error: ${String(err)}`
      }
    }

    case 'delegation_assign': {
      const d = await assignTask({
        task: input.task as string,
        assigned_to: input.assigned_to as string,
        assigned_by: 'Siamak',
        due_date: input.due_date as string | undefined,
        status: 'assigned',
        notes: input.notes as string | undefined,
      })
      return `✅ Task delegated to ${d?.assigned_to}: "${d?.task}"${d?.due_date ? ` — due ${d.due_date}` : ''} | ID: ${d?.id}`
    }

    case 'delegation_list': {
      let delegations = await listDelegations(input.status as string | undefined)
      if (input.assigned_to) {
        delegations = delegations.filter(d => d.assigned_to.toLowerCase().includes((input.assigned_to as string).toLowerCase()))
      }
      if (!delegations.length) return 'No active delegations found.'
      return `👥 Delegations (${delegations.length}):\n\n` + delegations.map(d => {
        const due = d.due_date ? ` | Due: ${d.due_date}` : ''
        const overdue = d.due_date && new Date(d.due_date) < new Date() && d.status !== 'done' ? ' ⚠️' : ''
        return `• ${d.assigned_to}: ${d.task}${due} [${d.status}]${overdue} | ID: ${d.id}`
      }).join('\n')
    }

    case 'delegation_update': {
      const updates: Record<string, string> = {}
      if (input.status) updates.status = input.status as string
      if (input.notes) updates.notes = input.notes as string
      if (input.due_date) updates.due_date = input.due_date as string
      await updateDelegation(input.id as string, updates)
      return `✅ Delegation ${input.id} updated to: ${input.status || 'updated'}`
    }

    default:
      return `Unknown productivity tool: ${name}`
  }
}
