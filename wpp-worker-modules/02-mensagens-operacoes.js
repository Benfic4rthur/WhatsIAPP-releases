const { extrairCartoesWpp, localizacao: validarLocalizacao } = require('./scripts/cartoes-mensagem');
function extrairIdMensagemWpp(valor) {
  if (!valor) {
    return null;
  }

  if (typeof valor === "object") {
    if (typeof valor.id === "string" && valor.id.trim()) {
      return extrairIdMensagemWpp(valor.id);
    }

    if (typeof valor._serialized === "string" && valor._serialized.trim()) {
      return extrairIdMensagemWpp(valor._serialized);
    }
  }

  let texto = String(valor || "").trim();

  if (!texto) {
    return null;
  }

  const partes = texto.split("_").filter(Boolean);

  if (partes.length > 1) {
    if (["out", "in"].includes(String(partes.at(-1)).toLowerCase())) {
      partes.pop();
    }

    const ultimo = partes.at(-1);

    if (ultimo && !ultimo.includes("@")) {
      return ultimo;
    }
  }

  return texto;
}

function normalizarAckWpp(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const ack = Number(valor);

  if (!Number.isFinite(ack)) {
    return null;
  }

  if (ack === 3 || ack === 4 || ack === 5) return "lida";
  if (ack === 2) return "entregue";
  if (ack === 1) return "enviada";
  if (ack === 0) return "pendente";
  if (Number.isInteger(ack) && ack >= -7 && ack <= -1) return "erro";
  return null;
}

function registrarEnvioWpp(idRaw, conversaId) {
  const idMensagem = extrairIdMensagemWpp(idRaw);

  if (!idMensagem || !conversaId) {
    return null;
  }

  mensagensEnviadasWpp.set(idMensagem, {
    conversaId: normalizarId(conversaId) || conversaId,
    criadoEm: Date.now(),
    statusEntrega: mensagensEnviadasWpp.get(idMensagem)?.statusEntrega || null,
  });

  if (mensagensEnviadasWpp.size > 500) {
    const agora = Date.now();

    for (const [id, item] of mensagensEnviadasWpp.entries()) {
      if (agora - Number(item?.criadoEm || 0) > 24 * 60 * 60 * 1000) {
        mensagensEnviadasWpp.delete(id);
      }
    }

    while (mensagensEnviadasWpp.size > 500) {
      const primeiro = mensagensEnviadasWpp.keys().next().value;
      mensagensEnviadasWpp.delete(primeiro);
    }
  }

  return idMensagem;
}


function prioridadeStatusEntregaWpp(status) {
  const mapa = {
    erro: 0.5,
    pendente: 0,
    enviada: 1,
    entregue: 2,
    lida: 3,
  };

  return mapa[String(status || "").trim()] ?? -1;
}

function atualizarStatusConhecidoEnvioWpp(idMensagem, statusEntrega) {
  const id = String(idMensagem || "").trim();
  const status = String(statusEntrega || "").trim();

  if (!id || !status) {
    return false;
  }

  const registro = mensagensEnviadasWpp.get(id);

  if (!registro) {
    return false;
  }

  const atual = String(registro.statusEntrega || "").trim();

  if (
    atual &&
    prioridadeStatusEntregaWpp(status) <= prioridadeStatusEntregaWpp(atual)
  ) {
    return false;
  }

  registro.statusEntrega = status;
  return true;
}

function emitirStatusEntregaWpp(idMensagem, conversaId, statusEntrega, origem = "") {
  const id = String(idMensagem || "").trim();
  const status = String(statusEntrega || "").trim();

  if (
    !id ||
    !conversaId ||
    !status ||
    status === "pendente" ||
    !atualizarStatusConhecidoEnvioWpp(id, status)
  ) {
    return false;
  }

  enviar("mensagem-status", {
    conversaId: normalizarId(conversaId) || conversaId,
    idMensagem: id,
    statusEntrega: status,
  });

  if (origem) {
    console.log(
      `[ACK WPP] ${origem} | id=${id} | status=${status}`,
    );
  }

  return true;
}

function horarioAgora() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function pastaMediaWpp() {
  return path.join(workerData.userDataPath, "media");
}

function garantirPastaMediaWpp() {
  fs.mkdirSync(pastaMediaWpp(), { recursive: true });
}

function sanitizarNomeWpp(nome) {
  return (
    String(nome || "arquivo")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "arquivo"
  );
}

async function resolverChatIdParaEnvio(conversaId) {
  const origem = normalizarId(conversaId);

  if (!origem) {
    throw new Error("Conversa invalida.");
  }

  let chatId = await resolverChatId(origem);

  chatId = normalizarId(chatId);

  if (!chatId) {
    throw new Error("Nao consegui localizar a conversa no WPPConnect.");
  }

  if (chatId.endsWith("@s.whatsapp.net")) {
    chatId = chatId.replace("@s.whatsapp.net", "@c.us");
  }

  if (chatId.endsWith("@lid")) {
    if (typeof client?.getPnLidEntry !== "function") {
      throw new Error("Nao consegui resolver o numero real deste contato.");
    }

    let info = cacheLidPn.get(chatId);

    if (!info) {
      try {
        info = await client.getPnLidEntry(chatId);
        cacheLidPn.set(chatId, info || null);
      } catch {
        info = null;
      }
    }

    let telefone = normalizarId(info?.phoneNumber);

    if (telefone?.endsWith("@s.whatsapp.net")) {
      telefone = telefone.replace("@s.whatsapp.net", "@c.us");
    }

    if (!telefone?.endsWith("@c.us")) {
      throw new Error("Nao consegui resolver o numero real deste contato.");
    }

    chatId = telefone;
  }

  if (!chatId.endsWith("@c.us") && !chatId.endsWith("@g.us")) {
    throw new Error("Destino de envio nao suportado pelo WPPConnect.");
  }

  return {
    origem,
    chatId,
  };
}

function normalizarRespostaWpp(resposta) {
  const idMensagem = String(resposta?.idMensagem || "").trim();

  if (!idMensagem) {
    return null;
  }

  return {
    idMensagem,
    idMensagemWpp: String(resposta?.idMensagemWpp || "").trim() || null,
    minha: !!resposta?.minha,
    texto: String(resposta?.texto || ""),
    tipo: String(resposta?.tipo || "texto"),
    fileName: resposta?.fileName || null,
  };
}

function idsRemotosPossiveisParaCitacao(chatId) {
  const ids = new Set();
  const adicionar = (valor) => {
    const id = normalizarId(valor);

    if (!id) {
      return;
    }

    ids.add(id);

    if (id.endsWith("@c.us")) {
      ids.add(id.replace("@c.us", "@s.whatsapp.net"));
    }

    if (id.endsWith("@s.whatsapp.net")) {
      ids.add(id.replace("@s.whatsapp.net", "@c.us"));
    }
  };

  adicionar(chatId);

  const idAtual = normalizarId(chatId);
  const chaveAtual = chaveCanonica(chatId);

  for (const item of ultimoEstado || []) {
    const aliases = [item.id, ...(item.aliases || [])]
      .map(normalizarId)
      .filter(Boolean);

    const pertence =
      aliases.includes(idAtual) ||
      aliases.some((alias) => {
        const chave = chaveCanonica(alias);

        if (chaveAtual && chave === chaveAtual) {
          return true;
        }

        const resolvido = chave ? aliasesParaChat.get(chave) : null;

        return resolvido && normalizarId(resolvido) === idAtual;
      });

    if (!pertence) {
      continue;
    }

    for (const alias of aliases) {
      adicionar(alias);
    }
  }

  for (const [chave, destino] of aliasesParaChat.entries()) {
    if (normalizarId(destino) !== idAtual) {
      continue;
    }

    if (chave.startsWith("u:")) {
      adicionar(`${chave.slice(2)}@c.us`);
    } else if (chave.startsWith("l:")) {
      adicionar(`${chave.slice(2)}@lid`);
    } else if (chave.startsWith("g:")) {
      adicionar(`${chave.slice(2)}@g.us`);
    }
  }

  return Array.from(ids);
}

function candidatosIdCitacaoWpp(chatId, resposta) {
  const normalizada = normalizarRespostaWpp(resposta);

  if (!normalizada) {
    return [];
  }

  const candidatos = [];
  const vistos = new Set();

  const adicionar = (valor) => {
    const id = String(valor || "").trim();

    if (!id || vistos.has(id)) {
      return;
    }

    vistos.add(id);
    candidatos.push(id);
  };

  adicionar(normalizada.idMensagemWpp);

  if (/^(true|false)_/i.test(normalizada.idMensagem)) {
    adicionar(normalizada.idMensagem);
  }

  const prefixo = normalizada.minha ? "true" : "false";
  const sufixo = normalizada.minha ? "out" : "in";

  for (const remoto of idsRemotosPossiveisParaCitacao(chatId)) {
    adicionar(`${prefixo}_${remoto}_${normalizada.idMensagem}`);
    adicionar(`${prefixo}_${remoto}_${normalizada.idMensagem}_${sufixo}`);
  }

  return candidatos;
}

