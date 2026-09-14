"use strict";

const assert = require("assert");
const path = require("path");
const {
  MAC_APP_TARGET,
  plataformaUpdater,
  parseSemver,
  compararVersoes,
  ehPrerelease,
  ehVersaoSuperior,
  arquivoWindowsX64Esperado,
  selecionarArquivoWindowsX64,
  validarUpdateWindows,
  selecionarAssetMacArm64,
  selecionarLatestMacYml,
  extrairMetadadosLatestMac,
  urlGitHubPermitida,
  validarCaminhoDmg,
  validarCaminhoAplicacaoMac,
  normalizarEstadoPendente,
  criarScriptQuarentenaTemporario,
} = require("../updater-core");

function teste(nome, fn) {
  try {
    fn();
    console.log(`[UPDATER TEST] OK | ${nome}`);
  } catch (erro) {
    console.error(`[UPDATER TEST] FAIL | ${nome} | ${erro?.message || erro}`);
    throw erro;
  }
}

teste("platform detection", () => {
  assert.strictEqual(plataformaUpdater("win32", "x64"), "windows-x64");
  assert.strictEqual(plataformaUpdater("darwin", "arm64"), "macos-arm64");
  assert.strictEqual(plataformaUpdater("win32", "arm64"), null);
  assert.strictEqual(plataformaUpdater("darwin", "x64"), null);
  assert.strictEqual(plataformaUpdater("linux", "x64"), null);
});

teste("semver parsing and comparison", () => {
  assert.deepStrictEqual(parseSemver("v1.2.3"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: null,
    raw: "1.2.3",
  });
  assert.strictEqual(compararVersoes("1.0.18", "1.0.17"), 1);
  assert.strictEqual(compararVersoes("1.0.9", "1.0.10"), -1);
  assert.strictEqual(compararVersoes("1.0.17", "1.0.17"), 0);
  assert.strictEqual(ehVersaoSuperior("1.0.18", "1.0.17"), true);
  assert.strictEqual(ehVersaoSuperior("1.0.16", "1.0.17"), false);
});

teste("prerelease and downgrade rejection", () => {
  assert.strictEqual(ehPrerelease("1.0.18-beta.1"), true);
  assert.strictEqual(ehVersaoSuperior("1.0.18-beta.1", "1.0.17"), false);
  assert.strictEqual(ehVersaoSuperior("1.0.17", "1.0.18"), false);
});

teste("Windows x64 asset selection", () => {
  const info = {
    version: "1.0.18",
    files: [
      { url: "https://github.com/a/b/releases/download/v1.0.18/WhatsIAPP-Setup-1.0.18-x64.exe" },
    ],
  };
  assert.strictEqual(arquivoWindowsX64Esperado("1.0.18"), "WhatsIAPP-Setup-1.0.18-x64.exe");
  assert.ok(selecionarArquivoWindowsX64(info));
  assert.strictEqual(validarUpdateWindows(info, "1.0.17").ok, true);
});

teste("Windows rejects wrong architecture or mixed Mac metadata", () => {
  assert.strictEqual(
    validarUpdateWindows(
      { version: "1.0.18", files: [{ url: "WhatsIAPP-Setup-1.0.18-arm64.exe" }] },
      "1.0.17",
    ).ok,
    false,
  );
  assert.strictEqual(
    validarUpdateWindows(
      {
        version: "1.0.18",
        files: [
          { url: "WhatsIAPP-Setup-1.0.18-x64.exe" },
          { url: "WhatsIAPP-1.0.18-arm64.dmg" },
        ],
      },
      "1.0.17",
    ).ok,
    false,
  );
});

teste("macOS ARM64 DMG selection", () => {
  const assets = [
    { name: "WhatsIAPP-1.0.18-arm64-mac.zip" },
    { name: "WhatsIAPP-1.0.18-arm64.dmg", browser_download_url: "https://github.com/a/b/file" },
    { name: "latest-mac.yml" },
  ];
  assert.strictEqual(selecionarAssetMacArm64(assets, "1.0.18")?.name, "WhatsIAPP-1.0.18-arm64.dmg");
  assert.strictEqual(selecionarLatestMacYml(assets)?.name, "latest-mac.yml");
  assert.strictEqual(selecionarAssetMacArm64(assets, "1.0.18-beta.1"), null);
});

