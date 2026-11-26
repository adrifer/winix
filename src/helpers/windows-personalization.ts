import type { WinFontSource, WinWallpaper } from "../types/windows.ts";

export function fontHttpsUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("Font source must be an absolute HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Font sources require HTTPS without credentials or fragments");
  }
  return url.href;
}

export function validateFontSources(sources: WinFontSource[]): void {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error("windows.fonts requires nonempty sources");
  for (const source of sources) {
    if (typeof source === "string") {
      if (!source.trim() || /[\0\r\n]/.test(source) || !/\.(ttf|otf)$/i.test(source) || /^https?:/i.test(source)) {
        throw new Error("Local font sources must be TTF/OTF file paths; use { url } for downloads");
      }
    } else if (source && typeof source === "object" && "url" in source) {
      fontHttpsUrl(source.url);
      if (source.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(source.sha256)) {
        throw new Error("Font sha256 must contain 64 hexadecimal characters");
      }
      if (source.files !== undefined && (!Array.isArray(source.files) || source.files.length === 0 ||
          source.files.some((file) => typeof file !== "string" ||
            (!/^\*\*\/\*\.(ttf|otf)$/i.test(file) &&
              (!/^[^:*?\\\0]+?\.(ttf|otf)$/i.test(file) || file.startsWith("/") ||
                file.split("/").some((part) => !part || part === "." || part === "..")))))) {
        throw new Error("Font files must be safe ZIP member names or **/*.ttf / **/*.otf selectors");
      }
      if (!/\.(zip|ttf|otf)$/i.test(new URL(source.url).pathname)) {
        throw new Error("Remote fonts must be a .zip, .ttf or .otf URL");
      }
      if (source.files !== undefined && !/\.zip$/i.test(new URL(source.url).pathname)) {
        throw new Error("Font file selectors are only supported for ZIP sources");
      }
    } else if (source && typeof source === "object" && "provider" in source &&
        source.provider === "nerd-fonts") {
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(source.family) ||
          (source.version !== undefined && !/^v\d+\.\d+\.\d+$/.test(source.version))) {
        throw new Error("Nerd Fonts requires a catalog family ID and an optional vX.Y.Z release tag");
      }
    } else {
      throw new Error("Unsupported font source/provider");
    }
  }
}

export function validateWallpaper(wallpaper: WinWallpaper): void {
  if (!wallpaper || typeof wallpaper !== "object") throw new Error("windows.wallpaper requires an object");
  const source = wallpaper.source;
  if (typeof source === "string") {
    if (!source.trim() || /[\0\r\n]/.test(source) || /^https?:/i.test(source)) {
      throw new Error("Wallpaper requires a local image path");
    }
  } else if (!source || source.kind !== "knownFolder" ||
      !["documents", "desktop", "localAppData", "appData", "userProfile", "programFiles", "programFilesX86"].includes(source.folder) ||
      typeof source.path !== "string" || /[\0\r\n]/.test(source.path) ||
      /^[\\/]|^[a-z]:/i.test(source.path) || source.path.split(/[\\/]/).includes("..")) {
    throw new Error("Wallpaper requires a valid known-folder or local image path");
  }
  if (wallpaper.style !== undefined &&
      !["Fill", "Fit", "Stretch", "Tile", "Center", "Span"].includes(wallpaper.style)) {
    throw new Error("Unsupported wallpaper style");
  }
}
