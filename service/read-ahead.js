'use strict';
var http = require('http');
var https = require('https');
var fs = require('fs');
var createServerAhead = require('./server-ahead').createServerAhead;

// Read torrent media ahead of the native player into TV memory. The webOS player only
// buffers ~10 s, so short stalls on the server's network link show up as buffering.
var MEDIA_PATH = /^\/[a-f0-9]{40}\/\d{1,6}$/i;
var MiB = 1048576;

function parseRange(header) {
    if (header === undefined || header === '') return { start: 0, end: null };
    var match = /^bytes=(\d+)-(\d*)$/.exec(String(header).trim());
    if (!match) return null;
    var range = { start: Number(match[1]), end: match[2] ? Number(match[2]) : null };
    return range.end !== null && range.end < range.start ? null : range;
}

function availableMemory() {
    try {
        var match = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
        return match ? Number(match[1]) * 1024 : null;
    } catch (_) { return null; }
}

function createReadAhead(options) {
    options = options || {};
    var maxAhead = options.maxAhead || 192 * MiB, minAhead = options.minAhead || 32 * MiB;
    var reserve = options.reserve === undefined ? 200 * MiB : options.reserve;
    var behind = options.behind || 32 * MiB, joinGap = options.joinGap || 8 * MiB;
    var idle = options.idle || 90000, maxReaders = options.maxReaders || 3, stallMs = options.stallMs || 30000;
    var segment = options.segment || 16 * MiB, resumeAfter = options.resumeAfter || 64 * MiB, unused = options.unused || 15000;
    // Several segments in flight keep the server's priority window wide, so its peers stay busy
    // on what plays next instead of filling older gaps in the file.
    var parallel = options.parallel || 3;
    var memory = options.memory || availableMemory, keep = options.keep || function() { return false; };
    var serverAhead = options.serverAhead === false ? null : createServerAhead(Object.assign({ agent: options.agent, onChange: function(r) { update(r); } }, options.serverAhead));
    var readers = [], budget = maxAhead, budgetAt = 0;

    function buffered(r) { return r.size + r.segs.reduce(function(n, s) { return n + (s === r.segs[0] ? 0 : s.size); }, 0); }
    function held() { return readers.reduce(function(n, r) { return n + buffered(r); }, 0); }
    // Target a system-memory reserve; this is not a total process-memory cap.
    function limit() {
        if (Date.now() - budgetAt > 2000) {
            budgetAt = Date.now();
            var free = memory();
            budget = free === null ? maxAhead : Math.max(minAhead, Math.min(maxAhead, free + held() - reserve));
        }
        return budget;
    }
    function end(r) { return r.start + r.size; }
    function requested(r) { return r.segs.length ? r.segs[r.segs.length - 1].to + 1 : end(r); }
    function hashOf(r) { return r.key.split('/')[1]; }
    function notify(r) {
        var waiters = Array.from(r.waiters);
        r.waiters.clear();
        waiters.forEach(function(fn) { fn(); });
    }
    function minPos(r) {
        var pos = Infinity;
        r.clients.forEach(function(c) { if (c.pos < pos) pos = c.pos; });
        return pos;
    }
    function trim(r, keepFrom) {
        while (r.head < r.chunks.length - 1 && r.chunks[r.head].offset + r.chunks[r.head].buf.length <= keepFrom) {
            var c = r.chunks[r.head];
            r.chunks[r.head] = null; r.head++;
            r.start += c.buf.length; r.size -= c.buf.length;
        }
        if (r.head > 1024) { r.chunks = r.chunks.slice(r.head); r.head = 0; }
    }
    function slice(r, pos, last) {
        if (pos < r.start || pos >= end(r)) return null;
        var lo = r.head, hi = r.chunks.length - 1;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (r.chunks[mid].offset <= pos) lo = mid; else hi = mid - 1;
        }
        var c = r.chunks[lo];
        return c.buf.subarray(pos - c.offset, Math.min(c.buf.length, last + 1 - c.offset));
    }
    function append(r, buf) { r.chunks.push({ offset: end(r), buf: buf }); r.size += buf.length; }
    // While the player reconnects after an error, keep filling from where it stopped.
    function reconnecting(r) { return !r.clients.size && r.lastPos !== null && r.served >= resumeAfter && Date.now() - r.idleSince < idle; }
    function position(r) {
        var pos = minPos(r);
        return pos === Infinity && r.lastPos !== null ? r.lastPos : pos;
    }
    function update(r) {
        if (r.disposed) return;
        var lim = limit(), pos = minPos(r);
        if (pos !== Infinity) trim(r, pos - behind);
        pos = position(r);
        var full = held() >= lim + behind * readers.length;
        r.paused = r.total !== null && requested(r) < r.total && (requested(r) - pos >= lim || full);
        var active = r.clients.size || reconnecting(r);
        if (r.error || !(active || (keep(hashOf(r)) && r.lastPos !== null))) return;
        if (active) {
            r.segs.forEach(function(s) { if (!s.req && !s.waiting && s.got < s.to - s.from + 1) request(r, s); });
            while (r.total !== null && r.segs.length < parallel && requested(r) < r.total && requested(r) - pos < lim && !full) {
                var from = requested(r);
                var seg = { from: from, to: Math.min(from + segment, r.total) - 1, got: 0, size: 0, chunks: [], req: null, waiting: false, lastData: Date.now() };
                r.segs.push(seg); request(r, seg);
            }
        }
        // Once the TV holds all it may, or while paused, let the server download further ahead into its cache.
        if (serverAhead && (!active || r.paused || (r.total !== null && requested(r) >= r.total))) {
            serverAhead.pump(r, requested(r), pos, r.segs.map(function(s) { return [s.from, s.to]; }));
        }
    }
    // Move completed segments, then the next segment's early data, into the playable buffer.
    function advance(r) {
        while (r.segs.length) {
            var head = r.segs[0];
            if (head.chunks.length) { head.chunks.forEach(function(c) { append(r, c); }); head.chunks = []; head.size = 0; }
            if (head.got < head.to - head.from + 1) break;
            r.segs.shift();
        }
        if (r.total !== null && end(r) >= r.total) r.done = true;
        notify(r);
    }
    // Fetch fixed segments that complete normally. Stremio's server leaks a selection (and keeps
    // the torrent active) for every media request that is aborted, so never cut a request short.
    function request(r, seg) {
        var from = seg.from + seg.got, url = new URL(r.url), to = seg.to;
        var req = (url.protocol === 'https:' ? https : http).request(url, {
            headers: { Range: 'bytes=' + from + '-' + to }, agent: options.agent && options.agent(url.protocol)
        }, function(res) {
            var range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers['content-range'] || '');
            var total = range ? Number(range[3]) : NaN;
            var ok = res.statusCode === 206 && range && Number(range[1]) === from && Number(range[2]) <= to;
            if (!ok || !isFinite(total) || (r.total !== null && total !== r.total)) {
                res.resume(); seg.badStatus = true; req.destroy(new Error('Server returned HTTP ' + res.statusCode)); return;
            }
            if (r.total === null) {
                r.total = total;
                r.headers = { 'Content-Type': res.headers['content-type'] || 'application/octet-stream' };
                Object.keys(res.headers).forEach(function(name) { if (/dlna/i.test(name)) r.headers[name] = res.headers[name]; });
            }
            seg.to = Math.min(seg.to, total - 1);
            seg.lastData = Date.now();
            res.on('data', function(chunk) {
                if (r.disposed) return;
                seg.lastData = Date.now(); r.retries = 0; seg.got += chunk.length;
                if (seg === r.segs[0]) append(r, chunk);
                else { seg.chunks.push(chunk); seg.size += chunk.length; }
                if (seg === r.segs[0]) advance(r);
            });
            res.on('error', function() {});
            r.resolveReady();
            if (!r.disposed) update(r);
        });
        seg.req = req;
        req.on('error', function(error) { r.lastError = error; });
        req.on('close', function() {
            if (seg.req !== req) return;
            seg.req = null;
            if (r.disposed) return;
            if (r.total === null || seg.badStatus) { r.error = r.lastError || new Error('Streaming server closed the connection.'); r.rejectReady(r.error); notify(r); return; }
            if (seg.got >= seg.to - seg.from + 1) { if (seg === r.segs[0]) advance(r); return update(r); }
            if (!r.clients.size && !reconnecting(r)) return;
            if (++r.retries > 5) { r.error = new Error('Lost connection to the streaming server.'); notify(r); return; }
            seg.waiting = true;
            setTimeout(function() { seg.waiting = false; update(r); }, 500 * r.retries).unref();
        });
        req.end();
    }
    function open(key, url, start) {
        var r = { key: key, url: url, start: start, chunks: [], head: 0, size: 0, total: null, headers: null, segs: [],
            paused: false, done: false, error: null, disposed: false, clients: new Set(), waiters: new Set(), retries: 0,
            idleSince: Date.now(), lastPos: null, served: 0, serverAhead: null, waiting: 0 };
        r.ready = new Promise(function(resolve, reject) { r.resolveReady = resolve; r.rejectReady = reject; });
        r.ready.catch(function() {});
        readers.push(r);
        var seg = { from: start, to: start + segment - 1, got: 0, size: 0, chunks: [], req: null, waiting: false, lastData: Date.now() };
        r.segs.push(seg); request(r, seg);
        return r;
    }
    // Let in-flight segments finish (data is discarded) so the server does not leak them.
    function dispose(r, force) {
        if (r.disposed) return;
        r.disposed = true;
        r.segs.forEach(function(s) { if (s.req && force) s.req.destroy(); s.chunks = []; s.size = 0; });
        r.segs = []; r.chunks = []; r.size = 0;
        r.clients.forEach(function(c) { c.res.destroy(); });
        readers = readers.filter(function(x) { return x !== r; });
        r.rejectReady(new Error('Read-ahead stopped.'));
        notify(r);
    }
    function sweep() {
        var now = Date.now();
        readers.slice().forEach(function(r) {
            // A slow torrent can take longer than `unused` to send its first bytes: keep buffers a
            // request is still waiting on, or the player falls back to a direct, unbuffered stream.
            if (!r.clients.size && !r.waiting && now - r.idleSince > (r.served >= resumeAfter ? idle : unused) && !(keep(hashOf(r)) && r.lastPos !== null)) return dispose(r);
            var head = r.segs[0];
            if (head && head.req && r.clients.size && now - head.lastData > stallMs) head.req.destroy();
            update(r);
        });
    }
    var timer = setInterval(sweep, options.sweepMs || 5000); timer.unref();

    function serve(r, req, res, range) {
        if (range.start >= r.total) { res.writeHead(416, { 'Content-Range': 'bytes */' + r.total }); return res.end(); }
        var last = range.end === null ? r.total - 1 : Math.min(range.end, r.total - 1);
        var client = { pos: range.start, res: res }, closed = false;
        r.clients.add(client);
        res.writeHead(206, Object.assign({}, r.headers, {
            'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + range.start + '-' + last + '/' + r.total,
            'Content-Length': last - range.start + 1, 'Cache-Control': 'no-store'
        }));
        res.once('close', function() {
            closed = true; r.clients.delete(client);
            if (!r.clients.size) { r.idleSince = Date.now(); r.lastPos = client.pos; }
            update(r);
        });
        function pump() {
            if (closed) return;
            while (client.pos <= last) {
                var piece = slice(r, client.pos, last);
                if (!piece) break;
                client.pos += piece.length; r.served += piece.length;
                if (!res.write(piece)) { update(r); res.once('drain', pump); return; }
            }
            update(r);
            if (client.pos > last) { closed = true; return res.end(); }
            if (r.error || r.disposed || client.pos < r.start || (r.done && client.pos >= end(r))) return res.destroy();
            r.waiters.add(pump);
        }
        pump();
    }

    // Returns true when the request was served from (or joined) a read-ahead buffer.
    async function handle(req, res, url) {
        if (req.method !== 'GET' || !MEDIA_PATH.test(url.pathname)) return false;
        var range = parseRange(req.headers.range);
        if (!range) return false;
        var key = url.pathname.toLowerCase() + url.search;
        var r = readers.find(function(x) {
            return x.key === key && !x.error && range.start >= x.start && range.start <= end(x) + joinGap && (x.total === null || range.start < x.total);
        });
        if (!r) {
            // Small closed ranges (index probes) go straight to the server.
            if (range.end !== null && range.end - range.start < 4 * MiB) return false;
            // A seek: drop idle buffers for the same file, then make room. A reloading player first
            // re-reads the file header, so keep buffers then; they are swept when unused.
            if (range.start >= 64 * MiB) readers.filter(function(x) { return x.key === key && !x.clients.size; }).forEach(function(x) { dispose(x); });
            while (readers.length >= maxReaders) {
                var spare = readers.filter(function(x) { return !x.clients.size; }).sort(function(a, b) { return a.idleSince - b.idleSince; })[0];
                if (!spare) return false;
                dispose(spare);
            }
            r = open(key, url.href, range.start);
        }
        r.waiting++;
        try { await r.ready; } catch (_) { r.waiting--; if (!r.clients.size) dispose(r); return false; }
        r.waiting--;
        if (res.destroyed) { r.idleSince = r.clients.size ? r.idleSince : Date.now(); return true; }
        serve(r, req, res, range);
        return true;
    }

    function state() {
        return { limit: limit(), held: held(), serverProbes: serverAhead ? serverAhead.inflight() : 0, readers: readers.map(function(r) {
            var pos = position(r);
            return { file: r.key.split('?')[0], clients: r.clients.size, ahead: pos === Infinity ? null : end(r) - pos, held: buffered(r), total: r.total,
                segments: r.segs.length, serverAhead: serverAhead ? serverAhead.ahead(r, pos) : null,
                paused: r.paused, done: r.done, retries: r.retries, error: r.error && r.error.message };
        }) };
    }
    // Smallest buffered lead among players reading this torrent.
    function aheadFor(hash) {
        var lead = Infinity;
        readers.forEach(function(r) {
            if (r.key.indexOf('/' + hash + '/') !== 0) return;
            r.clients.forEach(function(c) { lead = Math.min(lead, end(r) - c.pos); });
        });
        return lead === Infinity ? 0 : lead;
    }
    function shutdown() { clearInterval(timer); readers.slice().forEach(function(r) { dispose(r, true); }); }
    // Free every buffer now; in-flight segments still finish so the server does not leak them.
    function release() { readers.slice().forEach(function(r) { dispose(r); }); }
    return { handle: handle, state: state, aheadFor: aheadFor, release: release, shutdown: shutdown };
}

module.exports = { createReadAhead: createReadAhead, parseRange: parseRange };
