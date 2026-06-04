import type { ProductCompanyProfile } from "@/core/product/app.ts";

export function ProfileIntelligence({
  profile,
}: {
  profile: ProductCompanyProfile | null;
}) {
  if (!profile) {
    return (
      <section className="mt-6 section-note">
        <p className="brief-kicker">Company profile</p>
        <p className="mt-3 text-lg font-semibold text-[var(--color-text-1)]">No company profile yet.</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-3)]">
          Add the company URL once. Bombsell will turn the site into reusable context for every work area.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 section-note">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="brief-kicker">Company profile</p>
          <h2 className="mt-3 text-2xl font-semibold leading-tight text-[var(--color-text-1)]">
            {profile.company_name}
          </h2>
          {profile.description ? (
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">{profile.description}</p>
          ) : null}
          {profile.exa_summary ? (
            <p className="mt-4 text-[15px] leading-7 text-[var(--color-text-1)]">{profile.exa_summary}</p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-3)]">
              This profile was created from the company website. Reps will add deeper public context as work runs.
            </p>
          )}
          {profile.exa_market_terms.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {profile.exa_market_terms.slice(0, 8).map((term) => (
                <span className="profile-chip" key={term}>{term}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid min-w-[240px] grid-cols-2 gap-2">
          <ProfileMetric label="Proof" value={profile.exa_evidence_source_ids.length} />
          <ProfileMetric label="Notes" value={profile.exa_result_count} />
        </div>
      </div>
      {profile.exa_positioning_notes.length > 0 ||
      profile.exa_audience_terms.length > 0 ||
      profile.exa_competitor_mentions.length > 0 ||
      profile.exa_proof_points.length > 0 ? (
        <div className="mt-5 grid gap-2 lg:grid-cols-2">
          <ProfileInsightGroup title="Positioning" items={profile.exa_positioning_notes} />
          <ProfileInsightGroup title="Audience" items={profile.exa_audience_terms} compact />
          <ProfileInsightGroup title="Competitors" items={profile.exa_competitor_mentions} />
          <ProfileInsightGroup title="Proof" items={profile.exa_proof_points} />
        </div>
      ) : null}
      {profile.exa_evidence_cards.length > 0 ? (
        <div className="mt-5 grid gap-2 lg:grid-cols-2">
          {profile.exa_evidence_cards.slice(0, 4).map((card) => (
            <a
              className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.48)] p-3 transition hover:border-[var(--color-line-2)]"
              href={card.url}
              key={card.url}
              rel="noreferrer"
              target="_blank"
            >
              <span className="block text-xs text-[var(--color-text-3)]">{card.source_domain ?? "Proof"}</span>
              <strong className="mt-1 block text-sm font-medium leading-5 text-[var(--color-text-1)]">{card.title}</strong>
              {card.snippet ? (
                <span className="mt-2 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">{card.snippet}</span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2 text-xs text-[var(--color-text-3)]">
        {profile.domain ? <span className="profile-chip">{profile.domain}</span> : null}
        {profile.industry ? <span className="profile-chip">{profile.industry}</span> : null}
        {profile.exa_source_domains.slice(0, 4).map((domain) => (
          <span className="profile-chip" key={domain}>{domain}</span>
        ))}
        {profile.exa_enriched_at ? (
          <span className="profile-chip">Updated {new Date(profile.exa_enriched_at).toLocaleDateString()}</span>
        ) : null}
      </div>
    </section>
  );
}

function ProfileInsightGroup({
  title,
  items,
  compact = false,
}: {
  title: string;
  items: string[];
  compact?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.42)] p-3">
      <span className="block text-xs font-medium uppercase tracking-[0.14em] text-[var(--color-text-3)]">{title}</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.slice(0, compact ? 6 : 3).map((item) => (
          compact ? (
            <span className="profile-chip" key={item}>{item}</span>
          ) : (
            <p className="text-xs leading-5 text-[var(--color-text-2)]" key={item}>{item}</p>
          )
        ))}
      </div>
    </div>
  );
}

function ProfileMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.56)] p-3 text-center">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}
