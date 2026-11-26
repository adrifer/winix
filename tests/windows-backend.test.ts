import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import {
  host,
  workspace,
  defineInputs,
  feature,
  evaluate,
  platforms,
  windows,
  generateWindows,
  isWindowsHost,
} from "../src/index.ts";
import {
  readWindowsLock,
  reconcileInlinePins,
  writeWindowsLock,
  type WindowsLock,
} from "../src/backends/windows/lockfile.ts";
import type { WindowsOptions } from "../src/types/windows.ts";
import { WINIX_FILE_MODULE } from "../src/helpers/windows.ts";
import type { WindowsOutput, WindowsResourceSummary } from "../src/backends/windows/index.ts";

function named(out: WindowsOutput, name: string, hostName = "desktop"): WindowsResourceSummary {
  const resource = out.resources[hostName]?.find((candidate) => candidate.name === name);
  if (!resource) throw new Error(`no resource named ${name} in ${hostName}: ${(out.resources[hostName] ?? []).map((r) => r.name).join(", ")}`);
  return resource;
}

const inputs = defineInputs({
  nixpkgs: "github:NixOS/nixpkgs/nixos-unstable",
});

describe("windows.package() helper", () => {
  it("normalizes a bare id string to a winget package", () => {
    const frag = windows.package("Git.Git");
    expect(frag).toEqual({
      windows: { packages: { "Git.Git": { id: "Git.Git", source: "winget" } } },
    });
  });

  it("accepts an explicit source", () => {
    const frag = windows.package({ source: "msstore", id: "9NKSQGP7F2NH" });
    expect(frag.windows?.packages?.["9NKSQGP7F2NH"]).toEqual({
      id: "9NKSQGP7F2NH",
      source: "msstore",
    });
  });

  it("carries an inline version pin", () => {
    const frag = windows.package({ id: "Git.Git", version: "2.44.0" });
    expect(frag.windows?.packages?.["Git.Git"]).toEqual({
      id: "Git.Git",
      source: "winget",
      version: "2.44.0",
    });
  });

  it("carries an elevated flag when requested", () => {
    const frag = windows.package({ id: "Some.Driver", elevated: true });
    expect(frag.windows?.packages?.["Some.Driver"]).toEqual({
      id: "Some.Driver",
      source: "winget",
      elevated: true,
    });
  });

  it("rejects empty ids", () => {
    expect(() => windows.package("")).toThrow();
    expect(() => windows.package({ id: "" })).toThrow();
  });
});

describe("windows.raw() helper", () => {
  it("normalizes a command string to a pwsh RunCommandOnSet command", () => {
    const frag = windows.raw(
      "New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.local\\bin"
    );
    expect(frag).toEqual({
      windows: {
        commands: [
          {
            executable: "pwsh",
            arguments: [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.local\\bin",
            ],
          },
        ],
      },
    });
  });

  it("accepts an explicit executable and arguments", () => {
    const frag = windows.raw({ executable: "pwsh", arguments: ["-Command", "Write-Host hi"] });
    expect(frag.windows?.commands).toEqual([
      { executable: "pwsh", arguments: ["-Command", "Write-Host hi"] },
    ]);
  });

  it("carries an explicit resource name", () => {
    const frag = windows.raw({
      name: "make-bin-dir",
      executable: "cmd",
      arguments: ["/c", "mkdir", "foo"],
    });
    expect(frag.windows?.commands).toEqual([
      {
        name: "make-bin-dir",
        executable: "cmd",
        arguments: ["/c", "mkdir", "foo"],
      },
    ]);
  });

  it("rejects empty commands", () => {
    expect(() => windows.raw("")).toThrow();
    expect(() => windows.raw({ executable: "" })).toThrow();
  });
});

describe("platforms.windows()", () => {
  it("produces a windows-scoped host with merged packages", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Git.Git"),
          windows.package("Microsoft.VisualStudioCode"),
        ]),
      ],
    });

    const [desktop] = evaluate(ws);

    expect(isWindowsHost(desktop)).toBe(true);
    // Windows host does not leak into nix/darwin scopes.
    expect(Object.keys(desktop.nixos)).toEqual([]);
    expect(Object.keys(desktop.darwin)).toEqual([]);

    const win = desktop.windows as {
      packages: Record<string, unknown>;
    };
    expect(Object.keys(win.packages).sort()).toEqual([
      "Git.Git",
      "Microsoft.VisualStudioCode",
    ]);
  });

  it("does not mark a nixos host as windows", () => {
    const ws = workspace({
      inputs,
      hosts: [host("server", platforms.nixos(), [])],
    });
    const [server] = evaluate(ws);
    expect(isWindowsHost(server)).toBe(false);
  });

  it("later version pin overrides an earlier float for the same id", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Git.Git"),
          windows.package({ id: "Git.Git", version: "2.44.0" }),
        ]),
      ],
    });
    const [desktop] = evaluate(ws);
    const win = desktop.windows as { packages: Record<string, { version?: string }> };
    expect(win.packages["Git.Git"].version).toBe("2.44.0");
  });

  it("concatenates raw commands from multiple fragments in order", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.raw({ executable: "cmd", arguments: ["/c", "echo", "first"] }),
          windows.raw({ executable: "cmd", arguments: ["/c", "echo", "second"] }),
        ]),
      ],
    });
    const [desktop] = evaluate(ws);
    const win = desktop.windows as {
      commands: Array<{ executable: string; arguments?: string[] }>;
    };

    expect(win.commands).toEqual([
      { executable: "cmd", arguments: ["/c", "echo", "first"] },
      { executable: "cmd", arguments: ["/c", "echo", "second"] },
    ]);
  });
});

