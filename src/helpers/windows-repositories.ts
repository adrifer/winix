import type { WinPowerShellModule, WinPowerShellRepositoryPolicy, WindowsOptions } from "../types/windows.ts";

export interface ResolvedPowerShellModule extends WinPowerShellModule {
  repository: string;
  repositoryUri?: string;
}

export const powerShellModuleVersion = /^\d+\.\d+\.\d+(?:\.\d+)?(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/i;

export function windowsSettingsModule(win: WindowsOptions): ResolvedPowerShellModule {
  return resolvePowerShellModule(win, { name: "Microsoft.Windows.Settings", prerelease: true });
}

export const powerShellRepositoryName = /^[a-z0-9][a-z0-9._-]*$/i;

export function powerShellRepositoryUri(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("PowerShell repository URI must be an HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("PowerShell repository URI must be HTTPS without credentials, query, or fragment");
  }
  return url.href.replace(/\/+$/, "");
}

export function validatePowerShellRepositoryPolicy(policy: WinPowerShellRepositoryPolicy): void {
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      !policy.repositories || typeof policy.repositories !== "object" || Array.isArray(policy.repositories) ||
      typeof policy.default !== "string" || !powerShellRepositoryName.test(policy.default)) {
    throw new Error("PowerShell repository policy requires repositories and a default repository name");
  }
  const names = new Set(["psgallery"]);
  for (const [name, feed] of Object.entries(policy.repositories)) {
    if (!powerShellRepositoryName.test(name) || names.has(name.toLowerCase())) {
      throw new Error(`Duplicate or reserved PowerShell repository name: ${name}`);
    }
    if (!feed || typeof feed.uri !== "string") throw new Error(`PowerShell repository "${name}" requires a URI`);
    powerShellRepositoryUri(feed.uri);
    names.add(name.toLowerCase());
  }
  if (!names.has(policy.default.toLowerCase())) {
    throw new Error(`Default PowerShell repository "${policy.default}" is not declared`);
  }
  if (policy.allowed !== undefined &&
      (!Array.isArray(policy.allowed) || policy.allowed.length === 0 ||
       policy.allowed.some((name) => typeof name !== "string" || !names.has(name.toLowerCase())))) {
    throw new Error("PowerShell allowed repositories must be a nonempty list of declared names or PSGallery");
  }
  if (policy.allowed && !policy.allowed.some((name) => name.toLowerCase() === policy.default.toLowerCase())) {
    throw new Error("Default PowerShell repository must be allowed");
  }
}

export function powerShellRepositoryPolicyIdentity(policy: WinPowerShellRepositoryPolicy): string {
  validatePowerShellRepositoryPolicy(policy);
  return JSON.stringify({
    repositories: Object.entries(policy.repositories)
      .map(([name, feed]) => [name.toLowerCase(), powerShellRepositoryUri(feed.uri)])
      .sort(([left], [right]) => left.localeCompare(right)),
    default: policy.default.toLowerCase(),
    allowed: policy.allowed ? [...new Set(policy.allowed.map((name) => name.toLowerCase()))].sort() : null,
  });
}

export function resolvePowerShellModule(win: WindowsOptions, module: WinPowerShellModule): ResolvedPowerShellModule {
  const policy = win.powershell?.repositories;
  if (policy) validatePowerShellRepositoryPolicy(policy);
  const requested = module.repository ?? policy?.default ?? "PSGallery";
  if (policy?.allowed && !policy.allowed.some((name) => name.toLowerCase() === requested.toLowerCase())) {
    throw new Error(`PowerShell module "${module.name}" requests disallowed repository "${requested}"`);
  }
  const entry = Object.entries(policy?.repositories ?? {}).find(([name]) => name.toLowerCase() === requested.toLowerCase());
  return {
    ...module,
    repository: entry?.[0] ?? requested,
    ...(entry ? { repositoryUri: powerShellRepositoryUri(entry[1].uri) } : {}),
  };
}

export function validateWindowsPowerShellPolicy(win: WindowsOptions): void {
  if (win.powershell?.repositories) validatePowerShellRepositoryPolicy(win.powershell.repositories);
  for (const resource of win.dsc ?? []) {
    if (resource.winix?.kind === "powershell-module") resolvePowerShellModule(win, resource.winix.module);
    if (resource.winix?.kind === "setting") resolvePowerShellModule(win, { name: "Microsoft.Windows.Settings" });
  }
}
