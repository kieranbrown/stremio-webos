import { createSignal, Show } from 'solid-js';
import { art } from '../data/cinemeta';
import type { MetaPreview } from '../data/types';
import { Img } from './Img';

/** Landscape artwork tile with the title logo laid over it. */
export function Tile(props: { item: MetaPreview; focused: boolean }) {
  const [noLogo, setNoLogo] = createSignal(false);
  return (
    <div class="tile" classList={{ focused: props.focused }}>
      <div class="tile-art">
        <Img class="bg" src={art.tile(props.item.id)} />
        <Show when={!noLogo()} fallback={<div class="tile-name">{props.item.name}</div>}>
          <Img class="tile-logo" src={art.logo(props.item.id)} onError={() => setNoLogo(true)} />
        </Show>
      </div>
      <div class="tile-caption">
        {[props.item.name, props.item.releaseInfo].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}
