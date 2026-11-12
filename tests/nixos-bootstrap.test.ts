import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const windows = process.platform === "win32";
const available = (() => {
  try {
    execFileSync(windows ? "wsl" : "bash", windows ? ["--status"] : ["--version"], { stdio: "ignore" });
    return true;
  } catch (error) {
    if (windows) return false;
    throw error;
  }
})();

function run(body: string, args = ""): string {
  const harness = `
set -euo pipefail
source scripts/bootstrap-nixos.sh
temporary=$(mktemp -d)
trap 'rm -f "$temporary/nix"; rmdir "$temporary"' EXIT
cat > "$temporary/nix" <<'MOCK'
#!/usr/bin/env bash
printf 'NIX_ARG:%s\\n' "$@"
printf 'NIX_CONFIG_START\\n%s\\nNIX_CONFIG_END\\n' "\${NIX_CONFIG-}"
printf 'NIX_CWD:%s\\n' "$PWD"
exit "\${MOCK_NIX_EXIT:-0}"
MOCK
chmod +x "$temporary/nix"
export PATH="$temporary:$PATH"
export NIX_CONFIG='keep-going = true'
winix_require_nixos() { return 0; }
${body}
set +e
(winix_bootstrap_nixos ${args}) 2>&1
code=$?
printf 'BOOTSTRAP_EXIT:%s\\n' "$code"
printf 'PARENT_NIX_CONFIG:%s\\n' "$NIX_CONFIG"
`;
  return execFileSync(windows ? "wsl" : "bash", windows
    ? ["--cd", process.cwd(), "--", "bash", "-s"] : ["-s"], {
    cwd: process.cwd(), input: harness, encoding: "utf8", timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe.skipIf(!available)("NixOS prerequisite bootstrap", () => {
  it("uses one immutable nixpkgs revision and leaves the parent session untouched", () => {
    const output = run("");
    const args = [...output.matchAll(/^NIX_ARG:(.*)$/gm)].map((match) => match[1]);
    expect(args.slice(0, 2)).toEqual(["shell", "--no-write-lock-file"]);
    const packages = args.slice(2, 5);
    expect(packages.map((pkg) => pkg.split("#")[1])).toEqual(["git", "nodejs_24", "bashInteractive"]);
    const refs = packages.map((pkg) => pkg.split("#")[0]);
    expect(new Set(refs).size).toBe(1);
    expect(refs[0]).toMatch(/^github:NixOS\/nixpkgs\/[a-f0-9]{40}$/);
    expect(args.slice(5)).toEqual(["--command", "bash", "--noprofile", "--norc", "-i"]);
    expect(output).toContain("keep-going = true\nextra-experimental-features = nix-command flakes");
    expect(output).toContain("PARENT_NIX_CONFIG:keep-going = true");
    expect(output).toContain("BOOTSTRAP_EXIT:0");
    expect(output).toContain("NIX_CWD:");
  });

  it("shows help without probing the host or invoking Nix", () => {
    const output = run("winix_require_nixos() { return 9; }", "--help");
    expect(output).toContain("Usage: bash bootstrap-nixos.sh");
    expect(output).not.toContain("NIX_ARG:");
    expect(output).toContain("BOOTSTRAP_EXIT:0");
  });

  it("rejects unexpected arguments instead of running user commands", () => {
    const output = run("", "--command echo");
    expect(output).toContain("Usage:");
    expect(output).toContain("BOOTSTRAP_EXIT:2");
    expect(output).not.toContain("NIX_ARG:");
  });

  it("stops when host validation fails", () => {
    const output = run("winix_require_nixos() { echo 'Not NixOS' >&2; return 1; }");
    expect(output).toContain("Not NixOS");
    expect(output).toContain("BOOTSTRAP_EXIT:1");
    expect(output).not.toContain("NIX_ARG:");
  });

  it("fails explicitly when Nix is missing", () => {
    const output = run('command() { if [[ "$1" == -v && "$2" == nix ]]; then return 1; fi; builtin command "$@"; }');
    expect(output).toContain("Nix is unavailable");
    expect(output).toContain("BOOTSTRAP_EXIT:1");
    expect(output).not.toContain("NIX_ARG:");
  });

  it("propagates Nix/download failures instead of claiming success", () => {
    const output = run("export MOCK_NIX_EXIT=7");
    expect(output).toContain("BOOTSTRAP_EXIT:7");
  });
});
