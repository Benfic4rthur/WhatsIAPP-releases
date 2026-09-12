function pastaStatusWpp() {
  return path.join(pastaMediaWpp(), "status");
}

function arquivoCacheMeusStatusWpp() {
  return path.join(workerData.userDataPath, "meus-status-cache-v1.json");
}

function arquivoStatusApagadosWpp() {
  return path.join(workerData.userDataPath, "meus-status-apagados-v1.json");
}

function carregarStatusApagadosWpp() {
  try {
    const arquivo = arquivoStatusApagadosWpp();

    if (!fs.existsSync(arquivo)) {
      return [];
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    const lista = Array.isArray(dados) ? dados : [];
    const limite = Date.now() - 26 * 60 * 60 * 1000;

    return lista.filter(
      (item) =>
        String(item?.id || "").trim() && Number(item?.apagadoEm || 0) >= limite,
    );
  } catch {
    return [];
  }
}

function salvarStatusApagadosWpp(lista = []) {
  try {
    fs.mkdirSync(path.dirname(arquivoStatusApagadosWpp()), {
      recursive: true,
    });

    fs.writeFileSync(
      arquivoStatusApagadosWpp(),
      JSON.stringify(lista, null, 2),
      "utf8",
    );
  } catch {}
}

function registrarStatusApagadoWpp(idMensagem) {
  const id = idRawStatusWpp(idMensagem);

  if (!id) {
    return;
  }

  const lista = carregarStatusApagadosWpp().filter(
    (item) => String(item?.id || "") !== id,
  );

  lista.push({
    id,
    apagadoEm: Date.now(),
  });

  salvarStatusApagadosWpp(lista);
}

function filtrarStatusApagadosWpp(resultado) {
  const idsApagados = new Set(
    carregarStatusApagadosWpp()
      .map((item) => String(item?.id || "").trim())
      .filter(Boolean),
  );

  if (!idsApagados.size || !resultado?.meuStatus) {
    return resultado;
  }

  const mensagens = Array.isArray(resultado.meuStatus.mensagens)
    ? resultado.meuStatus.mensagens
    : [];

  const filtradas = mensagens.filter((item) => {
    const id = idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem);
    return !id || !idsApagados.has(id);
  });

  resultado.meuStatus.mensagens = filtradas;
  resultado.meuStatus.totalCount = filtradas.length;
  resultado.meuStatus.ultimaAtualizacao = filtradas.reduce(
    (maior, item) => Math.max(maior, Number(item?.timestamp || 0) || 0),
    0,
  );

  return resultado;
}

function pastaCacheMeusStatusWpp() {
  return path.join(pastaStatusWpp(), "meus");
}

function idRawStatusWpp(valor) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return "";
  }

  const partes = texto.split("_").filter(Boolean);
  const indiceBroadcast = partes.findIndex((parte) =>
    String(parte).includes("status@broadcast"),
  );

  if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
    return String(partes[indiceBroadcast + 1]).trim();
  }

  return texto;
}

function idCompletoMeuStatusWpp(valor) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return "";
  }

  if (texto.includes("status@broadcast")) {
    return texto;
  }

  return `true_status@broadcast_${idRawStatusWpp(texto)}`;
}

function carregarCacheMeusStatusWpp() {
  try {
    const arquivo = arquivoCacheMeusStatusWpp();

    if (!fs.existsSync(arquivo)) {
      return [];
    }

    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    const lista = Array.isArray(dados?.mensagens)
      ? dados.mensagens
      : Array.isArray(dados)
        ? dados
        : [];

    const limite = Math.floor(Date.now() / 1000) - 24 * 60 * 60;

    return lista
      .filter((item) => {
        const timestamp = Number(item?.timestamp || 0) || 0;
        return timestamp > 0 && timestamp >= limite;
      })
      .map((item) => {
        const mediaPath = String(item?.mediaPath || "").trim() || null;

        return {
          ...item,
          idMensagem: idCompletoMeuStatusWpp(
            item?.idMensagem || item?.idMensagemRaw,
          ),
          idMensagemRaw: idRawStatusWpp(
            item?.idMensagemRaw || item?.idMensagem,
          ),
          mediaPath,
          mediaUrl:
            mediaPath && fs.existsSync(mediaPath)
              ? pathToFileURL(mediaPath).href
              : null,
        };
      });
  } catch (erro) {
    console.warn(
      `[STATUS WPP] CACHE_MEUS_STATUS_LEITURA_FALHOU | erro=${erro?.message || erro}`,
    );
    return [];
  }
}

