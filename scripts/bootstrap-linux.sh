#!/usr/bin/env bash
set -euo pipefail

# Repository mode never installs Nix or changes the system before confirmation.
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then
  printf '%s\n' \
    'Usage: bash bootstrap-linux.sh --repository HTTPS_URL --ref BRANCH --host HOST [--destination PATH] [--config-directory winix] [--prepare-only] [--dry-run] [--yes]' \
    'Uses existing Nix for temporary Git/Python tools, or requires installed git and python3.' \
    'No Node/npm, package installation, reboot, checkout reset, or activation without confirmation.'
  exit 0
fi

arguments=("$@")
repository='' hostname='' dry_run=0
while (($#)); do
  case "$1" in
    --repository|--ref|--host|--destination|--config-directory)
      [[ $# -ge 2 && -n "$2" && "$2" != -* ]] || { echo "Missing value for $1" >&2; exit 2; }
      case "$1" in
        --repository) repository="$2" ;;
        --host) hostname="$2" ;;
      esac
      shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    --yes|--prepare-only) shift ;;
    *) echo "Unknown bootstrap option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$repository" && -n "$hostname" ]] || { echo '--repository and --host are required; see --help' >&2; exit 2; }
[[ "$repository" == https://* && "$repository" != *'@'* && "$repository" != *'?'* && "$repository" != *'#'* ]] || {
  echo 'Repository must be HTTPS without credentials, query, or fragment' >&2; exit 2;
}
set -- "${arguments[@]}"
if ((dry_run)); then
  printf '%s\n' 'Dry run: would validate arguments, ensure temporary tools, clone/validate the checkout, read its exact Winix pin, verify release downloads, then preview/confirm activation. No changes or config evaluation performed.'
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
command -v git >/dev/null 2>&1 || { echo 'Git is required. Install it through your approved package manager, or provide an existing Nix installation.' >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo 'Python 3 is required for bootstrap JSON and HTTPS handling; Node/npm are not needed.' >&2; exit 1; }

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


def run(args, cwd=None, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def confirm(message, yes):
    if yes:
        return
    # stdin contains this script, not an interactive terminal.
    try:
        with open("/dev/tty", "r+") as tty:
            tty.write(message + " [y/N] ")
            tty.flush()
            answer = tty.readline().strip().lower()
    except OSError as error:
        raise RuntimeError("Interactive confirmation unavailable; pass --yes only after reviewing the repository/script") from error
    if answer not in ("y", "yes"):
        raise RuntimeError("Bootstrap cancelled")


def safe_directory(path):
    for current in (path, *path.parents):
        if current.is_symlink() or (current.exists() and not current.is_dir()):
            raise RuntimeError("Unsafe bootstrap directory: " + str(current))


class HTTPSRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != "https":
            raise RuntimeError("Refusing non-HTTPS download redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


opener = urllib.request.build_opener(HTTPSRedirects)


def fetch(url):
    with opener.open(url, timeout=90) as response:
        return response.read()


def download(release, name, destination):
    sums = fetch(release + "/SHA256SUMS").decode("utf-8")
    entries = re.findall(r"^([a-fA-F0-9]{64})\s+\*?" + re.escape(name) + r"$", sums, re.M)
    if len(entries) != 1:
        raise RuntimeError("Missing or duplicate release checksum for " + name)
    if destination.is_symlink():
        raise RuntimeError("Refusing linked executable destination")
    expected = entries[0].lower()
    if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
        return
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--ref", default="main")
    parser.add_argument("--host", required=True)
    parser.add_argument("--destination", default=str(Path.home() / "dotfiles"))
    parser.add_argument("--config-directory", default="winix")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    uri = urlparse(args.repository)
    if uri.scheme != "https" or not uri.hostname or uri.username or uri.password or uri.query or uri.fragment:
        raise RuntimeError("Repository must be HTTPS without credentials, query, or fragment")
    if not args.ref or args.ref.startswith("-") or any(c in args.ref + args.host for c in "\x00\r\n"):
        raise RuntimeError("Invalid host/ref")
    subdir = Path(args.config_directory)
    if subdir.is_absolute() or ".." in subdir.parts:
        raise RuntimeError("config-directory must be inside the checkout")
    destination = Path(os.path.abspath(os.path.expanduser(args.destination)))
    safe_directory(destination)
    confirm("Trust " + args.repository + " and allow cloning/downloads? Config evaluation is confirmed separately.", args.yes)
    if not destination.exists():
        run(["git", "clone", "--origin", "origin", "--", args.repository, str(destination)])
        run(["git", "checkout", args.ref], destination)
    if not (destination / ".git").is_dir():
        raise RuntimeError("Existing destination is not a regular Git checkout; refusing adoption")
    safe_directory(destination / ".git")
    if run(["git", "remote", "get-url", "origin"], destination, True).strip() != args.repository:
        raise RuntimeError("Existing checkout has a different origin")
    if run(["git", "status", "--porcelain", "--untracked-files=normal"], destination, True).strip():
        raise RuntimeError("Checkout has local changes; bootstrap never resets, cleans, or stashes them")
    head = run(["git", "rev-parse", "HEAD"], destination, True).strip()
    wanted = run(["git", "rev-parse", "--verify", args.ref + "^{commit}"], destination, True).strip()
    if head != wanted:
        raise RuntimeError("Existing checkout differs from the requested local ref; switch it explicitly. No automatic pull/reset.")
    config = destination / subdir
    safe_directory(config)
    package = json.loads((config / "package.json").read_text())
    spec = package.get("dependencies", {}).get("@adrifer/winix") or package.get("devDependencies", {}).get("@adrifer/winix")
    if not isinstance(spec, str):
        raise RuntimeError("Missing exact @adrifer/winix dependency")
    version = spec if re.fullmatch(r"\d+\.\d+\.\d+(?:-preview\.\d+)?", spec) else None
    if not version:
        match = re.fullmatch(r"https://github\.com/adrifer/winix/releases/download/v(\d+\.\d+\.\d+(?:-preview\.\d+)?)/adrifer-winix-\1\.tgz", spec)
        if not match:
            raise RuntimeError("Winix pin must be an exact version or matching official release SDK URL")
        version = match[1]
    architecture = {"x86_64": "x64", "aarch64": "arm64"}.get(platform.machine())
    if not architecture or sys.platform != "linux":
        raise RuntimeError("Supported standalone targets: Linux x64 and ARM64")
    runtime = config / ".winix" / "runtime" / version
    safe_directory(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    release = "https://github.com/adrifer/winix/releases/download/v" + version
    binary = runtime / "winix.bin"
    download(release, "winix-linux-" + architecture, binary)
    nixos = Path("/etc/NIXOS").exists()
    launcher = runtime / "winix"
    if launcher.is_symlink() or (launcher.exists() and not launcher.is_file()):
        raise RuntimeError("Unsafe runtime launcher")
    if nixos:
        if not shutil.which("nix"):
            raise RuntimeError("Existing NixOS installation must provide nix")
        pin = "github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f"
        for name, output in (("libc", "glibc.out"), ("compiler", "stdenv.cc.cc.lib")):
            run(["nix", "build", "--no-write-lock-file", "--out-link", str(runtime / name), pin + "#" + output])
        linker = "ld-linux-x86-64.so.2" if architecture == "x64" else "ld-linux-aarch64.so.1"
        command = [str(runtime / "libc" / "lib" / linker), "--argv0", str(binary),
                   "--library-path", str(runtime / "libc" / "lib") + ":" + str(runtime / "compiler" / "lib"), str(binary)]
    else:
        command = [str(binary)]
    if launcher.exists() and not launcher.read_text().startswith("#!/usr/bin/env bash\n# Generated by Winix bootstrap\n"):
        raise RuntimeError("Refusing to overwrite an unrecognized runtime launcher")
    launcher.write_text("#!/usr/bin/env bash\n# Generated by Winix bootstrap\nset -euo pipefail\nexport WINIX_STANDALONE_EXECUTABLE=" +
                        shlex.quote(str(launcher)) + "\nexec " + shlex.join(command) + ' "$@"\n')
    launcher.chmod(0o755)
    if run([str(launcher), "--version"], config, True).strip() != version:
        raise RuntimeError("Executable version does not match the checkout")
    command = [str(launcher), "bootstrap", "--host", args.host]
    if args.prepare_only:
        command.append("--prepare-only")
    if args.yes:
        command.append("--yes")
    # Config confirmations in Winix require a terminal, not the Python source pipe.
    with open("/dev/tty", "r") if not args.yes else open(os.devnull) as input_stream:
        subprocess.run(command, cwd=config, stdin=input_stream, check=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print("Winix bootstrap failed: " + str(error), file=sys.stderr)
        sys.exit(1)
PY
