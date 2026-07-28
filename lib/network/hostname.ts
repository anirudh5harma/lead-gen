export function hasValidDnsHostname(hostname: string): boolean {
  if (hostname.length > 253) return false;
  return hostname.split(".").every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}
