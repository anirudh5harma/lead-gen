import { isTransientConnectionError } from "../../core/substrate/storage/index.ts";

const VALIDATION_MESSAGES = new Set(["Enter a valid company website."]);

export function onboardingActionErrorMessage(error: unknown): string {
  if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
    return error.message;
  }
  if (isTransientConnectionError(error)) {
    return "Bombsell could not reach the workspace database. Your progress is safe; try again.";
  }
  return "Bombsell could not launch your Agent just now. Your progress is safe; try again.";
}
