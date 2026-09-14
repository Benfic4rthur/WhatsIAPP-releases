"use strict";
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validarExecutavelWindows } = require('./recursos-desktop');

function validarHost(plataforma = process.platform, arquitetura = process.arch) {
  if (plataforma !== 'win32' || arquitetura !== 'x64') throw new Error('Gere este pacote no Windows x64, com npm ci executado nessa maquina. Nao reutilize node_modules do Mac.');
}

async function main() {
  validarHost();
  const raiz = path.resolve(__dirname, '..');
  const ambiente = { ...process.env };
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN']) delete ambiente[k];
  const run = (exe, args) => execFileSync(exe, args, { cwd: raiz, env: ambiente, stdio: 'inherit', windowsHide: true });
  const ffmpeg = require('ffmpeg-static');
  validarExecutavelWindows(ffmpeg);
  validarExecutavelWindows(require('electron'));
  run(ffmpeg, ['-version']);
  run(process.execPath, ['scripts/preparar-icone-windows.js', 'assets/logo-macos.png', 'assets/logo-taskbar.ico']);
  run(process.execPath, ['scripts/preparar-chrome-empacotado.js']);
  run(process.execPath, ['scripts/testar-empacotamento-windows.js']);
  // Pasta isolada: nao apague os DMGs existentes nem publique nesta etapa.
  run(process.execPath, ['node_modules/electron-builder/cli.js', '--win', 'nsis', '--x64', '--publish', 'never', '-c.directories.output=dist/windows']);
  await require('./verificar-pacote-windows').verificarPacoteWindows(path.join(raiz, 'dist', 'windows', 'win-unpacked'));
  console.log('Windows x64 preparado e pacote verificado. Instalacao e uso ainda precisam de teste no Windows.');
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { validarHost };
