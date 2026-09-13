"use strict";
// Copia somente fontes selecionadas e dependencias para um diretorio temporario.
// Nunca publica, copia userData ou inclui sessoes do ambiente de desenvolvimento.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {execFileSync}=require('child_process');
const raiz=path.resolve(__dirname,'..');
const versao='1.0.13-local.1';
const extras=['scripts/cartoes-mensagem.js','renderer-modules/cartoes-mensagem.js','scripts/testar-cartoes.js'];
const fontes=execFileSync('git',['ls-files','-z'],{cwd:raiz,encoding:'utf8'}).split('\0').filter(Boolean);
const arquivos=[...new Set([...fontes,...extras])].filter(f=>!f.startsWith('.') && !f.startsWith('dist/') && !f.startsWith('build/'));
const proibido=/(^|\/)(tokens|\.wwebjs_auth|\.wwebjs_cache|logs|cache|auth_info_baileys)(\/|$)|(^|\/)(creds|storageState|conversas)\.json$|\.session(?:$|-)|(^|\/)\.env(?:$|\.)/i;
if(arquivos.some(f=>proibido.test(f))) throw new Error('Arquivo de dados encontrado na lista de fontes.');
const destino=path.join(raiz,'dist','teste-local');
const dmg=path.join(destino,`WhatsIAPP-${versao}-arm64.dmg`);
if(fs.existsSync(dmg)) throw new Error('O DMG local ja existe; preserve-o antes de gerar outro.');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'whatsiapp-build-local-'));
console.log('STAGING='+stage);
const ambiente={...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'};
for(const k of ['GH_TOKEN','GITHUB_TOKEN','CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_API_KEY']) delete ambiente[k];
const run=(cmd,args)=>execFileSync(cmd,args,{cwd:stage,env:ambiente,stdio:'inherit'});
(async()=>{
  for(const f of arquivos){fs.mkdirSync(path.dirname(path.join(stage,f)),{recursive:true});fs.copyFileSync(path.join(raiz,f),path.join(stage,f));}
  fs.cpSync(path.join(raiz,'node_modules'),path.join(stage,'node_modules'),{recursive:true,verbatimSymlinks:true});
  const pkg=JSON.parse(fs.readFileSync(path.join(stage,'package.json')));
  pkg.version=versao;pkg.localTestBuild=true;
  pkg.build.files=[...arquivos.filter(f=>f!=='package-lock.json'),'!**/storageState.json','!**/tokens/**/*','!**/.wwebjs_auth/**/*'];
  pkg.build.directories={output:destino};
  pkg.build.mac={...pkg.build.mac,target:[{target:'dmg',arch:['arm64']}],identity:'-',hardenedRuntime:false,notarize:false};
  pkg.build.dmg.title='WhatsIAPP — Teste local';
  pkg.build.artifactName='WhatsIAPP-${version}-${arch}.${ext}';
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(pkg,null,2));
  run(process.execPath,['scripts/preparar-icone-macos.js','assets/logo.png','assets/logo-macos.png']);
  run(process.execPath,['scripts/preparar-chrome-empacotado.js']);
  run(process.execPath,['node_modules/electron-builder/cli.js','--mac','--arm64','--publish','never']);
  const app=path.join(destino,'mac-arm64','WhatsIAPP.app');
  run('/usr/bin/codesign',['--verify','--deep','--strict',app]);
  run('/usr/bin/hdiutil',['verify',dmg]);
  const asar=require('@electron/asar');
  const archive=path.join(app,'Contents/Resources/app.asar');
  const lista=asar.listPackage(archive);
  const suspeitos=lista.filter(f=>proibido.test(f) && (!f.startsWith('/node_modules/') || /\/(creds|storageState|conversas)\.json$|\/\.env(?:$|\.)/i.test(f)));
  if(suspeitos.length) throw new Error('Dados nao permitidos encontrados no pacote: '+suspeitos.join(', '));
  const pacote=JSON.parse(asar.extractFile(archive,'package.json'));
  if(!pacote.localTestBuild || pacote.version!==versao) throw new Error('Metadados do teste local incorretos.');
  for(const f of arquivos.filter(f=>f.endsWith('.js') && !f.startsWith('scripts/aplicar-patches-whatsiapp-old'))){
    if(!asar.extractFile(archive,f).equals(fs.readFileSync(path.join(raiz,f)))) throw new Error('Fonte divergente no pacote: '+f);
  }
  const sha256=crypto.createHash('sha256').update(fs.readFileSync(dmg)).digest('hex');
  console.log(JSON.stringify({dmg,versao,sha256,arquivosNoPacote:lista.length,sessoesIncluidas:false,atualizacaoAutomatica:false}));
  // Remove apenas os intermediarios criados por esta execucao.
  fs.rmSync(stage,{recursive:true,force:true});
  fs.rmSync(path.join(destino,'mac-arm64'),{recursive:true,force:true});
})().catch(e=>{console.error(e.message);console.error('STAGING preservado para diagnostico: '+stage);process.exitCode=1;});
