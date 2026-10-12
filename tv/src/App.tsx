import { createResource, createSignal, Show } from 'solid-js';
import { cinemeta } from './data/cinemeta';
import type { MetaPreview } from './data/types';
import { Details } from './screens/Details';
import { Home } from './screens/Home';

const source = cinemeta;

export function App() {
  const [rows] = createResource(() => source.homeRows());
  const [open, setOpen] = createSignal<MetaPreview | null>(null);

  return (
    <>
      <Show when={rows()} fallback={<div class="loading-mark" />}>
        {/* Home stays mounted underneath Details so its focus and scroll survive. */}
        <div class="screen" classList={{ hidden: !!open() }}>
          <Home rows={rows()!} active={!open()} onOpen={setOpen} />
        </div>
      </Show>
      <Show when={open()} keyed>
        {(item) => (
          <div class="screen">
            <Details source={source} item={item} active onBack={() => setOpen(null)} />
          </div>
        )}
      </Show>
    </>
  );
}
