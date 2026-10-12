import { createSignal, createEffect } from 'solid-js';

/** <img> that fades in once decoded, and hides itself if the URL 404s. */
export function Img(props: { src?: string; class?: string; alt?: string; onError?: () => void }) {
  const [loaded, setLoaded] = createSignal(false);
  // Only reset when the URL really changes; the same URL won't fire onLoad again.
  let last = props.src;
  createEffect(() => {
    if (props.src !== last) (last = props.src), setLoaded(false);
  });
  return (
    <img
      class={`img ${props.class ?? ''}`}
      classList={{ loaded: loaded() }}
      src={props.src}
      alt={props.alt ?? ''}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => props.onError?.()}
    />
  );
}
