'use client'

import { ReactNode } from 'react'

interface GradientTextProps {
  children: ReactNode
  className?: string
  as?: 'span' | 'h1' | 'h2' | 'h3' | 'p'
}

export default function GradientText({ children, className = '', as: Component = 'span' }: GradientTextProps) {
  return (
    <Component className={`text-gradient-animated ${className}`}>
      {children}
    </Component>
  )
}
