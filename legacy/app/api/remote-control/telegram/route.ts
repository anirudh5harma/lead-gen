import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRemoteControlPrincipal } from '@/lib/remote-control/auth'
import { handleRemoteDashboardCommand } from '@/lib/remote-control/dashboard'
import { consumeRemoteControlLink } from '@/lib/remote-control/linking'
import { transcribeAudio, normalizeAudioContentType } from '@/lib/remote-control/transcription'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TelegramUpdate {
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

interface TelegramMessage {
  message_id?: number
  text?: string
  caption?: string
  chat?: { id?: number | string }
  from?: { id?: number | string; username?: string; first_name?: string }
  voice?: { file_id?: string; mime_type?: string; file_unique_id?: string }
  audio?: { file_id?: string; mime_type?: string; file_name?: string }
  document?: { file_id?: string; mime_type?: string; file_name?: string }
}

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Telegram remote control is not configured.' }, { status: 503 })
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = await request.json().catch(() => null) as TelegramUpdate | null
  const message = update?.message ?? update?.edited_message ?? null
  const providerUserId = message?.from?.id != null ? String(message.from.id) : ''
  const chatId = message?.chat?.id != null ? String(message.chat.id) : ''
  if (!message || !providerUserId || !chatId) return NextResponse.json({ ok: true })

  const supabase = createAdminClient()
  const startToken = parseTelegramStartToken(message.text)
  if (startToken) {
    try {
      const linked = await consumeRemoteControlLink(supabase, {
        provider: 'telegram',
        token: startToken,
        providerUserId,
        providerChatId: chatId,
        username: message.from?.username ?? message.from?.first_name ?? null,
      })
      await sendTelegramMessage(
        chatId,
        linked
          ? 'Telegram remote control is connected. You can now send Bombsell commands or voice notes here.'
          : 'This link is invalid or expired. Open Bombsell and connect Telegram again.',
      )
    } catch (error) {
      await sendTelegramMessage(chatId, error instanceof Error ? error.message : 'Could not connect Telegram.')
    }
    return NextResponse.json({ ok: true })
  }

  const principal = await resolveRemoteControlPrincipal(supabase, {
    provider: 'telegram',
    providerUserId,
    providerChatId: chatId,
  })
  if (!principal) {
    await sendTelegramMessage(chatId, 'This Telegram account is not authorized for Bombsell remote control.')
    return NextResponse.json({ ok: true })
  }

  try {
    const transcript = await resolveTelegramTranscript(message)
    const result = await handleRemoteDashboardCommand(supabase, {
      userId: principal.userId,
      clientId: principal.clientId,
      transcript,
    })
    await sendTelegramMessage(chatId, result.response)
  } catch (error) {
    await sendTelegramMessage(chatId, error instanceof Error ? error.message : 'Remote command failed.')
  }

  return NextResponse.json({ ok: true })
}

function parseTelegramStartToken(text?: string): string | null {
  const match = text?.trim().match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]+)$/)
  return match?.[1] ?? null
}

async function resolveTelegramTranscript(message: TelegramMessage): Promise<string> {
  const text = (message.text ?? message.caption ?? '').trim()
  if (text) return text

  const file = message.voice ?? message.audio ?? message.document
  const fileId = file?.file_id
  if (!fileId) throw new Error('Send a text command or a voice note.')

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required to download voice notes.')

  const fileInfoResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(15_000),
  })
  const fileInfo = await fileInfoResponse.json().catch(() => ({})) as { ok?: boolean; result?: { file_path?: string } }
  const filePath = fileInfo.result?.file_path
  if (!fileInfoResponse.ok || !fileInfo.ok || !filePath) throw new Error('Could not download the Telegram voice note.')

  const audioResponse = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, {
    signal: AbortSignal.timeout(30_000),
  })
  if (!audioResponse.ok) throw new Error('Could not fetch the Telegram audio file.')

  return transcribeAudio({
    data: await audioResponse.arrayBuffer(),
    filename: filePath.split('/').pop() || 'telegram-voice.ogg',
    contentType: normalizeAudioContentType(file.mime_type) || audioResponse.headers.get('content-type') || 'audio/ogg',
  })
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 3900),
      disable_web_page_preview: true,
    }),
  }).catch(() => {})
}
