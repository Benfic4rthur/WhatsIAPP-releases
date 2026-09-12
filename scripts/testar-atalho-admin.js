const assert = require("node:assert/strict");
const fs = require("node:fs");
const caminho = require("node:path").join(__dirname, "..", "renderer-modules", "admin.js");
const codigo = fs.readFileSync(caminho, "utf8");
assert.match(codigo, /evento\.metaKey \|\| evento\.ctrlKey/);
assert.match(codigo, /process\.platform === "darwin"/);
assert.match(codigo, /evento\.shiftKey/);
console.log("OK: atalho administrativo separado para macOS e Windows/Linux.");
