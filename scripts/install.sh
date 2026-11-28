#!/usr/bin/env bash
set -euo pipefail

# Installs Winix for this user, or sets this machine up from a Winix repository.
# Nothing changes before the one confirmation.
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  printf '%s\n' \
    'Usage: bash install.sh [--version X.Y.Z]' \
    '       bash install.sh --repository HTTPS_URL [--ref BRANCH] [--host HOST] [--destination PATH] [--config-directory DIR] [--prepare-only]' \
    '       [--dry-run] [--yes]' \
    '' \
    'Without --repository: installs the latest Winix (or --version) in ~/.local/share/winix and the winix command in' \
    '~/.local/bin. Then run winix init in a new folder.' \
    'With --repository: also clones it, downloads the Winix version it pins and applies the host you choose (or --host).' \
    'A repository without a Winix config yet gets the latest Winix; run winix init in it.' \
    'Uses existing Nix for temporary Git/Python tools, or needs git and python3 installed. Never installs Nix.'
  exit 0
fi

arguments=("$@")
repository='' dry_run=0
while (($#)); do
  case "$1" in
    --repository|--ref|--host|--destination|--config-directory|--version)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || { echo "Missing value for $1" >&2; exit 2; }
      [[ "$1" == --repository ]] && repository="$2"
      shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --yes|--prepare-only) shift ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
