import { createHash } from "node:crypto";
import { constants } from "node:zlib";
import { brotliDecompress } from "node:zlib";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { InputDef } from "../../core/types.ts";

const brotliDecompressAsync = promisify(brotliDecompress);

export interface DownloadOptions {
  cacheDir: string;
  channel: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}

export interface DownloadResult {
  optionsJson: string;
  channel: string;
  cacheKey: string;
  cachePath: string;
  fromCache: boolean;
  sourceUrl: string;
}

export function detectNixpkgsChannel(inputs: Record<string, InputDef>): string | null {
  const nixpkgs = inputs.nixpkgs;
  if (!nixpkgs) return null;

  const url = typeof nixpkgs === "string" ? nixpkgs : nixpkgs.url;
  if (/^nixos-[A-Za-z0-9._-]+$/.test(url)) return url;
  if (/^nixpkgs-[A-Za-z0-9._-]+$/.test(url)) return url.replace(/^nixpkgs-/, "nixos-");

  const githubMatch = /^github:NixOS\/nixpkgs(?:\/([^/?#]+))?/i.exec(url);
  if (githubMatch?.[1] && /^nixos-[A-Za-z0-9._-]+$/.test(githubMatch[1])) {
    return githubMatch[1];
  }
  if (githubMatch?.[1] && /^nixpkgs-[A-Za-z0-9._-]+$/.test(githubMatch[1])) {
    return githubMatch[1].replace(/^nixpkgs-/, "nixos-");
  }

  return null;
}

export async function downloadOptionsJson(opts: DownloadOptions): Promise<DownloadResult> {
  await mkdir(opts.cacheDir, { recursive: true });

  const fetcher = opts.fetchImpl ?? fetch;
  const sourceUrl = `https://channels.nixos.org/${opts.channel}/options.json.br`;
  const resolved = await resolveCacheKey(fetcher, sourceUrl, opts.channel);
  const cachePath = join(opts.cacheDir, `${resolved.cacheKey}.options.json`);
  const metaPath = join(opts.cacheDir, `${resolved.cacheKey}.meta.json`);

  if (!opts.force && existsSync(cachePath)) {
    return {
      optionsJson: await readFile(cachePath, "utf-8"),
      channel: opts.channel,
      cacheKey: resolved.cacheKey,
      cachePath,
      fromCache: true,
      sourceUrl: resolved.finalUrl,
    };
  }

  const response = await fetcher(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${sourceUrl}: HTTP ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const optionsJson = await decodeOptionsResponse(bytes, response);
  await writeFile(cachePath, optionsJson);
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        channel: opts.channel,
        sourceUrl,
        finalUrl: response.url || resolved.finalUrl,
        etag: response.headers.get("etag"),
        generatedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return {
    optionsJson,
    channel: opts.channel,
    cacheKey: resolved.cacheKey,
    cachePath,
    fromCache: false,
    sourceUrl: response.url || resolved.finalUrl,
  };
}

async function resolveCacheKey(
  fetcher: typeof fetch,
  sourceUrl: string,
  channel: string
): Promise<{ cacheKey: string; finalUrl: string }> {
  try {
    const response = await fetcher(sourceUrl, { method: "HEAD" });
    if (response.ok) {
      const finalUrl = response.url || sourceUrl;
      return {
        cacheKey: cacheKey(channel, finalUrl, response.headers.get("etag") ?? ""),
        finalUrl,
      };
    }
  } catch {
    // Some channel servers do not support HEAD consistently. The GET below will report failures.
  }

  return {
    cacheKey: cacheKey(channel, sourceUrl, ""),
    finalUrl: sourceUrl,
  };
}

async function decodeOptionsResponse(bytes: Buffer, response: Response): Promise<string> {
  const contentEncoding = response.headers.get("content-encoding");
  const looksDecoded = bytes[0] === 0x7b || bytes[0] === 0x5b;
  if (contentEncoding === "br" || looksDecoded) {
    return bytes.toString("utf-8");
  }

  const decoded = await brotliDecompressAsync(bytes, {
    params: {
      [constants.BROTLI_DECODER_PARAM_LARGE_WINDOW]: 1,
    },
  });
  return decoded.toString("utf-8");
}

function cacheKey(channel: string, finalUrl: string, etag: string): string {
  const hash = createHash("sha256").update(`${channel}\n${finalUrl}\n${etag}`).digest("hex").slice(0, 16);
  const safeChannel = channel.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safeChannel}-${hash}`;
}
