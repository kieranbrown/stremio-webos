'use strict';
var http = require('http');
var https = require('https');
var fs = require('fs');
var path = require('path');
var spawn = require('child_process').spawn;
var createDiscovery = require('./discovery').createDiscovery;
var createPausedDownload = require('./paused-download').createPausedDownload;
var createReadAhead = require('./read-ahead').createReadAhead;
var engineCleanup = require('./engine-cleanup');
var LOCAL_URL = 'http://127.0.0.1:11470';

function normalizeConfig(input) {
    if (!input || !['tv', 'external'].includes(input.mode)) throw new Error('Choose TV or external server.');
    var result = { mode: input.mode, serverUrl: '' };
    if (input.mode === 'external') {
        var url;
        try { url = new URL(input.serverUrl); } catch (_) { throw new Error('Enter a full http:// or https:// server address.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
            throw new Error('Use the server origin only, without a password, query or path.');
        }
        if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Enter the server LAN address, not localhost.');
        result.serverUrl = url.origin;
    }
    return result;
}

function createApp(options) {
    options = options || {};
    var www = options.www || path.join(__dirname, 'www');
    var configFile = options.configFile || path.join(__dirname, 'streaming-config.json');
    var config = { mode: 'tv', serverUrl: '' };
    var configured = false;
    var discovery = createDiscovery(options.discovery);
    try { config = normalizeConfig(JSON.parse(fs.readFileSync(configFile, 'utf8'))); configured = true; } catch (_) {}
    var child = null, starting = null, engineError = null;
    var activeRequests = 0, lastActivity = Date.now();
    var agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };
    function target() { return config.mode === 'external' ? config.serverUrl : LOCAL_URL; }
    function json(res, status, value) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(value));
    }
    function requestJson(base, route, method, body) {
        return new Promise(function(resolve, reject) {
            var url = new URL(route, base);
            var data = body ? JSON.stringify(body) : null;
            var req = (url.protocol === 'https:' ? https : http).request(url, {
                method: method || 'GET', agent: agents[url.protocol],
                headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
            }, function(res) {
                var chunks = [], size = 0;
                res.on('data', function(chunk) { size += chunk.length; if (size > 1048576) res.destroy(new Error('Server response too large.')); else chunks.push(chunk); });
                res.on('error', reject);
                res.on('end', function() {
                    if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('Server returned HTTP ' + res.statusCode));
                    try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (_) { reject(new Error('Not a Stremio server response.')); }
                });
            });
            req.setTimeout(5000, function() { req.destroy(new Error('Server connection timed out.')); });
            req.on('error', reject);
            req.end(data);
        });
    }
    var pausedDownload = createPausedDownload({
        backend: function() { return config.mode === 'external' ? (options.target || config.serverUrl) : null; },
        settings: function(base) { return requestJson(base, '/settings'); }
    });
    function readAheadOptions() {
        return Object.assign({ agent: function(protocol) { return agents[protocol]; },
            keep: function(hash) { return pausedDownload.holds(hash); } }, options.readAheadOptions);
    }
    var readAhead = createReadAhead(readAheadOptions());
    function createCleanup() { return engineCleanup.createEngineCleanup(Object.assign({
        backend: function() { return config.mode === 'external' ? (options.target || config.serverUrl) : null; },
        agent: function(protocol) { return agents[protocol]; },
        keep: function(hash) { return pausedDownload.holds(hash); },
        canRefresh: function(hash) { return readAhead.aheadFor(hash) >= 48 * 1048576; }
    }, options.cleanupOptions)); }
    var cleanup = createCleanup();
    function useReadAhead() { return options.readAhead !== undefined ? options.readAhead : config.mode === 'external'; }
    function stopLocal() {
        if (child) child.kill();
        child = null;
    }
    function startLocal() {
        if (starting) return starting;
        starting = (async function() {
            engineError = null;
            if (!child) {
                var env = Object.assign({}, process.env, {
                    APP_PATH: __dirname, NO_HTTPS_SERVER: '1',
                    STREMIO_PARENT_PID: String(process.pid),
                    FFMPEG_BIN: path.join(__dirname, 'bin/ffmpeg'), FFPROBE_BIN: path.join(__dirname, 'bin/ffprobe')
                });
                child = spawn(process.execPath, [path.join(__dirname, 'streaming-server.js')], { env: env, stdio: ['ignore', 'inherit', 'inherit'] });
                var launched = child;
                child.on('error', function(error) { engineError = error.message; });
                child.on('exit', function(code) {
                    if (child === launched) { child = null; engineError = 'TV streaming server exited (' + code + ').'; }
                });
            }
            for (var attempt = 0; attempt < 60; attempt++) {
                if (engineError) throw new Error(engineError);
                try {
                    var settings = await requestJson(LOCAL_URL, '/settings');
                    if (!settings.values || !settings.values.serverVersion) throw new Error('Unexpected TV server.');
                    return;
                } catch (error) {
                    if (attempt === 59) throw error;
                    await new Promise(function(resolve) { setTimeout(resolve, 250); });
                }
            }
        })().finally(function() { starting = null; });
        return starting;
    }
    async function ensureBackend() {
        if (config.mode === 'tv') {
            if (options.ensureLocal) await options.ensureLocal();
            else if (!child || starting) await startLocal();
        }
    }
    var mimes = { '.html': 'text/html', '.js': 'application/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.css': 'text/css', '.json': 'application/json' };
    function serveStatic(req, res, pathname) {
        var decoded;
        try { decoded = decodeURIComponent(pathname); } catch (_) { return false; }
        var file = path.resolve(www, '.' + (decoded === '/' ? '/index.html' : decoded));
        if (!file.startsWith(path.resolve(www) + path.sep)) return false;
        var stat;
        try { stat = fs.statSync(file); } catch (_) { return false; }
        if (!stat.isFile()) return false;
        var etag = '"' + stat.size.toString(16) + '-' + stat.mtimeMs.toString(16) + '"';
        if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); res.end(); return true; }
        res.writeHead(200, { 'Content-Type': mimes[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, ETag: etag, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') res.end();
        else {
            var stream = fs.createReadStream(file);
            stream.on('error', function() { res.destroy(); });
            res.on('close', function() { stream.destroy(); });
            stream.pipe(res);
        }
        return true;
    }
    var server = http.createServer(async function(req, res) {
        lastActivity = Date.now();
        var pathname = req.url.split('?')[0];
        if (pathname.startsWith('/playback/')) {
            if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) return json(res, 403, { error: 'Origin rejected.' });
            if (pathname === '/playback/paused-download') {
                if (req.method === 'GET') return json(res, 200, pausedDownload.state());
                if (req.method === 'DELETE') { pausedDownload.stop(); return json(res, 200, pausedDownload.state()); }
                if (req.method !== 'POST') return json(res, 405, { error: 'Use GET, POST or DELETE.' });
                var pauseChunks = [], pauseBytes = 0;
                req.on('data', function(chunk) { pauseBytes += chunk.length; if (pauseBytes > 1024) req.destroy(); else pauseChunks.push(chunk); });
                req.on('end', async function() {
                    try {
                        var input = JSON.parse(Buffer.concat(pauseChunks).toString());
                        if (input.stop) { pausedDownload.stop(); return json(res, 200, pausedDownload.state()); }
                        return json(res, 200, await pausedDownload.renew(input));
                    } catch (error) { return json(res, 400, { error: error.message }); }
                });
                return;
            }
            if (pathname === '/playback/discovery') {
                if (req.method === 'POST') return json(res, 202, discovery.start());
                if (req.method === 'GET') return json(res, 200, discovery.state());
                if (req.method === 'DELETE') { discovery.cancel(); return json(res, 200, discovery.state()); }
                return json(res, 405, { error: 'Use POST, GET or DELETE for server discovery.' });
            }
            // The player was closed: free its memory buffers, then stop the torrents it used
            // once their requests have closed, instead of after the usual two minutes.
            if (pathname === '/playback/leave') {
                if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
                req.resume();
                readAhead.release();
                setTimeout(function() { cleanup.flush(); }, options.leaveDelay || 1500).unref();
                return json(res, 202, { leaving: true });
            }
            if (pathname === '/playback/config' && req.method === 'GET') return json(res, 200, { configured: configured, config: config });
            if (pathname === '/playback/status' && req.method === 'GET') {
                return json(res, 200, { mode: config.mode, backend: target(), localRunning: !!child, error: engineError, memory: process.memoryUsage().rss, readAhead: readAhead.state(), cleanup: cleanup.state() });
            }
            if (pathname === '/playback/config' && req.method === 'PUT') {
                var chunks = [], bytes = 0;
                req.on('data', function(chunk) { bytes += chunk.length; if (bytes > 16384) req.destroy(); else chunks.push(chunk); });
                req.on('end', function() {
                    try {
                        var next = normalizeConfig(JSON.parse(Buffer.concat(chunks).toString()));
                        if (activeRequests || starting) throw new Error('Stop playback and wait for the server to finish starting before changing setup.');
                        fs.writeFileSync(configFile + '.tmp', JSON.stringify(next), { mode: 0o600 });
                        fs.renameSync(configFile + '.tmp', configFile);
                        pausedDownload.stop(); readAhead.shutdown(); cleanup.shutdown(); stopLocal();
                        config = next; configured = true; readAhead = createReadAhead(readAheadOptions()); cleanup = createCleanup();
                        json(res, 200, { success: true, config: config });
                    } catch (error) { json(res, 400, { error: error.message }); }
                });
                return;
            }
            if (pathname === '/playback/check' && req.method === 'GET') {
                try {
                    await ensureBackend();
                    var info = await requestJson(target(), '/settings');
                    if (!info.values || !info.values.serverVersion) throw new Error('This address is not a Stremio streaming server.');
                    return json(res, 200, { success: true, version: info.values.serverVersion, cacheSize: info.values.cacheSize });
                } catch (error) { return json(res, 502, { error: error.message }); }
            }
            return json(res, 404, { error: 'Unknown setup endpoint.' });
        }
        if (['GET', 'HEAD'].includes(req.method) && serveStatic(req, res, pathname)) return;
        activeRequests++;
        res.once('close', function() { activeRequests--; lastActivity = Date.now(); });
        res.once('close', cleanup.hold(engineCleanup.mediaHash(pathname)));
        try { await ensureBackend(); } catch (error) { return json(res, 502, { error: error.message }); }
        if (res.destroyed) return;
        var base = options.target || target();
        // Resolve only relative request paths: never allow //host to redirect the proxy.
        var url = new URL(base);
        url.pathname = pathname;
        url.search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        if (useReadAhead() && await readAhead.handle(req, res, url)) return;
        if (res.destroyed) return;
        var headers = Object.assign({}, req.headers, { host: url.host });
        delete headers.origin; delete headers.referer; delete headers.connection;
        var upstream = (url.protocol === 'https:' ? https : http).request(url, { method: req.method, headers: headers, agent: agents[url.protocol] }, function(reply) {
            res.writeHead(reply.statusCode, reply.headers);
            reply.on('error', function() { res.destroy(); });
            reply.pipe(res);
        });
        upstream.setTimeout(60000, function() { upstream.destroy(new Error('Streaming server timed out.')); });
        upstream.on('error', function(error) { if (!res.headersSent) json(res, 502, { error: error.message }); else res.destroy(); });
        res.once('close', function() { upstream.destroy(); });
        req.on('aborted', function() { upstream.destroy(); });
        req.pipe(upstream);
    });
    var idleTimer = setInterval(function() { if (!activeRequests && Date.now() - lastActivity > 120000) stopLocal(); }, 30000);
    idleTimer.unref();
    // webOS can quit the service during upgrades without closing its HTTP server first.
    process.once('exit', stopLocal);
    server.shutdown = function() { discovery.cancel(); pausedDownload.shutdown(); readAhead.shutdown(); cleanup.shutdown(); stopLocal(); server.close(); };
    server.on('close', function() {
        discovery.cancel(); pausedDownload.shutdown(); readAhead.shutdown(); cleanup.shutdown(); stopLocal(); clearInterval(idleTimer); process.removeListener('exit', stopLocal);
        Object.values(agents).forEach(function(agent) { agent.destroy(); });
    });
    return server;
}
module.exports = { createApp: createApp, normalizeConfig: normalizeConfig };
