"use strict";
const {mesclarCartoes, urlMapa, localizacao} = require('../scripts/cartoes-mensagem');

function criarCartaoMensagem(document, shell, msg) {
  const dados = mesclarCartoes(msg), l = dados.localizacao, p = dados.previaLink;
  if (!l && !p) return null;
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = `cartao-mensagem ${l ? 'cartao-localizacao' : 'cartao-link'}`;
  const destino = l ? urlMapa(l) : p.url;
  botao.title = destino;
  botao.addEventListener('click', () => { void shell.openExternal(destino).catch(() => {}); });
  const imagem = l?.miniatura || p?.miniatura;
  if (imagem) {
    const img = document.createElement('img');
    img.src = imagem;
    img.alt = l ? 'Miniatura da localização compartilhada' : 'Prévia do link';
    img.addEventListener('error', () => img.remove());
    botao.appendChild(img);
  } else if (l) {
    const pin = document.createElement('div');
    pin.className = 'cartao-localizacao-pin';
    pin.textContent = '📍';
    botao.appendChild(pin);
  }
  const corpo = document.createElement('div');
  corpo.className = 'cartao-mensagem-corpo';
  const titulo = document.createElement('strong');
  titulo.textContent = l ? l.nome || 'Localização compartilhada' : p.titulo || new URL(p.url).hostname;
  corpo.appendChild(titulo);
  const descricao = document.createElement('p');
  descricao.textContent = l ? l.endereco || `${l.latitude}, ${l.longitude}` : p.descricao;
  if (descricao.textContent) corpo.appendChild(descricao);
  const rodape = document.createElement('span');
  rodape.textContent = l ? 'Abrir no mapa ↗' : new URL(p.url).hostname;
  corpo.appendChild(rodape);
  botao.appendChild(corpo);
  return botao;
}

function abrirDialogoLocalizacao({document,ipcRenderer,conversaId,nomeConversa}) {
  const overlay = document.createElement('div');
  overlay.className = 'localizacao-overlay';
  const form = document.createElement('form');
  form.className = 'localizacao-form';
  form.setAttribute('role','dialog');
  form.setAttribute('aria-modal','true');
  form.setAttribute('aria-label','Enviar localização fixa');
  const titulo = document.createElement('h2'); titulo.textContent = 'Enviar localização fixa'; form.appendChild(titulo);
  const info = document.createElement('p'); info.textContent = `Para: ${nomeConversa || conversaId}. Informe o ponto que deseja compartilhar.`; form.appendChild(info);
  const campos = {};
  for (const [nome,rotulo,exemplo] of [
    ['latitude','Latitude','Ex.: -23.5505'],['longitude','Longitude','Ex.: -46.6333'],
    ['nome','Nome do local (opcional)','Ex.: Escritório'],['endereco','Endereço (opcional)','Rua e número'],
  ]) {
    const label = document.createElement('label'); label.textContent = rotulo;
    const input = document.createElement('input'); input.placeholder = exemplo; input.name = nome;
    if (['latitude','longitude'].includes(nome)) {input.required=true;input.inputMode='decimal';}
    input.maxLength = nome === 'endereco' ? 600 : 300;
    campos[nome]=input;label.appendChild(input);form.appendChild(label);
  }
  const status = document.createElement('p'); status.setAttribute('role','status'); form.appendChild(status);
  const botoes = document.createElement('div'); botoes.className='localizacao-acoes';
  const cancelar=document.createElement('button');cancelar.type='button';cancelar.textContent='Cancelar';
  const enviar=document.createElement('button');enviar.type='submit';enviar.textContent='Confirmar e enviar';
  const focoAnterior=document.activeElement;
  const fechar=()=>{overlay.remove();focoAnterior?.focus();};
  cancelar.addEventListener('click',fechar);
  form.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !enviar.disabled){e.preventDefault();fechar();}
    if(e.key==='Tab'){
      const focus=[...form.querySelectorAll('input,button')].filter(el=>!el.disabled);
      if(e.shiftKey && document.activeElement===focus[0]){e.preventDefault();focus.at(-1).focus();}
      else if(!e.shiftKey && document.activeElement===focus.at(-1)){e.preventDefault();focus[0].focus();}
    }
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(enviar.disabled) return;
    const ponto=localizacao(Object.fromEntries(Object.entries(campos).map(([k,v])=>[k,['latitude','longitude'].includes(k)?v.value.replace(',','.'):v.value])));
    if(!ponto){status.textContent='Confira a latitude (-90 a 90) e a longitude (-180 a 180).';return;}
    enviar.disabled=true;cancelar.disabled=true;status.textContent='Enviando localização…';
    try {
      const r=await ipcRenderer.invoke('enviar-localizacao-whatsapp',{conversaId,localizacao:ponto});
      if(!r?.ok) throw new Error(r?.erro || 'Envio não confirmado. Confira a conversa antes de tentar novamente.');
      fechar();
    } catch(erro){status.textContent=erro.message;}
    finally{enviar.disabled=false;cancelar.disabled=false;}
  });
  botoes.append(cancelar,enviar);form.appendChild(botoes);overlay.appendChild(form);document.body.appendChild(overlay);campos.latitude.focus();
}
module.exports={criarCartaoMensagem,abrirDialogoLocalizacao};
