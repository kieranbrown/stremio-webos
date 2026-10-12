import { createSignal, For, Show } from 'solid-js';
import { art } from '../data/cinemeta';
import type { MetaPreview } from '../data/types';
import { Img } from './Img';

/** Title logo (or text fallback), metadata line and synopsis. */
export function MetaInfo(props: { item: MetaPreview; lines?: number }) {
  const [noLogo, setNoLogo] = createSignal(false);
  const facts = () =>
    [props.item.releaseInfo, props.item.runtime, props.item.genres?.slice(0, 2).join(', ')].filter(Boolean);
  return (
    <>
      <Show when={!noLogo()} fallback={<h1 class="text-title">{props.item.name}</h1>}>
        <Img class="logo-title" src={art.logo(props.item.id)} alt={props.item.name} onError={() => setNoLogo(true)} />
      </Show>
      <div class="meta-line">
        <For each={facts()}>
          {(fact, i) => (
            <>
              {i() > 0 && <span class="dot" />}
              <span>{fact}</span>
            </>
          )}
        </For>
        <Show when={props.item.imdbRating}>
          <span class="dot" />
          <span class="badge">IMDb {props.item.imdbRating}</span>
        </Show>
      </div>
      <Show when={props.item.description}>
        <p class="description" style={{ '-webkit-line-clamp': props.lines ?? 3 }}>
          {props.item.description}
        </p>
      </Show>
    </>
  );
}
