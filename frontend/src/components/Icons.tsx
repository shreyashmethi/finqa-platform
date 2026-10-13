// A small inline icon set (stroke icons on a 24px grid) so the UI needs no icon font or CDN.
// Icons are decorative by default; pass ``label`` when an icon carries meaning on its own.
import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5" />,
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
    </>
  ),
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3.5h16V16" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  play: <path d="M7 5v14l11-7z" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
      <path d="M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  check: <path d="M5 12.5 10 17 19 7" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  arrowRight: <path d="M4 12h15M13 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1" />
      <path d="M3.5 10h17M3.5 14.5h17M9.5 5v14" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10" />
    </>
  ),
  logout: <path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" />,
  plus: <path d="M12 5v14M5 12h14" />,
  alert: (
    <>
      <path d="M12 4 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1" />,
  zoom: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5M8 11h6M11 8v6" />
    </>
  ),
  building: (
    <>
      <path d="M4 20V5.5L12 3v17M12 8.5l8 2.5v9" />
      <path d="M2.5 20h19M7 8h2M7 11.5h2M7 15h2M15 13.5h2M15 16.5h2" />
    </>
  ),
  activity: <path d="M3 12h4l2.5-6 5 12L17 12h4" />,
  chart: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-5M12 16V8M16 16v-3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.3c2.1.7 3.5 2.8 3.5 5.7" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="7" rx="1.5" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.5" />
      <path d="M7.5 7.5h.01M7.5 16.5h.01" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 16.8v.1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="1.5" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9 4v16" />
    </>
  ),
  trash: <path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[name]}
    </svg>
  );
}
