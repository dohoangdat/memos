import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Emits /sw.js for this build (fork): the service worker template with the build id and the
 * list of the build's scripts, styles and fonts to cache for offline use. A new build changes
 * the file, which makes browsers install the new worker and drop the old build's cache.
 */
export function serviceWorkerPlugin(): Plugin {
  return {
    name: "memos-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const precache = Object.keys(bundle)
        .filter((file) => /\.(js|css|woff2)$/.test(file))
        .map((file) => `/${file}`)
        .sort();
      const build = Date.now().toString(36);
      const template = readFileSync(fileURLToPath(new URL("./sw.template.js", import.meta.url)), "utf8");
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace('const BUILD = "__BUILD__";', `const BUILD = ${JSON.stringify(build)};`)
          .replace("const PRECACHE = __PRECACHE__;", `const PRECACHE = ${JSON.stringify(precache)};`),
      });
    },
  };
}
