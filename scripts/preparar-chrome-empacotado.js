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

function main() {
  if (process.platform !== "darwin") {
    console.log("Preparacao do Chrome empacotado: ignorada fora do macOS.");
    return;
  }

  let puppeteer;

  try {
    puppeteer = require("puppeteer");
  } catch (erro) {
    throw new Error(`Puppeteer indisponivel: ${erro?.message || erro}`);
  }

  const executavel = puppeteer.executablePath();
  const pastaChrome = localizarPastaApp(executavel);

  if (!pastaChrome || !fs.existsSync(pastaChrome)) {
    throw new Error(
      `Chrome do Puppeteer nao encontrado para empacotamento: ${executavel}`,
    );
  }

  const destinoBase = path.join(__dirname, "..", "build", "wppconnect-chrome");
  const destino = path.join(destinoBase, path.basename(pastaChrome));

  fs.rmSync(destinoBase, { recursive: true, force: true });
  fs.mkdirSync(destinoBase, { recursive: true });
  // Preserve links relativos do framework; resolve-los aqui prende o app ao cache local.
  fs.cpSync(pastaChrome, destino, { recursive: true, verbatimSymlinks: true });

  console.log(`Chrome empacotado preparado em ${destino}.`);
}

main();
