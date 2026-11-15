const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../service/www/video.chunk.js'), 'utf8');
const start = source.indexOf('A.audioTracks && A.audioTracks.addEventListener && A.audioTracks.addEventListener("addtrack"');
const end = source.indexOf('A.onloadedmetadata = function()', start);
assert.ok(start >= 0 && end > start, 'native-track handler anchors changed; run make build first');
const handler = source.slice(start, end);

function fixture() {
    let listener, now = 0, nextId = 0, lookups = 0;
    const timers = new Map(), notifications = [], selections = [];
    const tracks = [{ language: 'en', enabled: true }, { language: 'fr', enabled: false }];
    tracks.addEventListener = (name, callback) => { assert.equal(name, 'addtrack'); listener = callback; };
    const context = {
        A: { audioTracks: tracks, mediaId: 'test-media' }, D: { url: 'http://fixture/media' }, T: [], v: null,
        localStorage: { getItem: () => JSON.stringify({ settings: { audioLanguage: 'fr' } }) },
        G: event => notifications.push(event), l: request => selections.push(request),
        o: (url, callback) => {
            lookups++;
            callback({ audio: [{ lang: 'en', label: 'English' }, { lang: 'fr', label: 'French' }] });
        },
        setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, { at: now + delay, callback }); return id; },
        clearTimeout: id => timers.delete(id)
    };
    vm.runInNewContext(handler, context);
    function advance(ms) {
        now += ms;
        for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
    return { context, fire: () => listener(), advance, lookups: () => lookups, notifications, selections };
}

test('a burst causes one lookup and preserves preferred language and enriched labels', () => {
    const f = fixture();
    f.fire(); f.advance(30); f.fire(); f.advance(30); f.fire();
    f.advance(99);
    assert.equal(f.lookups(), 0);
    f.advance(1);
    assert.equal(f.lookups(), 1);
    assert.equal(f.context.T.length, 2);
    assert.equal(f.context.T[1].label, 'French');
    assert.equal(f.context.v, 'EMBEDDED_1');
    assert.equal(f.context.A.audioTracks[0].enabled, false);
    assert.equal(f.context.A.audioTracks[1].enabled, true);
    assert.equal(f.selections.length, 1);
    assert.equal(f.selections[0].parameters.index, 1);
    assert.equal(f.notifications.filter(e => e === 'selectedAudioTrackId').length, 1);
});

test('a later burst rebuilds again and preserves an existing rich native label', () => {
    const f = fixture();
    f.context.A.audioTracks[0].label = 'English commentary';
    f.fire(); f.advance(100);
    f.fire(); f.advance(20); f.fire(); f.advance(100);
    assert.equal(f.lookups(), 2);
    assert.equal(f.context.T[0].label, 'English commentary');
});

test('an empty native track list does not request server metadata', () => {
    const f = fixture();
    f.context.A.audioTracks.length = 0;
    f.fire(); f.advance(100);
    assert.equal(f.lookups(), 0);
    assert.equal(f.selections.length, 0);
});
