import type {
  WinClipboardSettings,
  WinDeveloperSettings,
  WinDscProperties,
  WinDscPropertyValue,
  WinExplorerSettings,
  WinKeyboardSettings,
  WinMouseSettings,
  WinNotificationSettings,
  WinRegistryValue,
  WinRegistryValueType,
  WinSettings,
  WinStartFolder,
  WinStartSettings,
  WinSudoMode,
  WinTaskbarAlignment,
  WinTaskbarGroupingMode,
  WinTaskbarMultiMonMode,
  WinTaskbarSearchMode,
  WinTaskbarSettings,
  WinThemeSettings,
  WinTimeSettings,
} from "../types/windows.ts";

export interface PersonalizationRegistryValue {
  path: string;
  name: string;
  value: number;
}

export interface RegistryDWordEntry {
  path: string;
  name: string;
  value: number;
}

export interface InputRegistryCheck {
  path: string;
  name: string;
  value: string;
}

export type InputSpiAction =
  | { kind: "keyboardDelay"; value: number }
  | { kind: "keyboardSpeed"; value: number }
  | { kind: "mouseSpeed"; value: number }
  | { kind: "mouseAcceleration"; enabled: boolean }
  | { kind: "mouseSwapButtons"; enabled: boolean };

export interface NormalizedInput {
  checks: InputRegistryCheck[];
  actions: InputSpiAction[];
  label: string;
}

export interface NormalizedWindowsSettings {
  msSettings: WinDscProperties;
  hklmDwords: RegistryDWordEntry[];
  hklmParts: string[];
  personalizationDwords: PersonalizationRegistryValue[];
  autoHide?: boolean;
  classicContextMenu?: boolean;
  explorerStartup: [string, boolean][];
  clipboardDwords: RegistryDWordEntry[];
  clipboardParts: string[];
  inputChecks: InputRegistryCheck[];
  inputActions: InputSpiAction[];
  inputParts: string[];
}

const SUDO_MODES: Record<WinSudoMode, number> = {
  disabled: 0,
  newWindow: 1,
  disableInput: 2,
  inline: 3,
};

const TASKBAR_ALIGNMENTS: Record<WinTaskbarAlignment, string> = {
  left: "Left",
  center: "Center",
};

const TASKBAR_SEARCH_MODES: Record<WinTaskbarSearchMode, number> = {
  hidden: 0,
  icon: 1,
  box: 2,
  iconAndLabel: 3,
};

const TASKBAR_GROUPING_MODES: Record<WinTaskbarGroupingMode, string> = {
  always: "Always",
  whenFull: "WhenFull",
  never: "Never",
};

const TASKBAR_MULTIMON_MODES: Record<WinTaskbarMultiMonMode, string> = {
  duplicate: "Duplicate",
  primaryAndWindow: "PrimaryAndWindow",
  windowOnly: "WindowOnly",
};

const START_FOLDERS: Record<WinStartFolder, string> = {
  documents: "Documents",
  downloads: "Downloads",
  music: "Music",
  pictures: "Pictures",
  videos: "Videos",
  network: "Network",
  userProfile: "UserProfile",
  explorer: "Explorer",
  settings: "Settings",
};

