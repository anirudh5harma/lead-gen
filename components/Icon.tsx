import type { CSSProperties } from 'react'

/**
 * Material Symbols Outlined glyph. Font is loaded globally in app/layout.tsx.
 * Usage: <Icon name="sync_alt" /> · <Icon name="sensors" fill size={18} />
 */
export default function Icon({
  name,
  className = '',
  size,
  fill = false,
  weight,
  style,
}: {
  name: string
  className?: string
  size?: number
  fill?: boolean
  weight?: number
  style?: CSSProperties
}) {
  const fvs: string[] = []
  if (fill) fvs.push("'FILL' 1")
  if (weight) fvs.push(`'wght' ${weight}`)
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      aria-hidden="true"
      style={{
        ...(size ? { fontSize: size } : null),
        ...(fvs.length ? { fontVariationSettings: fvs.join(', ') } : null),
        ...style,
      }}
    >
      {name}
    </span>
  )
}
