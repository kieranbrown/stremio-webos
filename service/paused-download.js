'use strict';
var http = require('http');
var https = require('https');

// Keep one disk-backed external torrent alive without reading movie bytes into TV RAM.
function createPausedDownload(options) {
    var job = null, request = null, busy = false, generation = 0;
    var interval = options.interval || 20000, lease = options.lease || 90000;
    function state() {
        return { active: !!job, lastSuccess: job && job.lastSuccess, error: job && job.error };
    }
    function stop() {
        generation++; job = null;
        if (request) request.destroy();
        request = null;
    }
    async function tick() {
        if (!job) return;
        if (Date.now() >= job.expires || options.backend() !== job.backend) return stop();
        if (busy) return;
        busy = true;
        var current = job, token = generation;
        try {
            // A one-byte request preselects the file and resets EngineFS's inactivity timer while
            // torrent/cache work stays on the external server. It completes normally: HEAD and
            // aborted requests leak a never-closed stream on Stremio's server.
            await new Promise(function(resolve, reject) {
                var url = new URL('/' + current.infoHash + '/' + current.fileIdx, current.backend);
                var pending = (url.protocol === 'https:' ? https : http).request(url, {
                    headers: { Range: 'bytes=0-0' }
                }, function(res) {
                    res.resume();
                    res.on('error', reject);
                    res.on('end', function() {
                        if (res.statusCode < 200 || res.statusCode >= 300) reject(new Error('Server returned HTTP ' + res.statusCode));
                        else resolve();
                    });
                });
                request = pending;
                var deadline = setTimeout(function() { pending.destroy(new Error('Paused download keep-alive timed out.')); }, 8000);
                pending.on('close', function() { clearTimeout(deadline); if (request === pending) request = null; });
                pending.on('error', reject); pending.end();
            });
            if (generation === token && job === current) { current.lastSuccess = Date.now(); current.error = null; }
        } catch (error) {
            if (generation === token && job === current) current.error = error.message;
        } finally { busy = false; }
    }
    async function renew(input) {
        if (!input || !/^[a-f0-9]{40}$/i.test(input.infoHash) || !Number.isInteger(input.fileIdx) || input.fileIdx < 0 || input.fileIdx > 100000) {
            throw new Error('A torrent hash and resolved file index are required.');
        }
        var backend = options.backend();
        if (!backend) throw new Error('Paused downloading requires a Mac or external server.');
        var same = job && job.backend === backend && job.infoHash === input.infoHash.toLowerCase() && job.fileIdx === input.fileIdx;
        if (!same) {
            stop();
            var token = generation;
            var settings = await options.settings(backend);
            if (generation !== token || options.backend() !== backend) return state();
            if (!settings.values || !(settings.values.cacheSize === null || settings.values.cacheSize > 0)) throw new Error('Enable disk caching on the external server to download while paused.');
            job = { backend: backend, infoHash: input.infoHash.toLowerCase(), fileIdx: input.fileIdx, expires: Date.now() + lease, lastSuccess: null, error: null };
        } else job.expires = Date.now() + lease;
        tick();
        return state();
    }
    var timer = setInterval(tick, interval); timer.unref();
    function holds(infoHash) { return !!job && job.infoHash === infoHash; }
    return { renew: renew, stop: stop, state: state, holds: holds, shutdown: function() { stop(); clearInterval(timer); } };
}
module.exports = { createPausedDownload: createPausedDownload };
