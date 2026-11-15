#!/usr/bin/env python3
"""Correct statistics in the pinned webOS server without editing its cached download."""
import argparse
from pathlib import Path

REPLACEMENTS = (
    ('uploadSpeed:e.swarm.downloadSpeed()', 'uploadSpeed:e.swarm.uploadSpeed()'),
    ('peers:e.swarm.wires.length,',
     'peers:e.swarm.wires.length,seeders:e.swarm.wires.filter(function(w){return w.isSeeder}).length,'),
    # Peer bitfields are padded to whole bytes, unlike the torrent piece array.
    ('if(wire.peerPieces.length===torrent.pieces.length)',
     'if(wire.peerPieces.length>=torrent.pieces.length)'),
)


def patch_source(source):
    for old, new in REPLACEMENTS:
        if source.count(old) != 1:
            raise ValueError('Expected exactly one server patch anchor: ' + old)
        source = source.replace(old, new, 1)
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    # Validate every anchor before replacing the output, including an existing build.
    patched = patch_source(args.input.read_text())
    args.output.write_text(patched)


if __name__ == '__main__':
    main()
