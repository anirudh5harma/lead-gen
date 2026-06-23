"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/**
 * Posts to a billing endpoint that returns `{ url }` (Dodo checkout or customer
 * portal) and redirects the browser there. Used for both "Upgrade to Pro" and
 * "Manage / cancel subscription".
 */
export default function UpgradeButton({
  endpoint,
  label,
  pendingLabel = "Opening...",
  icon = "bolt",
  variant = "solid",
  className,
}: {
  endpoint: string;
  label: string;
  pendingLabel?: string;
  icon?: string;
  variant?: "solid" | "quiet";
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!response.ok || !body?.url) {
        throw new Error(body?.error ?? "Could not start billing session.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPending(false);
    }
  }

  const base =
    variant === "quiet" ? "btn-quiet-sm" : "btn-solid-sm";

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={pending}
        className={`${base} disabled:cursor-wait disabled:opacity-70 ${className ?? ""}`}
      >
        <Icon name={icon} size={14} />
        {pending ? pendingLabel : label}
      </button>
      {error ? (
        <span className="text-[11px] text-[var(--color-neg)]">{error}</span>
      ) : null}
    </span>
  );
}
