// Sincronizacao incremental do historico que chegou enquanto o WhatsIAPP estava fechado.
// Este modulo nao participa da recepcao ao vivo, envio, midia, presenca ou Status.
// Ele apenas le o historico ja carregado no WhatsApp Web depois do FULL_READY e
// devolve mensagens normalizadas ao processo principal para persistencia no Baileys.

function timestampChatHistoricoGapWpp(chat) {
  const candidatos = [
    chat?.t,
    chat?.timestamp,
    chat?.lastMessage?.t,
    chat?.lastMessage?.timestamp,
    chat?.lastMsg?.t,
    chat?.lastMsg?.timestamp,
    chat?.lastMessageTimestamp,
    chat?.lastMsgTimestamp,
  ];

  for (const valor of candidatos) {
    let numero = Number(valor);

    if (!Number.isFinite(numero) || numero <= 0) {
      continue;
    }

    if (numero > 1000000000000) {
      numero = Math.floor(numero / 1000);
    }

    return Math.floor(numero);
  }

  return 0;
}

function idBaileysPreferidoHistoricoGapWpp(item) {
  const ids = [item?.id, ...(Array.isArray(item?.aliases) ? item.aliases : [])]
    .map((valor) => normalizarId(valor))
    .filter(Boolean);

  const grupo = ids.find((id) => id.endsWith("@g.us"));

  if (grupo) {
    return grupo;
  }

  const pn = ids.find((id) => id.endsWith("@s.whatsapp.net"));

  if (pn) {
    return pn;
  }

  const cUs = ids.find((id) => id.endsWith("@c.us"));

  if (cUs) {
    return cUs.replace("@c.us", "@s.whatsapp.net");
  }

  return ids.find((id) => id.endsWith("@lid")) || ids[0] || null;
}

function normalizarMensagemHistoricoGapWpp(
  mensagem,
  estado,
  conversaIdForcado = null,
) {
  if (!mensagem || mensagemRecebidaIgnoravelWpp(mensagem)) {
    return null;
  }

  const idMensagem = extrairIdMensagemWpp(mensagem?.id);

  if (!idMensagem) {
    return null;
  }

  let tipo = tipoMensagemRecebidaWpp(mensagem);

  if (!tipo) {
    return null;
  }

  const conversaId =
    normalizarId(conversaIdForcado) ||
    idBaileysPreferidoHistoricoGapWpp(estado);

  if (!conversaId) {
    return null;
  }

  const timestamp = timestampMensagemWpp(mensagem?.timestamp || mensagem?.t);
  const minha = !!mensagem?.fromMe;

  let viewOnceKind = null;
  let texto = textoMensagemRecebidaWpp(mensagem, tipo);

  if (
    mensagem?.isViewOnce &&
    (tipo === "imagem" || tipo === "video" || tipo === "audio")
  ) {
    viewOnceKind =
      tipo === "imagem" ? "imagem" : tipo === "video" ? "video" : "audio";

    tipo = "view_once";

    texto =
      viewOnceKind === "imagem"
        ? "① Foto de visualização única\\nAbra no celular para visualizar"
        : viewOnceKind === "video"
          ? "① Vídeo de visualização única\\nAbra no celular para visualizar"
          : "① Áudio de reprodução única\\nAbra no celular para ouvir";
  }

  const participant = converterIdWppParaBaileys(mensagem?.author);
  const resposta = respostaRecebidaWpp(mensagem);

  return {
    id: conversaId,
    nome:
      estado?.nome ||
      nomeDoChat(mensagem?.chat) ||
      mensagem?.notifyName ||
      mensagem?.sender?.name ||
      mensagem?.sender?.pushname ||
      null,
    arquivada: !!estado?.arquivada,
    trancada: !!estado?.trancada,
    idMensagem,
    idMensagemWpp: serializarId(mensagem?.id) || null,
    resposta,
    texto,
    tipo,
    mime: mensagem?.mimetype || null,
    fileName: mensagem?.filename || mensagem?.fileName || null,
    viewOnceKind,
    horario: horarioTimestampWpp(timestamp),
    timestamp,
    minha,
    remoteJid: conversaId,
    participant: participant || null,
    lidaPorMim: minha || !!mensagem?.isRead,
    statusEntrega: minha
      ? normalizarAckWpp(mensagem?.ack)
      : null,
    mediaPath: null,
    mediaUrl: null,
    rawBase64: null,
  };
}

