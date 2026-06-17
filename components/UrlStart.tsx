import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";

export default function UrlStart() {
  return (
    <form action="/auth/start" method="get" className="mt-9 w-full min-w-0 max-w-full sm:max-w-[480px]">
      <div className="grid w-full min-w-0 gap-2 rounded-xl border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-1.5 transition-[border-color,box-shadow] focus-within:border-[color:var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)] sm:flex sm:items-center sm:pl-4">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-2 sm:px-0">
          <Icon name="language" size={18} className="shrink-0 text-[var(--color-text-3)]" />
          <span className="sr-only">Your company website</span>
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
        </label>
        <PendingSubmitButton
          className="btn-solid h-11 w-full shrink-0 sm:w-auto"
          icon="arrow_forward"
          iconSize={17}
          pendingLabel="Starting"
        >
          Get started
        </PendingSubmitButton>
      </div>
      <p className="mt-2.5 max-w-full pl-1 text-[12.5px] leading-5 text-[var(--color-text-3)]">
        We read your site to draft your profile, audience, and voice.
      </p>
    </form>
  );
}
