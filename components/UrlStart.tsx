"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { googleAuthPath } from "@/lib/auth/next";

export default function UrlStart() {
  const [url, setUrl] = useState("");
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = url.trim();
    if (!v) return;
    const normalized = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    const next = `/onboarding?url=${encodeURIComponent(normalized)}`;
    router.push(googleAuthPath(next));
  }

  return (
    <form onSubmit={submit} className="mt-9 w-full max-w-[480px]">
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-1.5 pl-4 transition-[border-color,box-shadow] focus-within:border-[color:var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
        <Icon name="language" size={18} className="text-[var(--color-text-3)]" />
        <input
          type="text"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="yourcompany.com"
          aria-label="Your company website"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--color-text-1)] outline-none placeholder:text-[var(--color-text-4)]"
        />
        <button type="submit" className="btn-solid h-11 shrink-0">
          Get started
          <Icon name="arrow_forward" size={17} />
        </button>
      </div>
      <p className="mt-2.5 pl-1 text-[12.5px] text-[var(--color-text-3)]">
        We read your site to draft your profile, audience, and voice.
      </p>
    </form>
  );
}
