// Older webOS versions retain the original local-server implementation.
if (Number(process.versions.node.split('.')[0]) < 18) {
    require('./legacy-launch');
} else {
    require('./playback-launch');
}
