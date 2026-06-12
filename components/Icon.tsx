import type { CSSProperties, ReactNode } from "react";

type IconNode = ReactNode;

const icons: Record<string, IconNode> = {
  account_tree: (
    <>
      <path d="M12 5v4" />
      <path d="M6 13V9h12v4" />
      <rect x="9" y="3" width="6" height="4" rx="1.2" />
      <rect x="3" y="13" width="6" height="5" rx="1.2" />
      <rect x="15" y="13" width="6" height="5" rx="1.2" />
    </>
  ),
  add_business: (
    <>
      <path d="M4 20V7l8-3 8 3v13" />
      <path d="M8 10h2M8 14h2M14 10h2" />
      <path d="M14 16h5M16.5 13.5v5" />
    </>
  ),
  arrow_forward: <path d="M5 12h14M13 6l6 6-6 6" />,
  article: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h5M9 12h6M9 16h6" />
    </>
  ),
  auto_awesome: (
    <>
      <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z" />
      <path d="M5 15l.7 2.3L8 18l-2.3.7L5 21l-.7-2.3L2 18l2.3-.7zM19 3l.7 2.3L22 6l-2.3.7L19 9l-.7-2.3L16 6l2.3-.7z" />
    </>
  ),
  badge: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <circle cx="12" cy="10" r="2.5" />
      <path d="M8.5 16a4 4 0 0 1 7 0" />
    </>
  ),
  campaign: (
    <>
      <path d="M4 13h3l9 4V7L7 11H4z" />
      <path d="M7 13v5M18 10l2-2M18 14l2 2" />
    </>
  ),
  check: <path d="M5 12.5l4 4L19 6.5" />,
  check_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.7 2.7L16.5 9" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  dashboard: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  delete: (
    <>
      <path d="M5 7h14M10 11v6M14 11v6" />
      <path d="M8 7l1-3h6l1 3M7 7l1 13h8l1-13" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14 6l4 4" />
    </>
  ),
  edit_note: (
    <>
      <path d="M4 6h11M4 11h8M4 16h6" />
      <path d="M14 19l5-5a1.8 1.8 0 0 0-2.5-2.5l-5 5V19z" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  fact_check: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M7 9h4M7 14h4M14 10l1.5 1.5L18 8.5M14 15l1.5 1.5L18 13.5" />
    </>
  ),
  forum: (
    <>
      <path d="M5 6h11a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H9l-4 4v-4a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z" />
      <path d="M8 10h7M8 13h5" />
    </>
  ),
  health_and_safety: (
    <>
      <path d="M12 3l8 3v6c0 4.6-3.2 7.5-8 9-4.8-1.5-8-4.4-8-9V6z" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  language: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  login: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3" />
      <path d="M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" />
    </>
  ),
  logout: (
    <>
      <path d="M14 17l5-5-5-5M19 12H8" />
      <path d="M10 4H6a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  monitor_heart: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 11h2l1.4-3 2.2 6 1.4-3h1.8" />
      <path d="M9 21h6M12 17v4" />
    </>
  ),
  neurology: (
    <>
      <path d="M8 14a4 4 0 0 1-2-7.5A4 4 0 0 1 13 5a4 4 0 0 1 5 5.2A4 4 0 0 1 15.5 17H15" />
      <path d="M9 12h6M12 9v9M9 18h6" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  rate_review: (
    <>
      <path d="M5 5h14v10H9l-4 4z" />
      <path d="M9 9h6M9 12h4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19 8a7 7 0 1 0 1 6" />
      <path d="M19 4v4h-4" />
    </>
  ),
  report: (
    <>
      <path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  rocket_launch: (
    <>
      <path d="M13 5c2.5-2.5 5.2-2.4 6-2.1.3.8.4 3.5-2.1 6l-6.5 6.5-3.8-3.8z" />
      <path d="M8 14l-4 2 2-4M10 18l-1 4 4-1M15 7h.01" />
    </>
  ),
  save: (
    <>
      <path d="M5 4h12l2 2v14H5z" />
      <path d="M8 4v6h7V4M8 20v-6h8v6" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  science: (
    <>
      <path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3" />
      <path d="M8 15h8" />
    </>
  ),
  send: <path d="M4 4l16 8-16 8 3-8zM7 12h13" />,
  sensors: (
    <>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9M4.5 4.5a10.5 10.5 0 0 0 0 15M19.5 4.5a10.5 10.5 0 0 1 0 15" />
    </>
  ),
  sync_alt: (
    <>
      <path d="M7 7h12l-3-3M17 17H5l3 3" />
      <path d="M19 7l-3 3M5 17l3-3" />
    </>
  ),
  sync_problem: (
    <>
      <path d="M19 8a7 7 0 0 0-11.8-3.1L5 7" />
      <path d="M5 4v3h3" />
      <path d="M5 16a7 7 0 0 0 11.8 3.1L19 17" />
      <path d="M19 20v-3h-3" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  task_alt: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 12.5l3 3 6-7" />
    </>
  ),
  travel_explore: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M4 11h14M11 4a11 11 0 0 1 0 14M11 4a11 11 0 0 0 0 14" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  tune: (
    <>
      <path d="M4 7h8M16 7h4M4 17h4M12 17h8M10 5v4M14 15v4" />
    </>
  ),
};

const aliases: Record<string, string> = {
  check_small: "check",
};

export default function Icon({
  name,
  className = "",
  size = 20,
  fill = false,
  weight,
  style,
}: {
  name: string;
  className?: string;
  size?: number;
  fill?: boolean;
  weight?: number;
  style?: CSSProperties;
}) {
  const glyph = icons[name] ?? icons[aliases[name]] ?? icons.auto_awesome;
  const strokeWidth = weight ? Math.max(1.4, Math.min(2.5, weight / 250)) : 1.8;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {glyph}
    </svg>
  );
}
