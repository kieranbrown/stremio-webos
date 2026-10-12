# Stremio TV UI (prototype)

A new 10-foot frontend for LG webOS, designed after the Apple TV app: full-bleed
artwork, title logos, focus lift, OLED true-black. It's meant to eventually
replace the prebuilt Theater bundle that `make build` downloads.

Status: **design prototype**. Home (hero + shelves) and Details (movie and
series/episodes) are navigable with the remote. Playback, streams/add-ons,
login and library are not wired yet. Data currently comes straight from
Cinemeta; screens only talk to `ContentSource` (`src/data/types.ts`) so the
backend can be swapped for stremio-core or our own Stremio API client.

Not yet packaged into the IPK.

```sh
cd tv
npm install
npm run dev        # http://localhost:5173, arrow keys / Enter / Esc
npm run build      # dist/, targets Chromium 87 (webOS 22, LG G2)
npm run typecheck
```

Performance rules (see the header of `src/styles.css`): animate only
`transform`/`opacity`, fade pre-rendered shadows instead of animating them,
use 480px art for tiles and 1080p art for full-screen surfaces.