async function estadosAtuaisHistoricoGapWpp() {
  const chats = await listarChatsRobusto();
  const estados = [];

  // O FULL_READY acabou de montar ultimoEstado e aliasesParaChat.
  // Reaproveitamos esse resultado em vez de chamar completarAliasesLid()
  // novamente para centenas de chats.
  const conhecidoPorChave = new Map();

  for (const item of ultimoEstado || []) {
    for (const alias of [item?.id, ...(item?.aliases || [])]) {
      const chave = chaveCanonica(alias);
      if (chave) conhecidoPorChave.set(chave, item);
    }
  }

  for (const chat of chats || []) {
    const id = idChat(chat);

    if (!id) {
      continue;
    }

    if (
      id === "status@broadcast" ||
      id.endsWith("@broadcast") ||
      id.endsWith("@newsletter")
    ) {
      continue;
    }

    const aliases = aliasesBasicosDoChat(chat);
    let conhecido = null;

    for (const alias of aliases) {
      const chave = chaveCanonica(alias);
      if (chave && conhecidoPorChave.has(chave)) {
        conhecido = conhecidoPorChave.get(chave);
        break;
      }
    }

    if (conhecido) {
      for (const alias of [conhecido.id, ...(conhecido.aliases || [])]) {
        adicionarVariantesDeId(aliases, alias);
      }
    }

    estados.push({
      id,
      aliases: Array.from(aliases),
      arquivada: !!chat.archive,
      trancada: !!chat.isLocked,
      nome: nomeDoChat(chat),
      timestamp: timestampChatHistoricoGapWpp(chat),
    });
  }

  return estados;
}

