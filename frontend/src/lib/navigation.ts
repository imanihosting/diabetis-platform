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
const CARE_PROFILE: NavItem = {
  href: '/profile',
  label: 'Care profile',
  detail: 'What kind of diabetes, and what changes how it is read',
};

const EXPERIMENTS: NavItem = {
  href: '/experiments',
  label: 'Experiments',
  detail: 'What you have proposed, and what the safety rules said',
};

export const APP_SECONDARY_NAV: NavItem[] = [CARE_PROFILE, EXPERIMENTS, CONTACT];

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

/**
 * The footer's groups.
 *
 * Three named columns rather than one undifferentiated row of links. A reader
 * arrives at a footer with an errand, and the errand is almost always one of
 * these: understand the product, get help, or check what was agreed.
 *
 * Support holds a single destination and keeps its heading anyway. The label
 * is doing the work of telling someone where to go with a problem; dropping it
 * to save a line would trade a signpost for a link.
 */
export const FOOTER_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Product', items: [ABOUT, HOW_IT_WORKS] },
  { title: 'Support', items: [CONTACT] },
  { title: 'Legal', items: LEGAL_NAV },
];

/**
 * Where "create an account" goes.
 *
 * /login carries both forms behind one state, so the query parameter is what
 * decides which one a visitor lands on. Sending someone who clicked "Create
 * account" to a sign-in form is a small betrayal that costs a signup.
 */
export const CREATE_ACCOUNT_HREF = '/login?create=1';
export const SIGN_IN_HREF = '/login';

/**
 * The safety boundary, in the words both shells use.
 *
 * PRODUCT.md is explicit that this is a reason to trust the platform rather
 * than fine print, so it is declared here as content and given a heading and a
 * readable size wherever it appears. Two surfaces, one sentence, no drift.
 */
export const CARE_BOUNDARY = {
  title: 'Care boundary',
  body:
    'Wellovue helps you understand patterns in your own data and prepare for ' +
    'conversations with your clinician. It is not a medical device. It does ' +
    'not diagnose, adjust medication, or advise you in an emergency. Always ' +
    'speak to your clinician before changing anything about your treatment.',
} as const;

/** Marks the parent section as current for nested routes such as /about/data. */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
