// Run after `make build`: node --test tests/subtitle-size.test.cjs
// STREMIO_FRONTEND_DIR can point to a separately built frontend for patch checks.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const frontend = process.env.STREMIO_FRONTEND_DIR || path.join(__dirname, '../service/www');
const mainSource = fs.readFileSync(path.join(frontend, 'main.js'), 'utf8');
const videoSource = fs.readFileSync(path.join(frontend, 'video.chunk.js'), 'utf8');

function loadModules(source, globals = {}) {
    const self = { webpackChunkstremio_theater: [] };
    vm.runInNewContext(source, { self, ...globals }, { timeout: 1000 });
    return Object.assign({}, ...self.webpackChunkstremio_theater.map(chunk => chunk[1]));
}

// Module IDs belong to the pinned VIDAA_REF. Exercise the shipped modules,
// rather than copying their size calculations into the tests.
function subtitleOptions(webOSVersion) {
    const exports = {};
    const requireModule = id => {
        assert.equal(id, 289);
        return { aJ: () => webOSVersion };
    };
    requireModule.d = (target, getters) => {
        for (const [key, get] of Object.entries(getters)) {
            Object.defineProperty(target, key, { get });
        }
    };
    loadModules(mainSource)[1430]({}, exports, requireModule);
    return { presets: Array.from(exports.BT), min: exports.aK, max: exports.I2, step: exports['O$'] };
}

class Element {
    constructor(tag) {
        this.tag = tag;
        this.style = {};
        this.children = [];
        this.textTracks = [];
        this.audioTracks = [];
        this.sheet = { insertRule() {}, cssRules: [{ style: {} }] };
        if (tag === 'video') this.mediaId = 'test-media';
    }
    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    get lastChild() { return this.children[this.children.length - 1]; }
    hasChildNodes() { return this.children.length > 0; }
    addEventListener() {}
    removeAttribute(name) { delete this[name]; }
    load() {}
    play() {}
}

function videoFixture({ screen720p = false } = {}) {
    const calls = [];
    const globals = {
        HTMLElement: Element,
        document: { createElement: tag => new Element(tag) },
        window: {
            screen720p,
            webOS: { service: { request: (url, request) => calls.push(request) } },
        },
        console: { log() {}, error() {} },
        // Native playback scheduling is outside this test's DOM/Luna boundary.
        setTimeout: () => 0, clearTimeout() {},
        setInterval: () => 0, clearInterval() {},
        fetch: async () => ({ ok: true, text: async () => 'subtitle fixture' }),
    };
    const modules = loadModules(videoSource, globals);
    const dependencies = {
        5852: EventEmitter,
        5126: value => value,
        6435: value => value,
        6205: { WITH_HTML_SUBTITLES: { LOAD_FAILED: {} } },
        4775: () => {},
        // Parsing is independent of sizing; return one cue for the real renderer.
        6675: { convert: value => value },
        9260: { parse: async () => [{}] },
        3308: { render: () => [new Element('span')] },
        8742: () => { throw new Error('Unexpected color conversion'); },
    };
    function moduleExports(id) {
        const module = { exports: {} };
        modules[id](module, module.exports, dependency => {
            assert.ok(Object.hasOwn(dependencies, dependency), `Unexpected dependency ${dependency}`);
            return dependencies[dependency];
        });
        return module.exports;
    }
    const container = new Element('div');
    const NativeVideo = moduleExports(8904);
    const player = new NativeVideo({ containerElement: container });
    return { player, container, calls, withHTMLSubtitles: moduleExports(2556) };
}

const setProp = (player, propName, propValue) => player.dispatch({ type: 'setProp', propName, propValue });
const command = (player, commandName, commandArgs) => player.dispatch({ type: 'command', commandName, commandArgs });

test('webOS settings and player controls offer smaller sizes with 5% steps', () => {
    for (const version of [5, 6, 22, 23, 24, 25, 26]) {
        assert.deepEqual(subtitleOptions(version), {
            presets: [50, 75, 85, 100, 125, 150, 175, 200], min: 50, max: 200, step: 5,
        });
    }
});

