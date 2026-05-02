'use client'

import { useEffect, useRef, useState } from 'react'

interface AnimatedCounterProps {
  value: string
  className?: string
}

export default function AnimatedCounter({ value, className = '' }: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState('0')
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          setIsVisible(true)
          hasAnimated.current = true
        }
      },
      { threshold: 0.5 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!isVisible) return

    // Parse the numeric part and suffix
    const match = value.match(/^([\d,.]+)(.*)$/)
    if (!match) {
      setDisplayValue(value)
      return
    }

    const numericStr = match[1].replace(/,/g, '')
    const suffix = match[2]
    const target = parseFloat(numericStr)

    if (isNaN(target)) {
      setDisplayValue(value)
      return
    }

    const duration = 1800
    const startTime = performance.now()
    const isDecimal = numericStr.includes('.')
    const decimalPlaces = isDecimal ? numericStr.split('.')[1].length : 0

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = target * eased

      let formatted: string
      if (isDecimal) {
        formatted = current.toFixed(decimalPlaces)
      } else if (target >= 1000) {
        formatted = Math.round(current).toLocaleString()
      } else {
        formatted = Math.round(current).toString()
      }

      setDisplayValue(formatted + suffix)

      if (progress < 1) {
        requestAnimationFrame(animate)
      }
    }

    requestAnimationFrame(animate)
  }, [isVisible, value])

  return (
    <span ref={ref} className={className}>
      {displayValue}
    </span>
  )
}
