import { tryVoiceFastPath, type VoiceClassification } from '@/lib/voice-intent-core'

const CACHE_MAX = 64
const responseCache = new Map<string, VoiceClassification>()

function cacheKey(transcript: string): string {
  return transcript.trim().toLowerCase().replace(/\s+/g, ' ')
}

function cacheGet(key: string): VoiceClassification | undefined {
  const entry = responseCache.get(key)
  if (entry) {
    responseCache.delete(key)
    responseCache.set(key, entry)
  }
  return entry
}

function cacheSet(key: string, value: VoiceClassification): void {
  if (responseCache.size >= CACHE_MAX) {
    const first = responseCache.keys().next().value
    if (first !== undefined) responseCache.delete(first)
  }
  responseCache.set(key, value)
}

export async function classifyVoiceIntentClient(
  transcript: string,
): Promise<VoiceClassification> {
  const trimmed = transcript.trim()
  if (!trimmed) {
    return {
      intent: { intent: 'unknown', sentiment: 'neutral', note: 'No command text was received.' },
      latencyMs: 0,
      llmUsed: false,
    }
  }
  const fast = tryVoiceFastPath(trimmed)
  if (fast) return { intent: fast, latencyMs: 0, llmUsed: false }

  const key = cacheKey(trimmed)
  const cached = cacheGet(key)
  if (cached) return { ...cached, latencyMs: 0 }

  const t0 = Date.now()
  const res = await fetch('/api/voice/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: trimmed }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' })) as { error?: string }
    return {
      intent: { intent: 'unknown', sentiment: 'neutral', note: err.error || 'Classification request failed.' },
      latencyMs: Date.now() - t0,
      llmUsed: true,
    }
  }
  const classification = await res.json() as VoiceClassification
  cacheSet(key, classification)
  return classification
}