async function resolverIdCitacaoWpp(chatId, resposta) {
  const normalizada = normalizarRespostaWpp(resposta);

  if (!normalizada) {
    return null;
  }

  const candidatos = candidatosIdCitacaoWpp(chatId, normalizada);

  if (typeof client?.getMessageById === "function") {
    for (const candidato of candidatos) {
      const encontrada = await aguardarComTimeoutWpp(
        client.getMessageById(candidato),
        2500,
        null,
      );

      if (!encontrada || encontrada?.erro) {
        continue;
      }

      const idReal = serializarId(encontrada?.id) || candidato;

      console.log(`WPPConnect citacao resolvida: ${idReal}.`);

      return idReal;
    }
  }

  if (typeof client?.getMessages === "function") {
    try {
      const mensagens = await aguardarComTimeoutWpp(
        client.getMessages(chatId, {
          count: 120,
        }),
        4000,
        [],
      );

      const encontrada = (Array.isArray(mensagens) ? mensagens : []).find(
        (msg) => extrairIdMensagemWpp(msg?.id) === normalizada.idMensagem,
      );

      if (encontrada) {
        const idReal = serializarId(encontrada.id);

        if (idReal) {
          console.log(`WPPConnect citacao localizada no chat: ${idReal}.`);

          return idReal;
        }
      }
    } catch {}
  }

  throw new Error(
    "Nao consegui localizar a mensagem original para responder. " +
      "Tente responder uma mensagem mais recente.",
  );
}

function respostaRecebidaWpp(mensagem) {
  const idBruto =
    mensagem?.quotedMsgId ||
    mensagem?.quotedMsgObj?.id ||
    mensagem?.quotedMsg?.id ||
    null;

  const idMensagem = extrairIdMensagemWpp(idBruto);

  if (!idMensagem) {
    return null;
  }

  const objeto = mensagem?.quotedMsgObj || mensagem?.quotedMsg || null;
  const tipo = objeto ? tipoMensagemRecebidaWpp(objeto) || "texto" : "texto";

  return {
    idMensagem,
    idMensagemWpp: serializarId(idBruto) || null,
    minha: !!objeto?.fromMe,
    texto: objeto ? textoMensagemRecebidaWpp(objeto, tipo) : "",
    tipo,
    fileName: objeto?.filename || objeto?.fileName || null,
  };
}

function emitirMensagemEnviadaWpp({
  conversaId,
  idRaw,
  texto = "",
  tipo = "texto",
  mime = null,
  fileName = null,
  mediaPath = null,
  ack = null,
  resposta = null,
  cartoes = {},
}) {
  const idMensagem = registrarEnvioWpp(idRaw, conversaId);

  if (!idMensagem) {
    return;
  }

  const statusEntregaInicial = normalizarAckWpp(ack);
  atualizarStatusConhecidoEnvioWpp(idMensagem, statusEntregaInicial);

  enviar("mensagem", {
    id: normalizarId(conversaId) || conversaId,
    nome: null,
    arquivada: false,
    idMensagem,
    idMensagemWpp: serializarId(idRaw) || null,
    resposta: normalizarRespostaWpp(resposta),
    texto: String(texto || ""),
    ...cartoes,
    tipo,
    mime,
    fileName,
    viewOnceKind: null,
    horario: horarioAgora(),
    timestamp: Math.floor(Date.now() / 1000),
    minha: true,
    mediaPath: mediaPath || null,
    mediaUrl:
      mediaPath && fs.existsSync(mediaPath)
        ? pathToFileURL(mediaPath).href
        : null,
    rawBase64: null,
    statusEntrega: mensagensEnviadasWpp.get(idMensagem)?.statusEntrega || statusEntregaInicial,
  });
}

function registrarAckWpp() {
  if (!client || typeof client.onAck !== "function" || listenerAckWpp) {
    return;
  }

  listenerAckWpp = client.onAck((ack) => {
    try {
      const idMensagem = extrairIdMensagemWpp(ack?.id);

      if (!idMensagem) {
        return;
      }

      // ACK pode chegar antes de sendText resolver, ou para uma mensagem
      // historica fora do mapa limitado. Somente IDs explicitamente nossos.
      if (!mensagensEnviadasWpp.has(idMensagem) && ack?.id?.fromMe === true) {
        const destino = normalizarId(ack.id.remote || ack.to);
        if (destino) registrarEnvioWpp(ack.id, destino);
      }
      const registro = mensagensEnviadasWpp.get(idMensagem);

      if (!registro) {
        return;
      }

      const statusEntrega = normalizarAckWpp(ack?.ack);

      if (!statusEntrega || statusEntrega === "pendente") {
        return;
      }

      emitirStatusEntregaWpp(
        idMensagem,
        registro.conversaId,
        statusEntrega,
        "EVENTO",
      );
    } catch (erro) {
      console.error("WPPConnect ACK error:", erro?.message || erro);
    }
  });

  console.log("WPPConnect: monitor de ACK registrado.");
}

async function desarquivarAposEnvio(conversaId, chatId) {
  if (!client || !conversaId) {
    return;
  }

  const chave = chaveCanonica(conversaId);

  if (!chave) {
    return;
  }

  let encontrada = false;
  let estavaArquivada = false;

  for (const item of ultimoEstado || []) {
    const aliases = [item.id, ...(item.aliases || [])];

    if (aliases.some((alias) => chaveCanonica(alias) === chave)) {
      encontrada = true;
      estavaArquivada = !!item.arquivada;
      break;
    }
  }

  if (!encontrada || !estavaArquivada) {
    return;
  }

  const destino =
    normalizarId(chatId) || normalizarId(await resolverChatId(conversaId));

  if (!destino) {
    return;
  }

  try {
    marcarDesarquivamentoPendente(chave);

    await client.archiveChat(destino, false);

    for (const item of ultimoEstado || []) {
      const aliases = [item.id, ...(item.aliases || [])];

      if (aliases.some((alias) => chaveCanonica(alias) === chave)) {
        item.arquivada = false;
      }
    }

    emitirEstadoSeMudou(true);

    console.log(`WPPConnect desarquivado apos envio: ${destino}.`);

    setTimeout(() => {
      atualizarEstadoArquivamento(true, true).catch(() => {});
    }, 2500);
  } catch (erro) {
    console.warn(
      `WPPConnect falhou ao desarquivar apos envio: ${erro?.message || erro}`,
    );
  }
}

function extrairIdResultadoEncaminhamento(resultado) {
  const item = Array.isArray(resultado) ? resultado[0] : resultado;

  if (!item) {
    return null;
  }

  if (typeof item === "string") {
    return item;
  }

  return (
    item?.id || item?.key?.id || item?._serialized || item?.messageId || null
  );
}

function normalizarMensagemEncaminharWpp(mensagem) {
  const idMensagem = String(mensagem?.idMensagem || "").trim();

  if (!idMensagem) {
    return null;
  }

  return {
    idMensagem,
    idMensagemWpp: String(mensagem?.idMensagemWpp || "").trim() || null,
    minha: !!mensagem?.minha,
    texto: String(mensagem?.texto || ""),
    tipo: String(mensagem?.tipo || "texto"),
    mime: mensagem?.mime || null,
    fileName: mensagem?.fileName || null,
    mediaPath:
      mensagem?.mediaPath && fs.existsSync(mensagem.mediaPath)
        ? mensagem.mediaPath
        : null,
  };
}

function normalizarEmojiReacaoWpp(emoji) {
  const texto = String(emoji || "").trim();

  if (["♥", "♥️", "❤", "❤️"].includes(texto)) {
    return "❤️";
  }

  return texto;
}

function normalizarReacoesWpp(resultado) {
  const lista = [];
  const porEmoji = new Map();

  const adicionar = (emoji, total, minha) => {
    const texto = normalizarEmojiReacaoWpp(emoji);
    const quantidade = Math.max(0, Number(total || 0) || 0);

    if (!texto || quantidade <= 0) {
      return;
    }

    const anterior = porEmoji.get(texto);

    porEmoji.set(texto, {
      emoji: texto,
      total: Math.max(quantidade, Number(anterior?.total || 0) || 0),
      minha: !!minha || !!anterior?.minha,
    });
  };

  for (const item of Array.isArray(resultado?.reactions)
    ? resultado.reactions
    : []) {
    const senders = Array.isArray(item?.senders) ? item.senders : [];
    const total =
      senders.length || Number(item?.count || item?.total || 0) || 0;

    adicionar(
      item?.aggregateEmoji || item?.emoji || item?.reactionText,
      total,
      !!item?.hasReactionByMe,
    );
  }

  const minha = resultado?.reactionByMe;
  const emojiMinha = normalizarEmojiReacaoWpp(minha?.reactionText);

  if (emojiMinha) {
    const existente = porEmoji.get(emojiMinha);

    adicionar(
      emojiMinha,
      Math.max(1, Number(existente?.total || 0) || 0),
      true,
    );
  }

  for (const item of porEmoji.values()) {
    lista.push(item);
  }

  return lista;
}

async function obterReacoesMensagemWpp(idReal) {
  if (!client || typeof client.getReactions !== "function" || !idReal) {
    return [];
  }

  try {
    const resultado = await aguardarComTimeoutWpp(
      client.getReactions(idReal),
      3500,
      null,
    );

    return normalizarReacoesWpp(resultado);
  } catch {
    return [];
  }
}

