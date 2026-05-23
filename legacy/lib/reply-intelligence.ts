export type ReplyIntent =
  | 'not_interested'
  | 'out_of_office'
  | 'neutral'
  | 'interested'
  | 'meeting_requested'
  | 'meeting_booked'

export interface ReplyIntentResult {
  intent: ReplyIntent
  confidence: number
  summary: string
}

const BOOKED_PATTERNS = [
  /\b(booked|scheduled|sent (?:a )?(?:calendar )?invite|calendar invite sent|invite is on|meeting is on|see you (?:then|at)|confirmed for)\b/i,
  /\b(accepted|confirmed)\b.{0,50}\b(invite|meeting|call|slot|time)\b/i,
]

const MEETING_REQUEST_PATTERNS = [
  /\b(send|share|shoot|drop).{0,40}\b(calendly|calendar|booking link|availability|available times|slots?)\b/i,
  /\b(happy|open|keen|interested|works|sounds good|let'?s|lets)\b.{0,80}\b(chat|talk|call|meet|meeting|demo|discuss|connect)\b/i,
  /\b(can|could|would).{0,40}\b(chat|talk|call|meet|schedule|book|connect)\b/i,
  /\b(what times?|when).{0,40}\b(work|available|free)\b/i,
]

const INTERESTED_PATTERNS = [
  /\b(interested|tell me more|more details|sounds useful|looks useful|worth exploring|open to learning|send over|share more|this is relevant)\b/i,
  /\b(loop in|introduce|connect you with|forward(?:ing)? this)\b/i,
]

const NOT_INTERESTED_PATTERNS = [
  /\b(not interested|no thanks|no thank you|unsubscribe|remove me|stop emailing|not a fit|not relevant|no need|pass for now)\b/i,
]

const OOO_PATTERNS = [
  /\b(out of office|ooo|automatic reply|auto.?reply|away from (?:the )?office|on vacation|annual leave|parental leave)\b/i,
]

export function classifyReplyIntent(input: {
  subject?: string | null
  text?: string | null
}): ReplyIntentResult {
  const subject = normalize(input.subject)
  const text = normalize(input.text)
  const combined = `${subject}\n${text}`.trim()

  if (!combined) {
    return { intent: 'neutral', confidence: 0.35, summary: 'Reply received, but Bombsell could not read enough content to infer intent.' }
  }

  if (matchesAny(combined, OOO_PATTERNS)) {
    return { intent: 'out_of_office', confidence: 0.86, summary: 'The reply appears to be an out-of-office or automatic response.' }
  }

  if (matchesAny(combined, NOT_INTERESTED_PATTERNS)) {
    return { intent: 'not_interested', confidence: 0.9, summary: 'The recipient declined or asked not to continue.' }
  }

  if (matchesAny(combined, BOOKED_PATTERNS)) {
    return { intent: 'meeting_booked', confidence: 0.88, summary: 'The recipient appears to have confirmed or booked a meeting.' }
  }

  if (matchesAny(combined, MEETING_REQUEST_PATTERNS)) {
    return { intent: 'meeting_requested', confidence: 0.82, summary: 'The recipient appears open to a meeting or asked for availability.' }
  }

  if (matchesAny(combined, INTERESTED_PATTERNS)) {
    return { intent: 'interested', confidence: 0.72, summary: 'The recipient showed positive interest but did not clearly ask to schedule yet.' }
  }

  return { intent: 'neutral', confidence: 0.48, summary: 'Reply received. No clear positive, negative, or booking intent was detected.' }
}

export function shouldAutoSendBookingLink(result: ReplyIntentResult): boolean {
  return (result.intent === 'meeting_requested' || result.intent === 'interested') && result.confidence >= 0.7
}

export function isBookedIntent(result: ReplyIntentResult): boolean {
  return result.intent === 'meeting_booked'
}

export function isPositiveIntent(result: ReplyIntentResult): boolean {
  return result.intent === 'interested' || result.intent === 'meeting_requested' || result.intent === 'meeting_booked'
}

export function buildBookingReplyBody(params: {
  calendlyUrl: string
  senderCompany: string
}): string {
  return [
    'Thanks, happy to make this easy.',
    `You can grab a time here: ${params.calendlyUrl}`,
    'If none of those slots work, send over two times and I will work around them.',
  ].join('\n\n')
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(value))
}
