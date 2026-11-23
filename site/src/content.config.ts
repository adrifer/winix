import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  // src/content/docs is a git-ignored copy of the repository's docs/ folder
  // (see docs-source.mjs).
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
