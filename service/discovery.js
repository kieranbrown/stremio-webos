'use strict';
var os = require('os');
var http = require('http');

function ipv4(value) {
    var parts = value.split('.');
    if (parts.length !== 4 || parts.some(function(p) { return !/^\d+$/.test(p) || +p > 255; })) return null;
    return parts.reduce(function(n, p) { return (n * 256 + +p) >>> 0; }, 0);
}
function address(value) { return [24, 16, 8, 0].map(function(shift) { return value >>> shift & 255; }).join('.'); }
function privateAddress(value) {
    return value >>> 24 === 10 || value >>> 20 === 0xac1 || value >>> 16 === 0xc0a8;
}
function plan(interfaces) {
    var own = new Set(), targets = new Set(), scopes = [], limited = false;
    Object.values(interfaces).forEach(function(list) { list.forEach(function(item) { own.add(item.address); }); });
    Object.keys(interfaces).sort().forEach(function(name) {
        if (/^(lo|tun|tap|utun|ppp|docker|veth|virbr)/i.test(name)) return;
        interfaces[name].forEach(function(item) {
            if (item.internal || !['IPv4', 4].includes(item.family)) return;
            var ip = ipv4(item.address), mask = ipv4(item.netmask || '');
            if (ip === null || mask === null || !mask || !privateAddress(ip)) return;
            var inverted = (~mask) >>> 0;
            if (((inverted + 1) & inverted) !== 0) return; // non-contiguous mask
            var network = (ip & mask) >>> 0, broadcast = (network | inverted) >>> 0;
            var block = (ip & 0xffffff00) >>> 0;
            var first = Math.max(network + 1, block + 1), last = Math.min(broadcast - 1, block + 254);
            if (first > last || scopes.length >= 2) { limited = true; return; }
            var cidr = address(block) + '/24';
            if (scopes.includes(cidr)) return;
            scopes.push(cidr);
            if (inverted > 255) limited = true;
            for (var candidate = first; candidate <= last && targets.size < 508; candidate++) {
                var host = address(candidate);
                if (!own.has(host)) targets.add(host);
            }
        });
    });
    return { targets: Array.from(targets), scopes: scopes, limited: limited };
}

function serverSummary(data, host) {
    var values = data && data.values;
    if (!values || typeof values.serverVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/.test(values.serverVersion) ||
        typeof values.btMaxConnections !== 'number' || !(typeof values.cacheSize === 'number' || values.cacheSize === null)) return null;
    return { url: 'http://' + host + ':11470', version: values.serverVersion, cacheEnabled: values.cacheSize === null || values.cacheSize > 0 };
}

function probe(host, signal, timeout, port) {
    return new Promise(function(resolve) {
        var finished = false, req, timer;
        function finish(result) {
            if (finished) return;
            finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
            if (req) req.destroy();
            resolve(result || null);
        }
        function cancel() { finish(null); }
        if (signal.aborted) return finish(null);
        signal.addEventListener('abort', cancel, { once: true });
        req = http.get({ hostname: host, port: port || 11470, path: '/settings', agent: false, headers: { Accept: 'application/json', Connection: 'close' } }, function(res) {
            if (res.statusCode !== 200) { res.destroy(); return finish(null); }
            var chunks = [], size = 0;
            res.on('data', function(chunk) { size += chunk.length; if (size > 131072) { res.destroy(); finish(null); } else chunks.push(chunk); });
            res.on('error', function() { finish(null); });
            res.on('end', function() {
                try { finish(serverSummary(JSON.parse(Buffer.concat(chunks).toString()), host)); } catch (_) { finish(null); }
            });
        });
        req.on('error', function() { finish(null); });
        timer = setTimeout(cancel, timeout || 900);
    });
}

function createDiscovery(options) {
    options = options || {};
    var current = null;
    function state() {
        if (!current) return { running: false, checked: 0, total: 0, servers: [], scopes: [], limited: false };
        return { running: current.running, cancelled: current.cancelled, checked: current.checked, total: current.total,
            servers: current.servers.slice(), scopes: current.scopes, limited: current.limited, error: current.error || null };
    }
    function cancel() {
        if (current && current.running) { current.cancelled = true; current.control.abort(); }
    }
    function start() {
        if (current && current.running) return state();
        var network;
        try { network = plan((options.interfaces || os.networkInterfaces)()); }
        catch (_) {
            current = { running: false, cancelled: false, checked: 0, total: 0, servers: [], scopes: [], limited: false,
                error: 'Could not read this TV’s local network. Enter the server address manually.' };
            return state();
        }
        var job = current = { running: true, cancelled: false, checked: 0, total: network.targets.length, servers: [], scopes: network.scopes,
            limited: network.limited, control: new AbortController() };
        require('events').setMaxListeners(16, job.control.signal);
        if (!job.total) { job.running = false; job.error = 'No supported local IPv4 network was found. Enter the server address manually.'; return state(); }
        var next = 0;
        async function worker() {
            while (!job.control.signal.aborted && next < network.targets.length) {
                var host = network.targets[next++];
                try {
                    var result = await (options.probe || probe)(host, job.control.signal, 900);
                    if (result && !job.control.signal.aborted && !job.servers.some(function(server) { return server.url === result.url; })) job.servers.push(result);
                } catch (_) {}
                job.checked++;
            }
        }
        var deadline = setTimeout(function() { job.cancelled = true; job.control.abort(); job.error = 'Search timed out. Try again or enter the server address.'; }, 45000);
        Promise.all(Array.from({ length: Math.min(12, job.total) }, worker)).finally(function() {
            clearTimeout(deadline); job.running = false;
            job.servers.sort(function(a, b) { return a.url.localeCompare(b.url, undefined, { numeric: true }); });
        });
        return state();
    }
    return { start: start, state: state, cancel: cancel };
}
module.exports = { plan: plan, serverSummary: serverSummary, probe: probe, createDiscovery: createDiscovery };
