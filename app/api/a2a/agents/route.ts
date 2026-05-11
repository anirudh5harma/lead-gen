import { NextResponse } from 'next/server'
import { ensureBootstrapped, listAgents } from '@/lib/agents/core/registry'

// GET /api/a2a/agents — list all system agents (for Agent OS fleet view)
export async function GET() {
  ensureBootstrapped()
  const agents = listAgents()
  return NextResponse.json({ agents })
}