async function buscarHistoricoGapWpp(dados = {}) {
  if (!client || typeof client.getMessages !== "function") {
    throw new Error("Historico WPPConnect indisponivel.");
  }

  if (!fullReady || !prontidaoInicialFinalizada) {
    throw new Error("WPPConnect ainda nao concluiu FULL_READY.");
  }

  const bases = Array.isArray(dados?.conversas) ? dados.conversas : [];
  const basePorChave = new Map();

  for (const item of bases) {
    const id = normalizarId(item?.id);
    const chave = chaveCanonica(id);

    if (!chave) {
      continue;
    }

    const timestamp = Math.max(0, Number(item?.timestamp || 0) || 0);
    const anterior = basePorChave.get(chave);

    if (!anterior || timestamp > anterior.timestamp) {
      basePorChave.set(chave, {
        id,
        timestamp,
      });
    }
  }

  const estados = await estadosAtuaisHistoricoGapWpp();
  const candidatos = [];
  let semTimestamp = 0;

  for (const estado of estados) {
    const ids = [
      estado?.id,
      ...(Array.isArray(estado?.aliases) ? estado.aliases : []),
    ]
      .map((valor) => normalizarId(valor))
      .filter(Boolean);

    let timestampLocal = 0;
    let encontrouBase = false;
    let conversaIdLocal = null;

    for (const id of ids) {
      const chave = chaveCanonica(id);
      const base = chave ? basePorChave.get(chave) : null;

      if (!base) {
        continue;
      }

      encontrouBase = true;

      const timestampBase = Number(base.timestamp || 0) || 0;

      if (!conversaIdLocal || timestampBase >= timestampLocal) {
        conversaIdLocal = base.id || conversaIdLocal;
        timestampLocal = Math.max(timestampLocal, timestampBase);
      }
    }

    const timestampWpp = Math.max(0, Number(estado?.timestamp || 0) || 0);

    if (!timestampWpp) {
      semTimestamp++;
    }

    const precisaBuscar =
      (!encontrouBase && timestampWpp > 0) ||
      (encontrouBase && timestampWpp > timestampLocal);

    if (!precisaBuscar) {
      continue;
    }

    candidatos.push({
      estado,
      conversaIdLocal,
      timestampLocal,
      timestampWpp,
    });
  }

  candidatos.sort((a, b) => b.timestampWpp - a.timestampWpp);

  const totalCandidatos = candidatos.length;
  const limiteCandidatos = Math.max(
    1,
    Math.min(30, Number(dados?.limiteCandidatos || totalCandidatos || 1) || 1),
  );
  const candidatosSelecionados = candidatos.slice(0, limiteCandidatos);

  console.log(
    `[HISTORICO GAP] WPP_CANDIDATOS | bases=${bases.length} | ` +
      `chats=${estados.length} | total=${totalCandidatos} | ` +
      `lote=${candidatosSelecionados.length} | semTimestamp=${semTimestamp}`,
  );

  const mensagens = [];
  const processados = [];
  const vistos = new Set();
  let chatsConsultados = 0;
  let chatsComGap = 0;
  let falhas = 0;

  let proximo = 0;
  const concorrencia = Math.min(3, Math.max(1, candidatosSelecionados.length));

  async function processarProximo() {
    while (true) {
      const indice = proximo++;

      if (indice >= candidatosSelecionados.length) {
        return;
      }

      const item = candidatosSelecionados[indice];
      const conversaId =
        normalizarId(item.conversaIdLocal) ||
        idBaileysPreferidoHistoricoGapWpp(item.estado);

      if (!conversaId) {
        continue;
      }

      processados.push({
        id: conversaId,
        timestampWpp: Number(item.timestampWpp || 0) || 0,
      });

      chatsConsultados++;

      let lista = [];
      let erroUltimo = null;

      try {
        const resolucao = await candidatosOperacaoConversaWpp(conversaId);
        const idsChat = Array.isArray(resolucao?.candidatos)
          ? resolucao.candidatos
          : [];

        for (const chatId of idsChat) {
          try {
            const recebidas = await aguardarComTimeoutWpp(
              client.getMessages(chatId, {
                count: 600,
              }),
              12000,
              null,
            );

            if (Array.isArray(recebidas) && recebidas.length) {
              lista = recebidas;
              break;
            }
          } catch (erro) {
            erroUltimo = erro;
          }
        }
      } catch (erro) {
        erroUltimo = erro;
      }

      if (!lista.length) {
        if (erroUltimo) {
          falhas++;
          console.warn(
            `[HISTORICO GAP] WPP_CHAT_FALHOU | conversa=${conversaId} | ` +
              `erro=${erroUltimo?.message || erroUltimo || "unknown"}`,
          );
        }

        continue;
      }

      let adicionadasChat = 0;
      const limiteInferior = Math.max(0, item.timestampLocal - 2);

      for (const mensagem of lista) {
        const normalizada = normalizarMensagemHistoricoGapWpp(
          mensagem,
          item.estado,
          conversaId,
        );

        if (!normalizada) {
          continue;
        }

        if (
          item.timestampLocal > 0 &&
          Number(normalizada.timestamp || 0) < limiteInferior
        ) {
          continue;
        }

        const chaveMensagem = `${normalizada.id}|${normalizada.idMensagem}`;

        if (vistos.has(chaveMensagem)) {
          continue;
        }

        vistos.add(chaveMensagem);
        mensagens.push(normalizada);
        adicionadasChat++;
      }

      if (adicionadasChat > 0) {
        chatsComGap++;

        console.log(
          `[HISTORICO GAP] WPP_CHAT | conversa=${conversaId} | ` +
            `local=${item.timestampLocal} | remoto=${item.timestampWpp} | ` +
            `mensagens=${adicionadasChat}`,
        );
      }
    }
  }

  if (candidatosSelecionados.length) {
    await Promise.all(
      Array.from({ length: concorrencia }, () => processarProximo()),
    );
  }

  mensagens.sort(
    (a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0),
  );

  console.log(
    `[HISTORICO GAP] WPP_FIM | consultados=${chatsConsultados} | ` +
      `comGap=${chatsComGap} | mensagens=${mensagens.length} | falhas=${falhas}`,
  );

  return {
    ok: true,
    mensagens,
    resumo: {
      bases: bases.length,
      chatsWpp: estados.length,
      candidatos: totalCandidatos,
      candidatosProcessados: candidatosSelecionados.length,
      restantes: Math.max(0, totalCandidatos - candidatosSelecionados.length),
      chatsConsultados,
      chatsComGap,
      mensagens: mensagens.length,
      falhas,
      semTimestamp,
    },
    processados,
  };
}
