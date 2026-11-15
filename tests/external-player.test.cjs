const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../service/external-server.js'), 'utf8');
const hash = 'ab'.repeat(20);
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fixture(mode = 'external', supported = true) {
    const calls = [], beacons = [], intervals = new Map(), events = {}, documentEvents = {}, dispatches = [];
    let now = 100000;
    const location = { origin: 'http://127.0.0.1:8080', href: 'http://127.0.0.1:8080/', hash: '#/player/test' };
    const video = { currentSrc: location.origin + '/' + hash + '/2', paused: true, readyState: 4, ended: false, error: null };
    const window = {
        addEventListener: (name, fn) => (events[name] ||= []).push(fn),
        core: {
            getState: async () => ({ profile: { settings: { streamingServerUrl: 'http://old-server/', audioLanguage: 'en' } } }),
            dispatch: async (action, target) => dispatches.push({ action, target })
        }
    };
    const context = {
        window, location, URL, Date: { now: () => now }, console,
        navigator: { sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } },
        document: { querySelector: () => video, addEventListener: (name, fn) => { documentEvents[name] = fn; } },
        setInterval: (fn, ms) => intervals.set(ms, fn),
        fetch: async (url, options = {}) => {
            calls.push({ url, options });
            return { ok: true, json: async () => url === '/playback/config' ?
                (supported ? { config: { mode } } : { supported: false }) : { active: options.method === 'POST' } };
        }
    };
    vm.runInNewContext(source, context);
    await flush();
    return { calls, beacons, intervals, events, documentEvents, dispatches, location, video,
        setTime: value => { now = value; },
        tick: async ms => { if (intervals.has(ms)) await intervals.get(ms)(); await flush(); } };
}

test('a paused direct torrent renews its lease, then Play cancels it', async () => {
    const f = await fixture();
    await f.tick(5000);
    let posts = f.calls.filter(c => c.options.method === 'POST');
    assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(posts[0].options.body), { infoHash: hash, fileIdx: 2 });
    await f.tick(5000);
    assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 1);
    f.setTime(160000); // UI resumes heartbeats after an ordinary screensaver interval.
    await f.tick(5000);
    assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 2);
    f.video.paused = false;
    f.documentEvents.play(); await flush();
    assert.equal(f.calls.at(-1).options.method, 'DELETE');
});

test('standalone mode and unrelated media do not request an external pause lease', async () => {
    for (const mode of ['tv', 'external']) {
        const f = await fixture(mode);
        if (mode === 'external') f.video.currentSrc = 'https://media.example/video.mp4';
        await f.tick(5000);
        assert.equal(f.calls.filter(c => c.options.method === 'POST').length, 0);
    }
});

test('leaving playback stops the lease and sends cleanup; page exit sends stop beacons', async () => {
    const f = await fixture();
    await f.tick(5000);
    f.location.hash = '#/home';
    for (const callback of f.events.hashchange) callback({ oldURL: f.location.origin + '/#/player/test' });
    await flush();
    assert.equal(f.calls.at(-1).options.method, 'DELETE');
    assert.equal(f.beacons[0].url, '/playback/leave');
    f.events.pagehide[0]();
    assert.deepEqual(JSON.parse(f.beacons[1].body), { stop: true });
    assert.equal(f.beacons[2].url, '/playback/leave');
});

test('core URL sync waits until outside playback and preserves other settings', async () => {
    const f = await fixture();
    await f.tick(2000);
    assert.equal(f.dispatches.length, 0);
    f.location.hash = '#/home';
    await f.tick(2000);
    assert.equal(f.dispatches.length, 2);
    const settings = f.dispatches[0].action.args.args;
    assert.equal(settings.streamingServerUrl, f.location.origin + '/');
    assert.equal(settings.audioLanguage, 'en');
});

test('legacy capability response leaves the original settings flow untouched', async () => {
    const f = await fixture('tv', false);
    assert.equal(f.intervals.size, 0);
    assert.deepEqual(Object.keys(f.documentEvents), []);
});

test('service entry selects the original implementation on old Node runtimes', () => {
    const entry = fs.readFileSync(path.join(__dirname, '../service/launch.js'), 'utf8');
    for (const [version, expected] of [['8.12.0', './legacy-launch'], ['20.12.2', './playback-launch']]) {
        const loaded = [];
        vm.runInNewContext(entry, { process: { versions: { node: version } }, require: name => loaded.push(name) });
        assert.deepEqual(loaded, [expected]);
    }
});
