const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createPausedDownload } = require('../service/paused-download');
const hash = 'a'.repeat(40);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
    const deadline = Date.now() + 2000;
    while (!check()) { if (Date.now() > deadline) throw new Error('Condition timed out'); await delay(10); }
}
async function fixture(handler) {
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('keeps a paused external torrent alive with complete one-byte requests, renews and expires its lease', async () => {
    const calls = [];
    const backend = await fixture((req, res) => {
        calls.push({ method: req.method, range: req.headers.range, url: req.url });
        res.writeHead(206, { 'Content-Range': 'bytes 0-0/25000000000', 'Content-Length': 1 }); res.end('x');
    });
    const keeper = createPausedDownload({ backend: () => backend.url, settings: async () => ({ values: { cacheSize: 2147483648 } }), interval: 20, lease: 160 });
    try {
        await keeper.renew({ infoHash: hash, fileIdx: 2 });
        await until(() => calls.length >= 2 && keeper.state().lastSuccess);
        await keeper.renew({ infoHash: hash, fileIdx: 2 });
        assert.equal(keeper.state().active, true);
        assert.deepEqual(calls[0], { method: 'GET', range: 'bytes=0-0', url: `/${hash}/2` });
        await until(() => !keeper.state().active);
        const count = calls.length; await delay(60); assert.equal(calls.length, count);
    } finally { keeper.shutdown(); await backend.close(); }
});

test('requires external disk caching and rejects arbitrary paths or unresolved file indexes', async () => {
    let backend = null, cacheSize = 0;
    const keeper = createPausedDownload({ backend: () => backend, settings: async () => ({ values: { cacheSize } }) });
    try {
        await assert.rejects(keeper.renew({ infoHash: hash, fileIdx: 0 }), /external server/);
        backend = 'http://127.0.0.1:1';
        await assert.rejects(keeper.renew({ infoHash: hash, fileIdx: 0 }), /disk caching/);
        for (const input of [{ infoHash: '../settings', fileIdx: 0 }, { infoHash: hash, fileIdx: -1 }, { infoHash: hash }, { infoHash: hash, fileIdx: '0' }]) {
            await assert.rejects(keeper.renew(input), /resolved file index/);
        }
        assert.equal(keeper.state().active, false);
    } finally { keeper.shutdown(); }
});

test('stops immediately on playback end or backend change and cancels pending work', async () => {
    let requests = 0, closed = false;
    const backend = await fixture((req, res) => { requests++; res.on('close', () => { closed = true; }); });
    let url = backend.url;
    const keeper = createPausedDownload({ backend: () => url, settings: async () => ({ values: { cacheSize: 1 } }), interval: 20 });
    try {
        await keeper.renew({ infoHash: hash, fileIdx: 0 }); await until(() => requests === 1);
        keeper.stop(); await until(() => closed);
        assert.equal(keeper.state().active, false);
        await delay(60); assert.equal(requests, 1);
        await keeper.renew({ infoHash: hash, fileIdx: 0 }); await until(() => requests === 2);
        url = null; await until(() => !keeper.state().active);
        await delay(60); assert.equal(requests, 2);
    } finally { keeper.shutdown(); await backend.close(); }
});
