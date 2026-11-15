const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServerAhead } = require('../service/server-ahead');
const MiB = 1048576, a = 'a'.repeat(40), b = 'b'.repeat(40);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
    const end = Date.now() + 1500;
    while (!check()) { if (Date.now() > end) throw new Error('Timed out'); await wait(5); }
}
async function fixture(cacheSize) {
    const probes = [], replies = [], metadata = [];
    const server = http.createServer((req, res) => {
        if (req.url === '/settings') { metadata.push(req.url); return res.end(JSON.stringify({ values: { cacheSize } })); }
        if (req.url === '/stats.json') return res.end(JSON.stringify({
            [a]: { files: [{ offset: 0, length: 128 * MiB }], selections: [{ from: 0, to: 15 }] },
            [b]: { files: [{ offset: 0, length: 64 * MiB }], selections: [{ from: 0, to: 15 }] }
        }));
        probes.push({ url: req.url, range: req.headers.range }); replies.push(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const reader = (hash, size) => ({ key: `/${hash}/0`, url: `${base}/${hash}/0`, total: size, disposed: false });
    return { probes, replies, metadata, reader,
        async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('disk prefetch requires caching and does not send probes to a non-cached server', async () => {
    const f = await fixture(0);
    const prefetch = createServerAhead({ onChange() {}, lead: 16 * MiB });
    try {
        const reader = f.reader(a, 128 * MiB);
        prefetch.pump(reader, 0, 0, []);
        await until(() => f.metadata.length === 1); await wait(30);
        prefetch.pump(reader, 0, 0, []);
        assert.equal(f.probes.length, 0);
    } finally { await f.close(); }
});

test('piece-byte budget is shared across readers with different piece sizes', async () => {
    const f = await fixture(1024 * MiB);
    const prefetch = createServerAhead({ onChange() {}, lead: 16 * MiB, maxBytes: 24 * MiB, maxProbes: 16 });
    try {
        const first = f.reader(a, 128 * MiB), second = f.reader(b, 64 * MiB);
        prefetch.pump(first, 0, 0, []); prefetch.pump(second, 0, 0, []);
        await until(() => f.metadata.length === 2); await wait(30);
        prefetch.pump(first, 0, 0, []); prefetch.pump(second, 0, 0, []);
        await until(() => f.probes.length >= 4); await wait(30);
        assert.equal(f.probes.filter(p => p.url.includes(a)).length, 2); // 2 × 8 MiB
        assert.equal(f.probes.filter(p => p.url.includes(b)).length, 2); // 2 × 4 MiB
        assert.equal(prefetch.inflight(), 4);
    } finally { await f.close(); }
});

test('an ignored Range response is rejected instead of being counted as prefetch', async () => {
    const f = await fixture(1024 * MiB);
    const prefetch = createServerAhead({ onChange() {}, lead: 8 * MiB });
    try {
        const reader = f.reader(a, 128 * MiB);
        prefetch.pump(reader, 0, 0, []);
        await until(() => f.metadata.length === 1); await wait(30);
        prefetch.pump(reader, 0, 0, []);
        await until(() => f.probes.length === 1);
        f.replies[0].writeHead(200); f.replies[0].write('not a one-byte range');
        await until(() => prefetch.inflight() === 0);
        assert.equal(reader.serverAhead.completed, 0);
        assert.equal(reader.serverAhead.failures, 1);
    } finally { await f.close(); }
});