function salvarCacheMeusStatusWpp(mensagens = []) {
  try {
    const limite = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const validas = (Array.isArray(mensagens) ? mensagens : []).filter(
      (item) => (Number(item?.timestamp || 0) || 0) >= limite,
    );

    fs.mkdirSync(path.dirname(arquivoCacheMeusStatusWpp()), {
      recursive: true,
    });

    fs.writeFileSync(
      arquivoCacheMeusStatusWpp(),
      JSON.stringify(
        {
          atualizadoEm: Date.now(),
          mensagens: validas,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch (erro) {
    console.warn(
      `[STATUS WPP] CACHE_MEUS_STATUS_GRAVACAO_FALHOU | erro=${erro?.message || erro}`,
    );
  }
}

function registrarMeuStatusNoCacheWpp({
  idMensagem,
  tipo,
  texto = "",
  corFundo = null,
  mime = null,
  caminhoMidia = null,
  pendenteSincronizacao = false,
  pendenteAte = null,
} = {}) {
  const idCompleto = idCompletoMeuStatusWpp(idMensagem);
  const idRaw = idRawStatusWpp(idMensagem);

  if (!idRaw) {
    return null;
  }

  let mediaPath = null;

  if (
    caminhoMidia &&
    ["imagem", "video"].includes(String(tipo || "").toLowerCase()) &&
    fs.existsSync(caminhoMidia)
  ) {
    try {
      fs.mkdirSync(pastaCacheMeusStatusWpp(), { recursive: true });

      const extensao =
        path.extname(caminhoMidia) ||
        (String(tipo).toLowerCase() === "video" ? ".mp4" : ".jpg");

      mediaPath = path.join(
        pastaCacheMeusStatusWpp(),
        `${sanitizarNomeWpp(idRaw).slice(0, 150)}${extensao}`,
      );

      fs.copyFileSync(caminhoMidia, mediaPath);
    } catch (erro) {
      console.warn(
        `[STATUS WPP] CACHE_MEUS_STATUS_MIDIA_FALHOU | id=${idRaw} | erro=${erro?.message || erro}`,
      );
      mediaPath = null;
    }
  }

  const lista = carregarCacheMeusStatusWpp();
  const agora = Math.floor(Date.now() / 1000);
  const nova = {
    idMensagem: idCompleto,
    idMensagemRaw: idRaw,
    tipo: String(tipo || "desconhecido"),
    texto: String(texto || ""),
    timestamp: agora,
    mime: mime || null,
    duracao: null,
    largura: null,
    altura: null,
    corFundo: corFundo ?? null,
    fonte: null,
    from: null,
    to: "status@broadcast",
    mediaPath,
    pendenteSincronizacao: !!pendenteSincronizacao,
    pendenteAte:
      Number(pendenteAte || 0) ||
      (pendenteSincronizacao ? Date.now() + 60000 : null),
  };

  const filtrada = lista.filter(
    (item) => idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem) !== idRaw,
  );

  filtrada.push(nova);
  salvarCacheMeusStatusWpp(filtrada);

  console.log(
    `[STATUS WPP] CACHE_MEUS_STATUS_REGISTRADO | id=${idRaw} | tipo=${nova.tipo}`,
  );

  return nova;
}

function removerMeuStatusDoCacheWpp(idMensagem) {
  const alvo = idRawStatusWpp(idMensagem);

  if (!alvo) {
    return false;
  }

  const lista = carregarCacheMeusStatusWpp();
  const removidos = lista.filter(
    (item) => idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem) === alvo,
  );
  const restante = lista.filter(
    (item) => idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem) !== alvo,
  );

  for (const item of removidos) {
    const mediaPath = String(item?.mediaPath || "").trim();

    if (mediaPath) {
      try {
        fs.rmSync(mediaPath, { force: true });
      } catch {}
    }
  }

  salvarCacheMeusStatusWpp(restante);
  return removidos.length > 0;
}

function mesclarMeuStatusComCacheWpp(resultado) {
  const cache = carregarCacheMeusStatusWpp();
  const consultaRealOk = !!resultado?.diagnostico?.consultaMeuStatusRealOk;

  const atual = resultado?.meuStatus || {
    id: "meu-status",
    idFeed: "meu-status",
    nome: "Meu status",
    fotoUrl: null,
    meu: true,
    unreadCount: 0,
    totalCount: 0,
    ultimaAtualizacao: 0,
    mensagens: [],
  };

  const mensagensServidor = Array.isArray(atual.mensagens)
    ? atual.mensagens
    : [];

  // Quando conseguimos consultar o WhatsApp de verdade, ele e a fonte
  // autoritativa. O cache serve apenas para enriquecer uma midia correspondente,
  // nunca para ressuscitar Status apagado/expirado.
  if (consultaRealOk) {
    const cachePorId = new Map();

    for (const item of cache) {
      const chave = idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem);

      if (chave) {
        cachePorId.set(chave, item);
      }
    }

    const agoraMs = Date.now();
    const idsServidor = new Set();

    const mensagens = mensagensServidor.map((item) => {
      const chave = idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem);
      const cacheItem = chave ? cachePorId.get(chave) : null;

      if (chave) {
        idsServidor.add(chave);
      }

      return {
        ...item,
        mediaPath: item?.mediaPath || cacheItem?.mediaPath || null,
        mediaUrl: item?.mediaUrl || cacheItem?.mediaUrl || null,
        pendenteSincronizacao: false,
        pendenteAte: null,
      };
    });

    // Logo apos publicar, o WhatsApp Web pode aceitar e propagar o Status
    // para outros dispositivos antes de atualizar o StatusV3Store desta sessao.
    // Mantemos SOMENTE publicacoes recentes explicitamente marcadas como
    // pendentes. Isso evita o falso erro visual sem ressuscitar cache antigo.
    for (const item of cache) {
      const chave = idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem);
      const pendente =
        item?.pendenteSincronizacao === true &&
        Number(item?.pendenteAte || 0) > agoraMs;

      if (!chave || idsServidor.has(chave) || !pendente) {
        continue;
      }

      mensagens.push({
        ...item,
        pendenteSincronizacao: true,
      });
    }

    mensagens.sort(
      (a, b) =>
        (Number(a?.timestamp || 0) || 0) - (Number(b?.timestamp || 0) || 0),
    );

    atual.mensagens = mensagens;
    atual.totalCount = mensagens.length;
    atual.ultimaAtualizacao = mensagens.reduce(
      (maior, item) => Math.max(maior, Number(item?.timestamp || 0) || 0),
      Number(atual.ultimaAtualizacao || 0) || 0,
    );

    resultado.meuStatus = atual;

    // Mantem no cache o que ja existe no servidor e, por no maximo 60 s,
    // uma publicacao recente que ainda esteja aguardando o store local.
    const cacheValido = cache
      .filter((item) => {
        const chave = idRawStatusWpp(
          item?.idMensagemRaw || item?.idMensagem,
        );

        if (idsServidor.has(chave)) {
          return true;
        }

        return (
          item?.pendenteSincronizacao === true &&
          Number(item?.pendenteAte || 0) > agoraMs
        );
      })
      .map((item) => {
        const chave = idRawStatusWpp(
          item?.idMensagemRaw || item?.idMensagem,
        );

        if (idsServidor.has(chave)) {
          return {
            ...item,
            pendenteSincronizacao: false,
            pendenteAte: null,
          };
        }

        return item;
      });

    salvarCacheMeusStatusWpp(cacheValido);

    if (resultado?.diagnostico) {
      resultado.diagnostico.meusStatusCache = cache.length;
      resultado.diagnostico.meusStatusMesclados = mensagens.length;
      resultado.diagnostico.cacheUsadoComoFallback = false;
    }

    return resultado;
  }

  // Se a consulta real falhou por indisponibilidade temporaria do store,
  // usa o cache apenas como contingencia.
  if (!cache.length) {
    return resultado;
  }

  const porId = new Map();

  for (const item of cache) {
    const chave = idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem);

    if (chave) {
      porId.set(chave, { ...item });
    }
  }

  for (const item of mensagensServidor) {
    const chave = idRawStatusWpp(item?.idMensagemRaw || item?.idMensagem);

    if (!chave) {
      continue;
    }

    const cacheItem = porId.get(chave);

    porId.set(chave, {
      ...(cacheItem || {}),
      ...item,
      mediaPath: item?.mediaPath || cacheItem?.mediaPath || null,
      mediaUrl: item?.mediaUrl || cacheItem?.mediaUrl || null,
    });
  }

  const limite = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const mensagens = Array.from(porId.values())
    .filter((item) => {
      const timestamp = Number(item?.timestamp || 0) || 0;
      return !timestamp || timestamp >= limite;
    })
    .sort(
      (a, b) =>
        (Number(a?.timestamp || 0) || 0) - (Number(b?.timestamp || 0) || 0),
    );

  atual.mensagens = mensagens;
  atual.totalCount = mensagens.length;
  atual.ultimaAtualizacao = mensagens.reduce(
    (maior, item) => Math.max(maior, Number(item?.timestamp || 0) || 0),
    Number(atual.ultimaAtualizacao || 0) || 0,
  );

  resultado.meuStatus = atual;

  if (resultado?.diagnostico) {
    resultado.diagnostico.meusStatusCache = cache.length;
    resultado.diagnostico.meusStatusMesclados = mensagens.length;
    resultado.diagnostico.cacheUsadoComoFallback = true;
  }

  return resultado;
}