async function resolverConversaDaMensagemWpp(mensagem) {
  let id = normalizarId(
    mensagem?.chatId ||
      mensagem?.chat?.id ||
      (mensagem?.fromMe ? mensagem?.to : mensagem?.from),
  );

  if (!id) {
    return null;
  }

  if (id.endsWith("@c.us")) {
    return id.replace("@c.us", "@s.whatsapp.net");
  }

  if (id.endsWith("@lid") && typeof client?.getPnLidEntry === "function") {
    let info = cacheLidPn.get(id);

    if (!info) {
      try {
        info = await client.getPnLidEntry(id);
        cacheLidPn.set(id, info || null);
      } catch {
        info = null;
      }
    }

    const telefone = converterIdWppParaBaileys(info?.phoneNumber);

    if (telefone) {
      return telefone;
    }
  }

  return id;
}

async function reagirMensagemWpp(conversaId, mensagem, reacao) {
  if (!client || typeof client.sendReactionToMessage !== "function") {
    throw new Error("Reacoes indisponiveis no WPPConnect.");
  }

  const alvo = normalizarRespostaWpp(mensagem);

  if (!alvo || !alvo.idMensagem) {
    throw new Error("Mensagem invalida para reacao.");
  }

  const reacaoFinal =
    reacao === false ? false : normalizarEmojiReacaoWpp(reacao);

  if (reacaoFinal !== false && !reacaoFinal) {
    throw new Error("Reacao invalida.");
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);

  let idReal = null;

  try {
    idReal = await resolverIdCitacaoWpp(chatId, alvo);
  } catch {
    throw new Error(
      "Nao consegui localizar a mensagem no WhatsApp Web para reagir.",
    );
  }

  if (!idReal) {
    throw new Error(
      "Nao consegui localizar a mensagem no WhatsApp Web para reagir.",
    );
  }

  console.log(
    `WPPConnect reacao: mensagem=${alvo.idMensagem}, ` +
      `emoji=${reacaoFinal === false ? "remover" : reacaoFinal}.`,
  );

  const resultado = await client.sendReactionToMessage(idReal, reacaoFinal);

  if (resultado === false || resultado === null || resultado === undefined) {
    throw new Error("O WhatsApp Web nao confirmou a reacao.");
  }

  await new Promise((resolve) => setTimeout(resolve, 180));

  const reacoes = await obterReacoesMensagemWpp(idReal);

  console.log(`WPPConnect reacao aplicada: ${alvo.idMensagem}.`);

  return {
    idMensagem: alvo.idMensagem,
    conversaId: origem,
    reacoes,
    reacao: reacaoFinal,
    via: "wppconnect",
  };
}

async function processarReacaoRecebidaWpp(evento) {
  if (!client || !evento?.msgId) {
    return;
  }

  const idReal = serializarId(evento.msgId) || String(evento.msgId || "");
  const idMensagem = extrairIdMensagemWpp(idReal);

  if (!idMensagem) {
    return;
  }

  let mensagemReal = null;

  if (typeof client.getMessageById === "function") {
    mensagemReal = await aguardarComTimeoutWpp(
      client.getMessageById(idReal),
      3000,
      null,
    );
  }

  let conversaId = await resolverConversaDaMensagemWpp(mensagemReal);

  if (!conversaId) {
    conversaId = mensagensEnviadasWpp.get(idMensagem)?.conversaId || null;
  }

  if (!conversaId) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 120));

  const reacoes = await obterReacoesMensagemWpp(idReal);

  enviar("mensagem-status", {
    conversaId,
    idMensagem,
    reacoes,
  });

  console.log(
    `WPPConnect reacao atualizada: ${idMensagem}, ${reacoes.length} emojis.`,
  );
}

function registrarReacoesWpp() {
  if (
    !client ||
    typeof client.onReactionMessage !== "function" ||
    listenerReacoesWpp
  ) {
    return false;
  }

  try {
    listenerReacoesWpp = client.onReactionMessage((evento) => {
      processarReacaoRecebidaWpp(evento).catch((erro) => {
        console.error(
          "WPPConnect reacao: erro ao processar evento:",
          erro?.message || erro,
        );
      });
    });

    console.log("WPPConnect: monitor de reacoes registrado.");

    return true;
  } catch (erro) {
    console.error(
      "WPPConnect: falha ao registrar reacoes:",
      erro?.message || erro,
    );

    return false;
  }
}

async function favoritarMensagemWpp(conversaId, mensagem, favoritar = true) {
  if (!client) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  const alvo = normalizarRespostaWpp(mensagem);

  if (!alvo || !alvo.idMensagem) {
    throw new Error("Mensagem invalida para favorito.");
  }

  const origem = normalizarId(conversaId) || conversaId;

  // O favorito do WhatsIAPP e persistido pelo renderer. Tentamos tambem
  // sincronizar com o favorito nativo do WhatsApp, mas o WA-JS 4.6.0 pode
  // expor starMessage enquanto o WhatsApp Web atual nao expoe mais
  // Cmd.sendStarMsgs/sendUnstarMsgs. Nesse caso nao deixamos o recurso local
  // falhar por causa da incompatibilidade da biblioteca.
  if (typeof client.starMessage !== "function") {
    console.warn(
      "WPPConnect favorito nativo indisponivel, usando favorito local.",
    );

    return {
      idMensagem: alvo.idMensagem,
      conversaId: origem,
      favoritada: !!favoritar,
      via: "local",
      sincronizadoWhatsapp: false,
    };
  }

  let chatId = null;
  let idReal = null;

  try {
    const resolvido = await resolverChatIdParaEnvio(conversaId);
    chatId = resolvido.chatId;
    idReal = await resolverIdCitacaoWpp(chatId, alvo);
  } catch (erro) {
    console.warn(
      `WPPConnect favorito: nao foi possivel preparar sincronizacao nativa, ` +
        `usando favorito local: ${erro?.message || erro}`,
    );

    return {
      idMensagem: alvo.idMensagem,
      conversaId: origem,
      favoritada: !!favoritar,
      via: "local",
      sincronizadoWhatsapp: false,
    };
  }

  if (!idReal) {
    return {
      idMensagem: alvo.idMensagem,
      conversaId: origem,
      favoritada: !!favoritar,
      via: "local",
      sincronizadoWhatsapp: false,
    };
  }

  console.log(
    `WPPConnect favorito: mensagem=${alvo.idMensagem}, ` +
      `favoritar=${!!favoritar}.`,
  );

  try {
    const resultado = await client.starMessage(idReal, !!favoritar);

    if (resultado !== null && resultado !== undefined) {
      console.log(
        `WPPConnect mensagem ${favoritar ? "favoritada" : "desfavoritada"}: ` +
          `${alvo.idMensagem}.`,
      );

      return {
        idMensagem: alvo.idMensagem,
        conversaId: origem,
        favoritada: !!favoritar,
        via: "wppconnect",
        sincronizadoWhatsapp: true,
      };
    }
  } catch (erro) {
    const detalhe = String(erro?.message || erro || "").toLowerCase();
    const incompatibilidadeStar =
      detalhe.includes("sendstarmsgs is not a function") ||
      detalhe.includes("sendunstarmsgs is not a function") ||
      detalhe.includes("starmsgs") ||
      detalhe.includes("unstarmsgs");

    if (!incompatibilidadeStar) {
      throw erro;
    }

    console.warn(
      "WPPConnect favorito nativo incompativel com o WhatsApp Web atual, " +
        "usando favorito local.",
    );
  }

  return {
    idMensagem: alvo.idMensagem,
    conversaId: origem,
    favoritada: !!favoritar,
    via: "local",
    sincronizadoWhatsapp: false,
  };
}

async function editarMensagemWpp(conversaId, mensagem, novoTexto) {
  if (!client || typeof client.editMessage !== "function") {
    throw new Error("Edicao de mensagem indisponivel no WPPConnect.");
  }

  const alvo = normalizarRespostaWpp(mensagem);
  const conteudo = String(novoTexto || "").trim();

  if (!alvo || !alvo.idMensagem) {
    throw new Error("Mensagem invalida para edicao.");
  }

  if (!alvo.minha) {
    throw new Error("So mensagens enviadas por voce podem ser editadas.");
  }

  if (String(alvo.tipo || "").toLowerCase() !== "texto") {
    throw new Error(
      "Por enquanto, apenas mensagens de texto podem ser editadas.",
    );
  }

  if (!conteudo) {
    throw new Error("A mensagem nao pode ficar vazia.");
  }

  if (conteudo === String(alvo.texto || "").trim()) {
    return {
      idMensagem: alvo.idMensagem,
      conversaId: normalizarId(conversaId) || conversaId,
      texto: conteudo,
      editada: false,
      semAlteracao: true,
      via: "wppconnect",
    };
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);

  let idReal = null;

  try {
    idReal = await resolverIdCitacaoWpp(chatId, alvo);
  } catch {
    throw new Error(
      "Nao consegui localizar a mensagem no WhatsApp Web para editar.",
    );
  }

  if (!idReal) {
    throw new Error(
      "Nao consegui localizar a mensagem no WhatsApp Web para editar.",
    );
  }

  console.log(
    `WPPConnect edicao: mensagem=${alvo.idMensagem}, idReal=${idReal}.`,
  );

  let resultado = null;

  try {
    resultado = await client.editMessage(idReal, conteudo);
  } catch (erro) {
    const detalhe = String(erro?.message || erro || "").trim();

    console.warn(`WPPConnect edicao recusada: ${detalhe || "sem detalhe"}.`);

    throw new Error(
      "O WhatsApp nao permitiu editar esta mensagem. " +
        "Ela pode estar fora do prazo permitido para edicao.",
    );
  }

  if (!resultado) {
    throw new Error("O WhatsApp Web nao confirmou a edicao da mensagem.");
  }

  console.log(`WPPConnect mensagem editada: ${alvo.idMensagem}.`);

  return {
    idMensagem: alvo.idMensagem,
    conversaId: origem,
    texto: conteudo,
    editada: true,
    via: "wppconnect",
  };
}