test('non-webOS size options retain their existing range and step', () => {
    assert.deepEqual(subtitleOptions(0), {
        presets: [25, 50, 75, 100, 125, 150, 175, 200, 250], min: 25, max: 250, step: 25,
    });
});

test('native subtitles use the smallest preset below 100% and preserve larger presets', () => {
    const { player, calls } = videoFixture();
    for (const [size, preset] of [[50, 0], [75, 0], [85, 0], [95, 0], [100, 1], [125, 2], [150, 3], [175, 4], [200, 4]]) {
        setProp(player, 'subtitlesSize', size);
        assert.equal(calls.at(-1).method, 'setSubtitleFontSize');
        assert.equal(calls.at(-1).parameters.fontSize, preset, `${size}%`);
    }
    const count = calls.length;
    for (const value of [null, undefined, NaN, Infinity, 'invalid']) setProp(player, 'subtitlesSize', value);
    assert.equal(calls.length, count, 'invalid sizes do not reach Luna');
});

test('the native zero preset survives deferred media availability and track changes', () => {
    const { player, container, calls } = videoFixture();
    const video = container.children.find(element => element.tag === 'video');
    delete video.mediaId;
    setProp(player, 'subtitlesSize', 75);
    assert.equal(calls.length, 0);
    video.mediaId = 'loaded-media';
    command(player, 'load', { stream: { url: 'https://example.test/movie.mkv' } });
    setProp(player, 'selectedSubtitlesTrackId', 'EMBEDDED_0');
    setProp(player, 'selectedSubtitlesTrackId', 'EMBEDDED_1');
    const sizes = calls.filter(call => call.method === 'setSubtitleFontSize');
    assert.equal(sizes.length, 2);
    assert.ok(sizes.every(call => call.parameters.fontSize === 0));
});

class StubVideo extends EventEmitter {
    static manifest = { name: 'TestVideo', external: false, props: [], commands: [], events: [] };
    dispatch(action) {
        if (action.type === 'command' && action.commandName === 'load') {
            this.emit('propValue', 'time', 1000);
        }
    }
}

async function loadSubtitle(player) {
    command(player, 'load', { stream: { url: 'https://example.test/movie.mkv' } });
    command(player, 'addExtraSubtitlesTracks', {
        tracks: [{ id: 'test', lang: 'en', label: 'English', origin: 'ADDON', url: 'https://example.test/subtitles.srt' }],
    });
    await new Promise((resolve, reject) => {
        player.on('extraSubtitlesTrackLoaded', resolve);
        player.on('error', reject);
        setProp(player, 'selectedExtraSubtitlesTrackId', 'test');
    });
}

test('downloaded subtitle sizes render distinctly and survive a new video', async () => {
    const { withHTMLSubtitles } = videoFixture();
    const container = new Element('div');
    const Player = withHTMLSubtitles(StubVideo);
    const player = new Player({ containerElement: container });
    await loadSubtitle(player);
    const fontSize = () => container.children[0].children[0].style.fontSize;
    assert.equal(fontSize(), '4vmin', 'default size remains 100%');
    for (const [size, expected] of [[50, '2vmin'], [75, '3vmin'], [80, '3.2vmin'], [85, '3.4vmin'], [100, '4vmin'], [200, '8vmin']]) {
        setProp(player, 'extraSubtitlesSize', size);
        assert.equal(fontSize(), expected, `${size}%`);
    }
    setProp(player, 'extraSubtitlesSize', 85);
    await loadSubtitle(player);
    assert.equal(fontSize(), '3.4vmin');
});

test('fractional sizing retains the upstream 720p scale compensation', async () => {
    const { withHTMLSubtitles } = videoFixture({ screen720p: true });
    const container = new Element('div');
    const Player = withHTMLSubtitles(StubVideo);
    const player = new Player({ containerElement: container });
    setProp(player, 'extraSubtitlesSize', 85);
    await loadSubtitle(player);
    assert.ok(Math.abs(parseFloat(container.children[0].children[0].style.fontSize) - 5.2292) < 0.000001);
});
