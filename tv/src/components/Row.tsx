import { For, JSX } from 'solid-js';

const STEP = 384 + 40; // --tile-w + --tile-gap
const VISIBLE = 4;

/**
 * Horizontal strip. The focused item stays in the second slot so the previous
 * item peeks in from the left, like tvOS shelves.
 */
export function Row<T>(props: {
  title?: string;
  items: T[];
  focusedIndex: number;
  active: boolean;
  children: (item: T, focused: () => boolean) => JSX.Element;
}) {
  const offset = () => {
    const max = Math.max(0, props.items.length - VISIBLE);
    return Math.min(max, Math.max(0, props.focusedIndex - 1));
  };
  return (
    <section class="row">
      {props.title && <h2 class="row-title">{props.title}</h2>}
      <div class="row-track" style={{ transform: `translate3d(${-offset() * STEP}px, 0, 0)` }}>
        <For each={props.items}>
          {(item, i) => props.children(item, () => props.active && i() === props.focusedIndex)}
        </For>
      </div>
    </section>
  );
}
