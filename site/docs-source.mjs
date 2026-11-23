// The site renders the repository's docs/ folder, so the same pages keep
// working on GitHub. Starlight and its link validator only read
// src/content/docs, so docs/ is copied there (git-ignored) on every build and,
// in `astro dev`, on every change. A Markdown plugin then rewrites what only
// makes sense on GitHub.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DOCS_DIR = resolve(REPO_ROOT, "docs");
export const CONTENT_DIR = fileURLToPath(new URL("./src/content/docs", import.meta.url));
export const GITHUB_REPO = "https://github.com/adrifer/winix";
/** Where links to files outside docs/ point; a release deploy sets the tag. */
export const GITHUB_REF = process.env.WINIX_DOCS_REF || "main";
export const BASE = "/winix";
/**
 * The site's home page. docs/README.md, the index of docs/ on GitHub, is not
 * published: the sidebar and this page replace it.
 */
const HOME_FILE = fileURLToPath(new URL("./home.mdx", import.meta.url));
const DOCS_INDEX = "README.md";

const isReadme = (path) => /(^|[\\/])README\.md$/i.test(path);
const inside = (dir, path) => !relative(dir, path).startsWith("..");

/** Where a docs/ file goes in the site: READMEs become index pages. */
function contentPath(relativePath) {
  return isReadme(relativePath) ? relativePath.replace(/README\.md$/i, "index.md") : relativePath;
}

/** The docs/ file a page in src/content/docs was copied from. */
function sourcePath(contentFile) {
  const rel = relative(CONTENT_DIR, contentFile);
  const readme = rel.replace(/index\.md$/i, "README.md");
  return join(DOCS_DIR, rel !== readme && existsSync(join(DOCS_DIR, readme)) ? readme : rel);
}

/** The site URL of a Markdown file under docs/. */
function pageUrl(relativePath) {
  const page = contentPath(relativePath).split(sep).join("/").replace(/\.md$/i, "").replace(/(^|\/)index$/, "").toLowerCase();
  return page === "" ? `${BASE}/` : `${BASE}/${page}/`;
}

/** Copy docs/ into src/content/docs, replacing what was there. */
/**
 * Copy docs/ into src/content/docs. Only what changed is written or removed,
 * so `astro dev` reloads just the edited page. Returns those changes.
 */
export function syncDocs() {
  const changes = [];
  const wanted = new Map([[join(CONTENT_DIR, "index.mdx"), HOME_FILE]]);
  for (const rel of markdownFiles(DOCS_DIR)) {
    if (rel !== DOCS_INDEX) wanted.set(join(CONTENT_DIR, contentPath(rel)), join(DOCS_DIR, rel));
  }
  if (existsSync(CONTENT_DIR)) {
    for (const rel of markdownFiles(CONTENT_DIR)) {
      const file = join(CONTENT_DIR, rel);
      if (wanted.has(file)) continue;
      rmSync(file);
      changes.push(["unlink", file]);
    }
  }
  for (const [target, source] of wanted) {
    const content = readFileSync(source);
    const exists = existsSync(target);
    if (exists && readFileSync(target).equals(content)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    changes.push([exists ? "change" : "add", target]);
  }
  return changes;
}

function markdownFiles(dir) {
  return readdirSync(dir, { recursive: true }).filter((rel) => /\.mdx?$/i.test(rel));
}

function docsSignature() {
  return [HOME_FILE, ...markdownFiles(DOCS_DIR).map((rel) => join(DOCS_DIR, rel))]
    .map((file) => {
      const { mtimeMs, size } = statSync(file);
      return `${file}:${mtimeMs}:${size}`;
    })
    .join("|");
}

/** Astro integration: sync docs/ before a build, and keep it synced in dev. */
export function docsSourceIntegration() {
  return {
    name: "winix-docs-source",
    hooks: {
      "astro:config:setup": () => {
        syncDocs();
      },
      "astro:server:setup": ({ server, logger }) => {
        // Polled rather than watched, and the copies announced to Astro's
        // watcher by hand: from WSL, files under /mnt/<drive> raise no file
        // events, whichever side edits them. A few dozen stats a second is cheap.
        let last = docsSignature();
        setInterval(() => {
          try {
            const now = docsSignature();
            if (now === last) return;
            for (const [event, file] of syncDocs()) {
              server.watcher.emit(event, file);
              logger.info(`${relative(REPO_ROOT, file)}: ${event}`);
            }
            last = now;
          } catch (error) {
            // A file moved or deleted mid-sync: try again on the next tick.
            logger.warn(`docs/ sync: ${error.message}`);
          }
        }, 1000).unref();
      },
    },
  };
}

/**
 * Rewrite a link found in `file` (an absolute path under docs/): a relative
 * link to a Markdown file under docs/ becomes that page's URL, and one to
 * anything else in the repository becomes its GitHub URL. Returns undefined to
 * keep the link as it is (absolute URLs, anchors, site paths).
 */
export function rewriteLink(url, file) {
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("#") || url.startsWith("/")) return undefined;
  const hashAt = url.indexOf("#");
  const path = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  if (path === "") return undefined;
  const target = resolve(dirname(file), decodeURIComponent(path));
  if (inside(DOCS_DIR, target) && /\.md$/i.test(target)) return pageUrl(relative(DOCS_DIR, target)) + hash;
  const where = relative(REPO_ROOT, file);
  if (!inside(REPO_ROOT, target)) throw new Error(`${where}: link "${url}" leaves the repository`);
  if (!existsSync(target)) throw new Error(`${where}: link "${url}" points to a missing file`);
  const kind = statSync(target).isDirectory() ? "tree" : "blob";
  return `${GITHUB_REPO}/${kind}/${GITHUB_REF}/${relative(REPO_ROOT, target).split(sep).join("/")}${hash}`;
}

/**
 * Sätteri (Astro's Markdown processor) plugin for the copied pages: rewrites
 * links (see rewriteLink) and drops the page's `# Title`, which Starlight
 * already renders from the front matter.
 */
export function docsSourcePlugin() {
  return ({ fileURL }) => {
    if (!fileURL) return undefined;
    const copied = fileURLToPath(fileURL);
    if (!inside(CONTENT_DIR, copied)) return undefined;
    const file = sourcePath(copied);
    // Only pages copied from docs/ (not the home page).
    if (!existsSync(file)) return undefined;
    const rewrite = (node, ctx) => {
      const url = rewriteLink(node.url, file);
      if (url !== undefined) ctx.setProperty(node, "url", url);
    };
    return {
      name: "winix-docs-source",
      heading(node, ctx) {
        if (node.depth === 1) ctx.removeNode(node);
      },
      link: rewrite,
      definition: rewrite,
    };
  };
}
