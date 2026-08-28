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

/**
 * The platform in depth, for somebody evaluating it rather than using it.
 *
 * Footer rather than the main row, and that placement is a decision rather
 * than a space saving. PRODUCT.md puts the person with the condition first;
 * the top row is theirs, and a "White paper" sitting beside About and How this
 * works would tell every patient landing here that the site is talking past
 * them to somebody else. A reader evaluating the company looks in a footer
 * without being sent there.
 */
const WHITE_PAPER: NavItem = {
  href: '/white-paper',
  label: 'White paper',
  detail: 'What it does, who it is for, and what is not built yet',
};

const CONTACT: NavItem = {
  href: '/contact',
  label: 'Contact',
  detail: 'Ask a question or report a problem',
};

/**
 * The pages somebody arrives on from a search rather than from the homepage.
 *
 * They exist to be found, which means they also have to be reachable from
 * inside the site: a page reachable only through a sitemap is a page a crawler
 * treats as an afterthought, and a reader who lands on one has nowhere to go
 * next. They live in the footer rather than the main row for the reason the
 * white paper does — the top row belongs to the person with the condition, and
 * it holds four items before it stops fitting on a phone.
 */
const DIABETES_INTELLIGENCE: NavItem = {
  href: '/diabetes-intelligence',
  label: 'Diabetes intelligence',
  detail: 'What the phrase means here, in measurements',
};

const TYPE_2: NavItem = {
  href: '/type-2-diabetes',
  label: 'Type 2 diabetes',
  detail: 'What the engine reads in a type 2 record',
};

const PREDIABETES: NavItem = {
  href: '/prediabetes',
  label: 'Prediabetes',
  detail: 'Slow-moving numbers, over the window they move in',
};

const CLINICIAN_REPORT: NavItem = {
  href: '/clinician-report',
  label: 'Clinician report',
  detail: 'The summary you can take to an appointment',
};

const SECURITY: NavItem = {
  href: '/security',
  label: 'Security',
  detail: 'How your record is held, and what is not in place',
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
  detail: 'What you have proposed, and what came of it',
};

/**
 * Secondary rather than primary, and that placement is the product's position
 * on who this is for. PRODUCT.md puts the clinician second: never the primary
 * voice on the screen, but present enough that a person can see their record
 * produces something a professional will take seriously.
 */
const REPORT: NavItem = {
  href: '/report',
  label: 'Summary for an appointment',
  detail: 'Thirty or ninety days on one page, to bring with you',
};

export const APP_SECONDARY_NAV: NavItem[] = [CARE_PROFILE, EXPERIMENTS, REPORT, CONTACT];

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
 * Named columns rather than one undifferentiated row of links. A reader
 * arrives at a footer with an errand, and the errand is almost always one of
 * these: understand the product, find the page about their own condition,
 * check who is behind it, or read what was agreed.
 *
 * Conditions holds two destinations and keeps its own heading rather than
 * being folded into Product. Those pages are where somebody searching for
 * their own diagnosis lands, and grouping them under a heading that names the
 * condition is the difference between a footer and a signpost.
 */
export const FOOTER_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Product', items: [HOW_IT_WORKS, DIABETES_INTELLIGENCE, CLINICIAN_REPORT] },
  { title: 'Conditions', items: [TYPE_2, PREDIABETES] },
  { title: 'Company', items: [ABOUT, SECURITY, WHITE_PAPER, CONTACT] },
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
