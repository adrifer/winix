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
const script = readFileSync("scripts/install.sh", "utf8");
const source = script.split('python3 - "$@" <<\'PY\'\n')[1].split("\nPY")[0];

describe.skipIf(!available)("install.sh with mocked downloads and Winix", () => {
  it("accepts and declines the confirmation using a real non-seekable terminal", () => {
    const test = `
import os, pty, select, time
namespace = {"__name__":"install_test"}
exec(${JSON.stringify(source)}, namespace)
master, slave = pty.openpty()
path = os.ttyname(slave)
namespace["open"] = lambda name, mode="r": open(path if name == "/dev/tty" else name, mode)
def read_until(expected, seconds=5):
    # PTY echo and output arrive asynchronously: keep reading until the prompt shows.
    data, deadline = b"", time.monotonic() + seconds
    while expected not in data and time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            data += os.read(master, 4096)
    return data
try:
    os.write(master, b"yes\\n")
    namespace["confirm"](["This will:"], False)
    assert b"Continue? [y/N]" in read_until(b"Continue? [y/N]")
    os.write(master, b"no\\n")
    try:
        namespace["confirm"](["This will:"], False)
        raise AssertionError("Declined confirmation was accepted")
    except RuntimeError as error:
        assert "Cancelled" in str(error)
finally:
    os.close(slave)
    os.close(master)
print("WINIX_INTERACTIVE_TRUST_SUCCESS")
`;
    const output = execFileSync(windows ? "wsl.exe" : "python3", windows
      ? ["--", "python3", "-"] : ["-"], { input: test, encoding: "utf8", timeout: 15000 });
    expect(output).toContain("WINIX_INTERACTIVE_TRUST_SUCCESS");
  });

  it("finds the config at the repository root or in winix/ when --config-directory is not given", () => {
    const test = `
import pathlib, tempfile
namespace = {"__name__": "install_test"}
exec(${JSON.stringify(source)}, namespace)
find = namespace["config_directory"]
with tempfile.TemporaryDirectory(prefix="winix-config-dir-") as root:
    root = pathlib.Path(root)
    assert find(root) == ".", "empty repository: the root"
    (root / "winix").mkdir()
    (root / "winix" / "winix.config.ts").write_text("export default {}")
    assert find(root) == "winix", "config in winix/"
    (root / "winix.config.ts").write_text("export default {}")
    assert find(root) == ".", "the root wins"
    assert root / find(root) == root
print("WINIX_CONFIG_DIRECTORY_SUCCESS")
`;
    const output = execFileSync(windows ? "wsl.exe" : "python3", windows
      ? ["--", "python3", "-"] : ["-"], { input: test, encoding: "utf8", timeout: 15000 });
    expect(output).toContain("WINIX_CONFIG_DIRECTORY_SUCCESS");
  });

  it("installs, sets up repositories, verifies downloads and refuses unsafe checkouts", () => {
    const test = `
import hashlib, json, os, pathlib, tempfile, sys
namespace = {"__name__": "install_test"}
exec(${JSON.stringify(source)}, namespace)
namespace["platform"].machine = lambda: "x86_64"
namespace["sys"].platform = "linux"
with tempfile.TemporaryDirectory(prefix="winix-install-") as root:
    for scenario in ("install", "version", "empty", "prepare", "activate", "origin", "dirty", "nohost", "ssh", "floating", "hash", "escape", "existing"):
        # Each scenario installs into its own folder (a verified binary there is reused).
        os.environ["XDG_DATA_HOME"] = str(pathlib.Path(root) / ("data-" + scenario))
        destination = pathlib.Path(root) / scenario
        destination.mkdir()
        (destination / ".git").mkdir()
        config = destination / "winix"
        if scenario == "escape":
            outside = pathlib.Path(root) / "outside"
            outside.mkdir()
            config.symlink_to(outside, target_is_directory=True)
        elif scenario != "empty":
            config.mkdir()
        if scenario not in ("empty", "escape"):
            (config / "winix.config.ts").write_text("export default {}")
            spec = "^0.3.0" if scenario == "floating" else "0.3.0-preview.1"
            (config / "package.json").write_text(json.dumps({"dependencies":{"@adrifer/winix":spec}}))
        calls = []
        data = b"verified executable"
        expected = hashlib.sha256(data).hexdigest()
        def fake_fetch(url):
            calls.append(("download", url))
            if "api.github.com" in url:
                return json.dumps({"tag_name": "v0.9.0"}).encode()
            if url.endswith("/SHA256SUMS"):
                return (expected + "  winix-linux-x64\\n").encode()
            return b"corrupt" if scenario == "hash" else data
        def fake_run(args, cwd=None, capture=False):
            calls.append(("command", args))
            if args[:4] == ["git", "remote", "get-url", "origin"]:
                return {"origin": "git@example.com:other.git", "ssh": "git@example.com:Dotfiles.git"}.get(scenario, "https://example.com/dotfiles.git")
            if args[:3] == ["git", "status", "--porcelain"]:
                return " M config" if scenario == "dirty" else ""
            if args[:2] == ["git", "rev-parse"]:
                return "a" * 40
            if args[-1:] == ["--version"]:
                return pathlib.Path(args[0]).parent.name
            if args[:2] == ["nix", "build"] or args[-2:] == ["install", "command"]:
                return ""
            raise AssertionError("Unexpected command: " + repr(args))
        namespace["fetch"] = fake_fetch
        namespace["run"] = fake_run
        original = namespace["subprocess"].run
        namespace["subprocess"].run = lambda args, **kwargs: calls.append(("winix", args))
        if scenario in ("install", "version"):
            sys.argv = ["install", "--yes", *(["--version", "0.3.2"] if scenario == "version" else [])]
        else:
            sys.argv = ["install", "--repository", "https://example.com/dotfiles.git",
                        *([] if scenario == "nohost" else ["--host", "linux"]),
                        "--destination", str(destination), "--config-directory", "winix", "--yes"]
            if scenario not in ("activate", "empty"):
                sys.argv.append("--prepare-only")
        try:
            if scenario in ("install", "version", "empty"):
                namespace["main"]()
                version = "0.3.2" if scenario == "version" else "0.9.0"
                assert any(kind == "download" and "/v" + version + "/" in url for kind, url in calls), calls
                assert ("download", "https://api.github.com/repos/adrifer/winix/releases/latest") in calls if scenario != "version" else True
                assert any(kind == "command" and args[-2:] == ["install", "command"] for kind, args in calls), calls
                assert not any(kind == "winix" for kind, args in calls), calls
                runtime = pathlib.Path(os.environ["XDG_DATA_HOME"]) / "winix" / "runtime" / version
                assert (runtime / "winix.bin").read_bytes() == data
                assert (runtime / "winix").read_text().startswith("#!/usr/bin/env bash\\n# Generated by Winix bootstrap\\n")
                if scenario == "empty":
                    assert config.is_dir()
            elif scenario in ("prepare", "activate", "existing", "dirty", "nohost", "ssh"):
                namespace["main"]()
                handoffs = [args for kind, args in calls if kind == "winix"]
                assert len(handoffs) == 1, calls
                assert handoffs[0][1:3] == ["bootstrap", "--confirmed"]
                assert ("--prepare-only" in handoffs[0]) == (scenario != "activate")
                assert "--yes" in handoffs[0]
                assert ("--host" in handoffs[0]) == (scenario != "nohost")
                assert any(kind == "download" and "/v0.3.0-preview.1/" in url for kind, url in calls), calls
                if scenario == "existing":
                    calls.clear()
                    namespace["main"]()
                    assert not any(kind == "command" and args[:2] in (["git","clone"], ["git","checkout"], ["git","pull"]) for kind,args in calls)
            else:
                try:
                    namespace["main"]()
                    raise AssertionError("Unexpected success: " + scenario)
                except RuntimeError as error:
                    expected_error = {"origin":"different origin", "floating":"exact",
                                      "hash":"checksum mismatch", "escape":"Unsafe directory"}[scenario]
                    assert expected_error.lower() in str(error).lower(), str(error)
                assert not any(kind == "winix" for kind,args in calls), calls
                assert not any(kind == "command" and args[-1:] == ["--version"] for kind,args in calls) or scenario == "hash", calls
        finally:
            namespace["subprocess"].run = original
print("WINIX_INSTALL_TEST_SUCCESS")
`;
    const output = execFileSync(windows ? "wsl.exe" : "python3", windows
      ? ["--", "python3", "-"] : ["-"], { input: test, encoding: "utf8", timeout: 30000 });
    expect(output).toContain("WINIX_INSTALL_TEST_SUCCESS");
  });

  it("keeps help and dry runs free of downloads and rejects unknown options", () => {
    const input = `
set -euo pipefail
bash scripts/install.sh --dry-run
bash scripts/install.sh --repository https://example.com/dotfiles.git --host test --dry-run
bash scripts/install.sh --help
if bash scripts/install.sh --repository https://example.com/dotfiles.git --host test --dry-run --unknown; then exit 90; fi
`;
    const output = execFileSync(windows ? "wsl.exe" : "bash", windows
      ? ["--cd", process.cwd(), "--", "bash", "-s"] : ["-s"], { input, encoding: "utf8", timeout: 30000 });
    expect(output).toContain("would download the latest Winix");
    expect(output).toContain("would clone or check https://example.com/dotfiles.git");
    expect(output).toContain("Usage: bash install.sh");
    expect(output).not.toContain("Preparing a temporary");
  });
});

describe.skipIf(!available)("Linux winix command (real bash)", () => {
  it("runs the installed Winix's router with every argument, from where you are", async () => {
    const { linuxCommandShim } = await import("../src/cli/winix-home.ts");
    const b64 = (text: string) => Buffer.from(text).toString("base64");
    const input = `
set -euo pipefail
root=$(mktemp -d); trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/installed" "$root/my folder"
printf '#!/usr/bin/env bash\necho "installed $PWD $*"\n' > "$root/installed/winix"
chmod +x "$root/installed/winix"
echo '${b64(linuxCommandShim("/PLACEHOLDER/winix"))}' | base64 -d | sed "s#/PLACEHOLDER#$root/installed#" > "$root/winix"
chmod +x "$root/winix"
cd "$root/my folder"
"$root/winix" plan "two words"
`;
    const output = execFileSync(windows ? "wsl.exe" : "bash", windows ? ["--", "bash", "-s"] : ["-s"],
      { input, encoding: "utf8", timeout: 30000 });
    expect(output.trim()).toMatch(/^installed .*\/my folder run plan two words$/);
  });
});
