"use strict";
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');
const raiz = path.resolve(__dirname, '..');
const app = path.join(raiz, 'dist/mac-arm64/WhatsIAPP.app');
const arquivo = path.join(app, 'Contents/Resources/app.asar');
const pacote = JSON.parse(asar.extractFile(arquivo, 'package.json'));
const esperado = require('../package.json');
if (pacote.version !== esperado.version || pacote.localTestBuild) throw new Error('Versao de release incorreta');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${pacote.version}`) throw new Error('Tag divergente da versao');
const arquivos = asar.listPackage(arquivo);
const privados = arquivos.filter(f => /\/(creds|storageState|conversas)\.json$|\/\.env(?:$|\.)|\/(tokens|\.wwebjs_auth|\.wwebjs_cache|auth_info_baileys)(\/|$)/i.test(f));
if (privados.length) throw new Error('Dados privados no pacote: ' + privados.join(', '));
const fontes = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' }).split('\0').filter(f => /\.(js|html|css)$/.test(f) && !f.startsWith('.'));
for (const f of fontes.filter(f => !f.endsWith('teste-cartoes-visual.html'))) {
  if (!asar.extractFile(arquivo, f).equals(fs.readFileSync(path.join(raiz, f)))) throw new Error('Fonte divergente: ' + f);
}
function links(d) {
  for (const entrada of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entrada.name);
    if (entrada.isSymbolicLink()) {
      const alvo = path.resolve(path.dirname(p), fs.readlinkSync(p));
      if (!alvo.startsWith(app + path.sep) || !fs.existsSync(alvo)) throw new Error('Atalho externo/invalido: ' + p);
    } else if (entrada.isDirectory()) links(p);
  }
}
links(app);
execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
for (const f of fs.readdirSync(path.join(raiz, 'dist')).filter(f => f.endsWith('.dmg'))) {
  execFileSync('/usr/bin/hdiutil', ['verify', path.join(raiz, 'dist', f)], { stdio: 'inherit' });
}
if (!fs.existsSync(path.join(raiz, 'dist/latest-mac.yml'))) throw new Error('Manifesto de atualizacao ausente');
console.log(`Release ${pacote.version}: fontes, privacidade, links e assinatura PASS`);
