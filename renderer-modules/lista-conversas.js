const CHAVE_NAO_LIDAS = "whatsiapp.naoLidas.v1";

function criarPersistenciaNaoLidas(dependencias = {}) {
  const { localStorage } = dependencias;

  function carregarNaoLidasPersistidas() {
    try {
      const dados = JSON.parse(localStorage.getItem(CHAVE_NAO_LIDAS) || "{}");

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const naoLidasPersistidas = carregarNaoLidasPersistidas();

  function salvarNaoLidasPersistidas() {
    localStorage.setItem(CHAVE_NAO_LIDAS, JSON.stringify(naoLidasPersistidas));
  }

  function persistirNaoLidasConversa(conversa) {
    if (!conversa?.id) {
      return;
    }

    const total = Number(conversa.naoLidasLocal || 0) || 0;

    if (conversa.trancada || total <= 0) {
      delete naoLidasPersistidas[conversa.id];
    } else {
      naoLidasPersistidas[conversa.id] = total;
    }

    salvarNaoLidasPersistidas();
  }

  return {
    naoLidasPersistidas,
    salvarNaoLidasPersistidas,
    persistirNaoLidasConversa,
  };
}

function criarModuloListaConversas(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    window,
    localStorage,
    listaConversas,
    busca,
    abaConversas,
    abaNaoLidas,
    abaFavoritos,
    abaGrupos,
    abaMais,
    abaArquivadas,
    contadorArquivadas,
    contadorNaoLidas,
    contadorFavoritos,
    abasFiltros,
    lateralTitulo,
    btnRailConversas,
    btnRailArquivadas,
    btnRailFavoritos,
    btnRailTrancadas,
    btnRailConfig,
    btnMenuConversas,
    botaoPerfilApp,
    conversas,
    idsGruposAtuaisWhatsapp,
    desarquivamentosAutomaticosEmAndamento,
    CHAVE_HASH_TRANCADAS,
    obterConversaAtual,
    obterAbaAtual,
    definirAbaAtual,
    obterFiltro,
    definirFiltro,
    obterTrancadasLiberadas,
    definirTrancadasLiberadas,
    obterGruposAtuaisWhatsappCarregados,
    carregarGruposAtuaisWhatsapp,
    obterUltimaMensagemCronologica,
    criarAvatarContato,
    textoHorarioListaConversa,
    descricaoPreview,
    abrirPerfilContato,
    abrirConversa,
    abrirMenuContexto,
    obterObservadorAvatares,
    enfileirarFotoPerfil,
    ehConversaTecnica,
    ehConversaGrupo,
    renderFavoritos,
    normalizarTextoBusca,
    descricaoCurtaMensagemResposta,
    cancelarFixacaoFimConversa,
    localizarMensagemNaTela,
    destacarMensagemRespondida,
    totalFavoritosVisiveis,
    limparSelecaoConversa,
    abrirPainelNovaConversa,
    hashSenhaTrancadas,
    persistirNaoLidasConversa,
    marcarConversaComoLidaWhatsapp,
  } = dependencias;

  const abaTrancadas = btnRailTrancadas;
  const contadorTrancadas = document.getElementById("contadorTrancadas");
  const DURACAO_TRANSICAO_ARQUIVAMENTO = 2000;
  const DURACAO_TRANSICAO_TRANCAMENTO = 700;

  let versaoRenderConversas = 0;
  let abaTrancadasInserida = false;
  let timerBuscaConversasMensagens = null;
  let timerLiberarTrancadas = null;
  let totalNaoLidasGlobal = 0;
  let navegacaoConfigurada = false;
  let focoConfigurado = false;

  function esperarTransicao(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function obterItemConversaVisivel(conversaId) {
    if (!listaConversas || !conversaId) {
      return null;
    }

    return (
      Array.from(listaConversas.querySelectorAll(".conversa")).find(
        (item) => item.dataset.conversaId === String(conversaId),
      ) || null
    );
  }

  async function animarConversaParaAba(conversaId, abaDestino, classe) {
    const item = obterItemConversaVisivel(conversaId);

    if (!item || !abaDestino) {
      return;
    }

    const origem = item.getBoundingClientRect();
    const destino = abaDestino.getBoundingClientRect();
    const origemX = origem.left + origem.width / 2;
    const origemY = origem.top + origem.height / 2;
    const destinoX = destino.left + destino.width / 2;
    const destinoY = destino.top + destino.height / 2;
    const fantasma = item.cloneNode(true);

    fantasma.classList.remove(
      "ativa",
      "transicao-arquivar",
      "transicao-desarquivar",
      "transicao-trancar",
      "transicao-destrancar",
    );
    fantasma.classList.add("conversa-fantasma", classe);

    Object.assign(fantasma.style, {
      position: "fixed",
      left: `${origem.left}px`,
      top: `${origem.top}px`,
      width: `${origem.width}px`,
      height: `${origem.height}px`,
      margin: "0",
      zIndex: "160000",
      pointerEvents: "none",
    });

    fantasma.style.setProperty(
      "--whatsiapp-transicao-x",
      `${destinoX - origemX}px`,
    );
    fantasma.style.setProperty(
      "--whatsiapp-transicao-y",
      `${destinoY - origemY}px`,
    );

    document.body.appendChild(fantasma);
    item.classList.add("conversa-origem-oculta");
    void fantasma.offsetWidth;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        fantasma.classList.add("animando");
      });
    });

    await esperarTransicao(DURACAO_TRANSICAO_ARQUIVAMENTO);

    fantasma.remove();

    if (item.isConnected) {
      item.classList.remove("conversa-origem-oculta");
    }

    abaDestino.classList.add("aba-recebendo-conversa");

    setTimeout(() => {
      abaDestino.classList.remove("aba-recebendo-conversa");
    }, 360);
  }

  async function animarTrancamentoConversa(conversaId, vaiTrancar) {
    const item = obterItemConversaVisivel(conversaId);

    if (!item) {
      return;
    }

    const origem = item.getBoundingClientRect();
    const fantasma = item.cloneNode(true);

    fantasma.classList.remove(
      "ativa",
      "transicao-arquivar",
      "transicao-desarquivar",
      "transicao-trancar",
      "transicao-destrancar",
    );
    fantasma.classList.add(
      "conversa-fantasma",
      vaiTrancar ? "transicao-trancar" : "transicao-destrancar",
    );

    Object.assign(fantasma.style, {
      position: "fixed",
      left: `${origem.left}px`,
      top: `${origem.top}px`,
      width: `${origem.width}px`,
      height: `${origem.height}px`,
      margin: "0",
      zIndex: "160000",
      pointerEvents: "none",
    });

    document.body.appendChild(fantasma);
    item.classList.add("conversa-origem-oculta");
    void fantasma.offsetWidth;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        fantasma.classList.add("animando");
      });
    });

    await esperarTransicao(DURACAO_TRANSICAO_TRANCAMENTO);

    fantasma.remove();

    if (item.isConnected) {
      item.classList.remove("conversa-origem-oculta");
    }
  }

  function inserirAbaTrancadas() {
    if (!abaTrancadas || abaTrancadasInserida) {
      return;
    }

    abaTrancadas.hidden = false;
    abaTrancadasInserida = true;
  }

  function bloquearTrancadas() {
    clearTimeout(timerLiberarTrancadas);
    timerLiberarTrancadas = null;
    definirTrancadasLiberadas(false);

    if (abaTrancadas) {
      abaTrancadas.hidden = true;
    }

    abaTrancadasInserida = false;

    if (obterAbaAtual() === "trancadas") {
      definirAbaAtual("conversas");
    }

    busca.value = "";
    definirFiltro("");
  }

  function ativarAba(nome) {
    definirAbaAtual(nome);

    const abaPrincipal = [
      "conversas",
      "nao-lidas",
      "favoritos",
      "grupos",
    ].includes(nome);

    abaConversas?.classList.toggle("ativa", nome === "conversas");
    abaNaoLidas?.classList.toggle("ativa", nome === "nao-lidas");
    abaFavoritos?.classList.toggle("ativa", nome === "favoritos");
    abaGrupos?.classList.toggle("ativa", nome === "grupos");
    btnRailConversas?.classList.toggle("ativa", abaPrincipal);
    btnRailArquivadas?.classList.toggle("ativa", nome === "arquivadas");
    btnRailFavoritos?.classList.toggle("ativa", nome === "favoritos");

    if (abaTrancadas) {
      abaTrancadas.classList.toggle("ativa", nome === "trancadas");
    }

    if (abasFiltros) {
      abasFiltros.classList.toggle(
        "ocultas",
        nome === "arquivadas" || nome === "trancadas",
      );
    }

    if (lateralTitulo) {
      lateralTitulo.textContent =
        nome === "arquivadas"
          ? "Arquivadas"
          : nome === "trancadas"
            ? "Trancadas"
            : "Conversas";
    }
  }

  function tentarLiberarTrancadas(valorDigitado) {
    const hashSalvo = localStorage.getItem(CHAVE_HASH_TRANCADAS);

    if (!hashSalvo || !valorDigitado) {
      return false;
    }

    if (hashSenhaTrancadas(valorDigitado) !== hashSalvo) {
      return false;
    }

    definirTrancadasLiberadas(true);
    inserirAbaTrancadas();
    busca.value = "";
    definirFiltro("");
    ativarAba("trancadas");
    limparSelecaoConversa("Selecione uma conversa trancada");
    atualizarContadores();
    renderConversas();

    return true;
  }

  function obterPrimeiraConversaNormal() {
    return (
      Object.values(conversas)
        .filter(
          (conversa) =>
            conversa &&
            !ehConversaTecnica(conversa) &&
            !conversa.trancada &&
            !conversa.arquivada,
        )
        .sort((a, b) => {
          const ultimaA =
            obterUltimaMensagemCronologica(a)?.timestamp || a.timestamp || 0;
          const ultimaB =
            obterUltimaMensagemCronologica(b)?.timestamp || b.timestamp || 0;

          return ultimaB - ultimaA;
        })[0] || null
    );
  }

  function limparTextoCompositorAoSairDasTrancadas() {
    const campoMensagem = document.getElementById("campoMensagem");

    if (!campoMensagem) {
      return;
    }

    campoMensagem.value = "";
    campoMensagem.dispatchEvent(new window.Event("input", { bubbles: true }));
  }

  function sairDasTrancadasPorEscape() {
    if (obterAbaAtual() !== "trancadas") {
      return false;
    }

    const conversaAberta = conversas[obterConversaAtual()];
    const conversaTrancadaAberta = !!conversaAberta?.trancada;

    limparTextoCompositorAoSairDasTrancadas();
    bloquearTrancadas();
    ativarAba("conversas");
    renderConversas();

    if (conversaTrancadaAberta) {
      const primeiraNormal = obterPrimeiraConversaNormal();

      if (primeiraNormal) {
        abrirConversa(primeiraNormal.id);
      } else {
        limparSelecaoConversa("Selecione uma conversa");
      }
    }

    return true;
  }

  function recalcularNaoLidasGlobal() {
    totalNaoLidasGlobal = Object.values(conversas).reduce((total, conversa) => {
      if (conversa.trancada) {
        return total;
      }

      return total + (Number(conversa.naoLidasLocal || 0) || 0);
    }, 0);

    document.title =
      totalNaoLidasGlobal > 0
        ? `(${totalNaoLidasGlobal}) WhatsIAPP`
        : "WhatsIAPP";
  }

  function marcarConversaComoLidaLocal(conversa) {
    if (!conversa) {
      return;
    }

    conversa.naoLidasLocal = 0;
    persistirNaoLidasConversa(conversa);
    recalcularNaoLidasGlobal();
    atualizarContadores();
  }

  async function desarquivarAutomaticamentePorMensagem(
    conversaId,
    tentativa = 1,
  ) {
    if (!conversaId) {
      return;
    }

    if (desarquivamentosAutomaticosEmAndamento.has(conversaId)) {
      return;
    }

    desarquivamentosAutomaticosEmAndamento.add(conversaId);

    try {
      const resultado = await ipcRenderer.invoke("arquivar-conversa", {
        conversaId,
        arquivar: false,
      });

      if (!resultado?.ok) {
        throw new Error(resultado?.erro || "Auto unarchive failed.");
      }

      const conversa = conversas[conversaId];

      if (conversa && !conversa.trancada) {
        conversa.arquivada = false;
      }
    } catch (erro) {
      console.warn("Auto unarchive failed:", erro?.message || erro);

      if (tentativa < 2) {
        setTimeout(() => {
          desarquivarAutomaticamentePorMensagem(conversaId, tentativa + 1);
        }, 2000);
      }
    } finally {
      desarquivamentosAutomaticosEmAndamento.delete(conversaId);
    }
  }

  function incrementarNaoLidaLocal(conversa) {
    if (!conversa) {
      return;
    }

    conversa.naoLidasLocal = (Number(conversa.naoLidasLocal || 0) || 0) + 1;
    persistirNaoLidasConversa(conversa);
    recalcularNaoLidasGlobal();
    atualizarContadores();
  }

  function criarBadgeNaoLidas(conversa) {
    const total = Number(conversa?.naoLidasLocal || 0) || 0;

    if (total <= 0) {
      return null;
    }

    const badge = document.createElement("div");
    badge.textContent = total > 99 ? "99+" : String(total);

    Object.assign(badge.style, {
      marginLeft: "auto",
      minWidth: "20px",
      height: "20px",
      padding: "0 6px",
      borderRadius: "999px",
      background: "#20b35b",
      color: "#07120b",
      fontSize: "11px",
      fontWeight: "800",
      lineHeight: "20px",
      textAlign: "center",
      boxSizing: "border-box",
      flex: "0 0 auto",
    });

    return badge;
  }

  function atualizarContadores() {
    contadorArquivadas.textContent = "";

    const totalNaoLidas = Object.values(conversas).reduce((total, conversa) => {
      if (
        ehConversaTecnica(conversa) ||
        conversa.trancada ||
        conversa.arquivada
      ) {
        return total;
      }

      return total + (Number(conversa.naoLidasLocal || 0) || 0);
    }, 0);

    if (contadorNaoLidas) {
      contadorNaoLidas.textContent =
        totalNaoLidas > 0
          ? totalNaoLidas > 99
            ? "99+"
            : String(totalNaoLidas)
          : "";
    }

    const totalTrancadas = Object.values(conversas).filter(
      (conversa) => !ehConversaTecnica(conversa) && conversa.trancada,
    ).length;

    contadorTrancadas.textContent =
      totalTrancadas > 0 ? `(${totalTrancadas})` : "";

    const totalFavoritos = totalFavoritosVisiveis();

    contadorFavoritos.textContent =
      totalFavoritos > 0 ? `(${totalFavoritos})` : "";
  }

  function configurarNavegacao() {
    if (navegacaoConfigurada) {
      return;
    }
    navegacaoConfigurada = true;

    busca.addEventListener("input", () => {
      const valorBruto = busca.value.trim();

      clearTimeout(timerLiberarTrancadas);
      timerLiberarTrancadas = null;

      if (!obterTrancadasLiberadas() && valorBruto) {
        timerLiberarTrancadas = setTimeout(() => {
          timerLiberarTrancadas = null;

          const valorAtual = busca.value.trim();

          if (
            obterTrancadasLiberadas() ||
            valorAtual !== valorBruto ||
            !valorAtual
          ) {
            return;
          }

          tentarLiberarTrancadas(valorAtual);
        }, 1000);
      }

      definirFiltro(normalizarTextoBusca(valorBruto));
      clearTimeout(timerBuscaConversasMensagens);

      timerBuscaConversasMensagens = setTimeout(() => {
        renderConversas();
      }, 90);
    });

    abaConversas.addEventListener("click", () => {
      bloquearTrancadas();
      ativarAba("conversas");
      limparSelecaoConversa("Selecione uma conversa");
      renderConversas();
    });

    abaNaoLidas?.addEventListener("click", () => {
      bloquearTrancadas();
      ativarAba("nao-lidas");
      limparSelecaoConversa("Selecione uma conversa não lida");
      renderConversas();
    });

    abaGrupos?.addEventListener("click", async () => {
      bloquearTrancadas();
      ativarAba("grupos");
      limparSelecaoConversa("Selecione um grupo");
      listaConversas.innerHTML =
        '<div class="vazio-lista">Carregando grupos...</div>';

      await carregarGruposAtuaisWhatsapp();
      renderConversas();
    });

    abaArquivadas.addEventListener("click", () => {
      bloquearTrancadas();
      ativarAba("arquivadas");
      limparSelecaoConversa("Selecione uma conversa arquivada");
      renderConversas();
    });

    abaFavoritos.addEventListener("click", () => {
      bloquearTrancadas();
      ativarAba("favoritos");
      limparSelecaoConversa("Selecione uma mensagem favorita");
      renderConversas();
    });

    abaTrancadas?.addEventListener("click", () => {
      if (!obterTrancadasLiberadas() || !abaTrancadasInserida) {
        return;
      }

      ativarAba("trancadas");
      limparSelecaoConversa("Selecione uma conversa trancada");
      renderConversas();
    });

    abaMais?.addEventListener("click", () => {
      abrirPainelNovaConversa();
    });

    btnRailConversas?.addEventListener("click", () => {
      abaConversas.click();
    });

    btnRailArquivadas?.addEventListener("click", () => {
      abaArquivadas.click();
    });

    btnRailFavoritos?.addEventListener("click", () => {
      abaFavoritos.click();
    });

    btnRailConfig?.addEventListener("click", () => {
      botaoPerfilApp.click();
    });

    btnMenuConversas?.addEventListener("click", () => {
      abrirPainelNovaConversa();
    });

    document.addEventListener("keydown", (evento) => {
      if (evento.key !== "Escape" || obterAbaAtual() !== "trancadas") {
        return;
      }

      evento.preventDefault();
      sairDasTrancadasPorEscape();
    });
  }

  function configurarFoco() {
    if (focoConfigurado) {
      return;
    }
    focoConfigurado = true;

    window.addEventListener("focus", () => {
      const conversa = conversas[obterConversaAtual()];

      if (conversa) {
        marcarConversaComoLidaLocal(conversa);
        marcarConversaComoLidaWhatsapp(conversa);
        renderConversas();
      }
    });
  }

  function criarItemConversa(conversa) {
    const conversaAtual = obterConversaAtual();
    const ultima = obterUltimaMensagemCronologica(conversa);

    const item = document.createElement("div");
    item.className =
      "conversa" + (conversa.id === conversaAtual ? " ativa" : "");

    if (Number(conversa?.naoLidasLocal || 0) > 0) {
      item.classList.add("conversa-nao-lida");
    }

    const avatar = criarAvatarContato(conversa, 42);

    const blocoTexto = document.createElement("div");
    blocoTexto.className = "conversa-conteudo";

    const linhaTopo = document.createElement("div");
    linhaTopo.className = "conversa-linha-topo";

    const nome = document.createElement("div");
    nome.className = "conversa-nome";
    nome.textContent = conversa.nome || conversa.id;

    const horario = document.createElement("div");
    horario.className = "conversa-horario";
    horario.textContent = textoHorarioListaConversa(conversa, ultima);

    linhaTopo.appendChild(nome);
    linhaTopo.appendChild(horario);

    const linhaPreview = document.createElement("div");
    linhaPreview.className = "conversa-linha-preview";

    const preview = document.createElement("div");
    preview.className = "conversa-preview";
    preview.textContent = descricaoPreview(ultima);

    const badgeNaoLidas = criarBadgeNaoLidas(conversa);

    linhaPreview.appendChild(preview);

    if (badgeNaoLidas) {
      badgeNaoLidas.classList.add("conversa-badge-nao-lidas");
      linhaPreview.appendChild(badgeNaoLidas);
    }

    blocoTexto.appendChild(linhaTopo);
    blocoTexto.appendChild(linhaPreview);

    item.dataset.conversaId = conversa.id;

    avatar.title = "Ver perfil";
    avatar.style.cursor = "pointer";

    avatar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      abrirPerfilContato(conversa);
    });

    item.appendChild(avatar);
    item.appendChild(blocoTexto);

    item.addEventListener("click", () => abrirConversa(conversa.id));

    item.addEventListener("contextmenu", (evento) =>
      abrirMenuContexto(evento, conversa),
    );

    return item;
  }

  function anexarLoteConversas(lista, inicio, fim, versao, substituir = false) {
    if (versao !== versaoRenderConversas) {
      return;
    }

    const fragmento = document.createDocumentFragment();
    const observar = [];

    for (let i = inicio; i < fim; i += 1) {
      const conversa = lista[i];

      if (!conversa) {
        continue;
      }

      const item = criarItemConversa(conversa);

      fragmento.appendChild(item);

      if (!conversa.fotoPerfilUrl && !conversa.fotoPerfilTentada) {
        observar.push(item);
      }
    }

    if (versao !== versaoRenderConversas) {
      return;
    }

    if (substituir) {
      listaConversas.replaceChildren(fragmento);
    } else {
      listaConversas.appendChild(fragmento);
    }

    const observador = obterObservadorAvatares();

    for (const item of observar) {
      observador.observe(item);
    }

    if (inicio === 0) {
      const limitePrioridade = Math.min(fim, 12);

      for (let i = 0; i < limitePrioridade; i += 1) {
        enfileirarFotoPerfil(lista[i], true);
      }
    }
  }

  function conversaPermitidaNaBusca(conversa) {
    const abaAtual = obterAbaAtual();
    const trancadasLiberadas = obterTrancadasLiberadas();

    if (!conversa || ehConversaTecnica(conversa)) {
      return false;
    }

    // A busca normal e global: Conversas, Arquivadas e Favoritos pesquisam
    // juntas em todas as conversas nao trancadas.
    //
    // A area Trancadas continua isolada por privacidade e, quando liberada,
    // pesquisa somente dentro das conversas trancadas.
    if (abaAtual === "trancadas") {
      return trancadasLiberadas && !!conversa.trancada;
    }

    return !conversa.trancada;
  }

  function termosBuscaMensagem(msg) {
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      return "";
    }

    const tipo = String(msg.tipo || "").toLowerCase();
    const rotulos = {
      imagem: "foto imagem",
      video: "video",
      audio: "audio voz gravacao",
      sticker: "figurinha sticker",
      documento: "documento arquivo",
      localizacao: "localizacao endereco mapa",
      contato: "contato",
      view_once: "visualizacao unica reproducao unica",
      texto: "texto mensagem",
    };

    return normalizarTextoBusca(
      [msg.texto || "", msg.fileName || "", rotulos[tipo] || tipo].join(" "),
    );
  }

  function previewResultadoBuscaMensagem(msg) {
    const texto = String(msg?.texto || "")
      .replace(/\s+/g, " ")
      .trim();

    if (texto) {
      return texto.length > 180 ? `${texto.slice(0, 177)}...` : texto;
    }

    return descricaoCurtaMensagemResposta(msg);
  }

  function resultadosBuscaMensagens() {
    const termo = normalizarTextoBusca(obterFiltro());

    if (!termo) {
      return {
        conversas: [],
        mensagens: [],
        totalMensagens: 0,
      };
    }

    const conversasPermitidas = Object.values(conversas)
      .filter(conversaPermitidaNaBusca)
      .sort((a, b) => {
        const ultimaA = a.mensagens?.at?.(-1)?.timestamp || a.timestamp || 0;
        const ultimaB = b.mensagens?.at?.(-1)?.timestamp || b.timestamp || 0;
        return ultimaB - ultimaA;
      });

    const conversasEncontradas = [];
    const mensagensEncontradas = [];
    let totalMensagens = 0;

    for (const conversa of conversasPermitidas) {
      const nome = normalizarTextoBusca(conversa.nome || "");
      const numero = normalizarTextoBusca(conversa.id || "");

      if (nome.includes(termo) || numero.includes(termo)) {
        conversasEncontradas.push(conversa);
      }

      const listaMensagens = Array.isArray(conversa.mensagens)
        ? conversa.mensagens
        : [];

      for (let i = listaMensagens.length - 1; i >= 0; i -= 1) {
        const msg = listaMensagens[i];

        if (!msg?.idMensagem || !termosBuscaMensagem(msg).includes(termo)) {
          continue;
        }

        totalMensagens += 1;

        // Mantem a interface leve mesmo em buscas muito amplas.
        if (mensagensEncontradas.length < 600) {
          mensagensEncontradas.push({
            conversa,
            msg,
          });
        }
      }
    }

    mensagensEncontradas.sort((a, b) => {
      const tempoA = Number(a?.msg?.timestamp || 0) || 0;
      const tempoB = Number(b?.msg?.timestamp || 0) || 0;
      return tempoB - tempoA;
    });

    return {
      conversas: conversasEncontradas.slice(0, 40),
      mensagens: mensagensEncontradas.slice(0, 250),
      totalMensagens,
    };
  }

  function abrirResultadoBuscaMensagem(conversaId, idMensagem) {
    const conversa = conversas[conversaId];

    if (!conversa || (conversa.trancada && !obterTrancadasLiberadas())) {
      return;
    }

    abrirConversa(conversa.id);
    cancelarFixacaoFimConversa();

    const localizarEDestacar = () => {
      if (obterConversaAtual() !== conversa.id) {
        return false;
      }

      const item = localizarMensagemNaTela(idMensagem);

      if (!item) {
        return false;
      }

      destacarMensagemRespondida(idMensagem);
      return true;
    };

    window.requestAnimationFrame(() => {
      if (!localizarEDestacar()) {
        setTimeout(localizarEDestacar, 80);
      }

      // Midias podem alterar a altura do historico logo apos a abertura.
      setTimeout(localizarEDestacar, 360);
    });
  }

  function criarTituloSecaoBusca(texto, quantidade) {
    const titulo = document.createElement("div");
    titulo.className = "resultado-busca-secao";

    const nome = document.createElement("span");
    nome.textContent = texto;

    const total = document.createElement("span");
    total.className = "resultado-busca-contagem";
    total.textContent = String(quantidade || 0);

    titulo.appendChild(nome);
    titulo.appendChild(total);

    return titulo;
  }

  function criarItemResultadoMensagem(conversa, msg) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "resultado-busca-mensagem";

    const topo = document.createElement("div");
    topo.className = "resultado-busca-topo";

    const nome = document.createElement("span");
    nome.className = "resultado-busca-nome";
    nome.textContent = conversa.nome || conversa.id;

    const horario = document.createElement("span");
    horario.className = "resultado-busca-horario";
    horario.textContent = String(msg.horario || "");

    topo.appendChild(nome);
    topo.appendChild(horario);

    const preview = document.createElement("div");
    preview.className = "resultado-busca-preview";
    preview.textContent = previewResultadoBuscaMensagem(msg);

    const meta = document.createElement("div");
    meta.className = "resultado-busca-meta";
    meta.textContent = msg.minha ? "Você" : "Contato";

    item.appendChild(topo);
    item.appendChild(preview);
    item.appendChild(meta);

    item.addEventListener("click", () => {
      abrirResultadoBuscaMensagem(conversa.id, msg.idMensagem);
    });

    return item;
  }

  function renderResultadosBusca() {
    const resultados = resultadosBuscaMensagens();
    const fragmento = document.createDocumentFragment();

    if (resultados.conversas.length) {
      fragmento.appendChild(
        criarTituloSecaoBusca("Conversas", resultados.conversas.length),
      );

      for (const conversa of resultados.conversas) {
        const item = criarItemConversa(conversa);
        item.classList.add("resultado-busca-conversa");
        fragmento.appendChild(item);
      }
    }

    if (resultados.mensagens.length) {
      fragmento.appendChild(
        criarTituloSecaoBusca("Mensagens", resultados.totalMensagens),
      );

      for (const resultado of resultados.mensagens) {
        fragmento.appendChild(
          criarItemResultadoMensagem(resultado.conversa, resultado.msg),
        );
      }

      if (resultados.totalMensagens > resultados.mensagens.length) {
        const limite = document.createElement("div");
        limite.className = "resultado-busca-limite";
        limite.textContent = `Mostrando as ${resultados.mensagens.length} mensagens mais recentes.`;
        fragmento.appendChild(limite);
      }
    }

    if (!resultados.conversas.length && !resultados.mensagens.length) {
      const vazio = document.createElement("div");
      vazio.className = "vazio-lista";
      vazio.textContent = "Nenhuma conversa ou mensagem encontrada";
      fragmento.appendChild(vazio);
    }

    listaConversas.replaceChildren(fragmento);
  }

  function renderConversas() {
    const versao = ++versaoRenderConversas;
    const filtro = String(obterFiltro() || "");
    const abaAtual = obterAbaAtual();

    // Quando existe texto na busca, ela tem prioridade sobre a aba visual.
    // Assim Conversas, Arquivadas e Favoritos usam a mesma busca global.
    // Trancadas permanece isolada pela regra de conversaPermitidaNaBusca().
    if (filtro) {
      renderResultadosBusca();
      return;
    }

    if (abaAtual === "favoritos") {
      renderFavoritos();
      return;
    }

    const lista = Object.values(conversas)
      .filter((conversa) => {
        if (ehConversaTecnica(conversa)) {
          return false;
        }

        if (conversa.trancada && abaAtual !== "trancadas") {
          return false;
        }

        if (abaAtual === "trancadas" && !conversa.trancada) {
          return false;
        }

        if (
          ["conversas", "nao-lidas"].includes(abaAtual) &&
          conversa.arquivada
        ) {
          return false;
        }

        if (
          abaAtual === "nao-lidas" &&
          Number(conversa.naoLidasLocal || 0) <= 0
        ) {
          return false;
        }

        if (abaAtual === "grupos") {
          if (!ehConversaGrupo(conversa)) {
            return false;
          }

          if (
            obterGruposAtuaisWhatsappCarregados() &&
            !idsGruposAtuaisWhatsapp.has(String(conversa.id || ""))
          ) {
            return false;
          }
        }

        if (
          abaAtual === "arquivadas" &&
          (!conversa.arquivada || conversa.trancada)
        ) {
          return false;
        }

        if (filtro) {
          const nome = String(conversa.nome || "").toLowerCase();
          const numero = String(conversa.id || "").toLowerCase();

          if (!nome.includes(filtro) && !numero.includes(filtro)) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const ultimaA =
          obterUltimaMensagemCronologica(a)?.timestamp || a.timestamp || 0;
        const ultimaB =
          obterUltimaMensagemCronologica(b)?.timestamp || b.timestamp || 0;

        return ultimaB - ultimaA;
      });

    if (!lista.length) {
      const vazio = document.createElement("div");
      vazio.className = "vazio-lista";

      vazio.textContent =
        abaAtual === "arquivadas"
          ? "Nenhuma conversa arquivada"
          : abaAtual === "trancadas"
            ? "Nenhuma conversa trancada"
            : abaAtual === "nao-lidas"
              ? "Nenhuma conversa não lida"
              : abaAtual === "grupos"
                ? "Nenhum grupo encontrado"
                : "Nenhuma conversa encontrada";

      listaConversas.replaceChildren(vazio);
      return;
    }

    const primeiroLote = Math.min(lista.length, 60);

    anexarLoteConversas(lista, 0, primeiroLote, versao, true);

    let indice = primeiroLote;
    const tamanhoLote = 80;

    function continuarMontagem() {
      if (versao !== versaoRenderConversas || indice >= lista.length) {
        return;
      }

      const fimLote = Math.min(indice + tamanhoLote, lista.length);

      anexarLoteConversas(lista, indice, fimLote, versao, false);

      indice = fimLote;

      if (indice < lista.length) {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(continuarMontagem, {
            timeout: 80,
          });
        } else {
          setTimeout(continuarMontagem, 0);
        }
      }
    }

    if (indice < lista.length) {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(continuarMontagem, {
          timeout: 80,
        });
      } else {
        setTimeout(continuarMontagem, 0);
      }
    }
  }

  return {
    configurarNavegacao,
    configurarFoco,
    bloquearTrancadas,
    ativarAba,
    recalcularNaoLidasGlobal,
    marcarConversaComoLidaLocal,
    incrementarNaoLidaLocal,
    desarquivarAutomaticamentePorMensagem,
    atualizarContadores,
    animarConversaParaAba,
    animarTrancamentoConversa,
    renderConversas,
  };
}

module.exports = {
  criarPersistenciaNaoLidas,
  criarModuloListaConversas,
};
