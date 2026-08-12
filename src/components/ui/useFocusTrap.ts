import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function collectFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => !el.hasAttribute('data-focus-skip'))
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Focus-trap hook for dialogs / side panels.
 *
 * Attach the returned ref to the modal container. When `active` is true:
 *   - Tab cycles forward inside the container
 *   - Shift+Tab cycles backward
 *   - Escape calls `onEscape` if provided
 *   - Focus is restored to whatever was focused when the modal opened
 *   - Initial focus goes to the first focusable element (or the ref itself if none)
 *
 * Usage:
 *   const ref = useFocusTrap(open, () => setOpen(false));
 *   return open && <div ref={ref} role="dialog">...</div>;
 */
export function useFocusTrap(
  active: boolean,
  onEscape?: () => void,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    previouslyFocusedRef.current = (document.activeElement as HTMLElement) || null;

    // Give the container a tabindex so keyboard focus can land on it as a
    // fallback when no focusable children exist yet.
    if (!container.hasAttribute('tabindex')) {
      container.setAttribute('tabindex', '-1');
    }

    // Initial focus: first focusable child, else container itself.
    const focusables = collectFocusable(container);
    (focusables[0] || container).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && onEscape) {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== 'Tab') return;
      const live = collectFocusable(container!);
      if (live.length === 0) {
        event.preventDefault();
        container!.focus();
        return;
      }
      const first = live[0];
      const last = live[live.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (activeEl === first || !container!.contains(activeEl)) {
          event.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container!.contains(activeEl)) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!container!.contains(event.target as Node)) {
        const live = collectFocusable(container!);
        (live[0] || container!).focus();
      }
    }

    container.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', handleFocusIn);
      const toRestore = previouslyFocusedRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        try {
          toRestore.focus();
        } catch {
          // Element may have been removed from the DOM; ignore.
        }
      }
      previouslyFocusedRef.current = null;
    };
  }, [active, onEscape]);

  return containerRef;
}
