function criarModuloEstadoMensagens(dependencias = {}) {
  const {
    localStorage,
    removerRegistroReacoes,
    removerFavoritoLocalmente,
    atualizarFavoritoEditadoLocalmente,
    limparReacoesPersistidasDaConversa,
    limparFavoritosDaConversa,
  } = dependencias;

  const CHAVE_MENSAGENS_APAGADAS = "whatsiapp.mensagensApagadas.v1";
  const CHAVE_MENSAGENS_EDITADAS = "whatsiapp.mensagensEditadas.v1";
  const CHAVE_CONVERSAS_LIMPAS = "whatsiapp.conversasLimpas.v1";
  const CHAVE_CONVERSAS_APAGADAS = "whatsiapp.conversasApagadas.v1";

  function chaveMensagemApagada(conversaId, idMensagem) {
    const conversa = String(conversaId || "")
      .trim()
      .toLowerCase();
    const id = String(idMensagem || "").trim();

    if (!conversa || !id) {
      return null;
    }

    return `${conversa}|${id}`;
  }

  function carregarMensagensApagadasPersistidas() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_MENSAGENS_APAGADAS) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const mensagensApagadasPersistidas = carregarMensagensApagadasPersistidas();

  function timestampRegistroMensagemApagada(registro) {
    if (registro && typeof registro === "object") {
      return Number(registro.salvoEm || 0) || 0;
    }

    return Number(registro || 0) || 0;
  }

  function salvarMensagensApagadasPersistidas() {
    try {
      const entradas = Object.entries(mensagensApagadasPersistidas)
        .sort(
          (a, b) =>
            timestampRegistroMensagemApagada(b[1]) -
            timestampRegistroMensagemApagada(a[1]),
        )
        .slice(0, 5000);

      const reduzido = Object.fromEntries(entradas);

      for (const chave of Object.keys(mensagensApagadasPersistidas)) {
        delete mensagensApagadasPersistidas[chave];
      }

      Object.assign(mensagensApagadasPersistidas, reduzido);

      localStorage.setItem(
        CHAVE_MENSAGENS_APAGADAS,
        JSON.stringify(mensagensApagadasPersistidas),
      );
    } catch {}
  }

  function obterRegistroMensagemApagada(conversaId, idMensagem) {
    const chave = chaveMensagemApagada(conversaId, idMensagem);

    if (!chave) {
      return null;
    }

    const registro = mensagensApagadasPersistidas[chave];

    if (!registro) {
      return null;
    }

    // Compatibilidade com a v19: valores numericos eram exclusoes locais.
    if (typeof registro !== "object") {
      return {
        modo: "local",
        salvoEm: Number(registro || 0) || 0,
      };
    }

    return registro;
  }

  function criarTombstoneMensagemApagada(msg = {}, registro = null) {
    const salvo = registro && typeof registro === "object" ? registro : {};

    return {
      idMensagem: String(msg?.idMensagem || salvo.idMensagem || ""),
      idMensagemWpp: msg?.idMensagemWpp || salvo.idMensagemWpp || null,
      resposta: null,
      texto: "Você apagou esta mensagem",
      tipo: "apagada",
      mime: null,
      fileName: null,
      viewOnceKind: null,
      horario: msg?.horario || salvo.horario || "",
      timestamp:
        Number(msg?.timestamp || salvo.timestamp || 0) ||
        (Number(salvo.salvoEm || 0) > 0
          ? Math.floor(Number(salvo.salvoEm) / 1000)
          : 0),
      minha:
        typeof msg?.minha === "boolean"
          ? !!msg.minha
          : typeof salvo.minha === "boolean"
            ? !!salvo.minha
            : true,
      mediaPath: null,
      mediaUrl: null,
      rawBase64: null,
      statusEntrega: null,
      apagadaParaTodos: true,
    };
  }

  function registrarMensagemApagadaLocalmente(
    conversaId,
    idMensagem,
    { paraTodos = false, mensagem = null } = {},
  ) {
    const chave = chaveMensagemApagada(conversaId, idMensagem);

    if (!chave) {
      return;
    }

    if (paraTodos) {
      mensagensApagadasPersistidas[chave] = {
        modo: "todos",
        salvoEm: Date.now(),
        idMensagem: String(idMensagem || ""),
        idMensagemWpp: mensagem?.idMensagemWpp || null,
        horario: mensagem?.horario || "",
        timestamp:
          Number(mensagem?.timestamp || 0) || Math.floor(Date.now() / 1000),
        minha: typeof mensagem?.minha === "boolean" ? !!mensagem.minha : true,
      };
    } else {
      mensagensApagadasPersistidas[chave] = {
        modo: "local",
        salvoEm: Date.now(),
      };
    }

    salvarMensagensApagadasPersistidas();
    removerRegistroMensagemEditada(conversaId, idMensagem);
    removerRegistroReacoes(conversaId, idMensagem);
    removerFavoritoLocalmente(conversaId, idMensagem);
  }

  function mensagemEstaApagadaLocalmente(conversaId, idMensagem) {
    const registro = obterRegistroMensagemApagada(conversaId, idMensagem);

    return !!registro && registro.modo !== "todos";
  }

  function aplicarEstadoMensagemApagadaPersistida(conversaId, msg) {
    const registro = obterRegistroMensagemApagada(conversaId, msg?.idMensagem);

    if (!registro) {
      return msg;
    }

    if (registro.modo === "todos") {
      return criarTombstoneMensagemApagada(msg, registro);
    }

    return null;
  }

  function chaveMensagemEditada(conversaId, idMensagem) {
    const conversa = String(conversaId || "")
      .trim()
      .toLowerCase();
    const id = String(idMensagem || "").trim();

    if (!conversa || !id) {
      return null;
    }

    return `${conversa}|${id}`;
  }

  function carregarMensagensEditadasPersistidas() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_MENSAGENS_EDITADAS) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const mensagensEditadasPersistidas = carregarMensagensEditadasPersistidas();

  function salvarMensagensEditadasPersistidas() {
    try {
      const entradas = Object.entries(mensagensEditadasPersistidas)
        .sort((a, b) => Number(b[1]?.salvoEm || 0) - Number(a[1]?.salvoEm || 0))
        .slice(0, 5000);

      const reduzido = Object.fromEntries(entradas);

      for (const chave of Object.keys(mensagensEditadasPersistidas)) {
        delete mensagensEditadasPersistidas[chave];
      }

      Object.assign(mensagensEditadasPersistidas, reduzido);

      localStorage.setItem(
        CHAVE_MENSAGENS_EDITADAS,
        JSON.stringify(mensagensEditadasPersistidas),
      );
    } catch {}
  }

  function registrarMensagemEditadaLocalmente(conversaId, idMensagem, texto) {
    const chave = chaveMensagemEditada(conversaId, idMensagem);
    const novoTexto = String(texto || "").trim();

    if (!chave || !novoTexto) {
      return;
    }

    mensagensEditadasPersistidas[chave] = {
      texto: novoTexto,
      salvoEm: Date.now(),
    };

    salvarMensagensEditadasPersistidas();
    atualizarFavoritoEditadoLocalmente(conversaId, idMensagem, novoTexto);
  }

  function removerRegistroMensagemEditada(conversaId, idMensagem) {
    const chave = chaveMensagemEditada(conversaId, idMensagem);

    if (!chave || !mensagensEditadasPersistidas[chave]) {
      return;
    }

    delete mensagensEditadasPersistidas[chave];
    salvarMensagensEditadasPersistidas();
  }

  function aplicarEstadoMensagemEditadaPersistida(conversaId, msg) {
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      return msg;
    }

    const chave = chaveMensagemEditada(conversaId, msg?.idMensagem);
    const registro = chave ? mensagensEditadasPersistidas[chave] : null;

    if (!registro?.texto) {
      return msg;
    }

    return {
      ...msg,
      texto: registro.texto,
      editada: true,
    };
  }

  function chavePersistenciaConversa(conversaId) {
    return String(conversaId || "")
      .trim()
      .toLowerCase();
  }

  function carregarMapaPersistido(chave) {
    try {
      const dados = JSON.parse(localStorage.getItem(chave) || "{}");
      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const conversasLimpasPersistidas = carregarMapaPersistido(
    CHAVE_CONVERSAS_LIMPAS,
  );
  const conversasApagadasPersistidas = carregarMapaPersistido(
    CHAVE_CONVERSAS_APAGADAS,
  );

  function salvarMapaConversaPersistido(chave, mapa) {
    try {
      const entradas = Object.entries(mapa)
        .sort((a, b) => Number(b[1]?.salvoEm || 0) - Number(a[1]?.salvoEm || 0))
        .slice(0, 2000);

      const reduzido = Object.fromEntries(entradas);

      for (const item of Object.keys(mapa)) {
        delete mapa[item];
      }

      Object.assign(mapa, reduzido);
      localStorage.setItem(chave, JSON.stringify(mapa));
    } catch {}
  }

  function salvarConversasLimpasPersistidas() {
    salvarMapaConversaPersistido(
      CHAVE_CONVERSAS_LIMPAS,
      conversasLimpasPersistidas,
    );
  }

  function salvarConversasApagadasPersistidas() {
    salvarMapaConversaPersistido(
      CHAVE_CONVERSAS_APAGADAS,
      conversasApagadasPersistidas,
    );
  }

  function maiorTimestampMensagensConversa(conversa) {
    let maior = 0;

    for (const msg of Array.isArray(conversa?.mensagens)
      ? conversa.mensagens
      : []) {
      maior = Math.max(maior, Number(msg?.timestamp || 0) || 0);
    }

    return maior;
  }

  function obterUltimaMensagemCronologica(conversa) {
    const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
    let ultima = null;
    let maiorTimestamp = -1;

    for (const msg of lista) {
      if (!msg) {
        continue;
      }

      const timestamp = Number(msg?.timestamp || 0) || 0;
      const msgApagada = msg?.apagadaParaTodos || msg?.tipo === "apagada";
      const ultimaApagada =
        ultima?.apagadaParaTodos || ultima?.tipo === "apagada";

      if (
        !ultima ||
        timestamp > maiorTimestamp ||
        (timestamp === maiorTimestamp && ultimaApagada && !msgApagada)
      ) {
        ultima = msg;
        maiorTimestamp = timestamp;
      }
    }

    return ultima;
  }

  function registrarConversaLimpaLocalmente(conversa) {
    const chave = chavePersistenciaConversa(conversa?.id);

    if (!chave) {
      return;
    }

    const agoraSegundos = Math.floor(Date.now() / 1000);
    const maiorMensagem = maiorTimestampMensagensConversa(conversa);

    conversasLimpasPersistidas[chave] = {
      limiteTimestamp: Math.max(agoraSegundos, maiorMensagem),
      idsMensagens: (Array.isArray(conversa?.mensagens)
        ? conversa.mensagens
        : []
      )
        .map((msg) => String(msg?.idMensagem || ""))
        .filter(Boolean)
        .slice(-5000),
      salvoEm: Date.now(),
    };

    salvarConversasLimpasPersistidas();
  }

  function registrarConversaApagadaLocalmente(conversa) {
    const chave = chavePersistenciaConversa(conversa?.id);

    if (!chave) {
      return;
    }

    const agoraSegundos = Math.floor(Date.now() / 1000);
    const maiorMensagem = maiorTimestampMensagensConversa(conversa);

    conversasApagadasPersistidas[chave] = {
      limiteTimestamp: Math.max(agoraSegundos, maiorMensagem),
      idsMensagens: (Array.isArray(conversa?.mensagens)
        ? conversa.mensagens
        : []
      )
        .map((msg) => String(msg?.idMensagem || ""))
        .filter(Boolean)
        .slice(-5000),
      salvoEm: Date.now(),
    };

    salvarConversasApagadasPersistidas();
  }

  function removerRegistroConversaApagada(conversaId) {
    const chave = chavePersistenciaConversa(conversaId);

    if (!chave || !conversasApagadasPersistidas[chave]) {
      return;
    }

    delete conversasApagadasPersistidas[chave];
    salvarConversasApagadasPersistidas();
  }

  function mensagemIgnoradaPorLimpezaPersistida(
    conversaId,
    msg,
    permitirMensagemNovaMesmoSegundo = false,
  ) {
    const chave = chavePersistenciaConversa(conversaId);
    const registro = chave ? conversasLimpasPersistidas[chave] : null;

    if (!registro) {
      return false;
    }

    const idMensagem = String(msg?.idMensagem || "");
    const idsAntigos = new Set(
      Array.isArray(registro.idsMensagens) ? registro.idsMensagens : [],
    );

    if (idMensagem && idsAntigos.has(idMensagem)) {
      return true;
    }

    const limite = Number(registro.limiteTimestamp || 0) || 0;
    const timestamp = Number(msg?.timestamp || 0) || 0;

    if (!limite || !timestamp) {
      return false;
    }

    if (timestamp < limite) {
      return true;
    }

    if (timestamp > limite) {
      return false;
    }

    return !permitirMensagemNovaMesmoSegundo;
  }

  function conversaIgnoradaPorExclusaoPersistida(
    conversa,
    permitirMensagemNovaMesmoSegundo = false,
  ) {
    const chave = chavePersistenciaConversa(conversa?.id);
    const registro = chave ? conversasApagadasPersistidas[chave] : null;

    if (!registro) {
      return false;
    }

    const limite = Number(registro.limiteTimestamp || 0) || 0;
    const timestamp = Number(conversa?.timestamp || 0) || 0;

    // Uma mensagem posterior à exclusão recria naturalmente o chat.
    if (
      timestamp > limite ||
      (permitirMensagemNovaMesmoSegundo && timestamp >= limite)
    ) {
      removerRegistroConversaApagada(conversa?.id);
      return false;
    }

    return true;
  }

  function limparPersistenciasMensagensDaConversa(conversaId) {
    const prefixo = `${chavePersistenciaConversa(conversaId)}|`;

    if (prefixo === "|") {
      return;
    }

    let mudouApagadas = false;
    let mudouEditadas = false;

    for (const chave of Object.keys(mensagensApagadasPersistidas)) {
      if (chave.startsWith(prefixo)) {
        delete mensagensApagadasPersistidas[chave];
        mudouApagadas = true;
      }
    }

    for (const chave of Object.keys(mensagensEditadasPersistidas)) {
      if (chave.startsWith(prefixo)) {
        delete mensagensEditadasPersistidas[chave];
        mudouEditadas = true;
      }
    }

    if (mudouApagadas) salvarMensagensApagadasPersistidas();
    if (mudouEditadas) salvarMensagensEditadasPersistidas();
    limparReacoesPersistidasDaConversa(conversaId);
    limparFavoritosDaConversa(conversaId);
  }

  function obterTombstonesPersistidosConversa(conversaId) {
    const prefixo = `${String(conversaId || "")
      .trim()
      .toLowerCase()}|`;

    if (prefixo === "|") {
      return [];
    }

    const itens = [];

    for (const [chave, registro] of Object.entries(
      mensagensApagadasPersistidas,
    )) {
      if (
        !chave.startsWith(prefixo) ||
        !registro ||
        typeof registro !== "object" ||
        registro.modo !== "todos" ||
        !registro.idMensagem
      ) {
        continue;
      }

      const tombstone = criarTombstoneMensagemApagada({}, registro);

      if (!mensagemIgnoradaPorLimpezaPersistida(conversaId, tombstone)) {
        itens.push(tombstone);
      }
    }

    return itens;
  }

  return {
    obterRegistroMensagemApagada,
    criarTombstoneMensagemApagada,
    registrarMensagemApagadaLocalmente,
    mensagemEstaApagadaLocalmente,
    aplicarEstadoMensagemApagadaPersistida,
    registrarMensagemEditadaLocalmente,
    removerRegistroMensagemEditada,
    aplicarEstadoMensagemEditadaPersistida,
    obterUltimaMensagemCronologica,
    registrarConversaLimpaLocalmente,
    registrarConversaApagadaLocalmente,
    removerRegistroConversaApagada,
    mensagemIgnoradaPorLimpezaPersistida,
    conversaIgnoradaPorExclusaoPersistida,
    limparPersistenciasMensagensDaConversa,
    obterTombstonesPersistidosConversa,
  };
}

module.exports = {
  criarModuloEstadoMensagens,
};
