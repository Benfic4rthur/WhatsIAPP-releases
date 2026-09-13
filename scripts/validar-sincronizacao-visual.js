"use strict";
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),os=require('os');
const perfil=fs.mkdtempSync(path.join(os.tmpdir(),'whatsiapp-sync-visual-'));
app.setPath('userData',perfil);
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1140,height:760,show:true,title:'WhatsIAPP — teste isolado de sincronização',webPreferences:{nodeIntegration:true,contextIsolation:false}});
  win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/\/(renderer\.js|status-ui\.js)$/.test(d.url)}));
  await win.loadFile(path.join(__dirname,'../app.html'));win.show();win.focus();
  await win.webContents.executeJavaScript(`
    window.uiTeste = require('./renderer-modules/sincronizacao-conversa').criarSincronizacaoConversa({
      document, obterConversaAtual:()=> 'teste',
      ipcRenderer:{ on(){},invoke(){return new Promise(r=>window.concluirTeste=r);} }
    });
    window.trabalhoTeste=uiTeste.atualizar('teste');
    void 0;
  `);
  await new Promise(r=>setTimeout(r,250));
  fs.writeFileSync(path.join(perfil,'carregando.png'),(await win.webContents.capturePage()).toPNG());
  const resultado=await win.webContents.executeJavaScript(`(async()=>{
    const assert=require('assert');
    assert(!document.getElementById('sincronizacaoConversa').hidden);
    assert(document.querySelector('#sincronizacaoConversa button').disabled);
    assert(document.getElementById('sincronizacaoConversa').getBoundingClientRect().height < 60, 'Aviso deve ocupar uma faixa compacta');
    assert(document.querySelector('#sincronizacaoConversa button').getBoundingClientRect().width < 180, 'Botao nao deve esticar a faixa');
    concluirTeste({ok:true,importadas:4});await trabalhoTeste;
    assert(document.querySelector('#sincronizacaoConversa span').textContent.includes('atualizadas'));
    assert(!document.querySelector('#sincronizacaoConversa button').disabled);
    const msg={idMensagem:'teste',tipo:'imagem',mediaUrl:'file:///imagem-inexistente-teste.png'};
    const conversa={id:'teste',mensagens:[msg]};
    const mod=require('./renderer-modules/midia').criarModuloMidia({document,window,ipcRenderer:{invoke:async()=>({ok:false})},chatPrincipal:document.querySelector('.chat'),moduloAudio:{},conversas:{teste:conversa},obterConversaAtual:()=> 'teste'});
    const host=document.createElement('div');document.getElementById('mensagens').prepend(host);
    host.appendChild(mod.criarConteudoMidia(msg,conversa));
    await new Promise(r=>setTimeout(r,300));
    assert(host.textContent.includes('Recuperando imagem'));
    msg.mediaUrl=require('url').pathToFileURL(require('path').join(__dirname,'assets/logo.png')).href;
    host.replaceChildren(mod.criarConteudoMidia(msg,conversa));
    await host.querySelector('img').decode();
    assert(host.querySelector('img').naturalWidth>0);
    host.remove();
    await new Promise(r=>setTimeout(r,3100));
    assert(document.getElementById('sincronizacaoConversa').hidden, 'Aviso de sucesso deve desaparecer');
    return {indicador:'PASS',erroImagem:'PASS',recuperacaoPorEvento:'PASS',avisoOcultoAposSucesso:'PASS'};
  })()`);
  fs.writeFileSync(path.join(perfil,'atualizado.png'),(await win.webContents.capturePage()).toPNG());
  console.log(JSON.stringify({...resultado,imagens:perfil}));app.quit();
}).catch(e=>{console.error(e);process.exitCode=1;app.quit();});
