"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const {
  caminhoChrome,
  validarExecutavelWindows,
} = require("./recursos-desktop");
const { prepararChrome } = require("./preparar-chrome-empacotado");
const { validarHost } = require("./gerar-windows");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "whatsiapp-win-test-"));

try {
  assert.equal(
    caminhoChrome(
      String.raw`C:\Program Files\WhatsIAPP\resources`,
      "win32",
      path.win32,
    ),
    String.raw`C:\Program Files\WhatsIAPP\resources\wppconnect-chrome\chrome-win64\chrome.exe`,
  );

  assert.equal(
    caminhoChrome(
      "/Applications/WhatsIAPP.app/Contents/Resources",
      "darwin",
      path.posix,
    ),
    "/Applications/WhatsIAPP.app/Contents/Resources/wppconnect-chrome/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  );

  assert.equal(caminhoChrome(null), null);
  assert.throws(() => validarHost("darwin", "arm64"));
  assert.throws(() => validarHost("win32", "arm64"));
  validarHost("win32", "x64");

  const origem = path.join(tmp, "cache", "chrome-win64");
  fs.mkdirSync(path.join(origem, "locales"), { recursive: true });

  const pe = Buffer.alloc(134);
  pe.write("MZ");
  pe.writeUInt32LE(128, 60);
  pe.writeUInt32LE(0x4550, 128);
  pe.writeUInt16LE(0x8664, 132);

  const exe = path.join(origem, "chrome.exe");
  fs.writeFileSync(exe, pe);

  for (const f of ["chrome.dll", "icudtl.dat", "resources.pak"]) {
    fs.writeFileSync(path.join(origem, f), "fixture");
  }

  // Dados vizinhos ao navegador nao devem entrar no pacote.
  fs.writeFileSync(path.join(tmp, "cache", "creds.json"), "{}");

  const resources = path.join(tmp, "resources");
  prepararChrome(exe, "win32", path.join(resources, "wppconnect-chrome"));

  validarExecutavelWindows(caminhoChrome(resources, "win32"));
  assert(
    !fs.existsSync(path.join(resources, "wppconnect-chrome", "creds.json")),
  );

  pe.writeUInt16LE(0xaa64, 132);
  fs.writeFileSync(exe, pe);

  assert.throws(() => prepararChrome(exe, "win32", path.join(tmp, "invalid")));
  assert(!fs.existsSync(path.join(tmp, "invalid")));

  fs.writeFileSync(exe, "not an exe");
  assert.throws(() => validarExecutavelWindows(exe));

  const app = path.join(tmp, "Google Chrome for Testing.app");
  const macExe = path.join(
    app,
    "Contents",
    "MacOS",
    "Google Chrome for Testing",
  );
  fs.mkdirSync(path.dirname(macExe), { recursive: true });
  fs.writeFileSync(macExe, "fixture");

  if (process.platform !== "win32") {
    fs.symlinkSync("MacOS", path.join(app, "Contents", "relative-link"));
  }

  const destMac = prepararChrome(
    macExe,
    "darwin",
    path.join(tmp, "mac-resources", "wppconnect-chrome"),
  );

  assert(
    fs.existsSync(
      path.join(destMac, "Contents", "MacOS", "Google Chrome for Testing"),
    ),
  );

  if (process.platform !== "win32") {
    assert.equal(
      fs.readlinkSync(path.join(destMac, "Contents", "relative-link")),
      "MacOS",
    );
  }

  const modulo = fs.readFileSync(
    path.join(__dirname, "../wpp-worker-modules/05-inicializacao-wpp.js"),
    "utf8",
  );

  const contexto = {
    require: (id) => {
      assert.equal(id, "./scripts/recursos-desktop");
      return { caminhoChrome: (r) => caminhoChrome(r, "win32") };
    },
    process: { resourcesPath: resources },
    fs,
  };

  vm.createContext(contexto);
  vm.runInContext(modulo, contexto);

  assert.equal(
    contexto.obterChromeEmpacotado(),
    caminhoChrome(resources, "win32"),
  );

  const pkg = require("../package.json");

  assert(fs.existsSync(path.join(__dirname, "..", pkg.build.win.icon)));
  assert.deepEqual(pkg.build.win.target, [{ target: "nsis", arch: ["x64"] }]);
  assert(pkg.build.asarUnpack.includes("node_modules/ffmpeg-static/**"));
  assert(pkg.build.files.includes("!**/creds.json"));

  console.log(
    "Empacotamento Windows: caminhos, copia isolada, PE x64, icone, resolucao do worker e regressao Mac PASS",
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
