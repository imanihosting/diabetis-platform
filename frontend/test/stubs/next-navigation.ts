/**
 * Just enough of `next/navigation` to render a public page in a test.
 *
 * The real module reads from a request context that only exists inside a Next
 * server render. The shells call `usePathname` to mark the current nav item,
 * which is not what any of these tests are about — so it answers with the
 * site root and nothing else here needs to know.
 */
export function usePathname(): string {
  return '/';
}

export function useRouter() {
  return { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} };
}

/**
 * The query string a test wants the page to see.
 *
 * The account pages branch on it — a verification link carries its token here,
 * and "no token" is one of the states the page has to handle — so the stub
 * needs to be settable rather than always empty.
 */
let searchParams = new URLSearchParams();

export function useSearchParams(): URLSearchParams {
  return searchParams;
}

/** Test-only. Set the query string the next render will read. */
export function __setSearchParams(query: string): void {
  searchParams = new URLSearchParams(query);
}
