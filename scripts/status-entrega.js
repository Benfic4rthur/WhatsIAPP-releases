const ORDEM = { pendente: 0, erro: 0, enviada: 1, entregue: 2, lida: 3 };

function normalizarStatus(valor) {
  return Object.hasOwn(ORDEM, valor) ? valor : null;
}

function mesclarStatus(atual, recebido) {
  atual = normalizarStatus(atual);
  recebido = normalizarStatus(recebido);
  if (!recebido) return atual;
  if (!atual) return recebido;
  if (ORDEM[atual] > ORDEM[recebido]) return atual;
  if (atual === 'erro' && recebido === 'pendente') return atual;
  return recebido;
}

function criarRegistroStatus(storage) {
  const chaveStorage = 'whatsiapp.statusEntrega.v1';
  let registros = new Map();
  let persistenciaAgendada = false;
  try {
    const itens = JSON.parse(storage?.getItem(chaveStorage) || '[]');
    registros = new Map(itens.filter(([k, v]) => typeof k === 'string' && ORDEM[v] > 0));
  } catch {}
  function chave(conversaId, id) {
    return `${String(conversaId).replace(/@c\.us$/i, '@s.whatsapp.net')}:${id}`;
  }
  return {
    mesclar(conversaId, id, ...estados) {
      if (!id) return estados.reduce(mesclarStatus, null);
      const k = chave(conversaId, id);
      const anterior = registros.get(k);
      const estado = estados.reduce(mesclarStatus, anterior || null);
      if (estado && estado !== anterior) {
        registros.set(k, estado);
        while (registros.size > 10000) registros.delete(registros.keys().next().value);
        if (ORDEM[estado] > 0) {
          if (!persistenciaAgendada) {
            persistenciaAgendada = true;
            queueMicrotask(() => {
              persistenciaAgendada = false;
              try { storage?.setItem(chaveStorage, JSON.stringify([...registros].filter(([, v]) => ORDEM[v] > 0))); } catch {}
            });
          }
        }
      }
      return estado;
    },
  };
}

const ROTULOS = {
  pendente: 'Aguardando envio', erro: 'Envio não confirmado',
  enviada: 'Enviada', entregue: 'Entregue', lida: 'Lida',
};
const DESENHOS = {
  pendente: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  erro: '<circle cx="12" cy="12" r="8"/><path d="M12 7v6m0 3h.01"/>',
  enviada: '<path d="m4 12 5 5L20 6"/>',
  entregue: '<path d="m2 12 5 5L18 6m-7 10 2 2L24 7"/>',
  lida: '<path d="m2 12 5 5L18 6m-7 10 2 2L24 7"/>',
};
function criarIndicadorStatus(document, msg, classe = '') {
  const estado = normalizarStatus(msg?.statusEntrega);
  if (!msg?.minha || msg.apagadaParaTodos || msg.tipo === 'apagada' || !estado) return null;
  const el = document.createElement('span');
  el.className = `indicador-entrega indicador-entrega-${estado} ${classe}`;
  el.dataset.statusEntrega = estado;
  el.title = ROTULOS[estado];
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', ROTULOS[estado]);
  el.innerHTML = `<svg viewBox="0 0 26 24" width="18" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DESENHOS[estado]}</svg>`;
  return el;
}

module.exports = { normalizarStatus, mesclarStatus, criarRegistroStatus, criarIndicadorStatus };
