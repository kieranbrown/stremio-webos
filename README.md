# Stremio for webOS

Custom Stremio app for LG webOS TVs with working default audio language selection.

The official Stremio app has a bug where it always plays the first audio track in the list, ignoring the user's preferred audio language setting. This build fixes that by reading tracks from the TV's native media pipeline and automatically selecting the track matching your configured language.

Built from [Stremio Theater v1.9.2](https://github.com/NoobyGains/stremio-vidaa-tv) with the official Stremio streaming server.

## Compatibility

This build targets **LG TVs from 2020 onward running webOS 5.0 or later**, matching the model-year baseline for [Stremio's official LG app](https://www.stremio.com/downloads). This community build has not been tested on every model.

**webOS 4.x and earlier (2019 and older LG TVs) are not supported.** Both the Theater frontend and the bundled streaming server depend on newer runtimes. LG documents Chromium 53 and Node.js 0.12.2 for webOS 4.x, compared with Chromium 68 and Node.js 8.12.0 for webOS 5.x. See LG's [web engine versions](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) and [JavaScript service runtimes](https://webostv.developer.lge.com/develop/guides/js-service-basics).

Installing through Developer Mode or Homebrew Channel does not remove these runtime requirements. Supporting older TVs would require compatibility work on both the frontend and the streaming server.

## External streaming server

On supported modern webOS runtimes, **Settings → Server → Edit URL** opens Playback setup. Keep standalone TV playback, or select a compatible Stremio server running on a Mac, Windows PC, or NAS. Use **Discover servers** or enter the server URL, then save and test the connection.

The TV remains the browsing and viewing interface. The external backend handles transfers and its configured disk cache, allowing use of the computer's internal disk or attached HDD/SSD. It can reuse the server included in an existing Stremio desktop installation; starting the same video on the computer is unnecessary.

This adds server selection/routing, cancellable LAN discovery, bounded TV read-ahead, disk-cache prefetch, pause/screensaver keep-alive, and cleanup after playback. The feature requires Node.js 18+ on the TV; older runtimes retain the original local implementation and settings flow. It was developed and tested in a community fork on an LG C6/webOS 26 with an official macOS Stremio backend. Windows and other TV models still need direct validation.

See [external-server setup and behavior](docs/EXTERNAL-SERVERS.md) for prerequisites, limits, and the exact validation scope.

## Prerequisites

1. Install the [webOS CLI](https://www.npmjs.com/package/@webos-tools/cli) — `npm i -g @webos-tools/cli@3.2.6` (requires Node.js 20 or later; releases use Node.js 24). If you have the old CLI installed, remove it first with `npm uninstall -g @webosose/ares-cli`.
2. Either enable [Developer Mode](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) on your TV, or have [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel) installed
3. Configure your TV as a device — `ares-setup-device`

Use `@webos-tools/cli` to package the app. The older `@webosose/ares-cli` can write zero timestamps into the IPK, causing `-5: ipk verified failed` on older webOS versions. `make package` checks the archive timestamps before allowing installation or publication.

> **Note:** Developer Mode expires after 1000 hours and any sideloaded apps will be uninstalled. Rooted TVs with Homebrew Channel do not have this limitation.

## Install via Homebrew Channel

If your TV is rooted with [Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel):

1. Open Homebrew Channel on your TV
2. Go to settings and add this repository: `https://raw.githubusercontent.com/kieranbrown/stremio-webos/main/webosbrew/apps.json`
3. Find Stremio in the app list and install

## Install manually

```sh
make deploy
```

This downloads all dependencies, builds the app, packages the IPK, installs it on your TV, and launches it.

Replace the default device name if needed: `make deploy DEVICE=myTV`

### Other commands

```sh
make build     # Download dependencies + build (no install)
make check     # Run external-server integration and lifecycle tests
make package   # Build + create IPK
make restart   # Close + relaunch on TV
make clean     # Remove build artifacts
```

## Auto-start on input select

On rooted TVs, you can register Stremio as an input source so it appears in the TV's input list and can auto-launch:

```sh
luna-send-pub -n 1 'luna://com.webos.service.eim/addDevice' '{"appId":"io.strem.tv","pigImage":""}'
```

Run this via SSH on the TV.

## Credits

- [Stremio](https://www.stremio.com/)
- [NoobyGains/stremio-vidaa-tv](https://github.com/NoobyGains/stremio-vidaa-tv) — Theater frontend
- [webOS Homebrew Project](https://www.webosbrew.org/)
