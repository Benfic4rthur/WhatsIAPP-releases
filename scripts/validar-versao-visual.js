"use strict";
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsiapp-versao-'));
app.setPath('userData', perfil);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1140, height: 760, show: true, title: 'Teste visual da versão — sem conexão', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  // Carrega o HTML/CSS real sem iniciar o renderer de mensagens ou acessar sessoes.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: /\/(renderer\.js|status-ui\.js)$/.test(details.url) });
  });
  await win.loadFile(path.join(__dirname, '../app.html'));
  win.show(); win.focus();
  const texto = await win.webContents.executeJavaScript("document.querySelector('.app-versao')?.textContent");
  if (texto !== `v${require('../package.json').version}`) throw new Error('Badge de versao incorreto: ' + texto);
  await new Promise(resolve => setTimeout(resolve, 400));
  const imagem = path.join(perfil, 'versao.png');
  fs.writeFileSync(imagem, (await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({ versao: texto, visual: 'PASS', imagem }));
  app.quit();
}).catch(e => { console.error(e); process.exitCode = 1; app.quit(); });
