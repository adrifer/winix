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

const inputs = defineInputs({
  nixpkgs: "github:NixOS/nixpkgs/nixos-unstable",
});

describe("windows.package() helper", () => {
  it("normalizes a bare id string to a winget package", () => {
    const frag = windows.package("Git.Git");
    expect(frag).toEqual({
      windows: { packages: { "Git.Git": { id: "Git.Git", source: "winget" } } },
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

    const out = generateWindows(evaluate(ws));
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
    const doc = generateWindows(evaluate(ws)).hosts.desktop["configuration.winget"];

    expect(doc.indexOf("name: Git.Git")).toBeLessThan(doc.indexOf("name: ZedIndustries.Zed"));
    expect(doc.indexOf("name: ZedIndustries.Zed")).toBeLessThan(
      doc.indexOf("name: run-command-0")
    );
    expect(doc.indexOf("name: run-command-0")).toBeLessThan(
      doc.indexOf("name: run-command-1")
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
    const doc = generateWindows(evaluate(ws)).hosts.desktop["configuration.winget"];

    // The non-elevated package block must not contain securityContext.
    const fastfetchBlock = doc.slice(
      doc.indexOf("name: Fastfetch-cli.Fastfetch"),
      doc.indexOf("name: Some.Driver")
    );
    expect(fastfetchBlock).not.toContain("securityContext");

    // The elevated package block must contain it.
    const driverBlock = doc.slice(doc.indexOf("name: Some.Driver"));
    expect(driverBlock).toContain("securityContext: elevated");
  });
});
