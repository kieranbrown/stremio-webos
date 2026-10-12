import { onCleanup } from 'solid-js';

export type Key = 'up' | 'down' | 'left' | 'right' | 'enter' | 'back';

// LG Magic Remote / D-pad key codes. 461 is webOS "Back".
const CODES: Record<number, Key> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'enter',
  461: 'back',
  27: 'back',
  8: 'back',
};

/** Register a remote-key handler for the lifetime of the calling component. */
export function useKeys(handler: (key: Key) => void) {
  const listener = (e: KeyboardEvent) => {
    const key = CODES[e.keyCode];
    if (!key) return;
    e.preventDefault();
    handler(key);
  };
  window.addEventListener('keydown', listener);
  onCleanup(() => window.removeEventListener('keydown', listener));
}
