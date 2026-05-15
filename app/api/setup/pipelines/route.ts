import { type NextRequest, NextResponse } from 'next/server'

// Utility endpoint — hit this once after creating your GHL pipeline to get all IDs.
// Then add them to Vercel environment variables.
// Read-only — pipeline IDs are not sensitive.

export async function GET(_req: NextRequest) {
  if (!process.env.GHL_API_KEY || !process.env.GHL_LOCATION_ID) {
    return NextResponse.json({ error: 'GHL_API_KEY or GHL_LOCATION_ID not set' }, { status: 500 })
  }

  const res = await fetch(
    `https://services.leadconnectorhq.com/opportunities/pipelines?locationId=${process.env.GHL_LOCATION_ID}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: '2021-07-28',
      },
    }
  )

  if (!res.ok) {
    return NextResponse.json({ error: `GHL returned ${res.status}`, body: await res.text() }, { status: 500 })
  }

  const data = await res.json()
  const pipelines = data.pipelines || []

  if (!pipelines.length) {
    return NextResponse.json({
      message: 'No pipelines found. Create one in GHL first: Opportunities → Pipelines → + New Pipeline',
      pipelines: [],
    })
  }

  // Format as ready-to-paste Vercel env vars
  const envVars: Record<string, string> = {}
  const output = pipelines.map((p: { id: string; name: string; stages: { id: string; name: string }[] }) => {
    // Suggest the first pipeline as the main one if only one exists
    if (pipelines.length === 1) {
      envVars['GHL_PIPELINE_ID'] = p.id
    }

    const stageMap: Record<string, string> = {
      'new lead':       'GHL_STAGE_NEW_LEAD',
      'qualified':      'GHL_STAGE_QUALIFIED',
      'proposal':       'GHL_STAGE_PROPOSAL',
      'proposal sent':  'GHL_STAGE_PROPOSAL',
      'negotiation':    'GHL_STAGE_NEGOTIATION',
      'won':            'GHL_STAGE_WON',
    }

    const stages = p.stages.map((s: { id: string; name: string }) => {
      const envKey = stageMap[s.name.toLowerCase()]
      if (envKey) envVars[envKey] = s.id
      return { name: s.name, id: s.id, env_var: envKey || '(no mapping — add manually)' }
    })

    return { pipeline: p.name, pipeline_id: p.id, stages }
  })

  return NextResponse.json({
    pipelines: output,
    vercel_env_vars: envVars,
    instructions: [
      '1. Copy the env vars below into Vercel: Settings → Environment Variables',
      '2. Add GHL_PIPELINE_ID and each GHL_STAGE_* key',
      '3. Redeploy or wait for the next cron run — pipeline stages will be set automatically on new prospects',
    ],
  }, { status: 200 })
}