async function candidatosOperacaoConversaWpp(conversaId) {
  const origem = normalizarId(conversaId);

  if (!origem) {
    throw new Error("Conversa invalida.");
  }

  const candidatos = [];
  const vistos = new Set();

  const adicionar = (valor) => {
    let id = normalizarId(valor);

    if (!id) {
      return;
    }

    if (id.endsWith("@s.whatsapp.net")) {
      id = id.replace("@s.whatsapp.net", "@c.us");
    }

    if (vistos.has(id)) {
      return;
    }

    vistos.add(id);
    candidatos.push(id);
  };

  const chaveOrigem = chaveCanonica(origem);

  // Prefere o ID real que veio da lista do WhatsApp Web. Em algumas contas
  // ele e @lid, e operacoes de chat funcionam melhor com esse ID exato.
  for (const item of ultimoEstado || []) {
    const aliases = [item?.id, ...(item?.aliases || [])];

    if (!aliases.some((alias) => chaveCanonica(alias) === chaveOrigem)) {
      continue;
    }

    adicionar(item.id);

    for (const alias of aliases) {
      if (normalizarId(alias)?.endsWith("@lid")) {
        adicionar(alias);
      }
    }
  }

  adicionar(await resolverChatId(origem));
  adicionar(origem);

  // Fallback para o ID de envio, normalmente @c.us.
  try {
    const envio = await resolverChatIdParaEnvio(origem);
    adicionar(envio?.chatId);
  } catch {}

  return {
    origem,
    candidatos,
  };
}

function prepararAlvosExclusaoConversaWpp(origem, candidatos = []) {
  const ids = new Set();
  const chaves = new Set();

  const adicionar = (valor) => {
    const id = normalizarId(valor);

    if (!id) {
      return;
    }

    adicionarVariantesDeId(ids, id);

    const chave = chaveCanonica(id);

    if (chave) {
      chaves.add(chave);
    }
  };

  adicionar(origem);

  for (const candidato of candidatos || []) {
    adicionar(candidato);
  }

  // Captura todos os aliases conhecidos antes de qualquer limpeza local.
  // Isso cobre principalmente conversas que alternam entre @lid e telefone.
  for (const item of ultimoEstado || []) {
    const aliases = [item?.id, ...(item?.aliases || [])]
      .map(normalizarId)
      .filter(Boolean);

    if (
      aliases.some((alias) => {
        const chave = chaveCanonica(alias);
        return chave && chaves.has(chave);
      })
    ) {
      for (const alias of aliases) {
        adicionar(alias);
      }
    }
  }

  return {
    ids: Array.from(ids),
    chaves,
  };
}

async function verificarExclusaoConversaWpp(alvos) {
  const idsAlvo = Array.isArray(alvos?.ids) ? alvos.ids : [];
  const chavesAlvo = alvos?.chaves instanceof Set ? alvos.chaves : new Set();

  if (!idsAlvo.length || !chavesAlvo.size) {
    return { confirmavel: false, existe: null };
  }

  let direta = null;

  // Consulta direta na ChatStore. WPP.chat.get nao cria conversa.
  if (client?.page) {
    try {
      direta = await aguardarComTimeoutWpp(
        client.page.evaluate((idsPagina) => {
          if (
            typeof WPP === 'undefined' ||
            !WPP.chat ||
            typeof WPP.chat.get !== 'function'
          ) {
            return { disponivel: false, encontrados: [] };
          }

          const encontrados = [];

          for (const id of idsPagina) {
            try {
              const chat = WPP.chat.get(id);

              if (chat) {
                encontrados.push(
                  chat.id?.toString?.() || chat.id?._serialized || id,
                );
              }
            } catch {}
          }

          return { disponivel: true, encontrados };
        }, idsAlvo),
        3000,
        null,
      );
    } catch {
      direta = null;
    }
  }

  if (direta?.disponivel && direta.encontrados?.length) {
    return {
      confirmavel: true,
      existe: true,
      fonte: 'chat-store',
    };
  }

  // Segunda fonte: listagem nova de chats. Nao confia em ultimoEstado,
  // porque esse cache e justamente o que sera atualizado depois.
  let chats = null;

  try {
    chats = await aguardarComTimeoutWpp(listarChatsRobusto(), 4500, null);
  } catch {
    chats = null;
  }

  if (!Array.isArray(chats) || chats.length === 0) {
    return {
      confirmavel: false,
      existe: null,
      fonte: 'lista-indisponivel',
    };
  }

  for (const chat of chats) {
    const aliases = aliasesBasicosDoChat(chat);

    for (const alias of aliases) {
      const chave = chaveCanonica(alias);

      if (chave && chavesAlvo.has(chave)) {
        return {
          confirmavel: true,
          existe: true,
          fonte: 'lista-chats',
        };
      }
    }
  }

  if (direta?.disponivel) {
    return {
      confirmavel: true,
      existe: false,
      fonte: 'chat-store+lista-chats',
    };
  }

  return {
    confirmavel: false,
    existe: null,
    fonte: 'chat-store-indisponivel',
  };
}

async function aguardarExclusaoConversaWpp(alvos, tentativas = 4) {
  const esperas = [350, 700, 1200, 2000];
  let ultima = null;

  for (let i = 0; i < Math.min(tentativas, esperas.length); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, esperas[i]));

    ultima = await verificarExclusaoConversaWpp(alvos);

    console.log(
      `[EXCLUSAO CONVERSA] VERIFICACAO ${i + 1}/${Math.min(tentativas, esperas.length)} | ` +
        `confirmavel=${!!ultima?.confirmavel} | existe=${String(ultima?.existe)} | ` +
        `fonte=${ultima?.fonte || 'nenhuma'}`,
    );

    if (ultima?.confirmavel && ultima.existe === false) {
      return true;
    }

    // Se ainda existe, nao gasta todas as tentativas neste alias.
    // O chamador pode tentar o proximo ID real conhecido (@lid/@c.us).
    if (ultima?.confirmavel && ultima.existe === true && i >= 1) {
      return false;
    }
  }

  return false;
}

async function executarOperacaoConversaWpp(conversaId, acao) {
  if (!client) {
    throw new Error('WPPConnect ainda nao esta conectado.');
  }

  const limpando = acao === 'limpar';
  const apagando = acao === 'apagar';

  if (!limpando && !apagando) {
    throw new Error('Operacao de conversa invalida.');
  }

  if (limpando && typeof client.clearChat !== 'function') {
    throw new Error('Limpeza de conversa indisponivel no WPPConnect.');
  }

  if (apagando && typeof client.deleteChat !== 'function') {
    throw new Error('Exclusao de conversa indisponivel no WPPConnect.');
  }

  const { origem, candidatos } =
    await candidatosOperacaoConversaWpp(conversaId);

  if (!candidatos.length) {
    throw new Error('Nao consegui localizar essa conversa no WhatsApp Web.');
  }

  const alvosExclusao = apagando
    ? prepararAlvosExclusaoConversaWpp(origem, candidatos)
    : null;

  let ultimoErro = null;
  let chatIdUsado = null;
  let algumDeleteAceito = false;
  let ultimoChatAceito = null;

  for (const chatId of candidatos) {
    try {
      const resultado = limpando
        ? await client.clearChat(chatId, false)
        : await client.deleteChat(chatId);

      if (resultado !== true) {
        ultimoErro = new Error(
          limpando
            ? 'O WhatsApp Web nao confirmou a limpeza da conversa.'
            : 'O WhatsApp Web nao aceitou a exclusao da conversa.',
        );
        continue;
      }

      if (limpando) {
        chatIdUsado = chatId;
        break;
      }

      algumDeleteAceito = true;
      ultimoChatAceito = chatId;

      console.log(
        `[EXCLUSAO CONVERSA] COMANDO_ACEITO | chat=${chatId} | ` +
          'aguardando confirmacao real.',
      );

      // Duas leituras sao suficientes antes de tentar o proximo alias.
      // Uma verificacao final mais longa acontece depois, se necessario.
      const confirmada = await aguardarExclusaoConversaWpp(alvosExclusao, 2);

      if (confirmada) {
        chatIdUsado = chatId;
        break;
      }

      ultimoErro = new Error(
        'O WhatsApp aceitou o comando, mas a conversa ainda aparece no ' +
          'estado real. Nada foi removido localmente.',
      );

      console.warn(
        `[EXCLUSAO CONVERSA] AINDA_PRESENTE | chat=${chatId} | ` +
          'tentando outro alias conhecido.',
      );
    } catch (erro) {
      ultimoErro = erro;

      console.warn(
        `WPPConnect ${acao} conversa falhou em ${chatId}: ${erro?.message || erro}`,
      );
    }
  }

  // Pode existir atraso entre o status 200 e a retirada da ChatStore.
  // Faz uma ultima confirmacao antes de declarar falha.
  if (apagando && !chatIdUsado && algumDeleteAceito) {
    const confirmada = await aguardarExclusaoConversaWpp(alvosExclusao, 4);

    if (confirmada) {
      chatIdUsado = ultimoChatAceito;
      console.log(
        `[EXCLUSAO CONVERSA] CONFIRMADA_TARDIA | chat=${chatIdUsado}.`,
      );
    }
  }

  if (!chatIdUsado) {
    if (apagando && algumDeleteAceito) {
      throw (
        ultimoErro ||
        new Error(
          'A exclusao nao foi confirmada pelo estado real do WhatsApp. ' +
            'A conversa foi mantida no WhatsIAPP.',
        )
      );
    }

    throw ultimoErro || new Error('Operacao de conversa nao confirmada.');
  }

  if (apagando) {
    const chaveOrigem = chaveCanonica(origem);
    const idsRemovidos = new Set();

    ultimoEstado = (ultimoEstado || []).filter((item) => {
      const aliases = [item?.id, ...(item?.aliases || [])];
      const pertence = aliases.some(
        (alias) => chaveCanonica(alias) === chaveOrigem,
      );

      if (pertence) {
        adicionarVariantesDeId(idsRemovidos, item?.id);

        for (const alias of aliases) {
          adicionarVariantesDeId(idsRemovidos, alias);
        }
      }

      return !pertence;
    });

    for (const [chave, destino] of Array.from(aliasesParaChat.entries())) {
      const chaveDestino = chaveCanonica(destino);
      const removerPorOrigem = chave === chaveOrigem;
      const removerPorDestino = Array.from(idsRemovidos).some(
        (id) => chaveCanonica(id) === chaveDestino,
      );

      if (removerPorOrigem || removerPorDestino) {
        aliasesParaChat.delete(chave);
      }
    }

    emitirEstadoSeMudou(true);
  }

  console.log(
    `WPPConnect conversa ${limpando ? 'limpa' : 'apagada'}: ${chatIdUsado}.`,
  );

  setTimeout(() => {
    atualizarEstadoArquivamento(true, true).catch((erro) => {
      console.warn(
        `WPPConnect confirmar ${acao} conversa falhou: ${erro?.message || erro}`,
      );
    });
  }, 1200);

  return {
    conversaId: origem,
    acao,
    chatId: chatIdUsado,
    via: 'wppconnect',
  };
}

