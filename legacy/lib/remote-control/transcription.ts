export interface AudioDownload {
  data: ArrayBuffer
  filename: string
  contentType: string
}

export async function transcribeAudio(input: AudioDownload): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for voice-note transcription.')

  const model = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'
  const form = new FormData()
  form.set('model', model)
  form.set('file', new File([input.data], input.filename, { type: input.contentType }))

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  })

  const json = await response.json().catch(() => ({})) as { text?: string; error?: { message?: string } }
  if (!response.ok) {
    throw new Error(json.error?.message || `Transcription failed with HTTP ${response.status}`)
  }

  const text = json.text?.trim()
  if (!text) throw new Error('The voice note did not produce a transcript.')
  return text
}

/**
 * Normalize audio MIME types to formats OpenAI Whisper accepts.
 * Telegram may return audio/oga; Discord attachments may use non-standard types.
 * OpenAI Whisper accepts: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.
 */
export function normalizeAudioContentType(mimeType: string | undefined): string | null {
  if (!mimeType) return null
  if (mimeType.includes('oga') || mimeType.includes('ogg') || mimeType.includes('opus')) return 'audio/ogg'
  if (mimeType.includes('mp3') || mimeType.includes('mpeg') || mimeType.includes('mpga')) return 'audio/mpeg'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'audio/mp4'
  if (mimeType.includes('wav') || mimeType.includes('wave')) return 'audio/wav'
  if (mimeType.includes('webm')) return 'audio/webm'
  if (mimeType.includes('flac')) return 'audio/flac'
  return null // unknown — fall back to the download response header
}
