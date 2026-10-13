// Builds the panel and server into output/readme-build/ for the README screenshots, leaving dist/ untouched.
import { build } from "esbuild";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../../../", import.meta.url), path = p => fileURLToPath(new URL(p, root));
const out = path("output/readme-build/");
await rm(out, { recursive: true, force: true }); await mkdir(out + "test", { recursive: true });
await build({ entryPoints: [path("src/server.mjs"), path("src/worker.mjs")], bundle: true, platform: "node", target: "node24", format: "esm", outdir: out,
  outExtension: { ".js": ".mjs" }, packages: "bundle", external: ["node:*"],
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' } });
const ui = await build({ entryPoints: [path("ui/app.mjs")], bundle: true, platform: "browser", target: "es2022", format: "esm", write: false, minify: true });
await build({ entryPoints: [path("ui/test-host.mjs")], bundle: true, platform: "browser", target: "es2022", format: "esm", outfile: out + "test/host.js", minify: true });
const html = await readFile(path("ui/index.html"), "utf8"), css = await readFile(path("ui/styles.css"), "utf8");
await writeFile(out + "context.html", html.replace("<!--STYLE-->", () => "<style>" + css + "</style>")
  .replace("<!--SCRIPT-->", () => "<script type='module'>" + ui.outputFiles[0].text.replaceAll("</script", "<\\/script") + "</script>"));
console.log("built " + out);
