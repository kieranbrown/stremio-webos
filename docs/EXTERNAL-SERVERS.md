# External streaming servers and disk caching

## What this adds

A TV has limited memory and flash space. This feature lets an existing Stremio backend on a computer receive media transfers and cache pieces on its disk while the TV supplies the interface and native playback. It reuses Stremio's server/cache capabilities; the new work is their integration into this webOS app.

The same playback setup screen supports standalone TV mode and an external server. Switching to external mode stops the local TV backend. Media, subtitles, track lookups, torrent requests, and statistics use the same TV proxy and selected backend.

## Requirements

- A TV runtime with Node.js 18+ for the new service APIs. The development device runs webOS 26/Node.js 20. Older runtimes retain the original local implementation and URL editor.
- A compatible running Stremio desktop/service backend on a Mac, Windows PC, or server. A NAS must run a backend; a shared folder alone is insufficient.
- Network reachability from TV to server, including any needed host firewall/local-network permission.
- Disk caching enabled on the backend to use disk prefetch and continued paused caching. The backend retains control of its cache folder, size, and transfer profile.

## Setup

1. Start the existing official Stremio desktop app's server, or a compatible Stremio service, on the computer. Do not run two backends on the same port.
2. Put the TV and computer on the same reachable network and keep the computer awake.
3. On the TV, open **Settings → Server → Edit URL**.
4. Choose **External server — Mac, Windows PC, or NAS**.
5. Choose **Discover servers** and select a result, or enter `http://SERVER-LAN-IP:11470`. Manual HTTPS origins and custom ports are also supported.
6. Choose **Save and test connection**, then **Save and continue**. Browse and select media on the TV as usual.

No separate movie window is required on the computer. For an external HDD/SSD, attach it to the computer and configure the cache folder there. This feature does not use TV USB storage. The cache size is a cleanup target, not a hard disk quota; an active file can exceed it.

Use a trusted server endpoint on a trusted network. These endpoints do not add authentication, and public internet port forwarding is unnecessary. The computer must remain awake and its cache disk available. There is no automatic handover if it disconnects.

## Discovery

Discovery runs only when requested and never changes the selected backend until saved. It checks compatible HTTP `/settings` responses on port 11470 and returns address, server version, and cache availability, without exposing cache paths or other settings.

The scan covers up to two nearby private IPv4 /24 windows, skips local/VPN-style addresses, limits concurrency to 12 requests, and has a 45-second deadline. The UI displays progress and provides Stop. HTTPS-only/custom-port servers, isolated networks, or other subnets may require manual entry.

## Read-ahead, paused caching, and prefetch

- TV read-ahead in external mode targets up to 192 MiB in RAM, using three closed 16 MiB range requests in parallel. It adapts to reported system memory with a 200 MiB reserve target and a 32 MiB minimum. This is not a total app-memory cap or a guaranteed amount of free memory.
- Once that buffer fills, or while a paused stream is held, piece probes can request up to 6 GiB ahead into the server's disk cache. Prefetch first checks that caching is enabled. Piece availability is inferred from the backend's file/selection metadata; unsupported metadata leaves ordinary streaming available without extra prefetch.
- Prefetch uses completed one-byte range responses: the server obtains the piece, while only one media byte is transferred to the TV per successful probe. Outstanding probes are bounded to 16 requests and 24 MiB of selected piece data across readers. Oversized pieces are not prefetched under that budget. Failures back off and retry.
- For a paused direct torrent stream, TV heartbeats renew a 90-second service-side lease. Completed one-byte GET requests every 20 seconds keep the backend active during an ordinary screensaver. Play, media end, or leaving the player stops the lease; suspension or missing heartbeats lets it expire.
- Leaving playback releases TV read-ahead and schedules cleanup of inactive engines after about 1.5 seconds. Otherwise, cleanup runs two minutes after tracked requests close. In-flight closed ranges finish with their data discarded. Removing an external engine preserves its cache files for the server's own retention policy.

Standalone TV mode keeps upstream's backend defaults and buffering; the additional read-ahead/prefetch path is enabled only in external mode. No movie disk cache is added to the TV. The bundled backend runs as a child on modern runtimes and is stopped on shutdown, with an orphan watchdog.

This is streaming-cache integration, not a permanent Downloads library or a full-film download queue. More buffering cannot compensate indefinitely for transfer speed below the media bitrate. Cleanup operates on the server's torrent engine; another client playing the same hash on that backend can be affected. Separate multi-client ownership is not implemented.

## Validation

The feature was developed, deployed, and exercised in the contributor's C6 fork on **LG OLED55C6PLA, webOS 26** (SDK 11.2.0, firmware 43.21.98, Node.js 20.12.2), using an official macOS Stremio backend 4.22.4.

Recorded fork observations include:

- Successful external media/Range routing with the local TV engine off.
- Discovery and selection of a compatible LAN server.
- Native 3840×2160 playback; HDR activation checked in the TV's Picture settings.
- A 210-second pause/screensaver cycle during which the same engine and playback position were retained and transferred bytes increased. The initial HEAD keep-alive was subsequently replaced by completed GET requests to address a backend leak.
- A short read-ahead test where playback advanced 44.4 seconds in 45 seconds with 92–104 MiB held ahead.
- Investigation of accumulating server selections, and subsequent closed-range requests and engine cleanup.

These observations apply to the developed feature in that fork across versions. This upstream extraction preserves upstream IDs/ports, retains a legacy runtime path, and adds cache/budget guards and regression checks. It has been built, tested, and packaged locally; it has not been freshly deployed under upstream's app ID. They are not a substitute for a new end-to-end device run of this exact PR branch.

Windows is an intended compatible backend, not a directly tested platform here. Other TVs, extended memory/stability runs, external-drive deployment, Dolby Vision/Atmos, and multi-client sharing require their own validation. HDR observation is not a Dolby Vision certification.

## Development

`make check` runs deterministic HTTP fixtures and frontend lifecycle mocks. `make build` applies the frontend setup patch; `make package` builds, tests, and checks IPK timestamps without installation.

The implementation is grouped into `proxy.js` (backend selection/routing), `discovery.js`, `read-ahead.js`, `server-ahead.js`, `paused-download.js`, `engine-cleanup.js`, and `external-server.js` (frontend hooks), plus the setup screen. Local config is `service/streaming-config.json` and is ignored by Git. `/playback/status` exposes diagnostic buffer/cleanup state locally.