describe("generateWindows() emitter", () => {
  it("skips non-windows hosts", () => {
    const ws = workspace({
      inputs,
      hosts: [host("server", platforms.nixos(), [])],
    });
    const out = generateWindows(evaluate(ws));
    expect(out.hosts).toEqual({});
  });

  it("emits a stable resources.json for a windows host", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Git.Git"),
          windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }),
          windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }),
          windows.raw("Write-Host after-packages"),
          windows.raw({ executable: "pwsh", arguments: ["-Command", "Write-Host explicit"] }),
          windows.raw({
            name: "make-bin-dir",
            executable: "cmd",
            arguments: ["/c", "mkdir", "foo"],
          }),
        ]),
      ],
    });

    const out = generateWindows(evaluate(ws), windowsLock({
      "9NKSQGP7F2NH": { source: "msstore", version: "1.0.0" },
      "Git.Git": { source: "winget", version: "2.44.0" },
      "Microsoft.VisualStudioCode": { source: "winget", version: "1.90.1" },
    }));
    expect(out.warnings).toEqual([]);
    expect(Object.keys(out.hosts)).toEqual(["desktop"]);
    expect(Object.keys(out.hosts.desktop)).toEqual(["resources.json"]);
    expect(JSON.parse(out.hosts.desktop["resources.json"])).toEqual({ host: "desktop", resources: out.resources.desktop });
    expect(out.hosts.desktop).toMatchSnapshot();
  });

  it("emits presence-only floating packages without a version, keeping inline pins", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("CoreyButler.NVMforWindows"),
          windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }),
        ]),
      ],
    });
    const lock = windowsLock({
      "CoreyButler.NVMforWindows": { source: "winget", version: "1.2.2" },
      "Microsoft.VisualStudioCode": { source: "winget", version: "1.90.1" },
    });
    const out = generateWindows(evaluate(ws), lock, undefined, {
      presenceOnlyPackages: new Set(["CoreyButler.NVMforWindows", "Microsoft.VisualStudioCode"]),
    });
    expect(named(out, "CoreyButler NVMforWindows").package?.version).toBeUndefined();
    expect(named(out, "Microsoft VisualStudioCode").package?.version).toBe("1.90.1");
    // Presence-only still requires the package to be locked.
    expect(() => generateWindows(evaluate(ws), windowsLock({
      "Microsoft.VisualStudioCode": { source: "winget", version: "1.90.1" },
    }), undefined, { presenceOnlyPackages: new Set(["CoreyButler.NVMforWindows"]) })).toThrow(/is not locked/);
  });

  it("emits an empty resources list for a windows host with no packages", () => {
    const ws = workspace({
      inputs,
      hosts: [host("blank", platforms.windows(), [])],
    });
    const out = generateWindows(evaluate(ws));
    expect(JSON.parse(out.hosts.blank["resources.json"])).toEqual({ host: "blank", resources: [] });
  });

  it("lists packages first, then raw commands in declaration order", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.raw({ executable: "cmd", arguments: ["/c", "echo", "first"] }),
          windows.package("ZedIndustries.Zed"),
          windows.package("Git.Git"),
          windows.raw({ executable: "cmd", arguments: ["/c", "echo", "second"] }),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
      "ZedIndustries.Zed": { source: "winget", version: "0.190.0" },
    }));

    expect(out.resources.desktop.map((resource) => [resource.name, resource.type])).toEqual([
      ["Git Git", "winget/package"], ["ZedIndustries Zed", "winget/package"],
      ["command 1", "command"], ["command 2", "command"],
    ]);
    expect(named(out, "command 1").command).toEqual({ executable: "cmd", arguments: ["/c", "echo", "first"] });
    expect(named(out, "command 2").command).toEqual({ executable: "cmd", arguments: ["/c", "echo", "second"] });
  });

  it("marks only packages that opt in as elevated", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
          windows.package({ id: "Some.Driver", elevated: true }),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Fastfetch-cli.Fastfetch": { source: "winget", version: "2.45.0" },
      "Some.Driver": { source: "winget", version: "1.2.3" },
    }));
    expect(named(out, "Fastfetch cli Fastfetch").elevated).toBe(false);
    expect(named(out, "Some Driver").elevated).toBe(true);
  });

  it("names resources with letters, numbers and spaces, keeping the real package id", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Git.Git"),
          windows.package("Fastfetch-cli.Fastfetch"),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
      "Fastfetch-cli.Fastfetch": { source: "winget", version: "2.45.0" },
    }));
    expect(named(out, "Git Git").package?.id).toBe("Git.Git");
    expect(named(out, "Fastfetch cli Fastfetch").package?.id).toBe("Fastfetch-cli.Fastfetch");
    for (const resource of out.resources.desktop) expect(resource.name).toMatch(/^[a-zA-Z0-9 ]+$/);
  });

  it("disambiguates colliding sanitized names with a numeric suffix", () => {
    // Two distinct ids that sanitize to the same base must stay unique.
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Foo.Bar"),
          windows.package("Foo-Bar"),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Foo.Bar": { source: "winget", version: "1.0.0" },
      "Foo-Bar": { source: "winget", version: "2.0.0" },
    }));
    expect(out.resources.desktop.map((resource) => resource.name).sort()).toEqual(["Foo Bar", "Foo Bar 2"]);
  });

  it("emits dependsOn referencing a package handle by resource name", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const git = windows.package("Git.Git");
          windows.raw({
            name: "clone repos",
            executable: "pwsh",
            arguments: ["-c", "git clone ..."],
            dependsOn: [git],
          });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    }));
    expect(named(out, "clone repos").dependsOn).toEqual(["Git Git"]);
  });

  it("emits dependsOn referencing a raw command handle", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const prep = windows.raw({
            name: "prep",
            executable: "pwsh",
            arguments: ["-c", "mkdir x"],
          });
          windows.package({ id: "Git.Git", dependsOn: [prep] });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    }));
    expect(named(out, "Git Git").dependsOn).toEqual(["prep"]);
  });

  it("accepts a single handle (not an array) in dependsOn", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const git = windows.package("Git.Git");
          // Single handle, no array wrapping.
          windows.raw({
            name: "clone repos",
            executable: "pwsh",
            arguments: ["-c", "git clone ..."],
            dependsOn: git,
          });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    }));
    expect(named(out, "clone repos").dependsOn).toEqual(["Git Git"]);
  });

  it("throws when dependsOn references a resource from another host", () => {
    // A handle captured in one host must not be used in another host's body.
    let leaked: ReturnType<typeof windows.package> | undefined;
    const ws = workspace({
      inputs,
      hosts: [
        host("a", platforms.windows(), ({ windows }) => {
          leaked = windows.package("Git.Git");
        }),
        host("b", platforms.windows(), ({ windows }) => {
          windows.raw({
            name: "x",
            executable: "pwsh",
            arguments: ["-c", "echo hi"],
            dependsOn: [leaked!],
          });
        }),
      ],
    });
    expect(() =>
      generateWindows(evaluate(ws), windowsLock({
        "Git.Git": { source: "winget", version: "2.44.0" },
      }))
    ).toThrow(/not declared in host "b"/);
  });
});

