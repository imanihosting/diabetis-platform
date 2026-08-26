/**
 * One definition of the site's navigation, used by both shells.
 *
 * The two surfaces render it differently on purpose. On the landing page these
 * links are the navigation; inside the app they are secondary to the daily
 * work, so they sit behind a disclosure rather than competing with Timeline,
 * Log and Evidence for the same row.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Used in the app's disclosure, where a link needs to explain itself. */
  detail?: string;
}

export const MARKETING_NAV: NavItem[] = [
  { href: '/about', label: 'About', detail: 'Why this exists, and who it is for' },
  {
    href: '/how-it-works',
    label: 'How this works',
    detail: 'From a reading to evidence you can check',
  },
  { href: '/contact', label: 'Contact', detail: 'Ask a question or report a problem' },
];

/**
 * Kept separate from MARKETING_NAV so it can sit in the footer on both
 * surfaces without ever being promoted into the main row. Nobody navigates to
 * a cookie policy; they go looking for it.
 */
export const LEGAL_NAV: NavItem[] = [
  { href: '/privacy', label: 'Privacy', detail: 'What we hold, and what we do not' },
  { href: '/terms', label: 'Terms', detail: 'What this service is, and is not' },
  { href: '/cookies', label: 'Cookies', detail: 'One cookie, and what it does' },
];

export const APP_NAV: NavItem[] = [
  { href: '/timeline', label: 'Timeline' },
  { href: '/log', label: 'Log' },
  { href: '/evidence', label: 'Evidence' },
];

/** Marks the parent section as current for nested routes such as /about/data. */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
