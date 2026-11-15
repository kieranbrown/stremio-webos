// Run the bundled backend in its own process, with orphan cleanup on service exit.
var parent = Number(process.env.STREMIO_PARENT_PID);
if (parent) {
    setInterval(function() {
        if (process.ppid !== parent) process.exit(0);
    }, 2000).unref();
}
require('./server.js');
