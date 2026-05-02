'use client'

import { useEffect, useRef, useState } from 'react'

interface CardData {
  tag: string
  company: string
  body: string
  tone: 'chip-funding' | 'chip-acquisition' | 'chip-expansion' | 'chip-regulation'
  metric?: string
}

const CARDS: CardData[] = [
  { tag: 'Why now', company: 'Acme Robotics', body: 'Series B signal matched your ICP. Verified contact found.', tone: 'chip-funding', metric: '+$12M' },
  { tag: 'Reply', company: 'Northwind Labs', body: 'Buyer asked for pricing and implementation timeline.', tone: 'chip-acquisition', metric: '3 replies' },
  { tag: 'Next move', company: 'BuildBase', body: 'Open with their hiring push and route to the founder.', tone: 'chip-expansion', metric: 'High intent' },
  { tag: 'Guardrail', company: 'TechFlow', body: 'Send paused by suppression policy. Needs review.', tone: 'chip-regulation', metric: 'Protected' },
]

export default function FloatingCardStack() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="relative w-full max-w-[440px] mx-auto lg:mx-0 select-none" style={{ perspective: '1200px' }}>
      {/* Ambient glow behind */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] -z-10 rounded-[40px] bg-gradient-to-br from-[var(--color-accent-bg)] via-[var(--color-ink-3)] to-[var(--color-accent-glow)] opacity-50 blur-3xl animate-breathe pointer-events-none" />

      <div className="relative h-[420px] md:h-[460px]" style={{ transformStyle: 'preserve-3d' }}>
        {CARDS.map((card, i) => (
          <StackedCard
            key={card.company}
            card={card}
            index={i}
            total={CARDS.length}
            mounted={mounted}
          />
        ))}
      </div>
    </div>
  )
}

function StackedCard({
  card,
  index,
  total,
  mounted,
}: {
  card: CardData
  index: number
  total: number
  mounted: boolean
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [rotation, setRotation] = useState({ x: 0, y: 0 })

  const baseDelay = index * 150
  const spreadX = (index - (total - 1) / 2) * 14
  const spreadY = index * 28
  const baseRotateZ = (index - (total - 1) / 2) * 1.5

  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    const handleMouseMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const rotateX = ((e.clientY - centerY) / (rect.height / 2)) * -8
      const rotateY = ((e.clientX - centerX) / (rect.width / 2)) * 8
      setRotation({ x: rotateX, y: rotateY })
    }

    const handleMouseLeave = () => {
      setRotation({ x: 0, y: 0 })
    }

    el.addEventListener('mousemove', handleMouseMove)
    el.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      el.removeEventListener('mousemove', handleMouseMove)
      el.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [])

  const transform = mounted
    ? `translate3d(${spreadX}px, ${spreadY}px, 0px) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg) rotateZ(${baseRotateZ}deg)`
    : `translate3d(0px, ${40 + index * 10}px, -${index * 40}px) rotateX(15deg) rotateZ(${baseRotateZ}deg)`

  return (
    <div
      ref={cardRef}
      className="absolute top-0 left-0 right-0 card overflow-hidden shadow-xl cursor-pointer hover:shadow-2xl"
      style={{
        transform,
        opacity: mounted ? 1 : 0,
        transformStyle: 'preserve-3d',
        zIndex: total - index,
        transitionProperty: 'transform, opacity, box-shadow',
        transitionDuration: mounted ? '500ms, 700ms, 300ms' : '0ms, 0ms, 0ms',
        transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1), ease, ease',
        transitionDelay: mounted ? `${baseDelay}ms, ${baseDelay}ms, 0ms` : '0ms, 0ms, 0ms',
      }}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`pill ${card.tone} text-[10px]`}>{card.tag}</span>
            {card.metric && (
              <span className="text-[10px] font-semibold text-[var(--color-accent)]">{card.metric}</span>
            )}
          </div>
          <p className="truncate text-[13px] font-semibold text-[var(--color-text-1)]">{card.company}</p>
          <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[var(--color-text-3)]">{card.body}</p>
        </div>
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)] animate-pulse" />
      </div>
    </div>
  )
}
