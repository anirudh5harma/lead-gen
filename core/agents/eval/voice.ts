import type { JudgeInput, JudgeVerdict } from "./types.ts";

export interface BrandVoiceGuardrailOptions {
  minVoiceScore?: number;
}

interface BrandVoiceResult {
  score: number;
  issues: string[];
  suggestions: string[];
  axes: Record<string, number>;
}

const STOPWORDS = new Set([
  "about",
  "after",
  "again",
  "being",
  "before",
  "because",
  "between",
  "could",
  "from",
  "have",
  "into",
  "that",
  "their",
  "there",
  "they",
  "this",
  "with",
  "without",
  "worth",
  "would",
]);

const HYPE_WORDS = [
  "revolutionary",
  "transformative",
  "game-changing",
  "guarantee",
  "guaranteed",
  "unlock",
  "unprecedented",
  "skyrocket",
  "10x",
];

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/['’]/g, "")
      .split(/[^a-z0-9-]+/)
      .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
  );
}

function normalized(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function violatesDoNot(rule: string, body: string): boolean {
  const lowerBody = normalized(body);
  const lowerRule = normalized(rule)
    .replace(/^(do not|dont|never|avoid)\s+/, "")
    .trim();
  if (!lowerRule) return false;
  if (/\bai\b|artificial intelligence|language model/.test(lowerRule)) {
    return mentionsBeingAi(lowerBody);
  }
  if (/overpromise|hype|hyperbole/.test(lowerRule)) {
    return HYPE_WORDS.some((word) => lowerBody.includes(word));
  }
  return lowerRule.length >= 8 && lowerBody.includes(lowerRule);
}

function mentionsBeingAi(body: string): boolean {
  const identityClaim =
    /\b(i am|i m|i'm|we are|we re|we're|as|being)\s+(an?\s+)?(ai|artificial intelligence|language model)\b/;
  const assistantNoun =
    /\b(ai|artificial intelligence|language model)\s+(assistant|agent|system)\b/;
  return identityClaim.test(body) || assistantNoun.test(body);
}

export function evaluateBrandVoice(
  input: JudgeInput,
): BrandVoiceResult {
  const body = input.artifact.body;
  const issues: string[] = [];
  const suggestions: string[] = [];
  const axes: Record<string, number> = {};
  const scores: number[] = [];

  const doNotRules = input.rep.persona.do_not ?? [];
  const violatedRules = doNotRules.filter((rule) => violatesDoNot(rule, body));
  axes.voice_do_not = violatedRules.length === 0 ? 1 : 0;
  scores.push(axes.voice_do_not);
  if (violatedRules.length > 0) {
    issues.push(`violates Rep do-not rules: ${violatedRules.join("; ")}`);
    suggestions.push("rewrite to respect the Rep's hard voice constraints");
  }

  const samples = input.rep.persona.samples ?? [];
  const sampleTokens = tokenize(samples.join(" "));
  if (sampleTokens.size > 0) {
    const bodyTokens = tokenize(body);
    let overlap = 0;
    for (const token of sampleTokens) {
      if (bodyTokens.has(token)) overlap++;
    }
    const overlapRatio = overlap / sampleTokens.size;
    axes.voice_sample_overlap = Math.min(1, overlapRatio / 0.2);
    if (samples.length >= 2) scores.push(axes.voice_sample_overlap);
    if (samples.length >= 2 && axes.voice_sample_overlap < 0.55) {
      issues.push("draft drifted away from the Rep's canonical writing samples");
      suggestions.push("anchor the rewrite in the Rep's canonical samples");
    }
  }

  const voiceDescriptor = normalized(input.rep.persona.voice ?? "");
  const bodyText = normalized(body);
  const lowHype =
    voiceDescriptor.includes("low hype") ||
    voiceDescriptor.includes("low-hype") ||
    voiceDescriptor.includes("plainspoken") ||
    voiceDescriptor.includes("precise");
  const hasHype = HYPE_WORDS.some((word) => bodyText.includes(word));
  if (lowHype) {
    axes.voice_low_hype = hasHype ? 0.35 : 1;
    scores.push(axes.voice_low_hype);
    if (hasHype) {
      issues.push("draft uses hype that conflicts with the Rep's voice");
      suggestions.push("replace hype with concrete context and a restrained ask");
    }
  }

  return {
    score: scores.length === 0 ? 1 : Math.min(...scores),
    issues,
    suggestions,
    axes,
  };
}

export function applyBrandVoiceGuardrail(
  input: JudgeInput,
  verdict: JudgeVerdict,
  opts: BrandVoiceGuardrailOptions = {},
): JudgeVerdict {
  const minVoiceScore = opts.minVoiceScore ?? 0.55;
  const voice = evaluateBrandVoice(input);
  const score = Math.min(verdict.score, voice.score);
  const passed = verdict.passed && voice.score >= minVoiceScore;
  if (voice.issues.length === 0) {
    return {
      ...verdict,
      score,
      passed,
      notes: {
        ...verdict.notes,
        axes: {
          ...verdict.notes.axes,
          brand_voice: voice.score,
          ...voice.axes,
        },
      },
    };
  }

  return {
    ...verdict,
    score,
    passed,
    notes: {
      ...verdict.notes,
      axes: {
        ...verdict.notes.axes,
        brand_voice: voice.score,
        ...voice.axes,
      },
      critique: [verdict.notes.critique, ...voice.issues].filter(Boolean).join("; "),
      suggestions: [...(verdict.notes.suggestions ?? []), ...voice.suggestions],
    },
  };
}