async function apagarMensagemWpp(conversaId, mensagem, paraTodos = false) {
  if (!client || typeof client.deleteMessage !== "function") {
    throw new Error("Exclusao de mensagem indisponivel no WPPConnect.");
  }

  const alvo = normalizarRespostaWpp(mensagem);

  if (!alvo) {
    throw new Error("Mensagem invalida para exclusao.");
  }

  if (paraTodos && !alvo.minha) {
    throw new Error(
      "So mensagens enviadas por voce podem ser apagadas para todos.",
    );
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);

  let idReal = null;

  try {
    idReal = await resolverIdCitacaoWpp(chatId, alvo);
  } catch {
    throw new Error(
      "Nao consegui localizar a mensagem no WhatsApp Web para apagar.",
    );
  }

  if (!idReal) {
    throw new Error(
      "Nao consegui localizar a mensagem no WhatsApp Web para apagar.",
    );
  }

  // A conversa usada para envio pode ser @c.us, mas o WhatsApp Web pode
  // armazenar a mensagem no chat real identificado por @lid. O deleteMessage
  // exige o ID EXATO do chat onde a mensagem esta armazenada.
  //
  // Como resolverIdCitacaoWpp ja localizou a mensagem, buscamos o objeto real
  // e usamos o chatId/from/to dele antes de cair no ID resolvido para envio.
  let mensagemReal = null;

  if (typeof client.getMessageById === "function") {
    mensagemReal = await aguardarComTimeoutWpp(
      client.getMessageById(idReal),
      2500,
      null,
    );
  }

  const candidatosChatExclusao = [
    mensagemReal?.chatId,
    alvo.minha ? mensagemReal?.to : mensagemReal?.from,
    alvo.minha ? mensagemReal?.from : mensagemReal?.to,
  ];

  let chatIdExclusao = candidatosChatExclusao
    .map((valor) => normalizarId(valor))
    .find(Boolean);

  // Fallback para IDs serializados no formato:
  // true_123456@lid_ID_DA_MENSAGEM_out
  if (!chatIdExclusao) {
    const match = String(idReal || "").match(
      /^(?:true|false)_([^_]+@(c\.us|s\.whatsapp\.net|lid|g\.us))_/i,
    );

    chatIdExclusao = normalizarId(match?.[1]) || null;
  }

  if (!chatIdExclusao) {
    chatIdExclusao = chatId;
  }

  console.log(
    `WPPConnect exclusao: mensagem=${alvo.idMensagem}, ` +
      `chat=${chatIdExclusao}, paraTodos=${!!paraTodos}.`,
  );

  // deleteMessage(chatId, messageId, onlyLocal, deleteMediaInDevice)
  // paraTodos=true => onlyLocal=false (revoga para os participantes).
  const resultado = await client.deleteMessage(
    chatIdExclusao,
    idReal,
    !paraTodos,
    true,
  );

  if (resultado === false) {
    throw new Error("O WhatsApp Web nao confirmou a exclusao da mensagem.");
  }

  mensagensEnviadasWpp.delete(alvo.idMensagem);

  console.log(
    `WPPConnect mensagem apagada ${
      paraTodos ? "para todos" : "localmente"
    }: ${alvo.idMensagem}.`,
  );

  return {
    idMensagem: alvo.idMensagem,
    conversaId: origem,
    apagada: true,
    paraTodos: !!paraTodos,
    via: "wppconnect",
  };
}

async function encaminharMensagemWpp(
  conversaOrigemId,
  conversaDestinoId,
  mensagem,
) {
  if (!client) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  const origemMensagem = normalizarMensagemEncaminharWpp(mensagem);

  if (!origemMensagem) {
    throw new Error("Mensagem original invalida para encaminhamento.");
  }

  if (origemMensagem.tipo === "view_once") {
    throw new Error("Mensagem de visualizacao unica nao pode ser encaminhada.");
  }

  const { origem: origemChat, chatId: chatOrigemId } =
    await resolverChatIdParaEnvio(conversaOrigemId);

  const { origem: destinoOrigem, chatId: chatDestinoId } =
    await resolverChatIdParaEnvio(conversaDestinoId);

  let idReal = null;

  try {
    idReal = await resolverIdCitacaoWpp(chatOrigemId, origemMensagem);
  } catch {
    throw new Error(
      "Nao consegui localizar a mensagem original para encaminhar.",
    );
  }

  if (!idReal) {
    throw new Error(
      "Nao consegui localizar a mensagem original para encaminhar.",
    );
  }

  let resultado = null;
  let erroV2 = null;

  if (typeof client.forwardMessagesV2 === "function") {
    try {
      // WA-JS forwardMessages exige uma lista de mensagens.
      // Passar uma string faz a biblioteca iterar caractere por caractere
      // e tentar resolver IDs invalidos no getMessageById.
      resultado = await client.forwardMessagesV2(chatDestinoId, [idReal]);
    } catch (erro) {
      erroV2 = erro;

      console.warn(
        `WPPConnect forwardMessagesV2 falhou, tentando forwardMessage: ` +
          `${erro?.message || erro}`,
      );
    }
  }

  if (
    (resultado === null || resultado === undefined) &&
    typeof client.forwardMessage === "function"
  ) {
    resultado = await client.forwardMessage(chatDestinoId, idReal);
  }

  if (resultado === false || resultado === null || resultado === undefined) {
    if (erroV2) {
      throw erroV2;
    }

    throw new Error("O WhatsApp Web nao confirmou o encaminhamento.");
  }

  const idRaw = extrairIdResultadoEncaminhamento(resultado);

  if (idRaw) {
    emitirMensagemEnviadaWpp({
      conversaId: destinoOrigem,
      idRaw,
      texto: origemMensagem.texto,
      tipo: origemMensagem.tipo,
      mime: origemMensagem.mime,
      fileName: origemMensagem.fileName,
      mediaPath: origemMensagem.mediaPath,
      ack: resultado?.ack,
      resposta: null,
    });
  }

  await desarquivarAposEnvio(destinoOrigem, chatDestinoId);

  console.log(`WPPConnect encaminhamento: ${origemChat} -> ${destinoOrigem}.`);

  return {
    idMensagem: idRaw ? extrairIdMensagemWpp(idRaw) : null,
    conversaId: destinoOrigem,
    via: "wppconnect",
    encaminhada: true,
  };
}

