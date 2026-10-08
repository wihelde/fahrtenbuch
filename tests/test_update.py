from pathlib import Path
import os
import shutil
import socketserver
import subprocess
import tempfile
import threading
import unittest


class UpdateCommandTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="fahrtenbuch-update-test-")
        self.root = Path(self.temporary.name)
        self.app = self.root / "installation"
        self.app.mkdir()
        self.data = self.root / "data"
        self.data.mkdir()
        (self.data / "archive.txt").write_text("synthetic trips and corrections\n")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.environment = os.environ.copy()
        self.environment["PATH"] = str(self.bin) + ":" + self.environment["PATH"]
        self.events = self.app / "events.txt"
        self.upstream = self.root / "upstream"
        self.git("init", "--initial-branch=main", str(self.upstream))
        self.git("-C", str(self.upstream), "config", "user.name", "Fixture")
        self.git("-C", str(self.upstream), "config", "user.email", "fixture@example.invalid")
        candidate = Path(__file__).resolve().parents[1] / "scripts/update.sh"
        if candidate.exists():
            (self.upstream / "scripts").mkdir()
            shutil.copy(candidate, self.upstream / "scripts/update.sh")
        (self.upstream / "application.txt").write_text("version one\n")
        self.commit("Version one")
        self.old = self.git("-C", str(self.upstream), "rev-parse", "HEAD").strip()
        self.repository = self.app / "repository"
        self.git("clone", str(self.upstream), str(self.repository))
        (self.app / "current").symlink_to(self.repository)
        (self.app / "deployed-commit").write_text(self.old + "\n")
        (self.app / ".envrc").write_text(f"export DATA_DIR='{self.data}'\nexport PORT=3000\n")
        self.executable(self.app / "compose", '''#!/bin/sh
set -eu
base=$(dirname "$0")
printf '%s\\n' "$*" >> "$base/events.txt"
case "$1" in
  build) test ! -e "$base/build-fails" ;;
  ps) if [ "$2" = "--status" ]; then test -e "$base/stopped" || echo fixture-container; else echo fixture-container; fi ;;
  stop) touch "$base/stopped" ;;
  start|up) rm -f "$base/stopped" ;;
esac
''')
        self.executable(self.bin / "docker", "#!/bin/sh\ncase \"$1\" in inspect) echo fixture-image ;; image) exit 0 ;; esac\n")
        self.executable(self.bin / "curl", "#!/bin/sh\nexit 0\n")
        (self.upstream / "application.txt").write_text("version two\n")
        self.commit("Version two")
        self.new = self.git("-C", str(self.upstream), "rev-parse", "HEAD").strip()
        (self.app / "update").symlink_to(self.repository / "scripts/update.sh")

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *arguments):
        result = subprocess.run(["git", *arguments], capture_output=True, text=True, check=True)
        return result.stdout

    def commit(self, message):
        self.git("-C", str(self.upstream), "add", ".")
        self.git("-C", str(self.upstream), "-c", "commit.gpgsign=false", "commit", "-m", message)

    def executable(self, path, content):
        path.write_text(content)
        path.chmod(0o755)

    def run_update(self):
        return subprocess.run(["sh", str(self.app / "update")], capture_output=True, text=True, env=self.environment, timeout=30)

    def test_update_preserves_archive_and_keeps_a_backup(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.git("-C", str(self.repository), "rev-parse", "HEAD").strip(), self.new)
        self.assertEqual((self.app / "deployed-commit").read_text().strip(), self.new)
        self.assertEqual((self.data / "archive.txt").read_text(), "synthetic trips and corrections\n")
        backups = list((self.app / "backups").iterdir())
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "data/archive.txt").read_text(), "synthetic trips and corrections\n")
        self.assertEqual((backups[0] / "version.txt").read_text().strip(), self.old)
        events = self.events.read_text().splitlines()
        self.assertLess(events.index("build"), events.index("stop --timeout 30 fahrtenbuch"))
        self.assertIn("up -d --no-build --force-recreate fahrtenbuch", events)

    def test_failed_build_leaves_running_version_and_data_intact(self):
        (self.app / "build-fails").touch()
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.app / "deployed-commit").read_text().strip(), self.old)
        self.assertEqual((self.data / "archive.txt").read_text(), "synthetic trips and corrections\n")
        self.assertFalse((self.app / "stopped").exists())
        events = self.events.read_text().splitlines()
        self.assertIn("build", events)
        self.assertFalse(any(event.startswith("stop ") or event.startswith("up ") for event in events))
        (self.app / "build-fails").unlink()
        retry = self.run_update()
        self.assertEqual(retry.returncode, 0, retry.stdout + retry.stderr)
        self.assertEqual((self.app / "deployed-commit").read_text().strip(), self.new)

    def test_update_retains_the_running_image_before_the_build_replaces_it(self):
        compose = self.app / "compose"
        compose.write_text(compose.read_text().replace(
            'build) test ! -e "$base/build-fails" ;;',
            'build) test ! -e "$base/build-fails"; touch "$base/old-image-replaced" ;;',
        ))
        self.environment["UPDATE_TEST_INSTALLATION"] = str(self.app)
        self.executable(self.bin / "docker", '''#!/bin/sh
set -eu
case "$1" in
  inspect) echo fixture-image ;;
  image)
    if [ -e "$UPDATE_TEST_INSTALLATION/old-image-replaced" ]; then
      echo 'Error response from daemon: No such image: fixture-image' >&2
      exit 1
    fi
    echo retain-image >> "$UPDATE_TEST_INSTALLATION/events.txt"
    ;;
esac
''')
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.app / "deployed-commit").read_text().strip(), self.new)
        self.assertEqual((self.data / "archive.txt").read_text(), "synthetic trips and corrections\n")
        events = self.events.read_text().splitlines()
        self.assertLess(events.index("retain-image"), events.index("build"))

    def test_update_recovers_when_the_running_image_reference_is_already_missing(self):
        self.environment["UPDATE_TEST_INSTALLATION"] = str(self.app)
        self.executable(self.bin / "docker", '''#!/bin/sh
set -eu
case "$1" in
  inspect) echo unavailable-image ;;
  image)
    echo 'Error response from daemon: No such image: unavailable-image' >&2
    exit 1
    ;;
  commit)
    echo preserve-running-container >> "$UPDATE_TEST_INSTALLATION/events.txt"
    echo recovered-image
    ;;
esac
''')
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        events = self.events.read_text().splitlines()
        self.assertLess(events.index("preserve-running-container"), events.index("build"))
        self.assertEqual((self.app / "deployed-commit").read_text().strip(), self.new)
        backup = next((self.app / "backups").iterdir())
        self.assertEqual((backup / "data/archive.txt").read_text(), "synthetic trips and corrections\n")

    def test_startup_check_retries_when_the_connection_closes_early(self):
        class StartingApplication(socketserver.BaseRequestHandler):
            attempts = 0

            def handle(self):
                self.request.recv(4096)
                StartingApplication.attempts += 1
                if StartingApplication.attempts == 1:
                    return
                self.request.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")

        (self.bin / "curl").unlink()
        with socketserver.TCPServer(("127.0.0.1", 0), StartingApplication) as server:
            port = server.server_address[1]
            (self.app / ".envrc").write_text(f"export DATA_DIR='{self.data}'\nexport PORT={port}\n")
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                result = self.run_update()
            finally:
                server.shutdown()
                worker.join()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertGreaterEqual(StartingApplication.attempts, 2)
        self.assertEqual((self.app / "deployed-commit").read_text().strip(), self.new)


if __name__ == "__main__":
    unittest.main(verbosity=2)
