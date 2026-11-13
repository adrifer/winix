import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const windows = process.platform === "win32";
const available = (() => {
  try {
    execFileSync(windows ? "wsl.exe" : "python3", windows ? ["--", "python3", "--version"] : ["--version"], { stdio: "ignore" });
    return true;
  } catch { return false; }
})();
const script = readFileSync("scripts/bootstrap-linux.sh", "utf8");
const source = script.split('python3 - "$@" <<\'PY\'\n')[1].split("\nPY")[0];

describe.skipIf(!available)("Linux repository bootstrap with mocked downloads/activation", () => {
  it("accepts and declines interactive trust using a real non-seekable terminal", () => {
    const test = `
import os, pty
namespace = {"__name__":"bootstrap_test"}
exec(${JSON.stringify(source)}, namespace)
master, slave = pty.openpty()
path = os.ttyname(slave)
namespace["open"] = lambda name, mode="r": open(path if name == "/dev/tty" else name, mode)
try:
    os.write(master, b"yes\\n")
    namespace["confirm"]("Trust repository?", False)
    assert b"Trust repository? [y/N]" in os.read(master, 4096)
    os.write(master, b"no\\n")
    try:
        namespace["confirm"]("Activate?", False)
        raise AssertionError("Declined trust was accepted")
    except RuntimeError as error:
        assert "cancelled" in str(error)
finally:
    os.close(slave)
    os.close(master)
print("WINIX_INTERACTIVE_TRUST_SUCCESS")
`;
    const output = execFileSync(windows ? "wsl.exe" : "python3", windows
      ? ["--", "python3", "-"] : ["-"], { input: test, encoding: "utf8", timeout: 15000 });
    expect(output).toContain("WINIX_INTERACTIVE_TRUST_SUCCESS");
  });

  it("verifies downloads, preserves existing checkouts and propagates safety failures", () => {
    const test = `
import hashlib, json, os, pathlib, tempfile, sys
namespace = {"__name__": "bootstrap_test"}
exec(${JSON.stringify(source)}, namespace)
namespace["platform"].machine = lambda: "x86_64"
namespace["sys"].platform = "linux"
with tempfile.TemporaryDirectory(prefix="winix-bootstrap-") as root:
    for scenario in ("prepare", "activate", "origin", "dirty", "floating", "hash", "escape", "existing"):
        destination = pathlib.Path(root) / scenario
        destination.mkdir()
        (destination / ".git").mkdir()
        config = destination / "winix"
        if scenario == "escape":
            outside = pathlib.Path(root) / "outside"
            outside.mkdir()
            config.symlink_to(outside, target_is_directory=True)
        else:
            config.mkdir()
        spec = "^0.3.0" if scenario == "floating" else "0.3.0-preview.1"
        (config / "package.json").write_text(json.dumps({"dependencies":{"@adrifer/winix":spec}}))
        calls = []
        data = b"verified executable"
        expected = hashlib.sha256(data).hexdigest()
        def fake_fetch(url):
            calls.append(("download", url))
            if url.endswith("/SHA256SUMS"):
                return (expected + "  winix-linux-x64\\n").encode()
            return b"corrupt" if scenario == "hash" else data
        def fake_run(args, cwd=None, capture=False):
            calls.append(("command", args))
            if args[:4] == ["git", "remote", "get-url", "origin"]:
                return "https://example.com/other.git" if scenario == "origin" else "https://example.com/dotfiles.git"
            if args[:3] == ["git", "status", "--porcelain"]:
                return " M config" if scenario == "dirty" else ""
            if args[:2] == ["git", "rev-parse"]:
                return "a" * 40
            if args[-1:] == ["--version"]:
                return "0.3.0-preview.1"
            if args[:2] == ["nix", "build"]:
                return ""
            raise AssertionError("Unexpected command: " + repr(args))
        namespace["fetch"] = fake_fetch
        namespace["run"] = fake_run
        original = namespace["subprocess"].run
        namespace["subprocess"].run = lambda args, **kwargs: calls.append(("activation", args))
        sys.argv = ["bootstrap", "--repository", "https://example.com/dotfiles.git", "--host", "linux",
                    "--destination", str(destination), "--yes"]
        if scenario != "activate":
            sys.argv.append("--prepare-only")
        try:
            if scenario in ("prepare", "activate", "existing"):
                namespace["main"]()
                activations = [args for kind,args in calls if kind == "activation"]
                assert len(activations) == 1, calls
                assert ("--prepare-only" in activations[0]) == (scenario != "activate")
                assert "--yes" in activations[0]
                if scenario == "existing":
                    calls.clear()
                    namespace["main"]()
                    assert not any(kind == "command" and args[:2] in (["git","clone"], ["git","checkout"], ["git","pull"]) for kind,args in calls)
            else:
                try:
                    namespace["main"]()
                    raise AssertionError("Unexpected success: " + scenario)
                except RuntimeError as error:
                    expected_error = {"origin":"different origin", "dirty":"local changes", "floating":"exact version",
                                      "hash":"checksum mismatch", "escape":"Unsafe bootstrap directory"}[scenario]
                    assert expected_error.lower() in str(error).lower(), str(error)
                assert not any(kind == "activation" for kind,args in calls), calls
                assert not any(kind == "command" and args[-1:] == ["--version"] for kind,args in calls), calls
        finally:
            namespace["subprocess"].run = original
print("WINIX_BOOTSTRAP_TEST_SUCCESS")
`;
    const output = execFileSync(windows ? "wsl.exe" : "python3", windows
      ? ["--", "python3", "-"] : ["-"], { input: test, encoding: "utf8", timeout: 30000 });
    expect(output).toContain("WINIX_BOOTSTRAP_TEST_SUCCESS");
  });

  it("keeps help/dry-run free of downloads and rejects unknown options", () => {
    const input = `
set -euo pipefail
bash scripts/bootstrap-linux.sh --repository https://example.com/dotfiles.git --host test --dry-run
bash scripts/bootstrap-linux.sh --help
if bash scripts/bootstrap-linux.sh --repository https://example.com/dotfiles.git --host test --dry-run --unknown; then exit 90; fi
`;
    const output = execFileSync(windows ? "wsl.exe" : "bash", windows
      ? ["--cd", process.cwd(), "--", "bash", "-s"] : ["-s"], { input, encoding: "utf8", timeout: 30000 });
    expect(output).toContain("No changes or config evaluation");
    expect(output).toContain("Usage: bash bootstrap-linux.sh");
    expect(output).not.toContain("Preparing a temporary");
  });
});
