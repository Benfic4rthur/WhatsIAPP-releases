const fs = require("node:fs");
const path = require("node:path");

const dist = path.join(__dirname, "..", "dist");
const generatedFiles = [
  "builder-debug.yml",
  "latest-mac.yml",
  "mac-arm64",
];

if (!fs.existsSync(dist)) {
  process.exit(0);
}

for (const entry of fs.readdirSync(dist)) {
  if (entry.startsWith("WhatsIAPP-") || generatedFiles.includes(entry)) {
    fs.rmSync(path.join(dist, entry), { recursive: true, force: true });
  }
}

console.log("Artefatos locais antigos removidos de dist/.");
