'use client'

import Link, { type LinkProps } from 'next/link'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'

const Spinner = () => <span className="pending-submit-spinner shrink-0" aria-hidden="true" />

type PendingNavLinkProps = LinkProps & {
  className?: string
  children: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
}

function shouldBypassPending(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

/**
 * Marketing CTA link that shows a spinner and disables itself the moment it is
 * clicked, so login / get-started buttons give immediate feedback while the
 * browser routes to /auth/start or the Google sign-in flow (these are full
 * navigations, so the pending state stays visible until the next page loads).
 */
export function PendingNavLink({
  href,
  prefetch,
  className = '',
  children,
  leading,
  trailing,
}: PendingNavLinkProps) {
  const [pending, setPending] = useState(false)

  return (
    <Link
      href={href}
      prefetch={prefetch}
      aria-busy={pending}
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) {
          event.preventDefault()
          return
        }
        if (event.defaultPrevented || shouldBypassPending(event)) return
        setPending(true)
      }}
      className={`${className} ${pending ? "pointer-events-none cursor-wait opacity-70" : ""}`}
    >
      {pending ? <Spinner /> : leading}
      {children}
      {pending ? null : trailing}
    </Link>
  )
}

/**
 * Submit button for the hero domain form. Spins + disables on submit, but only
 * once native validation passes (an invalid domain must not get stuck spinning).
 */
export function PendingFormSubmit({
  className = '',
  children,
  trailing,
}: {
  className?: string
  children: ReactNode
  trailing?: ReactNode
}) {
  const [pending, setPending] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const form = buttonRef.current?.form
    if (!form) return

    function handleSubmit() {
      setPending(true)
    }

    form.addEventListener('submit', handleSubmit)
    return () => {
      form.removeEventListener('submit', handleSubmit)
    }
  }, [])

  return (
    <button
      ref={buttonRef}
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-disabled={pending}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? <Spinner /> : null}
      {children}
      {pending ? null : trailing}
    </button>
  )
}