function normalizarTipoStatusWpp(valor) {
  const tipo = String(valor || "")
    .trim()
    .toLowerCase();

  if (tipo === "image" || tipo === "imagem") {
    return "imagem";
  }

  if (
    tipo === "video" ||
    tipo === "gif" ||
    tipo === "ptv" ||
    tipo === "video_status"
  ) {
    return "video";
  }

  if (
    tipo === "chat" ||
    tipo === "text" ||
    tipo === "texto" ||
    tipo === "status"
  ) {
    return "texto";
  }

  return tipo || "desconhecido";
}

function nomeArquivoStatusWpp(idMensagem, extensao = "") {
  const base = sanitizarNomeWpp(
    String(idMensagem || Date.now()).replace(/@/g, "_at_"),
  ).slice(0, 170);

  return `${base}${extensao}`;
}

async function listarStatusWpp() {
  if (!client?.page) {
    throw new Error("Status ainda nao esta disponivel no WPPConnect.");
  }

  const resultado = await client.page.evaluate(async () => {
    const api = window.WPP;

    if (!api?.status || !api?.whatsapp?.StatusV3Store) {
      return {
        ok: false,
        erro: "API de Status ainda nao carregou no WhatsApp Web.",
        feeds: [],
        meuStatus: null,
        diagnostico: {
          temWpp: !!api,
          temStatus: !!api?.status,
          temStore: !!api?.whatsapp?.StatusV3Store,
        },
      };
    }

    try {
      if (api.config && typeof api.config === "object") {
        api.config.syncAllStatus = true;
      }
    } catch {}

    function serializarIdPagina(valor) {
      if (!valor) {
        return null;
      }

      if (typeof valor === "string") {
        return valor;
      }

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

        if (typeof texto === "string" && texto && texto !== "[object Object]") {
          return texto;
        }
      } catch {}

      if (typeof valor.id === "string" && valor.id.trim()) {
        return valor.id.trim();
      }

      return null;
    }

    function numeroPagina(valor, fallback = 0) {
      const numero = Number(valor);

      return Number.isFinite(numero) ? numero : fallback;
    }

    function valorAttr(objeto, chave) {
      if (!objeto) {
        return undefined;
      }

      if (objeto[chave] !== undefined) {
        return objeto[chave];
      }

      try {
        if (typeof objeto.get === "function") {
          return objeto.get(chave);
        }
      } catch {}

      return undefined;
    }

    function listaModelos(valor) {
      if (!valor) {
        return [];
      }

      if (Array.isArray(valor)) {
        return valor;
      }

      try {
        if (typeof valor.getModelsArray === "function") {
          const lista = valor.getModelsArray();

          if (Array.isArray(lista)) {
            return lista;
          }
        }
      } catch {}

      try {
        if (typeof valor.toArray === "function") {
          const lista = valor.toArray();

          if (Array.isArray(lista)) {
            return lista;
          }
        }
      } catch {}

      if (Array.isArray(valor.models)) {
        return valor.models;
      }

      if (Array.isArray(valor._models)) {
        return valor._models;
      }

      return [];
    }

    function mensagemStatusAtivaPagina(msg) {
      if (!msg) {
        return false;
      }

      const tipo = String(valorAttr(msg, "type") || "")
        .trim()
        .toLowerCase();

      if (tipo === "revoked") {
        return false;
      }

      const flagsInativos = [
        "isRevoked",
        "isDeleted",
        "isExpired",
        "isUnavailable",
        "isTombstone",
        "deleted",
        "revoked",
        "expired",
      ];

      for (const chave of flagsInativos) {
        if (valorAttr(msg, chave) === true) {
          return false;
        }
      }

      return true;
    }

    function mensagensFeed(feed) {
      if (!feed) {
        return [];
      }

      // Para Status, `msgs` e a colecao canonica que o proprio WA-JS usa
      // para localizar uma atualizacao por ID. `getAllMsgs()` pode reunir
      // chunks/modelos historicos que continuam vivos no runtime mesmo depois
      // de a atualizacao desaparecer da interface oficial do WhatsApp.
      const atuais = listaModelos(valorAttr(feed, "msgs")).filter(
        mensagemStatusAtivaPagina,
      );

      if (atuais.length) {
        return atuais;
      }

      // Compatibilidade para builds em que a colecao `msgs` ainda nao foi
      // hidratada. So cai aqui se a fonte canonica estiver realmente vazia.
      try {
        if (typeof feed.getAllMsgs === "function") {
          const lista = feed.getAllMsgs();
          const convertida = listaModelos(lista).filter(
            mensagemStatusAtivaPagina,
          );

          if (convertida.length) {
            return convertida;
          }

          if (Array.isArray(lista)) {
            return lista.filter(mensagemStatusAtivaPagina);
          }
        }
      } catch {}

      return [];
    }

    function nomeContatoFeed(feed, contato, idContato) {
      const candidatos = [
        valorAttr(contato, "name"),
        valorAttr(contato, "formattedName"),
        valorAttr(contato, "shortName"),
        valorAttr(contato, "pushname"),
        valorAttr(contato, "pushName"),
        valorAttr(contato, "verifiedName"),
        valorAttr(feed, "name"),
      ];

      for (const valor of candidatos) {
        const texto = String(valor || "").trim();

        if (texto) {
          return texto;
        }
      }

      return String(idContato || "Contato")
        .replace("@c.us", "")
        .replace("@s.whatsapp.net", "")
        .replace("@lid", "");
    }

    function fotoFeed(feed, contato) {
      const pic =
        valorAttr(feed, "pic") || valorAttr(contato, "profilePicThumb");

      const candidatos = [
        pic?.eurl,
        pic?.url,
        pic?.img,
        pic?.full,
        pic?.preview,
        valorAttr(contato, "profilePicUrl"),
      ];

      for (const valor of candidatos) {
        const texto = String(valor || "").trim();

        if (/^https?:\/\//i.test(texto)) {
          return texto;
        }
      }

      return null;
    }

    function tipoMensagemStatus(msg) {
      const bruto = String(
        valorAttr(msg, "type") || valorAttr(msg, "mediaData")?.type || "",
      )
        .trim()
        .toLowerCase();

      if (bruto === "image") {
        return "imagem";
      }

      if (
        bruto === "video" ||
        bruto === "gif" ||
        bruto === "ptv" ||
        valorAttr(msg, "isGif")
      ) {
        return "video";
      }

      if (
        bruto === "chat" ||
        bruto === "text" ||
        bruto === "status" ||
        (!bruto && (valorAttr(msg, "body") || valorAttr(msg, "caption")))
      ) {
        return "texto";
      }

      return bruto || "desconhecido";
    }

    function mensagemStatusAtiva(msg) {
      if (!msg) {
        return false;
      }

      const tipoBruto = String(
        valorAttr(msg, "type") || valorAttr(msg, "mediaData")?.type || "",
      )
        .trim()
        .toLowerCase();
      const subtipoBruto = String(
        valorAttr(msg, "subtype") || valorAttr(msg, "subType") || "",
      )
        .trim()
        .toLowerCase();

      if (
        /^(?:revoked|revoke|deleted|delete|removed|remove)$/.test(tipoBruto) ||
        /(?:revok|delet|remov)/.test(subtipoBruto)
      ) {
        return false;
      }

      const flags = [
        "isRevoked",
        "revoked",
        "isDeleted",
        "deleted",
        "isRemoved",
        "removed",
      ];

      for (const chave of flags) {
        const valor = valorAttr(msg, chave);

        if (valor === true || valor === 1 || valor === "true") {
          return false;
        }

        if (typeof valor === "function") {
          try {
            if (valor.call(msg) === true) {
              return false;
            }
          } catch {}
        }
      }

      return true;
    }

    function textoParecePayloadMidiaStatus(valor) {
      const texto = String(valor || "").trim();

      if (!texto) {
        return false;
      }

      if (/^data:[^;,]+;base64,/i.test(texto)) {
        return true;
      }

      if (/^(?:\/9j\/|iVBORw0KGgo|UklGR|AAAA[A-Za-z0-9+/]{8,})/.test(texto)) {
        return true;
      }

      if (
        texto.length >= 180 &&
        !/\s/.test(texto) &&
        /^[A-Za-z0-9+/=_-]+$/.test(texto)
      ) {
        return true;
      }

      const semEspacos = texto.replace(/\s+/g, "");

      if (
        semEspacos.length >= 300 &&
        /^[A-Za-z0-9+/=_-]+$/.test(semEspacos) &&
        semEspacos.length / Math.max(1, texto.length) > 0.94
      ) {
        return true;
      }

      return false;
    }

    function textoMensagemStatus(msg, tipo) {
      const candidatos =
        tipo === "texto"
          ? [
              valorAttr(msg, "body"),
              valorAttr(msg, "caption"),
              valorAttr(msg, "text"),
            ]
          : [valorAttr(msg, "caption"), valorAttr(msg, "body")];

      for (const valor of candidatos) {
        const texto = String(valor || "").trim();

        if (!texto) {
          continue;
        }

        if (tipo !== "texto" && textoParecePayloadMidiaStatus(texto)) {
          continue;
        }

        return texto;
      }

      return "";
    }

    function serializarMensagemStatus(msg, idContatoFeed = "") {
      if (!mensagemStatusAtiva(msg)) {
        return null;
      }

      const chaveMensagem = valorAttr(msg, "id");
      const idOriginal = serializarIdPagina(chaveMensagem);
      const idRaw = String(
        (chaveMensagem && typeof chaveMensagem === "object"
          ? chaveMensagem.id
          : "") ||
          valorAttr(msg, "idMessage") ||
          valorAttr(msg, "msgId") ||
          idOriginal ||
          "",
      ).trim();

      if (!idRaw && !idOriginal) {
        return null;
      }

      let idMensagem = String(idOriginal || idRaw).trim();

      // Alguns builds atuais do WhatsApp Web entregam apenas o ID curto
      // dentro do StatusV3Store. As APIs de leitura, reacao e download exigem
      // a MsgKey completa, com status@broadcast. Reconstruimos somente quando
      // o modelo nao forneceu _serialized/toString completo.
      if (!idMensagem.includes("status@broadcast") && idRaw) {
        const fromMe = !!(
          valorAttr(chaveMensagem, "fromMe") ?? valorAttr(msg, "fromMe")
        );
        const remoto =
          serializarIdPagina(valorAttr(chaveMensagem, "remote")) ||
          "status@broadcast";
        const participante =
          serializarIdPagina(valorAttr(chaveMensagem, "participant")) ||
          serializarIdPagina(valorAttr(msg, "author")) ||
          serializarIdPagina(valorAttr(msg, "sender")?.id) ||
          String(idContatoFeed || "").trim();

        idMensagem = `${fromMe ? "true" : "false"}_${
          String(remoto || "").includes("@broadcast")
            ? remoto
            : "status@broadcast"
        }_${idRaw}${participante ? `_${participante}` : ""}`;
      }

      const tipo = tipoMensagemStatus(msg);
      const mediaData = valorAttr(msg, "mediaData") || {};
      let timestamp = numeroPagina(
        valorAttr(msg, "t") ||
          valorAttr(msg, "timestamp") ||
          valorAttr(msg, "messageTimestamp"),
        0,
      );

      if (timestamp > 1000000000000) {
        timestamp = Math.floor(timestamp / 1000);
      }

      return {
        idMensagem,
        idMensagemRaw: idRaw,
        tipo,
        texto: textoMensagemStatus(msg, tipo),
        timestamp,
        mime:
          String(
            valorAttr(msg, "mimetype") ||
              mediaData?.mimetype ||
              mediaData?.mimeType ||
              "",
          ).trim() || null,
        duracao:
          numeroPagina(
            valorAttr(msg, "duration") ||
              valorAttr(msg, "seconds") ||
              mediaData?.duration,
            0,
          ) || null,
        largura:
          numeroPagina(
            valorAttr(msg, "width") || mediaData?.width || mediaData?.fullWidth,
            0,
          ) || null,
        altura:
          numeroPagina(
            valorAttr(msg, "height") ||
              mediaData?.height ||
              mediaData?.fullHeight,
            0,
          ) || null,
        corFundo:
          valorAttr(msg, "backgroundColor") ??
          valorAttr(msg, "backgroundColorHex") ??
          null,
        fonte: valorAttr(msg, "font") ?? valorAttr(msg, "fontStyle") ?? null,
        from: serializarIdPagina(valorAttr(msg, "from")),
        to: serializarIdPagina(valorAttr(msg, "to")),
      };
    }

    const store = api.whatsapp.StatusV3Store;
    const userPrefs = api.whatsapp.UserPrefs || null;
    let feeds = listaModelos(store);

    let meuFeed = null;
    let consultaMeuStatusRealOk = false;
    let consultaMeuStatusRealVia = "nenhuma";
    let consultaMeuStatusRealErro = "";

    const meuPn =
      userPrefs && typeof userPrefs.getMaybeMePnUser === "function"
        ? userPrefs.getMaybeMePnUser()
        : null;

    const meuLid =
      userPrefs && typeof userPrefs.getMaybeMeLidUser === "function"
        ? userPrefs.getMaybeMeLidUser()
        : null;

    const idsUsuario = new Set(
      [serializarIdPagina(meuPn), serializarIdPagina(meuLid)]
        .filter(Boolean)
        .map((item) => String(item)),
    );

    // Usa a mesma fonte canonica que o proprio WA-JS usa para "Meu status".
    // Nao escolhemos mais o feed com mais mensagens, pois feeds PN/LID antigos
    // podem manter modelos revogados e inflar a listagem local.
    try {
      if (typeof store.getMyStatus === "function") {
        const encontrado = await Promise.resolve(store.getMyStatus());

        if (encontrado) {
          meuFeed = encontrado;
          consultaMeuStatusRealOk = true;
          consultaMeuStatusRealVia = "StatusV3Store.getMyStatus";
        }
      }
    } catch (erro) {
      consultaMeuStatusRealErro =
        erro?.message || String(erro || "erro desconhecido");
    }

    // Fallback publico do WA-JS. Ele tambem prioriza getMyStatus e so busca
    // outra referencia quando a canonica nao existe.
    if (!meuFeed) {
      try {
        if (typeof api.status.getMyStatus === "function") {
          const encontrado = await Promise.race([
            Promise.resolve(api.status.getMyStatus()),
            new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
          ]);

          if (encontrado) {
            meuFeed = encontrado;
            consultaMeuStatusRealOk = true;
            consultaMeuStatusRealVia = "WPP.status.getMyStatus";
          }
        }
      } catch (erro) {
        if (!consultaMeuStatusRealErro) {
          consultaMeuStatusRealErro =
            erro?.message || String(erro || "erro desconhecido");
        }
      }
    }

    // Fallback de compatibilidade por identidade, somente se a referencia
    // canonica nao estiver disponivel. Nunca substitui um feed valido por
    // outro apenas porque o segundo possui mais modelos locais.
    if (!meuFeed) {
      for (const [identidade, rotulo] of [
        [meuPn, "PN"],
        [meuLid, "LID"],
      ]) {
        if (!identidade) {
          continue;
        }

        try {
          if (typeof store.get === "function") {
            const encontrado = store.get(identidade);

            if (encontrado) {
              meuFeed = encontrado;
              consultaMeuStatusRealOk = true;
              consultaMeuStatusRealVia = `StatusV3Store.get(${rotulo})`;
              break;
            }
          }
        } catch (erro) {
          if (!consultaMeuStatusRealErro) {
            consultaMeuStatusRealErro =
              erro?.message || String(erro || "erro desconhecido");
          }
        }

        try {
          if (!meuFeed && typeof store.find === "function") {
            const encontrado = await Promise.race([
              Promise.resolve(store.find(identidade)),
              new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
            ]);

            if (encontrado) {
              meuFeed = encontrado;
              consultaMeuStatusRealOk = true;
              consultaMeuStatusRealVia = `StatusV3Store.find(${rotulo})`;
              break;
            }
          }
        } catch (erro) {
          if (!consultaMeuStatusRealErro) {
            consultaMeuStatusRealErro =
              erro?.message || String(erro || "erro desconhecido");
          }
        }
      }
    }

    feeds = listaModelos(store);

    if (meuFeed && !feeds.includes(meuFeed)) {
      feeds = [meuFeed, ...feeds];
    }

    const agora = Math.floor(Date.now() / 1000);
    const limiteAntigo = agora - 26 * 60 * 60;

    const saida = [];
    const idsVistos = new Set();

    for (const feed of feeds) {
      if (!feed) {
        continue;
      }

      const contato = valorAttr(feed, "contact") || null;
      const idFeed = serializarIdPagina(valorAttr(feed, "id"));
      const idContatoOriginal =
        serializarIdPagina(valorAttr(contato, "id")) ||
        idFeed ||
        serializarIdPagina(valorAttr(feed, "contactId"));

      const ehMeu =
        feed === meuFeed ||
        idsUsuario.has(String(idContatoOriginal || "")) ||
        !!valorAttr(contato, "isMe") ||
        !!valorAttr(feed, "isMe");

      // Quando ja temos o feed canonico de "Meu status", ignora referencias
      // alternativas PN/LID do proprio usuario que possam estar obsoletas.
      if (ehMeu && meuFeed && feed !== meuFeed) {
        continue;
      }

      const idContato =
        ehMeu &&
        (!idContatoOriginal || idContatoOriginal === "status@broadcast")
          ? "meu-status"
          : idContatoOriginal;

      if (!idContato || (!ehMeu && idContato === "status@broadcast")) {
        continue;
      }

      const chave = `${ehMeu ? "eu" : "contato"}:${idContato}`;

      if (idsVistos.has(chave)) {
        continue;
      }

      let mensagens = mensagensFeed(feed)
        .map((msg) => serializarMensagemStatus(msg, idContato))
        .filter(Boolean)
        .filter(
          (item) => !item.timestamp || item.timestamp >= limiteAntigo,
        );

      mensagens.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      const unreadInformado = Math.max(
        0,
        numeroPagina(valorAttr(feed, "unreadCount"), 0),
      );

      const unreadCount = ehMeu
        ? 0
        : Math.min(unreadInformado, mensagens.length);

      const inicioNaoVistas = Math.max(0, mensagens.length - unreadCount);

      mensagens.forEach((mensagem, indice) => {
        mensagem.naoVista = !ehMeu && indice >= inicioNaoVistas;
      });

      const ultimaAtualizacao = mensagens.reduce(
        (maior, item) => Math.max(maior, Number(item.timestamp || 0) || 0),
        numeroPagina(valorAttr(feed, "t"), 0),
      );

      if (!ehMeu && !mensagens.length) {
        continue;
      }

      saida.push({
        id: idContato,
        idFeed: idFeed || idContato,
        nome: ehMeu ? "Meu status" : nomeContatoFeed(feed, contato, idContato),
        fotoUrl: fotoFeed(feed, contato),
        meu: ehMeu,
        unreadCount,
        totalCount: mensagens.length,
        ultimaAtualizacao,
        mensagens,
      });

      idsVistos.add(chave);
    }

    const meuStatus = saida.find((item) => item.meu) || null;

    const contatos = saida
      .filter((item) => !item.meu)
      .sort((a, b) => {
        const unreadA = Number(a.unreadCount || 0) > 0 ? 1 : 0;
        const unreadB = Number(b.unreadCount || 0) > 0 ? 1 : 0;

        if (unreadA !== unreadB) {
          return unreadB - unreadA;
        }

        return (
          Number(b.ultimaAtualizacao || 0) - Number(a.ultimaAtualizacao || 0)
        );
      });

    return {
      ok: true,
      feeds: contatos,
      meuStatus,
      diagnostico: {
        totalStore: feeds.length,
        totalContatos: contatos.length,
        temMeuStatus: !!meuStatus,
        syncAllStatus: !!api.config?.syncAllStatus,
        consultaMeuStatusRealOk,
        consultaMeuStatusRealVia,
        consultaMeuStatusRealErro,
        totalMeuStatusReal: Array.isArray(meuStatus?.mensagens)
          ? meuStatus.mensagens.length
          : 0,
      },
    };
  });

  if (!resultado?.ok) {
    throw new Error(
      resultado?.erro || "Nao foi possivel listar os Status do WhatsApp.",
    );
  }

  mesclarMeuStatusComCacheWpp(resultado);
  filtrarStatusApagadosWpp(resultado);

  console.log(
    `[STATUS WPP] listados=${resultado.feeds?.length || 0} | ` +
      `store=${resultado.diagnostico?.totalStore || 0} | ` +
      `meu=${resultado?.meuStatus?.mensagens?.length || 0} | ` +
      `fonte=${resultado.diagnostico?.consultaMeuStatusRealVia || "nenhuma"} | ` +
      `real=${resultado.diagnostico?.consultaMeuStatusRealOk ? "sim" : "nao"} | ` +
      `cache_fallback=${resultado.diagnostico?.cacheUsadoComoFallback ? "sim" : "nao"}`,
  );

  return resultado;
}

