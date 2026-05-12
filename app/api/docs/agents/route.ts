import { NextResponse } from 'next/server'

const BASE = 'https://bombsell.com'

export async function GET() {
  return NextResponse.json({
    openapi: '3.0.3',
    info: {
      title: 'Bombsell Agent API',
      version: '1.0.0',
      description: 'A2A-compatible GTM infrastructure for discovering agents, dispatching single-agent tasks, running workflows, receiving webhooks, and managing agent keys.',
    },
    servers: [
      { url: BASE, description: 'Production' },
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    tags: [
      { name: 'Agents' },
      { name: 'Workflows' },
      { name: 'Keys' },
      { name: 'Events' },
      { name: 'Webhooks' },
    ],
    paths: {
      '/api/a2a/agents': {
        get: {
          tags: ['Agents'],
          summary: 'List system agents',
          responses: {
            200: { description: 'Registered agent profiles and health state.' },
          },
        },
      },
      '/api/a2a/workflows': {
        get: {
          tags: ['Workflows'],
          summary: 'List workflow definitions',
          responses: {
            200: { description: 'Available multi-agent workflow definitions.' },
          },
        },
        post: {
          tags: ['Workflows'],
          summary: 'Dispatch a multi-agent workflow',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['workflow'],
                  properties: {
                    workflow: { type: 'string', enum: ['outbound', 'content', 'full-funnel', 'signal-to-insight', 'enrich-and-outreach', 'reply-handling'] },
                    context: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Workflow dispatch result.' },
            400: { description: 'Invalid request.' },
            401: { description: 'Unauthorized.' },
          },
        },
      },
      '/api/agents': {
        get: {
          tags: ['Agents'],
          summary: 'List external agent identities for the signed-in workspace',
          responses: { 200: { description: 'Agent identities.' } },
        },
        post: {
          tags: ['Agents'],
          summary: 'Register an external agent identity',
          responses: { 201: { description: 'Agent identity created.' } },
        },
      },
      '/api/agents/{role}': {
        get: {
          tags: ['Agents'],
          summary: 'Inspect a system agent by role',
          parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Agent profile, capabilities, version, and health.' },
            404: { description: 'Unknown role.' },
          },
        },
      },
      '/api/agents/{role}/dispatch': {
        post: {
          tags: ['Agents'],
          summary: 'Dispatch a task to one system agent',
          parameters: [{ name: 'role', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['tool', 'arguments'],
                  properties: {
                    tool: { type: 'string' },
                    arguments: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Task result.' },
            401: { description: 'Unauthorized.' },
            404: { description: 'Unknown role.' },
          },
        },
      },
      '/api/agents/events': {
        get: {
          tags: ['Events'],
          summary: 'List recent agent events for the signed-in workspace',
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } }],
          responses: { 200: { description: 'Recent event rows.' } },
        },
      },
      '/api/agents/keys': {
        get: {
          tags: ['Keys'],
          summary: 'List API keys for an external agent identity',
          parameters: [{ name: 'agent_id', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Key metadata. Raw secret is never returned.' } },
        },
        post: {
          tags: ['Keys'],
          summary: 'Create an API key for an external agent identity',
          responses: { 201: { description: 'Key metadata plus one-time raw api_key.' } },
        },
        delete: {
          tags: ['Keys'],
          summary: 'Revoke an API key',
          responses: { 200: { description: 'Revoked.' } },
        },
      },
      '/api/agents/wallet': {
        get: {
          tags: ['Keys'],
          summary: 'Inspect an agent wallet',
          parameters: [{ name: 'agent_id', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Wallet balance and auto top-up state.' } },
        },
        post: {
          tags: ['Keys'],
          summary: 'Top up an agent wallet',
          responses: { 200: { description: 'Updated wallet.' } },
        },
      },
      '/api/agents/webhook': {
        get: {
          tags: ['Webhooks'],
          summary: 'Webhook endpoint metadata',
          responses: { 200: { description: 'Webhook endpoint information.' } },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Receive external agent task results',
          responses: { 200: { description: 'Accepted.' } },
        },
      },
      '/api/agents/webhooks': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhook subscriptions',
          responses: { 200: { description: 'Webhook subscriptions.' } },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Create webhook subscription',
          responses: { 201: { description: 'Webhook subscription created.' } },
        },
        delete: {
          tags: ['Webhooks'],
          summary: 'Delete webhook subscription',
          responses: { 200: { description: 'Deleted.' } },
        },
      },
    },
    components: {
      securitySchemes: {
        AgentKey: { type: 'http', scheme: 'bearer', description: 'Use the one-time key returned by POST /api/agents/keys.' },
        Session: { type: 'http', scheme: 'bearer' },
      },
    },
  })
}
