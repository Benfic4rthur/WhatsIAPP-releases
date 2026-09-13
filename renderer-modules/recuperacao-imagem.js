"use strict";
function criarRecuperacaoImagem({ obterMensagem, estaVisivel, recuperar, setTimer = setTimeout, clearTimer = clearTimeout, atraso = 20000, limite = 3 }) {
  const registros = new Map();
  const chave = (conversaId, id) => `${conversaId}:${id}`;
  function concluir(conversaId, id) {
    const k = chave(conversaId, id), r = registros.get(k);
    if (r) { r.concluido = true; clearTimer(r.timer); registros.delete(k); }
  }
  function falhou(conversaId, id) {
    if (!conversaId || !id) return;
    const k = chave(conversaId, id);
    let r = registros.get(k);
    if (!r) { r = { tentativas: 0, timer: null, ocupado: false }; registros.set(k, r); }
    if (r.timer || r.ocupado || r.tentativas >= limite || r.concluido) return;
    r.timer = setTimer(async () => {
      r.timer = null;
      const msg = obterMensagem(conversaId, id);
      if (!msg || msg.apagadaParaTodos || msg.tipo !== 'imagem') { concluir(conversaId, id); return; }
      if (!estaVisivel(conversaId)) return;
      r.ocupado = true; r.tentativas++;
      try { await recuperar(conversaId, msg); } catch {} finally { r.ocupado = false; }
      if (!r.concluido) falhou(conversaId, id);
    }, atraso);
  }
  function encerrar() { for (const r of registros.values()) clearTimer(r.timer); registros.clear(); }
  return { falhou, concluir, encerrar, tentativas: (c,id) => registros.get(chave(c,id))?.tentativas || 0 };
}
module.exports = { criarRecuperacaoImagem };
