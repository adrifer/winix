import type { Fragment, NixExpr } from "../core/types.ts";

type NixValue = unknown;
type NixCondition = boolean | string | NixExpr;
type NixStringPart = string | NixExpr;

export interface NixNamespace {
  expr(expr: string): NixExpr;
  pkg: PkgHelper;
  bin(packageName: string, executable: string): NixExpr;
  str(strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
  script: ScriptHelper;
  concat(...parts: NixStringPart[]): NixExpr;
  withPkgs(packages: string[]): NixExpr;
  optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr;
  optionalString(condition: NixCondition, value: NixStringPart): NixExpr;
  isDarwin: NixExpr;
  isLinux: NixExpr;
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

export interface BinaryReleasePlatform {
  /** Filename to download (substituted into `urlTemplate`'s `{file}`). */
  file: string;
  /** SRI hash (`sha256-...`) of the downloaded archive. */
  hash: string;
  /** Optional: name of the extracted binary, if it differs from the outer `binary`. */
  binary?: string;
  /** Optional: vendor-specific platform tag substituted into `urlTemplate`'s `{platform}`
   *  (e.g. `"linux_amd64"`, `"apple_universal"`). */
  platform?: string;
}

export interface BinaryReleaseMeta {
  description: string;
  homepage?: string;
  /** SPDX-style license id (e.g. `"mit"`, `"asl20"`) or a raw `NixExpr`. */
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

function binaryRelease(opts: BinaryReleaseOpts): NixExpr {
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

  const entries = Object.entries(opts.platforms) as Array<
    [BinaryReleaseArch, BinaryReleasePlatform | undefined]
  >;
  const filtered = entries.filter(
    (entry): entry is [BinaryReleaseArch, BinaryReleasePlatform] => entry[1] !== undefined
  );
  if (filtered.length === 0) {
    throw new Error("nix.binaryRelease: at least one platform is required");
  }
  for (const [arch] of filtered) {
    if (!KNOWN_BINARY_RELEASE_ARCHES.includes(arch)) {
      throw new Error(`nix.binaryRelease: unknown platform key "${arch}"`);
    }
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
        `file = ${JSON.stringify(platform.file)};`,
        `hash = ${JSON.stringify(platform.hash)};`,
        `binary = ${JSON.stringify(platform.binary ?? opts.binary)};`,
      ];
      if (usesPlatformPlaceholder) {
        parts.push(`platform = ${JSON.stringify(platform.platform)};`);
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
    `      description = ${JSON.stringify(opts.meta.description)};`,
  ];
  if (opts.meta.homepage !== undefined) {
    metaLines.push(`      homepage    = ${JSON.stringify(opts.meta.homepage)};`);
  }
  if (licenseExpr !== undefined) {
    metaLines.push(`      license     = ${licenseExpr};`);
  }
  metaLines.push(`      mainProgram = ${JSON.stringify(mainProgram)};`);
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
  nativeInputs.push(
    "pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin [ pkgs.unzip ]"
  );

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
  version = ${JSON.stringify(opts.version)};
  sources = {
${sourcesAttrs}
  };
  source = sources.\${pkgs.stdenv.hostPlatform.system};
in pkgs.stdenvNoCC.mkDerivation {
  pname = ${JSON.stringify(opts.name)};
  inherit version;

  src = pkgs.fetchurl {
    url  = ${urlExpr};
    hash = source.hash;
  };

  nativeBuildInputs = ${nativeBuildInputsExpr};${linuxBuildInputs}${dontStripLine}

  unpackPhase = ''
    runHook preUnpack
    mkdir source
    case "$src" in
      *.zip)    unzip -q "$src" -d source ;;
      *.tar.gz) tar -xzf "$src" -C source ;;
      *.tgz)    tar -xzf "$src" -C source ;;
    esac
    sourceRoot=source
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 "\${source.binary}" "$out/bin/${opts.binary}"${extraInstallBlock}
    runHook postInstall
  '';${completionsBlock}

  meta = {
${metaLines.join("\n")}
  };
})`;

  return expr(text);
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
  return isNixExpr(value) ? value.expr : JSON.stringify(value);
}

function conditionToNix(condition: NixCondition): string {
  if (isNixExpr(condition)) return condition.expr;
  if (typeof condition === "boolean") return condition ? "true" : "false";
  return condition;
}

function nixLiteral(value: NixValue): string {
  if (isNixExpr(value)) return value.expr;
  if (typeof value === "string") return JSON.stringify(value);
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
  return needsQuoting(key) ? JSON.stringify(key) : key;
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

function escapeNixDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, "\\${");
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
