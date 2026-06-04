import Icon from "@/components/Icon";
import type {
  ProductBriefItem,
  ProductRecommendationOutcomeKind,
} from "@/core/product/app.ts";
import {
  recordRecommendationOutcomeAction,
  reviewRecommendationAction,
} from "./actions";

export function RecommendationReviewGrid({
  items,
  icon,
  surface,
  outcomeKind,
  outcomeLabel,
  externalRefLabel,
}: {
  items: ProductBriefItem[];
  icon: string;
  surface: string;
  outcomeKind: ProductRecommendationOutcomeKind;
  outcomeLabel: string;
  externalRefLabel: string;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((item, index) => (
        <RecommendationReviewNote
          key={item.review_id ?? `${item.title}:${index}`}
          item={item}
          icon={icon}
          surface={surface}
          outcomeKind={outcomeKind}
          outcomeLabel={outcomeLabel}
          externalRefLabel={externalRefLabel}
        />
      ))}
    </div>
  );
}

export function RecommendationLearningBadge({
  accepted,
  ignored,
  acceptanceRate,
}: {
  accepted: number;
  ignored: number;
  acceptanceRate: number | null;
}) {
  if (accepted + ignored === 0) return null;
  const rate = acceptanceRate == null ? null : `${Math.round(acceptanceRate * 100)}% kept`;
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.54)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-3)]">
      <Icon name="auto_awesome" size={14} />
      <span>{accepted} kept</span>
      <span>{ignored} skipped</span>
      {rate ? <span>{rate}</span> : null}
    </p>
  );
}

function RecommendationReviewNote({
  item,
  icon,
  surface,
  outcomeKind,
  outcomeLabel,
  externalRefLabel,
}: {
  item: ProductBriefItem;
  icon: string;
  surface: string;
  outcomeKind: ProductRecommendationOutcomeKind;
  outcomeLabel: string;
  externalRefLabel: string;
}) {
  return (
    <article className="section-note">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon">
          <Icon name={icon} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-6 text-[var(--color-text-1)]">{item.title}</h3>
          <p className="mt-2 line-clamp-4 text-sm leading-6 text-[var(--color-text-2)]">{item.detail}</p>
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-xs font-semibold text-[var(--color-accent)]"
            >
              View proof
            </a>
          ) : null}
          <RecommendationReviewActions
            item={item}
            surface={surface}
            outcomeKind={outcomeKind}
            outcomeLabel={outcomeLabel}
            externalRefLabel={externalRefLabel}
          />
        </div>
      </div>
    </article>
  );
}

function RecommendationReviewActions({
  item,
  surface,
  outcomeKind,
  outcomeLabel,
  externalRefLabel,
}: {
  item: ProductBriefItem;
  surface: string;
  outcomeKind: ProductRecommendationOutcomeKind;
  outcomeLabel: string;
  externalRefLabel: string;
}) {
  if (!item.review_id) return null;
  if (item.outcome_id) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-pos-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-pos)]">
        <Icon name="task_alt" size={14} />
        Outcome recorded
      </p>
    );
  }
  if (item.decision === "accepted") {
    return (
      <div className="mt-4 space-y-3">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,255,255,0.62)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)]">
          <Icon name="check" size={14} />
          Kept for the Rep
        </p>
        <form action={recordRecommendationOutcomeAction} className="flex flex-col gap-2 sm:flex-row">
          <input type="hidden" name="review_id" value={item.review_id} />
          <input type="hidden" name="outcome_kind" value={outcomeKind} />
          <input type="hidden" name="surface" value={surface} />
          <input
            name="external_ref"
            type="url"
            placeholder={externalRefLabel}
            className="min-w-0 flex-1 rounded-md border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] px-3 py-1.5 text-xs text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-line-3)]"
          />
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--color-text-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-0)] transition active:translate-y-px"
          >
            <Icon name="task_alt" size={14} />
            {outcomeLabel}
          </button>
        </form>
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <form action={reviewRecommendationAction}>
        <input type="hidden" name="review_id" value={item.review_id} />
        <input type="hidden" name="decision" value="accepted" />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-text-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-0)] transition active:translate-y-px"
        >
          <Icon name="check" size={14} />
          Keep
        </button>
      </form>
      <form action={reviewRecommendationAction}>
        <input type="hidden" name="review_id" value={item.review_id} />
        <input type="hidden" name="decision" value="ignored" />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.62)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)] transition active:translate-y-px"
        >
          <Icon name="close" size={14} />
          Skip
        </button>
      </form>
    </div>
  );
}