const SETTINGS_SECTIONS = new Set([
  "theme",
  "explorer",
  "taskbar",
  "start",
  "developer",
  "clipboard",
  "time",
  "keyboard",
  "mouse",
  "notifications",
]);

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} requires an options object`);
  }
  return value as Record<string, unknown>;
}

function expectBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function collectTheme(theme: WinThemeSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(theme, "windows.settings.theme");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "colorMode": {
        const both = typeof value === "string" ? { apps: value, system: value } : value;
        if (
          !both ||
          typeof both !== "object" ||
          Array.isArray(both) ||
          Object.keys(both).length === 0 ||
          Object.keys(both).some((k) => k !== "apps" && k !== "system") ||
          Object.values(both).some((v) => v !== "light" && v !== "dark")
        ) {
          throw new Error('windows.settings.theme colorMode must be "light", "dark", or { apps?, system? }');
        }
        const personalize = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
        const modes = both as { apps?: "light" | "dark"; system?: "light" | "dark" };
        if (modes.apps) {
          out.personalizationDwords.push({ path: personalize, name: "AppsUseLightTheme", value: modes.apps === "light" ? 1 : 0 });
        }
        if (modes.system) {
          out.personalizationDwords.push({ path: personalize, name: "SystemUsesLightTheme", value: modes.system === "light" ? 1 : 0 });
        }
        count++;
        break;
      }
      case "accentColor": {
        if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) {
          throw new Error('windows.settings.theme accentColor must be "#RRGGBB"');
        }
        const rgb = value.slice(1);
        const bgr = parseInt(`${rgb.slice(4)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`, 16);
        out.personalizationDwords.push(
          { path: "Software\\Microsoft\\Windows\\DWM", name: "AccentColor", value: (0xff000000 + bgr) >>> 0 },
          { path: "Software\\Microsoft\\Windows\\DWM", name: "ColorizationColor", value: (0xff000000 + parseInt(rgb, 16)) >>> 0 },
          { path: "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent", name: "AccentColorMenu", value: (0xff000000 + bgr) >>> 0 },
          { path: "Control Panel\\Desktop", name: "AutoColorization", value: 0 },
        );
        count++;
        break;
      }
      case "autoColorization":
        out.msSettings.AutoColorization = expectBoolean(value, "windows.settings.theme autoColorization");
        count++;
        break;
      case "transparency":
        out.msSettings.EnableTransparency = expectBoolean(value, "windows.settings.theme transparency");
        count++;
        break;
      case "accentOnStartAndTaskbar":
        out.msSettings.ShowAccentColorOnStartAndTaskbar = expectBoolean(value, "windows.settings.theme accentOnStartAndTaskbar");
        count++;
        break;
      case "accentOnTitleBars":
        out.msSettings.ShowAccentColorOnTitleBarsAndWindowBorders = expectBoolean(value, "windows.settings.theme accentOnTitleBars");
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.theme option "${key}"`);
    }
  }
  if (theme.accentColor !== undefined && theme.autoColorization === true) {
    throw new Error("windows.settings.theme cannot set both accentColor and autoColorization: true");
  }
  return count;
}

