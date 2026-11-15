'use strict';
process.env.NODE_PATH = (process.env.NODE_PATH || '') + ':/usr/lib/node_modules:/usr/lib/nodejs';
require('module').Module._initPaths();
var Service = require('webos-service');
var app;
var service = new Service('io.strem.tv.server', null, {
    quitHandler: function() { if (app) app.shutdown(); }
});
app = require('./proxy').createApp();
var ready = false;
var pending = [];
service.activityManager.create('keepAlive', function() {});
service.register('start', function(message) {
    if (ready) message.respond({ returnValue: true, ready: true });
    else pending.push(message);
});
app.listen(8080, '127.0.0.1', function() {
    ready = true;
    pending.splice(0).forEach(function(message) { message.respond({ returnValue: true, ready: true }); });
});
app.on('error', function(error) { console.error('Stremio HTTP server:', error.message); });
