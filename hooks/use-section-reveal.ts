'use client'

import { useEffect } from 'react'

export function useSectionReveal(selector = '.section-reveal') {
  useEffect(() => {
    const root = document.documentElement
    const sections = Array.from(document.querySelectorAll<HTMLElement>(selector))
    if (!sections.length) return

    root.classList.add('reveal-enabled')

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      sections.forEach(section => section.classList.add('is-visible'))
      return () => {
        root.classList.remove('reveal-enabled')
      }
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.14 },
    )

    sections.forEach(section => observer.observe(section))

    return () => {
      observer.disconnect()
      root.classList.remove('reveal-enabled')
    }
  }, [selector])
}
