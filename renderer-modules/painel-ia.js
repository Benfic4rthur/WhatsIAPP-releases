function criarModuloPainelIA(deps = {}) {
  const {
    ipcRenderer,
    document,
    window,
    localStorage,
    conversas,
    obterConversaAtual,
    obterModoIAAtual,
    definirModoIAAtual,
    diagnosticoSegundoPlanoIA,
    cancelarSugestaoIAEmAndamento,
    cancelarRespostaAutomaticaIAEmAndamento,
    limparRespostaAutomaticaPendente,
    tentarAgendarRespostaAutomaticaPendente,
    agendarSugestaoIA,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
  } = deps;

  const respostaIA = document.getElementById("respostaIA");
  const btnEditarIA = document.getElementById("btnEditar");
  const btnEnviarIA = document.getElementById("btnEnviar");
  const btnIgnorarIA = document.getElementById("btnIgnorar");
  const botoesModoIA = Array.from(
    document.querySelectorAll(".modo[data-modo]"),
  );
  const CHAVE_MODOS_IA_CONVERSAS = "whatsiapp.ia.modosPorConversa.v1";
  const CHAVE_SEGUNDO_PLANO_IA_CONVERSAS =
    "whatsiapp.ia.segundoPlanoPorConversa.v1";
  const sugestoesIAPorConversa = new Map();

  let botaoSegundoPlanoIA = null;
  let conversaSugestaoExibida = null;
  let idBaseSugestaoExibida = null;
  let tipoSugestaoIASelecionada = "neutra";
  let editandoSugestaoIA = false;
  let eventosPainelInicializados = false;
  let controleSegundoPlanoInicializado = false;

  function normalizarModoIA(valor) {
    const modo = String(valor || "").trim();
    return ["manual", "assistido", "automatico"].includes(modo)
      ? modo
      : "manual";
  }

  function garantirStatusCompactoIA() {
    let statusCompacto = document.getElementById("statusIACompacto");
    if (statusCompacto?.isConnected) {
      return statusCompacto;
    }

    const chat = document.querySelector(".chat");
    if (!chat) {
      return null;
    }

    statusCompacto = document.createElement("div");
    statusCompacto.id = "statusIACompacto";
    statusCompacto.className = "ia-status-compacto";
    statusCompacto.setAttribute("aria-live", "polite");
    chat.appendChild(statusCompacto);
    return statusCompacto;
  }

  function obterEstadoVisualIA() {
    const conversaAtual = String(obterConversaAtual?.() || "").trim();
    const temConversa = !!conversaAtual && !!conversas?.[conversaAtual];
    const modo = temConversa
      ? normalizarModoIA(
          obterModoIAAtual?.() || obterModoIAConversa(conversaAtual),
        )
      : "manual";

    return {
      conversaAtual,
      temConversa,
      modo,
    };
  }

  function textoPadraoStatusCompactoIA() {
    const { conversaAtual, temConversa, modo } = obterEstadoVisualIA();

    if (!temConversa) {
      return "";
    }

    if (modo === "manual") {
      return "Modo Manual";
    }

    if (modo === "automatico") {
      return `Automático • Segundo plano ${
        obterSegundoPlanoIAConversa(conversaAtual) ? "ON" : "OFF"
      }`;
    }

    return "";
  }

  function resumirTextoStatusCompactoIA(texto) {
    const valor = String(texto || "").trim();

    if (!valor) {
      return textoPadraoStatusCompactoIA();
    }

    if (/^Modo Manual ativo/i.test(valor)) {
      return "Modo Manual";
    }

    if (/^Modo Automático ativo/i.test(valor)) {
      if (/aguardando/i.test(valor)) {
        return "Automático • Aguardando mensagem";
      }
      return textoPadraoStatusCompactoIA();
    }

    if (/^Mensagem (recebida|não lida encontrada)/i.test(valor)) {
      return "Automático • Resposta agendada";
    }

    if (/^Automático ativo\. Analisando/i.test(valor)) {
      return "Automático • Analisando e preparando resposta...";
    }

    if (/^Resposta automática enviada/i.test(valor)) {
      return "Automático • Resposta enviada";
    }

    if (/^Áudio transcrito\. Pensando na resposta automática/i.test(valor)) {
      return "Áudio transcrito • Pensando na resposta...";
    }

    return valor;
  }

  function atualizarStatusCompactoIA(texto = "", classe = "") {
    const statusCompacto = garantirStatusCompactoIA();
    if (!statusCompacto) {
      return;
    }

    const { temConversa, modo } = obterEstadoVisualIA();

    statusCompacto.classList.remove("ia-gerando", "ia-erro");

    if (!temConversa || modo === "assistido") {
      statusCompacto.textContent = "";
      return;
    }

    const textoFinal = resumirTextoStatusCompactoIA(texto);
    statusCompacto.textContent = textoFinal;

    if (classe === "ia-erro") {
      statusCompacto.classList.add("ia-erro");
    }

    if (
      /transcrevendo|pensando|analisando|pesquisando|preparando|enviando/i.test(
        textoFinal,
      )
    ) {
      statusCompacto.classList.add("ia-gerando");
    }
  }

  function atualizarEstadoVisualIA() {
    const body = document.body;
    if (!body) {
      return;
    }

    const { temConversa, modo } = obterEstadoVisualIA();

    body.classList.toggle("whatsiapp-conversa-ativa", temConversa);
    body.classList.toggle("whatsiapp-sem-conversa", !temConversa);
    body.classList.toggle(
      "whatsiapp-modo-manual",
      temConversa && modo === "manual",
    );
    body.classList.toggle(
      "whatsiapp-modo-assistido",
      temConversa && modo === "assistido",
    );
    body.classList.toggle(
      "whatsiapp-modo-automatico",
      temConversa && modo === "automatico",
    );
    body.classList.toggle(
      "whatsiapp-ia-lateral-aberta",
      temConversa && modo === "assistido",
    );

    atualizarStatusCompactoIA();
  }

  function carregarModosIAConversa() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_MODOS_IA_CONVERSAS) || "{}",
      );
      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  function carregarSegundoPlanoIAConversa() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_SEGUNDO_PLANO_IA_CONVERSAS) || "{}",
      );
      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const modosIAPorConversa = carregarModosIAConversa();
  const segundoPlanoIAPorConversa = carregarSegundoPlanoIAConversa();

  function salvarSegundoPlanoIAConversaPersistido() {
    try {
      localStorage.setItem(
        CHAVE_SEGUNDO_PLANO_IA_CONVERSAS,
        JSON.stringify(segundoPlanoIAPorConversa),
      );
    } catch {}
  }

  function obterSegundoPlanoIAConversa(conversaId) {
    const id = String(conversaId || "").trim();
    if (!id) {
      return false;
    }
    return segundoPlanoIAPorConversa[id] === true;
  }

  function salvarSegundoPlanoIAConversa(conversaId, ativo) {
    const id = String(conversaId || "").trim();
    if (!id) {
      return false;
    }
    if (ativo) {
      segundoPlanoIAPorConversa[id] = true;
    } else {
      delete segundoPlanoIAPorConversa[id];
    }
    salvarSegundoPlanoIAConversaPersistido();
    return !!ativo;
  }

  function salvarModosIAConversa() {
    try {
      localStorage.setItem(
        CHAVE_MODOS_IA_CONVERSAS,
        JSON.stringify(modosIAPorConversa),
      );
    } catch {}
  }

  function obterModoIAConversa(conversaId) {
    const id = String(conversaId || "").trim();
    if (!id) {
      return "manual";
    }
    return normalizarModoIA(modosIAPorConversa[id] || "manual");
  }

  function salvarModoIAConversa(conversaId, modo) {
    const id = String(conversaId || "").trim();
    if (!id) {
      return "manual";
    }
    const normalizado = normalizarModoIA(modo);
    if (normalizado === "manual") {
      delete modosIAPorConversa[id];
    } else {
      modosIAPorConversa[id] = normalizado;
    }
    salvarModosIAConversa();
    return normalizado;
  }

  function obterSugestaoIACache(conversaId) {
    return sugestoesIAPorConversa.get(String(conversaId || "").trim());
  }

  function salvarSugestaoIACache(conversaId, dados) {
    const id = String(conversaId || "").trim();
    if (!id) return dados;
    sugestoesIAPorConversa.set(id, dados);
    return dados;
  }

  function limparSugestaoIACache(conversaId) {
    const id = String(conversaId || "").trim();
    if (!id) return false;
    return sugestoesIAPorConversa.delete(id);
  }

  function definirContextoSugestaoIA(conversaId, baseId) {
    conversaSugestaoExibida = conversaId || null;
    idBaseSugestaoExibida = baseId || null;
  }

  function definirBotoesIAHabilitados(habilitados) {
    if (btnEditarIA) btnEditarIA.disabled = !habilitados;
    if (btnEnviarIA) btnEnviarIA.disabled = !habilitados;
    if (btnIgnorarIA) btnIgnorarIA.disabled = !habilitados;
  }

  function mostrarEstadoPainelIA(texto, classe = "") {
    atualizarEstadoVisualIA();
    atualizarStatusCompactoIA(texto, classe);

    if (!respostaIA) {
      return;
    }
    editandoSugestaoIA = false;
    respostaIA.contentEditable = "false";
    respostaIA.classList.remove(
      "ia-gerando",
      "ia-editando",
      "ia-erro",
      "ia-com-opcoes",
    );
    if (classe) {
      respostaIA.classList.add(classe);
    }
    respostaIA.textContent = texto;
    respostaIA.dataset.estado = classe === "ia-erro" ? "erro" : "status";
    if (btnEditarIA) {
      btnEditarIA.textContent = "Editar";
    }
    definirBotoesIAHabilitados(false);
  }

  function definirGerandoPainelIA(gerando) {
    respostaIA?.classList.toggle("ia-gerando", !!gerando);

    const statusCompacto = garantirStatusCompactoIA();
    const { temConversa, modo } = obterEstadoVisualIA();
    statusCompacto?.classList.toggle(
      "ia-gerando",
      !!gerando && temConversa && modo !== "assistido",
    );
  }

  function normalizarSugestoesIA(valor) {
    const origem = valor && typeof valor === "object" ? valor : {};
    return {
      positiva: String(origem.positiva || "").trim(),
      neutra: String(origem.neutra || "").trim(),
      negativa: String(origem.negativa || "").trim(),
    };
  }

  function sugestoesIACompletas(sugestoes) {
    return !!(sugestoes?.positiva && sugestoes?.neutra && sugestoes?.negativa);
  }

  function obterElementoOpcaoIA(tipo) {
    if (!respostaIA) {
      return null;
    }
    return respostaIA.querySelector(
      `.ia-opcao[data-tipo="${String(tipo || "")}"]`,
    );
  }

  function obterElementoTextoOpcaoIA(tipo = tipoSugestaoIASelecionada) {
    return obterElementoOpcaoIA(tipo)?.querySelector(".ia-opcao-texto") || null;
  }

  function obterTextoSugestaoIASelecionada() {
    const elemento = obterElementoTextoOpcaoIA();
    return String(elemento?.innerText || elemento?.textContent || "").trim();
  }

  function salvarSelecaoSugestaoIACache() {
    if (!conversaSugestaoExibida || !idBaseSugestaoExibida) {
      return;
    }
    const cache = sugestoesIAPorConversa.get(conversaSugestaoExibida);
    if (!cache || cache.baseId !== idBaseSugestaoExibida) {
      return;
    }
    cache.selecionada = tipoSugestaoIASelecionada;
    sugestoesIAPorConversa.set(conversaSugestaoExibida, cache);
  }

  function finalizarEdicaoSugestaoIA() {
    if (!editandoSugestaoIA) {
      return;
    }
    const elementoOpcao = obterElementoOpcaoIA(tipoSugestaoIASelecionada);
    const elementoTexto = obterElementoTextoOpcaoIA(tipoSugestaoIASelecionada);
    if (elementoTexto) {
      const texto = String(
        elementoTexto.innerText || elementoTexto.textContent || "",
      ).trim();
      elementoTexto.contentEditable = "false";
      elementoTexto.textContent = texto;
      const cache = conversaSugestaoExibida
        ? sugestoesIAPorConversa.get(conversaSugestaoExibida)
        : null;
      if (cache && cache.baseId === idBaseSugestaoExibida) {
        if (cache.modoResposta === "unica") {
          cache.resposta = texto;
        } else if (cache.sugestoes) {
          cache.sugestoes[tipoSugestaoIASelecionada] = texto;
          cache.selecionada = tipoSugestaoIASelecionada;
        }
        sugestoesIAPorConversa.set(conversaSugestaoExibida, cache);
      }
    }
    elementoOpcao?.classList.remove("ia-editando");
    editandoSugestaoIA = false;
    if (btnEditarIA) {
      btnEditarIA.textContent = "Editar";
    }
    definirBotoesIAHabilitados(!!obterTextoSugestaoIASelecionada());
  }

  function selecionarOpcaoIA(tipo) {
    if (!respostaIA || respostaIA.dataset.estado !== "pronta") {
      return;
    }
    if (!["positiva", "neutra", "negativa"].includes(tipo)) {
      return;
    }
    if (editandoSugestaoIA) {
      finalizarEdicaoSugestaoIA();
    }
    tipoSugestaoIASelecionada = tipo;
    for (const item of respostaIA.querySelectorAll(".ia-opcao")) {
      item.classList.toggle("selecionada", item.dataset.tipo === tipo);
    }
    salvarSelecaoSugestaoIACache();
    definirBotoesIAHabilitados(!!obterTextoSugestaoIASelecionada());
  }

  function exibirSugestoesIA(
    conversaId,
    baseId,
    sugestoesOriginais,
    selecionada = "neutra",
  ) {
    if (!respostaIA) {
      return;
    }
    const sugestoes = normalizarSugestoesIA(sugestoesOriginais);
    if (!sugestoesIACompletas(sugestoes)) {
      mostrarEstadoPainelIA(
        "A IA não retornou as três opções de resposta.",
        "ia-erro",
      );
      return;
    }
    conversaSugestaoExibida = conversaId;
    idBaseSugestaoExibida = baseId;
    tipoSugestaoIASelecionada = ["positiva", "neutra", "negativa"].includes(
      selecionada,
    )
      ? selecionada
      : "neutra";
    editandoSugestaoIA = false;
    respostaIA.classList.remove("ia-gerando", "ia-editando", "ia-erro");
    respostaIA.classList.add("ia-com-opcoes");
    respostaIA.contentEditable = "false";
    respostaIA.innerHTML = "";
    respostaIA.dataset.estado = "pronta";
    const definicoes = [
      ["positiva", "Positiva"],
      ["neutra", "Neutra"],
      ["negativa", "Negativa"],
    ];
    for (const [tipo, rotulo] of definicoes) {
      const opcao = document.createElement("div");
      opcao.className = "ia-opcao";
      opcao.dataset.tipo = tipo;
      const label = document.createElement("div");
      label.className = "ia-opcao-label";
      label.textContent = rotulo;
      const texto = document.createElement("div");
      texto.className = "ia-opcao-texto";
      texto.textContent = sugestoes[tipo];
      opcao.appendChild(label);
      opcao.appendChild(texto);
      opcao.addEventListener("click", (evento) => {
        if (evento.target?.isContentEditable) {
          return;
        }
        selecionarOpcaoIA(tipo);
      });
      respostaIA.appendChild(opcao);
    }
    selecionarOpcaoIA(tipoSugestaoIASelecionada);
    if (btnEditarIA) {
      btnEditarIA.textContent = "Editar";
    }
  }

  function exibirRespostaUnicaIA(conversaId, baseId, respostaOriginal) {
    if (!respostaIA) {
      return;
    }
    const resposta = String(respostaOriginal || "").trim();
    if (!resposta) {
      mostrarEstadoPainelIA("A IA não retornou uma resposta.", "ia-erro");
      return;
    }
    conversaSugestaoExibida = conversaId;
    idBaseSugestaoExibida = baseId;
    tipoSugestaoIASelecionada = "neutra";
    editandoSugestaoIA = false;
    respostaIA.classList.remove("ia-gerando", "ia-editando", "ia-erro");
    respostaIA.classList.add("ia-com-opcoes");
    respostaIA.contentEditable = "false";
    respostaIA.innerHTML = "";
    respostaIA.dataset.estado = "pronta";
    const opcao = document.createElement("div");
    opcao.className = "ia-opcao selecionada";
    opcao.dataset.tipo = "neutra";
    const label = document.createElement("div");
    label.className = "ia-opcao-label";
    label.textContent = "Resposta";
    const texto = document.createElement("div");
    texto.className = "ia-opcao-texto";
    texto.textContent = resposta;
    opcao.appendChild(label);
    opcao.appendChild(texto);
    respostaIA.appendChild(opcao);
    if (btnEditarIA) {
      btnEditarIA.textContent = "Editar";
    }
    definirBotoesIAHabilitados(true);
  }

  function atualizarControleSegundoPlanoIA() {
    atualizarEstadoVisualIA();

    if (!botaoSegundoPlanoIA) {
      return;
    }
    const conversaAtual = obterConversaAtual?.();
    const configurado =
      !!conversaAtual && obterSegundoPlanoIAConversa(conversaAtual);
    const podeAlterar =
      !!conversaAtual && obterModoIAConversa(conversaAtual) === "automatico";
    botaoSegundoPlanoIA.disabled = !podeAlterar;
    botaoSegundoPlanoIA.classList.toggle("ativo", configurado);
    botaoSegundoPlanoIA.setAttribute(
      "aria-pressed",
      configurado ? "true" : "false",
    );
    const indicador = botaoSegundoPlanoIA.querySelector(
      ".ia-segundo-plano-indicador",
    );
    if (indicador) {
      indicador.textContent = configurado ? "ON" : "OFF";
    }
    if (!conversaAtual) {
      botaoSegundoPlanoIA.title =
        "Selecione uma conversa para configurar o segundo plano.";
    } else if (!podeAlterar) {
      botaoSegundoPlanoIA.title =
        "O segundo plano pode ser configurado quando esta conversa estiver no modo Automático.";
    } else if (configurado) {
      botaoSegundoPlanoIA.title =
        "Responder em segundo plano está ativado para esta conversa.";
    } else {
      botaoSegundoPlanoIA.title =
        "Responder em segundo plano está desativado para esta conversa.";
    }

    atualizarStatusCompactoIA();
  }

  function atualizarBotoesModoIA() {
    const conversaAtual = obterConversaAtual?.();
    const modoIAAtual = obterModoIAAtual?.() || "manual";
    for (const botao of botoesModoIA) {
      const modoBotao = String(botao.dataset.modo || "");
      botao.disabled = !conversaAtual;
      botao.classList.toggle("ativo", modoBotao === modoIAAtual);
      if (modoBotao === "automatico") {
        botao.title = "Responde automaticamente apenas nesta conversa.";
      }
    }
    atualizarControleSegundoPlanoIA();
    atualizarEstadoVisualIA();
  }

  function mostrarEstadoAutomaticoIA(conversaId) {
    if (obterSegundoPlanoIAConversa(conversaId)) {
      mostrarEstadoPainelIA(
        "Modo Automático ativo nesta conversa. Com Segundo plano ON, a IA continua respondendo automaticamente mesmo com o chat fechado.",
      );
      return;
    }

    mostrarEstadoPainelIA(
      "Modo Automático ativo nesta conversa. Com Segundo plano OFF, mensagens recebidas com o chat fechado ficam aguardando até você abrir a conversa.",
    );
  }

  function aplicarModoIA(novoModo, persistir = true) {
    const modo = normalizarModoIA(novoModo);
    const conversaAtual = obterConversaAtual?.();
    const modoAnterior = obterModoIAAtual?.() || "manual";
    const mudouModo = modoAnterior !== modo;
    definirModoIAAtual?.(modo);
    if (persistir && conversaAtual) {
      if (mudouModo) {
        salvarSegundoPlanoIAConversa(conversaAtual, false);
        diagnosticoSegundoPlanoIA?.("SEGUNDO_PLANO_RESET_MODO", {
          id: conversaAtual,
          de: modoAnterior,
          para: modo,
        });
      }
      salvarModoIAConversa(conversaAtual, modo);
    }
    atualizarBotoesModoIA();
    cancelarSugestaoIAEmAndamento?.();
    cancelarRespostaAutomaticaIAEmAndamento?.(conversaAtual, true);
    if (modo !== "automatico" && conversaAtual) {
      limparRespostaAutomaticaPendente?.(conversaAtual);
    }
    if (!conversaAtual || !conversas[conversaAtual]) {
      mostrarEstadoPainelIA(
        "Selecione uma conversa. O modo padrão de cada conversa é Manual.",
      );
      return;
    }
    if (modo === "manual") {
      mostrarEstadoPainelIA(
        "Modo Manual ativo nesta conversa. Selecione Assistido ou Automático para usar a IA.",
      );
      return;
    }
    if (modo === "automatico") {
      if (!tentarAgendarRespostaAutomaticaPendente?.(conversaAtual, 4000)) {
        mostrarEstadoAutomaticoIA(conversaAtual);
      }
      return;
    }
    agendarSugestaoIA?.(conversaAtual, 120);
  }

  async function enviarSugestaoIAAtual() {
    const conversaAtual = obterConversaAtual?.();
    if (
      !respostaIA ||
      respostaIA.dataset.estado !== "pronta" ||
      !conversaAtual ||
      !conversas[conversaAtual]
    ) {
      return;
    }
    if (editandoSugestaoIA) {
      finalizarEdicaoSugestaoIA();
    }
    const conversa = conversas[conversaAtual];
    const conversaId = conversa.id;
    const texto = obterTextoSugestaoIASelecionada();
    if (!texto) {
      return;
    }
    definirBotoesIAHabilitados(false);
    if (btnEnviarIA) {
      btnEnviarIA.textContent = "Enviando...";
    }
    const desarquivadaLocalmente = desarquivarLocalmenteAoEnviar?.(conversa);
    try {
      const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
        conversaId,
        texto,
        resposta: null,
      });
      if (!resultado?.ok) {
        restaurarArquivamentoLocalSeFalhar?.(conversa, desarquivadaLocalmente);
        mostrarEstadoPainelIA(
          resultado?.erro || "Não foi possível enviar a resposta.",
          "ia-erro",
        );
        return;
      }
      sugestoesIAPorConversa.delete(conversaId);
      mostrarEstadoPainelIA(
        "Resposta enviada. Aguardando a próxima mensagem do contato.",
      );
    } catch (erro) {
      restaurarArquivamentoLocalSeFalhar?.(conversa, desarquivadaLocalmente);
      mostrarEstadoPainelIA(
        erro?.message || "Erro ao enviar a resposta.",
        "ia-erro",
      );
    } finally {
      if (btnEnviarIA) {
        btnEnviarIA.textContent = "Enviar";
      }
    }
  }

  function ignorarSugestaoIAAtual() {
    const conversaAtual = obterConversaAtual?.();
    if (
      !respostaIA ||
      respostaIA.dataset.estado !== "pronta" ||
      !conversaAtual
    ) {
      return;
    }
    if (editandoSugestaoIA) {
      finalizarEdicaoSugestaoIA();
    }
    const cache = sugestoesIAPorConversa.get(conversaAtual);
    if (cache && cache.baseId === idBaseSugestaoExibida) {
      cache.ignorada = true;
      sugestoesIAPorConversa.set(conversaAtual, cache);
    }
    mostrarEstadoPainelIA(
      "Sugestões ignoradas. Uma nova mensagem do contato gerará outras opções.",
    );
  }

  function alternarEdicaoSugestaoIA() {
    if (!respostaIA || respostaIA.dataset.estado !== "pronta") {
      return;
    }
    if (editandoSugestaoIA) {
      finalizarEdicaoSugestaoIA();
      return;
    }
    const elementoOpcao = obterElementoOpcaoIA(tipoSugestaoIASelecionada);
    const elementoTexto = obterElementoTextoOpcaoIA(tipoSugestaoIASelecionada);
    if (!elementoTexto) {
      return;
    }
    editandoSugestaoIA = true;
    elementoTexto.contentEditable = "true";
    elementoOpcao?.classList.add("ia-editando");
    if (btnEditarIA) {
      btnEditarIA.textContent = "Concluir edição";
    }
    elementoTexto.focus();
    try {
      const selecao = window.getSelection();
      const intervalo = document.createRange();
      intervalo.selectNodeContents(elementoTexto);
      intervalo.collapse(false);
      selecao.removeAllRanges();
      selecao.addRange(intervalo);
    } catch {}
  }

  function inicializarEventosPainelIA() {
    if (eventosPainelInicializados) {
      atualizarEstadoVisualIA();
      return;
    }
    eventosPainelInicializados = true;
    atualizarEstadoVisualIA();
    for (const botao of botoesModoIA) {
      botao.addEventListener("click", () => {
        const modo = String(botao.dataset.modo || "");
        aplicarModoIA(modo);
      });
    }
    btnEditarIA?.addEventListener("click", alternarEdicaoSugestaoIA);
    btnEnviarIA?.addEventListener("click", enviarSugestaoIAAtual);
    btnIgnorarIA?.addEventListener("click", ignorarSugestaoIAAtual);
  }

  function inicializarControleSegundoPlanoIA() {
    if (controleSegundoPlanoInicializado) {
      atualizarControleSegundoPlanoIA();
      return;
    }
    controleSegundoPlanoInicializado = true;
    const modosContainer = document.querySelector(".modos");
    if (!modosContainer) {
      return;
    }
    botaoSegundoPlanoIA = document.createElement("button");
    botaoSegundoPlanoIA.id = "botaoSegundoPlanoIA";
    botaoSegundoPlanoIA.className = "ia-segundo-plano-toggle";
    botaoSegundoPlanoIA.type = "button";
    botaoSegundoPlanoIA.setAttribute("aria-pressed", "false");
    botaoSegundoPlanoIA.innerHTML =
      '<span class="ia-segundo-plano-indicador">OFF</span>' +
      '<span class="ia-segundo-plano-texto">Segundo plano</span>';
    botaoSegundoPlanoIA.addEventListener("click", () => {
      const conversaAtual = obterConversaAtual?.();
      if (
        !conversaAtual ||
        obterModoIAConversa(conversaAtual) !== "automatico"
      ) {
        return;
      }
      const novoEstado = !obterSegundoPlanoIAConversa(conversaAtual);
      salvarSegundoPlanoIAConversa(conversaAtual, novoEstado);
      atualizarControleSegundoPlanoIA();
      mostrarEstadoAutomaticoIA(conversaAtual);
      if (novoEstado) {
        tentarAgendarRespostaAutomaticaPendente?.(conversaAtual, 4000);
      }
    });
    modosContainer.appendChild(botaoSegundoPlanoIA);
    atualizarControleSegundoPlanoIA();
  }

  return {
    normalizarSugestoesIA,
    sugestoesIACompletas,
    obterModoIAConversa,
    salvarModoIAConversa,
    obterSegundoPlanoIAConversa,
    salvarSegundoPlanoIAConversa,
    obterSugestaoIACache,
    salvarSugestaoIACache,
    limparSugestaoIACache,
    definirContextoSugestaoIA,
    mostrarEstadoPainelIA,
    definirGerandoPainelIA,
    exibirSugestoesIA,
    exibirRespostaUnicaIA,
    atualizarControleSegundoPlanoIA,
    atualizarBotoesModoIA,
    aplicarModoIA,
    inicializarEventosPainelIA,
    inicializarControleSegundoPlanoIA,
    atualizarEstadoVisualIA,
  };
}

module.exports = {
  criarModuloPainelIA,
};