if [[ -n "$repository" ]]; then
  [[ "$repository" == https://* && "$repository" != *'@'* && "$repository" != *'?'* && "$repository" != *'#'* ]] || {
    echo 'Repository must be HTTPS without credentials, query, or fragment' >&2; exit 2;
  }
fi
set -- "${arguments[@]}"
if ((dry_run)); then
  if [[ -n "$repository" ]]; then
    echo "Dry run: would clone or check $repository, download the Winix version it pins (verified), install the winix command and apply the host. Nothing was changed."
  else
    echo 'Dry run: would download the latest Winix (verified) to ~/.local/share/winix and install the winix command in ~/.local/bin. Nothing was changed.'
  fi
  exit 0
fi

if [[ "${WINIX_BOOTSTRAP_TOOLS:-}" != 1 ]] && command -v nix >/dev/null 2>&1; then
  printf '%s\n' 'Preparing a temporary Git/Python environment using existing Nix; no profile changes.'
  export WINIX_BOOTSTRAP_TOOLS=1
  export NIX_CONFIG="${NIX_CONFIG:+$NIX_CONFIG$'\n'}extra-experimental-features = nix-command flakes"
  pin='github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f'
  exec nix shell --no-write-lock-file "$pin#git" "$pin#python3" "$pin#bash" \
    --command bash "$0" "$@"
fi
if [[ -n "$repository" ]]; then
  command -v git >/dev/null 2>&1 || { echo 'Git is required. Install it with your package manager, or install Nix.' >&2; exit 1; }
fi
command -v python3 >/dev/null 2>&1 || { echo 'Python 3 is required (for HTTPS downloads and checksums).' >&2; exit 1; }

python3 - "$@" <<'PY'
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urlparse

RELEASES = "https://github.com/adrifer/winix/releases"
VERSION = r"\d+\.\d+\.\d+(?:-preview\.\d+)?"
NIXPKGS = "github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f"


def run(args, cwd=None, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def confirm(lines, yes):
    print("\n".join(lines))
    if yes:
        return
    # stdin contains this script, not an interactive terminal.
    try:
        with open("/dev/tty", "w") as tty:
            tty.write("Continue? [y/N] ")
            tty.flush()
        with open("/dev/tty", "r") as tty:
            answer = tty.readline().strip().lower()
    except OSError as error:
        raise RuntimeError("No terminal to confirm with; pass --yes after reviewing what it does") from error
    if answer not in ("y", "yes"):
        raise RuntimeError("Cancelled. Nothing was changed")


def repository_identity(url):
    """host/owner/repo for HTTPS and SSH Git URLs, so an SSH clone of the same repository is reused."""
    value = url.strip()
    match = re.fullmatch(r"(?:ssh://)?git@([^:/]+)[:/](.+)", value) or re.fullmatch(r"https://([^/@?#]+)/(.+)", value)
    if not match:
        return value
    path = match[2].rstrip("/")
    if path.endswith(".git"):
        path = path[:-4]
    return (match[1] + "/" + path).lower()


def safe_directory(path):
    for current in (path, *path.parents):
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise RuntimeError("Unsafe directory (a link, or not a directory): " + str(current))


class HTTPSRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != "https":
            raise RuntimeError("Refusing non-HTTPS download redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


opener = urllib.request.build_opener(HTTPSRedirects)


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "winix-install"})
    with opener.open(request, timeout=90) as response:
        return response.read()


def latest_version():
    tag = json.loads(fetch("https://api.github.com/repos/adrifer/winix/releases/latest"))["tag_name"].lstrip("v")
    if not re.fullmatch(VERSION, tag):
        raise RuntimeError("Unexpected latest Winix release: " + tag)
    return tag


def download(version, name, destination):
    release = RELEASES + "/download/v" + version
    sums = fetch(release + "/SHA256SUMS").decode("utf-8")
    entries = re.findall(r"^([a-fA-F0-9]{64})\s+\*?" + re.escape(name) + r"$", sums, re.M)
    if len(entries) != 1:
        raise RuntimeError("Missing or duplicate release checksum for " + name)
    if destination.is_symlink():
        raise RuntimeError("Refusing linked executable destination")
    expected = entries[0].lower()
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
        return
    print("Downloading " + name + " " + version + " (checksum-verified)...")
    data = fetch(release + "/" + name)
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError("Executable checksum mismatch; nothing was executed")
    fd, temporary = tempfile.mkstemp(prefix=".download-", dir=destination.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.chmod(temporary, 0o755)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def winix_home():
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "winix"


def install_runtime(version):
    """Downloads a release into ~/.local/share/winix/runtime/<version> behind a wrapper; returns the wrapper."""
    architecture = {"x86_64": "x64", "aarch64": "arm64"}.get(platform.machine())
    if not architecture or sys.platform != "linux":
        raise RuntimeError("Winix runs on Linux x64 and ARM64")
    runtime = winix_home() / "runtime" / version
    safe_directory(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    binary = runtime / "winix.bin"
    download(version, "winix-linux-" + architecture, binary)
    launcher = runtime / "winix"
    if launcher.is_symlink() or (launcher.exists() and not launcher.is_file()):
        raise RuntimeError("Unsafe runtime launcher")
    if Path("/etc/NIXOS").exists():
        # NixOS has no standard dynamic linker: start the binary through a pinned one.
        if not shutil.which("nix"):
            raise RuntimeError("NixOS must provide nix")
        for name, output in (("libc", "glibc.out"), ("compiler", "stdenv.cc.cc.lib")):
            run(["nix", "build", "--no-write-lock-file", "--out-link", str(runtime / name), NIXPKGS + "#" + output])
        linker = "ld-linux-x86-64.so.2" if architecture == "x64" else "ld-linux-aarch64.so.1"
        command = [str(runtime / "libc" / "lib" / linker), "--argv0", str(binary),
                   "--library-path", str(runtime / "libc" / "lib") + ":" + str(runtime / "compiler-lib" / "lib"), str(binary)]
    else:
        command = [str(binary)]
    if launcher.exists() and not launcher.read_text().startswith("#!/usr/bin/env bash\n# Generated by Winix bootstrap\n"):
        raise RuntimeError("Refusing to overwrite an unrecognized runtime launcher")
    launcher.write_text("#!/usr/bin/env bash\n# Generated by Winix bootstrap\nset -euo pipefail\nexport WINIX_STANDALONE_EXECUTABLE=" +
                        shlex.quote(str(launcher)) + "\nexec " + shlex.join(command) + ' "$@"\n')
    launcher.chmod(0o755)
    if run([str(launcher), "--version"], None, True).strip() != version:
        raise RuntimeError("The downloaded Winix doesn't report version " + version)
    return launcher


def checkout(args, destination):
    """Clones the repository (or checks an existing checkout); returns the config directory."""
    if not destination.exists():
        run(["git", "clone", "--origin", "origin", "--", args.repository, str(destination)])
        run(["git", "checkout", args.ref], destination)
    if not (destination / ".git").is_dir():
        raise RuntimeError("The destination exists but is not a Git checkout; refusing to use it")
    safe_directory(destination / ".git")
    origin = run(["git", "remote", "get-url", "origin"], destination, True).strip()
    if repository_identity(origin) != repository_identity(args.repository):
        raise RuntimeError("The existing checkout has a different origin (" + origin + ")")
    if run(["git", "status", "--porcelain", "--untracked-files=normal"], destination, True).strip():
        print("Warning: the checkout has local changes; they are used as they are (never reset, cleaned or stashed).",
              file=sys.stderr)
    head = run(["git", "rev-parse", "HEAD"], destination, True).strip()
    wanted = run(["git", "rev-parse", "--verify", args.ref + "^{commit}"], destination, True).strip()
    if head != wanted:
        raise RuntimeError("The existing checkout isn't at " + args.ref + "; switch it yourself. This script never pulls or resets")
    config = destination / (args.config_directory if args.config_directory is not None else config_directory(destination))
    safe_directory(config)
    return config


def config_directory(destination):
    """The folder of winix.config.ts when --config-directory is not given: the root, else winix/."""
    for candidate in (".", "winix"):
        if (destination / candidate / "winix.config.ts").is_file():
            return candidate
    return "."


def pinned_version(config):
    """The version a config pins, or None when the folder has no Winix config yet."""
    if not (config / "winix.config.ts").is_file() or not (config / "package.json").is_file():
        return None
    package = json.loads((config / "package.json").read_text())
    spec = package.get("dependencies", {}).get("@adrifer/winix") or package.get("devDependencies", {}).get("@adrifer/winix")
    if isinstance(spec, str) and re.fullmatch(VERSION, spec):
        return spec
    match = isinstance(spec, str) and re.fullmatch(
        r"https://github\.com/adrifer/winix/releases/download/v(" + VERSION + r")/adrifer-winix-\1\.tgz", spec)
    if not match:
        raise RuntimeError(str(config / "package.json") + " must pin an exact @adrifer/winix version")
    return match[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository")
    parser.add_argument("--ref", default="main")
    parser.add_argument("--host")
    parser.add_argument("--destination", default=str(Path.home() / "dotfiles"))
    parser.add_argument("--config-directory")
    parser.add_argument("--version")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    if args.version and not re.fullmatch(VERSION, args.version):
        raise RuntimeError("--version takes a release version such as 0.3.2")
    steps = []
    destination = None
    if args.repository:
        uri = urlparse(args.repository)
        if uri.scheme != "https" or not uri.hostname or uri.username or uri.password or uri.query or uri.fragment:
            raise RuntimeError("Repository must be HTTPS without credentials, query, or fragment")
        if not args.ref or args.ref.startswith("-") or any(c in args.ref + (args.host or "") for c in "\x00\r\n"):
            raise RuntimeError("Invalid --host or --ref")
        subdir = Path(args.config_directory or ".")
        if subdir.is_absolute() or ".." in subdir.parts:
            raise RuntimeError("--config-directory must be inside the repository")
        destination = Path(os.path.abspath(os.path.expanduser(args.destination)))
        safe_directory(destination)
        target = "host " + args.host if args.host else "the host you choose"
        steps += [
            "  - clone " + args.repository + " (" + args.ref + ") to " + str(destination) + " (or reuse that checkout)",
            "  - download the Winix version pinned in " +
            (args.config_directory + "/package.json" if args.config_directory is not None
             else "the repository's package.json (next to winix.config.ts at its root or in winix/)") +
            " (the latest if it has no config yet; checksum-verified)",
            "  - run its configuration code (TypeScript from this repository; it can run commands)",
            "  - " + ("show the plan for " + target + " without applying it" if args.prepare_only
                      else "apply " + target + " (sudo may ask for your password)"),
        ]
    else:
        if args.host or args.prepare_only:
            raise RuntimeError("--host and --prepare-only need --repository")
        steps.append("  - download " + ("Winix " + args.version if args.version else "the latest Winix") +
                     " (checksum-verified) to " + str(winix_home()))
    steps.append("  - install the winix command in ~/.local/bin")
    confirm(["This will:", *steps], args.yes)

    config = checkout(args, destination) if args.repository else None
    pinned = pinned_version(config) if config else None
    version = pinned or args.version or latest_version()
    launcher = install_runtime(version)
    if pinned:
        command = [str(launcher), "bootstrap", "--confirmed"]
        if args.host:
            command += ["--host", args.host]
        if args.prepare_only:
            command.append("--prepare-only")
        if args.yes:
            command.append("--yes")
        # Winix's own questions (host choice, removals) need the terminal, not this script's stdin.
        with open("/dev/tty", "r") if not args.yes else open(os.devnull) as input_stream:
            subprocess.run(command, cwd=config, stdin=input_stream, check=True)
        return
    run([str(launcher), "install", "command"])
    print()
    if config:
        config.mkdir(parents=True, exist_ok=True)
        print(str(config) + " has no Winix config yet:")
        print("  cd " + shlex.quote(str(config)))
        print("  winix init")
    else:
        print("Winix " + version + " is installed. In a new folder for your config:")
        print("  winix init")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        print("Winix install failed: " + str(error), file=sys.stderr)
        sys.exit(1)
PY
