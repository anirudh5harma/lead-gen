import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyDiscordRequest } from '@/lib/remote-control/discord'
import { resolveRemoteControlPrincipal } from '@/lib/remote-control/auth'
import { handleRemoteDashboardCommand } from '@/lib/remote-control/dashboard'
import { transcribeAudio, normalizeAudioContentType } from '@/lib/remote-control/transcription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
} as const

interface DiscordInteraction {
  application_id?: string
  token?: string
  type?: number
  member?: { user?: DiscordUser }
  user?: DiscordUser
  channel_id?: string
  data?: {
    name?: string
    options?: Array<{ name?: string; type?: number; value?: string }>
    resolved?: {
      attachments?: Record<string, DiscordAttachment>
    }
  }
}

interface DiscordUser {
  id?: string
  username?: string
}

interface DiscordAttachment {
  id?: string
  filename?: string
  content_type?: string
  url?: string
  size?: number
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const verified = verifyDiscordRequest({
    body: rawBody,
    signature: request.headers.get('x-signature-ed25519'),
    timestamp: request.headers.get('x-signature-timestamp'),
    publicKey: process.env.DISCORD_PUBLIC_KEY,
  })
  if (!verified) return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 })

  const interaction = JSON.parse(rawBody) as DiscordInteraction
  if (interaction.type === 1) return NextResponse.json({ type: InteractionResponseType.Pong })

  const user = interaction.member?.user ?? interaction.user
  const providerUserId = user?.id ?? ''
  if (!providerUserId) return discordMessage('Could not identify the Discord user.')

  const supabase = createAdminClient()
  const principal = await resolveRemoteControlPrincipal(supabase, {
    provider: 'discord',
    providerUserId,
    providerChatId: interaction.channel_id ?? null,
  })
  if (!principal) return discordMessage('This Discord account is not authorized for Bombsell remote control.')

  after(async () => {
    try {
      const transcript = await resolveDiscordTranscript(interaction)
      const result = await handleRemoteDashboardCommand(supabase, {
        userId: principal.userId,
        clientId: principal.clientId,
        transcript,
      })
      await sendDiscordFollowup(interaction, result.response)
    } catch (error) {
      await sendDiscordFollowup(interaction, error instanceof Error ? error.message : 'Remote command failed.')
    }
  })

  return NextResponse.json({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: 64 },
  })
}

function discordMessage(content: string) {
  return NextResponse.json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: content.slice(0, 1900),
      flags: 64,
    },
  })
}

async function resolveDiscordTranscript(interaction: DiscordInteraction): Promise<string> {
  const textOption = interaction.data?.options?.find(option => option.name === 'command' && typeof option.value === 'string')
  const text = textOption?.value?.trim()
  if (text) return text

  const attachmentOption = interaction.data?.options?.find(option => option.name === 'voice' || option.name === 'audio' || option.name === 'file')
  const attachmentId = typeof attachmentOption?.value === 'string' ? attachmentOption.value : null
  const attachment = attachmentId ? interaction.data?.resolved?.attachments?.[attachmentId] : null
  if (!attachment?.url) throw new Error('Use the command option for text, or attach a voice/audio file.')

  const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error('Could not download the Discord audio attachment.')

  return transcribeAudio({
    data: await response.arrayBuffer(),
    filename: attachment.filename || 'discord-voice.ogg',
    contentType: normalizeAudioContentType(attachment.content_type) || response.headers.get('content-type') || 'audio/ogg',
  })
}

async function sendDiscordFollowup(interaction: DiscordInteraction, content: string): Promise<void> {
  if (!interaction.application_id || !interaction.token) return
  await fetch(`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: content.slice(0, 1900),
      flags: 64,
    }),
  }).catch(() => {})
}
