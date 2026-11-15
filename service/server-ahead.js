'use strict';
var http = require('http');
var https = require('https');

// Have the external server download pieces ahead of playback into its own disk cache.
// A one-byte request selects that piece at stream priority and completes once the piece is
// verified, so it never leaks a stream on Stremio's server, and only one byte reaches the TV.
// Stremio otherwise spends spare bandwidth on the whole file from its first missing piece,
// which, when resuming mid-movie, is behind the player.
var MiB = 1048576;

function getJson(url, agent) {
    return new Promise(function(resolve, reject) {
        var req = (url.protocol === 'https:' ? https : http).request(url, { agent: agent }, function(res) {
            var chunks = [], bytes = 0;
            res.on('data', function(chunk) { bytes += chunk.length; if (bytes > 1048576) res.destroy(new Error('Server response too large.')); else chunks.push(chunk); });
            res.on('error', reject);
            res.on('end', function() {
                if (res.statusCode !== 200) return reject(new Error('Server returned HTTP ' + res.statusCode));
                try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (error) { reject(error); }
            });
        });
        req.setTimeout(10000, function() { req.destroy(new Error('Server did not answer in time.')); });
        req.on('error', reject);
        req.end();
    });
}

// The server reports a file's offset and the piece ranges it has selected, but not the piece
// size. Find the power-of-two piece size that maps the file, or a known request, onto a selection.
// Its whole-file selection can end a few pieces past the file, so allow a small overshoot.
function findPieceLength(file, selections, ranges) {
    if (!file || !Array.isArray(selections)) return null;
    var offset = Number(file.offset) || 0, spans = [[0, file.length - 1]].concat(ranges || []);
    for (var size = 16384; size <= 256 * MiB; size *= 2) {
        var hit = spans.some(function(span) {
            var from = Math.floor((offset + span[0]) / size), to = Math.floor((offset + span[1]) / size);
            var slack = Math.max(1, Math.floor((to - from) / 1000));
            return to - from >= 8 && selections.some(function(s) { return s.from === from && s.to >= to && s.to <= to + slack; });
        });
        if (hit) return { size: size, offset: offset };
    }
    return null;
}

function createServerAhead(options) {
    options = options || {};
    var lead = options.lead || 6144 * MiB, maxBytes = options.maxBytes || 24 * MiB;
    var maxProbes = options.maxProbes || 16, recheck = options.recheck || 30000;
    var pieces = new Map(), inflight = 0, inflightBytes = 0;

    function info(r, ranges) {
        var entry = pieces.get(r.key);
        if (entry && (entry.piece || entry.loading || Date.now() - entry.at < recheck)) return entry.piece;
        entry = { piece: null, loading: true, at: Date.now() };
        pieces.set(r.key, entry);
        var url = new URL(r.url), parts = url.pathname.split('/');
        var agent = options.agent && options.agent(url.protocol);
        getJson(new URL('/settings', url), agent).then(function(settings) {
            var cache = settings && settings.values && settings.values.cacheSize;
            if (!(cache === null || cache > 0)) throw new Error('External disk caching is disabled.');
            return getJson(new URL('/stats.json', url), agent);
        }).then(function(all) {
            var engine = all && all[parts[1].toLowerCase()];
            entry.piece = engine && engine.files ? findPieceLength(engine.files[Number(parts[2])], engine.selections, ranges) : null;
        }, function() {}).then(function() {
            entry.loading = false; entry.at = Date.now();
            if (entry.piece && options.onChange) options.onChange(r);
        });
        return null;
    }

    function probe(r, st, at, bytes) {
        inflightBytes += bytes; inflight++; st.inflight++; st.pending.add(at);
        var url = new URL(r.url), finished = false;
        function done(ok) {
            if (finished) return;
            finished = true; inflightBytes -= bytes; inflight--; st.inflight--; st.pending.delete(at);
            if (ok) { st.completed++; st.failures = 0; }
            else {
                // Request the piece again later; after repeated failures (the server restarting
                // the torrent, say) back off for a while instead of giving up.
                st.failures++; st.next = Math.min(st.next, at);
                if (st.failures >= 5) st.resumeAt = Date.now() + recheck;
            }
            if (options.onChange) options.onChange(r);
        }
        var req = (url.protocol === 'https:' ? https : http).request(url, {
            headers: { Range: 'bytes=' + at + '-' + at }, agent: options.agent && options.agent(url.protocol)
        }, function(res) {
            if (res.statusCode !== 206 || res.headers['content-range'] !== 'bytes ' + at + '-' + at + '/' + r.total) {
                res.destroy(); req.destroy(); return done(false);
            }
            res.resume();
            res.on('error', function() {});
            res.on('end', function() { done(res.statusCode === 206); });
            res.on('close', function() { done(false); });
        });
        // Never abort: a cut request leaks a stream on Stremio's server. Missing pieces just wait.
        req.on('error', function() { done(false); });
        req.on('close', function() { setImmediate(function() { done(false); }); });
        req.end();
    }

    // Keep requesting pieces from `from` (where the TV's own requests end) up to `lead` past `pos`.
    function pump(r, from, pos, ranges) {
        if (r.total === null || pos === Infinity) return;
        var piece = info(r, ranges);
        if (!piece) return;
        var st = r.serverAhead || (r.serverAhead = { next: 0, inflight: 0, pending: new Set(), completed: 0, failures: 0, resumeAt: 0 });
        if (st.next < from) st.next = from;
        if (st.failures >= 5) {
            if (Date.now() < st.resumeAt) return;
            st.failures = 0;
        }
        while (inflight < maxProbes && inflightBytes + piece.size <= maxBytes && st.failures < 5 && st.next < r.total && st.next - pos < lead) {
            var at = st.next;
            st.next = (Math.floor((piece.offset + at) / piece.size) + 1) * piece.size - piece.offset;
            probe(r, st, at, piece.size);
        }
    }

    // Bytes past `pos` the server is known to hold (pieces requested and completed in order).
    function ahead(r, pos) {
        var st = r.serverAhead;
        if (!st || pos === Infinity) return null;
        var lowest = st.next;
        st.pending.forEach(function(at) { if (at < lowest) lowest = at; });
        return Math.max(0, lowest - pos);
    }

    return { pump: pump, ahead: ahead, inflight: function() { return inflight; } };
}

module.exports = { createServerAhead: createServerAhead, findPieceLength: findPieceLength };
