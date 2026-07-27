"use client";

import { useCallback, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";

interface LeadsFiltersState {
  q: string;
  kind: string | null;
  readiness: "email" | "linkedin" | null;
  size: string | null;
}

export function LeadsFilters({
  filters,
  resultCount,
  signalKinds,
}: {
  filters: LeadsFiltersState;
  resultCount: number;
  signalKinds: Array<{ value: string; label: string }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(filters.q);
  const [isPending, startTransition] = useTransition();

  const replaceParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const queryString = params.toString();
    const destination = queryString ? `${pathname}?${queryString}` : pathname;
    startTransition(() => router.replace(destination, { scroll: false }));
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (query === filters.q) return;
    const timeout = window.setTimeout(() => replaceParams({ q: query }), 300);
    return () => window.clearTimeout(timeout);
  }, [filters.q, query, replaceParams]);

  return (
    <section className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3 sm:flex-row sm:flex-wrap sm:items-center" aria-label="Filter leads">
      <label className="relative min-w-0 flex-1 sm:min-w-[260px]">
        <span className="sr-only">Search leads</span>
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-4)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search account, domain, or signal"
          className="h-9 w-full rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] pl-9 pr-3 text-[13px] text-[var(--color-text-1)] outline-none transition-colors focus:border-[var(--color-line-3)]"
        />
      </label>
      <FilterSelect
        label="Signal type"
        value={filters.kind ?? ""}
        onChange={(value) => replaceParams({ kind: value || null })}
      >
        <option value="">All signal types</option>
        {signalKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
      </FilterSelect>
      <FilterSelect
        label="Verified channel"
        value={filters.readiness ?? ""}
        onChange={(value) => replaceParams({ readiness: value || null })}
      >
        <option value="">Any verified channel</option>
        <option value="email">Verified email</option>
        <option value="linkedin">LinkedIn profile</option>
      </FilterSelect>
      <FilterSelect
        label="Company size"
        value={filters.size ?? ""}
        onChange={(value) => replaceParams({ size: value || null })}
      >
        <option value="">Any company size</option>
        {["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001+"].map((size) => (
          <option key={size} value={size}>{size} employees</option>
        ))}
      </FilterSelect>
      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            replaceParams({ q: null, kind: null, readiness: null, size: null });
          }}
          className="h-9 px-1 text-[12px] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          Clear
        </button>
      ) : null}
      <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-[var(--color-text-4)]" aria-live="polite">
        {isPending ? "Updating…" : `${resultCount} leads`}
      </span>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 max-w-full rounded-[6px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-2.5 text-[12px] text-[var(--color-text-2)] outline-none transition-colors focus:border-[var(--color-line-3)]"
      >
        {children}
      </select>
    </label>
  );
}

function hasActiveFilters(filters: LeadsFiltersState): boolean {
  return Boolean(filters.q || filters.kind || filters.readiness || filters.size);
}
