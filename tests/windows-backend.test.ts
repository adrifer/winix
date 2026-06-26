import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import {
  host,
  workspace,
  defineInputs,
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
  it("normalizes a command string to a powershell RunCommandOnSet command", () => {
    const frag = windows.raw(
      "New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.local\\bin"
    );
    expect(frag).toEqual({
      windows: {
        commands: [
          {
            executable: "powershell",
            arguments: [
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

  it("emits a stable configuration.winget + apply.ps1 for a windows host", () => {
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
    expect(out.hosts.desktop).toMatchSnapshot();
  });

  it("emits an empty resources list for a windows host with no packages", () => {
    const ws = workspace({
      inputs,
      hosts: [host("blank", platforms.windows(), [])],
    });
    const out = generateWindows(evaluate(ws));
    expect(out.hosts.blank["configuration.winget"]).toContain("resources: []");
  });

  it("renders packages first, then raw commands in declaration order", () => {
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
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
      "ZedIndustries.Zed": { source: "winget", version: "0.190.0" },
    })).hosts.desktop["configuration.winget"];

    expect(doc.indexOf('name: "Git Git"')).toBeLessThan(doc.indexOf('name: "ZedIndustries Zed"'));
    expect(doc.indexOf('name: "ZedIndustries Zed"')).toBeLessThan(
      doc.indexOf('name: "command 1"')
    );
    expect(doc.indexOf('name: "command 1"')).toBeLessThan(
      doc.indexOf('name: "command 2"')
    );
    expect(doc).toContain("type: Microsoft.DSC.Transitional/RunCommandOnSet");
    expect(doc).toContain('arguments: ["/c", "echo", "first"]');
    expect(doc).toContain('arguments: ["/c", "echo", "second"]');
  });

  it("omits securityContext unless a package opts into elevation", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Fastfetch-cli.Fastfetch"),
          windows.package({ id: "Some.Driver", elevated: true }),
        ]),
      ],
    });
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Fastfetch-cli.Fastfetch": { source: "winget", version: "2.45.0" },
      "Some.Driver": { source: "winget", version: "1.2.3" },
    })).hosts.desktop["configuration.winget"];

    // The non-elevated package block must not contain securityContext.
    const fastfetchBlock = doc.slice(
      doc.indexOf('name: "Fastfetch cli Fastfetch"'),
      doc.indexOf('name: "Some Driver"')
    );
    expect(fastfetchBlock).not.toContain("securityContext");

    // The elevated package block must contain it.
    const driverBlock = doc.slice(doc.indexOf('name: "Some Driver"'));
    expect(driverBlock).toContain("securityContext: elevated");
  });

  it("sanitizes resource ids into schema-valid instance names", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.package("Git.Git"),
          windows.package("Fastfetch-cli.Fastfetch"),
        ]),
      ],
    });
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
      "Fastfetch-cli.Fastfetch": { source: "winget", version: "2.45.0" },
    })).hosts.desktop["configuration.winget"];

    // Dots/dashes collapse to spaces; the real id stays in properties.id.
    expect(doc).toContain('name: "Git Git"');
    expect(doc).toContain("      id: Git.Git");
    expect(doc).toContain('name: "Fastfetch cli Fastfetch"');
    expect(doc).toContain("      id: Fastfetch-cli.Fastfetch");

    // Every emitted instance name must satisfy the DSC v3 name grammar.
    for (const line of doc.split("\n")) {
      const m = line.match(/^  - name: (?:"([^"]+)"|(.+))$/);
      if (!m) continue;
      const name = m[1] ?? m[2];
      expect(name).toMatch(/^[a-zA-Z0-9 ]+$/);
    }
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
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Foo.Bar": { source: "winget", version: "1.0.0" },
      "Foo-Bar": { source: "winget", version: "2.0.0" },
    })).hosts.desktop["configuration.winget"];

    expect(doc).toContain('name: "Foo Bar"');
    expect(doc).toContain('name: "Foo Bar 2"');
  });

  it("emits dependsOn referencing a package handle by resourceId", () => {
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
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    })).hosts.desktop["configuration.winget"];

    // The command resource depends on the package resource via resourceId.
    const cmdBlock = doc.slice(doc.indexOf('name: "clone repos"'));
    expect(cmdBlock).toContain(
      `dependsOn: ["[resourceId('Microsoft.WinGet/Package', 'Git Git')]"]`
    );
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
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    })).hosts.desktop["configuration.winget"];

    const pkgBlock = doc.slice(doc.indexOf('name: "Git Git"'));
    expect(pkgBlock).toContain(
      `dependsOn: ["[resourceId('Microsoft.DSC.Transitional/RunCommandOnSet', 'prep')]"]`
    );
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
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    })).hosts.desktop["configuration.winget"];

    const cmdBlock = doc.slice(doc.indexOf('name: "clone repos"'));
    expect(cmdBlock).toContain(
      `dependsOn: ["[resourceId('Microsoft.WinGet/Package', 'Git Git')]"]`
    );
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

      expect(readWindowsLock(dir)).toEqual({
        version: 1,
        generatedAt: "2026-06-24T18:37:00.000Z",
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

      await expect(readFile(join(dir, "winix-windows.lock"), "utf-8")).resolves.toMatchSnapshot();
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

  it("windows.path.add() emits an idempotent user-scope WindowsPowerShellScript", () => {
    const frag = windows.path.add("%USERPROFILE%\\.local\\bin");
    const resource = frag.windows?.dsc?.[0];
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/WindowsPowerShellScript");
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
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/WindowsPowerShellScript");
    expect(props.getScript).toContain(
      "$registryPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'"
    );
    expect(props.setScript).toContain("$target = 'Machine'");
  });

  it("windows.path.remove() removes only the target entry and is idempotent", () => {
    const frag = windows.path.remove("%USERPROFILE%\\.old-bin");
    const resource = frag.windows?.dsc?.[0];
    expect(resource?.resourceType).toBe("Microsoft.DSC.Transitional/WindowsPowerShellScript");
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
});

describe("generateWindows() emitter: dsc / env / path", () => {
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
    const doc = generateWindows(evaluate(ws)).hosts.desktop["configuration.winget"];
    expect(doc).toContain("type: Microsoft.Windows/Service");
    expect(doc).toContain("name: spooler");
    expect(doc).toContain("startType: automatic");
    expect(doc).toMatchSnapshot();
  });

  it("emits env as Registry and path as WindowsPowerShellScript resources", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), [
          windows.env.set("EDITOR", "nvim"),
          windows.path.add("%USERPROFILE%\\.local\\bin"),
        ]),
      ],
    });
    const doc = generateWindows(evaluate(ws)).hosts.desktop["configuration.winget"];
    expect(doc).toContain("type: Microsoft.Windows/Registry");
    expect(doc).toContain("type: Microsoft.DSC.Transitional/WindowsPowerShellScript");
    expect(doc).not.toContain("type: PSDscResources/Environment");
    expect(doc).not.toContain("type: Microsoft.DSC/PowerShell");
    expect(doc).toContain("keyPath: \"HKCU\\\\Environment\"");
    expect(doc).toContain("_exist: true");
    expect(doc).toContain("$entries -contains $dir");
    expect(doc).toMatchSnapshot();
  });

  it("emits scoped env and path set/remove variants", () => {
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
    const doc = generateWindows(evaluate(ws)).hosts.desktop["configuration.winget"];
    expect(doc).toContain("type: Microsoft.Windows/Registry");
    expect(doc).toContain("type: Microsoft.DSC.Transitional/WindowsPowerShellScript");
    expect(doc).toContain("keyPath: \"HKLM\\\\SYSTEM\\\\CurrentControlSet\\\\Control\\\\Session Manager\\\\Environment\"");
    expect(doc).toContain("_exist: false");
    expect(doc).toContain("$target = 'Machine'");
    expect(doc).toContain("-not ($entries -contains $dir)");
    expect(doc).toMatchSnapshot();
  });

  it("emits dependsOn referencing a dsc handle by resourceId", () => {
    const ws = workspace({
      inputs,
      hosts: [
        host("desktop", platforms.windows(), ({ windows }) => {
          const editor = windows.env.set("EDITOR", "nvim");
          windows.path.add("%USERPROFILE%\\.local\\bin", { dependsOn: [editor] });
        }),
      ],
    });
    const doc = generateWindows(evaluate(ws)).hosts.desktop["configuration.winget"];
    expect(doc).toContain(
      `dependsOn: ["[resourceId('Microsoft.Windows/Registry', 'Set EDITOR')]"]`
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
    const doc = generateWindows(evaluate(ws), windowsLock({
      "Git.Git": { source: "winget", version: "2.44.0" },
    })).hosts.desktop["configuration.winget"];
    expect(doc).toContain(
      `dependsOn: ["[resourceId('Microsoft.Windows/Registry', 'Set EDITOR')]"]`
    );
  });
});

function windowsLock(
  packages: Record<string, { source: "winget" | "msstore"; version: string; resolvedAt?: string }>
): WindowsLock {
  return {
    version: 1,
    generatedAt: "2026-06-24T18:37:00.000Z",
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
