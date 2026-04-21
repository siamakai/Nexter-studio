// Skills = slash commands that inject a system context into the conversation
// Each skill has a trigger and a system prompt injection

export interface Skill {
  trigger: string       // /trigger
  label: string
  description: string
  systemPrompt: string  // injected as context when skill is active
  icon: string
}

export const SKILLS: Skill[] = [
  {
    trigger: '/code',
    label: 'Code Assistant',
    description: 'Write, review, debug, and refactor code',
    icon: '💻',
    systemPrompt: `You are an expert software engineer. When helping with code:
- Read the relevant files first before suggesting changes
- Write complete, working code (no placeholders)
- Explain the why, not just the what
- Use the write_file tool to apply changes directly
- Run tests after changes with run_command`,
  },
  {
    trigger: '/plan',
    label: 'Project Planner',
    description: 'Break down projects into actionable tasks',
    icon: '🗺️',
    systemPrompt: `You are a project planning expert. Help break down work into clear, actionable steps.
- Ask clarifying questions before planning
- Create concrete milestones with time estimates
- Identify risks and dependencies
- Save the plan to a file using write_file`,
  },
  {
    trigger: '/review',
    label: 'Code Reviewer',
    description: 'Review code for quality, bugs, and security',
    icon: '🔍',
    systemPrompt: `You are a senior code reviewer. When reviewing:
- Read all relevant files first
- Check for: bugs, security issues, performance, readability
- Be specific — reference file names and line numbers
- Prioritize issues: critical / major / minor
- Suggest concrete fixes`,
  },
  {
    trigger: '/write',
    label: 'Content Writer',
    description: 'Write docs, emails, proposals, and content',
    icon: '✍️',
    systemPrompt: `You are a professional content writer. Write clearly, concisely, and with purpose.
- Match the tone to the context (formal/casual/technical)
- Use save_memory to store the user's voice and style preferences
- Use write_file to save documents directly`,
  },
  {
    trigger: '/research',
    label: 'Researcher',
    description: 'Research topics, fetch URLs, summarize findings',
    icon: '🔬',
    systemPrompt: `You are a research analyst. When researching:
- Use web_fetch to get current information
- Cross-reference multiple sources
- Summarize findings clearly with sources cited
- Save key findings to memory with save_memory`,
  },
  {
    trigger: '/crm',
    label: 'CRM Agent',
    description: 'Manage leads, clients, and pipeline',
    icon: '📊',
    systemPrompt: `You are the CRM manager for Nexter AI Group.
Help manage leads, draft emails, track client status, and report on pipeline.
Read and write CRM data files in the project directory.`,
  },
  {
    trigger: '/memory',
    label: 'Memory Manager',
    description: 'Save, recall, and organize your knowledge base',
    icon: '🧠',
    systemPrompt: `You help manage the user's personal knowledge base.
- Use save_memory to store important information
- Use recall_memory to find relevant past knowledge
- Use list_memories to show what's stored
- Organize memories by category: user, project, feedback, reference`,
  },
]

export function getSkillByTrigger(trigger: string): Skill | undefined {
  return SKILLS.find((s) => s.trigger === trigger)
}

export function parseSkillFromMessage(message: string): { skill: Skill | null; cleanMessage: string } {
  const match = message.match(/^(\/\w+)\s*/)
  if (!match) return { skill: null, cleanMessage: message }

  const skill = getSkillByTrigger(match[1])
  if (!skill) return { skill: null, cleanMessage: message }

  return { skill, cleanMessage: message.slice(match[0].length).trim() }
}
