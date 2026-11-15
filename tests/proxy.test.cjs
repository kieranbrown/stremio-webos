const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, normalizeConfig } = require('../service/proxy');

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}

test('validates remote server addresses and standalone mode', () => {
    assert.deepEqual(normalizeConfig({ mode: 'tv' }), { mode: 'tv', serverUrl: '' });
    assert.equal(normalizeConfig({ mode: 'external', serverUrl: 'http://192.168.0.9:11470/' }).serverUrl, 'http://192.168.0.9:11470');
    for (const serverUrl of ['file:///tmp/x', 'http://localhost:8080', 'http://127.0.0.1:8080', 'http://user:password@192.168.1.1', 'http://192.168.1.1/x', 'http://192.168.1.1/?x=1']) {
        assert.throws(() => normalizeConfig({ mode: 'external', serverUrl }));
    }
});

test('streams Range responses, POST bodies and stats without caching media; revalidates static assets', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-playback-test-'));
    fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Stremio</h1>');
    const backend = http.createServer((req, res) => {
        if (req.url === '/movie') {
            assert.equal(req.headers.range, 'bytes=3-5');
            res.writeHead(206, { 'Content-Range': 'bytes 3-5/10', 'Content-Length': 3 }); return res.end('345');
        }
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ method: req.method, body, path: req.url, origin: req.headers.origin || null })); });
    });
    const target = await listen(backend);
    const proxy = createApp({ www: directory, configFile: path.join(directory, 'config.json'), target, ensureLocal: async () => {} });
    const base = await listen(proxy);
    try {
        let reply = await fetch(base + '/movie', { headers: { Range: 'bytes=3-5' } });
        assert.equal(reply.status, 206); assert.equal(reply.headers.get('content-range'), 'bytes 3-5/10'); assert.equal(await reply.text(), '345');
        reply = await fetch(base + '/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{"cacheSize":0}' });
        assert.deepEqual(await reply.json(), { method: 'POST', body: '{"cacheSize":0}', path: '/settings', origin: null });
        reply = await fetch(base + '/hash/2/stats.json'); assert.equal((await reply.json()).path, '/hash/2/stats.json');
        reply = await fetch(base + '/'); const etag = reply.headers.get('etag'); assert.match(await reply.text(), /Stremio/);
        reply = await fetch(base + '/', { headers: { 'If-None-Match': etag } }); assert.equal(reply.status, 304);
        reply = await fetch(base + '/', { method: 'HEAD' }); assert.equal(await reply.text(), '');
        reply = await fetch(base + '/playback/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{"mode":"tv"}' }); assert.equal(reply.status, 403);
        reply = await fetch(base + '/playback/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"tv"}' }); assert.equal(reply.status, 200);
        reply = await fetch(base + '/playback/config'); assert.equal((await reply.json()).config.mode, 'tv');
        assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'))).mode, 'tv');
    } finally { await close(proxy); await close(backend); fs.rmSync(directory, { recursive: true }); }
});

test('cancels backend media requests when the player disconnects', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-playback-cancel-'));
    let cancelled;
    const stopped = new Promise(resolve => cancelled = resolve);
    const backend = http.createServer((req, res) => {
        res.writeHead(200); res.write('first chunk');
        res.once('close', cancelled);
    });
    const target = await listen(backend);
    const proxy = createApp({ www: directory, configFile: path.join(directory, 'config.json'), target, ensureLocal: async () => {} });
    const base = await listen(proxy);
    try {
        const control = new AbortController();
        const response = await fetch(base + '/movie', { signal: control.signal });
        await response.body.getReader().read(); control.abort();
        await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(new Error('Upstream was not cancelled')), 1500).unref())]);
    } finally { await close(proxy); await close(backend); fs.rmSync(directory, { recursive: true }); }
});

test('pause-download API uses only the selected external server and stops on request', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-playback-pause-'));
    let heads = 0;
    const backend = http.createServer((req, res) => {
        if (req.url === '/settings') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ values: { cacheSize: 2147483648 } })); }
        if (req.method === 'GET' && req.url === '/' + 'a'.repeat(40) + '/0') { heads++; assert.equal(req.headers.range, 'bytes=0-0'); return res.writeHead(206, { 'Content-Range': 'bytes 0-0/10' }).end('x'); }
        res.writeHead(404).end();
    });
    const target = await listen(backend);
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ mode: 'external', serverUrl: 'http://192.168.0.9:11470' }));
    const proxy = createApp({ www: directory, configFile: path.join(directory, 'config.json'), target });
    const base = await listen(proxy), input = { infoHash: 'a'.repeat(40), fileIdx: 0 };
    try {
        const post = body => fetch(base + '/playback/paused-download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        let reply = await fetch(base + '/playback/paused-download', { method: 'POST', headers: { Origin: 'https://other.example' }, body: JSON.stringify(input) });
        assert.equal(reply.status, 403); assert.equal(heads, 0);
        reply = await post({ infoHash: 'bad', fileIdx: 0 }); assert.equal(reply.status, 400);
        reply = await post(input); assert.equal((await reply.json()).active, true);
        for (let n = 0; !heads && n < 30; n++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(heads, 1);
        reply = await post({ stop: true }); assert.equal((await reply.json()).active, false);
        reply = await fetch(base + '/playback/paused-download'); assert.equal((await reply.json()).active, false);
    } finally { await close(proxy); await close(backend); fs.rmSync(directory, { recursive: true }); }
});

test('switching from external to standalone clears old-server cleanup without starting a TV engine', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-playback-switch-'));
    const hash = 'a'.repeat(40), removed = [];
    let localStarts = 0;
    const backend = http.createServer((req, res) => {
        if (req.url.endsWith('/remove')) { removed.push(req.url); return res.end('{}'); }
        res.writeHead(206, { 'Content-Range': 'bytes 0-0/10', 'Content-Length': 1 }); res.end('x');
    });
    const target = await listen(backend), configFile = path.join(directory, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ mode: 'external', serverUrl: 'http://192.168.0.9:11470' }));
    const proxy = createApp({ www: directory, configFile, target, ensureLocal: async () => { localStarts++; }, readAhead: false,
        cleanupOptions: { delay: 60, interval: 3600000 } });
    const base = await listen(proxy);
    try {
        await (await fetch(`${base}/${hash}/0`, { headers: { Range: 'bytes=0-0' } })).text();
        assert.equal(localStarts, 0);
        let state = await (await fetch(base + '/playback/status')).json();
        assert.deepEqual(state.cleanup.pending, [hash]);
        const reply = await fetch(base + '/playback/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"tv"}' });
        assert.equal(reply.status, 200);
        state = await (await fetch(base + '/playback/status')).json();
        assert.deepEqual(state.cleanup.pending, []);
        assert.equal(state.localRunning, false);
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(removed, []);
        assert.equal(localStarts, 0);
    } finally { await close(proxy); await close(backend); fs.rmSync(directory, { recursive: true }); }
});