function collectExplorer(explorer: WinExplorerSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(explorer, "windows.settings.explorer");
  const advanced = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "showExtensions":
        out.personalizationDwords.push({
          path: advanced,
          name: "HideFileExt",
          value: expectBoolean(value, "windows.settings.explorer showExtensions") ? 0 : 1,
        });
        count++;
        break;
      case "showHiddenFiles":
        out.personalizationDwords.push({
          path: advanced,
          name: "Hidden",
          value: expectBoolean(value, "windows.settings.explorer showHiddenFiles") ? 1 : 2,
        });
        count++;
        break;
      case "openTo":
        if (value !== "thisPC" && value !== "home") {
          throw new Error('windows.settings.explorer openTo must be "thisPC" or "home"');
        }
        out.personalizationDwords.push({ path: advanced, name: "LaunchTo", value: value === "thisPC" ? 1 : 2 });
        count++;
        break;
      case "showFullPathInTitleBar":
        out.personalizationDwords.push({
          path: "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\CabinetState",
          name: "FullPath",
          value: expectBoolean(value, "windows.settings.explorer showFullPathInTitleBar") ? 1 : 0,
        });
        count++;
        break;
      case "classicContextMenu":
        out.classicContextMenu = expectBoolean(value, "windows.settings.explorer classicContextMenu");
        count++;
        break;
      case "compactMode":
        out.personalizationDwords.push({
          path: advanced,
          name: "UseCompactMode",
          value: expectBoolean(value, "windows.settings.explorer compactMode") ? 1 : 0,
        });
        count++;
        break;
      case "startupDelay":
        out.explorerStartup.push(["StartupDelayInMSec", expectBoolean(value, "windows.settings.explorer startupDelay")]);
        count++;
        break;
      case "waitForIdle":
        out.explorerStartup.push(["WaitForIdleState", expectBoolean(value, "windows.settings.explorer waitForIdle")]);
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.explorer option "${key}"`);
    }
  }
  return count;
}

function collectTaskbar(taskbar: WinTaskbarSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(taskbar, "windows.settings.taskbar");
  const advanced = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "alignment":
        if (typeof value !== "string" || !Object.hasOwn(TASKBAR_ALIGNMENTS, value)) {
          throw new Error(`windows.settings.taskbar alignment must be one of: ${Object.keys(TASKBAR_ALIGNMENTS).join(", ")}`);
        }
        out.msSettings.TaskbarAlignment = TASKBAR_ALIGNMENTS[value as WinTaskbarAlignment];
        count++;
        break;
      case "autoHide":
        out.autoHide = expectBoolean(value, "windows.settings.taskbar autoHide");
        count++;
        break;
      case "search":
        if (typeof value !== "string" || !Object.hasOwn(TASKBAR_SEARCH_MODES, value)) {
          throw new Error(`windows.settings.taskbar search must be one of: ${Object.keys(TASKBAR_SEARCH_MODES).join(", ")}`);
        }
        out.personalizationDwords.push({
          path: "Software\\Microsoft\\Windows\\CurrentVersion\\Search",
          name: "SearchboxTaskbarMode",
          value: TASKBAR_SEARCH_MODES[value as WinTaskbarSearchMode],
        });
        count++;
        break;
      case "taskView":
        out.personalizationDwords.push({
          path: advanced,
          name: "ShowTaskViewButton",
          value: expectBoolean(value, "windows.settings.taskbar taskView") ? 1 : 0,
        });
        count++;
        break;
      case "widgets":
        out.personalizationDwords.push({
          path: advanced,
          name: "TaskbarDa",
          value: expectBoolean(value, "windows.settings.taskbar widgets") ? 1 : 0,
        });
        count++;
        break;
      case "endTask":
        out.personalizationDwords.push({
          path: `${advanced}\\TaskbarDeveloperSettings`,
          name: "TaskbarEndTask",
          value: expectBoolean(value, "windows.settings.taskbar endTask") ? 1 : 0,
        });
        count++;
        break;
      case "badges":
        out.msSettings.TaskbarBadges = expectBoolean(value, "windows.settings.taskbar badges");
        count++;
        break;
      case "grouping":
        if (typeof value !== "string" || !Object.hasOwn(TASKBAR_GROUPING_MODES, value)) {
          throw new Error(`windows.settings.taskbar grouping must be one of: ${Object.keys(TASKBAR_GROUPING_MODES).join(", ")}`);
        }
        out.msSettings.TaskbarGroupingMode = TASKBAR_GROUPING_MODES[value as WinTaskbarGroupingMode];
        count++;
        break;
      case "multiMonitor":
        out.msSettings.TaskbarMultiMon = expectBoolean(value, "windows.settings.taskbar multiMonitor");
        count++;
        break;
      case "multiMonitorMode":
        if (typeof value !== "string" || !Object.hasOwn(TASKBAR_MULTIMON_MODES, value)) {
          throw new Error(`windows.settings.taskbar multiMonitorMode must be one of: ${Object.keys(TASKBAR_MULTIMON_MODES).join(", ")}`);
        }
        out.msSettings.TaskbarMultiMonMode = TASKBAR_MULTIMON_MODES[value as WinTaskbarMultiMonMode];
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.taskbar option "${key}"`);
    }
  }
  return count;
}

