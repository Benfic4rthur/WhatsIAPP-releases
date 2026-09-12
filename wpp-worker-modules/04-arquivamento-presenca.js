function chaveFilaArquivamento(conversaId) {
  return (
    chaveCanonica(conversaId) ||
    normalizarId(conversaId) ||
    String(conversaId || "").trim()
  );
}

function enfileirarArquivamentoAguardandoCliente(conversaId, arquivar) {
  const chave = chaveFilaArquivamento(conversaId);

  if (!chave) {
    return false;
  }

  const anterior = arquivamentosAguardandoCliente.get(chave);

  arquivamentosAguardandoCliente.set(chave, {
    conversaId,
    arquivar: !!arquivar,
    tentativas: Number(anterior?.tentativas || 0),
    atualizadoEm: Date.now(),
  });

  console.log(
    `WPPConnect arquivamento na fila: ${chave} -> ${
      arquivar ? "arquivar" : "desarquivar"
    }.`,
  );

  return true;
}

function reagendarArquivamentosAguardando(atraso = 1500) {
  clearTimeout(timerArquivamentosAguardando);

  if (encerrando || !arquivamentosAguardandoCliente.size) {
    return;
  }

  timerArquivamentosAguardando = setTimeout(() => {
    processarArquivamentosAguardandoCliente().catch((erro) => {
      console.error(
        "Erro ao processar fila de arquivamento:",
        erro?.message || erro,
      );
    });
  }, atraso);
}

async function processarArquivamentosAguardandoCliente() {
  if (
    encerrando ||
    !client ||
    processandoArquivamentosAguardando ||
    !arquivamentosAguardandoCliente.size
  ) {
    return;
  }

  processandoArquivamentosAguardando = true;

  try {
    const pendentes = Array.from(arquivamentosAguardandoCliente.entries());

    for (const [chave, itemOriginal] of pendentes) {
      if (encerrando || !client) {
        break;
      }

      const itemAtual = arquivamentosAguardandoCliente.get(chave);

      if (!itemAtual || itemAtual.atualizadoEm !== itemOriginal.atualizadoEm) {
        continue;
      }

      arquivamentosAguardandoCliente.delete(chave);

      try {
        await arquivarConversa(itemAtual.conversaId, itemAtual.arquivar);

        console.log(
          `WPPConnect arquivamento da fila aplicado: ${chave} -> ${
            itemAtual.arquivar ? "arquivado" : "desarquivado"
          }.`,
        );
      } catch (erro) {
        const tentativas = Number(itemAtual.tentativas || 0) + 1;

        if (tentativas <= 8 && !encerrando) {
          arquivamentosAguardandoCliente.set(chave, {
            ...itemAtual,
            tentativas,
          });

          console.warn(
            `WPPConnect arquivamento da fila ainda nao disponivel ` +
              `(${tentativas}/8): ${erro?.message || erro}`,
          );
        } else {
          console.error(
            `WPPConnect arquivamento da fila descartado apos tentativas:`,
            erro?.message || erro,
          );
        }
      }
    }
  } finally {
    processandoArquivamentosAguardando = false;
  }

  if (arquivamentosAguardandoCliente.size) {
    reagendarArquivamentosAguardando(1500);
  }
}

async function arquivarConversa(conversaId, arquivar) {
  if (!client) {
    throw new Error("Módulo de arquivamento ainda não conectado.");
  }

  const chatId = await resolverChatId(conversaId);

  if (!chatId) {
    throw new Error("Não consegui localizar essa conversa no WPPConnect.");
  }

  let resultado = null;

  try {
    resultado = await client.archiveChat(chatId, !!arquivar);
  } catch (erro) {
    const mensagemErro = String(erro?.message || erro || "").toLowerCase();

    const jaNoEstadoDesejado =
      (arquivar && mensagemErro.includes("already archived")) ||
      (!arquivar && mensagemErro.includes("already unarchived"));

    if (!jaNoEstadoDesejado) {
      throw erro;
    }

    resultado = true;

    console.log(
      `WPPConnect: ${chatId} ja estava ${
        arquivar ? "arquivado" : "desarquivado"
      }.`,
    );
  }

  console.log(
    `WPPConnect: ${arquivar ? "arquivado" : "desarquivado"} ${chatId}.`,
  );

  const chave = chaveCanonica(conversaId);

  for (const item of ultimoEstado) {
    const aliases = [item.id, ...(item.aliases || [])];

    if (aliases.some((alias) => chaveCanonica(alias) === chave)) {
      item.arquivada = !!arquivar;
    }
  }

  emitirEstadoSeMudou(true);

  setTimeout(() => {
    atualizarEstadoArquivamento(true, true).catch((erro) => {
      console.error("Erro ao confirmar arquivamento:", erro?.message || erro);
    });
  }, 1200);

  return resultado;
}


