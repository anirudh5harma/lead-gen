'use client'

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Icon from "@/components/Icon";

type ToastVariant = 'error' | 'success' | 'info'

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastApi {
  /** Show a toast (bottom-right, auto-dismiss after 5s, manual close via ✕). */
  toast: (message: string, variant?: ToastVariant) => void
  error: (message: string) => void
  success: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TOAST_LIFETIME_MS = 5000

const VARIANT_STYLE: Record<ToastVariant, { bar: string; icon: string }> = {
  error: { bar: 'bg-error', icon: 'error' },
  success: { bar: 'bg-pos', icon: 'check_circle' },
  info: { bar: 'bg-[var(--color-text-1)]', icon: 'info' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
    }
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      const text = (message ?? '').toString().trim()
      if (!text) return
      const id = (idRef.current += 1)
      setToasts(prev => [...prev, { id, message: text, variant }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_LIFETIME_MS),
      )
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      toast: (m, v = 'info') => push(m, v),
      error: m => push(m, 'error'),
      success: m => push(m, 'success'),
      info: m => push(m, 'info'),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Suspense fallback={null}>
        <ToastUrlBridge />
      </Suspense>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-[min(92vw,22rem)] flex-col gap-2">
        {toasts.map(t => {
          const style = VARIANT_STYLE[t.variant]
          return (
            <div
              key={t.id}
              role={t.variant === 'error' ? 'alert' : 'status'}
              className="pointer-events-auto flex items-start gap-2.5 overflow-hidden rounded-xl border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3.5 py-3 shadow-[0_8px_24px_-6px_rgba(26,20,17,0.18)]"
            >
              <span className={`mt-0.5 h-4 w-1 shrink-0 rounded-full ${style.bar}`} aria-hidden="true" />
              <Icon
                name={style.icon}
                size={18}
                className="mt-0.5 shrink-0 text-[var(--color-text-2)]"
              />
              <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-[var(--color-text-1)]">
                {t.message}
              </p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="-mr-1 -mt-0.5 shrink-0 rounded p-0.5 text-[var(--color-text-4)] transition-colors hover:text-[var(--color-text-1)]"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

function ToastUrlBridge() {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()
  const { error, success, info } = useToast()
  const lastShownRef = useRef<string | null>(null)

  useEffect(() => {
    const message = searchParams.get('toast')?.trim()
    if (!message) return

    const key = `${pathname}?${searchParams.toString()}`
    if (lastShownRef.current === key) return
    lastShownRef.current = key

    const variant = searchParams.get('toast_variant')
    if (variant === 'error') {
      error(message)
    } else if (variant === 'success') {
      success(message)
    } else {
      info(message)
    }

    const cleanParams = new URLSearchParams(searchParams.toString())
    cleanParams.delete('toast')
    cleanParams.delete('toast_variant')
    const cleanQuery = cleanParams.toString()
    const cleanUrl = `${pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`
    window.history.replaceState(null, '', cleanUrl)
  }, [error, info, pathname, searchParams, success])

  return null
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>')
  }
  return ctx
}
