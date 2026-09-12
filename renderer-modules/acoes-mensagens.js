function criarModuloAcoesMensagens(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    window,
    clipboard,
    statusChat,
    conversas,
    obterConversaAtual,
    obterMensagemRespondendo,
    atualizarBarraRespostaMensagem,
    limparRespostaMensagem,
    registrarMensagemEditadaLocalmente,
    registrarMensagemApagadaLocalmente,
    obterRegistroMensagemApagada,
    criarTombstoneMensagemApagada,
    moduloAudio,
    midiasEnviadasLocais,
    salvarMidiasEnviadasLocais,
    atualizarContadores,
    recalcularNaoLidasGlobal,
    renderConversas,
    renderMensagens,
    atualizarStatusCabecalho,
    fecharMenuContexto,
    definirMenuContextoAtual,
    ativarRespostaMensagem,
    dadosMensagemParaReacao,
    abrirReacoesMensagem,
    dadosMensagemParaFavorito,
    mensagemEstaFavoritada,
    alterarFavoritoMensagem,
    abrirEncaminhamentoMensagem,
  } = dependencias;

  const ICONES_MENU_MENSAGEM = {
    responder: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 7 4 12l5 5"></path>
        <path d="M5 12h7.5c4.2 0 6.5 2 7.5 5"></path>
      </svg>`,
    copiar: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="8" width="10" height="11" rx="2"></rect>
        <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>`,
    reagir: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5"></circle>
        <path d="M9 10h.01M15 10h.01M8.8 14c.9 1.2 1.9 1.8 3.2 1.8s2.3-.6 3.2-1.8"></path>
      </svg>`,
    encaminhar: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m14 7 5 5-5 5"></path>
        <path d="M19 12h-7c-4.2 0-6.5 2-7.5 5"></path>
      </svg>`,
    editar: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l10-10-4-4L4 16v4Z"></path>
        <path d="m12.5 7.5 4 4"></path>
      </svg>`,
    favorito: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"></path>
      </svg>`,
    apagar: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>
      </svg>`,
  };

  function iconeOpcaoMenuMensagem(texto) {
    const chave = String(texto || "")
      .trim()
      .toLowerCase();

    if (chave.startsWith("responder")) return ICONES_MENU_MENSAGEM.responder;
    if (chave.startsWith("copiar")) return ICONES_MENU_MENSAGEM.copiar;
    if (chave.startsWith("reagir")) return ICONES_MENU_MENSAGEM.reagir;
    if (chave.startsWith("encaminhar")) return ICONES_MENU_MENSAGEM.encaminhar;
    if (chave.startsWith("editar")) return ICONES_MENU_MENSAGEM.editar;
    if (chave.includes("favoritar")) return ICONES_MENU_MENSAGEM.favorito;
    if (chave.startsWith("apagar")) return ICONES_MENU_MENSAGEM.apagar;

    return "";
  }

  function criarOpcaoMenu(texto, acao, destaque = false) {
    const botao = document.createElement("button");

    botao.type = "button";
    botao.className = "menu-contexto-whatsapp-item menu-contexto-mensagem-item";

    if (
      String(texto || "")
        .toLowerCase()
        .startsWith("apagar")
    ) {
      botao.classList.add("perigo");
    }

    const icone = document.createElement("span");
    icone.className = "menu-contexto-whatsapp-icone";
    icone.innerHTML = iconeOpcaoMenuMensagem(texto);

    const rotulo = document.createElement("span");
    rotulo.className = "menu-contexto-whatsapp-texto";
    rotulo.textContent = texto;

    botao.appendChild(icone);
    botao.appendChild(rotulo);

    botao.addEventListener("click", async (evento) => {
      evento.stopPropagation();
      fecharMenuContexto();
      await acao();
    });

    return botao;
  }

  function criarSeparadorMenuMensagem() {
    const separador = document.createElement("div");
    separador.className =
      "menu-contexto-whatsapp-separador menu-contexto-mensagem-separador";
    return separador;
  }

  function textoCopiavelMensagem(msg) {
    if (msg?.apagadaParaTodos || msg?.tipo === "apagada") {
      return "";
    }

    const texto = String(msg?.texto || "").trim();

    if (texto) {
      return texto;
    }

    if (msg?.tipo === "documento" && msg?.fileName) {
      return String(msg.fileName);
    }

    return "";
  }

  function dadosMensagemParaEdicao(msg) {
    if (
      !msg?.idMensagem ||
      !msg?.minha ||
      msg?.apagadaParaTodos ||
      msg?.tipo === "apagada" ||
      String(msg?.tipo || "").toLowerCase() !== "texto"
    ) {
      return null;
    }

    const texto = String(msg?.texto || "");

    if (!texto.trim()) {
      return null;
    }

    return {
      idMensagem: String(msg.idMensagem),
      idMensagemWpp: msg.idMensagemWpp || null,
      minha: true,
      texto,
      tipo: "texto",
      fileName: null,
    };
  }

  function atualizarMensagemEditadaNaInterface(
    conversaId,
    idMensagem,
    novoTexto,
  ) {
    const conversa = conversas[conversaId];
    const id = String(idMensagem || "").trim();
    const texto = String(novoTexto || "").trim();

    if (!conversa || !id || !texto || !Array.isArray(conversa.mensagens)) {
      return false;
    }

    const mensagem = conversa.mensagens.find(
      (item) => String(item?.idMensagem || "") === id,
    );

    if (!mensagem || mensagem.apagadaParaTodos || mensagem.tipo === "apagada") {
      return false;
    }

    mensagem.texto = texto;
    mensagem.editada = true;

    const mensagemRespondendoAtual = obterMensagemRespondendo?.();

    if (
      mensagemRespondendoAtual?.conversaId === conversaId &&
      String(mensagemRespondendoAtual?.idMensagem || "") === id
    ) {
      mensagemRespondendoAtual.texto = texto;
      atualizarBarraRespostaMensagem();
    }

    renderConversas();

    if (obterConversaAtual() === conversaId) {
      renderMensagens();
    }

    return true;
  }

  function abrirEdicaoMensagem(msg) {
    const conversaId = obterConversaAtual();
    const conversa = conversas[conversaId];
    const mensagem = dadosMensagemParaEdicao(msg);

    if (!conversa || !mensagem) {
      return;
    }

    const idMensagem = String(mensagem.idMensagem || "");

    if (!idMensagem || idMensagem.startsWith("local-audio-")) {
      statusChat.textContent = "Aguarde o envio terminar antes de editar.";
      return;
    }

    const overlay = document.createElement("div");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "120200",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      boxSizing: "border-box",
      background: "rgba(0,0,0,.68)",
    });

    const caixa = document.createElement("section");
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-label", "Editar mensagem");

    Object.assign(caixa.style, {
      width: "520px",
      maxWidth: "100%",
      padding: "20px",
      borderRadius: "14px",
      border: "1px solid #2b3941",
      background: "#111a1f",
      boxShadow: "0 22px 65px rgba(0,0,0,.55)",
      color: "#e9edef",
      boxSizing: "border-box",
    });

    const titulo = document.createElement("div");
    titulo.textContent = "Editar mensagem";

    Object.assign(titulo.style, {
      marginBottom: "12px",
      fontSize: "18px",
      fontWeight: "800",
    });

    const campo = document.createElement("textarea");
    campo.value = mensagem.texto;
    campo.rows = 4;
    campo.spellcheck = true;

    Object.assign(campo.style, {
      display: "block",
      width: "100%",
      minHeight: "110px",
      maxHeight: "300px",
      resize: "vertical",
      boxSizing: "border-box",
      padding: "12px 13px",
      border: "1px solid #30414a",
      borderRadius: "10px",
      outline: "none",
      background: "#0c1317",
      color: "#e9edef",
      font: "inherit",
      fontSize: "14px",
      lineHeight: "1.45",
    });

    const status = document.createElement("div");

    Object.assign(status.style, {
      minHeight: "18px",
      marginTop: "9px",
      color: "#ff8a8a",
      fontSize: "12px",
      lineHeight: "1.4",
    });

    const acoes = document.createElement("div");

    Object.assign(acoes.style, {
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
      marginTop: "8px",
    });

    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.textContent = "Cancelar";

    const salvar = document.createElement("button");
    salvar.type = "button";
    salvar.textContent = "Salvar";

    for (const botao of [cancelar, salvar]) {
      Object.assign(botao.style, {
        minWidth: "100px",
        minHeight: "40px",
        padding: "9px 14px",
        borderRadius: "9px",
        cursor: "pointer",
        color: "#fff",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "800",
      });
    }

    cancelar.style.border = "1px solid #30414a";
    cancelar.style.background = "#182329";
    salvar.style.border = "0";
    salvar.style.background = "#20b35b";

    acoes.appendChild(cancelar);
    acoes.appendChild(salvar);
    caixa.appendChild(titulo);
    caixa.appendChild(campo);
    caixa.appendChild(status);
    caixa.appendChild(acoes);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    let executando = false;

    function fechar() {
      if (!executando) {
        overlay.remove();
      }
    }

    async function confirmarEdicao() {
      if (executando) {
        return;
      }

      const novoTexto = String(campo.value || "").trim();

      status.style.color = "#ff8a8a";

      if (!novoTexto) {
        status.textContent = "A mensagem não pode ficar vazia.";
        campo.focus();
        return;
      }

      if (novoTexto === String(mensagem.texto || "").trim()) {
        overlay.remove();
        return;
      }

      executando = true;
      campo.disabled = true;
      cancelar.disabled = true;
      salvar.disabled = true;
      status.style.color = "#9fb0ba";
      status.textContent = "Salvando edição...";

      try {
        const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
          editar: {
            conversaId,
            mensagem,
            novoTexto,
          },
        });

        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro || "Não foi possível editar a mensagem.",
          );
        }

        registrarMensagemEditadaLocalmente(conversaId, idMensagem, novoTexto);
        atualizarMensagemEditadaNaInterface(conversaId, idMensagem, novoTexto);

        overlay.remove();

        if (obterConversaAtual() === conversaId) {
          const textoStatus = "Mensagem editada.";
          statusChat.textContent = textoStatus;

          setTimeout(() => {
            if (statusChat.textContent === textoStatus) {
              atualizarStatusCabecalho();
            }
          }, 1800);
        }
      } catch (erro) {
        executando = false;
        campo.disabled = false;
        cancelar.disabled = false;
        salvar.disabled = false;
        status.style.color = "#ff8a8a";
        status.textContent =
          erro?.message || "Não foi possível editar a mensagem.";
        campo.focus();
      }
    }

    cancelar.addEventListener("click", fechar);
    salvar.addEventListener("click", confirmarEdicao);

    overlay.addEventListener("click", (evento) => {
      if (evento.target === overlay) {
        fechar();
      }
    });

    campo.addEventListener("keydown", (evento) => {
      if (
        evento.key === "Enter" &&
        !evento.shiftKey &&
        !evento.isComposing
      ) {
        evento.preventDefault();
        confirmarEdicao();
      }
    });

    overlay.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") {
        fechar();
      }
    });

    overlay.tabIndex = -1;

    setTimeout(() => {
      campo.focus();
      campo.setSelectionRange(campo.value.length, campo.value.length);
    }, 30);
  }

  function dadosMensagemParaExclusao(msg) {
    if (!msg?.idMensagem || msg?.apagadaParaTodos || msg?.tipo === "apagada") {
      return null;
    }

    return {
      idMensagem: String(msg.idMensagem),
      idMensagemWpp: msg.idMensagemWpp || null,
      minha: !!msg.minha,
      texto: String(msg.texto || ""),
      tipo: String(msg.tipo || "texto"),
      fileName: msg.fileName || null,
      horario: msg.horario || "",
      timestamp: Number(msg.timestamp || 0) || 0,
    };
  }

  function removerMensagemDaInterface(conversaId, idMensagem) {
    const conversa = conversas[conversaId];
    const id = String(idMensagem || "").trim();

    if (!conversa || !id || !Array.isArray(conversa.mensagens)) {
      return false;
    }

    const indice = conversa.mensagens.findIndex(
      (msg) => String(msg?.idMensagem || "") === id,
    );

    if (indice < 0) {
      return false;
    }

    const mensagemRespondendoAtual = obterMensagemRespondendo?.();

    if (
      mensagemRespondendoAtual?.conversaId === conversaId &&
      String(mensagemRespondendoAtual?.idMensagem || "") === id
    ) {
      limparRespostaMensagem(false);
    }

    moduloAudio.removerRegistroAudioOtimista(id, { revogarUrl: true });

    if (Object.prototype.hasOwnProperty.call(midiasEnviadasLocais, id)) {
      delete midiasEnviadasLocais[id];
      salvarMidiasEnviadasLocais();
    }

    conversa.mensagens.splice(indice, 1);

    atualizarContadores();
    recalcularNaoLidasGlobal();
    renderConversas();

    if (obterConversaAtual() === conversaId) {
      renderMensagens();
    }

    return true;
  }

  function marcarMensagemApagadaParaTodosNaInterface(
    conversaId,
    idMensagem,
    mensagemOriginal = null,
  ) {
    const conversa = conversas[conversaId];
    const id = String(idMensagem || "").trim();

    if (!conversa || !id || !Array.isArray(conversa.mensagens)) {
      return false;
    }

    const indice = conversa.mensagens.findIndex(
      (msg) => String(msg?.idMensagem || "") === id,
    );

    if (indice < 0) {
      return false;
    }

    const mensagemRespondendoAtual = obterMensagemRespondendo?.();

    if (
      mensagemRespondendoAtual?.conversaId === conversaId &&
      String(mensagemRespondendoAtual?.idMensagem || "") === id
    ) {
      limparRespostaMensagem(false);
    }

    const atual = conversa.mensagens[indice];
    const registro = obterRegistroMensagemApagada(conversaId, id);

    conversa.mensagens[indice] = criarTombstoneMensagemApagada(
      {
        ...atual,
        ...mensagemOriginal,
        idMensagem: id,
      },
      registro,
    );

    moduloAudio.removerRegistroAudioOtimista(id);

    if (Object.prototype.hasOwnProperty.call(midiasEnviadasLocais, id)) {
      delete midiasEnviadasLocais[id];
      salvarMidiasEnviadasLocais();
    }

    atualizarContadores();
    recalcularNaoLidasGlobal();
    renderConversas();

    if (obterConversaAtual() === conversaId) {
      renderMensagens();
    }

    return true;
  }

  function abrirExclusaoMensagem(msg) {
    const conversaId = obterConversaAtual();
    const conversa = conversas[conversaId];
    const mensagem = dadosMensagemParaExclusao(msg);

    if (!conversa || !mensagem) {
      return;
    }

    const idMensagem = String(mensagem.idMensagem || "");

    if (!idMensagem || idMensagem.startsWith("local-audio-")) {
      statusChat.textContent = "Aguarde o envio terminar antes de apagar.";
      return;
    }

    const overlay = document.createElement("div");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "120200",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      boxSizing: "border-box",
      background: "rgba(0,0,0,.68)",
    });

    const caixa = document.createElement("section");
    caixa.setAttribute("role", "dialog");
    caixa.setAttribute("aria-modal", "true");
    caixa.setAttribute("aria-label", "Apagar mensagem");

    Object.assign(caixa.style, {
      width: "390px",
      maxWidth: "100%",
      padding: "20px",
      borderRadius: "14px",
      border: "1px solid #2b3941",
      background: "#111a1f",
      boxShadow: "0 22px 65px rgba(0,0,0,.55)",
      color: "#e9edef",
      boxSizing: "border-box",
    });

    const titulo = document.createElement("div");
    titulo.textContent = "Apagar mensagem?";

    Object.assign(titulo.style, {
      marginBottom: "7px",
      fontSize: "18px",
      fontWeight: "800",
    });

    const descricao = document.createElement("div");
    descricao.textContent = mensagem.minha
      ? "Escolha como você quer apagar esta mensagem."
      : "Esta mensagem pode ser apagada da sua conversa.";

    Object.assign(descricao.style, {
      marginBottom: "16px",
      color: "#9fb0ba",
      fontSize: "13px",
      lineHeight: "1.45",
    });

    const status = document.createElement("div");

    Object.assign(status.style, {
      minHeight: "18px",
      marginBottom: "10px",
      color: "#ff8a8a",
      fontSize: "12px",
      lineHeight: "1.4",
    });

    const acoes = document.createElement("div");

    Object.assign(acoes.style, {
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    });

    function criarBotao(texto, fundo, cor = "#fff") {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.textContent = texto;

      Object.assign(botao.style, {
        width: "100%",
        minHeight: "42px",
        padding: "10px 14px",
        border: "0",
        borderRadius: "9px",
        background: fundo,
        color: cor,
        cursor: "pointer",
        font: "inherit",
        fontSize: "13px",
        fontWeight: "800",
      });

      return botao;
    }

    const apagarParaMim = criarBotao("Apagar para mim", "#26343b");
    const apagarParaTodos = mensagem.minha
      ? criarBotao("Apagar para todos", "#b83b3b")
      : null;
    const cancelar = criarBotao("Cancelar", "transparent", "#b7c5cc");

    cancelar.style.border = "1px solid #2b3941";

    acoes.appendChild(apagarParaMim);

    if (apagarParaTodos) {
      acoes.appendChild(apagarParaTodos);
    }

    acoes.appendChild(cancelar);

    caixa.appendChild(titulo);
    caixa.appendChild(descricao);
    caixa.appendChild(status);
    caixa.appendChild(acoes);
    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    let executando = false;

    const botoes = [apagarParaMim, apagarParaTodos, cancelar].filter(Boolean);

    function fechar() {
      if (!executando) {
        overlay.remove();
      }
    }

    async function executar(paraTodos) {
      if (executando) {
        return;
      }

      executando = true;
      status.textContent = paraTodos
        ? "Apagando para todos..."
        : "Apagando para você...";
      status.style.color = "#9fb0ba";

      for (const botao of botoes) {
        botao.disabled = true;
        botao.style.cursor = "default";
        botao.style.opacity = ".62";
      }

      try {
        const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
          excluir: {
            conversaId,
            mensagem,
            paraTodos: !!paraTodos,
          },
        });

        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro || "Não foi possível apagar a mensagem.",
          );
        }

        registrarMensagemApagadaLocalmente(conversaId, idMensagem, {
          paraTodos: !!paraTodos,
          mensagem,
        });

        if (paraTodos) {
          marcarMensagemApagadaParaTodosNaInterface(
            conversaId,
            idMensagem,
            mensagem,
          );
        } else {
          removerMensagemDaInterface(conversaId, idMensagem);
        }

        overlay.remove();

        if (obterConversaAtual() === conversaId) {
          const textoStatus = paraTodos
            ? "Mensagem apagada para todos."
            : "Mensagem apagada para você.";

          statusChat.textContent = textoStatus;

          setTimeout(() => {
            if (statusChat.textContent === textoStatus) {
              atualizarStatusCabecalho();
            }
          }, 2200);
        }
      } catch (erro) {
        executando = false;
        status.textContent =
          erro?.message || "Não foi possível apagar a mensagem.";
        status.style.color = "#ff8a8a";

        for (const botao of botoes) {
          botao.disabled = false;
          botao.style.cursor = "pointer";
          botao.style.opacity = "1";
        }
      }
    }

    apagarParaMim.addEventListener("click", () => executar(false));
    apagarParaTodos?.addEventListener("click", () => executar(true));
    cancelar.addEventListener("click", fechar);

    overlay.addEventListener("click", (evento) => {
      if (evento.target === overlay) {
        fechar();
      }
    });

    overlay.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") {
        fechar();
      }
    });

    overlay.tabIndex = -1;
    overlay.focus();
  }

  function abrirMenuContextoMensagem(evento, msg) {
    evento.preventDefault();
    evento.stopPropagation();

    fecharMenuContexto();

    if (msg?.apagadaParaTodos || msg?.tipo === "apagada") {
      return;
    }

    const texto = textoCopiavelMensagem(msg);

    if (!msg?.idMensagem && !texto) {
      return;
    }

    const menu = document.createElement("div");
    menu.className = "menu-contexto-whatsapp menu-contexto-mensagem-whatsapp";

    if (msg?.idMensagem) {
      menu.appendChild(
        criarOpcaoMenu("Responder", () => {
          ativarRespostaMensagem(msg);
        }),
      );
    }

    if (texto) {
      menu.appendChild(
        criarOpcaoMenu("Copiar", () => {
          clipboard.writeText(texto);
        }),
      );
    }

    if (msg?.idMensagem && dadosMensagemParaReacao(msg)) {
      menu.appendChild(
        criarOpcaoMenu("Reagir", () => {
          abrirReacoesMensagem(msg);
        }),
      );
    }

    if (msg?.idMensagem && msg?.tipo !== "view_once") {
      menu.appendChild(
        criarOpcaoMenu("Encaminhar", () => {
          abrirEncaminhamentoMensagem(msg);
        }),
      );
    }

    if (msg?.idMensagem && dadosMensagemParaEdicao(msg)) {
      menu.appendChild(
        criarOpcaoMenu("Editar", () => {
          abrirEdicaoMensagem(msg);
        }),
      );
    }

    if (msg?.idMensagem && dadosMensagemParaFavorito(msg)) {
      const estaFavoritada = mensagemEstaFavoritada(
        obterConversaAtual(),
        msg.idMensagem,
      );

      menu.appendChild(
        criarOpcaoMenu(estaFavoritada ? "Desfavoritar" : "Favoritar", () => {
          alterarFavoritoMensagem(msg);
        }),
      );
    }

    if (msg?.idMensagem && !String(msg.idMensagem).startsWith("local-audio-")) {
      menu.appendChild(criarSeparadorMenuMensagem());

      menu.appendChild(
        criarOpcaoMenu("Apagar", () => {
          abrirExclusaoMensagem(msg);
        }),
      );
    }

    document.body.appendChild(menu);
    definirMenuContextoAtual?.(menu);

    const margem = 8;
    const largura = menu.offsetWidth;
    const altura = menu.offsetHeight;

    let left = evento.clientX;
    let top = evento.clientY;

    if (left + largura > window.innerWidth - margem) {
      left = window.innerWidth - largura - margem;
    }

    if (top + altura > window.innerHeight - margem) {
      top = window.innerHeight - altura - margem;
    }

    menu.style.left = `${Math.max(margem, left)}px`;
    menu.style.top = `${Math.max(margem, top)}px`;

    requestAnimationFrame(() => {
      menu.classList.add("aberto");
    });
  }

  return {
    abrirMenuContextoMensagem,
  };
}

module.exports = {
  criarModuloAcoesMensagens,
};
