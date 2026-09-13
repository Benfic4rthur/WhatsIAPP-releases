"use strict";
const fs = require('node:fs');
const path = require('node:path');
const { caminhoChrome, validarExecutavelWindows } = require('./recursos-desktop');

async function verificarPacoteWindows(pastaApp) {
  const asar = require('@electron/asar');
  const resources = path.join(pastaApp, 'resources');
  const arquivo = path.join(resources, 'app.asar');
  const nomes = asar.listPackage(arquivo);
  const privados = nomes.filter(f => /\/(creds|storageState|conversas)\.json$|\/\.env(?:$|\.)|\/(tokens|baileys-auth|\.wwebjs_auth|\.wwebjs_cache|auth_info_baileys|wppconnect-profile)(\/|$)/i.test(f));
  if (privados.length) throw new Error('Dados privados no pacote: ' + privados.join(', '));
  const pkg = JSON.parse(asar.extractFile(arquivo, 'package.json'));
  if (pkg.version !== require('../package.json').version || pkg.localTestBuild) throw new Error('Metadados incorretos no pacote Windows.');
  for (const f of ['wpp-worker.js', 'whatsapp-worker.js', 'scripts/recursos-desktop.js', 'wpp-worker-modules/05-inicializacao-wpp.js']) {
    if (!asar.extractFile(arquivo, f).equals(fs.readFileSync(path.join(__dirname, '..', f)))) throw new Error('Fonte divergente: ' + f);
  }
  validarExecutavelWindows(path.join(pastaApp, 'WhatsIAPP.exe'));
  validarExecutavelWindows(caminhoChrome(resources, 'win32'));
  validarExecutavelWindows(path.join(resources, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'));
  // Dependencias do navegador devem estar fora do ASAR, junto de chrome.exe.
  for (const f of ['chrome.dll', 'icudtl.dat', 'resources.pak', 'locales']) {
    if (!fs.existsSync(path.join(resources, 'wppconnect-chrome', 'chrome-win64', f))) throw new Error('Recurso Chrome ausente: ' + f);
  }
  console.log('Pacote Windows: versao, fontes, privacidade e executaveis x64 PASS');
}
module.exports = { verificarPacoteWindows };