describe("winix-windows.lock", () => {
  it("parses a valid lockfile and returns null when absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-lock-read-"));
    try {
      expect(readWindowsLock(dir)).toBeNull();

      await writeFile(
        join(dir, "winix-windows.lock"),
        JSON.stringify({
          version: 1,
          generatedAt: "2026-06-24T18:37:00.000Z",
          packages: {
            "Git.Git": {
              source: "winget",
              version: "2.44.0",
              resolvedAt: "2026-06-24T18:37:00.000Z",
            },
          },
        })
      );

      // generatedAt is legacy: still accepted, no longer carried or written.
      expect(readWindowsLock(dir)).toEqual({
        version: 1,
        packages: {
          "Git.Git": {
            source: "winget",
            version: "2.44.0",
            resolvedAt: "2026-06-24T18:37:00.000Z",
          },
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on a malformed lockfile or unsupported lock version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-lock-invalid-"));
    try {
      await writeFile(join(dir, "winix-windows.lock"), "{ nope");
      expect(() => readWindowsLock(dir)).toThrow("Malformed winix-windows.lock");

      await writeFile(
        join(dir, "winix-windows.lock"),
        JSON.stringify({ version: 2, generatedAt: "now", packages: {} })
      );
      expect(() => readWindowsLock(dir)).toThrow(
        "Unsupported winix-windows.lock version 2"
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("writes deterministic JSON with sorted package keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-lock-write-"));
    try {
      writeWindowsLock(dir, windowsLock({
        "ZedIndustries.Zed": { source: "winget", version: "0.190.0" },
        "Git.Git": { source: "winget", version: "2.44.0" },
      }));

      const written = await readFile(join(dir, "winix-windows.lock"), "utf-8");
      expect(written).toMatchSnapshot();
      expect(written).not.toContain("generatedAt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reconciles inline pins into the lock and leaves floating entries untouched", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package({ id: "Git.Git", version: "2.44.0" }),
          windows.package("Fastfetch-cli.Fastfetch"),
        ]),
      ],
    });
    const lock = windowsLock({
      "Fastfetch-cli.Fastfetch": {
        source: "winget",
        version: "2.45.0",
        resolvedAt: "2026-06-24T18:37:00.000Z",
      },
    });
    const now = new Date("2026-06-25T21:10:00.000Z");

    const reconciled = reconcileInlinePins(lock, evaluate(ws), now);

    expect(reconciled.packages).toEqual({
      "Fastfetch-cli.Fastfetch": {
        source: "winget",
        version: "2.45.0",
        resolvedAt: "2026-06-24T18:37:00.000Z",
      },
      "Git.Git": {
        source: "winget",
        version: "2.44.0",
        resolvedAt: "2026-06-25T21:10:00.000Z",
      },
    });
    expect(reconcileInlinePins(reconciled, evaluate(ws), now)).toEqual(reconciled);
  });
});

