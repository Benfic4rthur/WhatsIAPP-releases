"use strict";
const path = require('node:path');
const fs = require('node:fs');

function caminhoChrome(resourcesPath, plataforma = process.platform, caminhos = path) {
  if (!resourcesPath) return null;
  const base = caminhos.join(resourcesPath, 'wppconnect-chrome');
  if (plataforma === 'win32') return caminhos.join(base, 'chrome-win64', 'chrome.exe');
  if (plataforma === 'darwin') return caminhos.join(base, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  return null;
}

function validarExecutavelWindows(arquivo) {
  const fd = fs.openSync(arquivo, 'r');
  try {
    const cabecalho = Buffer.alloc(64);
    if (fs.readSync(fd, cabecalho, 0, 64, 0) !== 64 || cabecalho.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Executavel Windows invalido: ${arquivo}`);
    const pe = Buffer.alloc(6);
    if (fs.readSync(fd, pe, 0, 6, cabecalho.readUInt32LE(60)) !== 6 || pe.readUInt32LE(0) !== 0x4550 || pe.readUInt16LE(4) !== 0x8664) throw new Error(`Esperado executavel Windows x64: ${arquivo}`);
  } finally { fs.closeSync(fd); }
}

module.exports = { caminhoChrome, validarExecutavelWindows };
