"use client";

import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { useToast } from "@/components/Toast";
import type {
  ProductBriefItem,
  ProductRecommendationOutcomeKind,
} from "@/core/product/app.ts";
import {
  createContext,
  useContext,
  useRef,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  createRecommendationDraftAction,
  deleteRecommendationAction,
  recordRecommendationOutcomeAction,
  reviewRecommendationAction,
  updateRecommendationAction,
} from "./actions";

const ToastActionPendingContext = createContext(false);

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
  const rate = acceptanceRate == null ? null : `${Math.round(acceptanceRate * 100)}% useful`;
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-3)]">
      <Icon name="auto_awesome" size={14} />
      <span>{accepted} useful</span>
      <span>{ignored} dismissed</span>
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
              Open proof
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
        Result recorded
      </p>
    );
  }
  if (item.decision === "accepted") {
    return (
      <div className="mt-4 space-y-3">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)]">
          <Icon name="check" size={14} />
          Saved
        </p>
        <RecommendationEditDeleteControls item={item} surface={surface} />
        <ToastActionForm
          action={createRecommendationDraftAction}
          successTitle="Draft created"
        >
          <input type="hidden" name="review_id" value={item.review_id} />
          <input
            type="hidden"
            name="channel"
            value={surface === "aeo" ? "web" : "x_post"}
          />
          <ToastSubmitButton
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[color:var(--color-line-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-text-1)] active:translate-y-px"
            icon={surface === "aeo" ? "article" : "edit_note"}
            iconSize={14}
            pendingLabel="Drafting"
          >
            {surface === "aeo" ? "Draft answer" : "Draft post"}
          </ToastSubmitButton>
        </ToastActionForm>
        <ToastActionForm
          action={recordRecommendationOutcomeAction}
          successTitle="Result recorded"
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input type="hidden" name="review_id" value={item.review_id} />
          <input type="hidden" name="outcome_kind" value={outcomeKind} />
          <input type="hidden" name="surface" value={surface} />
          <input
            name="external_ref"
            type="url"
            placeholder={externalRefLabel}
            className="min-w-0 flex-1 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-1.5 text-xs text-[var(--color-text-1)] outline-none transition focus:border-[var(--color-line-3)]"
          />
          <ToastSubmitButton
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--color-text-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-0)] transition active:translate-y-px"
            icon="task_alt"
            iconSize={14}
            pendingLabel="Recording"
          >
            {outcomeLabel}
          </ToastSubmitButton>
        </ToastActionForm>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <ToastActionForm action={reviewRecommendationAction} successTitle="Suggestion saved">
          <input type="hidden" name="review_id" value={item.review_id} />
          <input type="hidden" name="decision" value="accepted" />
          <ToastSubmitButton
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-text-1)] px-3 py-1.5 text-xs font-semibold text-[var(--color-ink-0)] transition active:translate-y-px"
            icon="check"
            iconSize={14}
            pendingLabel="Saving"
          >
            Use idea
          </ToastSubmitButton>
        </ToastActionForm>
        <ToastActionForm action={reviewRecommendationAction} successTitle="Suggestion dismissed">
          <input type="hidden" name="review_id" value={item.review_id} />
          <input type="hidden" name="decision" value="ignored" />
          <ToastSubmitButton
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)] transition active:translate-y-px"
            icon="close"
            iconSize={14}
            pendingLabel="Dismissing"
          >
            Dismiss
          </ToastSubmitButton>
        </ToastActionForm>
        <ToastActionForm action={deleteRecommendationAction} successTitle="Suggestion deleted">
          <RecommendationDeleteFields reviewId={item.review_id} surface={surface} />
        </ToastActionForm>
      </div>
      <RecommendationEditForm item={item} />
    </div>
  );
}

function RecommendationEditDeleteControls({
  item,
  surface,
}: {
  item: ProductBriefItem;
  surface: string;
}) {
  if (!item.review_id) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <ToastActionForm action={deleteRecommendationAction} successTitle="Suggestion deleted">
          <RecommendationDeleteFields reviewId={item.review_id} surface={surface} />
        </ToastActionForm>
      </div>
      <RecommendationEditForm item={item} />
    </div>
  );
}

function RecommendationDeleteFields({
  reviewId,
  surface,
}: {
  reviewId: string;
  surface: string;
}) {
  return (
    <>
      <input type="hidden" name="review_id" value={reviewId} />
      <input type="hidden" name="reason" value={`Deleted from ${surface}`} />
      <ToastSubmitButton
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-neg)] transition active:translate-y-px"
        icon="delete"
        iconSize={14}
        pendingLabel="Deleting"
      >
        Delete
      </ToastSubmitButton>
    </>
  );
}

function RecommendationEditForm({ item }: { item: ProductBriefItem }) {
  if (!item.review_id) return null;
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-2)] transition hover:bg-[var(--color-ink-2)]">
        <Icon name="edit" size={14} />
        Edit
      </summary>
      <ToastActionForm
        action={updateRecommendationAction}
        successTitle="Suggestion updated"
        className="mt-3 grid gap-2 rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3"
      >
        <input type="hidden" name="review_id" value={item.review_id} />
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold text-[var(--color-text-3)]">Title</span>
          <input
            name="title"
            required
            defaultValue={item.title}
            className="min-h-9 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 text-xs text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold text-[var(--color-text-3)]">Detail</span>
          <textarea
            name="detail"
            rows={3}
            defaultValue={item.detail}
            className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2 text-xs leading-5 text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold text-[var(--color-text-3)]">Proof URL</span>
          <input
            name="url"
            type="url"
            defaultValue={item.url ?? ""}
            className="min-h-9 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 text-xs text-[var(--color-text-1)] outline-none focus:border-[var(--color-line-3)]"
          />
        </label>
        <ToastSubmitButton
          className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-full bg-[var(--color-text-1)] px-3 text-xs font-semibold text-[var(--color-ink-0)] transition active:translate-y-px"
          icon="save"
          iconSize={14}
          pendingLabel="Saving"
        >
          Save edit
        </ToastSubmitButton>
      </ToastActionForm>
    </details>
  );
}

function ToastSubmitButton({
  children,
  ...props
}: Omit<Parameters<typeof PendingSubmitButton>[0], "pending">) {
  const pending = useContext(ToastActionPendingContext);
  return (
    <PendingSubmitButton {...props} pending={pending}>
      {children}
    </PendingSubmitButton>
  );
}

function ToastActionForm({
  action,
  successTitle,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  successTitle: string;
  className?: string;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const { success, error } = useToast();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      try {
        await action(formData);
        router.refresh();
        success(successTitle);
      } catch (err) {
        error(err instanceof Error ? err.message : "Action failed. Please try again.");
      }
    });
  }

  return (
    <ToastActionPendingContext.Provider value={pending}>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        aria-busy={pending}
        className={className}
      >
        <fieldset disabled={pending} className="contents">
          {children}
        </fieldset>
      </form>
    </ToastActionPendingContext.Provider>
  );
}
