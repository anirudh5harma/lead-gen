export const DEEPSEEK_V4_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_V4_PRO_MODEL = "deepseek-v4-pro";

export type LLMModelEscalationReason =
  | "hard_multi_document_synthesis"
  | "repeated_flash_failure"
  | "operator_approved_investigation";

export interface LLMModelEscalation {
  reason: LLMModelEscalationReason;
  approved_by?: string;
  notes?: string;
}

export class LLMModelPolicyError extends Error {
  readonly model: string;

  constructor(model: string) {
    super(
      `${model} requires an explicit model_escalation reason. Default AI calls must use ${DEEPSEEK_V4_FLASH_MODEL}.`,
    );
    this.name = "LLMModelPolicyError";
    this.model = model;
  }
}

export function resolveDeepSeekDefaultModel(
  configured = process.env.DEEPSEEK_MODEL,
): string {
  const model = configured?.trim();
  return model || DEEPSEEK_V4_FLASH_MODEL;
}

export function assertDeepSeekModelAllowed(
  model: string,
  escalation?: LLMModelEscalation,
): void {
  if (model === DEEPSEEK_V4_PRO_MODEL && !escalation) {
    throw new LLMModelPolicyError(model);
  }
}
