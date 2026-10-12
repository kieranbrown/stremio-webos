import { createEffect, createSignal, on, onCleanup } from 'solid-js';

/**
 * Full-bleed artwork that crossfades between two stacked layers. A new image
 * is only swapped in once it has decoded, so the transition never shows a
 * half-loaded frame. Rapid changes (scrolling a row) are debounced.
 */
export function Backdrop(props: { src?: string; dim?: number; debounceMs?: number }) {
  const [layers, setLayers] = createSignal<[string | undefined, string | undefined]>([undefined, undefined]);
  const [front, setFront] = createSignal(0);
  let timer: number | undefined;
  let pending = 0;

  createEffect(
    on(
      () => props.src,
      (src) => {
        window.clearTimeout(timer);
        if (!src) return;
        const ticket = ++pending;
        timer = window.setTimeout(() => {
          const img = new Image();
          img.decoding = 'async';
          img.src = src;
          const show = () => {
            if (ticket !== pending) return;
            const next = 1 - front();
            const l = layers().slice() as [string | undefined, string | undefined];
            l[next] = src;
            setLayers(l);
            setFront(next);
          };
          (img.decode ? img.decode() : Promise.resolve()).then(show, show);
        }, props.debounceMs ?? 0);
      },
    ),
  );
  onCleanup(() => window.clearTimeout(timer));

  return (
    <div class="backdrop" style={{ opacity: props.dim ?? 1, transition: 'opacity 500ms' }}>
      {[0, 1].map((i) => (
        <div class="backdrop-layer" style={{ opacity: front() === i && layers()[i] ? 1 : 0 }}>
          {layers()[i] && <img src={layers()[i]} alt="" />}
        </div>
      ))}
      <div class="backdrop-scrim" />
    </div>
  );
}