function collectStart(start: WinStartSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(start, "windows.settings.start");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "folders": {
        if (!Array.isArray(value)) {
          throw new Error(`windows.settings.start folders must be an array of: ${Object.keys(START_FOLDERS).join(", ")}`);
        }
        const mapped: string[] = [];
        for (const item of value) {
          if (typeof item !== "string" || !Object.hasOwn(START_FOLDERS, item)) {
            throw new Error(
              `windows.settings.start folders contains unsupported folder "${String(item)}". Supported folders: ${Object.keys(START_FOLDERS).join(", ")}`
            );
          }
          mapped.push(START_FOLDERS[item as WinStartFolder]);
        }
        out.msSettings.StartFolders = mapped;
        count++;
        break;
      }
      case "showRecent":
        out.msSettings.ShowRecentList = expectBoolean(value, "windows.settings.start showRecent");
        count++;
        break;
      case "showRecommended":
        out.msSettings.ShowRecommendedList = expectBoolean(value, "windows.settings.start showRecommended");
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.start option "${key}"`);
    }
  }
  return count;
}

function collectDeveloper(developer: WinDeveloperSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(developer, "windows.settings.developer");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "mode":
        out.msSettings.DeveloperMode = expectBoolean(value, "windows.settings.developer mode");
        count++;
        break;
      case "sudo":
        if (typeof value !== "string" || !Object.hasOwn(SUDO_MODES, value)) {
          throw new Error(`windows.settings.developer sudo must be one of: ${Object.keys(SUDO_MODES).join(", ")}`);
        }
        out.hklmDwords.push({
          path: "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo",
          name: "Enabled",
          value: SUDO_MODES[value as WinSudoMode],
        });
        out.hklmParts.push(`sudo ${value}`);
        count++;
        break;
      case "longPaths": {
        const enabled = expectBoolean(value, "windows.settings.developer longPaths");
        out.hklmDwords.push({
          path: "SYSTEM\\CurrentControlSet\\Control\\FileSystem",
          name: "LongPathsEnabled",
          value: enabled ? 1 : 0,
        });
        out.hklmParts.push(`long paths ${enabled ? "on" : "off"}`);
        count++;
        break;
      }
      default:
        throw new Error(`Unknown windows.settings.developer option "${key}"`);
    }
  }
  return count;
}

function collectClipboard(clipboard: WinClipboardSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(clipboard, "windows.settings.clipboard");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (key === "history") {
      const enabled = expectBoolean(value, "windows.settings.clipboard history");
      out.clipboardDwords.push({
        path: "Software\\Microsoft\\Clipboard",
        name: "EnableClipboardHistory",
        value: enabled ? 1 : 0,
      });
      out.clipboardParts.push(`history ${enabled ? "on" : "off"}`);
      count++;
    } else {
      throw new Error(`Unknown windows.settings.clipboard option "${key}"`);
    }
  }
  return count;
}

function collectTime(time: WinTimeSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(time, "windows.settings.time");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "zone":
        if (typeof value !== "string" || !value.trim()) {
          throw new Error("windows.settings.time zone must be a non-empty Windows time zone ID");
        }
        out.msSettings.TimeZone = value;
        count++;
        break;
      case "automaticZone":
        out.msSettings.SetTimeZoneAutomatically = expectBoolean(value, "windows.settings.time automaticZone");
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.time option "${key}"`);
    }
  }
  return count;
}

