import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { Backdrop } from '../components/Backdrop';
import { Img } from '../components/Img';
import { MetaInfo } from '../components/MetaInfo';
import { Row } from '../components/Row';
import { FilmIcon, PlayIcon, PlusIcon } from '../components/icons';
import { art } from '../data/cinemeta';
import type { ContentSource, MetaPreview, Video } from '../data/types';
import { useKeys } from '../keys';

type Zone = 'buttons' | 'seasons' | 'episodes';
const BUTTONS = 3;

export function Details(props: {
  source: ContentSource;
  item: MetaPreview;
  active: boolean;
  onBack: () => void;
}) {
  const [meta] = createResource(() => props.item, (item) => props.source.meta(item.type, item.id));
  const [zone, setZone] = createSignal<Zone>('buttons');
  const [button, setButton] = createSignal(0);
  const [seasonIdx, setSeasonIdx] = createSignal(0);
  const [episode, setEpisode] = createSignal(0);

  // Specials (season 0) go last, as on tvOS.
  const seasons = createMemo(() => {
    const nums = [...new Set((meta()?.videos ?? []).map((v) => v.season ?? 0))];
    return nums.sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  });
  const episodes = createMemo<Video[]>(() =>
    (meta()?.videos ?? [])
      .filter((v) => (v.season ?? 0) === seasons()[seasonIdx()])
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
  );
  const isSeries = () => props.item.type === 'series' && seasons().length > 0;

  useKeys((key) => {
    if (!props.active) return;
    if (key === 'back') return props.onBack();
    switch (zone()) {
      case 'buttons':
        if (key === 'left') setButton(Math.max(0, button() - 1));
        if (key === 'right') setButton(Math.min(BUTTONS - 1, button() + 1));
        if (key === 'down' && isSeries()) setZone('seasons');
        break;
      case 'seasons':
        if (key === 'left' && seasonIdx() > 0) (setSeasonIdx(seasonIdx() - 1), setEpisode(0));
        if (key === 'right' && seasonIdx() < seasons().length - 1) (setSeasonIdx(seasonIdx() + 1), setEpisode(0));
        if (key === 'up') setZone('buttons');
        if (key === 'down') setZone('episodes');
        break;
      case 'episodes':
        if (key === 'left') setEpisode(Math.max(0, episode() - 1));
        if (key === 'right') setEpisode(Math.min(episodes().length - 1, episode() + 1));
        if (key === 'up') setZone('seasons');
        break;
    }
  });

  const credits = () => {
    const m = meta();
    if (!m) return [];
    return [
      m.director?.length ? ['Director', m.director.slice(0, 2).join(', ')] : null,
      m.cast?.length ? ['Starring', m.cast.slice(0, 4).join(', ')] : null,
    ].filter(Boolean) as string[][];
  };

  return (
    <>
      <Backdrop src={art.backdrop(props.item.id)} />
      <div class="details-body">
        <div class="details-info" style={{ bottom: isSeries() ? '420px' : '150px' }}>
          <MetaInfo item={meta() ?? props.item} lines={isSeries() ? 2 : 4} />
          <div class="details-buttons">
            <div class="btn" classList={{ focused: zone() === 'buttons' && button() === 0 }}>
              <PlayIcon /> {isSeries() ? 'Play S1 E1' : 'Play'}
            </div>
            <div class="btn" classList={{ focused: zone() === 'buttons' && button() === 1 }}>
              <FilmIcon /> Trailer
            </div>
            <div class="btn btn-icon" classList={{ focused: zone() === 'buttons' && button() === 2 }}>
              <PlusIcon />
            </div>
          </div>
          <Show when={!isSeries() && credits().length}>
            <div class="details-credits">
              <For each={credits()}>
                {([label, names]) => (
                  <div>
                    <b>{label}</b>&nbsp;&nbsp;{names}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={isSeries()}>
          <div class="episodes" style={{ top: '690px' }}>
            <div class="season-tabs">
              <For each={seasons()}>
                {(n, i) => (
                  <div
                    class="season-tab"
                    classList={{ current: i() === seasonIdx(), focused: zone() === 'seasons' && i() === seasonIdx() }}
                  >
                    {n === 0 ? 'Specials' : `Season ${n}`}
                  </div>
                )}
              </For>
            </div>
            <Row items={episodes()} focusedIndex={episode()} active={zone() === 'episodes'}>
              {(v, focused) => (
                <div class="tile" classList={{ focused: focused() }}>
                  <div class="tile-art">
                    <Img class="bg" src={v.thumbnail} />
                  </div>
                  <div class="episode-meta">
                    <div class="num">EPISODE {v.episode}</div>
                    <div class="name">{v.title}</div>
                  </div>
                </div>
              )}
            </Row>
          </div>
        </Show>
      </div>
      <Show when={meta.loading}>
        <div class="loading-mark" style={{ top: '90%' }} />
      </Show>
    </>
  );
}
