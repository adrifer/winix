# Documentation site

The Winix documentation site, built with [Starlight](https://starlight.astro.build)
from the repository's [`docs/`](../docs) folder. Edit the pages there, not here:
they stay plain Markdown that also reads on GitHub.

```bash
cd site
npm install
npm run dev      # http://localhost:4321/winix/, reloads when docs/ changes
npm run build    # site/dist, fails on a broken internal link
```

How `docs/` becomes the site ([`docs-source.mjs`](docs-source.mjs)):

- `docs/` is copied into `src/content/docs` (git-ignored) on every build, and on
  every change in `npm run dev`. `README.md` files become index pages, except
  `docs/README.md`, the index for GitHub: the site's home page is
  [`home.mdx`](home.mdx) (Starlight components, site only).
- Relative links to `.md` files under `docs/` become site links; links to
  anything else in the repository (`examples/`, `CHANGELOG.md`, `spec/`) become
  GitHub links, to `main` or, for a release deploy, its tag.
- The page's `# Title` is dropped, since Starlight shows the front-matter
  `title`.

The sidebar is in [`astro.config.mjs`](astro.config.mjs): add new pages there.
Run from WSL with the repository on a Windows drive (`/mnt/d/...`), `npm run dev`
still picks up page edits, but restart it after changing the config or styles.

The [Docs workflow](../.github/workflows/docs.yml) builds the site on every
change to `docs/` or `site/`, and deploys it to GitHub Pages on a stable release
tag or a manual run.
