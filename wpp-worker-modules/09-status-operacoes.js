async function resolverIdMensagemStatusWpp(dados = {}) {
  if (!client?.page) {
    throw new Error("Status ainda nao esta disponivel no WPPConnect.");
  }

  const contatoId = String(dados?.contatoId || "").trim();
  const idFeed = String(dados?.idFeed || "").trim();
  const idInformado = String(dados?.idMensagem || "").trim();
  const idRawInformado = String(dados?.idMensagemRaw || "").trim();

  if (!idInformado && !idRawInformado) {
    throw new Error("Status sem identificador de mensagem.");
  }

  const resolvido = await client.page.evaluate(
    async ({
      contatoIdPagina,
      idFeedPagina,
      idMensagemPagina,
      idRawPagina,
    }) => {
      const api = window.WPP;

      if (!api?.status || !api?.whatsapp?.StatusV3Store) {
        return {
          ok: false,
          erro: "API de Status indisponivel.",
        };
      }

      function serializarIdPagina(valor) {
        if (!valor) return null;
        if (typeof valor === "string") return valor;

        const candidatos = [
          valor._serialized,
          valor.user && valor.server ? `${valor.user}@${valor.server}` : null,
        ];

        for (const candidato of candidatos) {
          if (typeof candidato === "string" && candidato.trim()) {
            return candidato.trim();
          }
        }

        try {
          const texto = valor.toString?.();
          if (
            typeof texto === "string" &&
            texto.trim() &&
            texto !== "[object Object]"
          ) {
            return texto.trim();
          }
        } catch {}

        if (typeof valor.id === "string" && valor.id.trim()) {
          return valor.id.trim();
        }

        return null;
      }

      function valorAttr(objeto, chave) {
        if (!objeto) return undefined;
        if (objeto[chave] !== undefined) return objeto[chave];
        try {
          if (typeof objeto.get === "function") {
            return objeto.get(chave);
          }
        } catch {}
        return undefined;
      }

      function listaModelos(valor) {
        if (!valor) return [];
        if (Array.isArray(valor)) return valor;
        try {
          if (typeof valor.getModelsArray === "function") {
            const lista = valor.getModelsArray();
            if (Array.isArray(lista)) return lista;
          }
        } catch {}
        try {
          if (typeof valor.toArray === "function") {
            const lista = valor.toArray();
            if (Array.isArray(lista)) return lista;
          }
        } catch {}
        if (Array.isArray(valor.models)) return valor.models;
        if (Array.isArray(valor._models)) return valor._models;
        return [];
      }

      function mensagensFeed(feed) {
        if (!feed) return [];
        try {
          if (typeof feed.getAllMsgs === "function") {
            const lista = feed.getAllMsgs();
            const modelos = listaModelos(lista);
            if (modelos.length) return modelos;
            if (Array.isArray(lista)) return lista;
          }
        } catch {}
        return listaModelos(valorAttr(feed, "msgs"));
      }

      function dadosIdMensagem(msg, contatoFallback = "") {
        const chave = valorAttr(msg, "id");
        const serializado = serializarIdPagina(chave);
        const raw = String(
          (chave && typeof chave === "object" ? chave.id : "") ||
            valorAttr(msg, "idMessage") ||
            valorAttr(msg, "msgId") ||
            serializado ||
            "",
        ).trim();
        const fromMe = !!(
          valorAttr(chave, "fromMe") ?? valorAttr(msg, "fromMe")
        );
        const participante =
          serializarIdPagina(valorAttr(chave, "participant")) ||
          serializarIdPagina(valorAttr(msg, "author")) ||
          serializarIdPagina(valorAttr(msg, "sender")?.id) ||
          contatoFallback ||
          "";
        const remoto =
          serializarIdPagina(valorAttr(chave, "remote")) || "status@broadcast";

        let completo = String(serializado || "").trim();

        if (!completo.includes("status@broadcast") && raw) {
          completo = `${fromMe ? "true" : "false"}_${
            String(remoto || "").includes("@broadcast")
              ? remoto
              : "status@broadcast"
          }_${raw}${participante ? `_${participante}` : ""}`;
        }

        return {
          completo,
          raw,
          serializado: String(serializado || "").trim(),
        };
      }

      function rawDoAlvo(valor) {
        const texto = String(valor || "").trim();
        if (!texto) return "";
        const partes = texto.split("_").filter(Boolean);
        const indiceBroadcast = partes.findIndex((parte) =>
          parte.includes("status@broadcast"),
        );
        if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
          return partes[indiceBroadcast + 1];
        }
        return texto;
      }

      const alvoRaw = idRawPagina || rawDoAlvo(idMensagemPagina);
      const feeds = [];
      const adicionarFeed = (feed) => {
        if (feed && !feeds.includes(feed)) feeds.push(feed);
      };

      for (const id of [contatoIdPagina, idFeedPagina]) {
        if (!id) continue;
        try {
          if (typeof api.status.get === "function") {
            adicionarFeed(api.status.get(id));
          }
        } catch {}
      }

      for (const feed of listaModelos(api.whatsapp.StatusV3Store)) {
        const contato = valorAttr(feed, "contact") || null;
        const idFeedAtual = serializarIdPagina(valorAttr(feed, "id"));
        const idContatoAtual =
          serializarIdPagina(valorAttr(contato, "id")) ||
          serializarIdPagina(valorAttr(feed, "contactId"));

        if (
          !contatoIdPagina ||
          idContatoAtual === contatoIdPagina ||
          idFeedAtual === contatoIdPagina ||
          idFeedAtual === idFeedPagina ||
          idContatoAtual === idFeedPagina
        ) {
          adicionarFeed(feed);
        }
      }

      for (const feed of feeds) {
        const contato = valorAttr(feed, "contact") || null;
        const contatoFallback =
          serializarIdPagina(valorAttr(contato, "id")) ||
          contatoIdPagina ||
          idFeedPagina ||
          "";

        for (const msg of mensagensFeed(feed)) {
          const ids = dadosIdMensagem(msg, contatoFallback);

          const corresponde =
            (idMensagemPagina &&
              [ids.completo, ids.serializado, ids.raw].includes(
                idMensagemPagina,
              )) ||
            (alvoRaw && ids.raw === alvoRaw) ||
            (idMensagemPagina &&
              ids.completo &&
              ids.completo.includes(`_${rawDoAlvo(idMensagemPagina)}_`));

          if (corresponde) {
            return {
              ok: true,
              idMensagem: ids.completo || ids.serializado || ids.raw,
              idMensagemRaw: ids.raw,
            };
          }
        }
      }

      return {
        ok: false,
        erro: "Mensagem de Status nao encontrada no StatusV3Store.",
      };
    },
    {
      contatoIdPagina: contatoId,
      idFeedPagina: idFeed,
      idMensagemPagina: idInformado,
      idRawPagina: idRawInformado,
    },
  );

  if (resolvido?.ok && resolvido?.idMensagem) {
    return resolvido;
  }

  if (idInformado.includes("status@broadcast")) {
    return {
      ok: true,
      idMensagem: idInformado,
      idMensagemRaw: idRawInformado || null,
      fallback: true,
    };
  }

  throw new Error(
    resolvido?.erro || "Nao consegui localizar a mensagem deste Status.",
  );
}

