export function textArrayFromPg(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item) => item.trim().length > 0);
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [trimmed];
  const inner = trimmed.slice(1, -1);
  if (!inner) return [];
  const items: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const char of inner) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items.filter((item) => item.toUpperCase() !== "NULL");
}
