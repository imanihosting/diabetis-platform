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

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}
