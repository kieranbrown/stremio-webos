"""Exercise the Makefile against local archives; no TV or internet is required."""
import hashlib
import io
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MAIN = "var before = 1;\nvar target = 1;\nvar after = 1;\n"
GOOD_PATCH = """--- main.js
+++ main.js
@@ -1,3 +1,3 @@
 var before = 1;
-var target = 1;
+var target = 2;
 var after = 1;
"""


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='webos-build-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copyfile(ROOT / 'Makefile', self.root / 'Makefile')
        for name in ('service/bin', 'patches', 'app'):
            (self.root / name).mkdir(parents=True)
        for name in ('service/server.js', 'service/bin/ffmpeg', 'service/bin/ffprobe', 'service/index.html'):
            (self.root / name).write_text('fixture')
        (self.root / 'app/appinfo.json').write_text('{"version":"1.0.0"}')
        self.archive = self.root / 'frontend.tar.gz'
        files = {'main.js': MAIN, 'video.chunk.js': 'var video = 1;\n',
                 'font.ttf': 'font', 'icon.png': 'png', 'icon.svg': 'svg', 'core.wasm': 'wasm'}
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name, value in files.items():
                data = value.encode()
                info = tarfile.TarInfo('frontend-ref/' + name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        self.digest = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def build(self, digest=None):
        return subprocess.run(['make', 'build', 'VIDAA_REPO=' + self.archive.as_uri(),
                               'VIDAA_SHA256=' + (digest or self.digest)],
                              cwd=self.root, capture_output=True, text=True)

    def test_verified_archive_and_patch_succeed(self):
        (self.root / 'patches/one.patch').write_text(GOOD_PATCH)
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('var target = 2;', (self.root / 'service/www/main.js').read_text())

    def test_checksum_mismatch_stops_before_frontend_copy(self):
        result = self.build('0' * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'service/www').exists())
        self.assertNotIn('Build complete', result.stdout)

    def test_failed_patch_is_not_hidden_by_a_later_success(self):
        (self.root / 'patches/000-bad.patch').write_text(GOOD_PATCH.replace('var target = 1;', 'var absent = 1;'))
        (self.root / 'patches/001-good.patch').write_text(GOOD_PATCH)
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / 'service/www/main.js').read_text(), MAIN)
        self.assertNotIn('Build complete', result.stdout)

    def test_patch_with_mismatched_context_cannot_apply_with_fuzz(self):
        (self.root / 'patches/one.patch').write_text(GOOD_PATCH.replace('var before = 1;', 'var before = 999;'))
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / 'service/www/main.js').read_text(), MAIN)


if __name__ == '__main__':
    unittest.main()