// =========================================================
// SINCRONIZACAO RAPIDA DE ARQUIVAMENTO ENTRE DISPOSITIVOS
// =========================================================
// O polling completo de 20s continua como reconciliacao de seguranca.
// Este monitor consulta somente o estado "archive" do ChatStore e, por isso,
// pode rodar a cada 1,5s sem refazer aliases, nomes, LID/PN ou o catalogo todo.
let timerArquivamentoRapidoWpp = null;
let sincronizandoArquivamentoRapidoWpp = false;
let falhaArquivamentoRapidoWppLogada = false;

async function lerArquivadosRapidoWpp() {
  if (
    encerrando ||
    !client?.page ||
    !prontidaoInicialFinalizada ||
    sincronizandoArquivamentoRapidoWpp ||
    !Array.isArray(ultimoEstado) ||
    !ultimoEstado.length
  ) {
    return false;
  }

  sincronizandoArquivamentoRapidoWpp = true;

  try {
    const snapshot = await client.page.evaluate(async () => {
      try {
        const store = window.WPP?.whatsapp?.ChatStore;
        let chats = [];

        if (store && typeof store.getModelsArray === "function") {
          chats = store.getModelsArray();
        } else if (Array.isArray(store?.models)) {
          chats = store.models;
        } else if (Array.isArray(store?._models)) {
          chats = store._models;
        } else if (typeof window.WPP?.chat?.list === "function") {
          const listados = await window.WPP.chat.list();
          chats = Array.isArray(listados) ? listados : [];
        }

        if (!Array.isArray(chats) || !chats.length) {
          return { ok: false, total: 0, arquivados: [] };
        }

        const arquivados = [];

        for (const chat of chats) {
          if (!chat?.archive) continue;

          const id =
            chat?.id?.toString?.() ||
            chat?.id?._serialized ||
            chat?.id ||
            null;

          if (id) arquivados.push(String(id));
        }

        return {
          ok: true,
          total: chats.length,
          arquivados,
        };
      } catch (erro) {
        return {
          ok: false,
          total: 0,
          arquivados: [],
          erro: erro?.message || String(erro),
        };
      }
    });

    const totalRemoto = Number(snapshot?.total || 0) || 0;
    const minimoSeguro = Math.max(20, Math.floor(ultimoEstado.length * 0.7));

    // Nunca aplica um snapshot parcial. Assim uma falha momentanea do store
    // nao consegue desarquivar varias conversas por engano.
    if (!snapshot?.ok || totalRemoto < minimoSeguro) {
      if (!falhaArquivamentoRapidoWppLogada) {
        falhaArquivamentoRapidoWppLogada = true;
        console.warn(
          `[ARQUIVO RAPIDO] SNAPSHOT_IGNORADO | remoto=${totalRemoto} | minimo=${minimoSeguro}`,
        );
      }
      return false;
    }

    falhaArquivamentoRapidoWppLogada = false;

    const chavesArquivadas = new Set(
      (snapshot.arquivados || []).map(chaveCanonica).filter(Boolean),
    );

    let alteracoes = 0;

    for (const item of ultimoEstado) {
      const aliases = [item?.id, ...(item?.aliases || [])];
      const arquivadaAgora = aliases.some((alias) => {
        const chave = chaveCanonica(alias);
        return !!chave && chavesArquivadas.has(chave);
      });

      if (!!item.arquivada !== arquivadaAgora) {
        item.arquivada = arquivadaAgora;
        alteracoes += 1;
      }
    }

    if (alteracoes > 0) {
      emitirEstadoSeMudou(false);

      console.log(
        `[ARQUIVO RAPIDO] ATUALIZADO | alteracoes=${alteracoes} | intervalo=1500ms`,
      );

      return true;
    }

    return false;
  } catch (erro) {
    if (!falhaArquivamentoRapidoWppLogada) {
      falhaArquivamentoRapidoWppLogada = true;
      console.warn(
        `[ARQUIVO RAPIDO] ERRO | ${erro?.message || erro}`,
      );
    }

    return false;
  } finally {
    sincronizandoArquivamentoRapidoWpp = false;
  }
}

