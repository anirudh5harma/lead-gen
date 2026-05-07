#!/usr/bin/env node

/**
 * Bombsell MCP Stdio Proxy
 * Bridges stdio (for Codex/Claude Code) to Bombsell's HTTP MCP endpoint.
 *
 * Usage with user's Google session token:
 *   BOMBSELL_MCP_URL=https://bombsell.com/api/mcp \
 *   BOMBSELL_MCP_TOKEN=<supabase_session_token> \
 *   node scripts/mcp-stdio-proxy.mjs
 *
 * Usage with agent API key:
 *   BOMBSELL_MCP_URL=https://bombsell.com/api/mcp \
 *   BOMBSELL_AGENT_API_KEY=bsk_agt_xxxxxxxx \
 *   node scripts/mcp-stdio-proxy.mjs
 *
 * Claude Code config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "bombsell": {
 *         "command": "node",
 *         "args": ["/path/to/scripts/mcp-stdio-proxy.mjs"],
 *         "env": {
 *           "BOMBSELL_MCP_URL": "https://bombsell.com/api/mcp",
 *           "BOMBSELL_MCP_TOKEN": "your-supabase-token"
 *         }
 *       }
 *     }
 *   }
 */

import readline from 'node:readline'

const endpoint = process.env.BOMBSELL_MCP_URL
const token = process.env.BOMBSELL_MCP_TOKEN
const agentKey = process.env.BOMBSELL_AGENT_API_KEY

if (!endpoint) {
  console.error('BOMBSELL_MCP_URL is required.')
  console.error('')
  console.error('Option 1 — User session (Claude Code):')
  console.error('  BOMBSELL_MCP_URL=https://bombsell.com/api/mcp BOMBSELL_MCP_TOKEN=<token> node scripts/mcp-stdio-proxy.mjs')
  console.error('')
  console.error('Option 2 — Agent API key:')
  console.error('  BOMBSELL_MCP_URL=https://bombsell.com/api/mcp BOMBSELL_AGENT_API_KEY=bsk_agt_xxx node scripts/mcp-stdio-proxy.mjs')
  process.exit(1)
}

if (!token && !agentKey) {
  console.error('Either BOMBSELL_MCP_TOKEN (user session) or BOMBSELL_AGENT_API_KEY (agent key) is required.')
  process.exit(1)
}

const authHeader = agentKey
  ? `Bearer ${agentKey}`
  : `Bearer ${token}`

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', async line => {
  const payload = line.trim()
  if (!payload) return

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'Accept': 'application/json, text/event-stream',
      },
      body: payload,
    })

    if (response.status === 204) return
    const text = await response.text()
    if (text) process.stdout.write(`${text}\n`)
  } catch (error) {
    let id = null
    try {
      id = JSON.parse(payload)?.id ?? null
    } catch {}

    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : 'MCP proxy request failed',
      },
    })}\n`)
  }
})
