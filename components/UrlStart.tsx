import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";

export default function UrlStart() {
  return (
    <form action="/auth/start" method="get" className="mt-9 w-full max-w-[480px]">
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-1.5 pl-4 transition-[border-color,box-shadow] focus-within:border-[color:var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
        <Icon name="language" size={18} className="text-[var(--color-text-3)]" />
        <input
          type="text"
          name="url"
          inputMode="url"
          autoComplete="url"
          required
          placeholder="yourcompany.com"
          aria-label="Your company website"
          className="min-w-0 flex-1 bg-transparent text-[15px] text-[var(--color-text-1)] outline-none placeholder:text-[var(--color-text-4)]"
        />
        <PendingSubmitButton
          className="btn-solid h-11 shrink-0"
          icon="arrow_forward"
          iconSize={17}
          pendingLabel="Starting"
        >
          Get started
        </PendingSubmitButton>
      </div>
      <p className="mt-2.5 pl-1 text-[12.5px] text-[var(--color-text-3)]">
        We read your site to draft your prospecting profile, audience, and voice.
      </p>
    </form>
  );
}