function iniciarMonitorArquivamentoRapidoWpp() {
  clearInterval(timerArquivamentoRapidoWpp);

  timerArquivamentoRapidoWpp = setInterval(() => {
    void lerArquivadosRapidoWpp();
  }, 1500);

  // Primeira leitura logo depois que a prontidao permitir.
  setTimeout(() => {
    void lerArquivadosRapidoWpp();
  }, 300);
}

function pararMonitorArquivamentoRapidoWpp() {
  clearInterval(timerArquivamentoRapidoWpp);
  timerArquivamentoRapidoWpp = null;
}

function numeroLastSeen(valor) {
  if (
    valor === false ||
    valor === true ||
    valor === null ||
    valor === undefined
  ) {
    return null;
  }

  const numero = Number(valor);

  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }

  return numero;
}

function normalizarEstadoPresenca(valor, isOnline = false) {
  const estado = String(valor || "")
    .trim()
    .toLowerCase();

  if (estado === "composing" || estado === "typing") {
    return "digitando";
  }

  if (
    estado === "recording" ||
    estado === "recording_audio" ||
    estado === "ptt"
  ) {
    return "gravando";
  }

  if (estado === "available" || isOnline) {
    return "online";
  }

  if (estado === "unavailable") {
    return "offline";
  }

  return isOnline ? "online" : "offline";
}

