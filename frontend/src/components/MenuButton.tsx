import type { ReactNode } from 'react';

/**
 * The look of a collapsed-navigation trigger, without the button element.
 *
 * Disclosure owns the actual <button>: it holds the ref that returns focus on
 * Escape, and the aria-expanded/aria-controls pair that tells a screen reader
 * what the thing does. A component that rendered its own button would have to
 * be nested inside that one, which is invalid HTML and breaks the label
 * association. So the control stays there and the appearance lives here.
 *
 * The word "Menu" on its own, underlined, was indistinguishable from a text
 * link and gave a thumb about 20px of vertical target to find. This is a
 * bordered control with an icon, a label, and a 44px minimum height, the floor
 * both Apple and WCAG 2.2 set for a touch target.
 *
 * Icon and label together, not an icon alone. A bare hamburger is learnable,
 * but this product is read by people with retinopathy, and a three-line glyph
 * at 16px is exactly what disappears first. The word costs four characters and
 * removes the guess.
 *
 * The border is `ink-faint`, not `rule`. `rule` measures 1.32:1 against the
 * paper, which is right for a separator and wrong here: this border is the
 * only thing that says "button", and WCAG 2.1 SC 1.4.11 asks 3:1 of anything
 * carrying that. The faint ink is 4.66:1.
 */
export const MENU_TRIGGER_CLASS =
  'btn btn-secondary min-h-[2.75rem] gap-2.5 px-4 text-sm';

export function MenuTriggerContent({ open }: { open: boolean }): ReactNode {
  return (
    <>
      <svg
        viewBox="0 0 16 12"
        className="h-3 w-4 shrink-0"
        aria-hidden
        focusable="false"
      >
        {open ? (
          <>
            <line
              x1="1.5"
              y1="1.5"
              x2="14.5"
              y2="10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1="14.5"
              y1="1.5"
              x2="1.5"
              y2="10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </>
        ) : (
          [1.5, 6, 10.5].map((y) => (
            <line
              key={y}
              x1="0.5"
              y1={y}
              x2="15.5"
              y2={y}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ))
        )}
      </svg>
      {open ? 'Close' : 'Menu'}
    </>
  );
}
