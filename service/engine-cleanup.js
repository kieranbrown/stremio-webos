'use strict';
var http = require('http');
var https = require('https');

// Stop torrents on the external server once the TV is done with them. Stremio's server is
// meant to drop an engine 2 minutes after its last stream, but leaks streams on aborted and
// HEAD requests, so engines can keep downloading whole files (and slow the server) forever.
// Removing an engine keeps its cached data; the next request recreates it.
var MEDIA_HASH = /^\/([a-f0-9]{40})\/\d{1,6}(?:\/|$)/i;

function mediaHash(pathname) {
    var match = MEDIA_HASH.exec(pathname || '');
    return match ? match[1].toLowerCase() : null;
}

function createEngineCleanup(options) {
    var delay = options.delay || 120000, interval = options.interval || 60000;
    var leakLimit = options.leakLimit || 40, refreshGap = options.refreshGap || 600000;
    var active = new Map(), timers = new Map(), refreshed = new Map(), log = [];

    function call(base, route) {
        return new Promise(function(resolve, reject) {
            var url = new URL(route, base);
            var req = (url.protocol === 'https:' ? https : http).request(url, { agent: options.agent && options.agent(url.protocol) }, function(res) {
                var chunks = [], size = 0;
                res.on('data', function(chunk) { size += chunk.length; if (size < 1048576) chunks.push(chunk); });
                res.on('error', reject);
                res.on('end', function() {
                    if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Server returned HTTP ' + res.statusCode));
                    try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (_) { resolve({}); }
                });
            });
            req.setTimeout(10000, function() { req.destroy(new Error('Server did not answer in time.')); });
            req.on('error', reject);
            req.end();
        });
    }
    function note(hash, action, detail) {
        log.push({ at: Date.now(), hash: hash, action: action, detail: detail || null });
        if (log.length > 20) log.shift();
    }
    function remove(hash, reason) {
        var base = options.backend();
        if (!base) return Promise.resolve(false);
        return call(base, '/' + hash + '/remove').then(function() { note(hash, reason); return true; },
            function(error) { note(hash, reason + ' failed', error.message); return false; });
    }
    function schedule(hash) {
        clearTimeout(timers.get(hash));
        var timer = setTimeout(function() {
            timers.delete(hash);
            if (active.has(hash)) return;
            if (options.keep && options.keep(hash)) return schedule(hash);
            remove(hash, 'stopped after playback');
        }, delay);
        timer.unref();
        timers.set(hash, timer);
    }
    // Count a TV request using a torrent; the returned function releases it.
    function hold(hash) {
        if (!hash || !options.backend()) return function() {};
        clearTimeout(timers.get(hash)); timers.delete(hash);
        active.set(hash, (active.get(hash) || 0) + 1);
        var released = false;
        return function() {
            if (released) return;
            released = true;
            var count = (active.get(hash) || 1) - 1;
            if (count > 0) active.set(hash, count);
            else { active.delete(hash); schedule(hash); }
        };
    }
    // Safety net for long sessions: when leaked selections pile up on a torrent in use, restart
    // it while the TV holds enough read-ahead to cover the reconnect.
    var busy = false;
    async function check() {
        var base = options.backend();
        if (busy || !base) return;
        busy = true;
        try {
            var all = null;
            for (var hash of Array.from(active.keys())) {
                if (Date.now() - (refreshed.get(hash) || 0) < refreshGap) continue;
                // The server-wide list never creates an engine, unlike per-torrent routes.
                if (!all) all = await call(base, '/stats.json').catch(function() { return {}; });
                var stats = all[hash];
                var count = stats && Array.isArray(stats.selections) ? stats.selections.length : 0;
                if (count < leakLimit || !(options.canRefresh ? options.canRefresh(hash) : true)) continue;
                refreshed.set(hash, Date.now());
                note(hash, 'refreshing', count + ' leftover requests');
                await remove(hash, 'refreshed');
            }
        } finally { busy = false; }
    }
    var checker = setInterval(check, interval); checker.unref();

    // Stop now every torrent whose TV requests have all closed (the player was left).
    function flush() {
        Array.from(timers.keys()).forEach(function(hash) {
            clearTimeout(timers.get(hash)); timers.delete(hash);
            if (active.has(hash)) return;
            if (options.keep && options.keep(hash)) return schedule(hash);
            remove(hash, 'stopped on leaving the player');
        });
    }

    function state() {
        return { active: Array.from(active.keys()), pending: Array.from(timers.keys()), log: log.slice(-5) };
    }
    function shutdown() {
        clearInterval(checker);
        timers.forEach(function(timer) { clearTimeout(timer); });
        timers.clear(); active.clear();
    }
    return { hold: hold, state: state, check: check, flush: flush, shutdown: shutdown };
}

module.exports = { createEngineCleanup: createEngineCleanup, mediaHash: mediaHash };