async function aguardarComTimeoutWpp(promise, ms, fallback = null) {
  let timer = null;

  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function obterLastSeenSeguro(chatId) {
  if (!client || typeof client.getLastSeen !== "function") {
    return null;
  }

  const valor = await aguardarComTimeoutWpp(
    client.getLastSeen(chatId),
    1800,
    null,
  );

  return numeroLastSeen(valor);
}

async function obterOnlineSeguro(chatId) {
  if (!client || typeof client.getChatIsOnline !== "function") {
    return false;
  }

  const valor = await aguardarComTimeoutWpp(
    client.getChatIsOnline(chatId),
    1800,
    false,
  );

  return !!valor;
}

async function resolverIdPresenca(chatId) {
  let id = normalizarId(chatId);

  if (!id) {
    return null;
  }

  if (id.endsWith("@s.whatsapp.net")) {
    return id.replace("@s.whatsapp.net", "@c.us");
  }

  if (id.endsWith("@lid")) {
    const cache = cacheLidPn.get(id);
    let telefoneCache = normalizarId(cache?.phoneNumber);

    if (telefoneCache?.endsWith("@s.whatsapp.net")) {
      return telefoneCache.replace("@s.whatsapp.net", "@c.us");
    }

    if (telefoneCache?.endsWith("@c.us")) {
      return telefoneCache;
    }

    // Procura primeiro nos aliases que ja foram carregados pelo WPPConnect.
    for (const item of ultimoEstado || []) {
      const aliases = [item.id, ...(item.aliases || [])]
        .map(normalizarId)
        .filter(Boolean);

      if (!aliases.includes(id)) {
        continue;
      }

      const telefoneAlias = aliases.find(
        (alias) => alias.endsWith("@c.us") || alias.endsWith("@s.whatsapp.net"),
      );

      if (telefoneAlias?.endsWith("@s.whatsapp.net")) {
        return telefoneAlias.replace("@s.whatsapp.net", "@c.us");
      }

      if (telefoneAlias?.endsWith("@c.us")) {
        return telefoneAlias;
      }
    }

    if (typeof client?.getPnLidEntry === "function") {
      const info = await aguardarComTimeoutWpp(
        client.getPnLidEntry(id),
        1500,
        null,
      );

      if (info) {
        cacheLidPn.set(id, info);
      }

      const telefone = normalizarId(info?.phoneNumber);

      if (telefone?.endsWith("@s.whatsapp.net")) {
        return telefone.replace("@s.whatsapp.net", "@c.us");
      }

      if (telefone?.endsWith("@c.us")) {
        return telefone;
      }
    }
  }

  return id;
}

function limparReforcosPresencaWpp() {
  for (const timer of timersReforcoPresencaWpp) {
    clearTimeout(timer);
  }

  timersReforcoPresencaWpp = [];
}

async function coletarIdsPresencaWpp(idBase, conversaOrigem) {
  const ids = new Set();

  const adicionar = (valor) => {
    let id = normalizarId(valor);

    if (!id) {
      return;
    }

    if (id.endsWith("@s.whatsapp.net")) {
      id = id.replace("@s.whatsapp.net", "@c.us");
    }

    if (id.endsWith("@c.us") || id.endsWith("@lid")) {
      ids.add(id);
    }
  };

  adicionar(idBase);
  adicionar(conversaOrigem);

  const chavesAlvo = new Set(
    Array.from(ids).map(chaveCanonica).filter(Boolean),
  );

  // Aproveita os aliases que o catalogo WPPConnect ja conhece.
  for (const item of ultimoEstado || []) {
    const aliases = [item?.id, ...(item?.aliases || [])]
      .map(normalizarId)
      .filter(Boolean);

    const pertence = aliases.some((alias) =>
      chavesAlvo.has(chaveCanonica(alias)),
    );

    if (!pertence) {
      continue;
    }

    for (const alias of aliases) {
      adicionar(alias);
    }
  }

  // O WPPConnect atual consegue resolver PN <-> LID a partir de ambos.
  // Consultamos pontualmente para assinar os dois identificadores do contato.
  if (client && typeof client.getPnLidEntry === "function") {
    const candidatos = Array.from(ids);

    for (const candidato of candidatos) {
      const info = await aguardarComTimeoutWpp(
        client.getPnLidEntry(candidato),
        1200,
        null,
      );

      if (!info) {
        continue;
      }

      adicionar(info?.lid);
      adicionar(info?.phoneNumber);

      const lid = normalizarId(info?.lid);

      if (lid) {
        cacheLidPn.set(lid, info);
      }
    }
  }

  return ids;
}

function assinarIdsPresencaWpp(ids) {
  if (!client || typeof client.subscribePresence !== "function") {
    return;
  }

  const lista = Array.from(ids || []).filter(Boolean);

  if (!lista.length) {
    return;
  }

  // A API aceita uma lista. Isso reduz a janela em que PN e LID ficam com
  // assinaturas em momentos diferentes.
  Promise.resolve(client.subscribePresence(lista)).catch((erro) => {
    console.warn(
      `WPPConnect presenca: falha ao assinar aliases: ${erro?.message || erro}`,
    );

    // Fallback individual caso uma versao interna rejeite o array.
    for (const id of lista) {
      Promise.resolve(client.subscribePresence(id)).catch(() => {});
    }
  });
}

function agendarReforcosPresencaWpp(ids, conversaOrigem) {
  limparReforcosPresencaWpp();

  const lista = Array.from(ids || []).filter(Boolean);

  if (!lista.length) {
    return;
  }

  const referenciaEvento = ultimaPresencaEventoWppEm;
  const atrasos = [700, 1800, 4000, 7500];

  for (const atraso of atrasos) {
    const timer = setTimeout(() => {
      if (
        encerrando ||
        !client ||
        !presencaConversaAtualOrigem ||
        presencaConversaAtualOrigem !== conversaOrigem ||
        ultimaPresencaEventoWppEm !== referenciaEvento
      ) {
        return;
      }

      assinarIdsPresencaWpp(lista);

      consultarPresencaInicialEmBackground(lista, conversaOrigem).catch(
        () => {},
      );

      console.log(
        `[PRESENCA WPP] reforco de assinatura ` +
          `(aliases=${lista.length}, atraso=${atraso}ms).`,
      );
    }, atraso);

    timersReforcoPresencaWpp.push(timer);
  }
}

async function eventoPertenceAoContatoAtual(evento) {
  if (!evento || !presencaChatAtualWpp) {
    return false;
  }

  const idEvento = normalizarId(evento.id);

  if (!idEvento) {
    return false;
  }

  if (presencaIdsAssinadosWpp.has(idEvento)) {
    return true;
  }

  const chaveEvento = chaveCanonica(idEvento);

  const chaveAtual = chaveCanonica(presencaChatAtualWpp);

  const chaveOrigem = chaveCanonica(presencaConversaAtualOrigem);

  // Match direto, PN/c.us/s.whatsapp.net.
  if (
    chaveEvento &&
    (chaveEvento === chaveAtual || chaveEvento === chaveOrigem)
  ) {
    return true;
  }

  // Match por aliases já conhecidos pelo catálogo WPPConnect.
  const chatEvento = chaveEvento ? aliasesParaChat.get(chaveEvento) : null;

  const chatAtual =
    (chaveAtual && aliasesParaChat.get(chaveAtual)) ||
    (chaveOrigem && aliasesParaChat.get(chaveOrigem)) ||
    presencaChatAtualWpp;

  if (
    chatEvento &&
    chatAtual &&
    chaveCanonica(chatEvento) === chaveCanonica(chatAtual)
  ) {
    return true;
  }

  // Ponto principal da correção:
  // presenceChanged costuma chegar em @lid, mesmo quando a conversa
  // aberta está identificada como @c.us. Se o LID ainda não estiver no
  // nosso cache, resolve na hora usando getPnLidEntry e grava o vínculo.
  if (
    idEvento.endsWith("@lid") &&
    typeof client?.getPnLidEntry === "function"
  ) {
    let info = cacheLidPn.get(idEvento);

    if (!info) {
      try {
        info = await client.getPnLidEntry(idEvento);

        cacheLidPn.set(idEvento, info || null);
      } catch {
        info = null;
      }
    }

    const telefone = normalizarId(info?.phoneNumber);

    const lidResolvido = normalizarId(info?.lid) || idEvento;

    if (telefone) {
      adicionarVariantesDeId(new Set(), telefone);

      const chaveTelefone = chaveCanonica(telefone);

      if (
        chaveTelefone &&
        (chaveTelefone === chaveAtual || chaveTelefone === chaveOrigem)
      ) {
        // Salva o alias para os próximos eventos, evitando nova consulta.
        if (chaveEvento) {
          aliasesParaChat.set(chaveEvento, presencaChatAtualWpp);
        }

        const chaveLid = chaveCanonica(lidResolvido);

        if (chaveLid) {
          aliasesParaChat.set(chaveLid, presencaChatAtualWpp);
        }

        console.log(
          `WPPConnect presença: LID ${idEvento} resolvido para ${telefone}.`,
        );

        return true;
      }
    }
  }

  console.log(
    `WPPConnect presença ignorada por alias: ` +
      `${idEvento} != ${presencaChatAtualWpp}.`,
  );

  return false;
}

async function emitirPresencaWpp(evento) {
  try {
    if (!(await eventoPertenceAoContatoAtual(evento))) {
      return;
    }

    const idEvento = normalizarId(evento.id);

    const conversaOrigem = presencaConversaAtualOrigem || idEvento;

    const tipo = normalizarEstadoPresenca(evento.state, !!evento.isOnline);

    ultimaPresencaEventoWppEm = Date.now();
    limparReforcosPresencaWpp();

    let lastSeen = cachePresenca.get(idEvento)?.lastSeen || null;

    if (tipo === "offline") {
      const consultado = await obterLastSeenSeguro(presencaChatAtualWpp);

      if (consultado) {
        lastSeen = consultado;
      }
    }

    const presenca = {
      tipo,
      lastSeen,
      atualizadoEm: Number(evento.t) || Date.now(),
    };

    cachePresenca.set(idEvento, presenca);

    console.log(`WPPConnect presença: ${tipo} em ${conversaOrigem}.`);

    enviar("presenca", {
      conversaId: conversaOrigem,
      ...presenca,
    });
  } catch (erro) {
    console.error(
      "WPPConnect presença: erro ao processar evento:",
      erro?.message || erro,
    );
  }
}

function removerListenerPresenca() {
  if (!listenerPresenca) {
    return;
  }

  try {
    listenerPresenca.dispose?.();
  } catch {}

  listenerPresenca = null;
}

function registrarEventosPresenca() {
  if (!client || !presencaChatAtualWpp) {
    return;
  }

  removerListenerPresenca();

  if (typeof client.onPresenceChanged !== "function") {
    console.log("WPPConnect: API de presença indisponível nesta versão.");

    return;
  }

  try {
    // IMPORTANTE:
    // Não usamos onPresenceChanged(id, callback).
    // O WPPConnect compara presence.id literalmente com o ID passado.
    // Em contas que usam LID, o evento pode chegar como @lid enquanto
    // a assinatura foi feita como @c.us, e o próprio WPPConnect descarta
    // o evento antes de chamar nosso callback.
    //
    // Escutamos o evento globalmente e fazemos o filtro pelos aliases
    // já conhecidos pelo WhatsIAPP.
    listenerPresenca = client.onPresenceChanged((evento) => {
      const idEvento = normalizarId(evento?.id);

      const estadoEvento = String(evento?.state || "");

      console.log(
        `WPPConnect presença recebida: ` +
          `${idEvento || "sem-id"} ` +
          `${estadoEvento || "-"} ` +
          `(online=${!!evento?.isOnline}).`,
      );

      emitirPresencaWpp(evento);
    });

    console.log(
      `WPPConnect: monitor de presença registrado para ${presencaChatAtualWpp}.`,
    );
  } catch (erro) {
    console.error(
      "WPPConnect presença: não foi possível registrar o monitor:",
      erro?.message || erro,
    );
  }
}

async function consultarPresencaInicialEmBackground(idsWpp, conversaOrigem) {
  if (!client || encerrando) {
    return;
  }

  const ids = Array.isArray(idsWpp)
    ? idsWpp
    : idsWpp instanceof Set
      ? Array.from(idsWpp)
      : [idsWpp];

  const validos = ids.map(normalizarId).filter(Boolean);

  if (!validos.length) {
    return;
  }

  try {
    const resultados = await Promise.all(
      validos.map(async (id) => {
        const [isOnline, lastSeen] = await Promise.all([
          obterOnlineSeguro(id),
          obterLastSeenSeguro(id),
        ]);

        return { id, isOnline, lastSeen };
      }),
    );

    const isOnline = resultados.some((item) => item.isOnline);
    const lastSeen =
      resultados
        .map((item) => Number(item.lastSeen || 0))
        .filter((valor) => Number.isFinite(valor) && valor > 0)
        .sort((a, b) => b - a)[0] || null;

    const presenca = {
      tipo: isOnline ? "online" : "offline",
      lastSeen,
      atualizadoEm: Date.now(),
    };

    for (const id of validos) {
      cachePresenca.set(id, presenca);
    }

    enviar("presenca", {
      conversaId: conversaOrigem,
      aliases: validos,
      ...presenca,
    });
  } catch {}
}

function agendarRevalidacaoPresenca(atraso = 800, motivo = "") {
  clearTimeout(timerRevalidacaoPresenca);

  if (encerrando) {
    return;
  }

  const conversaId =
    presencaConversaDesejada ||
    presencaConversaPendente ||
    presencaConversaAtualOrigem;

  if (!conversaId) {
    return;
  }

  timerRevalidacaoPresenca = setTimeout(() => {
    if (encerrando || !client) {
      return;
    }

    const conversaAtual =
      presencaConversaDesejada ||
      presencaConversaPendente ||
      presencaConversaAtualOrigem;

    if (!conversaAtual) {
      return;
    }

    assinarPresencaWpp(conversaAtual)
      .then(() => {
        console.log(
          `WPPConnect presenca revalidada${motivo ? ` (${motivo})` : ""} para ` +
            `${normalizarId(conversaAtual) || conversaAtual}.`,
        );
      })
      .catch((erro) => {
        console.warn(
          `WPPConnect presenca revalidacao falhou: ${erro?.message || erro}`,
        );
      });
  }, atraso);
}

async function executarPresencaPendente() {
  if (!client || !presencaConversaPendente || encerrando) {
    return;
  }

  const conversaId = presencaConversaPendente;
  presencaConversaPendente = null;

  try {
    const resultado = await assinarPresencaWpp(conversaId);

    if (resultado?.presenca) {
      enviar("presenca", {
        conversaId: resultado.conversaId || conversaId,
        ...resultado.presenca,
      });
    }

    console.log(
      `WPPConnect presenca pendente ativada para ${normalizarId(conversaId) || conversaId}.`,
    );
  } catch (erro) {
    presencaConversaPendente = conversaId;

    console.warn(
      `WPPConnect presenca pendente ainda aguardando: ${erro?.message || erro}`,
    );
  }
}

async function assinarPresencaWpp(conversaId) {
  presencaConversaDesejada = conversaId;

  if (!client) {
    presencaConversaPendente = conversaId;

    console.log(
      `WPPConnect presenca aguardando inicializacao para ${normalizarId(conversaId) || conversaId}.`,
    );

    return {
      disponivel: false,
      pendente: true,
      grupo: false,
      conversaId: normalizarId(conversaId) || conversaId,
      presenca: null,
    };
  }

  const origem = normalizarId(conversaId);

  const chatId = await resolverChatId(conversaId);

  if (!chatId) {
    throw new Error("Não consegui localizar o contato no WPPConnect.");
  }

  const idWpp = await resolverIdPresenca(chatId);

  if (!idWpp || idWpp.endsWith("@g.us")) {
    return {
      disponivel: false,
      grupo: idWpp?.endsWith("@g.us") || false,
      presenca: null,
    };
  }

  const conversaOrigem = origem || conversaId;
  const idsPresenca = await coletarIdsPresencaWpp(idWpp, conversaOrigem);

  limparReforcosPresencaWpp();

  if (
    presencaIdsAssinadosWpp.size &&
    typeof client.unsubscribePresence === "function"
  ) {
    const antigos = Array.from(presencaIdsAssinadosWpp).filter(
      (id) => !idsPresenca.has(id),
    );

    if (antigos.length) {
      Promise.resolve(client.unsubscribePresence(antigos)).catch(() => {});
    }
  }

  presencaChatAtualWpp = idWpp;
  presencaConversaAtualOrigem = conversaOrigem;
  presencaIdsAssinadosWpp = idsPresenca;
  ultimaPresencaEventoWppEm = 0;

  // Listener global primeiro, depois assinamos PN e LID juntos.
  registrarEventosPresenca();
  assinarIdsPresencaWpp(idsPresenca);

  let presencaCache = null;

  for (const id of idsPresenca) {
    if (cachePresenca.has(id)) {
      presencaCache = cachePresenca.get(id);
      break;
    }
  }

  // Snapshot imediato + reforcos curtos. Nao esperamos um minuto pelo primeiro
  // evento de presence_change para descobrir que uma identidade nao assinou.
  consultarPresencaInicialEmBackground(idsPresenca, conversaOrigem).catch(
    () => {},
  );
  agendarReforcosPresencaWpp(idsPresenca, conversaOrigem);

  console.log(
    `[PRESENCA WPP] aliases assinados para ${conversaOrigem}: ` +
      `${Array.from(idsPresenca).join(", ")}.`,
  );

  return {
    disponivel: true,
    grupo: false,
    conversaId: conversaOrigem,
    aliases: Array.from(idsPresenca),
    presenca: presencaCache,
  };
}

function agendarLeituraImediata(atraso = 1500) {
  // Durante a inicializacao, concluirProntidaoInicial() e a unica rotina
  // autorizada a fazer a primeira leitura completa de chats e aliases.
  // Isso evita uma varredura duplicada disparada por NORMAL/CONNECTED/MAIN.
  if (encerrando || !prontidaoInicialFinalizada) return;

  setTimeout(() => {
    if (encerrando || !prontidaoInicialFinalizada) return;

    atualizarEstadoArquivamento(true, true).catch((erro) => {
      console.error("Erro na leitura imediata:", erro?.message || erro);
    });
  }, atraso);
}
