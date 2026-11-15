const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { plan, serverSummary, probe, createDiscovery } = require('../service/discovery');

const entry = (address, netmask = '255.255.255.0') => ({ address, netmask, family: 'IPv4', internal: false });

test('plans bounded private LAN searches, skips self/VPN/public interfaces and respects small subnets', () => {
    const result = plan({ wlan0: [entry('192.168.0.104')], eth0: [entry('192.168.0.105')], tun0: [entry('10.5.0.8')], other: [entry('8.8.8.8')] });
    assert.deepEqual(result.scopes, ['192.168.0.0/24']);
    assert.equal(result.targets.length, 252);
    assert.ok(!result.targets.includes('192.168.0.104'));
    assert.ok(!result.targets.includes('192.168.0.105'));
    assert.ok(result.targets.every(host => host.startsWith('192.168.0.')));
    const small = plan({ eth0: [entry('172.16.1.5', '255.255.255.252')] });
    assert.deepEqual(small.targets, ['172.16.1.6']);
    const wide = plan({ eth0: [entry('10.2.3.9', '255.0.0.0')] });
    assert.equal(wide.targets.length, 253); assert.equal(wide.limited, true);
    assert.deepEqual(plan({ eth0: [entry('192.168.1.3', '255.0.255.0')] }).targets, []);
});

test('accepts Stremio settings and exposes only connection metadata', () => {
    const valid = { values: { serverVersion: '4.21.0', btMaxConnections: 200, cacheSize: 10737418240, cacheRoot: '/private/folder', authKey: 'must-not-be-returned' } };
    assert.deepEqual(serverSummary(valid, '192.168.1.8'), { url: 'http://192.168.1.8:11470', version: '4.21.0', cacheEnabled: true });
    for (const data of [null, {}, { values: { serverVersion: 'unrelated service' } }, { values: { serverVersion: '4.21.0' } }]) assert.equal(serverSummary(data, '192.168.1.8'), null);
});

test('HTTP probe validates responses, rejects oversized/unrelated bodies and cancels hanging requests', async () => {
    let behavior = 'valid';
    const server = http.createServer((req, res) => {
        assert.equal(req.url, '/settings');
        if (behavior === 'hang') return;
        if (behavior === 'large') return res.end('x'.repeat(140000));
        res.end(JSON.stringify(behavior === 'valid' ? { values: { serverVersion: '4.21.0', btMaxConnections: 55, cacheSize: 0 } } : { app: 'other' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const control = new AbortController();
        assert.equal((await probe('127.0.0.1', control.signal, 500, port)).version, '4.21.0');
        behavior = 'other'; assert.equal(await probe('127.0.0.1', control.signal, 500, port), null);
        behavior = 'large'; assert.equal(await probe('127.0.0.1', control.signal, 500, port), null);
        behavior = 'hang';
        const started = Date.now(); assert.equal(await probe('127.0.0.1', control.signal, 60, port), null); assert.ok(Date.now() - started < 1000);
        const pending = probe('127.0.0.1', control.signal, 5000, port); control.abort(); assert.equal(await pending, null);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('discovery limits concurrency, deduplicates results and never starts another scan while one runs', async () => {
    let active = 0, maximum = 0, calls = 0;
    const discovery = createDiscovery({ interfaces: () => ({ eth0: [entry('192.168.1.1', '255.255.255.224')] }), probe: async host => {
        calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
        return host.endsWith('.3') ? { url: 'http://' + host + ':11470', version: '4.21.0', cacheEnabled: true } : null;
    } });
    const first = discovery.start(); assert.equal(first.total, 29); assert.equal(discovery.start().total, 29);
    while (discovery.state().running) await new Promise(resolve => setTimeout(resolve, 3));
    assert.equal(calls, 29); assert.ok(maximum <= 12); assert.equal(discovery.state().checked, 29); assert.equal(discovery.state().servers.length, 1);
});

test('cancelling discovery aborts in-flight probes without probing the rest of the network', async () => {
    let calls = 0;
    const discovery = createDiscovery({ interfaces: () => ({ eth0: [entry('192.168.1.1')] }), probe: (host, signal) => new Promise(resolve => {
        calls++; signal.addEventListener('abort', () => resolve(null), { once: true });
    }) });
    discovery.start(); discovery.cancel();
    while (discovery.state().running) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(discovery.state().cancelled, true); assert.equal(calls, 12);
    assert.equal(discovery.state().servers.length, 0);
});

test('missing or inaccessible interfaces return an actionable error without starting probes', () => {
    const missing = createDiscovery({ interfaces: () => ({ lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }) });
    assert.equal(missing.start().running, false); assert.match(missing.state().error, /IPv4/);
    const denied = createDiscovery({ interfaces: () => { throw new Error('getifaddrs denied'); } });
    assert.equal(denied.start().running, false); assert.match(denied.state().error, /manually/);
});
