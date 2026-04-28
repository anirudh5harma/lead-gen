#!/usr/bin/env node

import readline from 'node:readline'

const endpoint = process.env.BOMBSELL_MCP_URL
const token = process.env.BOMBSELL_MCP_TOKEN

if (!endpoint || !token) {
  console.error('BOMBSELL_MCP_URL and BOMBSELL_MCP_TOKEN are required.')
  process.exit(1)
}

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
        'Authorization': `Bearer ${token}`,
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
