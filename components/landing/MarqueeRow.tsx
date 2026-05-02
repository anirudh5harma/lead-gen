'use client'

import { ReactNode } from 'react'

interface MarqueeRowProps {
  children: ReactNode
  speed?: number
  direction?: 'left' | 'right'
  pauseOnHover?: boolean
  className?: string
}

export default function MarqueeRow({
  children,
  speed = 40,
  direction = 'left',
  pauseOnHover = true,
  className = '',
}: MarqueeRowProps) {
  const animationDirection = direction === 'right' ? 'reverse' : 'normal'

  return (
    <div
      className={`overflow-hidden ${className}`}
      style={{ maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)' }}
    >
      <div
        className="flex w-max"
        style={{
          animation: `marquee ${speed}s linear infinite`,
          animationDirection,
        }}
        onMouseEnter={(e) => {
          if (pauseOnHover) {
            e.currentTarget.style.animationPlayState = 'paused'
          }
        }}
        onMouseLeave={(e) => {
          if (pauseOnHover) {
            e.currentTarget.style.animationPlayState = 'running'
          }
        }}
      >
        <div className="flex items-center gap-8 pr-8">{children}</div>
        <div className="flex items-center gap-8 pr-8" aria-hidden>{children}</div>
      </div>
    </div>
  )
}
