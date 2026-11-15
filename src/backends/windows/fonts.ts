import { createHash } from "node:crypto";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import type { WinFontSource, WindowsOptions, WinDscProperties } from "../../types/windows.ts";
import type { WindowsLock } from "./lockfile.ts";
import { fontHttpsUrl, validateFontSources } from "../../helpers/windows-personalization.ts";
import { resolveWindowsSource } from "../../helpers/windows.ts";
import { powerShellLiteral as quote } from "../../helpers/utils.ts";
import { windowsSourcePath } from "./paths.ts";
import { fontInstallPrelude } from "./fonts-runtime.ts";

export interface WindowsFontPin {
  url: string;
  sha256: string;
  format: "zip" | "ttf" | "otf";
  version?: string;
  resolvedAt: string;
}

export type RemoteFontSource = Exclude<WinFontSource, string>;
export type WindowsFontResolver = (source: RemoteFontSource) => Promise<WindowsFontPin>;
const maxDownloadBytes = 128 * 1024 * 1024;

export function fontSourceKey(source: RemoteFontSource): string {
  validateFontSources([source]);
  const identity = "provider" in source
    ? { provider: source.provider, family: source.family, version: source.version ?? null }
    : { url: fontHttpsUrl(source.url), sha256: source.sha256?.toLowerCase() ?? null, files: source.files ?? null };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function validFontPin(value: unknown): value is WindowsFontPin {
  if (!value || typeof value !== "object") return false;
  const pin = value as Record<string, unknown>;
  if (typeof pin.url !== "string" || typeof pin.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(pin.sha256) || !["zip", "ttf", "otf"].includes(String(pin.format)) ||
      typeof pin.resolvedAt !== "string" ||
      (pin.version !== undefined && (typeof pin.version !== "string" || !/^v\d+\.\d+\.\d+$/.test(pin.version)))) return false;
  try { return fontHttpsUrl(pin.url) === pin.url; } catch { return false; }
}

export function fontPinMatches(source: RemoteFontSource, pin: WindowsFontPin): boolean {
  if (!validFontPin(pin)) return false;
  if ("url" in source) return pin.url === fontHttpsUrl(source.url) &&
    pin.format === new URL(source.url).pathname.split(".").at(-1)?.toLowerCase() &&
    (source.sha256 === undefined || source.sha256.toLowerCase() === pin.sha256);
  return pin.format === "zip" && pin.version !== undefined &&
    (source.version === undefined || source.version === pin.version) &&
    pin.url === `https://github.com/ryanoasis/nerd-fonts/releases/download/${pin.version}/${source.family}.zip`;
}

export async function fontFetch(url: string): Promise<Response> {
  let current = fontHttpsUrl(url);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(current, {
      redirect: "manual", signal: AbortSignal.timeout(60000),
      headers: { "User-Agent": "Winix-font-resolver", Accept: "application/json, application/octet-stream" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Font download redirect has no Location");
      current = fontHttpsUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Font request failed (${response.status}) for ${current}`);
    }
    return response;
  }
  throw new Error("Too many font download redirects");
}

async function fontResponseBytes(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty font response");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("Font response exceeds the size limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export interface NerdFontsCatalog {
  version: string;
  fonts: { family: string; url: string; sha256?: string }[];
}

export async function nerdFontsCatalog(version?: string): Promise<NerdFontsCatalog> {
  if (version !== undefined && !/^v\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid Nerd Fonts release tag");
  const response = await fontFetch(`https://api.github.com/repos/ryanoasis/nerd-fonts/releases/${version ? `tags/${version}` : "latest"}`);
  const data: unknown = JSON.parse((await fontResponseBytes(response, 4 * 1024 * 1024)).toString("utf8"));
  if (!data || typeof data !== "object") throw new Error("Invalid Nerd Fonts release metadata");
  const release = data as Record<string, unknown>;
  if (typeof release.tag_name !== "string" || !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
      !Array.isArray(release.assets) || release.draft || release.prerelease ||
      (version !== undefined && release.tag_name !== version)) throw new Error("Invalid Nerd Fonts release");
  const fonts: NerdFontsCatalog["fonts"] = [];
  for (const asset of release.assets) {
    if (!asset || typeof asset !== "object" || typeof asset.name !== "string" ||
        !/^[a-z0-9][a-z0-9_-]*\.zip$/i.test(asset.name)) continue;
    const family = asset.name.slice(0, -4);
    const url = `https://github.com/ryanoasis/nerd-fonts/releases/download/${release.tag_name}/${asset.name}`;
    if (asset.browser_download_url !== url) throw new Error(`Unexpected Nerd Fonts download URL for ${family}`);
    if (fonts.some((font) => font.family === family)) throw new Error(`Duplicate Nerd Fonts asset ${family}`);
    fonts.push({ family, url, ...(typeof asset.digest === "string" && /^sha256:[a-f0-9]{64}$/.test(asset.digest)
      ? { sha256: asset.digest.slice(7) } : {}) });
  }
  if (!fonts.length) throw new Error("Nerd Fonts release has no font ZIP assets");
  return { version: release.tag_name, fonts: fonts.sort((a, b) => a.family.localeCompare(b.family)) };
}

export const resolveFontSource: WindowsFontResolver = async (source) => {
  validateFontSources([source]);
  let url: string;
  let sha256: string | undefined;
  let version: string | undefined;
  let format: WindowsFontPin["format"];
  if ("provider" in source) {
    const catalog = await nerdFontsCatalog(source.version);
    const font = catalog.fonts.find((entry) => entry.family === source.family);
    if (!font) throw new Error(`Nerd Fonts ID "${source.family}" does not exist in ${catalog.version}. Run winix fonts search --provider nerd-fonts.`);
    ({ url, sha256 } = font);
    version = catalog.version;
    format = "zip";
  } else {
    url = fontHttpsUrl(source.url);
    sha256 = source.sha256?.toLowerCase();
    const extension = new URL(url).pathname.split(".").at(-1)?.toLowerCase();
    if (extension !== "zip" && extension !== "ttf" && extension !== "otf") throw new Error("Invalid font format");
    format = extension;
  }
  if (!sha256) {
    const bytes = await fontResponseBytes(await fontFetch(url), maxDownloadBytes);
    sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  return { url, sha256, format, ...(version ? { version } : {}), resolvedAt: new Date().toISOString() };
};

export function collectFontSources(hosts: EvaluatedHost[]): Map<string, RemoteFontSource> {
  const sources = new Map<string, RemoteFontSource>();
  for (const host of hosts) for (const resource of (host.windows as WindowsOptions).dsc ?? []) {
    if (resource.winix?.kind !== "fonts") continue;
    validateFontSources(resource.winix.sources);
    for (const source of resource.winix.sources) if (typeof source !== "string") sources.set(fontSourceKey(source), source);
  }
  return sources;
}

export async function resolveWindowsFonts(
  lock: WindowsLock, sources: Iterable<RemoteFontSource>, resolver = resolveFontSource,
  now = new Date(), missingOnly = false
): Promise<{ lock: WindowsLock; changed: boolean }> {
  const fonts = { ...lock.fonts };
  let changed = false;
  for (const source of sources) {
    const key = fontSourceKey(source);
    if (fonts[key] && !fontPinMatches(source, fonts[key])) throw new Error(`Font lock does not match declaration ${key}`);
    if (missingOnly && fonts[key]) continue;
    const pin = { ...await resolver(source), resolvedAt: now.toISOString() };
    if (!fontPinMatches(source, pin)) throw new Error("Invalid font resolution");
    const previous = fonts[key];
    if (previous && previous.url === pin.url && previous.sha256 === pin.sha256 && previous.version === pin.version) continue;
    fonts[key] = pin;
    changed = true;
  }
  return { lock: changed ? { ...lock, fonts, generatedAt: now.toISOString() } : lock, changed };
}

export function fontsProperties(sources: WinFontSource[], lock: WindowsLock, configDir?: string): WinDscProperties {
  validateFontSources(sources);
  const plan = sources.map((source) => {
    if (typeof source === "string") return { path: resolveWindowsSource(source, configDir, windowsSourcePath) };
    const pin = lock.fonts?.[fontSourceKey(source)];
    if (!pin || !fontPinMatches(source, pin)) throw new Error("Font source has no matching pin; run winix update --windows fonts");
    return { ...pin, files: "url" in source ? source.files ?? ["**/*.ttf", "**/*.otf"] : ["**/*.ttf", "**/*.otf"] };
  });
  const identity = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  const prelude = `$ErrorActionPreference = 'Stop'
$plan = @(ConvertFrom-Json ${quote(JSON.stringify(plan))})
$manifest = Join-Path $env:LOCALAPPDATA 'Winix\\fonts\\${identity}.json'
${fontInstallPrelude}`;
  return {
    getScript: `${prelude}\n@{ InDesiredState = (Test-WinixFonts) }`,
    testScript: `${prelude}\nTest-WinixFonts`,
    setScript: `${prelude}\nif (-not (Test-WinixFonts)) { Install-WinixFonts }\nif (-not (Test-WinixFonts)) { throw 'Font installation verification failed' }`,
  };
}