async function baixarMidiaStatusWpp(dados = {}) {
  if (!client?.page) {
    throw new Error("Download de Status indisponivel no WPPConnect.");
  }

  const tipo = normalizarTipoStatusWpp(dados?.tipo);
  const mimeInformado = String(dados?.mime || "").trim() || null;

  if (!["imagem", "video"].includes(tipo)) {
    throw new Error("Este Status nao possui midia visual.");
  }

  const idResolvido = await resolverIdMensagemStatusWpp(dados);
  const idMensagem = String(idResolvido?.idMensagem || "").trim();

  if (!idMensagem) {
    throw new Error("Status sem identificador valido para carregar midia.");
  }

  garantirPastaMediaWpp();
  fs.mkdirSync(pastaStatusWpp(), { recursive: true });

  const extensao = extensaoMidiaWpp(mimeInformado, tipo);
  const caminho = path.join(
    pastaStatusWpp(),
    nomeArquivoStatusWpp(idMensagem, extensao),
  );

  if (fs.existsSync(caminho) && fs.statSync(caminho).size > 0) {
    return {
      ok: true,
      idMensagem,
      idMensagemRaw: idResolvido?.idMensagemRaw || null,
      tipo,
      mime: mimeInformado,
      mediaPath: caminho,
      mediaUrl: pathToFileURL(caminho).href,
      cache: true,
    };
  }

  const resultadoPagina = await client.page.evaluate(async (idPagina) => {
    try {
      if (
        typeof window.WPP?.chat?.downloadMedia !== "function" ||
        typeof window.WPP?.util?.blobToBase64 !== "function"
      ) {
        return {
          ok: false,
          erro: "API de download de midia indisponivel.",
        };
      }

      const blob = await window.WPP.chat.downloadMedia(idPagina);

      if (!blob) {
        return {
          ok: false,
          erro: "O WhatsApp nao retornou a midia do Status.",
        };
      }

      const base64 = await window.WPP.util.blobToBase64(blob);

      return {
        ok: !!base64,
        base64: base64 || null,
        mime: blob?.type || null,
        erro: base64 ? null : "A midia do Status veio vazia.",
      };
    } catch (erro) {
      return {
        ok: false,
        erro: erro?.message || String(erro),
      };
    }
  }, idMensagem);

  if (!resultadoPagina?.ok || !resultadoPagina?.base64) {
    throw new Error(
      resultadoPagina?.erro ||
        "O WhatsApp nao disponibilizou a midia deste Status.",
    );
  }

  const midia = dadosBase64MidiaWpp(
    resultadoPagina.base64,
    resultadoPagina.mime || mimeInformado,
  );

  if (!midia?.buffer?.length) {
    throw new Error(
      "O WhatsApp disponibilizou um Status sem conteudo de midia.",
    );
  }

  let caminhoFinal = caminho;

  if (!path.extname(caminhoFinal)) {
    const extDetectada = extensaoMidiaWpp(midia.mime, tipo);

    caminhoFinal = path.join(
      pastaStatusWpp(),
      nomeArquivoStatusWpp(idMensagem, extDetectada),
    );
  }

  fs.writeFileSync(caminhoFinal, midia.buffer);

  console.log(
    `[STATUS WPP] midia carregada | tipo=${tipo} | bytes=${midia.buffer.length}`,
  );

  return {
    ok: true,
    idMensagem,
    idMensagemRaw: idResolvido?.idMensagemRaw || null,
    tipo,
    mime: midia.mime || resultadoPagina.mime || mimeInformado,
    mediaPath: caminhoFinal,
    mediaUrl: pathToFileURL(caminhoFinal).href,
    cache: false,
  };
}

async function marcarStatusVistoWpp(dados = {}) {
  if (!client?.page) {
    throw new Error("Status ainda nao esta disponivel no WPPConnect.");
  }

  const contatoId = String(dados?.contatoId || "").trim();
  const idInformado = String(dados?.idMensagem || "").trim();

  if (!contatoId || !idInformado) {
    throw new Error("Status invalido para marcar como visto.");
  }

  const idResolvido = await resolverIdMensagemStatusWpp(dados);
  const idMensagem = String(idResolvido?.idMensagem || idInformado).trim();

  const resultado = await client.page.evaluate(
    async ({ contatoIdPagina, idMensagemPagina }) => {
      if (typeof window.WPP?.status?.sendReadStatus !== "function") {
        return {
          ok: false,
          erro: "sendReadStatus indisponivel.",
        };
      }

      try {
        await window.WPP.status.sendReadStatus(
          contatoIdPagina,
          idMensagemPagina,
        );

        return { ok: true };
      } catch (erro) {
        return {
          ok: false,
          erro: erro?.message || String(erro),
        };
      }
    },
    {
      contatoIdPagina: contatoId,
      idMensagemPagina: idMensagem,
    },
  );

  if (!resultado?.ok) {
    throw new Error(
      resultado?.erro || "Nao foi possivel marcar o Status como visto.",
    );
  }

  console.log(`[STATUS WPP] visto | contato=${contatoId}`);

  return {
    ok: true,
    contatoId,
    idMensagem,
  };
}

