#!/usr/bin/env python3
"""Check IPK timestamps before publishing or installing on webOS TVs."""

import argparse
import io
import subprocess
import tarfile


def check_timestamps(ipk):
    for name in ("control.tar.gz", "data.tar.gz"):
        result = subprocess.run(
            ["ar", "p", ipk, name], check=True, capture_output=True
        )
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:gz") as archive:
            for member in archive:
                # Older webOS tar versions warn about epoch-zero timestamps;
                # pkgverifier treats that warning as an extraction failure (-5).
                if member.mtime <= 0:
                    raise ValueError(
                        f"{name}: {member.name} has a non-positive timestamp. "
                        "Rebuild with @webos-tools/cli; @webosose/ares-cli "
                        "can produce IPKs that fail webOS verification (-5)."
                    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipk", help="Path to the packaged .ipk file")
    args = parser.parse_args()
    try:
        check_timestamps(args.ipk)
    except (OSError, subprocess.CalledProcessError, tarfile.TarError, ValueError) as error:
        parser.exit(1, f"IPK check failed: {error}\n")
    print(f"IPK timestamps verified: {args.ipk}")
