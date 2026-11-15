import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { windows } from "../src/index.ts";
import {
  fontSourceKey, fontsProperties, nerdFontsCatalog, resolveFontSource, resolveWindowsFonts,
} from "../src/backends/windows/fonts.ts";
import { emptyWindowsLock, readWindowsLock, serializeWindowsLock } from "../src/backends/windows/lockfile.ts";

afterEach(() => vi.unstubAllGlobals());
const sha256 = "a".repeat(64);
const source = { provider: "nerd-fonts", family: "JetBrainsMono" } as const;
const pin = {
  url: "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.zip",
  sha256, format: "zip" as const, version: "v3.5.1", resolvedAt: "2026-01-01T00:00:00.000Z",
};

function catalogResponse() {
  return Response.json({ tag_name: "v3.5.1", draft: false, prerelease: false, assets: [
    { name: "JetBrainsMono.zip", browser_download_url: pin.url, digest: `sha256:${sha256}` },
    { name: "JetBrainsMono.tar.xz" },
  ] });
}

describe("Windows font source resolution", () => {
  it("uses official release IDs/digests and does not infer installed family names", async () => {
    const fetch = vi.fn().mockImplementation(() => catalogResponse());
    vi.stubGlobal("fetch", fetch);
    expect((await nerdFontsCatalog()).fonts).toEqual([{ family: "JetBrainsMono", url: pin.url, sha256 }]);
    expect(await resolveFontSource(source)).toMatchObject({ ...pin, resolvedAt: expect.any(String) });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(resolveFontSource({ provider: "nerd-fonts", family: "NotAFont" })).rejects.toThrow("does not exist");
  });

  it("pins a direct download checksum and rejects HTTP redirects", async () => {
    const bytes = Buffer.from("test-font");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
    expect(await resolveFontSource({ url: "https://example.com/font.ttf" })).toMatchObject({
      url: "https://example.com/font.ttf", format: "ttf", sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: "http://example.com/font.ttf" } })));
    await expect(resolveFontSource({ url: "https://example.com/font.ttf" })).rejects.toThrow("HTTPS");
  });

  it("reuses locked sources without network and explicitly updates floating provider versions", async () => {
    const resolver = vi.fn().mockResolvedValue(pin);
    const first = await resolveWindowsFonts(emptyWindowsLock(), [source], resolver);
    expect(first.changed).toBe(true);
    resolver.mockClear();
    expect((await resolveWindowsFonts(first.lock, [source], resolver, new Date(), true)).changed).toBe(false);
    expect(resolver).not.toHaveBeenCalled();
    resolver.mockResolvedValue({ ...pin, version: "v3.5.2", url: pin.url.replace("v3.5.1", "v3.5.2"), sha256: "b".repeat(64) });
    expect((await resolveWindowsFonts(first.lock, [source], resolver)).lock.fonts?.[fontSourceKey(source)].version).toBe("v3.5.2");
    const exact = { ...source, version: "v3.5.1" };
    await expect(resolveWindowsFonts(emptyWindowsLock(), [exact], resolver)).rejects.toThrow("Invalid font resolution");
  });

  it("round-trips font lock entries and rejects mismatched or malformed pins", async () => {
    const result = await resolveWindowsFonts(emptyWindowsLock(), [source], async () => pin);
    const dir = mkdtempSync(join(tmpdir(), "winix-font-lock-"));
    try {
      writeFileSync(join(dir, "winix-windows.lock"), serializeWindowsLock(result.lock));
      expect(readWindowsLock(dir)?.fonts).toEqual(result.lock.fonts);
      expect(() => fontsProperties([source], { ...result.lock, fonts: {
        [fontSourceKey(source)]: { ...pin, url: "https://example.com/untrusted.zip" },
      } })).toThrow("matching pin");
      writeFileSync(join(dir, "winix-windows.lock"), JSON.stringify({ ...result.lock, fonts: {
        [fontSourceKey(source)]: { ...pin, sha256: "bad" },
      } }));
      expect(() => readWindowsLock(dir)).toThrow("invalid");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("validates source selectors and credentials and resolves local paths without a lock", () => {
    expect(() => windows.fonts({ sources: [{ url: "http://example.com/font.ttf" }] })).toThrow("HTTPS");
    expect(() => windows.fonts({ sources: [{ url: "https://user:secret@example.com/font.ttf" }] })).toThrow("credentials");
    expect(() => windows.fonts({ sources: [{ url: "https://example.com/fonts.zip", files: ["../font.ttf"] }] })).toThrow("safe");
    expect(() => windows.fonts({ sources: [] })).toThrow("nonempty");
    const scripts = fontsProperties(["..\\fonts\\font.ttf"], emptyWindowsLock(), "D:\\dotfiles\\winix");
    expect(scripts.setScript).toContain("D:\\\\dotfiles\\\\fonts\\\\font.ttf");
    expect(scripts.setScript).toContain("Font replacement refused");
    expect(scripts.setScript).not.toContain("LocalMachine");
  });
});