async function reagirStatusWpp(dados = {}) {
  if (!client?.page) {
    throw new Error("Reacao ao Status indisponivel no WPPConnect.");
  }

  const contatoId = String(dados?.contatoId || "").trim();
  const idFeed = String(dados?.idFeed || "").trim();
  const idInformado = String(dados?.idMensagem || "").trim();
  const idRawInformado = String(dados?.idMensagemRaw || "").trim();
  const textoResposta = String(dados?.texto || "").trim();
  const emoji = textoResposta ? "" : normalizarEmojiReacaoWpp(dados?.emoji);
  const conteudoResposta = textoResposta || emoji;
  const tipoResposta = textoResposta ? "resposta" : "reacao";

  if (!contatoId) {
    throw new Error("Status sem contato valido para resposta.");
  }

  if (!idInformado && !idRawInformado) {
    throw new Error("Status sem identificador valido para resposta.");
  }

  if (!conteudoResposta) {
    throw new Error(textoResposta ? "Resposta invalida." : "Reacao invalida.");
  }

  const idResolvido = await resolverIdMensagemStatusWpp(dados);
  const idMensagem = String(idResolvido?.idMensagem || idInformado).trim();
  const idMensagemRaw = String(
    idResolvido?.idMensagemRaw || idRawInformado || "",
  ).trim();

  console.log(
    `[STATUS WPP] ${tipoResposta === "resposta" ? "RESPOSTA_STATUS_INICIO" : "REACAO_STATUS_INICIO"} | ` +
      `contato=${contatoId} | id=${idMensagemRaw || idMensagem}`,
  );

  const resultado = await client.page.evaluate(
    async ({
      contatoIdPagina,
      idFeedPagina,
      idMensagemPagina,
      idRawPagina,
      respostaPagina,
    }) => {
      const api = window.WPP;

      if (
        !api?.status ||
        !api?.whatsapp?.StatusV3Store ||
        typeof api?.chat?.sendRawMessage !== "function"
      ) {
        return {
          ok: false,
          etapa: "api",
          erro: "API necessaria para resposta de Status indisponivel.",
        };
      }

      function serializarIdPagina(valor) {
        if (!valor) return null;
        if (typeof valor === "string") return valor.trim() || null;

        try {
          if (typeof valor.toString === "function") {
            const texto = valor.toString();
            if (texto && texto !== "[object Object]") {
              return String(texto).trim() || null;
            }
          }
        } catch {}

        try {
          if (typeof valor._serialized === "string") {
            return valor._serialized.trim() || null;
          }
        } catch {}

        try {
          if (valor.user && valor.server) {
            return `${valor.user}@${valor.server}`;
          }
        } catch {}

        return null;
      }

      function valorAttr(objeto, chave) {
        if (!objeto) return undefined;

        try {
          if (objeto[chave] !== undefined) return objeto[chave];
        } catch {}

        try {
          if (typeof objeto.get === "function") {
            return objeto.get(chave);
          }
        } catch {}

        return undefined;
      }

      function listaModelos(valor) {
        if (!valor) return [];
        if (Array.isArray(valor)) return valor;

        try {
          if (typeof valor.getModelsArray === "function") {
            const lista = valor.getModelsArray();
            if (Array.isArray(lista)) return lista;
          }
        } catch {}

        try {
          if (typeof valor.toArray === "function") {
            const lista = valor.toArray();
            if (Array.isArray(lista)) return lista;
          }
        } catch {}

        try {
          if (Array.isArray(valor.models)) return valor.models;
        } catch {}

        try {
          if (Array.isArray(valor._models)) return valor._models;
        } catch {}

        return [];
      }

      function mensagensFeed(feed) {
        if (!feed) return [];

        try {
          if (typeof feed.getAllMsgs === "function") {
            const lista = feed.getAllMsgs();
            const modelos = listaModelos(lista);
            if (modelos.length) return modelos;
            if (Array.isArray(lista)) return lista;
          }
        } catch {}

        return listaModelos(valorAttr(feed, "msgs"));
      }

      function rawDoAlvo(valor) {
        const texto = String(valor || "").trim();
        if (!texto) return "";

        const partes = texto.split("_").filter(Boolean);
        const indiceBroadcast = partes.findIndex((parte) =>
          parte.includes("status@broadcast"),
        );

        if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
          return partes[indiceBroadcast + 1];
        }

        return texto;
      }

      function idMensagemRawPagina(valor) {
        const texto = String(serializarIdPagina(valor) || "").trim();

        if (!texto) {
          return "";
        }

        const partes = texto.split("_").filter(Boolean);

        if (["out", "in"].includes(String(partes.at(-1) || "").toLowerCase())) {
          partes.pop();
        }

        const ultimo = String(partes.at(-1) || "").trim();

        if (ultimo && !ultimo.includes("@")) {
          return ultimo;
        }

        return texto;
      }

      function dadosMensagemStatus(msg) {
        const chave = valorAttr(msg, "id");
        const idCompleto = serializarIdPagina(chave) || "";
        const idRaw = String(
          valorAttr(chave, "id") ||
            valorAttr(msg, "idMessage") ||
            valorAttr(msg, "msgId") ||
            rawDoAlvo(idCompleto) ||
            "",
        ).trim();
        const participante =
          serializarIdPagina(valorAttr(chave, "participant")) ||
          serializarIdPagina(valorAttr(msg, "author")) ||
          null;

        return {
          chave,
          idCompleto,
          idRaw,
          participante,
        };
      }

      const alvoRaw = idRawPagina || rawDoAlvo(idMensagemPagina);
      const feeds = [];

      const adicionarFeed = (feed) => {
        if (feed && !feeds.includes(feed)) {
          feeds.push(feed);
        }
      };

      for (const id of [contatoIdPagina, idFeedPagina]) {
        if (!id) continue;

        try {
          if (typeof api.status.get === "function") {
            adicionarFeed(api.status.get(id));
          }
        } catch {}
      }

      for (const feed of listaModelos(api.whatsapp.StatusV3Store)) {
        const contato = valorAttr(feed, "contact") || null;
        const idFeedAtual = serializarIdPagina(valorAttr(feed, "id"));
        const idContatoAtual =
          serializarIdPagina(valorAttr(contato, "id")) ||
          serializarIdPagina(valorAttr(feed, "contactId"));

        if (
          idContatoAtual === contatoIdPagina ||
          idFeedAtual === contatoIdPagina ||
          idFeedAtual === idFeedPagina ||
          idContatoAtual === idFeedPagina
        ) {
          adicionarFeed(feed);
        }
      }

      let feedEncontrado = null;
      let statusMsg = null;
      let dadosStatus = null;

      for (const feed of feeds) {
        for (const msg of mensagensFeed(feed)) {
          const ids = dadosMensagemStatus(msg);
          const corresponde =
            (idMensagemPagina &&
              [ids.idCompleto, ids.idRaw].includes(idMensagemPagina)) ||
            (alvoRaw && ids.idRaw === alvoRaw) ||
            (idMensagemPagina &&
              ids.idCompleto &&
              ids.idCompleto.includes(`_${rawDoAlvo(idMensagemPagina)}_`));

          if (!corresponde) {
            continue;
          }

          feedEncontrado = feed;
          statusMsg = msg;
          dadosStatus = ids;
          break;
        }

        if (statusMsg) break;
      }

      if (!statusMsg || !dadosStatus) {
        return {
          ok: false,
          etapa: "localizar-status",
          erro: "Mensagem real do Status nao encontrada no StatusV3Store.",
        };
      }

      if (typeof statusMsg.msgContextInfo !== "function") {
        return {
          ok: false,
          etapa: "contexto-status",
          erro: "O Status localizado nao expoe contexto de resposta.",
          idStatus: dadosStatus.idCompleto || dadosStatus.idRaw || null,
        };
      }

      const contatoFeed = valorAttr(feedEncontrado, "contact") || null;
      const candidatosDestino = [];
      const destinosVistos = new Set();

      const adicionarDestino = (valor) => {
        const id = serializarIdPagina(valor);
        if (!id || id === "status@broadcast" || destinosVistos.has(id)) {
          return;
        }
        destinosVistos.add(id);
        candidatosDestino.push(id);
      };

      adicionarDestino(dadosStatus.participante);
      adicionarDestino(valorAttr(statusMsg, "author"));
      adicionarDestino(valorAttr(contatoFeed, "id"));
      adicionarDestino(valorAttr(feedEncontrado, "contactId"));
      adicionarDestino(contatoIdPagina);
      adicionarDestino(idFeedPagina);

      if (typeof api?.contact?.getPnLidEntry === "function") {
        for (const destino of [...candidatosDestino]) {
          if (!destino.endsWith("@lid") && !destino.endsWith("@c.us")) {
            continue;
          }

          try {
            const aliases = await api.contact.getPnLidEntry(destino);
            adicionarDestino(aliases?.lid);
            adicionarDestino(aliases?.phoneNumber);
          } catch {}
        }
      }

      let chatDestino = null;
      let destinoUsado = null;

      for (const destino of candidatosDestino) {
        try {
          if (typeof api.chat.get === "function") {
            const chat = api.chat.get(destino);
            if (chat) {
              chatDestino = chat;
              destinoUsado =
                serializarIdPagina(valorAttr(chat, "id")) || destino;
              break;
            }
          }
        } catch {}

        try {
          if (typeof api.chat.find === "function") {
            const chat = await api.chat.find(destino);
            if (chat) {
              chatDestino = chat;
              destinoUsado =
                serializarIdPagina(valorAttr(chat, "id")) || destino;
              break;
            }
          }
        } catch {}
      }

      if (!chatDestino || !destinoUsado) {
        return {
          ok: false,
          etapa: "localizar-chat",
          erro: "Nao consegui localizar o chat privado do autor do Status.",
          participante: dadosStatus.participante || null,
          candidatosDestino,
        };
      }

      let contexto = null;

      try {
        contexto = statusMsg.msgContextInfo(valorAttr(chatDestino, "id"));
      } catch (erro) {
        return {
          ok: false,
          etapa: "contexto-status",
          erro: erro?.message || String(erro),
          destino: destinoUsado,
          idStatus: dadosStatus.idCompleto || dadosStatus.idRaw || null,
        };
      }

      if (!contexto || typeof contexto !== "object") {
        return {
          ok: false,
          etapa: "contexto-status",
          erro: "O WhatsApp nao gerou o contexto de resposta do Status.",
          destino: destinoUsado,
        };
      }

      const chavesContexto = Object.keys(contexto);
      const temContextoCitado = chavesContexto.some((chave) =>
        /quoted|stanza|participant|remote/i.test(chave),
      );

      if (!temContextoCitado) {
        return {
          ok: false,
          etapa: "validar-contexto",
          erro: "O contexto gerado nao identifica o Status original. Envio bloqueado por seguranca.",
          destino: destinoUsado,
          chavesContexto,
        };
      }

      const rawMessage = {
        body: respostaPagina,
        type: "chat",
        subtype: null,
        urlText: null,
        urlNumber: null,
        ...contexto,
      };

      let envio = null;

      try {
        envio = await api.chat.sendRawMessage(destinoUsado, rawMessage, {
          waitForAck: true,
          markIsRead: false,
        });
      } catch (erro) {
        return {
          ok: false,
          etapa: "enviar-resposta-status",
          erro: erro?.message || String(erro),
          destino: destinoUsado,
          idStatus: dadosStatus.idCompleto || dadosStatus.idRaw || null,
          chavesContexto,
        };
      }

      if (!envio?.id) {
        return {
          ok: false,
          etapa: "confirmar-envio",
          erro: "O WhatsApp Web nao confirmou a resposta ao Status.",
          destino: destinoUsado,
          idStatus: dadosStatus.idCompleto || dadosStatus.idRaw || null,
        };
      }

      const idEnvio = serializarIdPagina(envio.id) || "";
      const idEnvioRaw = idMensagemRawPagina(envio.id);

      return {
        ok: true,
        destino: destinoUsado,
        idStatus: dadosStatus.idCompleto || dadosStatus.idRaw || null,
        idStatusRaw: dadosStatus.idRaw || null,
        participante: dadosStatus.participante || null,
        idEnvio: idEnvio || idEnvioRaw || null,
        idEnvioRaw: idEnvioRaw || null,
        ack: Number(envio.ack ?? 0),
        chavesContexto,
      };
    },
    {
      contatoIdPagina: contatoId,
      idFeedPagina: idFeed,
      idMensagemPagina: idMensagem,
      idRawPagina: idMensagemRaw,
      respostaPagina: conteudoResposta,
    },
  );

  if (!resultado?.ok) {
    console.warn(
      `[STATUS WPP] ${tipoResposta === "resposta" ? "RESPOSTA_STATUS_FALHOU" : "REACAO_STATUS_FALHOU"} | ` +
        `contato=${contatoId} | id=${idMensagemRaw || idMensagem} | ` +
        `etapa=${resultado?.etapa || "-"} | destino=${resultado?.destino || "-"} | ` +
        `erro=${resultado?.erro || "sem detalhe"}`,
    );

    throw new Error(
      resultado?.erro ||
        `O WhatsApp Web nao confirmou a ${tipoResposta} ao Status.`,
    );
  }

  console.log(
    `[STATUS WPP] ${tipoResposta === "resposta" ? "RESPOSTA_STATUS_ENVIADA" : "REACAO_STATUS_ENVIADA"} | ` +
      `contato=${contatoId} | destino=${resultado.destino} | ` +
      `status=${resultado.idStatusRaw || idMensagemRaw || idMensagem} | ` +
      `mensagem=${resultado.idEnvio} | ack=${resultado.ack}`,
  );

  return {
    ok: true,
    contatoId,
    idMensagem: resultado.idStatus || idMensagem,
    idMensagemRaw: resultado.idStatusRaw || idMensagemRaw || null,
    participante: resultado.participante || null,
    emoji: emoji || null,
    texto: textoResposta || null,
    idMensagemEnviada: resultado.idEnvio,
    idMensagemEnviadaRaw: resultado.idEnvioRaw || null,
    via: "wppconnect-status-contexto-nativo",
  };
}

