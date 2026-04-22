import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const baseDistDir = path.join(root, "dist");
const manifestsDir = path.join(root, "manifests");
const outRoot = path.join(root, "dist-browsers");

const targets = ["chrome", "edge", "opera", "firefox", "safari"];

if (!fs.existsSync(baseDistDir)) {
  console.error("Base dist/ folder not found. Run `npm run build` first.");
  process.exit(1);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

for (const target of targets) {
  const outDir = path.join(outRoot, target);
  fs.cpSync(baseDistDir, outDir, { recursive: true });

  const manifestPath = path.join(manifestsDir, `manifest.${target}.json`);
  if (!fs.existsSync(manifestPath)) {
    console.error(`Missing manifest for target "${target}": ${manifestPath}`);
    process.exit(1);
  }
  fs.copyFileSync(manifestPath, path.join(outDir, "manifest.json"));

  const copiedManifestDir = path.join(outDir, "manifests");
  if (fs.existsSync(copiedManifestDir)) {
    fs.rmSync(copiedManifestDir, { recursive: true, force: true });
  }

  console.log(`Built target: ${target} -> ${path.relative(root, outDir)}`);
}

console.log("\nBrowser builds complete.");
console.log(`Output: ${path.relative(root, outRoot)}/`);