async function enviarTextoWpp(conversaId, texto, resposta = null, idLocalEnvio = null) {
  if (!client || typeof client.sendText !== "function") {
    throw new Error("WPPConnect ainda nao esta pronto para enviar.");
  }

  const conteudo = String(texto || "").trim();

  if (!conteudo) {
    throw new Error("Digite uma mensagem.");
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);
  const respostaNormalizada = normalizarRespostaWpp(resposta);
  const quotedMsg = await resolverIdCitacaoWpp(chatId, respostaNormalizada);

  const resultado = await client.sendText(
    chatId,
    conteudo,
    { ...(quotedMsg ? { quotedMsg } : {}), linkPreview: true },
  );

  const idRaw = resultado?.id || resultado?.key?.id || resultado?._serialized;

  if (!idRaw) {
    throw new Error("O WhatsApp Web nao confirmou o envio.");
  }

  emitirMensagemEnviadaWpp({
    conversaId: origem,
    idRaw,
    texto: conteudo,
    tipo: "texto",
    ack: resultado?.ack,
    resposta: respostaNormalizada,
    cartoes: extrairCartoesWpp(resultado),
  });

  const statusEntrega = mensagensEnviadasWpp.get(extrairIdMensagemWpp(idRaw))?.statusEntrega || normalizarAckWpp(resultado?.ack);
  // Recupera o modelo com a previa gerada, sem repetir o envio em caso de erro.
  if (/https?:\/\//i.test(conteudo) && !extrairCartoesWpp(resultado).previaLink) {
    void publicarCartoesEnviadosWpp(origem, idRaw, conteudo, 'texto');
  }
  if (idLocalEnvio) {
    enviar('envio-texto-estado', { conversaId, idLocalEnvio, estado: 'concluido',
      idMensagem: extrairIdMensagemWpp(idRaw), statusEntrega });
  }

  await desarquivarAposEnvio(origem, chatId);

  console.log(`WPPConnect envio texto: ${origem} -> ${chatId}.`);

  return {
    idMensagem: extrairIdMensagemWpp(idRaw),
    conversaId: origem,
    via: "wppconnect",
    statusEntrega,
  };
}

async function enviarAnexoWpp(
  conversaId,
  caminho,
  tipo,
  legenda = "",
  resposta = null,
) {
  if (!client) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  if (!caminho || !fs.existsSync(caminho)) {
    throw new Error("O arquivo selecionado nao foi encontrado.");
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);
  const nome = path.basename(caminho);
  const legendaFinal = String(legenda || "").trim();
  const respostaNormalizada = normalizarRespostaWpp(resposta);
  const quotedMsg = await resolverIdCitacaoWpp(chatId, respostaNormalizada);

  let resultado = null;
  let tipoMensagem = "documento";
  let mime = null;

  if (tipo === "imagem") {
    if (typeof client.sendImage !== "function") {
      throw new Error("Envio de imagem indisponivel no WPPConnect.");
    }

    // Copia duravel antes do envio: o renderer nao depende do arquivo escolhido
    // (nem do PNG temporario da area de transferencia) depois da confirmacao.
    garantirPastaMediaWpp();
    const destinoImagem = path.join(pastaMediaWpp(), `imagem_enviada_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(caminho) || '.jpg'}`);
    const temporarioImagem = destinoImagem + '.part';
    fs.copyFileSync(caminho, temporarioImagem);
    if (fs.statSync(temporarioImagem).size === 0) throw new Error('Imagem local vazia.');
    fs.renameSync(temporarioImagem, destinoImagem);
    caminho = destinoImagem;
    resultado = await client.sendImage(
      chatId,
      caminho,
      nome,
      legendaFinal,
      quotedMsg || undefined,
    );

    tipoMensagem = "imagem";
  } else if (tipo === "audio") {
    const bufferAudio = fs.readFileSync(caminho);
    const extensaoAudio = path.extname(caminho).toLowerCase();
    const mimeAudio =
      extensaoAudio === ".ogg" || extensaoAudio === ".opus"
        ? "audio/ogg"
        : extensaoAudio === ".mp3"
          ? "audio/mpeg"
          : extensaoAudio === ".wav"
            ? "audio/wav"
            : extensaoAudio === ".m4a" || extensaoAudio === ".aac"
              ? "audio/mp4"
              : "audio/webm";

    console.log(
      `WPPConnect audio attachment: normalizing ${nome} before send.`,
    );

    return await enviarAudioGravadoWpp(
      conversaId,
      bufferAudio,
      mimeAudio,
      resposta,
    );
  } else if (tipo === "video") {
    if (typeof client.sendFile !== "function") {
      throw new Error("Envio de video indisponivel no WPPConnect.");
    }

    garantirPastaMediaWpp();

    const nomeBaseVideo = path.basename(nome, path.extname(nome));
    const nomeVideo = `${sanitizarNomeWpp(nomeBaseVideo || "video")}_${Date.now()}.mp4`;
    const caminhoVideo = path.join(pastaMediaWpp(), nomeVideo);

    console.log(
      `WPPConnect video attachment: normalizing ${nome} before send.`,
    );

    await converterVideoAnexoParaMp4(caminho, caminhoVideo);

    if (!fs.existsSync(caminhoVideo) || fs.statSync(caminhoVideo).size <= 0) {
      throw new Error("O video MP4 gerado esta vazio.");
    }

    try {
      resultado = await client.sendFile(chatId, caminhoVideo, {
        filename: nomeVideo,
        caption: legendaFinal,
        quotedMsg: quotedMsg || undefined,
        type: "video",
        mimetype: "video/mp4",
        waitForAck: false,
      });
    } catch (erro) {
      const falhaVideo = new Error("Falha no envio de video pelo WPPConnect.");
      falhaVideo.codigo = "WPP_VIDEO_SEND_FAILED";
      falhaVideo.caminhoFallback = caminhoVideo;
      falhaVideo.causa = erro?.message || String(erro || "erro desconhecido");

      console.error(
        `WPPConnect video send failed: ${falhaVideo.causa}. Fallback requested.`,
      );

      throw falhaVideo;
    }

    tipoMensagem = "video";
    mime = "video/mp4";

    if (resultado) {
      resultado.__whatsiappMediaPath = caminhoVideo;
    }
  } else {
    if (typeof client.sendFile !== "function") {
      throw new Error("Envio de arquivo indisponivel no WPPConnect.");
    }

    resultado = quotedMsg
      ? await client.sendFile(chatId, caminho, {
          filename: nome,
          caption: legendaFinal,
          quotedMsg,
        })
      : await client.sendFile(chatId, caminho, nome, legendaFinal);

    tipoMensagem = "documento";
  }

  const idRaw = resultado?.id || resultado?.key?.id || resultado?._serialized;

  if (!idRaw) {
    throw new Error("O WhatsApp Web nao confirmou o envio do arquivo.");
  }

  emitirMensagemEnviadaWpp({
    conversaId: origem,
    idRaw,
    texto: legendaFinal,
    tipo: tipoMensagem,
    mime,
    fileName: tipoMensagem === "documento" ? nome : null,
    mediaPath: resultado?.__whatsiappMediaPath || caminho,
    ack: resultado?.ack,
    resposta: respostaNormalizada,
  });

  await desarquivarAposEnvio(origem, chatId);

  console.log(`WPPConnect envio ${tipoMensagem}: ${origem} -> ${chatId}.`);

  return {
    idMensagem: extrairIdMensagemWpp(idRaw),
    conversaId: origem,
    via: "wppconnect",
  };
}

const cacheConsultaMidiaHistoricaWpp = new Map();

function decodificarMidiaHistoricaDataUrlWpp(valor, mimeFallback = null) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return null;
  }

  const matchDataUrl = texto.match(/^data:([^,]*?);base64,(.*)$/is);
  const payload = String(
    matchDataUrl ? matchDataUrl[2] : texto,
  ).replace(/\s+/g, "");

  // Um Blob vazio pode chegar como "data:<mime>;base64,".
  // Nesse caso nao existe midia para decodificar.
  if (!payload || payload.length < 64 || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    return null;
  }

  return {
    mime:
      String(matchDataUrl?.[1] || "")
        .split(";")[0]
        .trim() ||
      mimeFallback ||
      null,
    buffer: Buffer.from(payload, "base64"),
  };
}

async function forcarRedownloadMidiaWpp(idReal) {
  const id = String(idReal || "").trim();

  if (!id || !client?.page) {
    return null;
  }

  try {
    return await aguardarComTimeoutWpp(
      client.page.evaluate(async (messageId) => {
        try {
          if (
            typeof WPP === "undefined" ||
            !WPP.chat ||
            typeof WPP.chat.getMessageById !== "function"
          ) {
            return null;
          }

          const msg = await WPP.chat.getMessageById(messageId);

          if (
            !msg ||
            !msg.mediaData ||
            typeof msg.downloadMedia !== "function"
          ) {
            return null;
          }

          // Forca o proprio modelo da mensagem a pedir novamente os bytes.
          // Isso evita ficar preso em um Blob vazio que pode existir no cache.
          await msg.downloadMedia({
            downloadEvenIfExpensive: true,
            rmrReason: 1,
            isUserInitiated: true,
          });

          let blob = null;

          try {
            blob = msg.mediaData?.mediaBlob?.forceToBlob?.() || null;
          } catch {
            blob = null;
          }

          if ((!blob || !blob.size) && typeof WPP.chat.downloadMedia === "function") {
            try {
              blob = await WPP.chat.downloadMedia(messageId);
            } catch {
              blob = null;
            }
          }

          if (
            !blob ||
            !blob.size ||
            !WPP.util ||
            typeof WPP.util.blobToBase64 !== "function"
          ) {
            return null;
          }

          return await WPP.util.blobToBase64(blob);
        } catch {
          return null;
        }
      }, id),
      18000,
      null,
    );
  } catch {
    return null;
  }
}

