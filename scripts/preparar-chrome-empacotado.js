"use strict";

const fs = require("fs");
const path = require("path");

function localizarPastaApp(caminho) {
  let atual = path.resolve(caminho || "");

  while (atual && atual !== path.dirname(atual)) {
    if (atual.endsWith(".app")) {
      return atual;
    }
    atual = path.dirname(atual);
  }

  return null;
}

function prepararChrome(executavel, plataforma = process.platform, destinoBase = path.join(__dirname, '..', 'build', 'wppconnect-chrome')) {
  if (!['darwin', 'win32'].includes(plataforma)) throw new Error('Plataforma nao suportada para empacotamento do Chrome.');
  const pastaChrome = plataforma === 'darwin' ? localizarPastaApp(executavel) : path.dirname(executavel);
  if (!pastaChrome || !fs.existsSync(executavel)) throw new Error(`Chrome do Puppeteer nao encontrado: ${executavel}`);
  if (plataforma === 'win32') {
    if (path.basename(executavel).toLowerCase() !== 'chrome.exe') throw new Error('Esperado chrome.exe do Puppeteer.');
    require('./recursos-desktop').validarExecutavelWindows(executavel);
    for (const f of ['chrome.dll', 'icudtl.dat', 'resources.pak', 'locales']) {
      if (!fs.existsSync(path.join(pastaChrome, f))) throw new Error(`Chrome incompleto: ${f}`);
    }
  }
  const destino = path.join(destinoBase, plataforma === 'darwin' ? path.basename(pastaChrome) : 'chrome-win64');
  // Copie somente o navegador, nunca seu perfil ou a pasta inteira do cache.
  fs.rmSync(destinoBase, { recursive: true, force: true });
  fs.mkdirSync(destinoBase, { recursive: true });
  fs.cpSync(pastaChrome, destino, { recursive: true, verbatimSymlinks: true });
  return destino;
}

function main() {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Build suportado apenas no Windows ou macOS.');

  let puppeteer;

  try {
    puppeteer = require("puppeteer");
  } catch (erro) {
    throw new Error(`Puppeteer indisponivel: ${erro?.message || erro}`);
  }

  const executavel = puppeteer.executablePath();
  const destino = prepararChrome(executavel);

  console.log(`Chrome empacotado preparado em ${destino}.`);
}

if (require.main === module) main();
module.exports = { prepararChrome, localizarPastaApp };