function collectKeyboard(keyboard: WinKeyboardSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(keyboard, "windows.settings.keyboard");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "repeatDelay":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3) {
          throw new Error("windows.settings.keyboard repeatDelay must be an integer from 0 to 3");
        }
        out.inputChecks.push({ path: "Control Panel\\Keyboard", name: "KeyboardDelay", value: String(value) });
        out.inputActions.push({ kind: "keyboardDelay", value });
        out.inputParts.push(`keyboard delay ${value}`);
        count++;
        break;
      case "repeatSpeed":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 31) {
          throw new Error("windows.settings.keyboard repeatSpeed must be an integer from 0 to 31");
        }
        out.inputChecks.push({ path: "Control Panel\\Keyboard", name: "KeyboardSpeed", value: String(value) });
        out.inputActions.push({ kind: "keyboardSpeed", value });
        out.inputParts.push(`keyboard speed ${value}`);
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.keyboard option "${key}"`);
    }
  }
  return count;
}

function collectMouse(mouse: WinMouseSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(mouse, "windows.settings.mouse");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "speed":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20) {
          throw new Error("windows.settings.mouse speed must be an integer from 1 to 20");
        }
        out.inputChecks.push({ path: "Control Panel\\Mouse", name: "MouseSensitivity", value: String(value) });
        out.inputActions.push({ kind: "mouseSpeed", value });
        out.inputParts.push(`mouse speed ${value}`);
        count++;
        break;
      case "enhancePointerPrecision": {
        const enabled = expectBoolean(value, "windows.settings.mouse enhancePointerPrecision");
        out.inputChecks.push(
          { path: "Control Panel\\Mouse", name: "MouseSpeed", value: enabled ? "1" : "0" },
          { path: "Control Panel\\Mouse", name: "MouseThreshold1", value: enabled ? "6" : "0" },
          { path: "Control Panel\\Mouse", name: "MouseThreshold2", value: enabled ? "10" : "0" },
        );
        out.inputActions.push({ kind: "mouseAcceleration", enabled });
        out.inputParts.push(`pointer precision ${enabled ? "on" : "off"}`);
        count++;
        break;
      }
      case "swapButtons": {
        const enabled = expectBoolean(value, "windows.settings.mouse swapButtons");
        out.inputChecks.push({ path: "Control Panel\\Mouse", name: "SwapMouseButtons", value: enabled ? "1" : "0" });
        out.inputActions.push({ kind: "mouseSwapButtons", enabled });
        out.inputParts.push(`swap mouse buttons ${enabled ? "on" : "off"}`);
        count++;
        break;
      }
      default:
        throw new Error(`Unknown windows.settings.mouse option "${key}"`);
    }
  }
  return count;
}

function collectNotifications(notifications: WinNotificationSettings, out: NormalizedWindowsSettings): number {
  const obj = expectObject(notifications, "windows.settings.notifications");
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    switch (key) {
      case "usbErrors":
        out.msSettings.NotifyOnUsbErrors = expectBoolean(value, "windows.settings.notifications usbErrors");
        count++;
        break;
      case "weakCharger":
        out.msSettings.NotifyOnWeakCharger = expectBoolean(value, "windows.settings.notifications weakCharger");
        count++;
        break;
      default:
        throw new Error(`Unknown windows.settings.notifications option "${key}"`);
    }
  }
  return count;
}

export function normalizeWinSettings(settings: WinSettings, helper = "windows.settings"): NormalizedWindowsSettings {
  const obj = expectObject(settings, helper);
  for (const key of Object.keys(obj)) {
    if (!SETTINGS_SECTIONS.has(key)) {
      throw new Error(
        `${helper} does not support section "${key}". Supported sections: ${[...SETTINGS_SECTIONS].join(", ")}`
      );
    }
  }
  const out: NormalizedWindowsSettings = {
    msSettings: {},
    hklmDwords: [],
    hklmParts: [],
    personalizationDwords: [],
    explorerStartup: [],
    clipboardDwords: [],
    clipboardParts: [],
    inputChecks: [],
    inputActions: [],
    inputParts: [],
  };
  let total = 0;
  if (settings.theme !== undefined) total += collectTheme(settings.theme, out);
  if (settings.explorer !== undefined) total += collectExplorer(settings.explorer, out);
  if (settings.taskbar !== undefined) total += collectTaskbar(settings.taskbar, out);
  if (settings.start !== undefined) total += collectStart(settings.start, out);
  if (settings.developer !== undefined) total += collectDeveloper(settings.developer, out);
  if (settings.clipboard !== undefined) total += collectClipboard(settings.clipboard, out);
  if (settings.time !== undefined) total += collectTime(settings.time, out);
  if (settings.keyboard !== undefined) total += collectKeyboard(settings.keyboard, out);
  if (settings.mouse !== undefined) total += collectMouse(settings.mouse, out);
  if (settings.notifications !== undefined) total += collectNotifications(settings.notifications, out);

  if (total === 0) {
    throw new Error(`${helper} requires at least one setting`);
  }
  return out;
}

const REGISTRY_HIVE_PATTERN = /^(HKCU|HKLM|HKCR|HKU|HKCC|HKEY_CURRENT_USER|HKEY_LOCAL_MACHINE|HKEY_CLASSES_ROOT|HKEY_USERS|HKEY_CURRENT_CONFIG)\\(.+)$/i;
const USER_HIVES = new Set(["HKCU", "HKEY_CURRENT_USER"]);
const REGISTRY_VALUE_TYPES: readonly WinRegistryValueType[] = [
  "string",
  "expandString",
  "dword",
  "qword",
  "multiString",
  "binary",
];

export function validateRegistryKeyPath(keyPath: string, helper: string): { keyPath: string; machineHive: boolean } {
  if (typeof keyPath !== "string" || !keyPath.trim() || /[\0\r\n]/.test(keyPath)) {
    throw new Error(`${helper} requires a non-empty Windows registry keyPath`);
  }
  if (/^[a-z_]+:\\/i.test(keyPath)) {
    throw new Error(
      `${helper} keyPath "${keyPath}" uses PowerShell syntax; omit the colon (for example "HKCU\\\\Software\\\\...")`
    );
  }
  const match = REGISTRY_HIVE_PATTERN.exec(keyPath);
  if (!match || !match[2].trim()) {
    throw new Error(
      `${helper} keyPath "${keyPath}" must start with a registry hive (HKCU, HKLM, HKCR, HKU, HKCC or HKEY_*) followed by \\ and a subkey`
    );
  }
  return {
    keyPath,
    machineHive: !USER_HIVES.has(match[1].toUpperCase()),
  };
}

export function encodeRegistryValueData(
  value: WinRegistryValue,
  explicitType?: WinRegistryValueType,
): WinDscPropertyValue {
  let kind = explicitType;
  if (kind !== undefined && !REGISTRY_VALUE_TYPES.includes(kind)) {
    throw new Error(`windows.registry.set type must be one of: ${REGISTRY_VALUE_TYPES.join(", ")}`);
  }
  if (kind === undefined) {
    if (typeof value === "string") kind = "string";
    else if (typeof value === "number") kind = "dword";
    else if (Array.isArray(value)) {
      if (value.length === 0) {
        throw new Error('windows.registry.set requires opts.type ("multiString" or "binary") for an empty array');
      }
      if (value.every((item) => typeof item === "string")) kind = "multiString";
      else if (value.every((item) => typeof item === "number")) kind = "binary";
      else throw new Error("windows.registry.set array value must contain all strings or all numbers");
    } else {
      throw new Error("windows.registry.set value must be a string, number, string[], or number[]");
    }
  }

  switch (kind) {
    case "string":
      if (typeof value !== "string") throw new Error('windows.registry.set type "string" requires a string value');
      return { String: value };
    case "expandString":
      if (typeof value !== "string") throw new Error('windows.registry.set type "expandString" requires a string value');
      return { ExpandString: value };
    case "dword":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new Error('windows.registry.set type "dword" requires an integer from 0 to 4294967295');
      }
      return { DWord: value };
    case "qword":
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) {
        throw new Error('windows.registry.set type "qword" requires a non-negative safe integer');
      }
      return { QWord: value };
    case "multiString":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error('windows.registry.set type "multiString" requires an array of strings');
      }
      return { MultiString: [...value] };
    case "binary":
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255)
      ) {
        throw new Error('windows.registry.set type "binary" requires an array of bytes (integers 0 to 255)');
      }
      return { Binary: [...value] };
  }
}

export function registryResourceProperties(opts: {
  keyPath: string;
  valueName?: string;
  exists: boolean;
  valueData?: WinDscPropertyValue;
}): WinDscProperties {
  const properties: WinDscProperties = {
    keyPath: opts.keyPath,
    _exist: opts.exists,
  };
  if (opts.valueName !== undefined) {
    properties.valueName = opts.valueName;
  }
  if (opts.exists && opts.valueData !== undefined) {
    properties.valueData = opts.valueData;
  }
  return properties;
}