teste("latest-mac.yml exact DMG metadata", () => {
  const yml = `version: 1.0.18\nfiles:\n  - url: WhatsIAPP-1.0.18-arm64-mac.zip\n    sha512: ZIPHASH\n    size: 100\n  - url: WhatsIAPP-1.0.18-arm64.dmg\n    sha512: DMGHASH\n    size: 200\npath: WhatsIAPP-1.0.18-arm64-mac.zip\n`;
  assert.deepStrictEqual(extrairMetadadosLatestMac(yml, "WhatsIAPP-1.0.18-arm64.dmg"), {
    url: "WhatsIAPP-1.0.18-arm64.dmg",
    sha512: "DMGHASH",
    size: 200,
  });
});

teste("GitHub URL allowlist", () => {
  assert.strictEqual(urlGitHubPermitida("https://github.com/a/b"), true);
  assert.strictEqual(urlGitHubPermitida("https://api.github.com/repos/a/b"), true);
  assert.strictEqual(urlGitHubPermitida("https://release-assets.githubusercontent.com/file"), true);
  assert.strictEqual(urlGitHubPermitida("https://example.com/file.dmg"), false);
  assert.strictEqual(urlGitHubPermitida("http://github.com/file"), false);
});

teste("DMG path isolation and incomplete path rejection", () => {
  const dir = path.resolve("/tmp/whatsiapp-updates");
  const nome = "WhatsIAPP-1.0.18-arm64.dmg";
  assert.strictEqual(validarCaminhoDmg(path.join(dir, nome), dir, nome), true);
  assert.strictEqual(validarCaminhoDmg(path.join(dir, `${nome}.part`), dir, nome), false);
  assert.strictEqual(validarCaminhoDmg(path.resolve(dir, "..", nome), dir, nome), false);
});

teste("Mac application target isolation", () => {
  assert.strictEqual(MAC_APP_TARGET, "/Applications/WhatsIAPP.app");
  assert.strictEqual(validarCaminhoAplicacaoMac("/Applications/WhatsIAPP.app"), true);
  assert.strictEqual(validarCaminhoAplicacaoMac("/Applications/Other.app"), false);
  assert.strictEqual(validarCaminhoAplicacaoMac("/Applications/WhatsIAPP.app/../Other.app"), false);
});

teste("pending Windows update state", () => {
  const pendente = normalizarEstadoPendente(
    { versao: "1.0.18", arquivo: "/cache/update.exe", baixadoEm: 123, adiado: true },
    "1.0.17",
  );
  assert.strictEqual(pendente?.versao, "1.0.18");
  assert.strictEqual(pendente?.adiado, true);
  assert.strictEqual(normalizarEstadoPendente({ versao: "1.0.17" }, "1.0.17"), null);
  assert.strictEqual(normalizarEstadoPendente({ versao: "1.0.16" }, "1.0.17"), null);
  assert.strictEqual(normalizarEstadoPendente({ versao: "1.0.18-beta.1" }, "1.0.17"), null);
});

teste("temporary quarantine helper stays exact and non-global", () => {
  const script = criarScriptQuarentenaTemporario();
  assert.ok(script.includes('TARGET="/Applications/WhatsIAPP.app"'));
  assert.ok(script.includes('/usr/bin/xattr -dr com.apple.quarantine "$TARGET"'));
  assert.ok(script.includes('if [ "$TARGET" != "/Applications/WhatsIAPP.app" ]'));
  assert.ok(!script.includes("spctl --master-disable"));
  assert.ok(!script.includes("sudo "));
  assert.ok(!script.includes("xattr -cr /Applications"));
});

console.log("[UPDATER TEST] ALL_OK");
