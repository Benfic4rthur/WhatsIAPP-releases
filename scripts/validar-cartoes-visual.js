"use strict";
// Processo Electron isolado: nao inicia o aplicativo nem conecta ao WhatsApp.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),os=require('os'),path=require('path');
const destino=process.env.WHATSIAPP_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(),'whatsiapp-cartoes-'));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'whatsiapp-visual-profile-')));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:1140,height:950,show:true,title:'WhatsIAPP — prévia local de teste',webPreferences:{nodeIntegration:true,contextIsolation:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  ipcMain.once('teste-cartoes-pronto',async(_,resultado)=>{
    console.log(JSON.stringify(resultado));
    if(!resultado.ok){process.exitCode=1;app.quit();return;}
    await new Promise(resolve=>setTimeout(resolve,350));
    fs.writeFileSync(path.join(destino,'cartoes-preview.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PREVIEW='+path.join(destino,'cartoes-preview.png'));
    app.quit();
  });
  await win.loadFile(path.join(__dirname,'teste-cartoes-visual.html'));
  win.show();win.focus();
}).catch(e=>{console.error(e);process.exitCode=1;app.quit();});
setTimeout(()=>{console.error('Timeout da validacao visual');process.exitCode=1;app.quit();},20000).unref();
