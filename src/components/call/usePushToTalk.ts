import { useEffect, useState } from 'react';

export interface UsePushToTalkOptions {
  enabled: boolean;
  keybind: string;
  onMuted: (muted: boolean) => void | Promise<void>;
}

/**
 * Push-to-talk: mutes the mic by default and unmutes only while the keybind
 * is held. When `enabled` is false, this is a no-op.
 *
 * Returns a boolean indicating whether the key is currently pressed — useful
 * for rendering a "PTT active" indicator.
 */
export function usePushToTalk({ enabled, keybind, onMuted }: UsePushToTalkOptions): boolean {
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPressed(false);
      // Leaving PTT mode — unmute.
      void onMuted(false);
      return;
    }

    // Entering PTT mode — start muted.
    void onMuted(true);

    let holdPressed = false;
    const handleDown = (event: KeyboardEvent) => {
      if (event.code !== keybind) return;
      // Don't capture when typing in an input / textarea / contenteditable.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (holdPressed) return;
      holdPressed = true;
      setPressed(true);
      event.preventDefault();
      void onMuted(false);
    };
    const handleUp = (event: KeyboardEvent) => {
      if (event.code !== keybind) return;
      if (!holdPressed) return;
      holdPressed = false;
      setPressed(false);
      event.preventDefault();
      void onMuted(true);
    };
    const handleBlur = () => {
      if (!holdPressed) return;
      holdPressed = false;
      setPressed(false);
      void onMuted(true);
    };

    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
      window.removeEventListener('blur', handleBlur);
      if (holdPressed) {
        void onMuted(true);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, keybind]);

  return pressed;
}
