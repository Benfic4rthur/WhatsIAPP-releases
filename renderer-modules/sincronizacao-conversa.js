"use strict";
function criarSincronizacaoConversa({ document, ipcRenderer, obterConversaAtual, carregarMidias }) {
  const barra = document.getElementById('sincronizacaoConversa');
  const texto = barra.querySelector('span'), botao = barra.querySelector('button');
  const estados = new Map();
  function mostrar() {
    const estado = estados.get(obterConversaAtual());
    const visivel = !!estado && !estado.oculto;
    barra.hidden = !visivel;
    document.body?.classList?.toggle('whatsiapp-sync-conversa-visivel', visivel);
    if (!estado) return;
    texto.textContent = estado.texto;
    barra.classList.toggle('carregando', !!estado.ocupado);
    botao.disabled = !!estado.ocupado;
    botao.textContent = estado.erro ? 'Tentar novamente' : 'Atualizar';
  }
  async function atualizar(id, forcar = false) {
    if (!id) { mostrar(); return; }
    const anterior = estados.get(id);
    if (anterior?.ocupado || (!forcar && anterior?.sucessoEm && Date.now() - anterior.sucessoEm < 15000)) { mostrar(); return; }
    const estado = { ocupado: true, texto: 'Mostrando mensagens salvas. Buscando mensagens recentes…' };
    estados.set(id, estado); mostrar();
    try {
      const r = await ipcRenderer.invoke('sincronizar-conversa-recente', { conversaId: id });
      if (!r?.ok) {
        estado.erro = true; estado.aguardando = !!r?.aguardandoConexao;
        estado.texto = r?.erro || 'Não foi possível atualizar as mensagens.';
      } else {
        estado.sucessoEm = Date.now();
        estado.texto = r.janelaLimitada ? 'Últimas 600 mensagens consultadas. Pode haver histórico anterior.' : 'Mensagens recentes atualizadas.';
        if (!r.janelaLimitada) setTimeout(() => {
          if (estados.get(id) !== estado) return;
          estado.oculto = true;
          mostrar();
        }, 3000);
        if (obterConversaAtual() === id) void carregarMidias?.();
      }
    } catch {
      estado.erro = true; estado.texto = 'Falha ao atualizar mensagens. Tente novamente.';
    } finally { estado.ocupado = false; mostrar(); }
  }
  botao.addEventListener('click', () => atualizar(obterConversaAtual(), true));
  ipcRenderer.on('historico-conversa-progresso', (_, dados) => {
    const estado = estados.get(dados?.conversaId);
    if (!estado?.ocupado) return;
    estado.texto = `${Number(dados.importadas || 0)} mensagens adicionadas. Conferindo histórico recente…`;
    mostrar();
  });
  ipcRenderer.on('sincronizacao-etapa', (_, dados) => {
    const id = obterConversaAtual();
    if (dados?.conclusaoBackground && estados.get(id)?.aguardando) void atualizar(id, true);
  });
  return { atualizar, mostrar };
}
module.exports = { criarSincronizacaoConversa };