async function responderStatusWpp(dados = {}) {
  const texto = String(dados?.texto || "").trim();

  if (!texto) {
    throw new Error("Digite uma resposta para o Status.");
  }

  return reagirStatusWpp({
    ...(dados || {}),
    emoji: null,
    texto,
  });
}

function mimeArquivoStatusWpp(caminho, tipo) {
  const extensao = path.extname(String(caminho || "")).toLowerCase();

  if (tipo === "video") {
    return "video/mp4";
  }

  if (extensao === ".png") return "image/png";
  if (extensao === ".webp") return "image/webp";
  if (extensao === ".gif") return "image/gif";

  return "image/jpeg";
}

function idsMeuStatusResultadoWpp(resultado = {}) {
  const ids = new Set();
  const mensagens = Array.isArray(resultado?.meuStatus?.mensagens)
    ? resultado.meuStatus.mensagens
    : [];

  for (const mensagem of mensagens) {
    for (const valor of [mensagem?.idMensagem, mensagem?.idMensagemRaw]) {
      const id = String(valor || "").trim();
      if (id) ids.add(id);
    }
  }

  return ids;
}

function mensagemMeuStatusNovaWpp(mensagem, idsAntes = new Set()) {
  const ids = [mensagem?.idMensagem, mensagem?.idMensagemRaw]
    .map((valor) => String(valor || "").trim())
    .filter(Boolean);

  return ids.length > 0 && ids.some((id) => !idsAntes.has(id));
}

