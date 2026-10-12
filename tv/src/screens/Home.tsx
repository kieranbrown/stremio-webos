import { createEffect, createMemo, createSignal, For, Index, onCleanup, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Backdrop } from '../components/Backdrop';
import { MetaInfo } from '../components/MetaInfo';
import { Row } from '../components/Row';
import { Tile } from '../components/Tile';
import { PlayIcon } from '../components/icons';
import { art } from '../data/cinemeta';
import type { MetaPreview, Row as RowData } from '../data/types';
import { useKeys } from '../keys';

const TABS = ['Home', 'Movies', 'TV Shows', 'Library', 'Search'];
const HERO_COUNT = 6;
const HERO_INTERVAL_MS = 9000;
const ROWS_TOP = 820; // .rows top
const ROW_H = 340; // .row height
const FOCUSED_ROW_Y = 120; // where the focused row title sits on screen

type Zone = 'nav' | 'hero' | 'rows';

export function Home(props: {
  rows: RowData[];
  active: boolean;
  onOpen: (item: MetaPreview) => void;
}) {
  const hero = createMemo(() => (props.rows[0]?.items ?? []).slice(0, HERO_COUNT));
  const [s, set] = createStore({
    zone: 'hero' as Zone,
    nav: 0,
    hero: 0,
    heroSwap: false,
    row: 0,
    cols: [] as number[],
  });

  const col = (r: number) => s.cols[r] ?? 0;
  const focusedItem = () => props.rows[s.row]?.items[col(s.row)];

  const showHero = (i: number) => {
    const n = hero().length;
    if (!n) return;
    set('heroSwap', true);
    setTimeout(() => set({ hero: (i + n) % n, heroSwap: false }), 220);
  };

  // Warm the cache for the next hero slide so rotation never waits on network.
  createEffect(() => {
    const next = hero()[(s.hero + 1) % Math.max(1, hero().length)];
    if (next) new Image().src = art.backdrop(next.id);
  });

  // Rotate the hero while it has focus, like the tvOS top shelf.
  const rotation = setInterval(() => {
    if (props.active && s.zone === 'hero') showHero(s.hero + 1);
  }, HERO_INTERVAL_MS);
  onCleanup(() => clearInterval(rotation));

  useKeys((key) => {
    if (!props.active) return;
    const rows = props.rows;
    switch (s.zone) {
      case 'nav':
        if (key === 'left') set('nav', Math.max(0, s.nav - 1));
        if (key === 'right') set('nav', Math.min(TABS.length - 1, s.nav + 1));
        if (key === 'down') set('zone', 'hero');
        break;
      case 'hero':
        if (key === 'left') showHero(s.hero - 1);
        if (key === 'right') showHero(s.hero + 1);
        if (key === 'up') set('zone', 'nav');
        if (key === 'down' && rows.length) set({ zone: 'rows', row: 0 });
        if (key === 'enter' && hero()[s.hero]) props.onOpen(hero()[s.hero]);
        break;
      case 'rows': {
        const n = rows[s.row].items.length;
        if (key === 'left') set('cols', s.row, Math.max(0, col(s.row) - 1));
        if (key === 'right') set('cols', s.row, Math.min(n - 1, col(s.row) + 1));
        if (key === 'up') s.row === 0 ? set('zone', 'hero') : set('row', s.row - 1);
        if (key === 'down') set('row', Math.min(rows.length - 1, s.row + 1));
        if (key === 'enter' && focusedItem()) props.onOpen(focusedItem()!);
        break;
      }
    }
  });

  const scrollY = () => (s.zone === 'rows' ? -(ROWS_TOP + s.row * ROW_H - FOCUSED_ROW_Y) : 0);
  const backdropSrc = () => {
    const item = s.zone === 'rows' ? focusedItem() : hero()[s.hero];
    return item && art.backdrop(item.id);
  };

  return (
    <>
      <Backdrop src={backdropSrc()} dim={s.zone === 'rows' ? 0.4 : 1} debounceMs={s.zone === 'rows' ? 350 : 0} />

      <nav class="nav" classList={{ away: s.zone === 'rows' }}>
        <For each={TABS}>
          {(tab, i) => (
            <div
              class="nav-tab"
              classList={{ current: i() === 0, focused: s.zone === 'nav' && i() === s.nav }}
            >
              {tab}
            </div>
          )}
        </For>
      </nav>

      <div class="home-scroll" style={{ transform: `translate3d(0, ${scrollY()}px, 0)` }}>
        <div class="hero" classList={{ away: s.zone === 'rows' }}>
          <Show when={hero()[s.hero]}>
            {(item) => (
              <div class="hero-info" classList={{ swap: s.heroSwap }}>
                <MetaInfo item={item()} />
                <div class="details-buttons">
                  <div class="btn" classList={{ focused: s.zone === 'hero' }}>
                    <PlayIcon /> Play
                  </div>
                </div>
              </div>
            )}
          </Show>
          <div class="hero-dots">
            <Index each={hero()}>{(_, i) => <div class="hero-dot" classList={{ on: i === s.hero }} />}</Index>
          </div>
        </div>

        <div class="rows">
          <For each={props.rows}>
            {(row, r) => (
              <Row
                title={row.title}
                items={row.items}
                focusedIndex={col(r())}
                active={s.zone === 'rows' && s.row === r()}
              >
                {(item, focused) => <Tile item={item} focused={focused()} />}
              </Row>
            )}
          </For>
        </div>
      </div>
    </>
  );
}
