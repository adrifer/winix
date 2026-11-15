import type { WinNpmRegistryPolicy } from "../types/windows.ts";

export function npmRegistryUri(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("npm registry URI must be an HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      /[\0\r\n]/.test(value)) {
    throw new Error("npm registry URI must be HTTPS without credentials, query or fragment");
  }
  return url.href.replace(/\/+$/, "") + "/";
}

export function npmRegistryEntries(policy: WinNpmRegistryPolicy): Record<string, string> {
  if (!policy || typeof policy !== "object" || Array.isArray(policy) ||
      !policy.registries || typeof policy.registries !== "object" || Array.isArray(policy.registries) ||
      typeof policy.default !== "string") {
    throw new Error("npm registry policy requires registries and a default registry name");
  }
  for (const key of Object.keys(policy)) {
    if (!["registries", "default", "scopes"].includes(key)) throw new Error(`Unknown npm registry policy option: ${key}`);
  }
  const registries = new Map<string, string>();
  for (const [name, entry] of Object.entries(policy.registries)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name) || registries.has(name.toLowerCase())) {
      throw new Error(`Invalid or duplicate npm registry name: ${name}`);
    }
    if (!entry || typeof entry.uri !== "string") throw new Error(`npm registry "${name}" requires a URI`);
    registries.set(name.toLowerCase(), npmRegistryUri(entry.uri));
  }
  const resolve = (name: string): string => {
    const uri = typeof name === "string" ? registries.get(name.toLowerCase()) : undefined;
    if (!uri) throw new Error(`npm registry "${String(name)}" is not declared`);
    return uri;
  };
  const entries: Record<string, string> = { registry: resolve(policy.default) };
  if (policy.scopes !== undefined) {
    if (!policy.scopes || typeof policy.scopes !== "object" || Array.isArray(policy.scopes)) {
      throw new Error("npm registry scopes must be an object");
    }
    for (const [scope, registry] of Object.entries(policy.scopes)) {
      if (!/^@[a-z0-9][a-z0-9._-]*$/.test(scope)) throw new Error(`Invalid npm scope: ${scope}`);
      entries[`${scope}:registry`] = resolve(registry);
    }
  }
  return entries;
}
