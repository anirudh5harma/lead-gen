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
