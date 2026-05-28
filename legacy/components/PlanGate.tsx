'use client'

import Link from 'next/link'
import type { SubscriptionTier } from '@/lib/lead-credits'
import { hasPlanAccess } from '@/lib/plan-access'

interface PlanGateProps {
  userTier: SubscriptionTier
  requiredTier: SubscriptionTier
  featureName: string
  children: React.ReactNode
}

export default function PlanGate({ userTier, requiredTier, featureName, children }: PlanGateProps) {
  const allowed = hasPlanAccess(userTier, requiredTier)

  if (allowed) return <>{children}</>

  return (
    <div className="relative">
      <div className="pointer-events-none select-none opacity-40 blur-[1px]">
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center z-10">
        <div className="rounded-2xl border border-[var(--color-line-1)] bg-white/95 backdrop-blur-sm shadow-[0_20px_60px_-20px_rgba(0,0,0,0.15)] px-8 py-7 text-center max-w-sm mx-4">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent-bg)] text-[var(--color-accent-ring)]">
            <LockIcon />
          </div>
          <h3 className="text-[15px] font-semibold text-[var(--color-text-1)]">{featureName}</h3>
          <p className="mt-1.5 text-[13px] text-[var(--color-text-3)] leading-relaxed">
            Upgrade to <span className="font-semibold text-[var(--color-accent-ring)]">{capitalize(requiredTier)}</span> to unlock this feature.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Link
              href="/pricing"
              className="h-9 px-5 rounded-full btn-primary text-[13px] font-semibold inline-flex items-center gap-1.5 hover:scale-[1.02] active:scale-[0.98] transition-transform"
            >
              Upgrade plan
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
    </svg>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
