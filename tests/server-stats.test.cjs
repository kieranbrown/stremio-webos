const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../service/server.js'), 'utf8');

// Exercise the shipped function, not a reimplementation of its formulas.
const statsStart = source.indexOf('function getStatistics(e,idx)');
const statsEnd = source.indexOf('function Emit(args)', statsStart);
assert.ok(statsStart >= 0 && statsEnd > statsStart, 'statistics anchors changed');
const getStatistics = vm.runInNewContext(source.slice(statsStart, statsEnd) + ';getStatistics');
const seederMatch = source.match(/var i=0,checkseeder=function\(\)\{.*?\};(?=wire.on\("bitfield",checkseeder\))/);
assert.ok(seederMatch, 'seeder-check anchor changed');

function isSeeder(pieces, count) {
    const wire = { peerPieces: pieces, isSeeder: false };
    vm.runInNewContext(seederMatch[0] + 'checkseeder()', { wire, torrent: { pieces: new Array(count) } });
    return wire.isSeeder;
}

test('upload speed differs from download and seeders count only connected complete peers', () => {
    const swarm = {
        wires: [{ isSeeder: true }, { isSeeder: false }], _peers: {}, connections: [],
        downloadSpeed: () => 1000, uploadSpeed: () => 25
    };
    const stats = getStatistics({ swarm, torrent: { files: [] } }, 0);
    assert.equal(stats.downloadSpeed, 1000);
    assert.equal(stats.uploadSpeed, 25);
    assert.equal(stats.peers, 2);
    assert.equal(stats.seeders, 1);
    assert.equal(getStatistics(null), null);
    swarm.wires = [];
    assert.equal(getStatistics({ swarm, torrent: { files: [] } }, 0).seeders, 0);
});

test('seeder detection accepts padded bitfields but rejects missing real pieces', () => {
    assert.equal(isSeeder(Array(16).fill(1), 10), true);
    assert.equal(isSeeder(Array(10).fill(1), 10), true);
    const incomplete = Array(16).fill(1); incomplete[9] = 0;
    assert.equal(isSeeder(incomplete, 10), false);
    assert.equal(isSeeder(Array(8).fill(1), 10), false);
});

test('missing or duplicate patch anchors fail without replacing a prior build', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webos-server-patch-'));
    try {
        const input = path.join(dir, 'input.js'), output = path.join(dir, 'output.js');
        const anchor = 'uploadSpeed:e.swarm.downloadSpeed()';
        for (const text of ['changed upstream bundle', anchor + ',' + anchor]) {
            fs.writeFileSync(input, text); fs.writeFileSync(output, 'previous build');
            const result = spawnSync('python3', [path.join(__dirname, '../scripts/patch-server.py'), input, output]);
            assert.notEqual(result.status, 0);
            assert.equal(fs.readFileSync(output, 'utf8'), 'previous build');
        }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
