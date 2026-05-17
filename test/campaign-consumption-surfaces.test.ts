import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('MCP exposes campaigns as agent-consumable tools and resources', async () => {
  const source = await readFile(new URL('../app/api/mcp/route.ts', import.meta.url), 'utf8')
  for (const tool of [
    'list_campaigns',
    'get_campaign',
    'create_campaign',
    'enroll_campaign_targets',
    'link_campaign_content',
    'update_campaign_status',
  ]) {
    assert.match(source, new RegExp(`['"]${tool}['"]`), `${tool} should be registered and advertised`)
  }
  assert.match(source, /bombsell:\/\/campaigns/, 'campaigns should be exposed as an MCP resource')
  assert.match(source, /updateCampaignTargetsForLead/, 'agent lead-status changes should sync campaign target outcomes')
})

test('remote voice control describes campaigns navigation', async () => {
  const source = await readFile(new URL('../lib/remote-control/dashboard.ts', import.meta.url), 'utf8')
  assert.match(source, /campaigns:\s+'Campaigns is your GTM orchestration layer/)
  assert.match(source, /Campaigns: "take me to campaigns"/)
})

test('agent SDK exposes campaign orchestration helpers', async () => {
  const source = await readFile(new URL('../lib/bombsell-sdk.ts', import.meta.url), 'utf8')
  assert.match(source, /campaigns\s*=\s*{/, 'SDK should expose a campaigns namespace')
  for (const method of ['list', 'get', 'create', 'fromPrompt', 'discover', 'enrollTargets', 'linkContent', 'updateStatus']) {
    assert.match(source, new RegExp(`${method}:`), `SDK campaigns.${method} should exist`)
  }
})

test('product exposes prompt-to-campaign Exa discovery route and UI entrypoint', async () => {
  const listRoute = await readFile(new URL('../app/api/gtm/campaigns/route.ts', import.meta.url), 'utf8')
  assert.match(listRoute, /neq\('status', 'dismissed'\)/, 'Campaigns list should hide removed campaigns by default')

  const route = await readFile(new URL('../app/api/gtm/campaigns/from-prompt/route.ts', import.meta.url), 'utf8')
  assert.match(route, /discoverCampaignCandidatesWithExa/, 'route should call the Exa discovery provider')
  assert.match(route, /createCampaignWebsetWithExa/, 'route should use Websets for large target counts')
  assert.match(route, /materializeCampaignCandidates/, 'route should stage discovered leads into campaign targets')

  const materialization = await readFile(new URL('../lib/gtm/campaign-target-materialization.ts', import.meta.url), 'utf8')
  assert.match(materialization, /consumeLeadCredit/, 'campaign target materialization should use existing lead-credit controls')
  assert.match(materialization, /gtm_campaign_targets/, 'campaign target materialization should stage leads into campaign targets')

  const discoverRoute = await readFile(new URL('../app/api/gtm/campaigns/[id]/discover/route.ts', import.meta.url), 'utf8')
  assert.match(discoverRoute, /syncCampaignWebsetWithExa/, 'campaigns should be able to sync async Webset results')
  assert.match(discoverRoute, /chooseCampaignDiscoveryMode/, 'campaign discovery should use the 25-target threshold')

  const view = await readFile(new URL('../components/dashboard/CampaignsView.tsx', import.meta.url), 'utf8')
  assert.match(view, /Prompt to campaign/, 'Campaigns UI should expose a prompt-first creation path')
  assert.match(view, /\/api\/gtm\/campaigns\/from-prompt/, 'Campaigns UI should call the prompt route')
  assert.match(view, /\/api\/gtm\/campaigns\/\$\{campaign.id\}\/discover/, 'Campaigns UI should expose discovery sync')
  assert.match(view, /RemoveCampaignModal/, 'Campaigns UI should confirm campaign removal in-app')
  assert.doesNotMatch(view, /window\.confirm/, 'Campaigns UI should not use browser alert confirmation')
  assert.match(view, /'dismiss'/, 'Campaigns UI should remove campaigns through the dismissed status')
})