async function aguardarPublicacaoMeuStatusWpp({
  idsAntes,
  tipo,
  texto = "",
  legenda = "",
  timeoutMs = 14000,
} = {}) {
  const inicio = Date.now();
  let ultimo = null;

  while (Date.now() - inicio <= timeoutMs) {
    try {
      ultimo = await listarStatusWpp();
    } catch {}

    const mensagens = Array.isArray(ultimo?.meuStatus?.mensagens)
      ? ultimo.meuStatus.mensagens
      : [];

    const candidatos = mensagens
      .filter((mensagem) => mensagemMeuStatusNovaWpp(mensagem, idsAntes))
      .filter((mensagem) => String(mensagem?.tipo || "").toLowerCase() === tipo)
      .sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));

    let encontrada = null;

    if (tipo === "texto") {
      const alvo = String(texto || "").trim();
      encontrada = candidatos.find(
        (mensagem) => String(mensagem?.texto || "").trim() === alvo,
      );
    } else if (legenda) {
      const alvo = String(legenda || "").trim();
      encontrada = candidatos.find(
        (mensagem) => String(mensagem?.texto || "").trim() === alvo,
      );
    }

    encontrada ||= candidatos[0] || null;

    if (encontrada?.idMensagem || encontrada?.idMensagemRaw) {
      return {
        ok: true,
        mensagem: encontrada,
        resultado: ultimo,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return {
    ok: false,
    mensagem: null,
    resultado: ultimo,
  };
}

async function garantirUploadMidiaMainThreadStatusWpp() {
  if (!client?.page) {
    return {
      ok: false,
      erro: "Pagina do WPPConnect indisponivel para aplicar patch de upload.",
    };
  }

  const resultado = await client.page.evaluate(() => {
    try {
      const api = window.WPP;
      const funcaoAB = api?.whatsapp?.functions?.getABPropConfigValue;
      const mapaModulos = api?.whatsapp?._moduleIdMap;
      const loader = api?.loader;

      if (
        typeof funcaoAB !== "function" ||
        typeof mapaModulos?.get !== "function" ||
        typeof loader?.loadModule !== "function"
      ) {
        return {
          ok: false,
          erro: "Bindings WA-JS para patch de upload nao estao disponiveis.",
        };
      }

      const moduloId = mapaModulos.get(funcaoAB);

      if (!moduloId) {
        return {
          ok: false,
          erro: "Modulo de AB props do WhatsApp nao foi localizado.",
        };
      }

      const modulo = loader.loadModule(moduloId);
      let dono = modulo;
      let chave = null;

      if (modulo?.getABPropConfigValue === funcaoAB) {
        chave = "getABPropConfigValue";
      } else if (modulo?.default?.getABPropConfigValue === funcaoAB) {
        dono = modulo.default;
        chave = "getABPropConfigValue";
      } else {
        for (const [nome, valor] of Object.entries(modulo || {})) {
          if (valor === funcaoAB) {
            chave = nome;
            break;
          }
        }
      }

      if (!chave || typeof dono?.[chave] !== "function") {
        return {
          ok: false,
          erro: "Funcao real de AB props nao foi encontrada no modulo.",
        };
      }

      if (dono[chave].__whatsiappUploadMainThread === true) {
        return {
          ok: true,
          aplicado: false,
          jaAplicado: true,
          moduloId: String(moduloId),
        };
      }

      const original = dono[chave];

      const corrigida = function (...args) {
        if (args[0] === "web_media_encrypt_upload_in_worker_enabled") {
          return false;
        }

        return original.apply(this, args);
      };

      try {
        Object.defineProperty(corrigida, "__whatsiappUploadMainThread", {
          value: true,
          configurable: false,
          enumerable: false,
          writable: false,
        });
      } catch {}

      dono[chave] = corrigida;

      return {
        ok: dono[chave] === corrigida,
        aplicado: dono[chave] === corrigida,
        jaAplicado: false,
        moduloId: String(moduloId),
        erro:
          dono[chave] === corrigida
            ? null
            : "WhatsApp recusou a substituicao da funcao de AB props.",
      };
    } catch (erro) {
      return {
        ok: false,
        erro: erro?.message || String(erro),
      };
    }
  });

  if (resultado?.ok) {
    console.log(
      `[STATUS WPP] PATCH_UPLOAD_MAIN_THREAD_OK | aplicado=${resultado.aplicado ? "sim" : "nao"} | modulo=${resultado.moduloId || "-"}`,
    );
  } else {
    console.warn(
      `[STATUS WPP] PATCH_UPLOAD_MAIN_THREAD_FALHOU | erro=${resultado?.erro || "sem detalhe"}`,
    );
  }

  return resultado;
}

async function publicarStatusWpp(dados = {}) {
  if (!client) {
    throw new Error("Publicacao de Status indisponivel no WPPConnect.");
  }

  const tipo = normalizarTipoStatusWpp(dados?.tipo);
  const antes = await listarStatusWpp();
  const idsAntes = idsMeuStatusResultadoWpp(antes);

  if (tipo === "texto") {
    const texto = String(dados?.texto || "").trim();
    const corFundo = String(dados?.corFundo || "#005c4b").trim();
    const fonte = Number.isFinite(Number(dados?.fonte))
      ? Number(dados.fonte)
      : 2;

    if (!texto) {
      throw new Error("Digite um texto para publicar.");
    }

    if (typeof client.sendTextStatus !== "function") {
      throw new Error("sendTextStatus nativo indisponivel no WPPConnect.");
    }

    console.log("[STATUS WPP] PUBLICAR_TEXTO_NATIVO_INICIO");

    try {
      await client.sendTextStatus(texto, {
        backgroundColor: corFundo,
        font: fonte,
      });
    } catch (erro) {
      throw new Error(
        `Falha ao publicar Status de texto nativo: ${erro?.message || erro}`,
      );
    }

    const confirmado = await aguardarPublicacaoMeuStatusWpp({
      idsAntes,
      tipo: "texto",
      texto,
      timeoutMs: 16000,
    });

    const mensagem = confirmado?.mensagem;

    if (!mensagem?.idMensagem && !mensagem?.idMensagemRaw) {
      throw new Error(
        "O WhatsApp aceitou o envio, mas o Status de texto nativo nao apareceu em Meu status dentro do prazo.",
      );
    }

    console.log(
      `[STATUS WPP] PUBLICAR_TEXTO_NATIVO_OK | id=${mensagem.idMensagemRaw || mensagem.idMensagem}`,
    );

    return {
      ok: true,
      tipo: "texto",
      idMensagem: mensagem.idMensagem || null,
      idMensagemRaw: mensagem.idMensagemRaw || null,
      ack: null,
      via: "wppconnect-status-texto-nativo",
    };
  }

  if (!["imagem", "video"].includes(tipo)) {
    throw new Error("Tipo de Status nao suportado.");
  }

  if (tipo === "video") {
    throw new Error(
      "Publicacao de video em Status esta temporariamente indisponivel.",
    );
  }

  const caminhoOriginal = String(dados?.caminho || "").trim();
  const legenda = String(dados?.legenda || "").trim();

  if (!caminhoOriginal || !fs.existsSync(caminhoOriginal)) {
    throw new Error("Arquivo do Status nao encontrado.");
  }

  let caminhoEnvio = caminhoOriginal;
  let arquivoTemporario = null;

  if (tipo === "video") {
    if (client?.page) {
      const transporte = await client.page.evaluate(() => {
        const fn = window.WPP?.whatsapp?.functions?.getABPropConfigValue;

        if (typeof fn !== "function") {
          return {
            disponivel: false,
            workerUploadAtivo: null,
          };
        }

        try {
          return {
            disponivel: true,
            workerUploadAtivo:
              fn("web_media_encrypt_upload_in_worker_enabled") === true,
          };
        } catch (erro) {
          return {
            disponivel: false,
            workerUploadAtivo: null,
            erro: erro?.message || String(erro),
          };
        }
      });

      if (transporte?.workerUploadAtivo === true) {
        throw new Error(
          "Patch de compatibilidade de upload do WA-JS 4.6.0 nao esta aplicado. Execute o postinstall do WhatsIAPP antes de publicar video em Status.",
        );
      }

      console.log(
        `[STATUS WPP] VIDEO_UPLOAD_MAIN_THREAD | ab=${transporte?.workerUploadAtivo === false ? "off" : "indisponivel"}`,
      );
    }

    garantirPastaMediaWpp();
    fs.mkdirSync(pastaStatusWpp(), { recursive: true });

    arquivoTemporario = path.join(
      pastaStatusWpp(),
      `publicar_${Date.now()}.mp4`,
    );

    console.log("[STATUS WPP] PUBLICAR_VIDEO_PREPARANDO");

    await converterVideoAnexoParaMp4(caminhoOriginal, arquivoTemporario);

    if (
      !fs.existsSync(arquivoTemporario) ||
      fs.statSync(arquivoTemporario).size <= 0
    ) {
      throw new Error("O video preparado para Status ficou vazio.");
    }

    caminhoEnvio = arquivoTemporario;
  }

  try {
    const metodo =
      tipo === "video" ? client.sendVideoStatus : client.sendImageStatus;

    if (typeof metodo !== "function") {
      throw new Error(
        tipo === "video"
          ? "sendVideoStatus indisponivel no WPPConnect."
          : "sendImageStatus indisponivel no WPPConnect.",
      );
    }

    console.log(
      `[STATUS WPP] PUBLICAR_MIDIA_NATIVA_INICIO | tipo=${tipo} | bytes=${fs.statSync(caminhoEnvio).size}`,
    );

    let idDireto = "";
    let ackDireto = null;

    if (tipo === "video") {
      // O WPPConnect oficial dispara WPP.status.sendVideoStatus() dentro da
      // pagina sem aguardar a Promise do WA-JS. Isso evita o timeout interno
      // timeout_on_send_status de 30 s. A confirmacao real e feita abaixo
      // consultando "Meu status", que e o estado que realmente nos interessa.
      await client.sendVideoStatus(caminhoEnvio, {
        caption: legenda || undefined,
      });

      console.log(
        "[STATUS WPP] PUBLICAR_VIDEO_DISPARADO_WPPCONNECT | aguardando Meu status",
      );
    } else if (client?.page) {
      // Imagem permanece no fluxo direto atual, que ja esta validado.
      const mime = mimeArquivoStatusWpp(caminhoEnvio, tipo);
      const conteudo = `data:${mime};base64,${fs.readFileSync(caminhoEnvio).toString("base64")}`;

      const direto = await client.page.evaluate(
        async ({ conteudo, legenda }) => {
          const api = window.WPP;
          const fn = api?.status?.sendImageStatus;

          if (typeof fn !== "function") {
            return { disponivel: false, ok: false, id: "", ack: null };
          }

          function idTexto(valor) {
            if (!valor) return "";
            if (typeof valor === "string") return valor;
            if (typeof valor?._serialized === "string") {
              return valor._serialized;
            }
            try {
              const texto = valor.toString?.();
              if (texto && texto !== "[object Object]") return String(texto);
            } catch {}
            return "";
          }

          try {
            const resultado = await fn.call(api.status, conteudo, {
              caption: legenda || undefined,
              waitForAck: true,
            });

            const id =
              idTexto(resultado?.id) ||
              idTexto(resultado?.messageId) ||
              idTexto(resultado?.msgId) ||
              idTexto(resultado?.message?.id) ||
              idTexto(resultado?.key) ||
              "";

            const ackNumero = Number(
              resultado?.ack ?? resultado?.message?.ack ?? NaN,
            );

            return {
              disponivel: true,
              ok: !!resultado,
              id,
              ack: Number.isFinite(ackNumero) ? ackNumero : null,
              erro: resultado
                ? null
                : "WA-JS nao retornou confirmacao do Status.",
            };
          } catch (erro) {
            return {
              disponivel: true,
              ok: false,
              id: "",
              ack: null,
              erro: erro?.message || String(erro),
            };
          }
        },
        { conteudo, legenda },
      );

      if (direto?.disponivel && direto?.ok) {
        idDireto = String(direto?.id || "").trim();
        ackDireto = direto?.ack ?? null;

        if (!idDireto) {
          console.warn(
            `[STATUS WPP] PUBLICAR_MIDIA_DIRETA_SEM_ID | tipo=${tipo}`,
          );
        }
      } else if (direto?.disponivel) {
        throw new Error(
          direto?.erro || "WA-JS nao confirmou o Status de imagem.",
        );
      } else {
        await client.sendImageStatus(caminhoEnvio, {
          caption: legenda || undefined,
        });
      }
    } else {
      await metodo.call(client, caminhoEnvio, {
        caption: legenda || undefined,
      });
    }

    if (idDireto) {
      const cache = registrarMeuStatusNoCacheWpp({
        idMensagem: idDireto,
        tipo,
        texto: legenda,
        mime: mimeArquivoStatusWpp(caminhoEnvio, tipo),
        caminhoMidia: caminhoEnvio,
        pendenteSincronizacao: true,
        pendenteAte: Date.now() + 60000,
      });

      const idRaw =
        cache?.idMensagemRaw || idRawStatusWpp(idDireto) || idDireto;
      const idCompleto = cache?.idMensagem || idDireto;

      console.log(
        `[STATUS WPP] PUBLICAR_MIDIA_NATIVA_OK_DIRETO | tipo=${tipo} | id=${idRaw} | ack=${ackDireto ?? "null"}`,
      );

      return {
        ok: true,
        tipo,
        idMensagem: idCompleto,
        idMensagemRaw: idRaw,
        ack: ackDireto,
        via:
          tipo === "video"
            ? "wa-js-status-video-id-direto"
            : "wa-js-status-imagem-id-direto",
      };
    }

    const confirmado = await aguardarPublicacaoMeuStatusWpp({
      idsAntes,
      tipo,
      legenda,
      timeoutMs: tipo === "video" ? 45000 : 16000,
    });

    const mensagem = confirmado?.mensagem;

    if (!mensagem?.idMensagem && !mensagem?.idMensagemRaw) {
      throw new Error(
        `O WhatsApp aceitou o envio, mas o Status de ${tipo} nao apareceu em Meu status dentro do prazo.`,
      );
    }

    console.log(
      `[STATUS WPP] PUBLICAR_MIDIA_NATIVA_OK | tipo=${tipo} | id=${mensagem.idMensagemRaw || mensagem.idMensagem}`,
    );

    return {
      ok: true,
      tipo,
      idMensagem: mensagem.idMensagem || null,
      idMensagemRaw: mensagem.idMensagemRaw || null,
      ack: null,
      via:
        tipo === "video"
          ? "wppconnect-status-video-nativo"
          : "wppconnect-status-imagem-nativo",
    };
  } finally {
    if (arquivoTemporario) {
      try {
        fs.rmSync(arquivoTemporario, { force: true });
      } catch {}
    }
  }
}

async function listarVisualizadoresStatusWpp(dados = {}) {
  if (!client?.page) {
    throw new Error("Visualizacoes de Status indisponiveis no WPPConnect.");
  }

  const idResolvido = await resolverIdMensagemStatusWpp(dados);
  const idMensagem = String(idResolvido?.idMensagem || "").trim();

  if (!idMensagem) {
    throw new Error("Status sem identificador valido para visualizacoes.");
  }

  const resultado = await client.page.evaluate(async (idMensagemPagina) => {
    const api = window.WPP;

    if (typeof api?.chat?.getMessageACK !== "function") {
      return {
        ok: false,
        erro: "getMessageACK indisponivel.",
      };
    }

    const serializarId = (valor) => {
      if (!valor) return "";
      if (typeof valor === "string") return valor;

      try {
        const texto = valor.toString?.();
        if (texto && texto !== "[object Object]") {
          return String(texto);
        }
      } catch {}

      try {
        if (valor._serialized) return String(valor._serialized);
      } catch {}

      return "";
    };

    const nomeContato = (contato, id) => {
      const candidatos = [
        contato?.name,
        contato?.formattedName,
        contato?.shortName,
        contato?.pushname,
        contato?.pushName,
        contato?.verifiedName,
      ];

      for (const valor of candidatos) {
        const texto = String(valor || "").trim();
        if (texto) return texto;
      }

      return String(id || "Contato")
        .replace("@c.us", "")
        .replace("@s.whatsapp.net", "")
        .replace("@lid", "");
    };

    try {
      const ack = await api.chat.getMessageACK(idMensagemPagina);
      const participantes = Array.isArray(ack?.participants)
        ? ack.participants
        : [];
      const visualizadores = [];

      for (const participante of participantes) {
        const visualizadoEm = Number(
          participante?.playedAt || participante?.readAt || 0,
        );

        if (!visualizadoEm) {
          continue;
        }

        const id =
          serializarId(participante?.wid) ||
          String(participante?.id || "").trim();

        if (!id) {
          continue;
        }

        let contato = null;

        try {
          if (typeof api?.contact?.get === "function") {
            contato = await api.contact.get(id);
          }
        } catch {}

        visualizadores.push({
          id,
          nome: nomeContato(contato, id),
          visualizadoEm,
        });
      }

      visualizadores.sort(
        (a, b) => Number(b.visualizadoEm || 0) - Number(a.visualizadoEm || 0),
      );

      return {
        ok: true,
        visualizadores,
        total: visualizadores.length,
      };
    } catch (erro) {
      return {
        ok: false,
        erro: erro?.message || String(erro),
      };
    }
  }, idMensagem);

  if (!resultado?.ok) {
    throw new Error(
      resultado?.erro || "Nao foi possivel consultar as visualizacoes.",
    );
  }

  console.log(
    `[STATUS WPP] VISUALIZADORES | id=${idResolvido?.idMensagemRaw || idMensagem} | total=${resultado.total || 0}`,
  );

  return {
    ok: true,
    idMensagem,
    visualizadores: Array.isArray(resultado.visualizadores)
      ? resultado.visualizadores
      : [],
    total: Number(resultado.total || 0) || 0,
  };
}

async function apagarStatusWpp(dados = {}) {
  if (!client?.page) {
    throw new Error("Remocao de Status indisponivel no WPPConnect.");
  }

  let idMensagem = String(dados?.idMensagem || "").trim();
  let idMensagemRaw = String(dados?.idMensagemRaw || "").trim();

  try {
    const resolvido = await resolverIdMensagemStatusWpp(dados);
    idMensagem = String(resolvido?.idMensagem || idMensagem).trim();
    idMensagemRaw = String(
      resolvido?.idMensagemRaw || idMensagemRaw || "",
    ).trim();
  } catch (erro) {
    console.warn(
      `[STATUS WPP] APAGAR_RESOLUCAO_FALLBACK | erro=${erro?.message || erro}`,
    );
  }

  if (!idMensagem && !idMensagemRaw) {
    throw new Error("Status sem identificador valido para remocao.");
  }

  console.log(
    `[STATUS WPP] APAGAR_INICIO_V6 | id=${idMensagemRaw || idMensagem}`,
  );

  const resultado = await client.page.evaluate(
    async ({ idCompletoPagina, idRawPagina }) => {
      const api = window.WPP;
      const store = api?.whatsapp?.StatusV3Store;

      if (!api || !store) {
        return {
          ok: false,
          etapa: "status-store",
          erro: "StatusV3Store indisponivel.",
        };
      }

      function valorAttr(objeto, chave) {
        if (!objeto) return undefined;
        try {
          if (objeto[chave] !== undefined) return objeto[chave];
        } catch {}
        try {
          if (typeof objeto.get === "function") return objeto.get(chave);
        } catch {}
        return undefined;
      }

      function listaModelos(valor) {
        if (!valor) return [];
        if (Array.isArray(valor)) return valor;
        try {
          if (typeof valor.getModelsArray === "function") {
            const lista = valor.getModelsArray();
            if (Array.isArray(lista)) return lista;
          }
        } catch {}
        try {
          if (typeof valor.toArray === "function") {
            const lista = valor.toArray();
            if (Array.isArray(lista)) return lista;
          }
        } catch {}
        if (Array.isArray(valor.models)) return valor.models;
        if (Array.isArray(valor._models)) return valor._models;
        return [];
      }

      function mensagensFeed(feed) {
        if (!feed) return [];
        try {
          if (typeof feed.getAllMsgs === "function") {
            const lista = feed.getAllMsgs();
            const modelos = listaModelos(lista);
            if (modelos.length) return modelos;
            if (Array.isArray(lista)) return lista;
          }
        } catch {}
        return listaModelos(valorAttr(feed, "msgs"));
      }

      function serializar(valor) {
        if (!valor) return "";
        if (typeof valor === "string") return valor.trim();
        try {
          if (typeof valor._serialized === "string") {
            return valor._serialized.trim();
          }
        } catch {}
        try {
          const texto = valor.toString?.();
          if (texto && texto !== "[object Object]") {
            return String(texto).trim();
          }
        } catch {}
        return "";
      }

      function rawDoAlvo(valor) {
        const texto = String(valor || "").trim();
        if (!texto) return "";
        const partes = texto.split("_").filter(Boolean);
        const indice = partes.findIndex((parte) =>
          String(parte).includes("status@broadcast"),
        );
        return indice >= 0 && partes[indice + 1]
          ? String(partes[indice + 1]).trim()
          : texto;
      }

      function rawDaMensagem(msg) {
        const chave = valorAttr(msg, "id");
        const direto =
          chave && typeof chave === "object" ? valorAttr(chave, "id") : null;
        if (direto) return String(direto).trim();

        const alternativo =
          valorAttr(msg, "idMessage") || valorAttr(msg, "msgId") || "";
        if (alternativo) return String(alternativo).trim();

        return rawDoAlvo(serializar(chave));
      }

      function mensagemStatusAtiva(msg) {
        if (!msg) return false;

        const tipo = String(
          valorAttr(msg, "type") || valorAttr(msg, "mediaData")?.type || "",
        )
          .trim()
          .toLowerCase();
        const subtipo = String(
          valorAttr(msg, "subtype") || valorAttr(msg, "subType") || "",
        )
          .trim()
          .toLowerCase();

        if (
          /^(?:revoked|revoke|deleted|delete|removed|remove)$/.test(tipo) ||
          /(?:revok|delet|remov)/.test(subtipo)
        ) {
          return false;
        }

        for (const nome of [
          "isRevoked",
          "revoked",
          "isDeleted",
          "deleted",
          "isRemoved",
          "removed",
        ]) {
          const valor = valorAttr(msg, nome);

          if (valor === true || valor === 1 || valor === "true") {
            return false;
          }

          if (typeof valor === "function") {
            try {
              if (valor.call(msg) === true) return false;
            } catch {}
          }
        }

        return true;
      }

      const rawAlvo = String(idRawPagina || rawDoAlvo(idCompletoPagina)).trim();
      const completoAlvo = String(idCompletoPagina || "").trim();

      async function obterFeedsMeuStatus() {
        const feeds = [];
        const vistos = new Set();

        function adicionar(feed, via) {
          if (!feed) return;
          const id = serializar(valorAttr(feed, "id"));
          const chave = id || `ref:${feeds.length}`;
          if (vistos.has(chave)) return;
          vistos.add(chave);
          feeds.push({ feed, via, id });
        }

        try {
          if (typeof store.getMyStatus === "function") {
            adicionar(
              await Promise.resolve(store.getMyStatus()),
              "getMyStatus",
            );
          }
        } catch {}

        const prefs = api?.whatsapp?.UserPrefs || null;
        let pn = null;
        let lid = null;

        try {
          pn = prefs?.getMaybeMePnUser?.() || null;
        } catch {}

        try {
          lid = prefs?.getMaybeMeLidUser?.() || null;
        } catch {}

        for (const [valor, via] of [
          [pn, "get-pn"],
          [lid, "get-lid"],
        ]) {
          if (!valor) continue;
          try {
            if (typeof store.get === "function") {
              adicionar(store.get(valor), via);
            }
          } catch {}
        }

        for (const [valor, via] of [
          [pn, "find-pn"],
          [lid, "find-lid"],
        ]) {
          if (!valor || typeof store.find !== "function") continue;
          try {
            const encontrado = await Promise.race([
              Promise.resolve(store.find(valor)),
              new Promise((resolve) => setTimeout(() => resolve(null), 1800)),
            ]);
            adicionar(encontrado, via);
          } catch {}
        }

        return feeds;
      }

      async function localizar() {
        const feeds = await obterFeedsMeuStatus();

        for (const item of feeds) {
          for (const mensagem of mensagensFeed(item.feed)) {
            if (!mensagemStatusAtiva(mensagem)) {
              continue;
            }

            const chave = valorAttr(mensagem, "id");
            const chaveTexto = serializar(chave);
            const raw = rawDaMensagem(mensagem);
            const fromMe = !!(
              valorAttr(chave, "fromMe") ?? valorAttr(mensagem, "fromMe")
            );

            const corresponde =
              (rawAlvo && raw === rawAlvo) ||
              (completoAlvo && chaveTexto === completoAlvo) ||
              (rawAlvo && chaveTexto.includes(`_${rawAlvo}`));

            if (corresponde && fromMe) {
              return {
                feed: item.feed,
                feedVia: item.via,
                mensagem,
                chave,
                chaveTexto,
                raw,
                feeds,
              };
            }
          }
        }

        return null;
      }

      let localizado = await localizar();

      if (!localizado) {
        for (const espera of [180, 350, 650, 1000]) {
          await new Promise((resolve) => setTimeout(resolve, espera));
          localizado = await localizar();
          if (localizado) break;
        }
      }

      if (!localizado) {
        return {
          ok: true,
          via: "ja-ausente-no-meu-status",
          idReal: completoAlvo || null,
          idRaw: rawAlvo || null,
        };
      }

      const { feed, feedVia, mensagem, chave, chaveTexto, raw } = localizado;

      async function continuaPresente() {
        return !!(await localizar());
      }

      async function confirmarAusencia() {
        for (const espera of [100, 220, 420, 750, 1200, 1800]) {
          await new Promise((resolve) => setTimeout(resolve, espera));
          if (!(await continuaPresente())) return true;
        }
        return !(await continuaPresente());
      }

      async function tentarRevokeDiretoCompat() {
        try {
          const requireWa = window.require;

          if (typeof requireWa !== "function") {
            return {
              ok: false,
              erro: "window.require-indisponivel",
              diagnostico: { require: false },
            };
          }

          let collections = null;
          let action = null;
          let statusReal = feed;
          let msgReal = mensagem;
          let erroCollections = null;

          try {
            collections = requireWa("WAWebCollections");
          } catch (erro) {
            erroCollections = erro?.message || String(erro);
          }

          try {
            const statusColecao = collections?.Status?.getMyStatus?.();
            if (statusColecao) {
              statusReal = statusColecao;
            }
          } catch {}

          // Replica o caminho usado atualmente pelo whatsapp-web.js:
          // WAWebCollections.Status.getMyStatus() +
          // WAWebRevokeStatusAction.sendStatusRevokeMsgAction(status, msg).
          // Mantemos o MsgModel real que ja foi localizado no StatusV3Store.
          try {
            action = requireWa("WAWebRevokeStatusAction");
          } catch (erro) {
            return {
              ok: false,
              erro: `require-WAWebRevokeStatusAction:${erro?.message || String(erro)}`,
              diagnostico: {
                require: true,
                collections: !!collections,
                erroCollections,
              },
            };
          }

          const fn =
            action?.sendStatusRevokeMsgAction ||
            (typeof action?.default === "function" ? action.default : null);

          if (typeof fn !== "function") {
            return {
              ok: false,
              erro: "WAWebRevokeStatusAction-sem-funcao",
              diagnostico: {
                require: true,
                collections: !!collections,
                exports: Object.keys(action || {}).slice(0, 20),
              },
            };
          }

          await fn(statusReal, msgReal);

          if (await confirmarAusencia()) {
            return {
              ok: true,
              via: action?.sendStatusRevokeMsgAction
                ? "WAWebRevokeStatusAction.sendStatusRevokeMsgAction"
                : "WAWebRevokeStatusAction.default",
            };
          }

          return {
            ok: false,
            erro: "revoke-direto-sem-remocao-confirmada",
            diagnostico: {
              require: true,
              collections: !!collections,
              funcao: action?.sendStatusRevokeMsgAction
                ? "sendStatusRevokeMsgAction"
                : "default",
            },
          };
        } catch (erro) {
          if (await confirmarAusencia()) {
            return {
              ok: true,
              via: "WAWebRevokeStatusAction-pos-condicao",
            };
          }

          return {
            ok: false,
            erro: `revoke-direto:${erro?.name || "Error"}:${
              erro?.message || String(erro)
            }`,
          };
        }
      }

      function obterRevokeExportado() {
        const direto = api?.whatsapp?.functions?.revokeStatus;
        if (typeof direto === "function") {
          return { fn: direto, via: "whatsapp.functions.revokeStatus" };
        }
        return null;
      }

      function obterRevokeDinamico() {
        try {
          if (typeof api?.loader?.search === "function") {
            const modulo = api.loader.search(
              (m, id) =>
                typeof m?.sendStatusRevokeMsgAction === "function" ||
                (id === "WAWebRevokeStatusAction" &&
                  typeof m?.default === "function") ||
                (typeof m?.default === "function" &&
                  String(m.default?.displayName || "").includes(
                    "RevokeStatusAction",
                  )),
              false,
              "sendStatusRevokeMsgAction",
            );

            const fn =
              modulo?.sendStatusRevokeMsgAction || modulo?.default || null;

            if (typeof fn === "function") {
              return { fn, via: "loader.search-revokeStatus" };
            }
          }
        } catch {}

        try {
          if (typeof api?.loader?.modules === "function") {
            const modulos = api.loader.modules(
              (m, id) =>
                typeof m?.sendStatusRevokeMsgAction === "function" ||
                (id === "WAWebRevokeStatusAction" &&
                  typeof m?.default === "function") ||
                (typeof m?.default === "function" &&
                  String(m.default?.displayName || "").includes(
                    "RevokeStatusAction",
                  )),
            );

            for (const modulo of Object.values(modulos || {})) {
              const fn =
                modulo?.sendStatusRevokeMsgAction || modulo?.default || null;
              if (typeof fn === "function") {
                return { fn, via: "loader.modules-revokeStatus" };
              }
            }
          }
        } catch {}

        return null;
      }

      async function tentarBootloadRevokeStatus() {
        const diagnostico = {
          ensureLazyModule: null,
          bootloader: false,
          totalComponentes: 0,
          candidatos: [],
          tentados: [],
          erros: [],
        };

        // Mantem compatibilidade com versoes futuras do WA-JS que eventualmente
        // passem a registrar o revoke de Status no mapa oficial de lazy modules.
        if (typeof api?.loader?.ensureLazyModule === "function") {
          try {
            diagnostico.ensureLazyModule = await Promise.race([
              Promise.resolve(
                api.loader.ensureLazyModule("WAWebRevokeStatusAction"),
              ),
              new Promise((resolve) => setTimeout(() => resolve(false), 2500)),
            ]);
          } catch (erro) {
            diagnostico.erros.push(
              `ensureLazyModule:${erro?.message || String(erro)}`,
            );
          }

          const aposEnsure = await tentarRevokeDiretoCompat();
          if (aposEnsure?.ok) {
            return {
              ok: true,
              via: `ensureLazyModule:${aposEnsure.via || "revoke"}`,
              diagnostico,
            };
          }
        }

        const moduleRequire = api?.loader?.moduleRequire;

        if (typeof moduleRequire !== "function") {
          diagnostico.erros.push("loader.moduleRequire-indisponivel");
          return { ok: false, diagnostico };
        }

        let bootloader = null;

        try {
          const modulo = moduleRequire("Bootloader");
          bootloader =
            typeof modulo?.loadModules === "function"
              ? modulo
              : modulo?.default;
        } catch (erro) {
          diagnostico.erros.push(
            `Bootloader-require:${erro?.message || String(erro)}`,
          );
        }

        if (typeof bootloader?.loadModules !== "function") {
          diagnostico.erros.push("Bootloader.loadModules-indisponivel");
          return { ok: false, diagnostico };
        }

        diagnostico.bootloader = true;

        let debugBootloader = null;
        try {
          debugBootloader =
            typeof bootloader.__debug === "function"
              ? bootloader.__debug()
              : bootloader.__debug;
        } catch {}

        const componentMap = debugBootloader?.componentMap;
        let nomes = [];

        try {
          if (componentMap && typeof componentMap.keys === "function") {
            nomes = Array.from(componentMap.keys()).map((item) => String(item));
          } else if (componentMap && typeof componentMap === "object") {
            nomes = Object.keys(componentMap);
          }
        } catch {}

        diagnostico.totalComponentes = nomes.length;

        function pontuarComponente(nome) {
          const texto = String(nome || "").toLowerCase();
          let pontos = 0;

          if (/status/.test(texto)) pontos += 120;
          if (/revoke/.test(texto)) pontos += 110;
          if (/delete|remove/.test(texto)) pontos += 90;
          if (/action/.test(texto)) pontos += 55;
          if (/menu|context|option|more/.test(texto)) pontos += 45;
          if (/viewer|view/.test(texto)) pontos += 35;
          if (/drawer|modal|flow/.test(texto)) pontos += 25;
          if (/story|stories/.test(texto)) pontos += 20;
          if (/update/.test(texto)) pontos += 10;
          if (/react/.test(texto)) pontos += 5;

          return pontos;
        }

        const candidatos = nomes
          .filter((nome) => {
            const texto = String(nome || "").toLowerCase();
            return (
              /status/.test(texto) ||
              /stor(?:y|ies)/.test(texto) ||
              (/update/.test(texto) &&
                /viewer|menu|action|delete|remove/.test(texto))
            );
          })
          .sort((a, b) => {
            const diferenca = pontuarComponente(b) - pontuarComponente(a);
            return diferenca || a.length - b.length || a.localeCompare(b);
          })
          .slice(0, 12);

        diagnostico.candidatos = candidatos.slice(0, 12);

        function bootloadComponente(nome, timeout = 2600) {
          return new Promise((resolve, reject) => {
            let finalizado = false;
            const timer = setTimeout(() => {
              if (finalizado) return;
              finalizado = true;
              reject(new Error(`timeout:${nome}`));
            }, timeout);

            try {
              bootloader.loadModules(
                [nome],
                () => {
                  if (finalizado) return;
                  finalizado = true;
                  clearTimeout(timer);
                  resolve(true);
                },
                "WhatsIAPP",
              );
            } catch (erro) {
              if (finalizado) return;
              finalizado = true;
              clearTimeout(timer);
              reject(erro);
            }
          });
        }

        for (const componente of candidatos) {
          diagnostico.tentados.push(componente);

          try {
            await bootloadComponente(componente);
          } catch (erro) {
            diagnostico.erros.push(
              `bootload:${componente}:${erro?.message || String(erro)}`,
            );
            continue;
          }

          const direto = await tentarRevokeDiretoCompat();

          if (direto?.ok) {
            return {
              ok: true,
              via: `bootloader:${componente}:${direto.via || "revoke"}`,
              diagnostico,
            };
          }

          if (obterRevokeExportado() || obterRevokeDinamico()) {
            return {
              ok: false,
              moduloEncontrado: true,
              diagnostico,
            };
          }
        }

        return { ok: false, diagnostico };
      }

      const erros = [];
      let diagnosticoBootloader = null;

      const diretoCompat = await tentarRevokeDiretoCompat();

      if (diretoCompat?.ok) {
        return {
          ok: true,
          via: diretoCompat.via || "WAWebRevokeStatusAction",
          idReal: chaveTexto,
          idRaw: raw,
        };
      }

      if (diretoCompat?.erro) {
        erros.push(diretoCompat.erro);
      }

      const bootload = await tentarBootloadRevokeStatus();
      diagnosticoBootloader = bootload?.diagnostico || null;

      if (bootload?.ok) {
        return {
          ok: true,
          via: bootload.via || "bootloader-revokeStatus",
          idReal: chaveTexto,
          idRaw: raw,
          diagnosticoBootloader,
        };
      }

      if (Array.isArray(diagnosticoBootloader?.erros)) {
        erros.push(...diagnosticoBootloader.erros);
      }

      const revoke = obterRevokeExportado() || obterRevokeDinamico();

      if (revoke?.fn) {
        const candidatosFeed = [];
        const feedsVistos = new Set();

        function adicionarFeedCandidato(valor, via) {
          if (!valor) return;
          const id = serializar(valorAttr(valor, "id"));
          const chaveFeed = id || `ref:${candidatosFeed.length}`;
          if (feedsVistos.has(chaveFeed)) return;
          feedsVistos.add(chaveFeed);
          candidatosFeed.push({ feed: valor, via });
        }

        adicionarFeedCandidato(feed, feedVia);

        for (const item of localizado.feeds || []) {
          adicionarFeedCandidato(item.feed, item.via);
        }

        for (const item of candidatosFeed) {
          try {
            await revoke.fn(item.feed, mensagem);
            if (await confirmarAusencia()) {
              return {
                ok: true,
                via: `${revoke.via}:${item.via}`,
                idReal: chaveTexto,
                idRaw: raw,
              };
            }
          } catch (erro) {
            erros.push(
              `${revoke.via}:${item.via}:${erro?.name || "Error"}:${
                erro?.message || String(erro)
              }`,
            );

            if (await confirmarAusencia()) {
              return {
                ok: true,
                via: `${revoke.via}:${item.via}:pos-condicao`,
                idReal: chaveTexto,
                idRaw: raw,
              };
            }
          }
        }
      } else {
        erros.push("revokeStatus:modulo-nao-encontrado");
      }

      if (typeof api?.status?.remove === "function") {
        for (const alvo of [chave, chaveTexto]) {
          try {
            const retorno = await api.status.remove(alvo);
            if (retorno !== false && (await confirmarAusencia())) {
              return {
                ok: true,
                via:
                  alvo === chave
                    ? "status.remove-msgkey-real"
                    : "status.remove-id-real",
                idReal: chaveTexto,
                idRaw: raw,
              };
            }

            if (await confirmarAusencia()) {
              return {
                ok: true,
                via: "status.remove-pos-condicao",
                idReal: chaveTexto,
                idRaw: raw,
              };
            }
          } catch (erro) {
            erros.push(
              `status.remove:${erro?.name || "Error"}:${
                erro?.message || String(erro)
              }`,
            );

            if (await confirmarAusencia()) {
              return {
                ok: true,
                via: "status.remove-erro-pos-condicao",
                idReal: chaveTexto,
                idRaw: raw,
              };
            }
          }
        }
      }

      return {
        ok: false,
        etapa: "api-remocao-v6",
        erro:
          erros.at(-1) || "Nenhuma API de remocao conseguiu revogar o Status.",
        erros,
        diagnostico: {
          feedVia,
          idReal: chaveTexto,
          idRaw: raw,
          revokeExportado:
            typeof api?.whatsapp?.functions?.revokeStatus === "function",
          loaderSearch: typeof api?.loader?.search === "function",
          loaderModules: typeof api?.loader?.modules === "function",
          statusRemove: typeof api?.status?.remove === "function",
          bootloader: !!diagnosticoBootloader?.bootloader,
          ensureLazyModule: diagnosticoBootloader?.ensureLazyModule ?? null,
          totalComponentes: Number(
            diagnosticoBootloader?.totalComponentes || 0,
          ),
          candidatosBootloader: Array.isArray(diagnosticoBootloader?.candidatos)
            ? diagnosticoBootloader.candidatos
            : [],
          tentadosBootloader: Array.isArray(diagnosticoBootloader?.tentados)
            ? diagnosticoBootloader.tentados
            : [],
        },
        idReal: chaveTexto,
        idRaw: raw,
      };
    },
    {
      idCompletoPagina: idMensagem,
      idRawPagina: idMensagemRaw,
    },
  );

  if (!resultado?.ok) {
    const diag = resultado?.diagnostico || {};
    console.warn(
      `[STATUS WPP] APAGAR_FALHOU_V6 | id=${idMensagemRaw || idMensagem} | ` +
        `etapa=${resultado?.etapa || "-"} | real=${resultado?.idReal || "-"} | ` +
        `feed=${diag.feedVia || "-"} | exportado=${diag.revokeExportado ? "sim" : "nao"} | ` +
        `loader=${diag.loaderSearch || diag.loaderModules ? "sim" : "nao"} | ` +
        `remove=${diag.statusRemove ? "sim" : "nao"} | erro=${resultado?.erro || "sem detalhe"}`,
    );

    if (Array.isArray(resultado?.erros) && resultado.erros.length) {
      console.warn(
        `[STATUS WPP] APAGAR_ERROS_V6 | ${resultado.erros.join(" || ")}`,
      );
    }

    if (
      Array.isArray(diag.candidatosBootloader) ||
      Array.isArray(diag.tentadosBootloader)
    ) {
      console.warn(
        `[STATUS WPP] APAGAR_BOOTLOADER_V6 | disponivel=${diag.bootloader ? "sim" : "nao"} | ` +
          `ensure=${String(diag.ensureLazyModule)} | componentes=${diag.totalComponentes || 0} | ` +
          `candidatos=${(diag.candidatosBootloader || []).slice(0, 12).join(",") || "-"} | ` +
          `tentados=${(diag.tentadosBootloader || []).slice(0, 12).join(",") || "-"}`,
      );
    }

    throw new Error(
      resultado?.erro || "O WhatsApp Web nao confirmou a remocao do Status.",
    );
  }

  const idApagado =
    resultado.idRaw || idMensagemRaw || resultado.idReal || idMensagem;

  removerMeuStatusDoCacheWpp(idApagado);
  registrarStatusApagadoWpp(idApagado);

  console.log(
    `[STATUS WPP] APAGAR_OK_V6 | id=${resultado.idRaw || idMensagemRaw || idMensagem} | ` +
      `via=${resultado.via || "-"}`,
  );

  return {
    ok: true,
    idMensagem: resultado.idReal || idMensagem,
    idMensagemRaw: resultado.idRaw || idMensagemRaw || null,
    via: resultado.via || "wpp-status-remove-v6",
  };
}
