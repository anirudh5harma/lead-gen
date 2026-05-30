export function safeNextPath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/onboarding";
}

export function googleAuthPath(next: string): string {
  return `/auth/google?next=${encodeURIComponent(safeNextPath(next))}`;
}
