import { defineConfig } from "astro/config";
import { satteri } from "@astrojs/markdown-satteri";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import { BASE, GITHUB_REPO, GITHUB_REF, docsSourceIntegration, docsSourcePlugin } from "./docs-source.mjs";

const repoLink = (label, path) => ({ label, link: `${GITHUB_REPO}/blob/${GITHUB_REF}/${path}`, attrs: { target: "_blank" } });

export default defineConfig({
  site: "https://adrifer.github.io",
  base: BASE,
  trailingSlash: "always",
  markdown: {
    processor: satteri({ mdastPlugins: [docsSourcePlugin()] }),
  },
  integrations: [
    // Pages come from ../docs, copied into src/content/docs.
    docsSourceIntegration(),
    starlight({
      title: "Winix",
      description: "TypeScript configuration for Windows, NixOS, WSL and macOS.",
      social: [{ icon: "github", label: "GitHub", href: GITHUB_REPO }],
      customCss: ["./src/styles/custom.css"],
      plugins: [starlightLinksValidator()],
      // Each section follows its docs/ folder; pages are ordered by their
      // front matter (sidebar.order), so a new page needs no change here.
      sidebar: [
        { label: "Start here", items: [{ autogenerate: { directory: "start" } }] },
        { label: "Concepts", items: [{ autogenerate: { directory: "concepts" } }] },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        {
          label: "Reference",
          items: [
            "reference/config",
            "reference/nix",
            { label: "Windows", items: [{ autogenerate: { directory: "reference/windows" } }] },
            "reference/wsl",
            "reference/cli",
          ],
        },
        {
          label: "Project",
          items: [
            repoLink("Changelog", "CHANGELOG.md"),
            repoLink("Roadmap", "ROADMAP.md"),
            repoLink("Contributing", "CONTRIBUTING.md"),
            repoLink("Specification", "spec/SPEC.md"),
          ],
        },
      ],
    }),
  ],
});