async function listarMensagensParaMidiaHistoricaWpp(
  chatId,
  completa = false,
) {
  const chat = String(chatId || "").trim();
  const chave = `${completa ? "completa" : "recente"}:${chat}`;
  const agora = Date.now();
  const anterior = cacheConsultaMidiaHistoricaWpp.get(chave);
  const ttl = completa ? 60000 : 15000;

  if (anterior && agora - anterior.criadoEm < ttl) {
    return anterior.promise;
  }

  // WA-JS 4.6.0 supports count=-1 for the complete chat history.
  // The complete path runs only after exact-ID and recent-history attempts.
  const promise = aguardarComTimeoutWpp(
    client.getMessages(chat, {
      count: completa ? -1 : 600,
    }),
    completa ? 45000 : 10000,
    [],
  ).then((lista) => (Array.isArray(lista) ? lista : []));

  cacheConsultaMidiaHistoricaWpp.set(chave, {
    criadoEm: agora,
    promise,
  });

  try {
    return await promise;
  } catch (erro) {
    cacheConsultaMidiaHistoricaWpp.delete(chave);
    throw erro;
  }
}


function idsConversaHistoricoPerfilWpp(conversaId, candidatos = []) {
  const ids = new Set();
  const chaves = new Set();

  const adicionar = (valor) => {
    const id = normalizarId(valor);

    if (!id) {
      return;
    }

    adicionarVariantesDeId(ids, id);

    const chave = chaveCanonica(id);

    if (chave) {
      chaves.add(chave);
    }
  };

  adicionar(conversaId);

  for (const candidato of candidatos || []) {
    adicionar(candidato);
  }

  // Expande aliases conhecidos apenas da conversa solicitada. Isso e
  // importante para contatos que alternam entre telefone, @c.us e @lid.
  let expandiu = true;

  while (expandiu) {
    expandiu = false;

    for (const item of ultimoEstado || []) {
      const aliases = [item?.id, ...(item?.aliases || [])]
        .map(normalizarId)
        .filter(Boolean);

      const pertence = aliases.some((alias) => {
        const chave = chaveCanonica(alias);
        return chave && chaves.has(chave);
      });

      if (!pertence) {
        continue;
      }

      const totalAntes = ids.size + chaves.size;

      for (const alias of aliases) {
        adicionar(alias);
      }

      if (ids.size + chaves.size > totalAntes) {
        expandiu = true;
      }
    }
  }

  return { ids, chaves };
}

function idsRemotosMensagemHistoricoPerfilWpp(mensagem) {
  const diretos = [];
  const fallback = [];

  const adicionar = (lista, valor) => {
    const id = normalizarId(valor);

    if (id) {
      lista.push(id);
    }
  };

  adicionar(diretos, mensagem?.chatId);
  adicionar(diretos, mensagem?.chat?.id);
  adicionar(diretos, mensagem?.id?.remote);
  adicionar(diretos, mensagem?.id?.remoteJid);

  const idSerializado = serializarId(mensagem?.id);
  const matchId = String(idSerializado || "").match(
    /^(?:true|false)_([^_]+@(c\.us|s\.whatsapp\.net|lid|g\.us))_/i,
  );

  if (matchId?.[1]) {
    adicionar(diretos, matchId[1]);
  }

  // Mensagens antigas nem sempre carregam chatId no objeto devolvido.
  // Nessa situacao, from/to ainda permitem identificar o chat correto.
  adicionar(fallback, mensagem?.from);
  adicionar(fallback, mensagem?.to);

  return {
    diretos: Array.from(new Set(diretos)),
    fallback: Array.from(new Set(fallback)),
  };
}

function mensagemPertenceConversaHistoricoPerfilWpp(mensagem, alvos) {
  if (!mensagem || !alvos?.chaves?.size) {
    return false;
  }

  const corresponde = (valor) => {
    const id = normalizarId(valor);

    if (!id) {
      return false;
    }

    if (alvos.ids?.has(id)) {
      return true;
    }

    const chave = chaveCanonica(id);
    return !!chave && alvos.chaves.has(chave);
  };

  const idsMensagem = idsRemotosMensagemHistoricoPerfilWpp(mensagem);

  // Se o objeto informa explicitamente o chat remoto, ele e a autoridade.
  // Nunca aceitamos um item de outro chat so porque from/to contem algum
  // identificador coincidente.
  if (idsMensagem.diretos.length) {
    return idsMensagem.diretos.some(corresponde);
  }

  return idsMensagem.fallback.some(corresponde);
}

async function publicarCartoesEnviadosWpp(conversaId, idRaw, texto, tipo, cartoes = {}) {
  if (typeof client?.getMessageById !== 'function') return;
  for (const espera of [0, 1200, 3000]) {
    if (espera) await new Promise(resolve => setTimeout(resolve, espera));
    try {
      const msg = await client.getMessageById(serializarId(idRaw));
      const extraidos = extrairCartoesWpp(msg || {});
      if (extraidos.localizacao || extraidos.previaLink) {
        emitirMensagemEnviadaWpp({conversaId,idRaw,texto,tipo,ack:msg.ack,cartoes:{...cartoes,...extraidos}});
        return;
      }
    } catch {}
  }
}

async function enviarLocalizacaoWpp(dados = {}) {
  const ponto = validarLocalizacao(dados.localizacao);
  if (!ponto) throw new Error('Informe coordenadas validas.');
  if (typeof client?.sendLocation !== 'function') throw new Error('WhatsApp ainda nao conectado.');
  const { origem, chatId } = await resolverChatIdParaEnvio(dados.conversaId);
  const r = await client.sendLocation(chatId, {lat:ponto.latitude,lng:ponto.longitude,name:ponto.nome,address:ponto.endereco});
  const idRaw = r?.id;
  if (!extrairIdMensagemWpp(idRaw)) throw new Error('Envio nao confirmado. Confira a conversa antes de tentar novamente.');
  const cartoes = {localizacao:ponto};
  emitirMensagemEnviadaWpp({conversaId:origem,idRaw,texto:'📍 Localização',tipo:'localizacao',ack:r.ack,cartoes});
  void publicarCartoesEnviadosWpp(origem,idRaw,'📍 Localização','localizacao',cartoes);
  await desarquivarAposEnvio(origem, chatId);
  return {idMensagem:extrairIdMensagemWpp(idRaw),statusEntrega:normalizarAckWpp(r.ack)};
}

async function recuperarCartoesConversaWpp(dados = {}) {
  if(typeof client?.getMessages !== 'function') throw new Error('WhatsApp ainda nao conectado.');
  const {origem,chatId}=await resolverChatIdParaEnvio(dados.conversaId);
  const lista=await client.getMessages(chatId,{count:600});
  return {mensagens:(Array.isArray(lista)?lista:[]).map(m=>{
    const msg=normalizarItemHistoricoPerfilWpp(m,origem);
    return msg && (msg.localizacao || msg.previaLink) ? {id:origem,...msg} : null;
  }).filter(Boolean)};
}

function normalizarItemHistoricoPerfilWpp(mensagem, conversaId) {
  if (!mensagem || mensagemRecebidaIgnoravelWpp(mensagem)) {
    return null;
  }

  if (mensagem?.isViewOnce) {
    return null;
  }

  const idMensagem = extrairIdMensagemWpp(mensagem?.id);
  const idMensagemWpp = serializarId(mensagem?.id);
  const tipo = tipoMensagemRecebidaWpp(mensagem);

  if (!idMensagem || !idMensagemWpp || !tipo) {
    return null;
  }

  const timestamp = timestampMensagemWpp(mensagem?.timestamp || mensagem?.t);
  const minha = !!mensagem?.fromMe;

  return {
    idMensagem,
    idMensagemWpp,
    texto: textoMensagemRecebidaWpp(mensagem, tipo),
    ...extrairCartoesWpp(mensagem),
    tipo,
    mime: mensagem?.mimetype || null,
    fileName: mensagem?.filename || mensagem?.fileName || null,
    viewOnceKind: null,
    horario: horarioTimestampWpp(timestamp),
    timestamp,
    minha,
    remoteJid: normalizarId(conversaId) || conversaId,
    participant: converterIdWppParaBaileys(mensagem?.author) || null,
    lidaPorMim: minha || !!mensagem?.isRead,
    statusEntrega: minha
      ? normalizarAckWpp(mensagem?.ack)
      : null,
    resposta: respostaRecebidaWpp(mensagem),
    mediaPath: null,
    mediaUrl: null,
    rawBase64: null,
  };
}

