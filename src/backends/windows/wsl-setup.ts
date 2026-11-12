import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import type { WinWslSetup } from "../../types/index.ts";
import { normalizeWslSetup } from "../../helpers/windows.ts";
import { powerShellLiteral as ps } from "../../helpers/utils.ts";

export interface WindowsLockWslRepository {
  repository: string;
  ref: string;
  revision: string;
  resolvedAt: string;
}
export type WindowsWslRepositoryResolver = (repository: string, ref: string) => string;

export function wslRepositoryKey(setup: WinWslSetup): string {
  return createHash("sha256").update(JSON.stringify([setup.repository, setup.ref ?? "HEAD"])).digest("hex");
}

export function validWslRepository(value: unknown): value is WindowsLockWslRepository {
  if (!value || typeof value !== "object") return false;
  const pin = value as Record<string, unknown>;
  if (typeof pin.repository !== "string" || typeof pin.ref !== "string" ||
      typeof pin.revision !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pin.revision) ||
      typeof pin.resolvedAt !== "string") return false;
  try {
    normalizeWslSetup({ repository: pin.repository, ref: pin.ref, configDirectory: ".", host: "validate" });
    return true;
  } catch { return false; }
}

export const resolveWslRepository: WindowsWslRepositoryResolver = (repository, ref) => {
  normalizeWslSetup({ repository, ref, configDirectory: ".", host: "validate" });
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ref)) return ref;
  const refsToLookup = ref.startsWith("refs/") ? [ref, `${ref}^{}`] :
    ref === "HEAD" ? ["HEAD"] : [`refs/heads/${ref}`, `refs/tags/${ref}`, `refs/tags/${ref}^{}`];
  const output = execFileSync("git", [
    "ls-remote", "--exit-code", "--", repository, ...refsToLookup,
  ], {
    encoding: "utf8", timeout: 45000, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
  });
  const refs = new Map<string, string>();
  for (const line of output.trim().split(/\r?\n/)) {
    const [sha, name] = line.split(/\s+/);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha) || !name) throw new Error("Invalid Git revision lookup output");
    refs.set(name, sha);
  }
  for (const [name, sha] of [...refs]) if (name.endsWith("^{}")) { refs.delete(name); refs.set(name.slice(0, -3), sha); }
  const revisions = new Set(refs.values());
  if (revisions.size !== 1) throw new Error(`Ambiguous Git ref "${ref}"; use a full ref or immutable commit`);
  return [...revisions][0];
};

export function wslSetupPrelude(setup: WinWslSetup, pin: WindowsLockWslRepository): string[] {
  setup = normalizeWslSetup(setup);
  if (!validWslRepository(pin) || pin.repository !== setup.repository || pin.ref !== setup.ref) {
    throw new Error("Missing/mismatched WSL repository pin. Run winix update --windows wsl-setup.");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify(setup)).digest("hex");
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  const source = readFileSync(new URL(`./wsl-setup-runtime.${extension}`, import.meta.url), "utf8");
  const runtime = extension === "ts" ? stripTypeScriptTypes(source, { mode: "transform" }) : source;
  const encodedRuntime = Buffer.from(runtime).toString("base64");
  const request = Buffer.from(JSON.stringify({ setup, revision: pin.revision, fingerprint })).toString("base64");
  const probe = [
    "set -euo pipefail",
    "state=/var/lib/winix/wsl-setup",
    "[[ ! -L \"$state\" && ! -L \"$state/complete\" ]] || { echo 'Unsafe WSL setup completion record' >&2; exit 2; }",
    "if [[ ! -f \"$state/complete\" ]]; then exit 3; fi",
    "mapfile -t completed < \"$state/complete\"",
    `[[ "\${completed[0]:-}" == '${fingerprint}' ]] || { echo 'WSL setup settings changed; existing setup is never overwritten automatically' >&2; exit 2; }`,
    "[[ ${#completed[@]} == 3 ]] || { echo 'Invalid WSL setup completion record' >&2; exit 2; }",
    "getent passwd \"${completed[1]}\" >/dev/null || { echo 'WSL setup user is missing' >&2; exit 2; }",
    "[[ -d \"${completed[2]}/.git\" ]] || { echo 'WSL setup checkout is missing' >&2; exit 2; }",
    "awk -v expected=\"${completed[1]}\" ' /^[ \\t]*\\[/ { user = ($0 ~ /^[ \\t]*\\[user\\][ \\t]*$/) } user && $0 ~ \"^[ \\t]*default[ \\t]*=[ \\t]*\" expected \"[ \\t]*$\" { found=1 } END { exit !found }' /etc/wsl.conf || { echo 'WSL default user no longer matches setup' >&2; exit 2; }",
  ].join("\n");
  const activate = [
    probe.replace("if [[ ! -f \"$state/complete\" ]]; then exit 3; fi", "if [[ -f \"$state/complete\" ]]; then") + "\nexit 0\nfi",
    `export WINIX_WSL_SETUP_REQUEST='${request}'`,
    `export WINIX_WSL_SETUP_RUNTIME='${encodedRuntime}'`,
    'export NIX_CONFIG="${NIX_CONFIG:+$NIX_CONFIG$\'\\n\'}extra-experimental-features = nix-command flakes"',
    "exec nix shell --no-write-lock-file github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f#git github:NixOS/nixpkgs/0bb2eedc20e4739f29e8045034f2828ad7054f8f#nodejs_24 --command node --input-type=module --eval \"$(printf '%s' \"$WINIX_WSL_SETUP_RUNTIME\" | base64 --decode)\"",
  ].join("\n");
  return [
    "function Invoke-WinixWslSetup([bool]$TestOnly) {",
    `  $script = if ($TestOnly) { ${ps(probe + "\n")} } else { ${ps(activate + "\n")} }`,
    "  $start = [Diagnostics.ProcessStartInfo]::new('wsl.exe')",
    "  $start.UseShellExecute = $false",
    "  $start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true",
    "  $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)",
    "  $start.StandardOutputEncoding = $start.StandardInputEncoding; $start.StandardErrorEncoding = $start.StandardInputEncoding",
    "  foreach ($argument in @('--distribution', $name, '--user', 'root', '--exec', 'bash', '-s')) { $start.ArgumentList.Add($argument) }",
    "  $process = [Diagnostics.Process]::new(); $process.StartInfo = $start",
    "  try {",
    "    if (-not $process.Start()) { throw 'Could not start WSL setup' }",
    "    $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()",
    "    $process.StandardInput.Write($script); $process.StandardInput.Close()",
    "    $process.WaitForExit()",
    "    $output = $stdout.GetAwaiter().GetResult(); $errors = $stderr.GetAwaiter().GetResult()",
    "    if ($TestOnly -and $process.ExitCode -eq 3) { return $false }",
    "    if ($process.ExitCode -ne 0) { throw \"WSL setup failed ($($process.ExitCode)): $output $errors\" }",
    "    if (-not $TestOnly) { if ($output) { Write-Host $output }; if ($errors) { Write-Host $errors } }",
    "    return $true",
    "  } finally { $process.Dispose() }",
    "}",
  ];
}
