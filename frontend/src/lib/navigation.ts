/**
 * One definition of the site's navigation, shared by both shells.
 *
 * Each destination is declared once and composed into the lists below, so the
 * two surfaces cannot drift apart on a label or a URL.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Used in the app's disclosure, where a link needs to explain itself. */
  detail?: string;
}

const ABOUT: NavItem = {
  href: '/about',
  label: 'About',
  detail: 'Why this exists, and who it is for',
};

const HOW_IT_WORKS: NavItem = {
  href: '/how-it-works',
  label: 'How this works',
  detail: 'From a reading to evidence you can check',
};

const CONTACT: NavItem = {
  href: '/contact',
  label: 'Contact',
  detail: 'Ask a question or report a problem',
};

/** The public pages. These are the navigation on the marketing surface. */
export const MARKETING_NAV: NavItem[] = [ABOUT, HOW_IT_WORKS, CONTACT];

/**
 * The public pages that still earn their place once someone is signed in.
 *
 * About and How this works are for deciding whether to use Wellovue. Somebody
 * already looking at their own timeline has made that decision, and the answer
 * is in front of them. Contact stays, because needing help does not stop at
 * sign-in.
 */
export const APP_SECONDARY_NAV: NavItem[] = [CONTACT];

/**
 * Kept separate so it can sit in the footer on both surfaces without ever
 * being promoted into the main row. Nobody navigates to a cookie policy; they
 * go looking for it.
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
