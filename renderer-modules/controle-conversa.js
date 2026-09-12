const crypto = require("crypto");

function descricaoCurtaMensagemResposta(msg) {
  const texto = String(msg?.texto || "")
    .replace(/\s+/g, " ")
    .trim();

  if (texto) {
    return texto.length > 170 ? `${texto.slice(0, 167)}...` : texto;
  }

  const tipo = String(msg?.tipo || "").toLowerCase();

  if (tipo === "imagem") return "📷 Foto";
  if (tipo === "video") return "🎥 Vídeo";
  if (tipo === "audio") return "🎤 Áudio";
  if (tipo === "sticker") return "🧩 Figurinha";
  if (tipo === "documento") return `📎 ${msg?.fileName || "Documento"}`;
  if (tipo === "view_once") return "① Mídia de visualização única";
  if (tipo === "localizacao") return "📍 Localização";
  if (tipo === "contato") return "👤 Contato";

  return "Mensagem";
}

function hashSenhaTrancadas(valor) {
  return crypto
    .createHash("sha256")
    .update(String(valor || ""), "utf8")
    .digest("hex");
}

function criarModuloControleConversa(deps = {}) {
  const {
    document,
    window,
    localStorage,
    conversas,
    CHAVE_HASH_TRANCADAS,
    obterConversaAtual,
    definirConversaAtual,
    obterModoIAAtual,
    definirModoIAAtual,
    obterAbaAtual,
    definirAbaAtual,
    definirFiltro,
    definirTrancadasLiberadas,
    obterModuloListaConversas,
  } = deps;

  let integracoes = {};
  let mensagemRespondendo = null;
  let tokenFixacaoFimConversa = 0;
  let usuarioCancelouFixacaoFim = false;
  let configuracaoSenhaTentada = false;
  let listenersScrollConfigurados = false;
  let listenersRespostaConfigurados = false;
  let retornoPerfilGrupo = null;

  function removerBotaoVoltarPerfilGrupo() {
    document?.getElementById?.("btnVoltarPerfilOrigemGrupo")?.remove?.();
  }

  function limparRetornoPerfilGrupo() {
    retornoPerfilGrupo = null;
    removerBotaoVoltarPerfilGrupo();
  }

  function voltarAoPerfilOrigemGrupo() {
    const retorno = retornoPerfilGrupo;

    if (!retorno?.conversaId || !conversas?.[retorno.conversaId]) {
      limparRetornoPerfilGrupo();
      return;
    }

    const conversaId = retorno.conversaId;
    limparRetornoPerfilGrupo();

    abrirConversa(conversaId);

    try {
      const Evento = window?.CustomEvent || globalThis.CustomEvent;
      if (typeof Evento === "function") {
        window?.dispatchEvent?.(
          new Evento("whatsiapp:abrir-perfil-origem-grupo", {
            detail: { conversaId },
          }),
        );
      }
    } catch {}
  }

  function atualizarBotaoVoltarPerfilGrupo() {
    removerBotaoVoltarPerfilGrupo();

    const conversaAtual = obterConversaAtual?.();
    const conversa = conversaAtual ? conversas?.[conversaAtual] : null;
    const deveMostrar =
      !!retornoPerfilGrupo?.conversaId &&
      !!conversa &&
      String(conversa?.id || "").endsWith("@g.us");

    if (!deveMostrar) {
      return;
    }

    const topo = document?.querySelector?.(".chat-topo");
    if (!topo) {
      return;
    }

    const origem = conversas?.[retornoPerfilGrupo.conversaId];
    const botao = document.createElement("button");
    botao.id = "btnVoltarPerfilOrigemGrupo";
    botao.type = "button";
    botao.title = origem?.nome
      ? `Voltar para o perfil de ${origem.nome}`
      : "Voltar para o perfil";
    botao.setAttribute("aria-label", botao.title);
    botao.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M15 18l-6-6 6-6"/></svg>';

    Object.assign(botao.style, {
      width: "36px",
      height: "36px",
      minWidth: "36px",
      marginRight: "4px",
      padding: "0",
      border: "0",
      borderRadius: "50%",
      background: "transparent",
      color: "#d9e2e7",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      flex: "0 0 auto",
    });

    botao.addEventListener("mouseenter", () => {
      botao.style.background = "rgba(255,255,255,.08)";
    });
    botao.addEventListener("mouseleave", () => {
      botao.style.background = "transparent";
    });
    botao.addEventListener("click", (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      voltarAoPerfilOrigemGrupo();
    });

    topo.insertBefore(botao, topo.firstChild);
  }

  function configurarIntegracoes(novasIntegracoes = {}) {
    if (novasIntegracoes && typeof novasIntegracoes === "object") {
      integracoes = {
        ...integracoes,
        ...novasIntegracoes,
      };
    }

    const mensagens = integracoes.mensagens;

    if (mensagens && !listenersScrollConfigurados) {
      mensagens.addEventListener(
        "wheel",
        () => {
          cancelarFixacaoFimConversa();
        },
        { passive: true },
      );

      mensagens.addEventListener(
        "pointerdown",
        () => {
          cancelarFixacaoFimConversa();
        },
        { passive: true },
      );

      listenersScrollConfigurados = true;
    }

    const botaoCancelarResposta = integracoes.botaoCancelarResposta;
    const conteudoBarraResposta = integracoes.conteudoBarraResposta;

    if (
      botaoCancelarResposta &&
      conteudoBarraResposta &&
      !listenersRespostaConfigurados
    ) {
      botaoCancelarResposta.addEventListener("click", (evento) => {
        evento.stopPropagation();
        limparRespostaMensagem(true);
      });

      conteudoBarraResposta.addEventListener("click", () => {
        const resposta = obterRespostaAtualParaEnvio();
        if (resposta?.idMensagem) {
          destacarMensagemRespondida(resposta.idMensagem);
        }
      });

      listenersRespostaConfigurados = true;
    }
  }

  function cancelarFixacaoFimConversa() {
    usuarioCancelouFixacaoFim = true;
    tokenFixacaoFimConversa += 1;
  }

  function fixarConversaNoFimDuranteAbertura(conversaId, duracaoMs = 1800) {
    const mensagens = integracoes.mensagens;
    if (!mensagens) {
      return;
    }

    const token = ++tokenFixacaoFimConversa;
    usuarioCancelouFixacaoFim = false;
    const inicio = Date.now();
    let ultimoScrollHeight = -1;

    const ajustar = () => {
      if (
        token !== tokenFixacaoFimConversa ||
        usuarioCancelouFixacaoFim ||
        obterConversaAtual?.() !== conversaId
      ) {
        return;
      }

      const alturaAtual = mensagens.scrollHeight;

      if (alturaAtual !== ultimoScrollHeight || Date.now() - inicio < 250) {
        mensagens.scrollTop = mensagens.scrollHeight;
        ultimoScrollHeight = alturaAtual;
      }

      if (Date.now() - inicio < duracaoMs) {
        setTimeout(ajustar, 70);
      } else {
        mensagens.scrollTop = mensagens.scrollHeight;
      }
    };

    const raf =
      integracoes.requestAnimationFrame ||
      window?.requestAnimationFrame?.bind(window) ||
      ((callback) => setTimeout(callback, 0));

    raf(() => {
      mensagens.scrollTop = mensagens.scrollHeight;
      ajustar();
    });
  }

  function obterMensagemRespondendo() {
    return mensagemRespondendo;
  }

  function obterRespostaAtualParaEnvio() {
    const conversaAtual = obterConversaAtual?.();

    if (
      !mensagemRespondendo ||
      !conversaAtual ||
      mensagemRespondendo.conversaId !== conversaAtual
    ) {
      return null;
    }

    return {
      idMensagem: mensagemRespondendo.idMensagem,
      idMensagemWpp: mensagemRespondendo.idMensagemWpp || null,
      minha: !!mensagemRespondendo.minha,
      texto: mensagemRespondendo.texto || "",
      tipo: mensagemRespondendo.tipo || "texto",
      fileName: mensagemRespondendo.fileName || null,
    };
  }

  function atualizarBarraRespostaMensagem() {
    const resposta = obterRespostaAtualParaEnvio();
    const conversaAtual = obterConversaAtual?.();
    const compositor = integracoes.compositor;
    const barraResposta = integracoes.barraResposta;
    const autorBarraResposta = integracoes.autorBarraResposta;
    const previewBarraResposta = integracoes.previewBarraResposta;

    if (!barraResposta || !compositor) {
      return;
    }

    if (!resposta || !conversas?.[conversaAtual]) {
      barraResposta.style.display = "none";
      compositor.classList.remove("compositor-respondendo");
      return;
    }

    const conversa = conversas[conversaAtual];

    if (autorBarraResposta) {
      autorBarraResposta.textContent = resposta.minha
        ? "Respondendo a você"
        : `Respondendo a ${conversa.nome || "contato"}`;
    }

    if (previewBarraResposta) {
      previewBarraResposta.textContent =
        descricaoCurtaMensagemResposta(resposta);
    }

    barraResposta.style.display = "flex";
    compositor.classList.add("compositor-respondendo");
  }

  function limparRespostaMensagem(focarCampo = false) {
    mensagemRespondendo = null;
    atualizarBarraRespostaMensagem();

    const conversaAtual = obterConversaAtual?.();
    const campoMensagem = integracoes.campoMensagem;

    if (
      focarCampo &&
      conversaAtual &&
      conversas?.[conversaAtual] &&
      campoMensagem &&
      !campoMensagem.disabled
    ) {
      campoMensagem.focus();
    }
  }

  function ativarRespostaMensagem(msg) {
    const conversaAtual = obterConversaAtual?.();

    if (!msg?.idMensagem || !conversaAtual || !conversas?.[conversaAtual]) {
      return;
    }

    mensagemRespondendo = {
      conversaId: conversaAtual,
      idMensagem: String(msg.idMensagem),
      idMensagemWpp: msg.idMensagemWpp || null,
      minha: !!msg.minha,
      texto: descricaoCurtaMensagemResposta(msg),
      tipo: msg.tipo || "texto",
      fileName: msg.fileName || null,
    };

    atualizarBarraRespostaMensagem();
    integracoes.campoMensagem?.focus?.();
  }

  function localizarMensagemNaTela(idMensagem) {
    const mensagens = integracoes.mensagens;
    const id = String(idMensagem || "");

    if (!mensagens || !id) {
      return null;
    }

    return (
      Array.from(mensagens.querySelectorAll(".mensagem")).find(
        (item) => String(item.dataset.idMensagem || "") === id,
      ) || null
    );
  }

  function destacarMensagemRespondida(idMensagem) {
    const item = localizarMensagemNaTela(idMensagem);

    if (!item) {
      return;
    }

    item.scrollIntoView({ behavior: "smooth", block: "center" });
    item.classList.remove("mensagem-destacada-resposta");
    void item.offsetWidth;
    item.classList.add("mensagem-destacada-resposta");

    setTimeout(() => {
      item.classList.remove("mensagem-destacada-resposta");
    }, 950);
  }

  function bloquearTrancadas() {
    const moduloListaConversas = obterModuloListaConversas?.();

    if (moduloListaConversas?.bloquearTrancadas) {
      return moduloListaConversas.bloquearTrancadas();
    }

    definirTrancadasLiberadas?.(false);

    const abaTrancadas = document?.getElementById?.("btnRailTrancadas");
    if (abaTrancadas) {
      abaTrancadas.hidden = true;
    }

    if (obterAbaAtual?.() === "trancadas") {
      definirAbaAtual?.("conversas");
    }

    const busca = document?.getElementById?.("busca");
    if (busca) {
      busca.value = "";
    }

    definirFiltro?.("");
  }

  function totalConversasTrancadas() {
    return Object.values(conversas || {}).filter(
      (conversa) => conversa?.trancada,
    ).length;
  }

  function senhaTrancadasConfigurada() {
    return !!localStorage?.getItem?.(CHAVE_HASH_TRANCADAS);
  }

  function configurarSenhaTrancadasSeNecessario() {
    if (
      configuracaoSenhaTentada ||
      senhaTrancadasConfigurada() ||
      totalConversasTrancadas() === 0
    ) {
      return;
    }

    configuracaoSenhaTentada = true;

    const overlay = document.createElement("div");
    overlay.id = "configSenhaTrancadasOverlay";

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0, 0, 0, .72)",
    });

    const caixa = document.createElement("div");

    Object.assign(caixa.style, {
      width: "360px",
      maxWidth: "calc(100vw - 40px)",
      padding: "22px",
      borderRadius: "14px",
      background: "#111a1f",
      border: "1px solid #26343c",
      boxShadow: "0 20px 60px rgba(0, 0, 0, .45)",
      color: "#fff",
    });

    caixa.innerHTML = `
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;">
            Configurar acesso privado
        </div>
        <div style="font-size:13px;color:#93a4ae;line-height:1.45;margin-bottom:16px;">
            Defina o código que será digitado na busca para revelar as conversas trancadas.
        </div>
        <input
            id="senhaTrancadas1"
            type="password"
            autocomplete="new-password"
            placeholder="Código secreto"
            style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;"
        >
        <input
            id="senhaTrancadas2"
            type="password"
            autocomplete="new-password"
            placeholder="Confirmar código"
            style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:8px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;"
        >
        <div
            id="erroSenhaTrancadas"
            style="min-height:18px;font-size:12px;color:#ff6b6b;margin-bottom:8px;"
        ></div>
        <button
            id="salvarSenhaTrancadas"
            type="button"
            style="width:100%;padding:11px;border:0;border-radius:8px;background:#20b35b;color:white;font-weight:700;cursor:pointer;"
        >
            Salvar
        </button>
    `;

    overlay.appendChild(caixa);
    document.body.appendChild(overlay);

    const campo1 = caixa.querySelector("#senhaTrancadas1");
    const campo2 = caixa.querySelector("#senhaTrancadas2");
    const erro = caixa.querySelector("#erroSenhaTrancadas");
    const salvar = caixa.querySelector("#salvarSenhaTrancadas");

    function confirmar() {
      const primeira = campo1.value.trim();
      const segunda = campo2.value.trim();
      erro.textContent = "";

      if (primeira.length < 4) {
        erro.textContent = "Use pelo menos 4 caracteres.";
        return;
      }

      if (primeira !== segunda) {
        erro.textContent = "Os códigos não coincidem.";
        return;
      }

      localStorage.setItem(CHAVE_HASH_TRANCADAS, hashSenhaTrancadas(primeira));
      overlay.remove();
      document.getElementById("busca")?.focus?.();
    }

    salvar.addEventListener("click", confirmar);
    campo2.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") {
        confirmar();
      }
    });

    setTimeout(() => campo1.focus(), 50);
  }

  function solicitarSenhaParaTrancamento(titulo = "Confirmar código secreto") {
    return new Promise((resolve) => {
      const hashSalvo = localStorage.getItem(CHAVE_HASH_TRANCADAS);
      const criandoSenha = !hashSalvo;
      const overlay = document.createElement("div");

      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "100001",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.72)",
      });

      const caixa = document.createElement("div");

      Object.assign(caixa.style, {
        width: "360px",
        maxWidth: "calc(100vw - 40px)",
        padding: "22px",
        borderRadius: "14px",
        background: "#111a1f",
        border: "1px solid #26343c",
        boxShadow: "0 20px 60px rgba(0,0,0,.45)",
        color: "#fff",
      });

      caixa.innerHTML = `
            <div style="font-size:18px;font-weight:700;margin-bottom:8px;">
                ${criandoSenha ? "Criar código secreto" : titulo}
            </div>

            <div style="font-size:13px;color:#93a4ae;line-height:1.45;margin-bottom:16px;">
                ${
                  criandoSenha
                    ? "Defina o código usado para proteger as conversas trancadas no WhatsIAPP."
                    : "Digite o código secreto das conversas trancadas para continuar."
                }
            </div>

            <input
                id="senhaAcaoTrancada"
                type="password"
                autocomplete="off"
                placeholder="Código secreto"
                style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;"
            >

            ${
              criandoSenha
                ? `
                    <input
                        id="senhaAcaoTrancadaConfirmacao"
                        type="password"
                        autocomplete="off"
                        placeholder="Confirmar código"
                        style="box-sizing:border-box;width:100%;padding:11px 12px;margin-bottom:10px;border-radius:8px;border:1px solid #30414a;background:#0c1317;color:#fff;outline:none;"
                    >
                `
                : ""
            }

            <div
                id="erroSenhaAcaoTrancada"
                style="min-height:18px;font-size:12px;color:#ff6b6b;margin-bottom:8px;"
            ></div>

            <div style="display:flex;gap:8px;">
                <button
                    id="cancelarSenhaAcaoTrancada"
                    type="button"
                    style="flex:1;padding:11px;border:1px solid #30414a;border-radius:8px;background:#182126;color:#fff;cursor:pointer;"
                >
                    Cancelar
                </button>

                <button
                    id="confirmarSenhaAcaoTrancada"
                    type="button"
                    style="flex:1;padding:11px;border:0;border-radius:8px;background:#20b35b;color:#fff;font-weight:700;cursor:pointer;"
                >
                    Confirmar
                </button>
            </div>
        `;

      overlay.appendChild(caixa);
      document.body.appendChild(overlay);

      const senha = caixa.querySelector("#senhaAcaoTrancada");
      const confirmacao = caixa.querySelector("#senhaAcaoTrancadaConfirmacao");
      const erro = caixa.querySelector("#erroSenhaAcaoTrancada");

      const finalizar = (resultado) => {
        overlay.remove();
        resolve(resultado);
      };

      const confirmar = () => {
        const valor = senha.value.trim();
        erro.textContent = "";

        if (valor.length < 4) {
          erro.textContent = "Código inválido.";
          return;
        }

        if (criandoSenha) {
          if (valor !== confirmacao.value.trim()) {
            erro.textContent = "Os códigos não coincidem.";
            return;
          }

          localStorage.setItem(CHAVE_HASH_TRANCADAS, hashSenhaTrancadas(valor));
          finalizar(true);
          return;
        }

        if (hashSenhaTrancadas(valor) !== hashSalvo) {
          erro.textContent = "Código incorreto.";
          senha.select();
          return;
        }

        finalizar(true);
      };

      caixa
        .querySelector("#confirmarSenhaAcaoTrancada")
        .addEventListener("click", confirmar);

      caixa
        .querySelector("#cancelarSenhaAcaoTrancada")
        .addEventListener("click", () => finalizar(false));

      overlay.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape") {
          finalizar(false);
        }

        if (evento.key === "Enter") {
          confirmar();
        }
      });

      setTimeout(() => senha.focus(), 30);
    });
  }

  function limparSelecaoConversa(texto = "Nenhuma conversa aberta") {
    limparRetornoPerfilGrupo();
    integracoes.cancelarRespostaAutomaticaIAEmAndamento?.();
    integracoes.moduloAudio?.descartarAudioAoTrocarConversa?.();
    limparRespostaMensagem(false);
    integracoes.cancelarSugestaoIAEmAndamento?.();
    integracoes.fecharPerfilContato?.();

    definirConversaAtual?.(null);

    if (integracoes.nomeChat) {
      integracoes.nomeChat.textContent = "Selecione uma conversa";
    }

    if (integracoes.statusChat) {
      integracoes.statusChat.textContent = "";
    }

    if (integracoes.mensagens) {
      integracoes.mensagens.innerHTML =
        integracoes.obterMarkupEstadoInicialChat?.(texto) || "";
    }

    integracoes.aplicarAparenciaConversa?.(null);
    integracoes.atualizarBotaoArquivar?.();
    integracoes.atualizarBotaoTrancar?.();
    integracoes.atualizarCompositor?.();
    integracoes.atualizarCabecalhoConversa?.();
    integracoes.atualizarBotoesModoIA?.();
    integracoes.atualizarControleSegundoPlanoIA?.();
    integracoes.atualizarIndicadorGeracaoAutomaticaIA?.();

    if (obterModoIAAtual?.() === "assistido") {
      integracoes.mostrarEstadoPainelIA?.(
        "Selecione uma conversa para gerar uma resposta.",
      );
    } else {
      integracoes.mostrarEstadoPainelIA?.(
        "Modo Manual ativo. Selecione Assistido para receber sugestões da IA.",
      );
    }
  }

  function abrirConversa(id, opcoes = {}) {
    const origemPerfilContatoId = String(
      opcoes?.origemPerfilContatoId || "",
    ).trim();

    if (origemPerfilContatoId && conversas?.[origemPerfilContatoId]) {
      retornoPerfilGrupo = {
        conversaId: origemPerfilContatoId,
        grupoId: String(id || ""),
      };
    } else {
      limparRetornoPerfilGrupo();
    }

    integracoes.fecharPerfilContato?.();

    const conversaAnterior = obterConversaAtual?.();

    if (conversaAnterior && conversaAnterior !== id) {
      cancelarFixacaoFimConversa();
      integracoes.cancelarRespostaAutomaticaIAEmAndamento?.();
      integracoes.moduloAudio?.descartarAudioAoTrocarConversa?.();
      limparRespostaMensagem(false);
    }

    definirConversaAtual?.(id);

    const conversa = conversas?.[id];
    if (!conversa) {
      return;
    }

    definirModoIAAtual?.(integracoes.obterModoIAConversa?.(id) || "manual");
    integracoes.atualizarBotoesModoIA?.();
    integracoes.atualizarControleSegundoPlanoIA?.();
    integracoes.atualizarIndicadorGeracaoAutomaticaIA?.();

    const tinhaNaoLidasAntesDeAbrir = Number(conversa.naoLidasLocal || 0) > 0;
    const ultimaAntesDeAbrir =
      integracoes.obterUltimaMensagemRelevanteIA?.(conversa);
    const baseUltimaAntesDeAbrir =
      ultimaAntesDeAbrir && !ultimaAntesDeAbrir.minha
        ? integracoes.chaveBaseSugestaoIA?.(conversa, ultimaAntesDeAbrir)
        : null;

    integracoes.marcarConversaComoLidaLocal?.(conversa);
    integracoes.marcarConversaComoLidaWhatsapp?.(conversa);

    if (integracoes.nomeChat) {
      integracoes.nomeChat.textContent = conversa.nome || conversa.id;
    }

    integracoes.atualizarStatusCabecalho?.();
    integracoes.renderConversas?.();
    integracoes.atualizarCompositor?.();
    integracoes.renderMensagens?.();
    fixarConversaNoFimDuranteAbertura(id);
    integracoes.atualizarBotaoArquivar?.();
    integracoes.atualizarBotaoTrancar?.();
    integracoes.atualizarCabecalhoConversa?.();
    atualizarBotaoVoltarPerfilGrupo();

    if (!conversa.fotoPerfilUrl && !conversa.fotoPerfilTentada) {
      integracoes.carregarFotoPerfil?.(conversa, true);
    }

    integracoes.assinarPresencaConversa?.(conversa);

    if (integracoes.ehConversaGrupo?.(conversa)) {
      void integracoes.carregarNomesParticipantesGrupo?.(conversa);
    }

    setTimeout(() => {
      integracoes.campoMensagem?.focus?.();
    }, 20);

    integracoes.carregarMidiasDaConversa?.();

    const modoIAAtual = obterModoIAAtual?.() || "manual";

    if (modoIAAtual === "assistido") {
      integracoes.agendarSugestaoIA?.(id, 180);
      return;
    }

    if (modoIAAtual !== "automatico") {
      return;
    }

    const agendouPendente =
      integracoes.tentarAgendarRespostaAutomaticaPendente?.(id, 4000) || false;

    if (
      !agendouPendente &&
      tinhaNaoLidasAntesDeAbrir &&
      baseUltimaAntesDeAbrir
    ) {
      const chaveProcessada = integracoes.chaveRespostaAutomaticaProcessada?.(
        id,
        baseUltimaAntesDeAbrir,
      );

      integracoes.limparCacheRespostasAutomaticas?.();

      if (
        chaveProcessada &&
        !integracoes.respostasAutomaticasProcessadas?.has?.(chaveProcessada)
      ) {
        integracoes.respostasAutomaticasPendentes?.set?.(id, {
          baseId: baseUltimaAntesDeAbrir,
          criadaEm: Date.now(),
        });

        integracoes.mostrarEstadoPainelIA?.(
          "Mensagem não lida encontrada. O Automático vai responder em alguns segundos.",
        );

        integracoes.agendarRespostaAutomaticaIA?.(
          id,
          baseUltimaAntesDeAbrir,
          4000,
        );
        return;
      }
    }

    if (!agendouPendente) {
      integracoes.mostrarEstadoPainelIA?.(
        "Modo Automático ativo nesta conversa aberta. Aguardando a próxima mensagem recebida.",
      );
    }
  }

  console.log("[CONTROLE CONVERSA MODULE] initialized");

  return {
    configurarIntegracoes,
    cancelarFixacaoFimConversa,
    obterMensagemRespondendo,
    obterRespostaAtualParaEnvio,
    atualizarBarraRespostaMensagem,
    limparRespostaMensagem,
    ativarRespostaMensagem,
    localizarMensagemNaTela,
    destacarMensagemRespondida,
    bloquearTrancadas,
    senhaTrancadasConfigurada,
    configurarSenhaTrancadasSeNecessario,
    solicitarSenhaParaTrancamento,
    limparSelecaoConversa,
    abrirConversa,
  };
}

module.exports = {
  criarModuloControleConversa,
  descricaoCurtaMensagemResposta,
  hashSenhaTrancadas,
};