describe("windows.dsc() / env.* / path.* helpers", () => {
  it("windows.dsc() normalizes a generic resource fragment", () => {
    const frag = windows.dsc({
      type: "Microsoft.Windows/Service",
      properties: { name: "spooler", startType: "automatic" },
    });
    expect(frag.windows?.dsc).toEqual([
      {
        resourceType: "Microsoft.Windows/Service",
        properties: { name: "spooler", startType: "automatic" },
      },
    ]);
  });

  it("windows.settings() normalizes all supported Windows settings into native resources", () => {
    const frag = windows.settings({
      theme: {
        autoColorization: true,
        transparency: false,
        accentOnStartAndTaskbar: true,
        accentOnTitleBars: true,
      },
      developer: { mode: true },
      notifications: { usbErrors: true, weakCharger: false },
      time: { zone: "Pacific Standard Time", automaticZone: false },
      start: { folders: ["documents", "settings"], showRecent: false, showRecommended: true },
      taskbar: {
        alignment: "left",
        badges: false,
        grouping: "never",
        multiMonitor: true,
        multiMonitorMode: "primaryAndWindow",
      },
    });
    expect(frag.windows?.dsc).toHaveLength(3);
    const [dev, time, pers] = frag.windows!.dsc!;
    expect(dev).toMatchObject({
      resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
      name: "Windows developer: developer mode on",
      elevated: true,
    });
    expect(String(dev.properties?.setScript)).toContain("AllowDevelopmentWithoutDevLicense");
    expect(time).toMatchObject({
      resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
      name: "Windows time: zone Pacific Standard Time, automatic zone off",
      elevated: true,
    });
    expect(String(time.properties?.setScript)).toContain("Pacific Standard Time");
    expect(String(time.properties?.setScript)).toContain("tzautoupdate");
    expect(pers).toMatchObject({
      resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
      name: "Windows personalization",
    });
    expect(pers.elevated).toBeUndefined();
    const persScript = String(pers.properties?.setScript);
    for (const expected of [
      "AutoColorization",
      "EnableTransparency",
      "ColorPrevalence",
      "TaskbarAl",
      "TaskbarBadges",
      "TaskbarGlomLevel",
      "MMTaskbarEnabled",
      "MMTaskbarMode",
      "ShowRecentList",
      "Start_TrackDocs",
      "VisiblePlaces",
      "{2D34D5CE-FA5A-4543-82F2-22E6EAF7773C}",
      "{52730886-51AA-4243-9F7B-2776584659D4}",
      "NotifyOnUsbErrors",
      "NotifyOnWeakCharger",
    ]) {
      expect(persScript).toContain(expected);
    }
  });

  it("windows.settings() rejects unknown sections and unknown keys", () => {
    expect(() => windows.settings({ unknown: true } as any)).toThrow(
      /does not support section "unknown"/i
    );
    expect(() => windows.settings.developer({ badKey: true } as any)).toThrow(
      /unknown windows\.settings\.developer option "badKey"/i
    );
  });

  it("windows.settings() validates setting value shapes", () => {
    expect(() => windows.settings.developer({ mode: "yes" } as any)).toThrow(/boolean/);
    expect(() => windows.settings.taskbar({ grouping: "sometimes" } as any)).toThrow(
      /always, whenFull, never/
    );
    expect(() => windows.settings.start({ folders: ["documents", "invalid"] } as any)).toThrow(
      /unsupported folder "invalid"/
    );
  });

  it("windows.env.set() builds a user-scope Registry resource by default", () => {
    const frag = windows.env.set("EDITOR", "nvim");
    expect(frag.windows?.dsc).toEqual([
      {
        resourceType: "Microsoft.Windows/Registry",
        name: "Set EDITOR",
        properties: {
          keyPath: "HKCU\\Environment",
          valueName: "EDITOR",
          _exist: true,
          valueData: { String: "nvim" },
        },
      },
    ]);
  });

  it("windows.env.set() supports machine scope via HKLM", () => {
    const resource = windows.env.set("JAVA_HOME", "C:\\Java", { scope: "machine" })
      .windows?.dsc?.[0];
    expect(resource?.resourceType).toBe("Microsoft.Windows/Registry");
    expect(resource?.properties).toEqual({
      keyPath: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
      valueName: "JAVA_HOME",
      _exist: true,
      valueData: { String: "C:\\Java" },
    });
  });

  it("windows.env.remove() uses _exist:false and omits valueData", () => {
    const frag = windows.env.remove("OLD_VAR");
    expect(frag.windows?.dsc?.[0].properties).toEqual({
      keyPath: "HKCU\\Environment",
      valueName: "OLD_VAR",
      _exist: false,
    });
  });

  it("windows.env.set() requires a value", () => {
    expect(() => windows.env.set("X", undefined as any)).toThrow(/value/);
  });

  it("windows.path.add() emits an idempotent user-scope PowerShellScript", () => {
    const frag = windows.path.add("%USERPROFILE%\\.local\\bin");
    const resource = frag.windows?.dsc?.[0];
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/PowerShellScript");
    const props = resource?.properties as Record<string, string>;
    expect(props.getScript).toContain("$registryPath = 'HKCU:\\Environment'");
    expect(props.testScript).toContain("$entries -contains $dir");
    expect(props.setScript).toContain("$new = if ([string]::IsNullOrEmpty($current)) { $dir } else { \"$current;$dir\" }");
    expect(props.setScript).toContain("[Environment]::SetEnvironmentVariable('Path', $new, $target)");
    expect(props.setScript).toContain("[Microsoft.Win32.RegistryValueKind]::ExpandString");
    expect(props.setScript).toContain("Set-ItemProperty -Path $registryPath -Name 'Path' -Value $afterValue -Type ExpandString");
    expect(props.setScript).not.toContain("Select-Object -Unique");
  });

  it("windows.path.add() supports machine scope via HKLM", () => {
    const resource = windows.path.add("C:\\tools\\bin", { scope: "machine" }).windows?.dsc?.[0];
    const props = resource?.properties as Record<string, string>;
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/PowerShellScript");
    expect(props.getScript).toContain(
      "$registryPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'"
    );
    expect(props.setScript).toContain("$target = 'Machine'");
  });

  it("windows.path.remove() removes only the target entry and is idempotent", () => {
    const frag = windows.path.remove("%USERPROFILE%\\.old-bin");
    const resource = frag.windows?.dsc?.[0];
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/PowerShellScript");
    const props = resource?.properties as Record<string, string>;
    expect(props.testScript).toContain("-not ($entries -contains $dir)");
    expect(props.setScript).toContain("if ($entries -contains $dir) {");
    expect(props.setScript).toContain("$new = ($entries | Where-Object { $_ -ne $dir }) -join ';'");
    expect(props.setScript).toContain("[Environment]::SetEnvironmentVariable('Path', $new, $target)");
    expect(props.setScript).toContain("[Microsoft.Win32.RegistryValueKind]::ExpandString");
  });

  it("rejects an invalid scope", () => {
    expect(() => windows.env.set("X", "y", { scope: "process" as any })).toThrow(/invalid/);
  });

  it("windows.file.text() emits an idempotent file-content script", () => {
    const frag = windows.file.text("%USERPROFILE%\\.gitconfig", "[user]\n", {
      encoding: "utf8bom",
      force: true,
    });
    const resource = frag.windows?.dsc?.[0];
    const props = resource?.properties as Record<string, string>;
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/PowerShellScript");
    expect(resource?.name).toBe("Write file %USERPROFILE%\\.gitconfig");
    expect(props.getScript).toContain("function Expand-WinixPath");
    expect(props.testScript).toContain("Get-WinixTextBytes $content $encoding");
    expect(props.testScript).toContain("$encoding = 'utf8bom'");
    expect(props.setScript).toContain("Move-WinixExistingTarget $target $force $backup");
    expect(props.setScript).toContain("[IO.File]::WriteAllBytes($target, $desired)");
  });

  it("windows.file.symlink() uses mklink instead of New-Item symlinks", () => {
    const frag = windows.file.symlink(
      "%LOCALAPPDATA%\\nvim",
      "%USERPROFILE%\\dotfiles\\nvim",
      { recursive: true }
    );
    const props = frag.windows?.dsc?.[0].properties as Record<string, string>;
    expect(props.setScript).toContain("Assert-WinixCanCreateSymlink");
    expect(props.setScript).toContain("Set-WinixRecursiveSymlink $source $target $force $backup");
    expect(props.setScript).toContain("Import-Module -Name $winixModule");
    expect(props.setScript).not.toContain("function Set-WinixSymlink");
    expect(WINIX_FILE_MODULE).toContain("mklink $flag");
    expect(WINIX_FILE_MODULE).not.toContain("New-Item -ItemType SymbolicLink");
    expect(WINIX_FILE_MODULE.indexOf("Move-WinixExistingTarget $Target $Force $Backup")).toBeLessThan(
      WINIX_FILE_MODULE.indexOf("New-Item -ItemType Directory -Force -Path $Target")
    );
  });

  it("windows.file.copy() and remove() emit safe script resources", () => {
    const copy = windows.file.copy("%APPDATA%\\tool\\config.json", ".\\config.json", {
      backup: true,
    }).windows?.dsc?.[0];
    const remove = windows.file.remove("%USERPROFILE%\\.oldrc").windows?.dsc?.[0];
    const copyProps = copy?.properties as Record<string, string>;
    const removeProps = remove?.properties as Record<string, string>;

    expect(copy?.resourceType).toBe("Microsoft.DSC.Transitional/PowerShellScript");
    expect(copyProps.getScript).toContain("function Expand-WinixPath");
    expect(copyProps.testScript).toContain("Test-WinixCopy $source $target");
    expect(copyProps.setScript).toContain("Copy-Item");
    expect(copyProps.setScript).toContain("$backup = $true");
    expect(remove?.resourceType).toBe("Microsoft.DSC.Transitional/PowerShellScript");
    expect(removeProps.setScript).toContain("Refusing to remove real directory");
    expect(removeProps.setScript).toContain("Remove-Item -LiteralPath $target -Force");
  });

  it("windows.file.* validates arguments and options", () => {
    expect(() => windows.file.text("", "x")).toThrow(/target/);
    expect(() => windows.file.text("x", "y", { encoding: "utf16" as any })).toThrow(/encoding/);
    expect(() => windows.file.symlink("x", "")).toThrow(/source/);
    expect(() => windows.file.copy("x", "", { force: "yes" as any })).toThrow(/force/);
    expect(() => windows.file.remove("")).toThrow(/target/);
  });
});