async function listarMidiaLinksDocsHistoricoWpp(dados = {}) {
  if (!client || typeof client.getMessages !== "function") {
    throw new Error("Historico de midias indisponivel no WPPConnect.");
  }

  const conversaId = normalizarId(dados?.conversaId);
  const aba = ["midias", "links", "docs"].includes(String(dados?.aba || ""))
    ? String(dados.aba)
    : "midias";
  const limite = Math.max(
    20,
    Math.min(120, Number(dados?.limite || 100) || 100),
  );
  const cursor = String(dados?.cursor || "").trim() || null;

  if (!conversaId) {
    throw new Error("Conversa invalida para consultar historico de midias.");
  }

  const filtroMidia =
    aba === "docs" ? "document" : aba === "links" ? "url" : "all";

  const { candidatos } = await candidatosOperacaoConversaWpp(conversaId);

  if (!candidatos.length) {
    throw new Error("Nao consegui localizar essa conversa no WhatsApp Web.");
  }

  const alvosConversa = idsConversaHistoricoPerfilWpp(
    conversaId,
    candidatos,
  );

  let ultimoErro = null;

  for (const chatId of candidatos) {
    try {
      const parametros = {
        count: limite,
        media: filtroMidia,
      };

      if (cursor) {
        parametros.id = cursor;
        parametros.direction = "before";
      }

      const recebidas = await aguardarComTimeoutWpp(
        client.getMessages(chatId, parametros),
        15000,
        null,
      );

      if (!Array.isArray(recebidas)) {
        continue;
      }

      const itens = [];
      let descartadasOutroChat = 0;

      for (const mensagem of recebidas) {
        if (
          !mensagemPertenceConversaHistoricoPerfilWpp(
            mensagem,
            alvosConversa,
          )
        ) {
          descartadasOutroChat++;
          continue;
        }

        const normalizada = normalizarItemHistoricoPerfilWpp(
          mensagem,
          conversaId,
        );

        if (!normalizada) {
          continue;
        }

        const tipo = String(normalizada.tipo || "");

        if (
          (aba === "midias" && !["imagem", "video"].includes(tipo)) ||
          (aba === "docs" && tipo !== "documento") ||
          (aba === "links" && tipo !== "texto")
        ) {
          continue;
        }

        itens.push(normalizada);
      }

      const mensagensComId = recebidas
        .map((mensagem) => ({
          mensagem,
          id: serializarId(mensagem?.id) || null,
          timestamp: timestampMensagemWpp(
            mensagem?.timestamp || mensagem?.t,
          ),
        }))
        .filter((item) => !!item.id)
        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

      const proximoCursor = mensagensComId[0]?.id || null;
      const temMais =
        recebidas.length >= limite &&
        !!proximoCursor &&
        proximoCursor !== cursor;

      console.log(
        `[PERFIL HISTORICO] LISTA | conversa=${conversaId} | aba=${aba} | ` +
          `chat=${chatId} | raw=${recebidas.length} | itens=${itens.length} | ` +
          `outro_chat=${descartadasOutroChat} | temMais=${temMais}`,
      );

      return {
        ok: true,
        conversaId,
        aba,
        itens,
        proximoCursor,
        temMais,
        consultadas: recebidas.length,
        via: "wppconnect-historico-paginado",
      };
    } catch (erro) {
      ultimoErro = erro;

      console.warn(
        `[PERFIL HISTORICO] CHAT_FALHOU | conversa=${conversaId} | ` +
          `aba=${aba} | chat=${chatId} | erro=${erro?.message || erro || "unknown"}`,
      );
    }
  }

  if (ultimoErro) {
    throw ultimoErro;
  }

  return {
    ok: true,
    conversaId,
    aba,
    itens: [],
    proximoCursor: null,
    temMais: false,
    consultadas: 0,
    via: "wppconnect-historico-paginado",
  };
}

async function recuperarMidiaHistoricaWpp(dados = {}) {
  if (
    !client ||
    typeof client.getMessages !== "function" ||
    typeof client.downloadMedia !== "function"
  ) {
    throw new Error("Midia historica indisponivel no WPPConnect.");
  }

  const conversaId = normalizarId(dados?.conversaId);
  const idMensagem = String(dados?.idMensagem || "").trim();
  const idMensagemWpp = String(dados?.idMensagemWpp || "").trim();

  if (!conversaId || !idMensagem) {
    throw new Error("Mensagem historica invalida.");
  }

  async function materializarMensagemWpp(mensagem, fonte) {
    if (!mensagem || mensagem?.isViewOnce) {
      return null;
    }

    if (extrairIdMensagemWpp(mensagem?.id) !== idMensagem) {
      return null;
    }

    const tipo = tipoMensagemRecebidaWpp(mensagem);

    if (
      !["imagem", "video", "audio", "documento", "sticker"].includes(
        String(tipo || ""),
      )
    ) {
      return null;
    }

    const idReal = serializarId(mensagem?.id);

    if (!idReal) {
      return null;
    }

    let midiaBaixada = null;
    let erroDownload = null;

    try {
      midiaBaixada = await baixarMidiaMensagemRecebidaWpp(
        mensagem,
        idMensagem,
        tipo,
      );
    } catch (erro) {
      erroDownload = erro;
    }

    if (!midiaBaixada?.mediaPath || !midiaBaixada?.mediaUrl) {
      const dataUrlForcada = await forcarRedownloadMidiaWpp(idReal);
      const forcada = decodificarMidiaHistoricaDataUrlWpp(
        dataUrlForcada,
        mensagem?.mimetype || null,
      );

      if (forcada?.buffer?.length) {
        garantirPastaMediaWpp();

        const mime = forcada.mime || mensagem?.mimetype || null;
        const extensao = extensaoMidiaWpp(mime, tipo);
        const nomeOriginal =
          mensagem?.filename ||
          mensagem?.fileName ||
          (tipo === "documento" ? "Documento" : idMensagem);
        const nomeLimpo = sanitizarNomeWpp(nomeOriginal || idMensagem);
        const nomeFinal = path.extname(nomeLimpo)
          ? nomeLimpo
          : `${nomeLimpo}${extensao}`;
        const caminho = path.join(
          pastaMediaWpp(),
          `${sanitizarNomeWpp(idMensagem)}_redownload_${nomeFinal}`,
        );

        fs.writeFileSync(caminho, forcada.buffer);

        midiaBaixada = {
          mediaPath: caminho,
          mediaUrl: pathToFileURL(caminho).href,
          mime,
          fileName: tipo === "documento" ? nomeFinal : null,
        };

        console.log(
          `[MIDIA HISTORICA] REDOWNLOAD_FORCADO_OK | conversa=${conversaId} | ` +
            `id=${idMensagem} | tipo=${tipo} | bytes=${forcada.buffer.length}`,
        );
      }
    }

    if (!midiaBaixada?.mediaPath || !midiaBaixada?.mediaUrl) {
      console.warn(
        `[MIDIA HISTORICA] SEM_BYTES | fonte=${fonte} | conversa=${conversaId} | ` +
          `id=${idMensagem} | erro=${erroDownload?.message || "blob-vazio"}`,
      );
      return null;
    }

    console.log(
      `[MIDIA HISTORICA] RECUPERADA | fonte=${fonte} | ` +
        `conversa=${conversaId} | id=${idMensagem} | tipo=${tipo}`,
    );

    return {
      ok: true,
      ...midiaBaixada,
      tipo,
      idMensagemWpp: idReal,
      fonte,
    };
  }

  // Preferred path: use the exact serialized WPP message ID saved locally.
  if (idMensagemWpp && typeof client?.getMessageById === "function") {
    try {
      const direta = await aguardarComTimeoutWpp(
        client.getMessageById(idMensagemWpp),
        6000,
        null,
      );

      const recuperada = await materializarMensagemWpp(
        direta,
        "wpp-historico-id-direto",
      );

      if (recuperada) {
        return recuperada;
      }
    } catch (erro) {
      console.warn(
        `[MIDIA HISTORICA] ID_DIRETO_FALHOU | conversa=${conversaId} | ` +
          `id=${idMensagem} | erro=${erro?.message || erro || "unknown"}`,
      );
    }
  }

  const { candidatos } = await candidatosOperacaoConversaWpp(conversaId);

  console.log(
    `[MIDIA HISTORICA] BUSCA_CHAT | conversa=${conversaId} | ` +
      `id=${idMensagem} | candidatos=${candidatos.length}`,
  );

  for (const chatId of candidatos) {
    let listaRecente = [];

    try {
      listaRecente = await listarMensagensParaMidiaHistoricaWpp(
        chatId,
        false,
      );
    } catch (erro) {
      console.warn(
        `[MIDIA HISTORICA] CHAT_RECENTE_FALHOU | chat=${chatId} | ` +
          `erro=${erro?.message || erro || "unknown"}`,
      );
    }

    let mensagem = listaRecente.find(
      (item) => extrairIdMensagemWpp(item?.id) === idMensagem,
    );

    if (mensagem) {
      const recuperada = await materializarMensagemWpp(
        mensagem,
        "wpp-historico-chat-recente",
      );

      if (recuperada) {
        return recuperada;
      }
    }

    console.log(
      `[MIDIA HISTORICA] BUSCA_COMPLETA | chat=${chatId} | id=${idMensagem}`,
    );

    let listaCompleta = [];

    try {
      listaCompleta = await listarMensagensParaMidiaHistoricaWpp(
        chatId,
        true,
      );
    } catch (erro) {
      console.warn(
        `[MIDIA HISTORICA] CHAT_COMPLETO_FALHOU | chat=${chatId} | ` +
          `erro=${erro?.message || erro || "unknown"}`,
      );
      continue;
    }

    mensagem = listaCompleta.find(
      (item) => extrairIdMensagemWpp(item?.id) === idMensagem,
    );

    if (!mensagem) {
      continue;
    }

    const recuperada = await materializarMensagemWpp(
      mensagem,
      "wpp-historico-chat-completo",
    );

    if (recuperada) {
      return recuperada;
    }
  }

  throw new Error(
    "Mensagem historica nao encontrada no historico disponivel do WhatsApp Web.",
  );
}
