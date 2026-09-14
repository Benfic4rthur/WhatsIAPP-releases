"use strict";
const assert = require('node:assert/strict'), fs = require('fs'), path = require('path'), vm = require('vm');
async function testarSincronizacaoRecente() {
  const { reconciliarReferenciaMidia } = require('./referencia-midia');
  const arquivo = path.join(__dirname, '../assets/logo.png');
  const ref = reconciliarReferenciaMidia({ mediaPath: arquivo, mediaUrl: 'file:///invalido' });
  assert.equal(ref.mediaPath, arquivo); assert(ref.mediaUrl.endsWith('/assets/logo.png'));
  assert.equal(reconciliarReferenciaMidia({mediaPath:'/nao-existe'}, {mediaPath:arquivo}).mediaPath, arquivo);
  assert.equal(reconciliarReferenciaMidia({mediaPath:'/nao-existe',mediaUrl:'file:///nao-existe'}).mediaUrl, null);

  let tarefas = new Map(), sequencia = 0, chamadas = 0, visivel = true;
  const { criarRecuperacaoImagem } = require('../renderer-modules/recuperacao-imagem');
  const recuperacao = criarRecuperacaoImagem({ obterMensagem: () => ({tipo:'imagem'}), estaVisivel: () => visivel,
    recuperar: async () => { chamadas++; }, setTimer: (fn, ms) => { assert.equal(ms,20000); tarefas.set(++sequencia,fn);return sequencia; }, clearTimer: id => tarefas.delete(id) });
  const executar = async () => { const [id,fn]=tarefas.entries().next().value; tarefas.delete(id); await fn(); };
  recuperacao.falhou('c','m');recuperacao.falhou('c','m');assert.equal(tarefas.size,1);
  await executar(); await executar(); await executar();assert.equal(chamadas,3);assert.equal(tarefas.size,0);
  recuperacao.falhou('c','m');assert.equal(tarefas.size,0);
  recuperacao.falhou('c','outra');recuperacao.concluir('c','outra');assert.equal(tarefas.size,0);
  recuperacao.falhou('c','oculta');visivel=false;await executar();assert.equal(chamadas,3);
  recuperacao.encerrar();

  const contexto = {console:{log(){},warn(){}},client:{getMessages:async()=>[]},fullReady:true,prontidaoInicialFinalizada:true,
    normalizarId:v=>v,chaveCanonica:v=>v,candidatosOperacaoConversaWpp:async()=>({candidatos:['c']}),
    aguardarComTimeoutWpp:async p=>p,timestampMensagemWpp:v=>Number(v)||0,
    serializarId:v=>typeof v==='string'?v:v?.id||null,
    normalizarReacoesWpp:r=>(r?.reactions||[]).map(x=>({emoji:x.aggregateEmoji,total:x.senders.length,minha:!!x.hasReactionByMe}))};
  vm.createContext(contexto);vm.runInContext(fs.readFileSync(path.join(__dirname,'../wpp-worker-modules/historico-gap.js'),'utf8'),contexto);
  contexto.estadosAtuaisHistoricoGapWpp=async()=>[{id:'c',aliases:[],timestamp:105}];
  contexto.normalizarMensagemHistoricoGapWpp=m=>({id:'c',idMensagem:m.id,idMensagemWpp:m.id,timestamp:m.timestamp});
  let r=await contexto.buscarHistoricoGapWpp({conversas:[{id:'c',timestamp:100}]});
  assert.equal(r.processados.length,0);assert.equal(r.resumo.falhas,1);
  contexto.client.getMessages=async()=>[{id:'antes',timestamp:90},{id:'nova',timestamp:105}];
  r=await contexto.buscarHistoricoGapWpp({conversas:[{id:'c',timestamp:100}]});
  assert.equal(r.processados.length,1);assert.equal(r.mensagens.length,2);
  contexto.client.getMessages=async()=>[{id:'incompleta',timestamp:99}];
  r=await contexto.buscarHistoricoGapWpp({conversas:[{id:'c',timestamp:100}]});assert.equal(r.processados.length,0);
  contexto.client.getMessages=async()=>[{id:'com-reacao',timestamp:106,hasReaction:true}];
  contexto.client.getReactions=async id=>({reactions:id==='com-reacao'?[{aggregateEmoji:'😂',hasReactionByMe:false,senders:[{}]}]:[]});
  r=await contexto.buscarHistoricoRecenteConversaWpp({conversaId:'c'});assert.equal(r.ok,true);
  assert.deepEqual(JSON.parse(JSON.stringify(r.mensagens[0].reacoes)),[{emoji:'😂',total:1,minha:false}]);
  contexto.fullReady=false;r=await contexto.buscarHistoricoRecenteConversaWpp({conversaId:'c'});assert.equal(r.aguardandoConexao,true);

  const eventos={},texto={},botao={addEventListener(){}},barra={querySelector:s=>s==='span'?texto:botao,classList:{toggle(){}}};
  const classesCorpo=new Set(),classListCorpo={toggle:(classe,ativa)=>ativa?classesCorpo.add(classe):classesCorpo.delete(classe)};
  let atual='a',resolverA,resolverB,invocacoes=0;
  const ui=require('../renderer-modules/sincronizacao-conversa').criarSincronizacaoConversa({document:{getElementById:()=>barra,body:{classList:classListCorpo}},obterConversaAtual:()=>atual,
    ipcRenderer:{on:(e,fn)=>eventos[e]=fn,invoke:(_,d)=>{invocacoes++;return new Promise(resolve=>{if(d.conversaId==='a')resolverA=resolve;else resolverB=resolve;});}}});
  const a=ui.atualizar('a');await ui.atualizar('a');assert.equal(invocacoes,1);
  atual='b';const b=ui.atualizar('b');resolverA({ok:true,importadas:2});await a;assert(texto.textContent.includes('Buscando'));
  eventos['historico-conversa-progresso'](null,{conversaId:'a',importadas:20});assert(texto.textContent.includes('Buscando'));
  resolverB({ok:false,erro:'Erro simulado'});await b;assert.equal(texto.textContent,'Erro simulado');assert.equal(botao.disabled,false);
  assert.equal(classesCorpo.has('whatsiapp-sync-conversa-visivel'),true);
  atual=null;ui.mostrar();assert.equal(barra.hidden,true);assert.equal(classesCorpo.has('whatsiapp-sync-conversa-visivel'),false);
  return {ok:true,midia:'PASS',historico:'PASS',reacoesOffline:'PASS',indicador:'PASS'};
}
module.exports={testarSincronizacaoRecente};
if(require.main===module)testarSincronizacaoRecente().then(r=>console.log(r)).catch(e=>{console.error(e);process.exitCode=1;});
