import type { Fragment, NixExpr } from "../core/types.ts";
import { escapeNixDoubleQuoted, nixStringLiteral } from "../nix/serialize.ts";

type NixValue = unknown;
type NixCondition = boolean | string | NixExpr;
type NixStringPart = string | NixExpr;

export interface NixNamespace {
  expr(expr: string): NixExpr;
  pkg: PkgHelper;
  bin(packageName: string, executable: string): NixExpr;
  /**
   * Build a safely quoted path below `config.home.homeDirectory`.
   * Leading `/` characters are ignored; other characters are preserved.
   */
  homePath(relativePath: string): NixExpr;
  /**
   * Build a safely quoted path below `pkgs.<packageName>`.
   * Leading `/` characters are ignored; other characters are preserved.
   */
  pkgPath(packageName: string, relativePath: string): NixExpr;
  str(strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
  script: ScriptHelper;
  concat(...parts: NixStringPart[]): NixExpr;
  withPkgs(packages: string[]): NixExpr;
  optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr;
  optionalString(condition: NixCondition, value: NixStringPart): NixExpr;
  isDarwin: NixExpr;
  isLinux: NixExpr;
  /**
   * Build a `stdenvNoCC.mkDerivation` for a prebuilt single-binary CLI
   * release (the `azd`, `gh`, `kubectl`, `1password` family).
   *
   * Picks the right `(file, hash)` per `pkgs.stdenv.hostPlatform.system`,
   * substitutes `{version}`, `{file}`, and (optionally) `{platform}` into
   * `urlTemplate`, fetches with `pkgs.fetchurl`, unpacks tarballs/zips (or
   * directly installs raw executables), and `install -Dm755`s the binary
   * into `$out/bin/<binary>`.
   *
   * Optional extensions:
   * - `completions` — emits `installShellCompletion` for `bash`/`fish`/`zsh`.
   * - `linuxPatchelf` — enables `autoPatchelfHook` on Linux only.
   * - `linuxBuildInputs` — extra runtime libs the auto-patchelf hook needs.
   * - `dontStripDarwin` — keep the binary's Mach-O signature intact (default `true`).
   *
   * `meta.license` accepts a nixpkgs `pkgs.lib.licenses` attribute name
   * (e.g. `"mit"`, `"asl20"`, `"unfree"`) or a `NixExpr`. SPDX-style ids
   * like `"MIT"` or `"Apache-2.0"` are rejected at TS-eval time.
   *
   * @example
   * ```ts
   * nix.binaryRelease({
   *   name: "azure-dev-cli",
   *   version: "1.25.5",
   *   binary: "azd",
   *   urlTemplate:
   *     "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_{version}/{file}",
   *   platforms: {
   *     "x86_64-linux":  { file: "azd-linux-amd64.tar.gz",  hash: "sha256-..." },
   *     "aarch64-linux": { file: "azd-linux-arm64.tar.gz",  hash: "sha256-..." },
   *     "x86_64-darwin": { file: "azd-darwin-amd64.zip",    hash: "sha256-..." },
   *     "aarch64-darwin":{ file: "azd-darwin-arm64.zip",    hash: "sha256-..." },
   *   },
   *   meta: {
   *     description: "Azure Developer CLI",
   *     homepage: "https://github.com/Azure/azure-dev",
   *     license: "mit",
   *   },
   * });
   * ```
   *
   * @see {@link BinaryReleaseOpts} for the full options interface
   */
  binaryRelease(opts: BinaryReleaseOpts): NixExpr;
  lib: {
    mkDefault(value: NixValue): NixExpr;
    mkForce(value: NixValue): NixExpr;
    mkBefore(value: NixValue): NixExpr;
    mkAfter(value: NixValue): NixExpr;
    optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr;
    optionalString(condition: NixCondition, value: NixStringPart): NixExpr;
  };
}

/** Supported `(os, arch)` strings for `nix.binaryRelease`. */
export type BinaryReleaseArch =
  | "x86_64-linux"
  | "aarch64-linux"
  | "x86_64-darwin"
  | "aarch64-darwin";

export type BinaryReleaseFormat = "raw" | "zip" | "tar.gz" | "tgz";

export interface BinaryReleasePlatform {
  /** Filename to download (substituted into `urlTemplate`'s `{file}`). */
  file: string;
  /** SRI hash (`sha256-...`) of the downloaded file. */
  hash: string;
  /** Download format. When omitted, archive format is inferred from `file`.
   *  Raw executables must explicitly set `"raw"`. */
  format?: BinaryReleaseFormat;
  /** Optional: name of the extracted binary, if it differs from the outer `binary`. */
  binary?: string;
  /** Optional: vendor-specific platform tag substituted into `urlTemplate`'s `{platform}`
   *  (e.g. `"linux_amd64"`, `"apple_universal"`). */
  platform?: string;
}

export interface BinaryReleaseMeta {
  description: string;
  homepage?: string;
  /** nixpkgs `lib.licenses` attribute name (e.g. `"mit"`, `"asl20"`,
   *  `"unfree"`). **Not** an SPDX identifier: `"MIT"` and `"Apache-2.0"`
   *  will be rejected. Pass a `NixExpr` (e.g. `nix.expr("pkgs.lib.licenses.unfree")`)
   *  for licenses that aren't a simple attribute lookup. */
  license?: string | NixExpr;
  /** Defaults to the outer `binary`. */
  mainProgram?: string;
}

export interface BinaryReleaseCompletions {
  /** Command (or absolute path) that emits a bash completion script when run. */
  bash?: string;
  /** Command (or absolute path) that emits a fish completion script when run. */
  fish?: string;
  /** Command (or absolute path) that emits a zsh completion script when run. */
  zsh?: string;
}

export interface BinaryReleaseOpts {
  /** `pname` for the derivation. */
  name: string;
  /** `version` for the derivation. */
  version: string;
  /** Final binary name placed in `$out/bin/<binary>`. */
  binary: string;
  /** URL with `{version}`, `{file}` and optional `{platform}` placeholders.
   *  Must contain `{file}`. */
  urlTemplate: string;
  /** One entry per supported `(os, arch)`. At least one required. */
  platforms: Partial<Record<BinaryReleaseArch, BinaryReleasePlatform>>;
  /** Extra install lines appended after the main `install -Dm755`. */
  extraInstall?: string;
  /** Opt-in: add `autoPatchelfHook` to `nativeBuildInputs` on Linux. Use
   *  this for ELF binaries that link against shared libraries. Pass any
   *  required runtime libraries via `linuxBuildInputs`. */
  linuxPatchelf?: boolean;
  /** Extra `buildInputs` to expose on Linux only, typically shared libs
   *  needed by `autoPatchelfHook` (e.g. `["stdenv.cc.cc"]`). Values are
   *  emitted as raw Nix expressions under `pkgs.` unless they are already
   *  `NixExpr`. */
  linuxBuildInputs?: (string | NixExpr)[];
  /** Default `true`: emits `dontStrip = pkgs.stdenv.hostPlatform.isDarwin;`
   *  to avoid breaking signed Darwin binaries. Set `false` to opt out. */
  dontStripDarwin?: boolean;
  /** Shell completion script generation. Each entry is the command (or
   *  absolute path) that prints the completion script for that shell.
   *  Adds `installShellFiles` to `nativeBuildInputs` and runs
   *  `installShellCompletion` in `postInstall`. */
  completions?: BinaryReleaseCompletions;
  meta: BinaryReleaseMeta;
}

export interface PkgHelper {
  (name: string): NixExpr;
  stable(name: string): NixExpr;
}

export interface ScriptHelper {
  (body: string): NixExpr;
  (strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
  raw(strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
}

const expr = (value: string): NixExpr => ({ __winixNixExpr: true, expr: value });

const pkg: PkgHelper = Object.assign(
  (name: string): NixExpr => expr(`pkgs.${name}`),
  {
    stable: (name: string): NixExpr => expr(`pkgs.stable.${name}`),
  }
);

function pathUnder(base: NixExpr, relativePath: string): NixExpr {
  const normalized = relativePath.replace(/^\/+/, "");
  return normalized === "" ? nix.str`${base}` : nix.str`${base}/${normalized}`;
}

const script: ScriptHelper = Object.assign(
  (first: string | TemplateStringsArray, ...values: NixStringPart[]): NixExpr => {
    const body =
      typeof first === "string"
        ? first
        : joinTemplate(first, values, (value) =>
            isNixExpr(value) ? `\${${value.expr}}` : String(value)
          );
    return expr(`''\n${trimScript(body)}\n''`);
  },
  {
    raw: (strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr => {
      const body = joinRawTemplate(strings, values, (value) =>
        isNixExpr(value) ? `\${${value.expr}}` : String(value)
      );
      return expr(`''\n${trimScript(body)}\n''`);
    },
  }
);

function optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr {
  return expr(`(lib.optionalAttrs ${conditionToNix(condition)} { ${formatAttrs(attrs)} })`);
}

function optionalString(condition: NixCondition, value: NixStringPart): NixExpr {
  return expr(`(lib.optionalString ${conditionToNix(condition)} ${stringPartToNix(value)})`);
}

export const nix: NixNamespace = {
  expr,
  pkg,
  bin: (packageName: string, executable: string): NixExpr =>
    nix.str`${pkg(packageName)}/bin/${executable}`,
  homePath: (relativePath: string): NixExpr =>
    pathUnder(expr("config.home.homeDirectory"), relativePath),
  pkgPath: (packageName: string, relativePath: string): NixExpr =>
    pathUnder(pkg(packageName), relativePath),
  str: (strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr => {
    const parts: string[] = [];
    const rawStrings = strings.raw;

    for (let index = 0; index < rawStrings.length; index += 1) {
      parts.push(escapeNixDoubleQuoted(rawStrings[index]));
      if (index < values.length) {
        const value = values[index];
        if (isNixExpr(value)) {
          parts.push(`\${${value.expr}}`);
        } else {
          parts.push(escapeNixDoubleQuoted(String(value)));
        }
      }
    }

    return expr(`"${parts.join("")}"`);
  },
  script,
  concat: (...parts: NixStringPart[]): NixExpr =>
    expr(parts.map((part) => stringPartToNix(part)).join(" + ")),
  withPkgs: (packages: string[]): NixExpr => expr(`with pkgs; [ ${packages.join(" ")} ]`),
  optionalAttrs,
  optionalString,
  isDarwin: expr("pkgs.stdenv.isDarwin"),
  isLinux: expr("pkgs.stdenv.isLinux"),
  binaryRelease,
  lib: {
    mkDefault: (value: NixValue): NixExpr => nixLibCall("mkDefault", value),
    mkForce: (value: NixValue): NixExpr => nixLibCall("mkForce", value),
    mkBefore: (value: NixValue): NixExpr => nixLibCall("mkBefore", value),
    mkAfter: (value: NixValue): NixExpr => nixLibCall("mkAfter", value),
    optionalAttrs,
    optionalString,
  },
};

function nixLibCall(name: string, value: NixValue): NixExpr {
  return expr(`lib.${name} ${nixLiteral(value)}`);
}

const KNOWN_BINARY_RELEASE_ARCHES: BinaryReleaseArch[] = [
  "x86_64-linux",
  "aarch64-linux",
  "x86_64-darwin",
  "aarch64-darwin",
];
const KNOWN_BINARY_RELEASE_FORMATS: BinaryReleaseFormat[] = [
  "raw",
  "zip",
  "tar.gz",
  "tgz",
];

function binaryRelease(opts: BinaryReleaseOpts): NixExpr {
  if (!opts || typeof opts !== "object") {
    throw new Error("nix.binaryRelease: `opts` is required");
  }
  if (!opts.name) throw new Error("nix.binaryRelease: `name` is required");
  if (!opts.version) throw new Error("nix.binaryRelease: `version` is required");
  if (!opts.binary) throw new Error("nix.binaryRelease: `binary` is required");
  if (!opts.urlTemplate) throw new Error("nix.binaryRelease: `urlTemplate` is required");
  if (!opts.urlTemplate.includes("{file}") && !opts.urlTemplate.includes("{platform}")) {
    throw new Error(
      "nix.binaryRelease: `urlTemplate` must contain `{file}` or `{platform}`"
    );
  }
  if (!opts.meta || !opts.meta.description) {
    throw new Error("nix.binaryRelease: `meta.description` is required");
  }
  if (opts.platforms === undefined || opts.platforms === null) {
    throw new Error("nix.binaryRelease: `platforms` is required");
  }
  if (!isPlainObject(opts.platforms)) {
    throw new Error("nix.binaryRelease: `platforms` must be an object");
  }
  if (
    opts.meta.license !== undefined &&
    typeof opts.meta.license === "string" &&
    !isNixAttrName(opts.meta.license)
  ) {
    throw new Error(
      `nix.binaryRelease: \`meta.license\` string "${opts.meta.license}" is not a valid nixpkgs attribute name. ` +
        `Use a \`pkgs.lib.licenses\` attr name like "mit" or "asl20", or pass \`nix.expr("...")\` for custom expressions.`
    );
  }

  const entries = Object.entries(opts.platforms) as Array<
    [BinaryReleaseArch, BinaryReleasePlatform | undefined]
  >;
  const filtered = entries.filter(
    (entry): entry is [BinaryReleaseArch, BinaryReleasePlatform] => entry[1] !== undefined
  );
  if (filtered.length === 0) {
    throw new Error("nix.binaryRelease: at least one platform is required");
  }
  for (const [arch, platform] of filtered) {
    if (!KNOWN_BINARY_RELEASE_ARCHES.includes(arch)) {
      throw new Error(`nix.binaryRelease: unknown platform key "${arch}"`);
    }
    if (!platform.file) {
      throw new Error(`nix.binaryRelease: platforms.${arch}.file is required`);
    }
    if (!platform.hash) {
      throw new Error(`nix.binaryRelease: platforms.${arch}.hash is required`);
    }
    resolveBinaryReleaseFormat(arch, platform);
  }

  const usesPlatformPlaceholder = opts.urlTemplate.includes("{platform}");
  if (usesPlatformPlaceholder) {
    for (const [arch, platform] of filtered) {
      if (!platform.platform) {
        throw new Error(
          `nix.binaryRelease: "${arch}" must define \`platform\` because \`urlTemplate\` uses \`{platform}\``
        );
      }
    }
  }

  const sourcesAttrs = filtered
    .map(([arch, platform]) => {
      const parts = [
        `file = ${nixStringLiteral(platform.file)};`,
        `hash = ${nixStringLiteral(platform.hash)};`,
        `binary = ${nixStringLiteral(platform.binary ?? opts.binary)};`,
        `format = ${nixStringLiteral(resolveBinaryReleaseFormat(arch, platform))};`,
      ];
      if (usesPlatformPlaceholder) {
        const platformName = platform.platform;
        if (platformName === undefined) {
          throw new Error(
            `nix.binaryRelease: "${arch}" must define \`platform\` because \`urlTemplate\` uses \`{platform}\``
          );
        }
        parts.push(`platform = ${nixStringLiteral(platformName)};`);
      }
      return `    ${arch} = { ${parts.join(" ")} };`;
    })
    .join("\n");

  const urlExpr = renderUrlTemplate(opts.urlTemplate);
  const mainProgram = opts.meta.mainProgram ?? opts.binary;
  const license = opts.meta.license;
  const licenseExpr =
    license === undefined
      ? undefined
      : isNixExpr(license)
        ? license.expr
        : `pkgs.lib.licenses.${license}`;

  const metaLines: string[] = [
    `      description = ${nixStringLiteral(opts.meta.description)};`,
  ];
  if (opts.meta.homepage !== undefined) {
    metaLines.push(`      homepage    = ${nixStringLiteral(opts.meta.homepage)};`);
  }
  if (licenseExpr !== undefined) {
    metaLines.push(`      license     = ${licenseExpr};`);
  }
  metaLines.push(`      mainProgram = ${nixStringLiteral(mainProgram)};`);
  metaLines.push(`      platforms   = builtins.attrNames sources;`);

  const extraInstallBlock = opts.extraInstall
    ? `\n    ${dedent(opts.extraInstall).split("\n").join("\n    ")}`
    : "";

  const completionLines = renderCompletions(opts.completions);
  const completionsBlock = completionLines.length === 0
    ? ""
    : `\n\n  postInstall = pkgs.lib.optionalString (pkgs.stdenv.buildPlatform.canExecute pkgs.stdenv.hostPlatform) ''\n    HOME=$TMPDIR\n${completionLines.map((l) => `    ${l}`).join("\n")}\n    installShellCompletion ${shellsForInstall(opts.completions)}\n  '';`;

  const nativeInputs: string[] = [];
  if (opts.linuxPatchelf) {
    nativeInputs.push(
      "pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.autoPatchelfHook ]"
    );
  }
  if (opts.completions && Object.values(opts.completions).some(Boolean)) {
    nativeInputs.push("[ pkgs.installShellFiles ]");
  }
  // `unzip` is needed for `.zip` archives on every platform, not just
  // darwin (e.g. a Linux release that ships a single .zip). Adding it
  // unconditionally is cheap and avoids a runtime failure in `unpackPhase`.
  nativeInputs.push("[ pkgs.unzip ]");

  const nativeBuildInputsExpr =
    nativeInputs.length === 1
      ? nativeInputs[0]
      : nativeInputs.join("\n    ++ ");

  const linuxBuildInputs =
    opts.linuxBuildInputs && opts.linuxBuildInputs.length > 0
      ? `\n\n  buildInputs = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ ${opts.linuxBuildInputs.map(renderBuildInput).join(" ")} ];`
      : "";

  const dontStripDarwin = opts.dontStripDarwin !== false;
  const dontStripLine = dontStripDarwin
    ? `\n\n  dontStrip = pkgs.stdenv.hostPlatform.isDarwin;`
    : "";

  const text = `(let
  version = ${nixStringLiteral(opts.version)};
  sources = {
${sourcesAttrs}
  };
  source = sources.\${pkgs.stdenv.hostPlatform.system};
in pkgs.stdenvNoCC.mkDerivation {
  pname = ${nixStringLiteral(opts.name)};
  inherit version;

  src = pkgs.fetchurl {
    url  = ${urlExpr};
    hash = source.hash;
  };

  nativeBuildInputs = ${nativeBuildInputsExpr};${linuxBuildInputs}${dontStripLine}

  dontUnpack = source.format == "raw";

  unpackPhase = ''
    runHook preUnpack
    mkdir source
    case "\${source.format}" in
      zip)    unzip -q "$src" -d source ;;
      tar.gz) tar -xzf "$src" -C source ;;
      tgz)    tar -xzf "$src" -C source ;;
      *) echo "nix.binaryRelease: unsupported archive format \${source.format}" >&2; exit 1 ;;
    esac
    sourceRoot=source
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    installSource="$src"
    if [ "\${source.format}" != raw ]; then
      installSource="\${source.binary}"
    fi
    install -Dm755 "$installSource" "$out/bin/${opts.binary}"${extraInstallBlock}
    runHook postInstall
  '';${completionsBlock}

  meta = {
${metaLines.join("\n")}
  };
})`;

  return expr(text);
}

function resolveBinaryReleaseFormat(
  arch: BinaryReleaseArch,
  platform: BinaryReleasePlatform
): BinaryReleaseFormat {
  if (platform.format !== undefined) {
    if (!KNOWN_BINARY_RELEASE_FORMATS.includes(platform.format)) {
      throw new Error(
        `nix.binaryRelease: platforms.${arch}.format must be one of "raw", "zip", "tar.gz", or "tgz"`
      );
    }
    return platform.format;
  }

  if (platform.file.endsWith(".tar.gz")) return "tar.gz";
  if (platform.file.endsWith(".tgz")) return "tgz";
  if (platform.file.endsWith(".zip")) return "zip";

  throw new Error(
    `nix.binaryRelease: platforms.${arch}.file has an unsupported archive extension; set \`format\` explicitly`
  );
}

function renderBuildInput(value: string | NixExpr): string {
  if (isNixExpr(value)) return value.expr;
  return `pkgs.${value}`;
}

function renderCompletions(
  completions: BinaryReleaseCompletions | undefined
): string[] {
  if (!completions) return [];
  const lines: string[] = [];
  for (const shell of ["bash", "fish", "zsh"] as const) {
    const cmd = completions[shell];
    if (!cmd) continue;
    lines.push(`${cmd} > ${opts_completion_filename(shell)}`);
  }
  return lines;
}

function opts_completion_filename(shell: "bash" | "fish" | "zsh"): string {
  return `completion.${shell === "zsh" ? "zsh" : shell}`;
}

function shellsForInstall(
  completions: BinaryReleaseCompletions | undefined
): string {
  if (!completions) return "";
  const present = (["bash", "fish", "zsh"] as const).filter(
    (s) => completions[s]
  );
  return present.map((s) => opts_completion_filename(s)).join(" ");
}

function renderUrlTemplate(template: string): string {
  // Convert a {placeholder}-style template into a Nix double-quoted string
  // with antiquotations. `{version}` -> `${version}`; `{file}` -> `${source.file}`;
  // `{platform}` -> `${source.platform}`.
  // Unknown placeholders are left as literal `{key}` in the output.
  const parts: string[] = [];
  const regex = /\{(version|file|platform)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push(escapeNixDoubleQuoted(template.slice(lastIndex, match.index)));
    }
    const key = match[1];
    parts.push(
      key === "version"
        ? "${version}"
        : key === "file"
          ? "${source.file}"
          : "${source.platform}"
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < template.length) {
    parts.push(escapeNixDoubleQuoted(template.slice(lastIndex)));
  }
  return `"${parts.join("")}"`;
}

function dedent(value: string): string {
  const lines = value.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.match(/^[ \t]*/)?.[0].length ?? 0;
    if (indent < min) min = indent;
  }
  if (!Number.isFinite(min) || min === 0) return lines.join("\n");
  return lines.map((line) => (line.length >= min ? line.slice(min) : line)).join("\n");
}

function stringPartToNix(value: NixStringPart): string {
  return isNixExpr(value) ? value.expr : nixStringLiteral(value);
}

function conditionToNix(condition: NixCondition): string {
  if (isNixExpr(condition)) return condition.expr;
  if (typeof condition === "boolean") return condition ? "true" : "false";
  return condition;
}

function nixLiteral(value: NixValue): string {
  if (isNixExpr(value)) return value.expr;
  if (typeof value === "string") return nixStringLiteral(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[ ${value.map((item) => nixLiteral(item)).join(" ")} ]`;
  }
  if (isPlainObject(value)) {
    return `{ ${formatAttrs(value)} }`;
  }

  throw new Error(`Cannot convert ${typeof value} to a Nix literal`);
}

function formatAttrs(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${formatAttrKey(key)} = ${nixLiteral(value)};`)
    .join(" ");
}

function formatAttrKey(key: string): string {
  return needsQuoting(key) ? nixStringLiteral(key) : key;
}

function needsQuoting(key: string): boolean {
  if (NIX_KEYWORDS.has(key)) return true;
  return !/^[a-zA-Z_][a-zA-Z0-9_'-]*$/.test(key);
}

function joinTemplate(
  strings: TemplateStringsArray,
  values: NixStringPart[],
  formatValue: (value: NixStringPart) => string
): string {
  const parts: string[] = [];
  for (let index = 0; index < strings.length; index += 1) {
    parts.push(strings[index]);
    if (index < values.length) {
      parts.push(formatValue(values[index]));
    }
  }
  return parts.join("");
}

function joinRawTemplate(
  strings: TemplateStringsArray,
  values: NixStringPart[],
  formatValue: (value: NixStringPart) => string
): string {
  const parts: string[] = [];
  for (let index = 0; index < strings.raw.length; index += 1) {
    parts.push(strings.raw[index]);
    if (index < values.length) {
      parts.push(formatValue(values[index]));
    }
  }
  return parts.join("");
}

function trimScript(body: string): string {
  return body.replace(/^\n/, "").replace(/\n\s*$/, "");
}

function isNixExpr(value: unknown): value is NixExpr {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as NixExpr).__winixNixExpr === true &&
    typeof (value as NixExpr).expr === "string"
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A valid `pkgs.lib.licenses.<id>` attribute name. nixpkgs convention
// is lowercase-first (e.g. `mit`, `asl20`, `gpl3Only`, `unfree`). This
// deliberately rejects SPDX-style ids like `MIT` or `Apache-2.0` so the
// helper surfaces the error at TS-eval time with a clear message rather
// than producing invalid Nix or a confusing attribute lookup error.
const NIX_LICENSE_ATTR_NAME = /^[a-z][A-Za-z0-9_]*$/;
function isNixAttrName(value: string): boolean {
  return NIX_LICENSE_ATTR_NAME.test(value);
}

const NIX_KEYWORDS = new Set([
  "assert",
  "else",
  "false",
  "if",
  "in",
  "inherit",
  "let",
  "null",
  "or",
  "rec",
  "then",
  "true",
  "with",
]);
