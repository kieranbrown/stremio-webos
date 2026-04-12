process.env.NODE_PATH = (process.env.NODE_PATH || '') + ':/usr/lib/node_modules:/usr/lib/nodejs';
require('module').Module._initPaths();
process.env.APP_PATH = process.env.APP_PATH || __dirname;

var http = require('http');
var fs = require('fs');
var path = require('path');
var Service = require('webos-service');

// Use a generous idle timeout (30s) to prevent the default 5s timer from
// killing the service before the async keepAlive activity is registered.
var service = new Service('io.strem.tv.server', undefined, { idleTimer: 30 });
var ready = false;
var pendingMessages = [];

service.activityManager.create('keepAlive', function() {});

// Register the start method — responds once the HTTP server is listening
service.register('start', function(message) {
    if (ready) {
        message.respond({ ready: true });
    } else {
        pendingMessages.push(message);
    }
});

// Static file serving
var wwwDir = path.join(__dirname, 'www');
var mimeTypes = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
    '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
    '.json': 'application/json'
};

function serveStatic(urlPath, res, next) {
    var filePath = path.join(wwwDir, urlPath === '/' ? 'index.html' : urlPath);
    var ext = path.extname(filePath);
    if (!ext || !mimeTypes[ext]) return next();

    fs.readFile(filePath, function(err, data) {
        if (err) return next();
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] });
        res.end(data);
    });
}

function proxyToStreaming(req, res) {
    var opts = { hostname: '127.0.0.1', port: 11470, path: req.url, method: req.method, headers: req.headers };
    var proxy = http.request(opts, function(proxyRes) {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    proxy.on('error', function() { res.writeHead(502); res.end(); });
    req.pipe(proxy);
}

function respondReady() {
    ready = true;
    pendingMessages.forEach(function(msg) { msg.respond({ ready: true }); });
    pendingMessages = [];
}

// Single server: static files first, then proxy to streaming server
var server = http.createServer(function(req, res) {
    var urlPath = req.url.split('?')[0];
    serveStatic(urlPath, res, function() { proxyToStreaming(req, res); });
});

server.on('error', function(err) {
    if (err.code === 'EADDRINUSE') {
        // Port still held from a previous instance — it's already running
        respondReady();
    }
});

server.listen(8080, respondReady);

// Start the streaming server
try { require('./server.js'); } catch (e) { /* server.js may fail on first boot */ }
