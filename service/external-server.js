// Keep every frontend request on the TV proxy; the proxy selects the backend.
(function() {
    'use strict';
    window.__STREMIO_SERVER_URL__ = location.origin;
    fetch('/playback/config').then(function(reply) {
        // Older runtimes use the original backend and do not expose this API.
        if (!reply.ok) return null;
        return reply.json();
    }).then(function(data) {
        if (!data || !data.config) return;
        var external = data.config.mode === 'external';
        window.__PLAYBACK_BACKEND_LABEL__ = external ? 'External streaming server' : 'TV streaming server';
        window.__openPlaybackSetup = function() { location.href = '/setup.html'; };
        var busy = false, active = false, key = '', renewed = 0;
        function stop() {
            if (!active && !key) return;
            active = false; key = ''; renewed = 0;
            fetch('/playback/paused-download', { method: 'DELETE', keepalive: true }).catch(function() {});
        }
        function pausedSource() {
            var video = document.querySelector('video');
            if (!external || !location.hash.startsWith('#/player/') || !video || !video.paused || video.readyState < 1 || video.ended || video.error) return null;
            try {
                var url = new URL(video.currentSrc || video.src, location.href);
                if (url.origin !== location.origin) return null;
                var match = /^\/([a-f0-9]{40})\/(\d+)(?:\/)?$/i.exec(url.pathname);
                return match ? { infoHash: match[1].toLowerCase(), fileIdx: Number(match[2]) } : null;
            } catch (_) { return null; }
        }
        async function syncPause() {
            if (busy) return;
            var source = pausedSource();
            if (!source) return stop();
            var next = source.infoHash + '/' + source.fileIdx;
            if (active && key === next && Date.now() - renewed < 20000) return;
            busy = true;
            try {
                var reply = await fetch('/playback/paused-download', { method: 'POST',
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(source) });
                var result = await reply.json();
                if (!reply.ok) throw new Error(result.error || 'Server unavailable');
                active = result.active; key = next; renewed = Date.now();
                if (!pausedSource()) stop();
            } catch (error) { console.warn('Paused caching:', error.message); }
            finally { busy = false; }
        }
        document.addEventListener('pause', syncPause, true);
        document.addEventListener('play', stop, true);
        document.addEventListener('ended', stop, true);
        setInterval(syncPause, 5000);
        window.addEventListener('hashchange', function(event) {
            if (location.hash.startsWith('#/player/')) return;
            stop();
            if (/#\/player\//.test(event.oldURL || '')) navigator.sendBeacon('/playback/leave', '');
        });
        window.addEventListener('pagehide', function() {
            navigator.sendBeacon('/playback/paused-download', JSON.stringify({ stop: true }));
            navigator.sendBeacon('/playback/leave', '');
        });
        // The core keeps its server URL on our origin; the separate config stores the backend.
        var syncing = false, confirmed = 0, nextSync = 0;
        async function syncServer() {
            if (!window.core || syncing) return;
            syncing = true;
            try {
                var state = await window.core.getState('ctx');
                if (!state || !state.profile || !state.profile.settings) return;
                var endpoint = location.origin + '/';
                if (state.profile.settings.streamingServerUrl !== endpoint) {
                    confirmed = 0;
                    var settings = Object.assign({}, state.profile.settings, { streamingServerUrl: endpoint });
                    await window.core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: settings } }, 'ctx');
                    await window.core.dispatch({ action: 'StreamingServer', args: { action: 'Reload' } }, 'streaming_server');
                } else confirmed++;
            } catch (error) { console.warn('Streaming server setup:', error.message); }
            finally { syncing = false; }
        }
        setInterval(function() {
            if (location.hash.startsWith('#/player/') || Date.now() < nextSync) return;
            nextSync = Date.now() + (confirmed >= 3 ? 30000 : 2000);
            syncServer();
        }, 2000);
        window.addEventListener('hashchange', function() { nextSync = 0; });
    }).catch(function(error) { console.warn('Playback setup unavailable:', error.message); });
})();
