import { INSULIN_BOUNDARY_NOTICE } from '@wellovue/types';

/**
 * The insulin boundary, shown above the findings of anyone who takes insulin.
 *
 * Placed before the findings rather than after them on purpose. Read
 * afterwards it is a caveat on a conclusion already formed; read first it is
 * the frame the conclusions arrive in.
 *
 * Rendered as prose in ordinary ink rather than in a warning colour. Colour on
 * this product means where a glucose value sits and how far a finding can be
 * trusted, and an alarm-coloured panel would teach a reader to dismiss it as
 * boilerplate — which is exactly what happens to the boundary text everybody
 * has learned to skip.
 */
export function InsulinBoundary() {
  return (
    <section
      aria-labelledby="insulin-boundary"
      className="mb-8 border-l-2 border-rule pl-4"
    >
      <h2 id="insulin-boundary" className="text-sm font-medium text-ink">
        {INSULIN_BOUNDARY_NOTICE.title}
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-muted">
        {INSULIN_BOUNDARY_NOTICE.body}
      </p>
    </section>
  );
}
