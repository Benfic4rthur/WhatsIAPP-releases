function criarModuloPrivacidadeConversa(deps = {}) {
  const {
    ipcRenderer,
    document,
    window,
    conversas,
    statusChat,
    botaoArquivar,
    botaoTrancar,
    obterConversaAtual,
    solicitarSenhaParaTrancamento,
    animarTrancamentoConversa,
    overridesTrancadas,
    salvarOverridesTrancadas,
    persistirNaoLidasConversa,
    recalcularNaoLidasGlobal,
    atualizarContadores,
    limparSelecaoConversa,
    renderConversas,
    animarConversaParaAba,
    abaArquivadas,
    abaConversas,
    atualizarStatusCabecalho,
    atualizarCabecalhoConversa,
    abrirConfirmacaoGerenciamentoConversa,
    notificacoesAtivasConversa,
    definirNotificacoesConversa,
    fecharMenuContexto,
    registrarMenuContexto,
  } = deps;

  function ehGrupo(conversa) {
    return !!conversa?.grupo || String(conversa?.id || "").endsWith("@g.us");
  }

  function atualizarBotaoTrancar() {
    const conversaId = obterConversaAtual?.();
    const conversa = conversaId ? conversas?.[conversaId] : null;

    if (!botaoTrancar) return;

    if (!conversa) {
      botaoTrancar.style.display = "none";
      return;
    }

    botaoTrancar.style.display = "none";
    botaoTrancar.disabled = false;
    botaoTrancar.textContent = conversa.trancada ? "Destrancar" : "Trancar";
  }

  async function alterarTrancamento(conversa, opcoes = {}) {
    if (!conversa) return false;

    const vaiTrancar = !conversa.trancada;
    const autorizado = await solicitarSenhaParaTrancamento?.(
      vaiTrancar ? "Trancar conversa" : "Destrancar conversa",
    );

    if (!autorizado) return false;

    const animacaoVisual = animarTrancamentoConversa?.(conversa.id, vaiTrancar);

    if (typeof opcoes.aoConfirmar === "function") {
      opcoes.aoConfirmar();
    }

    if (overridesTrancadas && conversa.id) {
      overridesTrancadas[conversa.id] = vaiTrancar;
      for (const alias of conversa.privacidadeAliases || []) {
        if (alias) overridesTrancadas[alias] = vaiTrancar;
      }
      salvarOverridesTrancadas?.();
    }

    conversa.trancadaWhatsapp = conversa.trancadaWhatsapp ?? conversa.trancada;
    conversa.trancada = vaiTrancar;

    if (vaiTrancar) {
      conversa.naoLidasLocal = 0;
      persistirNaoLidasConversa?.(conversa);
      recalcularNaoLidasGlobal?.();
    }

    atualizarContadores?.();
    limparSelecaoConversa?.(
      vaiTrancar ? "Conversa trancada" : "Conversa destrancada",
    );
    renderConversas?.();
    atualizarBotaoTrancar();

    await Promise.resolve(animacaoVisual);
    return true;
  }

  function atualizarBotaoArquivar() {
    const conversaId = obterConversaAtual?.();
    const conversa = conversaId ? conversas?.[conversaId] : null;

    if (!botaoArquivar) return;

    if (!conversa) {
      botaoArquivar.style.display = "none";
      return;
    }

    botaoArquivar.style.display = "none";
    botaoArquivar.disabled = false;
    botaoArquivar.textContent = conversa.arquivada ? "Desarquivar" : "Arquivar";
  }

  async function alterarArquivamento(conversa, opcoes = {}) {
    if (!conversa) return false;

    const novoEstado = !conversa.arquivada;
    const conversaAtual = obterConversaAtual?.();
    const eraConversaAberta = conversaAtual === conversa.id;

    try {
      const animacaoVisual = animarConversaParaAba?.(
        conversa.id,
        novoEstado ? abaArquivadas : abaConversas,
        novoEstado ? "transicao-arquivar" : "transicao-desarquivar",
      );

      const resultado = await ipcRenderer.invoke("arquivar-conversa", {
        conversaId: conversa.id,
        arquivar: novoEstado,
      });

      if (!resultado?.ok) {
        if (statusChat) {
          statusChat.textContent =
            resultado?.erro || "Não foi possível alterar o arquivamento.";
        }
        atualizarBotaoArquivar();
        return false;
      }

      if (typeof opcoes.aoConfirmar === "function") {
        opcoes.aoConfirmar();
      }

      // Durante o await, um snapshot do WPPConnect pode reconstruir o objeto
      // dentro de `conversas`. Reobtemos a referencia atual para nao atualizar
      // um objeto antigo que ja saiu do estado do renderer.
      const conversaAtualizada = conversas?.[conversa.id] || conversa;
      const estadoConfirmado =
        typeof resultado?.arquivada === "boolean"
          ? resultado.arquivada
          : novoEstado;

      conversaAtualizada.arquivada = estadoConfirmado;

      if (estadoConfirmado && eraConversaAberta) {
        limparSelecaoConversa?.("Nenhuma conversa aberta");
      } else {
        atualizarStatusCabecalho?.();
        atualizarCabecalhoConversa?.();
      }

      atualizarContadores?.();
      renderConversas?.();
      atualizarBotaoArquivar();
      await Promise.resolve(animacaoVisual);
      return true;
    } catch (erro) {
      if (statusChat) {
        statusChat.textContent =
          erro?.message || "Erro ao alterar arquivamento.";
      }
      atualizarBotaoArquivar();
      return false;
    }
  }

  function notificacoesSilenciadas(conversa) {
    return !notificacoesAtivasConversa?.(conversa);
  }

  function alternarNotificacoes(conversa) {
    if (!conversa) return false;

    const atualmenteAtivas = !!notificacoesAtivasConversa?.(conversa);
    definirNotificacoesConversa?.(conversa, !atualmenteAtivas);

    if (statusChat) {
      statusChat.textContent = atualmenteAtivas
        ? "Notificações desativadas para esta conversa"
        : "Notificações ativadas para esta conversa";
    }

    return atualmenteAtivas;
  }

  async function alterarBloqueio(conversa, opcoes = {}) {
    if (!conversa || ehGrupo(conversa) || conversa.podeBloquear === false) {
      return { ok: false, erro: "Bloqueio indisponível para esta conversa." };
    }

    try {
      if (typeof opcoes.antes === "function") {
        await opcoes.antes(!conversa.bloqueada);
      }

      const resultado = await ipcRenderer.invoke("alterar-bloqueio-contato", {
        conversaId: conversa.id,
        bloquear: !conversa.bloqueada,
      });

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro || "Não foi possível alterar o bloqueio.",
        );
      }

      conversa.bloqueada = !!resultado.bloqueada;
      renderConversas?.();
      atualizarCabecalhoConversa?.();

      if (statusChat) {
        statusChat.textContent = conversa.bloqueada
          ? "Contato bloqueado"
          : "Contato desbloqueado";
      }

      if (typeof opcoes.depois === "function") {
        await opcoes.depois(conversa.bloqueada);
      }

      return { ok: true, bloqueada: conversa.bloqueada };
    } catch (erro) {
      if (statusChat) {
        statusChat.textContent = erro?.message || "Erro ao alterar o bloqueio.";
      }
      return { ok: false, erro: erro?.message || String(erro) };
    }
  }

  function abrirGerenciamento(conversa, tipo) {
    if (!conversa || !["limpar", "apagar"].includes(tipo)) return;
    abrirConfirmacaoGerenciamentoConversa?.(conversa, tipo);
  }

  function confirmarSaidaGrupo(conversa) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "privacidade-confirmacao-overlay";

      const card = document.createElement("div");
      card.className = "privacidade-confirmacao-card";

      const titulo = document.createElement("div");
      titulo.className = "privacidade-confirmacao-titulo";
      titulo.textContent = "Sair do grupo?";

      const texto = document.createElement("div");
      texto.className = "privacidade-confirmacao-texto";
      texto.textContent = `Você deixará de receber novas mensagens de ${conversa.nome || "este grupo"}.`;

      const acoes = document.createElement("div");
      acoes.className = "privacidade-confirmacao-acoes";

      const cancelar = document.createElement("button");
      cancelar.type = "button";
      cancelar.className = "privacidade-confirmacao-botao secundario";
      cancelar.textContent = "Cancelar";

      const confirmar = document.createElement("button");
      confirmar.type = "button";
      confirmar.className = "privacidade-confirmacao-botao perigo";
      confirmar.textContent = "Sair do grupo";

      const finalizar = (valor) => {
        overlay.remove();
        resolve(valor);
      };

      cancelar.addEventListener("click", () => finalizar(false));
      confirmar.addEventListener("click", () => finalizar(true));
      overlay.addEventListener("click", (evento) => {
        if (evento.target === overlay) finalizar(false);
      });
      overlay.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape") finalizar(false);
      });

      acoes.appendChild(cancelar);
      acoes.appendChild(confirmar);
      card.appendChild(titulo);
      card.appendChild(texto);
      card.appendChild(acoes);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      overlay.tabIndex = -1;
      overlay.focus();
      setTimeout(() => confirmar.focus(), 20);
    });
  }

  async function sairDoGrupo(conversa, opcoes = {}) {
    if (!conversa || !ehGrupo(conversa)) {
      return { ok: false, erro: "Esta conversa não é um grupo." };
    }

    const confirmado = await confirmarSaidaGrupo(conversa);
    if (!confirmado) return { ok: false, cancelado: true };

    if (typeof opcoes.antes === "function") {
      await opcoes.antes();
    }

    try {
      const resultado = await ipcRenderer.invoke("sair-grupo", {
        conversaId: conversa.id,
      });

      if (!resultado?.ok) {
        throw new Error(resultado?.erro || "Não foi possível sair do grupo.");
      }

      conversa.saiuGrupo = true;
      conversa.euNoGrupo = false;
      renderConversas?.();
      atualizarCabecalhoConversa?.();

      if (statusChat) {
        statusChat.textContent = "Você saiu do grupo";
      }

      if (typeof opcoes.depois === "function") {
        await opcoes.depois(resultado);
      }

      return { ok: true };
    } catch (erro) {
      if (statusChat) {
        statusChat.textContent = erro?.message || "Erro ao sair do grupo.";
      }
      return { ok: false, erro: erro?.message || String(erro) };
    }
  }

  async function sairEApagarGrupo(conversa) {
    if (!conversa || !ehGrupo(conversa)) {
      return { ok: false, erro: "Esta conversa não é um grupo." };
    }

    const resultado = await sairDoGrupo(conversa);

    if (!resultado?.ok) {
      return resultado;
    }

    // A saída é uma ação remota irreversível. Depois que ela for confirmada
    // pelo WhatsApp, reaproveitamos a confirmação já existente para apagar
    // a conversa localmente, evitando duplicar a lógica de exclusão.
    setTimeout(() => abrirGerenciamento(conversa, "apagar"), 80);

    return { ok: true, aguardandoConfirmacaoApagar: true };
  }

  function iconeMenuContexto(nome) {
    const icones = {
      arquivar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16v13H4zM3 3h18v4H3z"/><path d="M9 11h6"/></svg>',
      trancar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
      sino: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
      sinoOff:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 00-9.6-4.8M6 8c0 7-3 7-3 9h12"/><path d="M10 21h4M3 3l18 18"/></svg>',
      naoLida:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/><circle cx="18.5" cy="5.5" r="2.5"/></svg>',
      bloquear:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
      limpar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.5l6 6M13 5l6 6M4 20l8.5-8.5 4 4L8 24M6.5 17.5l4 4"/></svg>',
      apagar:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"/></svg>',
      sair: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5a2 2 0 00-2 2v12a2 2 0 002 2h5"/><path d="M14 8l4 4-4 4M8 12h10"/></svg>',
    };

    return icones[nome] || "";
  }

  function marcarComoNaoLida(conversa) {
    if (!conversa) return false;

    conversa.naoLidasLocal = Math.max(
      1,
      Number(conversa.naoLidasLocal || 0) || 0,
    );

    persistirNaoLidasConversa?.(conversa);
    recalcularNaoLidasGlobal?.();
    atualizarContadores?.();
    renderConversas?.();

    if (statusChat) {
      statusChat.textContent = "Conversa marcada como não lida";
    }

    return true;
  }

  function criarItemMenuContexto({
    icone,
    texto,
    acao,
    separadorAntes = false,
    perigo = false,
  }) {
    const fragmento = document.createDocumentFragment();

    if (separadorAntes) {
      const separador = document.createElement("div");
      separador.className = "menu-contexto-whatsapp-separador";
      fragmento.appendChild(separador);
    }

    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `menu-contexto-whatsapp-item${perigo ? " perigo" : ""}`;

    const areaIcone = document.createElement("span");
    areaIcone.className = "menu-contexto-whatsapp-icone";
    areaIcone.innerHTML = iconeMenuContexto(icone);

    const label = document.createElement("span");
    label.className = "menu-contexto-whatsapp-texto";
    label.textContent = texto;

    botao.appendChild(areaIcone);
    botao.appendChild(label);

    botao.addEventListener("click", async (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      fecharMenuContexto?.();

      try {
        await acao?.();
      } catch (erro) {
        console.warn(
          `[PRIVACIDADE] acao do menu falhou: ${erro?.message || erro}`,
        );
      }
    });

    fragmento.appendChild(botao);
    return fragmento;
  }

  function abrirMenuContextoLista(evento, conversa) {
    if (!evento || !conversa) return;

    evento.preventDefault();
    evento.stopPropagation();
    fecharMenuContexto?.();

    const grupo = ehGrupo(conversa);
    const saiuDoGrupo = grupo && conversa.saiuGrupo === true;
    const silenciada = notificacoesSilenciadas(conversa);

    const menu = document.createElement("div");
    menu.className = "menu-contexto-whatsapp";
    menu.setAttribute("role", "menu");
    menu.setAttribute(
      "aria-label",
      grupo ? "Opções do grupo" : "Opções da conversa",
    );

    menu.appendChild(
      criarItemMenuContexto({
        icone: "arquivar",
        texto: conversa.arquivada
          ? "Desarquivar conversa"
          : "Arquivar conversa",
        acao: () => alterarArquivamento(conversa),
      }),
    );

    menu.appendChild(
      criarItemMenuContexto({
        icone: "trancar",
        texto: conversa.trancada ? "Destrancar conversa" : "Trancar conversa",
        acao: () => alterarTrancamento(conversa),
      }),
    );

    menu.appendChild(
      criarItemMenuContexto({
        icone: silenciada ? "sino" : "sinoOff",
        texto: silenciada ? "Reativar notificações" : "Silenciar notificações",
        acao: () => alternarNotificacoes(conversa),
      }),
    );

    menu.appendChild(
      criarItemMenuContexto({
        icone: "naoLida",
        texto: "Marcar como não lida",
        acao: () => marcarComoNaoLida(conversa),
      }),
    );

    if (!grupo) {
      menu.appendChild(
        criarItemMenuContexto({
          icone: "bloquear",
          texto: conversa.bloqueada
            ? "Desbloquear contato"
            : "Bloquear contato",
          separadorAntes: true,
          acao: () => alterarBloqueio(conversa),
        }),
      );

      menu.appendChild(
        criarItemMenuContexto({
          icone: "limpar",
          texto: "Limpar conversa",
          acao: () => abrirGerenciamento(conversa, "limpar"),
        }),
      );

      menu.appendChild(
        criarItemMenuContexto({
          icone: "apagar",
          texto: "Apagar conversa",
          acao: () => abrirGerenciamento(conversa, "apagar"),
          perigo: true,
        }),
      );
    } else {
      menu.appendChild(
        criarItemMenuContexto({
          icone: "limpar",
          texto: "Limpar conversa",
          separadorAntes: true,
          acao: () => abrirGerenciamento(conversa, "limpar"),
        }),
      );

      if (saiuDoGrupo) {
        menu.appendChild(
          criarItemMenuContexto({
            icone: "apagar",
            texto: "Apagar conversa",
            acao: () => abrirGerenciamento(conversa, "apagar"),
            perigo: true,
          }),
        );
      } else {
        menu.appendChild(
          criarItemMenuContexto({
            icone: "sair",
            texto: "Sair do grupo",
            acao: () => sairDoGrupo(conversa),
            perigo: true,
          }),
        );

        menu.appendChild(
          criarItemMenuContexto({
            icone: "apagar",
            texto: "Sair do grupo e apagar conversa",
            acao: () => sairEApagarGrupo(conversa),
            perigo: true,
          }),
        );
      }
    }

    document.body.appendChild(menu);
    registrarMenuContexto?.(menu);

    const margem = 8;
    const largura = menu.offsetWidth;
    const altura = menu.offsetHeight;

    let left = Number(evento.clientX || 0);
    let top = Number(evento.clientY || 0);

    if (left + largura > window.innerWidth - margem) {
      left = window.innerWidth - largura - margem;
    }

    if (top + altura > window.innerHeight - margem) {
      top = window.innerHeight - altura - margem;
    }

    menu.style.left = `${Math.max(margem, left)}px`;
    menu.style.top = `${Math.max(margem, top)}px`;

    const abrir = () => menu.classList.add("aberto");
    if (typeof window?.requestAnimationFrame === "function") {
      window.requestAnimationFrame(abrir);
    } else {
      setTimeout(abrir, 0);
    }
  }

  if (botaoArquivar) {
    botaoArquivar.addEventListener("click", async () => {
      const conversaId = obterConversaAtual?.();
      const conversa = conversaId ? conversas?.[conversaId] : null;
      if (!conversa) return;

      botaoArquivar.disabled = true;
      botaoArquivar.textContent = conversa.arquivada
        ? "Desarquivando..."
        : "Arquivando...";

      await alterarArquivamento(conversa);
      atualizarBotaoArquivar();
    });
  }

  if (botaoTrancar) {
    botaoTrancar.addEventListener("click", async () => {
      const conversaId = obterConversaAtual?.();
      const conversa = conversaId ? conversas?.[conversaId] : null;
      if (!conversa) return;

      botaoTrancar.disabled = true;
      await alterarTrancamento(conversa);
      atualizarBotaoTrancar();
    });
  }

  return {
    ehGrupo,
    atualizarBotaoTrancar,
    alterarTrancamento,
    atualizarBotaoArquivar,
    alterarArquivamento,
    notificacoesSilenciadas,
    alternarNotificacoes,
    alterarBloqueio,
    abrirGerenciamento,
    sairDoGrupo,
    marcarComoNaoLida,
    abrirMenuContextoLista,
    sairEApagarGrupo,
  };
}

module.exports = {
  criarModuloPrivacidadeConversa,
};
