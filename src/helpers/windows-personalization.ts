import type { WinFontSource, WinPersonalization, WinWallpaper } from "../types/windows.ts";

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

export interface PersonalizationRegistryValue {
  path: string;
  name: string;
  value: number;
}

export function personalizationValues(options: WinPersonalization): PersonalizationRegistryValue[] {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("windows.personalization requires an object");
  }
  const values: PersonalizationRegistryValue[] = [];
  const advanced = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
  const add = (path: string, name: string, value: number) => values.push({ path, name, value });
  for (const key of Object.keys(options)) {
    if (!["colorMode", "accentColor", "explorer", "taskbar"].includes(key)) throw new Error(`Unknown personalization option ${key}`);
  }
  if (options.colorMode !== undefined) {
    const mode = options.colorMode;
    const both = typeof mode === "string" ? { apps: mode, system: mode } : mode;
    if (!both || typeof both !== "object" || Array.isArray(both) ||
        Object.keys(both).some((key) => key !== "apps" && key !== "system") ||
        Object.values(both).some((value) => value !== "Light" && value !== "Dark") ||
        Object.keys(both).length === 0) {
      throw new Error('colorMode must be "Light", "Dark", or { apps?, system? } with those values');
    }
    const personalize = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
    if (both.apps) add(personalize, "AppsUseLightTheme", both.apps === "Light" ? 1 : 0);
    if (both.system) add(personalize, "SystemUsesLightTheme", both.system === "Light" ? 1 : 0);
  }
  if (options.accentColor !== undefined) {
    if (!/^#[a-f0-9]{6}$/i.test(options.accentColor)) throw new Error("accentColor must be #RRGGBB");
    const rgb = options.accentColor.slice(1);
    const bgr = parseInt(`${rgb.slice(4)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`, 16);
    add("Software\\Microsoft\\Windows\\DWM", "AccentColor", (0xff000000 + bgr) >>> 0);
    add("Software\\Microsoft\\Windows\\DWM", "ColorizationColor", (0xff000000 + parseInt(rgb, 16)) >>> 0);
    add("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent", "AccentColorMenu", (0xff000000 + bgr) >>> 0);
    add("Control Panel\\Desktop", "AutoColorization", 0);
  }
  if (options.explorer !== undefined) {
    if (!options.explorer || typeof options.explorer !== "object" || Array.isArray(options.explorer)) {
      throw new Error("explorer personalization must be an object");
    }
    for (const [key, value] of Object.entries(options.explorer)) {
      if (key === "openTo") {
        if (value !== "ThisPC" && value !== "Home") throw new Error("explorer.openTo must be ThisPC or Home");
        add(advanced, "LaunchTo", value === "ThisPC" ? 1 : 2);
      } else {
        if (!["showExtensions", "showHiddenFiles"].includes(key) || typeof value !== "boolean") {
          throw new Error(`Invalid explorer personalization ${key}`);
        }
        add(advanced, key === "showExtensions" ? "HideFileExt" : "Hidden",
          key === "showExtensions" ? (value ? 0 : 1) : (value ? 1 : 2));
      }
    }
  }
  if (options.taskbar !== undefined) {
    if (!options.taskbar || typeof options.taskbar !== "object" || Array.isArray(options.taskbar)) {
      throw new Error("taskbar personalization must be an object");
    }
    for (const [key, value] of Object.entries(options.taskbar)) {
      if (key === "autoHide") {
        if (typeof value !== "boolean") throw new Error("taskbar.autoHide must be boolean");
        continue;
      }
      if (key === "search") {
        const modes = ["Hidden", "Icon", "Box", "IconAndLabel"];
        if (typeof value !== "string" || !modes.includes(value)) throw new Error("Invalid taskbar.search mode");
        add("Software\\Microsoft\\Windows\\CurrentVersion\\Search", "SearchboxTaskbarMode", modes.indexOf(value));
      } else {
        if (!["taskView", "widgets"].includes(key) || typeof value !== "boolean") {
          throw new Error(`Invalid taskbar personalization ${key}`);
        }
        add(advanced, key === "taskView" ? "ShowTaskViewButton" : "TaskbarDa", value ? 1 : 0);
      }
    }
  }
  if (!values.length && options.taskbar?.autoHide === undefined) throw new Error("windows.personalization requires at least one setting");
  return values;
}