describe("generateWindows() emitter: dsc / env / path", () => {
  /** All script text of a host, unescaped, for substring checks. */
  const scriptsOf = (out: WindowsOutput, hostName = "desktop") => out.resources[hostName]
    .flatMap((resource) => [resource.testScript ?? "", resource.setScript ?? ""]).join("\n");

  it("emits a generic dsc resource verbatim", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.dsc({
            type: "Microsoft.Windows/Service",
            properties: { name: "spooler", startType: "automatic" },
          }),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws));
    expect(out.resources.desktop).toEqual([expect.objectContaining({
      type: "Microsoft.Windows/Service", category: "other", elevated: false,
      properties: { name: "spooler", startType: "automatic" },
    })]);
    expect(out.resources.desktop[0].setScript).toBeUndefined();
  });

  it("emits env as Registry and path as PowerShellScript resources", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.env.set("EDITOR", "nvim"),
          windows.path.add("%USERPROFILE%\\.local\\bin"),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws));
    expect(named(out, "Set EDITOR")).toMatchObject({
      type: "Microsoft.Windows/Registry", category: "environment", elevated: false,
      properties: { keyPath: "HKCU\\Environment", valueName: "EDITOR", _exist: true, valueData: { String: "nvim" } },
    });
    const path = out.resources.desktop.find((resource) => resource.category === "environment" && resource.shell);
    expect(path).toMatchObject({ type: "Microsoft.DSC.Transitional/PowerShellScript", shell: "pwsh", elevated: false });
    expect(path?.testScript).toContain("$entries -contains $dir");
    expect(out.hosts.desktop).toMatchSnapshot();
  });

  it("emits scoped env and path set/remove variants; machine scope is elevated", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.env.set("USER_VAR", "u"),
          windows.env.set("MACHINE_VAR", "m", { scope: "machine" }),
          windows.env.remove("OLD_USER_VAR"),
          windows.path.add("C:\\user-bin"),
          windows.path.add("C:\\machine-bin", { scope: "machine" }),
          windows.path.remove("C:\\old-user-bin"),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws));
    expect(named(out, "Set MACHINE VAR")).toMatchObject({
      elevated: true,
      properties: { keyPath: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" },
    });
    expect(named(out, "Set USER VAR").elevated).toBe(false);
    expect(named(out, "Remove OLD USER VAR").properties).toMatchObject({ _exist: false });
    expect(named(out, "Add C machine bin to PATH").elevated).toBe(true);
    expect(named(out, "Add C user bin to PATH").elevated).toBe(false);
    expect(scriptsOf(out)).toContain("$target = 'Machine'");
    expect(scriptsOf(out)).toContain("-not ($entries -contains $dir)");
    expect(out.hosts.desktop).toMatchSnapshot();
  });

  it("emits dependsOn referencing a dsc handle by resource name", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const editor = windows.env.set("EDITOR", "nvim");
          windows.path.add("%USERPROFILE%\\.local\\bin", { dependsOn: [editor] });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws));
    expect(out.resources.desktop.find((resource) => resource.shell)?.dependsOn).toEqual(["Set EDITOR"]);
  });

  it("emits native Developer Mode as an elevated PowerShell script without requiring a module lock pin", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.settings.developer({ mode: true }),
        ]),
      ],
    });
    const out = generateWindows(evaluate(ws));
    const dev = named(out, "Windows developer developer mode on");
    expect(dev).toMatchObject({
      type: "Microsoft.DSC.Transitional/PowerShellScript",
      elevated: true,
      dependsOn: [],
    });
    expect(dev.testScript).toContain("AllowDevelopmentWithoutDevLicense");
    expect(dev.setScript).toContain("AllowDevelopmentWithoutDevLicense");
    expect(out.resources.desktop.some((r) => r.name === "Ensure Microsoft Windows Settings module")).toBe(false);
  });

  it("emits every supported Windows settings section natively with exact registry paths and time APIs", () => {
    const ws = workspace({
      inputs,
      hosts: [host("desktop", platforms.windows(), [windows.settings({
        theme: {
          autoColorization: true,
          transparency: false,
          accentOnStartAndTaskbar: true,
          accentOnTitleBars: true,
        },
        taskbar: {
          alignment: "center",
          badges: false,
          grouping: "whenFull",
          multiMonitor: true,
          multiMonitorMode: "duplicate",
        },
        start: {
          folders: ["documents", "downloads", "settings"],
          showRecent: false,
          showRecommended: true,
        },
        developer: { mode: true },
        time: { zone: "Pacific Standard Time", automaticZone: false },
        notifications: { usbErrors: true, weakCharger: false },
      })])],
    });
    const out = generateWindows(evaluate(ws));
    const dev = named(out, "Windows developer developer mode on");
    expect(dev.elevated).toBe(true);
    expect(dev.testScript).toContain('"AllowDevelopmentWithoutDevLicense"');
    const time = named(out, "Windows time zone Pacific Standard Time automatic zone off");
    expect(time.elevated).toBe(true);
    expect(time.testScript).toContain("Get-TimeZone");
    expect(time.testScript).toContain("Pacific Standard Time");
    expect(time.testScript).toContain("tzautoupdate");
    expect(time.setScript).toContain("Set-TimeZone -Id $desiredZone");
    const pers = named(out, "Windows personalization");
    expect(pers.elevated).toBe(false);
    expect(pers.testScript).toContain('"TaskbarAl","value":1');
    expect(pers.testScript).toContain('"TaskbarBadges","value":0');
    expect(pers.testScript).toContain('"TaskbarGlomLevel","value":1');
    expect(pers.testScript).toContain('"MMTaskbarEnabled","value":1');
    expect(pers.testScript).toContain('"MMTaskbarMode","value":0');
    expect(pers.testScript).toContain('"EnableTransparency","value":0');
    expect(pers.testScript).toContain('"AutoColorization","value":1');
    expect(pers.testScript).toContain('"ShowRecentList","value":0');
    expect(pers.testScript).toContain('"Start_TrackDocs","value":1');
    expect(pers.testScript).toContain('"NotifyOnUsbErrors","value":1');
    expect(pers.testScript).toContain('"NotifyOnWeakCharger","value":0');
    expect(pers.testScript).toContain("VisiblePlaces");
  });

  it("packages and raw commands can depend on a setting handle", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const devMode = windows.settings.developer({ mode: true });
          windows.package({ id: "Git.Git", dependsOn: devMode });
          windows.raw({ name: "after-settings", executable: "pwsh", dependsOn: devMode });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    }));
    expect(named(out, "Git Git").dependsOn).toEqual(["Windows developer developer mode on"]);
    expect(named(out, "after settings").dependsOn).toEqual(["Windows developer developer mode on"]);
  });

  it.each([false, true])("orders symlinks after declared Developer Mode without duplicating explicit dependencies (%s)", (explicit) => {
    const developerMode = windows.settings.developer({ mode: true });
    const links = feature("links", ({ windows }) => {
      const config = windows.file.text("%USERPROFILE%\\source", "config");
      windows.file.symlink("%USERPROFILE%\\link", "%USERPROFILE%\\source", {
        dependsOn: explicit ? [config, developerMode] : config,
      });
      windows.file.copy("%USERPROFILE%\\copy", "%USERPROFILE%\\source");
      windows.file.remove("%USERPROFILE%\\old");
      windows.env.set("EDITOR", "nvim");
    });
    const evaluated = evaluate(workspace({
      inputs, hosts: [host("desktop", platforms.windows(), [links(), developerMode])],
    }));
    const out = generateWindows(evaluated, windowsLock({}));
    expect(named(out, "Link file USERPROFILE link").dependsOn)
      .toEqual(["Write file USERPROFILE source", "Windows developer developer mode on", "Winix PowerShell helpers"]);
    for (const name of ["Write file USERPROFILE source", "Copy file USERPROFILE copy"]) {
      expect(named(out, name).dependsOn).toEqual(["Winix PowerShell helpers"]);
    }
    for (const name of ["Remove file USERPROFILE old", "Set EDITOR", "Winix PowerShell helpers"]) {
      expect(named(out, name).dependsOn).toEqual([]);
    }
    expect(generateWindows(evaluated, windowsLock({})).hosts.desktop["resources.json"]).toBe(out.hosts.desktop["resources.json"]);
    const resource = (evaluated[0].windows as WindowsOptions).dsc?.find((resource) =>
      resource.winix?.kind === "file" && resource.winix.action === "symlink");
    expect(resource?.dependsOn).toHaveLength(explicit ? 2 : 1);
  });

  it.each([undefined, false])("does not enable Developer Mode or infer a dependency when its declaration is %s", (developerMode) => {
    const evaluated = evaluate(workspace({
      inputs,
      hosts: [host("desktop", platforms.windows(), [
        windows.file.symlink("%USERPROFILE%\\link", "%USERPROFILE%\\source"),
        ...(developerMode === undefined ? [] : [windows.settings.developer({ mode: developerMode })]),
      ])],
    }));
    const out = generateWindows(evaluated, windowsLock({}));
    const link = named(out, "Link file USERPROFILE link");
    expect(link.dependsOn).toEqual(["Winix PowerShell helpers"]);
    expect(link.setScript).toContain("Assert-WinixCanCreateSymlink");
    expect(scriptsOf(out)).toContain("requires elevation or Developer Mode");
    expect(out.resources.desktop.some((resource) => resource.name === "Windows developer developer mode on")).toBe(false);
  });

  it("keeps inferred Developer Mode dependencies within each host", () => {
    const links = feature("links", ({ windows }) => {
      windows.file.symlink("%USERPROFILE%\\link", "%USERPROFILE%\\source");
    });
    const evaluated = evaluate(workspace({
      inputs,
      hosts: [
        host("enabled", platforms.windows(), [links(), windows.settings.developer({ mode: true })]),
        host("external", platforms.windows(), [links()]),
      ],
    }));
    const output = generateWindows(evaluated, windowsLock({}));
    expect(named(output, "Link file USERPROFILE link", "enabled").dependsOn).toEqual(["Windows developer developer mode on", "Winix PowerShell helpers"]);
    expect(output.resources.external.some((resource) => resource.name === "Windows developer developer mode on")).toBe(false);
    expect(named(output, "Link file USERPROFILE link", "external").dependsOn).toEqual(["Winix PowerShell helpers"]);
  });

  it("resolves Winix-managed env references in PATH entries", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const cargoHome = windows.env.set("CARGO_HOME", "%USERPROFILE%\\.cargo");
          windows.path.add("%CARGO_HOME%\\bin", { dependsOn: cargoHome });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws));
    expect(scriptsOf(out)).toContain("$dir = '%USERPROFILE%\\.cargo\\bin'");
    expect(scriptsOf(out)).not.toContain("$dir = '%CARGO_HOME%\\bin'");
    expect(out.resources.desktop.find((resource) => resource.shell)?.dependsOn).toEqual(["Set CARGO HOME"]);
  });

  it("resolves managed env chains in env values and PATH entries", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          windows.env.set("ROOT", "%USERPROFILE%");
          windows.env.set("LEVEL2", "%ROOT%\\.local");
          windows.env.set("LEVEL3", "%LEVEL2%\\share");
          windows.path.add("%LEVEL3%\\bin");
        }),
      ],
    });
    const out = generateWindows(evaluate(ws));
    expect(named(out, "Set LEVEL2").properties?.valueData).toEqual({ String: "%USERPROFILE%\\.local" });
    expect(named(out, "Set LEVEL3").properties?.valueData).toEqual({ String: "%USERPROFILE%\\.local\\share" });
    expect(scriptsOf(out)).toContain("$dir = '%USERPROFILE%\\.local\\share\\bin'");
  });

  it("leaves system-only PATH variables untouched", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.path.add("%USERPROFILE%\\.local\\bin"),
        ]),
      ],
    });
    expect(scriptsOf(generateWindows(evaluate(ws)))).toContain("$dir = '%USERPROFILE%\\.local\\bin'");
  });

  it("matches managed env names case-insensitively while preserving system vars", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          windows.env.set("CARGO_HOME", "%USERPROFILE%\\.cargo");
          windows.path.add("%cargo_home%\\bin\\%USERNAME%");
        }),
      ],
    });
    expect(scriptsOf(generateWindows(evaluate(ws)))).toContain("$dir = '%USERPROFILE%\\.cargo\\bin\\%USERNAME%'");
  });

  it("rejects circular managed env references", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.env.set("A", "%B%"),
          windows.env.set("B", "%A%"),
        ]),
      ],
    });
    expect(() => generateWindows(evaluate(ws))).toThrow(
      /Circular Windows environment variable reference: A -> B -> A/
    );
  });

  it("a package can depend on an env handle", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const editor = windows.env.set("EDITOR", "nvim");
          windows.package({ id: "Git.Git", dependsOn: [editor] });
        }),
      ],
    });
    const out = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    }));
    expect(named(out, "Git Git").dependsOn).toEqual(["Set EDITOR"]);
  });

  it("emits file helpers as PowerShellScript resources with dependencies and elevation", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const config = windows.file.text("%USERPROFILE%\\.gitconfig", "[user]\n");
          windows.file.symlink(
            "%LOCALAPPDATA%\\nvim",
            "%USERPROFILE%\\dotfiles\\nvim",
            { dependsOn: config, elevate: true }
          );
          windows.file.copy("%APPDATA%\\tool\\config.json", ".\\config.json");
          windows.file.remove("%USERPROFILE%\\.oldrc");
        }),
      ],
    });
    const out = generateWindows(evaluate(ws), undefined, "C:\\config");
    for (const name of ["Write file USERPROFILE gitconfig", "Copy file APPDATA tool config json", "Remove file USERPROFILE oldrc"]) {
      expect(named(out, name)).toMatchObject({ shell: "pwsh", category: "file", elevated: false });
    }
    expect(named(out, "Link file LOCALAPPDATA nvim")).toMatchObject({
      elevated: true, dependsOn: ["Write file USERPROFILE gitconfig", "Winix PowerShell helpers"],
    });
    // The shared helpers are emitted once, in the module resource.
    expect(scriptsOf(out).split("function Set-WinixSymlink").length - 1).toBe(1);
    expect(scriptsOf(out).split("mklink $flag").length - 1).toBe(1);
    expect(out.hosts.desktop).toMatchSnapshot();
  });
});

function windowsLock(
  packages: Record<string, { source: "winget" | "msstore"; version: string; resolvedAt?: string }>
): WindowsLock {
  return {
    version: 1,
    generatedAt: "2026-06-24T18:37:00.000Z",
    modules: {
      "microsoft.windows.settings": {
        repository: "PSGallery", version: "0.1.0-alpha.6", resolvedAt: "2026-06-24T18:37:00.000Z",
      },
    },
    packages: Object.fromEntries(
      Object.entries(packages).map(([id, entry]) => [
        id,
        {
          source: entry.source,
          version: entry.version,
          resolvedAt: entry.resolvedAt ?? "2026-06-24T18:37:00.000Z",
        },
      ])
    ),
  };
}
