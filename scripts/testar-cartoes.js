"use strict";
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dados = require('./cartoes-mensagem');

function funcao(fonte,nome) {
  const inicio = fonte.search(new RegExp(`(?:async )?function ${nome}\\(`));
  assert(inicio >= 0, `Funcao ausente: ${nome}`);
  const resto = fonte.slice(inicio);
  const proxima = resto.slice(1).search(/\n(?:async )?function /);
  return proxima < 0 ? resto : resto.slice(0,proxima+1);
}
async function testarCartoes() {
  let verificacoes=0;
  const igual=(a,b)=>{assert.deepEqual(a,b);verificacoes++;};
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const l = dados.extrairCartoesBaileys({locationMessage:{degreesLatitude:0,degreesLongitude:-46,name:'Praça',jpegThumbnail:Buffer.from(png,'base64')}});
  igual(l.localizacao.latitude,0);
  igual(l.localizacao.miniatura.startsWith('data:image/png'),true);
  for (const latitude of [null,'',true,91,Infinity]) igual(dados.localizacao({latitude,longitude:0}),null);
  const w = dados.extrairCartoesWpp({type:'location',lat:0,lng:-46,loc:'Rua de teste'});
  const combinado = dados.mesclarCartoes(l,w);
  igual(combinado.localizacao.nome,'Praça');
  igual(combinado.localizacao.endereco,'Rua de teste');
  igual(combinado.localizacao.miniatura,l.localizacao.miniatura);
  const p=dados.extrairCartoesBaileys({extendedTextMessage:{canonicalUrl:'https://example.com/',title:'Teste',description:'Descrição',jpegThumbnail:Buffer.from(png,'base64')}});
  const pw=dados.extrairCartoesWpp({linkPreview:{matchedText:'https://example.com/',title:'Teste',description:'Descrição',thumbnail:png}});
  igual(p,pw);
  igual(dados.mesclarCartoes(p,{previaLink:null}),p);
  igual(dados.mesclarCartoes(p,JSON.parse(JSON.stringify(p))),p);
  igual(dados.previaLink({url:'javascript:alert(1)',titulo:'X'}),null);
  igual(dados.previaLink({url:'file:///etc/passwd',titulo:'X'}),null);
  igual(dados.previaLink({url:'https://example.com'}),null);
  igual(dados.miniatura('data:image/svg+xml;base64,PHN2Zz4='),null);
  igual(dados.miniatura('https://example.com/image.png'),null);

  const raiz=path.join(__dirname,'..');
  const fonte=fs.readFileSync(path.join(raiz,'wpp-worker-modules/02-mensagens-operacoes.js'),'utf8');
  const envios=[], eventos=[];
  const contexto={
    validarLocalizacao:dados.localizacao,extrairCartoesWpp:dados.extrairCartoesWpp,
    client:{sendText:async (...args)=>{envios.push(args);return {id:'ID',ack:1,linkPreview:{matchedText:'https://example.com/',title:'Teste',description:'Descrição',thumbnail:png}}},sendLocation:async (...args)=>{envios.push(args);return {id:'LOC',ack:1}}},
    resolverChatIdParaEnvio:async()=>({origem:'teste@s.whatsapp.net',chatId:'teste@c.us'}),
    normalizarRespostaWpp:r=>r,resolverIdCitacaoWpp:async()=>null,
    emitirMensagemEnviadaWpp:e=>eventos.push(e),extrairIdMensagemWpp:id=>id,
    mensagensEnviadasWpp:new Map(),normalizarAckWpp:()=> 'enviada',
    publicarCartoesEnviadosWpp:async()=>{},desarquivarAposEnvio:async()=>{},console:{log(){}},enviar() {},
  };
  vm.createContext(contexto);
  vm.runInContext(funcao(fonte,'enviarTextoWpp')+'\n'+funcao(fonte,'enviarLocalizacaoWpp'),contexto);
  await contexto.enviarTextoWpp('teste@s.whatsapp.net','https://example.com/');
  igual(envios.length,1);igual(envios[0][2].linkPreview,true);igual(eventos[0].cartoes.previaLink.titulo,'Teste');
  await contexto.enviarLocalizacaoWpp({conversaId:'teste',localizacao:l.localizacao});
  igual(envios[1][1].lat,0);igual(eventos[1].tipo,'localizacao');
  await assert.rejects(()=>contexto.enviarLocalizacaoWpp({localizacao:{latitude:999,longitude:0}}));verificacoes++;
  igual(envios.length,2);
  contexto.client.sendText=async()=>{throw new Error('timeout');};
  await assert.rejects(()=>contexto.enviarTextoWpp('teste','https://example.com/'));verificacoes++;
  igual(eventos.length,2);

  const main=fs.readFileSync(path.join(raiz,'index.js'),'utf8');
  const dedup={mesclarCartoesMensagem:dados.mesclarCartoes,Date,Map,Set,console,
    mensagensRecentesTempoReal:new Map(),mensagensPendentesPrivacidade:[],estadoPrivacidadeConhecido:new Set(['teste']),
    chaveCanonica:x=>x,prepararMensagemComPrivacidade:x=>x,solicitarAtualizacaoPrivacidadeParaMensagem(){},
    enviarParaTela:(canal,payload)=>eventos.push({canal,payload})};
  vm.createContext(dedup);
  for(const nome of ['idMensagemTempoReal','limparMensagensRecentesTempoReal','resumoMensagemTempoReal','mensagemTempoRealComplementar','mensagemTempoRealJaEncaminhada','marcarMensagemTempoRealEncaminhada','encaminharMensagemTempoReal']) vm.runInContext(funcao(main,nome),dedup);
  const inicial={id:'teste',idMensagem:'a',texto:'https://example.com/'};
  dedup.encaminharMensagemTempoReal(inicial);
  dedup.encaminharMensagemTempoReal({...inicial,...p});
  dedup.encaminharMensagemTempoReal({...inicial,...p});
  igual(eventos.slice(2).map(e=>e.canal),['mensagem','mensagem-cartoes']);
  dedup.estadoPrivacidadeConhecido.clear();
  dedup.encaminharMensagemTempoReal({...inicial,idMensagem:'privada'});
  dedup.encaminharMensagemTempoReal({...inicial,idMensagem:'privada',...p});
  igual(dedup.mensagensPendentesPrivacidade.length,1);
  igual(dedup.mensagensPendentesPrivacidade[0].previaLink.titulo,'Teste');
  igual(eventos.length,4);
  return {verificacoes};
}
module.exports={testarCartoes};
if(require.main===module) testarCartoes().then(r=>console.log('Cartoes: PASS',r)).catch(e=>{console.error(e);process.exitCode=1;});
