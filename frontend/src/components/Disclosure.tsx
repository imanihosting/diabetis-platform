'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A button that reveals a panel, with the keyboard behaviour people expect:
 * Escape closes it, a click outside closes it, and focus returns to the
 * trigger so a keyboard user is not dropped at the top of the document.
 *
 * Shared by both shells because the behaviour is identical even though the two
 * surfaces look nothing alike; everything visual arrives as a class name.
 */
export function Disclosure({
  label,
  openLabel,
  children,
  triggerClassName,
  panelClassName,
  align = 'right',
}: {
  label: string;
  openLabel?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  triggerClassName?: string;
  panelClassName?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {open && openLabel ? openLabel : label}
      </button>

      {open && (
        <div
          id={panelId}
          className={`absolute top-full z-20 mt-3 ${align === 'right' ? 'right-0' : 'left-0'} ${panelClassName ?? ''}`}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
}
