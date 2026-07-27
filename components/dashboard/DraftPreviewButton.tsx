"use client";

import Link from "next/link";
import { useRef } from "react";
import Icon from "@/components/Icon";

export interface ReviewDraftPreview {
  messageId: string;
  conversationId: string;
  companyName: string;
  contactName: string | null;
  signalHeading: string;
  subject: string | null;
  body: string;
  channel: string;
  evalScore: number | null;
}

export function DraftPreviewButton({ draft }: { draft: ReviewDraftPreview }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const score = formatScore(draft.evalScore);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="btn-quiet-sm h-7 px-2 text-[11px]"
      >
        <Icon name="article" size={12} />
        View draft
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`draft-title-${draft.messageId}`}
        className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none bg-transparent p-0 text-[var(--color-text-1)] backdrop:bg-black/35"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <section className="ml-auto flex h-full w-full max-w-[560px] flex-col border-l border-[var(--color-line-1)] bg-[var(--color-ink-0)] shadow-[-16px_0_48px_rgba(0,0,0,0.14)]">
          <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line-1)] px-5 py-5">
            <div className="min-w-0">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--color-accent)]">
                Ready for review
              </p>
              <h2 id={`draft-title-${draft.messageId}`} className="mt-1 truncate text-[19px] font-semibold tracking-[-0.02em]">
                {draft.companyName}
              </h2>
              <p className="mt-1 text-[12px] text-[var(--color-text-3)]">
                {draft.contactName ?? "Qualified contact"} · {channelLabel(draft.channel)}
              </p>
            </div>
            <button
              type="button"
              autoFocus
              onClick={() => dialogRef.current?.close()}
              className="grid size-8 shrink-0 place-items-center rounded-[7px] text-[var(--color-text-3)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              aria-label="Close draft preview"
            >
              <Icon name="close" size={15} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-4)]">Signal</p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-2)]">{draft.signalHeading}</p>
            </div>

            <div className="mt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-4)]">Subject</p>
              <p className="mt-1.5 text-[14px] font-medium text-[var(--color-text-1)]">
                {draft.subject?.trim() || "No subject"}
              </p>
            </div>

            <div className="mt-5 border-t border-[var(--color-line-1)] pt-5">
              <p className="whitespace-pre-wrap text-[14px] leading-6 text-[var(--color-text-2)]">{draft.body}</p>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-line-1)] px-5 py-4">
            <span className="text-[11px] text-[var(--color-text-4)]">
              {score ? `Quality score ${score}` : "Passed quality checks"}
            </span>
            <Link href={`/dashboard/conversations/${draft.conversationId}#message-${draft.messageId}`} className="btn-solid-sm">
              Open conversation
              <Icon name="arrow_forward" size={13} />
            </Link>
          </footer>
        </section>
      </dialog>
    </>
  );
}

function channelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel.startsWith("linkedin")) return "LinkedIn";
  return channel.replaceAll("_", " ");
}

function formatScore(score: number | null): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}
