function criarModuloEventosWhatsapp(deps = {}) {
  const {
    ipcRenderer,
    document,
    fs,
    pathToFileURL,
    conversas,
    conversasSombraTesteIA,
    conversasProvisoriasNovaMensagem,
    desarquivamentosLocaisPendentes,
    naoLidasPersistidas,
    respostasAutomaticasPendentes,
    botaoPerfilApp,
    nomeChat,
    statusChat,
    mensagens,
    moduloAudio,
    reconciliarVideoOtimista,
    aplicarEtapaSincronizacao,
    obterSincronizacaoInicialConcluida,
    definirBaileysProntoParaFotos,
    enfileirarFotoPerfil,
    processarFilaFotosPerfil,
    carregarMinhaFotoPerfil,
    conversaIgnoradaPorExclusaoPersistida,
    trancamentoEfetivo,
    aplicarEstadoMensagemApagadaPersistida,
    mensagemIgnoradaPorLimpezaPersistida,
    aplicarEstadoMensagemEditadaPersistida,
    aplicarEstadoReacoesPersistidas,
    recuperarMidiaEnviadaLocal,
    obterTombstonesPersistidosConversa,
    atualizarContadores,
    recalcularNaoLidasGlobal,
    renderConversas,
    configurarSenhaTrancadasSeNecessario,
    obterConversaAtual,
    definirConversaAtual,
    atualizarStatusCabecalho,
    renderMensagens,
    carregarUmaMidia,
    atualizarBotaoArquivar,
    atualizarBotaoTrancar,
    atualizarCompositor,
    atualizarCabecalhoConversa,
    obterMarkupEstadoInicialChat,
    ehConversaTecnica,
    persistirNaoLidasConversa,
    marcarConversaComoLidaLocal,
    incrementarNaoLidaLocal,
    desarquivarAutomaticamentePorMensagem,
    persistirMidiaEnviadaLocal,
    normalizarListaReacoes,
    notificacoesAtivasConversa,
    tocarSomNovaMensagem,
    mostrarToastInternoNovaMensagem,
    solicitarNotificacaoExternaMensagem,
    obterEstadoEntradaCurtaIA,
    registrarEntradaCurtaIA,
    diagnosticoSegundoPlanoIA,
    obterModoIAConversa,
    obterSegundoPlanoIAConversa,
    limparRespostaAutomaticaPendente,
    limparEntradaCurtaIA,
    eventoMensagemEhUltimaRelevanteIA,
    cancelarRespostaAutomaticaIAEmAndamento,
    registrarRespostaAutomaticaPendente,
    tentarAgendarRespostaAutomaticaPendente,
    marcarConversaComoLidaWhatsapp,
    obterModoIAAtual,
    obterUltimaMensagemRelevanteIA,
    mostrarEstadoPainelIA,
    agendarRespostaAutomaticaIA,
    chaveBaseSugestaoIA,
    cancelarSugestaoIAEmAndamento,
    agendarSugestaoIA,
    registrarReacoesLocalmente,
  } = deps;

  function ordenarMensagensPorTimestamp(lista) {
    if (!Array.isArray(lista) || lista.length < 2) {
      return Array.isArray(lista) ? lista : [];
    }

    const timestampComparavel = (msg) => {
      let valor = Number(msg?.timestamp || 0);

      if (!Number.isFinite(valor) || valor <= 0) {
        return null;
      }

      // Aceita tanto timestamp em segundos quanto em milissegundos,
      // sem alterar o valor original armazenado na mensagem.
      if (valor > 1000000000000) {
        valor = Math.floor(valor / 1000);
      }

      return valor;
    };

    const ordenadas = lista
      .map((msg, indiceOriginal) => ({
        msg,
        indiceOriginal,
        timestamp: timestampComparavel(msg),
      }))
      .sort((a, b) => {
        const aValido = a.timestamp !== null;
        const bValido = b.timestamp !== null;

        if (aValido && bValido && a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }

        if (aValido !== bValido) {
          return aValido ? -1 : 1;
        }

        // Para mensagens no mesmo segundo, preserva a ordem em que o
        // WhatsApp entregou originalmente, evitando trocas artificiais.
        return a.indiceOriginal - b.indiceOriginal;
      })
      .map((item) => item.msg);

    // Mantem a mesma referencia do array para nao quebrar outros modulos.
    lista.splice(0, lista.length, ...ordenadas);
    return lista;
  }

  function assinaturaRenderConversa(conversa) {
    if (!conversa || !Array.isArray(conversa.mensagens)) {
      return "";
    }

    try {
      return JSON.stringify(
        conversa.mensagens.map((msg) => ({
          id: String(msg?.idMensagem || ""),
          texto: String(msg?.texto || ""),
          tipo: String(msg?.tipo || ""),
          mime: String(msg?.mime || ""),
          arquivo: String(msg?.fileName || ""),
          viewOnce: String(msg?.viewOnceKind || ""),
          horario: String(msg?.horario || ""),
          timestamp: Number(msg?.timestamp || 0) || 0,
          minha: !!msg?.minha,
          mediaPath: String(msg?.mediaPath || ""),
          mediaUrl: String(msg?.mediaUrl || ""),
          status: String(msg?.statusEntrega || ""),
          editada: !!msg?.editada,
          apagada: !!msg?.apagadaParaTodos || msg?.tipo === "apagada",
          respostaId: String(msg?.resposta?.idMensagem || ""),
          reacoes: Array.isArray(msg?.reacoes)
            ? msg.reacoes.map((item) => ({
                emoji: String(item?.emoji || ""),
                total: Number(item?.total || 0) || 0,
                minha: !!item?.minha,
              }))
            : [],
        })),
      );
    } catch {
      return "";
    }
  }

  function lerEstadoNaoLidasWpp(dados = {}) {
    if (dados?.naoLidasWpp === null || dados?.naoLidasWpp === undefined) {
      return {
        valido: false,
        total: 0,
        revisao: 0,
        geracao: "",
      };
    }

    const total = Number(dados.naoLidasWpp);
    const revisao = Number(dados.naoLidasWppRevisao || 0) || 0;
    const geracao = String(dados.naoLidasWppGeracao || "").trim();

    return {
      valido:
        Number.isFinite(total) &&
        total >= 0 &&
        revisao > 0 &&
        !!geracao,
      total: Math.max(0, Number.isFinite(total) ? Math.floor(total) : 0),
      revisao,
      geracao,
    };
  }

  function estadoWppMaisNovoQueConversa(conversa, estado) {
    if (!estado?.valido) {
      return false;
    }

    const geracaoAtual = String(conversa?.naoLidasWppGeracao || "").trim();
    const revisaoAtual = Number(conversa?.naoLidasWppRevisao || 0) || 0;

    return (
      !geracaoAtual ||
      geracaoAtual !== estado.geracao ||
      estado.revisao > revisaoAtual
    );
  }

  function lerEstadoNaoLidasWhatsapp(dados = {}) {
    if (
      dados?.naoLidasWhatsapp === null ||
      dados?.naoLidasWhatsapp === undefined
    ) {
      return {
        valido: false,
        total: 0,
        revisao: 0,
        geracao: "",
        timestamp: 0,
      };
    }

    const total = Number(dados.naoLidasWhatsapp);
    const revisao = Number(dados.naoLidasWhatsappRevisao || 0) || 0;
    const geracao = String(dados.naoLidasWhatsappGeracao || "").trim();
    let timestamp = Number(dados.naoLidasWhatsappTimestamp || 0) || 0;

    if (timestamp > 1000000000000) {
      timestamp = Math.floor(timestamp / 1000);
    }

    return {
      valido:
        Number.isFinite(total) &&
        total >= 0 &&
        revisao > 0 &&
        !!geracao,
      total: Math.max(0, Number.isFinite(total) ? total : 0),
      revisao,
      geracao,
      timestamp: Math.max(0, timestamp),
    };
  }

  function estadoRemotoMaisNovoQueConversa(conversa, estado) {
    if (!estado?.valido) {
      return false;
    }

    const geracaoAtual = String(
      conversa?.naoLidasWhatsappGeracao || "",
    ).trim();
    const revisaoAtual =
      Number(conversa?.naoLidasWhatsappRevisao || 0) || 0;

    return (
      !geracaoAtual ||
      geracaoAtual !== estado.geracao ||
      estado.revisao > revisaoAtual
    );
  }

  function aplicarEstadoNaoLidasWhatsappNaConversa(
    conversa,
    estado,
    persistir = true,
  ) {
    if (!conversa || !estado?.valido) {
      return false;
    }

    conversa.naoLidasWhatsapp = estado.total;
    conversa.naoLidasWhatsappRevisao = estado.revisao;
    conversa.naoLidasWhatsappGeracao = estado.geracao;
    conversa.naoLidasWhatsappTimestamp = estado.timestamp;

    if (!conversa.trancada) {
      conversa.naoLidasLocal = estado.total;
    } else {
      conversa.naoLidasLocal = 0;
    }

    if (persistir) {
      persistirNaoLidasConversa(conversa);
    }

    return true;
  }

  let sincronizacaoBackgroundCompleta = false;
  let sincronizacaoPerfilPercentual = 5;
  let sincronizacaoPerfilTexto = "Inicializando WhatsIAPP";
  let tooltipSincronizacaoPerfil = null;
  let tooltipSincronizacaoTexto = null;
  let tooltipSincronizacaoPercentual = null;
  let tooltipSincronizacaoBarra = null;
  let percentualSincronizacaoSempreVisivel = null;

  function garantirTooltipSincronizacaoPerfil() {
    if (tooltipSincronizacaoPerfil || !botaoPerfilApp) {
      return;
    }

    const tooltip = document.createElement("div");
    tooltip.id = "whatsiapp-sync-tooltip";
    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: "999999",
      width: "250px",
      padding: "10px 12px",
      borderRadius: "10px",
      background: "rgba(17, 27, 33, 0.97)",
      border: "1px solid rgba(255,255,255,0.10)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.32)",
      color: "#e9edef",
      fontSize: "12px",
      lineHeight: "1.35",
      pointerEvents: "none",
      opacity: "0",
      visibility: "hidden",
      transform: "translateY(4px)",
      transition: "opacity 120ms ease, transform 120ms ease",
    });

    const linha = document.createElement("div");
    Object.assign(linha.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "10px",
      marginBottom: "7px",
    });

    const texto = document.createElement("span");
    Object.assign(texto.style, {
      minWidth: "0",
      flex: "1",
      color: "#e9edef",
      fontWeight: "600",
    });

    const percentual = document.createElement("strong");
    Object.assign(percentual.style, {
      flex: "0 0 auto",
      fontVariantNumeric: "tabular-nums",
      color: "#f4c95d",
    });

    const trilho = document.createElement("div");
    Object.assign(trilho.style, {
      width: "100%",
      height: "5px",
      borderRadius: "999px",
      overflow: "hidden",
      background: "rgba(255,255,255,0.10)",
    });

    const barra = document.createElement("div");
    Object.assign(barra.style, {
      width: "5%",
      height: "100%",
      borderRadius: "999px",
      background: "#f4c95d",
      transition: "width 260ms ease, background 180ms ease",
    });

    trilho.appendChild(barra);
    linha.appendChild(texto);
    linha.appendChild(percentual);
    tooltip.appendChild(linha);
    tooltip.appendChild(trilho);
    document.body.appendChild(tooltip);

    const percentualSempreVisivel = document.createElement("span");
    percentualSempreVisivel.id = "whatsiapp-sync-percentual";
    Object.assign(percentualSempreVisivel.style, {
      position: "fixed",
      zIndex: "999998",
      color: "#f4c95d",
      fontSize: "10px",
      fontWeight: "800",
      lineHeight: "1",
      fontVariantNumeric: "tabular-nums",
      pointerEvents: "none",
      userSelect: "none",
      textShadow: "0 1px 3px rgba(0,0,0,0.85)",
    });
    percentualSempreVisivel.textContent = "5%";
    document.body.appendChild(percentualSempreVisivel);

    tooltipSincronizacaoPerfil = tooltip;
    tooltipSincronizacaoTexto = texto;
    tooltipSincronizacaoPercentual = percentual;
    tooltipSincronizacaoBarra = barra;
    percentualSincronizacaoSempreVisivel = percentualSempreVisivel;

    const posicionar = () => {
      if (!tooltipSincronizacaoPerfil || !botaoPerfilApp) return;

      const win = document.defaultView;
      const rect = botaoPerfilApp.getBoundingClientRect();
      const largura = 250;
      const margem = 10;
      const esquerda = Math.min(
        Math.max(margem, rect.right + 10),
        Math.max(margem, (win?.innerWidth || 1200) - largura - margem),
      );
      const topo = Math.min(
        Math.max(margem, rect.top - 18),
        Math.max(margem, (win?.innerHeight || 800) - 72),
      );

      tooltipSincronizacaoPerfil.style.left = `${Math.round(esquerda)}px`;
      tooltipSincronizacaoPerfil.style.top = `${Math.round(topo)}px`;

      if (percentualSincronizacaoSempreVisivel) {
        percentualSincronizacaoSempreVisivel.style.left = `${Math.round(rect.right - 5)}px`;
        percentualSincronizacaoSempreVisivel.style.top = `${Math.round(rect.top - 2)}px`;
      }
    };

    posicionar();

    botaoPerfilApp.addEventListener("mouseenter", () => {
      posicionar();
      tooltipSincronizacaoPerfil.style.visibility = "visible";
      tooltipSincronizacaoPerfil.style.opacity = "1";
      tooltipSincronizacaoPerfil.style.transform = "translateY(0)";
    });

    botaoPerfilApp.addEventListener("mouseleave", () => {
      tooltipSincronizacaoPerfil.style.opacity = "0";
      tooltipSincronizacaoPerfil.style.transform = "translateY(4px)";
      setTimeout(() => {
        if (
          tooltipSincronizacaoPerfil &&
          tooltipSincronizacaoPerfil.style.opacity === "0"
        ) {
          tooltipSincronizacaoPerfil.style.visibility = "hidden";
        }
      }, 130);
    });

    document.defaultView?.addEventListener?.("resize", posicionar);
  }

  function atualizarVisualSincronizacaoPerfil({
    percentual,
    texto,
    completo = false,
    erro = false,
  } = {}) {
    garantirTooltipSincronizacaoPerfil();

    const novoPercentual = Math.max(
      0,
      Math.min(100, Number(percentual || 0) || 0),
    );

    if (!erro && !completo) {
      sincronizacaoPerfilPercentual = Math.max(
        sincronizacaoPerfilPercentual,
        novoPercentual,
      );
    } else {
      sincronizacaoPerfilPercentual = novoPercentual;
    }

    if (texto) {
      sincronizacaoPerfilTexto = String(texto);
    }

    if (completo) {
      sincronizacaoBackgroundCompleta = true;
      sincronizacaoPerfilPercentual = 100;
      sincronizacaoPerfilTexto = "WhatsIAPP totalmente sincronizado";
    }

    botaoPerfilApp.classList.remove(
      "status-conectado",
      "status-conectando",
      "status-qr",
      "status-erro",
    );

    if (erro) {
      botaoPerfilApp.classList.add("status-erro");
    } else if (sincronizacaoBackgroundCompleta) {
      botaoPerfilApp.classList.add("status-conectado");
    } else {
      botaoPerfilApp.classList.add("status-conectando");
    }

    const titulo = erro
      ? `Erro de sincronização • ${sincronizacaoPerfilTexto}`
      : sincronizacaoBackgroundCompleta
        ? "WhatsIAPP sincronizado"
        : `${sincronizacaoPerfilTexto} • ${Math.round(sincronizacaoPerfilPercentual)}%`;

    botaoPerfilApp.title = titulo;

    if (tooltipSincronizacaoTexto) {
      tooltipSincronizacaoTexto.textContent = sincronizacaoPerfilTexto;
    }

    if (tooltipSincronizacaoPercentual) {
      tooltipSincronizacaoPercentual.textContent =
        sincronizacaoBackgroundCompleta
          ? ""
          : `${Math.round(sincronizacaoPerfilPercentual)}%`;
      tooltipSincronizacaoPercentual.style.color = erro
        ? "#ff6b6b"
        : sincronizacaoBackgroundCompleta
          ? "#25d366"
          : "#f4c95d";
    }

    if (tooltipSincronizacaoBarra) {
      tooltipSincronizacaoBarra.style.width = `${Math.round(sincronizacaoPerfilPercentual)}%`;
      tooltipSincronizacaoBarra.style.background = erro
        ? "#ff6b6b"
        : sincronizacaoBackgroundCompleta
          ? "#25d366"
          : "#f4c95d";
    }

    if (percentualSincronizacaoSempreVisivel) {
      percentualSincronizacaoSempreVisivel.style.display =
        sincronizacaoBackgroundCompleta ? "none" : "";
      percentualSincronizacaoSempreVisivel.textContent = `${Math.round(sincronizacaoPerfilPercentual)}%`;
      percentualSincronizacaoSempreVisivel.style.color = erro
        ? "#ff6b6b"
        : "#f4c95d";
    }
  }

  function progressoDaEtapaSincronizacao(dados = {}) {
    const etapa = String(dados?.etapa || "").trim();
    const origem = String(dados?.origem || "").trim();
    const detalhe = String(dados?.detalhe || "").trim();
    const detalheLower = detalhe.toLowerCase();

    if (etapa === "erro") {
      return {
        percentual: sincronizacaoPerfilPercentual,
        texto: detalhe || "Falha durante a sincronização",
        erro: true,
      };
    }

    if (etapa === "full-ready" && origem === "wpp") {
      return {
        percentual: 100,
        texto: "WhatsIAPP totalmente sincronizado",
        completo: true,
      };
    }

    if (etapa === "full-ready" && origem === "bootstrap") {
      return {
        percentual: 40,
        texto: "Interface pronta. Sincronizando em segundo plano",
      };
    }

    const mapa = {
      "baileys-conectando": [12, "Conectando ao WhatsApp"],
      "baileys-conectado": [28, "WhatsApp conectado"],
      "fotos-principais": [36, "Preparando conversas principais"],
      "wpp-iniciando": [44, "Iniciando sincronização completa"],
      "wpp-create-call": [47, "Abrindo módulo de sincronização"],
      "wpp-interno-browser": [50, "Preparando sessão do WhatsApp"],
      "wpp-interno-pagina": [56, "Carregando sessão do WhatsApp"],
      "wpp-interno-wapi": [61, "Preparando integração do WhatsApp"],
      "wpp-client": [66, "Conectando recursos do WhatsApp"],
      "wajs-settle": [87, "Estabilizando recursos do WhatsApp"],
      "wajs-main-init": [89, "Inicializando recursos"],
      "wajs-core-module": [91, "Validando módulos internos"],
      "wajs-is-ready": [93, "Validando prontidão"],
      "wajs-main-ready": [95, "Finalizando sincronização"],
      "wajs-full-ready": [96, "Finalizando sincronização"],
      "wpp-full-ready-detectado": [97, "Preparando dados finais"],
      "wpp-preparando-chats": [98, "Sincronizando conversas e privacidade"],
      "wpp-chats-prontos": [99, "Validando conversas e aliases"],
    };

    if (etapa === "wpp-interface") {
      if (detalheLower.includes("inchat")) {
        return { percentual: 84, texto: "Sessão do WhatsApp pronta" };
      }
      if (detalheLower.includes("main")) {
        return { percentual: 80, texto: "Carregando interface interna" };
      }
      if (detalheLower.includes("connected")) {
        return { percentual: 74, texto: "Sessão autenticada" };
      }
      return { percentual: 70, texto: "Sincronizando sessão" };
    }

    const item = mapa[etapa];

    if (!item) {
      return null;
    }

    return {
      percentual: item[0],
      texto: item[1],
    };
  }

  garantirTooltipSincronizacaoPerfil();
  atualizarVisualSincronizacaoPerfil({
    percentual: 5,
    texto: "Inicializando WhatsIAPP",
  });

  ipcRenderer.on("sincronizacao-etapa", (_, dados) => {
    const progresso = progressoDaEtapaSincronizacao(dados);
    if (progresso) {
      atualizarVisualSincronizacaoPerfil(progresso);
    }
    aplicarEtapaSincronizacao(dados);
  });
  // Recupera o ultimo marco do processo principal. Isso evita que o overlay
  // fique preso se o WPPConnect atingir FULL_READY antes deste listener existir.
  ipcRenderer
    .invoke("obter-sincronizacao-inicial-atual")
    .then((dados) => {
      if (dados) {
        const progresso = progressoDaEtapaSincronizacao(dados);
        if (progresso) {
          atualizarVisualSincronizacaoPerfil(progresso);
        }
        aplicarEtapaSincronizacao(dados);
      }
    })
    .catch((erro) => {
      console.warn(
        "[SYNC] falha ao recuperar estado inicial:",
        erro?.message || erro || "erro desconhecido",
      );
    });
  let bootstrapFotosPerfilExecutado = false;

  function garantirPipelineFotosPerfil() {
    // Receber conversas-iniciais tambem prova que o Baileys esta ativo.
    // Assim as fotos nao dependem exclusivamente do evento one-shot
    // baileys-pronto, que pode ja ter ocorrido antes de a lista existir.
    definirBaileysProntoParaFotos(true);

    const recentes = Object.values(conversas)
      .sort((a, b) => {
        const ultimaA = a.mensagens?.at?.(-1)?.timestamp || a.timestamp || 0;
        const ultimaB = b.mensagens?.at?.(-1)?.timestamp || b.timestamp || 0;
        return ultimaB - ultimaA;
      })
      .slice(0, 40);

    if (!recentes.length) {
      processarFilaFotosPerfil();
      return;
    }

    let enfileiradas = 0;

    for (const conversa of recentes) {
      if (!conversa?.id || conversa.fotoPerfilUrl) {
        continue;
      }

      // Uma falha de inicializacao antiga nao pode congelar a conversa
      // definitivamente no avatar por inicial. Rearmamos uma unica vez
      // por carga do renderer, depois o controle normal de retries assume.
      if (!bootstrapFotosPerfilExecutado) {
        conversa.fotoPerfilTentada = false;
        conversa.fotoPerfilFalhas = 0;
      }

      if (!conversa.fotoPerfilTentada) {
        enfileirarFotoPerfil(conversa, true);
        enfileiradas += 1;
      }
    }

    if (!bootstrapFotosPerfilExecutado) {
      bootstrapFotosPerfilExecutado = true;
      console.log(
        `[FOTOS PERFIL] BOOTSTRAP | recentes=${recentes.length} | fila=${enfileiradas}`,
      );
    }

    processarFilaFotosPerfil();
  }

  ipcRenderer.on("baileys-pronto", () => {
    garantirPipelineFotosPerfil();
  });
  ipcRenderer.on("status", (_, dados) => {
    const status = document.getElementById("status");
    const tipo = String(dados.tipo || "");
    if (!obterSincronizacaoInicialConcluida() && tipo === "erro") {
      aplicarEtapaSincronizacao({
        etapa: "erro",
        detalhe: dados?.texto || null,
      });
    }
    status.className = `status ${tipo}`;
    status.querySelector("span").textContent = dados.texto;
    botaoPerfilApp.classList.remove(
      "status-conectado",
      "status-conectando",
      "status-qr",
      "status-erro",
    );

    if (tipo === "erro") {
      atualizarVisualSincronizacaoPerfil({
        percentual: sincronizacaoPerfilPercentual,
        texto: dados?.texto || "Falha durante a sincronização",
        erro: true,
      });
    } else if (tipo === "qr") {
      botaoPerfilApp.classList.add("status-qr");
      botaoPerfilApp.title = String(
        dados.texto || "Conecte o módulo do WhatsApp",
      );
    } else if (sincronizacaoBackgroundCompleta) {
      botaoPerfilApp.classList.add("status-conectado");
      botaoPerfilApp.title = "WhatsIAPP sincronizado";
    } else {
      botaoPerfilApp.classList.add("status-conectando");

      if (tipo === "conectado") {
        atualizarVisualSincronizacaoPerfil({
          percentual: Math.max(40, sincronizacaoPerfilPercentual),
          texto: "Interface pronta. Sincronizando em segundo plano",
        });
      } else {
        botaoPerfilApp.title = `${sincronizacaoPerfilTexto} • ${Math.round(sincronizacaoPerfilPercentual)}%`;
      }
    }
    if (tipo === "conectado") {
      setTimeout(() => {
        carregarMinhaFotoPerfil();
      }, 1200);
    }
  });
  ipcRenderer.on("qr", (_, imagem) => {
    const overlay = document.getElementById("qrOverlay");
    if (imagem) {
      document.getElementById("qrImagem").src = imagem;
      overlay.style.display = "flex";
    } else {
      overlay.style.display = "none";
    }
  });
  ipcRenderer.on("conversas-iniciais", (_, dados) => {
    const conversaAtualAntesSnapshot = String(
      obterConversaAtual?.() || "",
    ).trim();
    const assinaturaConversaAtualAntes = conversaAtualAntesSnapshot
      ? assinaturaRenderConversa(conversas[conversaAtualAntesSnapshot])
      : "";
    const fotosAnteriores = {};
    const mensagensAnteriores = {};
    for (const [id, conversa] of Object.entries(conversas)) {
      if (
        conversa?.testeIntegridadeIA ||
        /^teste-integridade-/i.test(String(id || ""))
      ) {
        conversasSombraTesteIA.set(id, conversa);
      }
      fotosAnteriores[id] = {
        fotoPerfilUrl: conversa.fotoPerfilUrl || null,
        fotoPerfilTentada: !!conversa.fotoPerfilTentada,
        fotoPerfilFalhas: Number(conversa.fotoPerfilFalhas || 0) || 0,
        numeroWhatsapp: conversa.numeroWhatsapp || null,
        naoLidasLocal: Number(conversa.naoLidasLocal || 0) || 0,
        naoLidasWhatsapp:
          conversa.naoLidasWhatsapp === null ||
          conversa.naoLidasWhatsapp === undefined
            ? null
            : Number(conversa.naoLidasWhatsapp),
        naoLidasWhatsappRevisao:
          Number(conversa.naoLidasWhatsappRevisao || 0) || 0,
        naoLidasWhatsappGeracao:
          String(conversa.naoLidasWhatsappGeracao || ""),
        naoLidasWhatsappTimestamp:
          Number(conversa.naoLidasWhatsappTimestamp || 0) || 0,
        naoLidasWpp:
          conversa.naoLidasWpp === null ||
          conversa.naoLidasWpp === undefined
            ? null
            : Number(conversa.naoLidasWpp),
        naoLidasWppRevisao:
          Number(conversa.naoLidasWppRevisao || 0) || 0,
        naoLidasWppGeracao:
          String(conversa.naoLidasWppGeracao || ""),
        presenca: conversa.presenca || null,
      };
      mensagensAnteriores[id] = Array.isArray(conversa.mensagens)
        ? conversa.mensagens.slice()
        : [];
    }
    for (const chave of Object.keys(conversas)) {
      delete conversas[chave];
    }
    dados.forEach((conversa) => {
      if (conversaIgnoradaPorExclusaoPersistida(conversa)) {
        return;
      }
      const trancadaWhatsapp = !!conversa.trancada;
      const anterior = fotosAnteriores[conversa.id];
      const trancadaEfetiva = trancamentoEfetivo(
        conversa.id,
        trancadaWhatsapp,
        conversa.privacidadeAliases,
      );
      const aguardandoDesarquivamento = desarquivamentosLocaisPendentes.has(
        conversa.id,
      );

      // O snapshot recebido aqui ja passou pelo estado autoritativo do
      // WPPConnect. O worker tambem protege internamente contra snapshots
      // atrasados durante um desarquivamento. Portanto o renderer nao deve
      // manter um override local indefinidamente contra o estado real.
      if (aguardandoDesarquivamento) {
        desarquivamentosLocaisPendentes.delete(conversa.id);

        console.log(
          `[ARQUIVAMENTO] SNAPSHOT_AUTORITATIVO | conversa=${conversa.id} | ` +
            `arquivada=${!!conversa.arquivada}`,
        );
      }
      const anteriores = mensagensAnteriores[conversa.id] || [];
      const anterioresPorId = new Map(
        anteriores
          .filter((msg) => msg?.idMensagem)
          .map((msg) => [String(msg.idMensagem), msg]),
      );
      const mensagensMescladas = (conversa.mensagens || [])
        .map((msg) => aplicarEstadoMensagemApagadaPersistida(conversa.id, msg))
        .filter(Boolean)
        .filter(
          (msg) => !mensagemIgnoradaPorLimpezaPersistida(conversa.id, msg),
        )
        .map((msg) => aplicarEstadoMensagemEditadaPersistida(conversa.id, msg))
        .map((msg) => aplicarEstadoReacoesPersistidas(conversa.id, msg))
        .map((msg) => {
          const anteriorMsg = msg?.idMensagem
            ? anterioresPorId.get(String(msg.idMensagem))
            : null;
          const persistida = recuperarMidiaEnviadaLocal(msg?.idMensagem);
          const mediaPath =
            msg?.mediaPath ||
            anteriorMsg?.mediaPath ||
            persistida?.mediaPath ||
            null;
          let mediaUrl =
            msg?.mediaUrl ||
            anteriorMsg?.mediaUrl ||
            persistida?.mediaUrl ||
            null;
          if (!mediaUrl && mediaPath) {
            try {
              if (fs.existsSync(mediaPath)) {
                mediaUrl = pathToFileURL(mediaPath).href;
              }
            } catch {}
          }
          return {
            ...msg,
            idMensagemWpp:
              msg?.idMensagemWpp || anteriorMsg?.idMensagemWpp || null,
            resposta: msg?.resposta || anteriorMsg?.resposta || null,
            mime: msg?.mime || anteriorMsg?.mime || persistida?.mime || null,
            fileName:
              msg?.fileName ||
              anteriorMsg?.fileName ||
              persistida?.fileName ||
              null,
            mediaPath,
            mediaUrl,
          };
        });
      const idsSnapshot = new Set(
        mensagensMescladas
          .map((msg) => String(msg?.idMensagem || ""))
          .filter(Boolean),
      );
      for (const tombstone of obterTombstonesPersistidosConversa(conversa.id)) {
        const idTombstone = String(tombstone?.idMensagem || "");
        if (idTombstone && !idsSnapshot.has(idTombstone)) {
          mensagensMescladas.push(tombstone);
          idsSnapshot.add(idTombstone);
        }
      }
      const maiorTimestampSnapshot = mensagensMescladas.reduce(
        (maior, msg) => Math.max(maior, Number(msg?.timestamp || 0) || 0),
        0,
      );
      const agoraSegundosSnapshot = Math.floor(Date.now() / 1000);
      for (const msg of anteriores) {
        const idMensagem = String(msg?.idMensagem || "");
        if (!idMensagem || idsSnapshot.has(idMensagem)) {
          continue;
        }
        const timestampAnterior = Number(msg?.timestamp || 0) || 0;
        const ehAudioLocal = idMensagem.startsWith("local-audio-");
        const ehMensagemRecenteForaDoSnapshot =
          timestampAnterior > 0 &&
          timestampAnterior >= maiorTimestampSnapshot &&
          agoraSegundosSnapshot - timestampAnterior <= 180;
        if (!ehAudioLocal && !ehMensagemRecenteForaDoSnapshot) {
          continue;
        }
        const restaurada = aplicarEstadoMensagemApagadaPersistida(
          conversa.id,
          msg,
        );
        if (
          !restaurada ||
          mensagemIgnoradaPorLimpezaPersistida(conversa.id, restaurada)
        ) {
          continue;
        }
        mensagensMescladas.push(
          aplicarEstadoReacoesPersistidas(
            conversa.id,
            aplicarEstadoMensagemEditadaPersistida(conversa.id, restaurada),
          ),
        );
        idsSnapshot.add(idMensagem);
      }
      const estadoNaoLidasWpp = lerEstadoNaoLidasWpp(conversa);
      const aplicarNaoLidasWpp =
        estadoNaoLidasWpp.valido &&
        (!anterior ||
          estadoWppMaisNovoQueConversa(anterior, estadoNaoLidasWpp));

      const wppJaAutoritativo =
        estadoNaoLidasWpp.valido ||
        !!String(anterior?.naoLidasWppGeracao || "").trim();

      const estadoNaoLidasRemoto = lerEstadoNaoLidasWhatsapp(conversa);
      const aplicarNaoLidasRemoto =
        !wppJaAutoritativo &&
        estadoNaoLidasRemoto.valido &&
        (!anterior ||
          estadoRemotoMaisNovoQueConversa(anterior, estadoNaoLidasRemoto));

      conversas[conversa.id] = {
        id: conversa.id,
        nome: conversa.nome,
        grupo:
          !!conversa.grupo ||
          String(conversa.id || "")
            .toLowerCase()
            .endsWith("@g.us"),
        arquivada: !!conversa.arquivada,
        privacidadeAliases: Array.isArray(conversa.privacidadeAliases)
          ? conversa.privacidadeAliases.slice()
          : [],
        trancadaWhatsapp,
        trancada: trancadaEfetiva,
        timestamp: conversa.timestamp || 0,
        mensagens: ordenarMensagensPorTimestamp(mensagensMescladas),
        fotoPerfilUrl: anterior?.fotoPerfilUrl || null,
        fotoPerfilTentada: anterior?.fotoPerfilTentada || false,
        fotoPerfilFalhas: Number(anterior?.fotoPerfilFalhas || 0) || 0,
        numeroWhatsapp: anterior?.numeroWhatsapp || null,
        naoLidasLocal: trancadaEfetiva
          ? 0
          : aplicarNaoLidasWpp
            ? estadoNaoLidasWpp.total
            : aplicarNaoLidasRemoto
              ? estadoNaoLidasRemoto.total
              : anterior
                ? Number(anterior.naoLidasLocal || 0) || 0
                : Number(naoLidasPersistidas[conversa.id] || 0) || 0,
        naoLidasWhatsapp: estadoNaoLidasRemoto.valido
          ? estadoNaoLidasRemoto.total
          : anterior?.naoLidasWhatsapp ?? null,
        naoLidasWhatsappRevisao: estadoNaoLidasRemoto.valido
          ? estadoNaoLidasRemoto.revisao
          : Number(anterior?.naoLidasWhatsappRevisao || 0) || 0,
        naoLidasWhatsappGeracao: estadoNaoLidasRemoto.valido
          ? estadoNaoLidasRemoto.geracao
          : String(anterior?.naoLidasWhatsappGeracao || ""),
        naoLidasWhatsappTimestamp: estadoNaoLidasRemoto.valido
          ? estadoNaoLidasRemoto.timestamp
          : Number(anterior?.naoLidasWhatsappTimestamp || 0) || 0,
        naoLidasWpp: estadoNaoLidasWpp.valido
          ? estadoNaoLidasWpp.total
          : anterior?.naoLidasWpp ?? null,
        naoLidasWppRevisao: estadoNaoLidasWpp.valido
          ? estadoNaoLidasWpp.revisao
          : Number(anterior?.naoLidasWppRevisao || 0) || 0,
        naoLidasWppGeracao: estadoNaoLidasWpp.valido
          ? estadoNaoLidasWpp.geracao
          : String(anterior?.naoLidasWppGeracao || ""),
        presenca: anterior?.presenca || null,
      };

      if (aplicarNaoLidasWpp) {
        persistirNaoLidasConversa(conversas[conversa.id]);

        console.log(
          `[NAO LIDAS] WPP_AUTORITATIVO | conversa=${conversa.id} | ` +
            `total=${estadoNaoLidasWpp.total} | ` +
            `revisao=${estadoNaoLidasWpp.revisao}`,
        );
      }

      if (aplicarNaoLidasRemoto) {
        persistirNaoLidasConversa(conversas[conversa.id]);

        console.log(
          `[NAO LIDAS] SNAPSHOT_REMOTO | conversa=${conversa.id} | ` +
            `total=${estadoNaoLidasRemoto.total} | ` +
            `revisao=${estadoNaoLidasRemoto.revisao}`,
        );
      }
    });
    // Conversas criadas pelo botao "Nova conversa" podem ainda nao existir
    // no snapshot do WhatsApp. Mantemos a conversa provisoria ate o primeiro
    // envio confirmado ou ate o proprio WhatsApp passar a devolve-la.
    for (const [id, provisoria] of conversasProvisoriasNovaMensagem.entries()) {
      if (!id || !provisoria?.provisoriaNovaConversa) {
        conversasProvisoriasNovaMensagem.delete(id);
        continue;
      }
      if (conversas[id]) {
        delete conversas[id].provisoriaNovaConversa;
        conversasProvisoriasNovaMensagem.delete(id);
        continue;
      }
      conversas[id] = provisoria;
    }
    // Conversas de integridade sao sinteticas e nao vem no snapshot do WhatsApp.
    // Reanexa exatamente os mesmos objetos apos qualquer recarga da lista real,
    // preservando mensagens, rota, clima e contexto durante toda a bateria.
    for (const [id, sombra] of conversasSombraTesteIA.entries()) {
      if (!id || !sombra || !sombra.testeIntegridadeIA) {
        conversasSombraTesteIA.delete(id);
        continue;
      }
      conversas[id] = sombra;
    }
    atualizarContadores();
    recalcularNaoLidasGlobal();
    renderConversas();
    configurarSenhaTrancadasSeNecessario();
    garantirPipelineFotosPerfil();
    if (obterConversaAtual() && conversas[obterConversaAtual()]) {
      const conversa = conversas[obterConversaAtual()];
      nomeChat.textContent = conversa.nome || conversa.id;
      atualizarStatusCabecalho();

      const mesmaConversaDoSnapshot =
        conversaAtualAntesSnapshot &&
        conversaAtualAntesSnapshot === conversa.id;
      const assinaturaConversaAtualDepois = assinaturaRenderConversa(conversa);
      const chatJaMontado = !!mensagens.querySelector(
        ".mensagem[data-id-mensagem], .vazio",
      );
      const conversaVisivelMudou =
        !mesmaConversaDoSnapshot ||
        !assinaturaConversaAtualAntes ||
        assinaturaConversaAtualAntes !== assinaturaConversaAtualDepois;

      if (!chatJaMontado || conversaVisivelMudou) {
        renderMensagens();
      } else {
        console.log(
          `[EVENTOS WHATSAPP] SNAPSHOT_SEM_RERENDER_CHAT | conversa=${conversa.id}`,
        );
      }

      atualizarBotaoArquivar();
      atualizarBotaoTrancar();
      atualizarCompositor();
      atualizarCabecalhoConversa();
    } else {
      definirConversaAtual(null);
      nomeChat.textContent = "Selecione uma conversa";
      statusChat.textContent = "";
      mensagens.innerHTML = obterMarkupEstadoInicialChat(
        "Selecione uma conversa",
      );
      atualizarBotaoArquivar();
      atualizarBotaoTrancar();
      atualizarCompositor();
      atualizarCabecalhoConversa();
    }
  });
  ipcRenderer.on("mensagem", (_, dados) => {
    if (
      !dados?.testeIntegridadeIA &&
      ehConversaTecnica({
        id: dados.id,
        nome: dados.nome,
      })
    ) {
      return;
    }
    if (
      conversaIgnoradaPorExclusaoPersistida(
        {
          id: dados.id,
          timestamp: dados.timestamp,
        },
        obterSincronizacaoInicialConcluida(),
      )
    ) {
      return;
    }
    if (
      mensagemIgnoradaPorLimpezaPersistida(
        dados.id,
        dados,
        obterSincronizacaoInicialConcluida(),
      )
    ) {
      return;
    }
    const dadosAposExclusaoPersistida = aplicarEstadoMensagemApagadaPersistida(
      dados.id,
      dados,
    );
    if (!dadosAposExclusaoPersistida) {
      return;
    }
    if (dadosAposExclusaoPersistida !== dados) {
      dados = {
        ...dados,
        ...dadosAposExclusaoPersistida,
      };
    }
    const dadosAposEdicaoPersistida = aplicarEstadoMensagemEditadaPersistida(
      dados.id,
      dados,
    );
    if (dadosAposEdicaoPersistida !== dados) {
      dados = {
        ...dados,
        ...dadosAposEdicaoPersistida,
      };
    }
    const dadosAposReacoesPersistidas = aplicarEstadoReacoesPersistidas(
      dados.id,
      dados,
    );
    if (dadosAposReacoesPersistidas !== dados) {
      dados = {
        ...dados,
        ...dadosAposReacoesPersistidas,
      };
    }
    if (!conversas[dados.id]) {
      const trancadaWhatsapp = !!dados.trancada;
      const estadoNaoLidasEventoInicial = lerEstadoNaoLidasWhatsapp(dados);
      conversas[dados.id] = {
        id: dados.id,
        nome: dados.nome,
        grupo:
          !!dados.grupo ||
          String(dados.id || "")
            .toLowerCase()
            .endsWith("@g.us"),
        arquivada: dados.arquivada || false,
        trancadaWhatsapp,
        trancada: trancamentoEfetivo(
          dados.id,
          trancadaWhatsapp,
          dados.privacidadeAliases,
        ),
        timestamp: dados.timestamp || 0,
        mensagens: [],
        fotoPerfilUrl: null,
        fotoPerfilTentada: false,
        numeroWhatsapp: null,
        naoLidasLocal: estadoNaoLidasEventoInicial.valido
          ? estadoNaoLidasEventoInicial.total
          : Number(naoLidasPersistidas[dados.id] || 0) || 0,
        naoLidasWhatsapp: estadoNaoLidasEventoInicial.valido
          ? estadoNaoLidasEventoInicial.total
          : null,
        naoLidasWhatsappRevisao: estadoNaoLidasEventoInicial.valido
          ? estadoNaoLidasEventoInicial.revisao
          : 0,
        naoLidasWhatsappGeracao: estadoNaoLidasEventoInicial.valido
          ? estadoNaoLidasEventoInicial.geracao
          : "",
        naoLidasWhatsappTimestamp: estadoNaoLidasEventoInicial.valido
          ? estadoNaoLidasEventoInicial.timestamp
          : 0,
        presenca: null,
        testeIntegridadeIA: !!dados?.testeIntegridadeIA,
      };
    }
    const conversa = conversas[dados.id];
    if (conversa?.provisoriaNovaConversa) {
      delete conversa.provisoriaNovaConversa;
      conversasProvisoriasNovaMensagem.delete(dados.id);
    }
    if (dados?.testeIntegridadeIA) {
      conversa.testeIntegridadeIA = true;
      conversasSombraTesteIA.set(dados.id, conversa);
    }
    conversa.nome = dados.nome || conversa.nome;
    conversa.arquivada = dados.arquivada ?? conversa.arquivada;
    if (typeof dados.trancada === "boolean") {
      conversa.trancadaWhatsapp = dados.trancada;
      conversa.privacidadeAliases = Array.isArray(dados.privacidadeAliases)
        ? dados.privacidadeAliases.slice()
        : conversa.privacidadeAliases || [];
      conversa.trancada = trancamentoEfetivo(
        dados.id,
        dados.trancada,
        conversa.privacidadeAliases,
      );
    }
    if (conversa.trancada) {
      conversa.naoLidasLocal = 0;
      persistirNaoLidasConversa(conversa);
    }
    let marcarNovaMensagemComoLida = false;
    if (
      dados.minha &&
      !conversa.trancada &&
      typeof dados.arquivada === "boolean"
    ) {
      // Mensagem propria nao significa, por si so, que o WhatsApp
      // desarquivou o chat. Mantemos o estado informado pelo WPPConnect.
      // Isso evita uma conversa realmente arquivada aparecer em Principais.
      desarquivamentosLocaisPendentes.delete(conversa.id);
    }
    if (!dados.minha) {
      const conversaEstaAberta =
        obterConversaAtual() === dados.id &&
        document.hasFocus() &&
        !document.hidden;

      const wppJaAutoritativo = !!String(
        conversa.naoLidasWppGeracao || "",
      ).trim();

      const estadoNaoLidasEvento = lerEstadoNaoLidasWhatsapp(dados);
      const geracaoAtual = String(
        conversa.naoLidasWhatsappGeracao || "",
      ).trim();
      const revisaoAtual =
        Number(conversa.naoLidasWhatsappRevisao || 0) || 0;
      let timestampMensagem = Number(dados.timestamp || 0) || 0;

      if (timestampMensagem > 1000000000000) {
        timestampMensagem = Math.floor(timestampMensagem / 1000);
      }

      const eventoCobertoPeloEstadoRemoto =
        !wppJaAutoritativo &&
        !!dados.naoLidasWhatsappIncluiMensagem &&
        estadoNaoLidasEvento.valido &&
        (!geracaoAtual ||
          geracaoAtual !== estadoNaoLidasEvento.geracao ||
          estadoNaoLidasEvento.revisao >= revisaoAtual);

      const estadoAtualMaisNovoCobreMensagem =
        !wppJaAutoritativo &&
        !!geracaoAtual &&
        estadoNaoLidasEvento.valido &&
        geracaoAtual === estadoNaoLidasEvento.geracao &&
        revisaoAtual > estadoNaoLidasEvento.revisao &&
        timestampMensagem > 0 &&
        Number(conversa.naoLidasWhatsappTimestamp || 0) >= timestampMensagem;

      if (conversaEstaAberta) {
        marcarConversaComoLidaLocal(conversa);
        marcarNovaMensagemComoLida = true;
      } else if (!conversa.trancada) {
        if (eventoCobertoPeloEstadoRemoto) {
          aplicarEstadoNaoLidasWhatsappNaConversa(
            conversa,
            estadoNaoLidasEvento,
            true,
          );
        } else if (estadoAtualMaisNovoCobreMensagem) {
          persistirNaoLidasConversa(conversa);
        } else {
          incrementarNaoLidaLocal(conversa);
        }
      }

      if (conversa.arquivada && !conversa.trancada) {
        conversa.arquivada = false;
        desarquivarAutomaticamentePorMensagem(conversa.id);
      }
    }
    conversa.timestamp = dados.timestamp || Date.now();
    if (dados.minha && dados.mediaPath && dados.idMensagem) {
      persistirMidiaEnviadaLocal(dados);
    }
    if (dados.minha && dados.tipo === "audio") {
      moduloAudio.reconciliarAudioOtimista(conversa, dados);
    }
    if (dados.minha && dados.tipo === "video") {
      reconciliarVideoOtimista?.(conversa, dados);
    }
    const mensagemExistente = conversa.mensagens.find(
      (msg) => msg.idMensagem && msg.idMensagem === dados.idMensagem,
    );
    const jaExiste = !!mensagemExistente;
    if (mensagemExistente) {
      const midiaPersistida = recuperarMidiaEnviadaLocal(dados.idMensagem);
      mensagemExistente.idMensagemWpp =
        dados.idMensagemWpp || mensagemExistente.idMensagemWpp || null;
      mensagemExistente.resposta =
        dados.resposta || mensagemExistente.resposta || null;
      mensagemExistente.texto = dados.texto ?? mensagemExistente.texto;
      mensagemExistente.mime = dados.mime || mensagemExistente.mime;
      mensagemExistente.fileName = dados.fileName || mensagemExistente.fileName;
      mensagemExistente.viewOnceKind =
        dados.viewOnceKind || mensagemExistente.viewOnceKind || null;
      // Atualizacoes da mesma mensagem, como reacoes/status de entrega,
      // nunca podem alterar a posicao cronologica original no chat.
      // So preenche horario/timestamp se a mensagem antiga ainda nao os tiver.
      mensagemExistente.horario =
        mensagemExistente.horario || dados.horario || null;
      mensagemExistente.timestamp =
        mensagemExistente.timestamp || dados.timestamp || 0;
      mensagemExistente.mediaPath =
        dados.mediaPath ||
        mensagemExistente.mediaPath ||
        midiaPersistida?.mediaPath ||
        null;
      mensagemExistente.mediaUrl =
        dados.mediaUrl ||
        mensagemExistente.mediaUrl ||
        midiaPersistida?.mediaUrl ||
        null;
      mensagemExistente.rawBase64 =
        dados.rawBase64 || mensagemExistente.rawBase64 || null;
      mensagemExistente.statusEntrega =
        dados.statusEntrega || mensagemExistente.statusEntrega || null;
      mensagemExistente.editada =
        !!dados.editada || !!mensagemExistente.editada;
      if (Array.isArray(dados.reacoes)) {
        mensagemExistente.reacoes = normalizarListaReacoes(dados.reacoes);
      }
    }
    if (
      !dados.minha &&
      !dados?.testeIntegridadeIA &&
      !conversa.trancada &&
      notificacoesAtivasConversa(conversa)
    ) {
      // Tenta o som tambem quando a mensagem ja chegou por outra fonte.
      // O modulo de notificacoes deduplica pelo id da mensagem. Assim uma
      // notificacao imediata perdida/adiada nao deixa a conversa sem som.
      void tocarSomNovaMensagem({
        ...(dados || {}),
        conversaId: conversa.id,
        origem: "mensagem-renderer",
      });
      mostrarToastInternoNovaMensagem(conversa, dados);
      // Notificacao externa e independente do toast interno.
      // O processo principal decide se a janela esta realmente fora de foco.
      void solicitarNotificacaoExternaMensagem(conversa, dados, jaExiste);
    }
    if (!jaExiste) {
      conversa.mensagens.push({
        idMensagem: dados.idMensagem,
        idMensagemWpp: dados.idMensagemWpp || null,
        resposta: dados.resposta || null,
        texto: dados.texto,
        tipo: dados.tipo,
        mime: dados.mime,
        fileName: dados.fileName,
        viewOnceKind: dados.viewOnceKind || null,
        horario: dados.horario,
        timestamp: dados.timestamp,
        minha: dados.minha,
        mediaPath: dados.mediaPath || null,
        mediaUrl: dados.mediaUrl || null,
        rawBase64: dados.rawBase64 || null,
        statusEntrega: dados.statusEntrega || null,
        editada: !!dados.editada,
        reacoes: normalizarListaReacoes(dados.reacoes),
        animacaoEntrada:
          obterConversaAtual() === dados.id
            ? dados.minha
              ? "envio"
              : "recebida"
            : null,
      });
    }
    // A ordem cronologica e uma invariavel da conversa.
    // Qualquer mensagem nova ou atualizacao de mensagem existente precisa
    // deixar o array ordenado antes de IA, renderizacao e persistencias usarem
    // a ultima mensagem como referencia.
    ordenarMensagensPorTimestamp(conversa.mensagens);

    const estadoEntradaCurtaIA = !dados.minha
      ? jaExiste
        ? obterEstadoEntradaCurtaIA(conversa, dados)
        : registrarEntradaCurtaIA(conversa, dados)
      : null;
    if (!dados.minha) {
      diagnosticoSegundoPlanoIA("MENSAGEM_RECEBIDA", {
        id: conversa.id,
        atual: obterConversaAtual() || "nenhuma",
        modo: obterModoIAConversa(conversa.id),
        segundoPlano: obterSegundoPlanoIAConversa(conversa.id),
        trancada: !!conversa.trancada,
        jaExiste,
        curtaAguardar: !!estadoEntradaCurtaIA?.aguardar,
        curtaAgrupada: !!estadoEntradaCurtaIA?.agrupada,
      });
    }
    // Se o usuario respondeu por outro dispositivo antes de abrir a conversa,
    // uma resposta automatica antiga nao deve ser enviada depois.
    if (dados.minha) {
      limparRespostaAutomaticaPendente(conversa.id);
      limparEntradaCurtaIA(conversa.id);
    } else if (
      !conversa.trancada &&
      obterModoIAConversa(conversa.id) === "automatico" &&
      obterConversaAtual() !== dados.id &&
      eventoMensagemEhUltimaRelevanteIA(conversa, dados)
    ) {
      diagnosticoSegundoPlanoIA("ENTROU_FLUXO_FECHADO", {
        id: conversa.id,
        atual: obterConversaAtual() || "nenhuma",
        segundoPlano: obterSegundoPlanoIAConversa(conversa.id),
        jaExiste,
      });
      if (estadoEntradaCurtaIA?.aguardar) {
        diagnosticoSegundoPlanoIA("BLOQUEADA_MENSAGEM_CURTA", {
          id: conversa.id,
        });
        limparRespostaAutomaticaPendente(conversa.id);
        cancelarRespostaAutomaticaIAEmAndamento(conversa.id, true);
      } else {
        // Guarda apenas a mensagem recebida mais recente daquela conversa.
        // Com Segundo plano OFF, ela sera respondida quando o chat abrir.
        // Com Segundo plano ON, o timer e iniciado agora, sem abrir a conversa.
        registrarRespostaAutomaticaPendente(conversa.id, conversa);
        diagnosticoSegundoPlanoIA("PENDENTE_REGISTRADA", {
          id: conversa.id,
          existe: respostasAutomaticasPendentes.has(conversa.id),
          segundoPlano: obterSegundoPlanoIAConversa(conversa.id),
        });
        if (obterSegundoPlanoIAConversa(conversa.id)) {
          const agendada = tentarAgendarRespostaAutomaticaPendente(
            conversa.id,
            4000,
          );
          diagnosticoSegundoPlanoIA("TENTATIVA_AGENDAR_BG", {
            id: conversa.id,
            agendada,
          });
        } else {
          diagnosticoSegundoPlanoIA("BG_DESLIGADO_AGUARDANDO_ABERTURA", {
            id: conversa.id,
          });
        }
      }
    }
    if (marcarNovaMensagemComoLida && dados.idMensagem) {
      marcarConversaComoLidaWhatsapp(conversa, [dados.idMensagem]);
    }
    atualizarContadores();
    recalcularNaoLidasGlobal();
    renderConversas();
    if (obterConversaAtual() === dados.id) {
      renderMensagens();

      // Midia recebida ao vivo precisa iniciar o carregamento imediatamente.
      // Antes ela ficava apenas no placeholder e so carregava ao sair e voltar
      // para a conversa, quando carregarMidiasDaConversa era executado.
      const mensagemAtualizada =
        mensagemExistente ||
        conversa.mensagens.find(
          (item) => item?.idMensagem && item.idMensagem === dados.idMensagem,
        );
      if (
        mensagemAtualizada &&
        ["imagem", "audio", "video", "documento", "sticker"].includes(
          mensagemAtualizada.tipo,
        ) &&
        !mensagemAtualizada.mediaUrl &&
        !mensagemAtualizada.erroMidia &&
        mensagemAtualizada.idMensagem
      ) {
        void carregarUmaMidia?.(conversa, mensagemAtualizada);
      }

      if (!dados.minha) {
        if (obterModoIAAtual() === "automatico") {
          const ultimaRecebida = obterUltimaMensagemRelevanteIA(conversa);
          if (ultimaRecebida && !ultimaRecebida.minha) {
            limparRespostaAutomaticaPendente(dados.id);
            if (estadoEntradaCurtaIA?.aguardar) {
              cancelarRespostaAutomaticaIAEmAndamento(dados.id, true);
              mostrarEstadoPainelIA(
                "Mensagem curta recebida. Aguardando mais contexto antes de chamar a IA.",
              );
            } else {
              agendarRespostaAutomaticaIA(
                dados.id,
                chaveBaseSugestaoIA(conversa, ultimaRecebida),
                4000,
              );
            }
          }
        } else if (obterModoIAAtual() === "assistido") {
          if (estadoEntradaCurtaIA?.aguardar) {
            cancelarSugestaoIAEmAndamento();
            mostrarEstadoPainelIA(
              "Mensagem curta recebida. Aguardando mais contexto antes de chamar a IA.",
            );
          } else {
            // No Assistido, atualiza as tres sugestoes para a nova mensagem.
            agendarSugestaoIA(dados.id, 650);
          }
        }
      }
    }
  });
  ipcRenderer.on("mensagem-status", (_, dados) => {
    const conversaId = String(dados?.conversaId || "");
    const idMensagem = String(dados?.idMensagem || "");
    const conversa = conversas[conversaId];
    const msg = conversa?.mensagens?.find(
      (item) => String(item.idMensagem || "") === idMensagem,
    );

    const temReacoes = Array.isArray(dados?.reacoes);
    const reacoesAntes = msg ? normalizarListaReacoes(msg.reacoes) : [];
    const reacoesDepois = temReacoes
      ? normalizarListaReacoes(dados.reacoes)
      : null;

    // Uma reacao nossa tambem pode alterar o agregado retornado pelo WhatsApp.
    // Para notificar apenas reacoes recebidas, comparamos somente a quantidade
    // externa: total menos a nossa propria reacao naquele emoji.
    let reacaoExternaNova = null;
    if (msg && reacoesDepois) {
      const externosAntes = new Map();

      for (const item of reacoesAntes) {
        const emoji = String(item?.emoji || "").trim();
        if (!emoji) continue;

        const total = Math.max(0, Number(item?.total || 0) || 0);
        const externos = Math.max(0, total - (item?.minha ? 1 : 0));
        externosAntes.set(emoji, externos);
      }

      for (const item of reacoesDepois) {
        const emoji = String(item?.emoji || "").trim();
        if (!emoji) continue;

        const total = Math.max(0, Number(item?.total || 0) || 0);
        const externosDepois = Math.max(0, total - (item?.minha ? 1 : 0));
        const externosAnterior = Number(externosAntes.get(emoji) || 0) || 0;
        const aumento = externosDepois - externosAnterior;

        if (
          aumento > 0 &&
          (!reacaoExternaNova || aumento > reacaoExternaNova.aumento)
        ) {
          reacaoExternaNova = {
            emoji,
            aumento,
            externosDepois,
          };
        }
      }
    }

    if (temReacoes && conversaId && idMensagem) {
      registrarReacoesLocalmente(conversaId, idMensagem, dados.reacoes);
    }

    if (!conversa || !msg) {
      return;
    }

    if (dados?.statusEntrega) {
      msg.statusEntrega = dados.statusEntrega;
    }

    if (reacoesDepois) {
      msg.reacoes = reacoesDepois;
    }

    if (reacaoExternaNova && !conversa.trancada) {
      const conversaEstaAberta =
        obterConversaAtual() === conversa.id &&
        document.hasFocus() &&
        !document.hidden;

      if (conversaEstaAberta) {
        marcarConversaComoLidaLocal(conversa);
      } else {
        incrementarNaoLidaLocal(conversa);
      }

      if (conversa.arquivada) {
        conversa.arquivada = false;
        void desarquivarAutomaticamentePorMensagem(conversa.id);
      }

      const timestampReacao =
        Number(dados?.reacaoTimestamp || dados?.timestamp || 0) ||
        Math.floor(Date.now() / 1000);
      conversa.timestamp = Math.max(
        Number(conversa.timestamp || 0) || 0,
        timestampReacao,
      );

      const dadosNotificacaoReacao = {
        id: conversa.id,
        idMensagem: `reacao:${idMensagem}:${reacaoExternaNova.emoji}:${reacaoExternaNova.externosDepois}`,
        texto: `Reagiu ${reacaoExternaNova.emoji} à sua mensagem`,
        tipo: "texto",
        timestamp: timestampReacao,
        minha: false,
      };

      if (notificacoesAtivasConversa(conversa)) {
        tocarSomNovaMensagem(dadosNotificacaoReacao);
        mostrarToastInternoNovaMensagem(conversa, dadosNotificacaoReacao);
        void solicitarNotificacaoExternaMensagem(
          conversa,
          dadosNotificacaoReacao,
          false,
        );
      }

      console.log(
        `[REACOES] incoming reaction | conversa=${conversa.id} | mensagem=${idMensagem} | emoji=${reacaoExternaNova.emoji} | unread=${Number(conversa.naoLidasLocal || 0) || 0} | archived=${!!conversa.arquivada}`,
      );

      atualizarContadores();
      recalcularNaoLidasGlobal();
      renderConversas();
    }

    if (obterConversaAtual() === conversa.id) {
      renderMensagens();
    }
  });

  console.log("[EVENTOS WHATSAPP MODULE] initialized");
}

module.exports = {
  criarModuloEventosWhatsapp,
};
