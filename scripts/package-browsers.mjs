import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const buildsRoot = path.join(root, "dist-browsers");
const packagesRoot = path.join(root, "browser-packages");
const legacyTesterZip = path.join(root, "BookmarkMaster-extension.zip");
const targets = ["chrome", "edge", "opera", "firefox", "safari"];

if (!fs.existsSync(buildsRoot)) {
  console.error("dist-browsers/ not found. Run `npm run build:browsers` first.");
  process.exit(1);
}

fs.rmSync(packagesRoot, { recursive: true, force: true });
fs.mkdirSync(packagesRoot, { recursive: true });
fs.rmSync(legacyTesterZip, { force: true });

for (const target of targets) {
  const targetDir = path.join(buildsRoot, target);
  if (!fs.existsSync(targetDir)) {
    console.error(`Missing build output for target "${target}": ${targetDir}`);
    process.exit(1);
  }

  const zipName = `BookmarkMaster-${target}.zip`;
  const zipPath = path.join(packagesRoot, zipName);
  execSync(`cd "${targetDir}" && zip -r "${zipPath}" .`, { stdio: "inherit" });
  console.log(`Packaged: ${path.relative(root, zipPath)}`);
}

console.log("\nBrowser zip packages complete.");
console.log(`Output: ${path.relative(root, packagesRoot)}/`);
