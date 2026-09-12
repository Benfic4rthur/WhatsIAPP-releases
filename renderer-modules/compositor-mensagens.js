function criarModuloCompositorMensagens(deps = {}) {
  const {
    ipcRenderer,
    document,
    clipboard,
    crypto,
    fs,
    os,
    path,
    chatPrincipal,
    mensagens,
    statusChat,
    conversas,
    conversasProvisoriasNovaMensagem,
    obterConversaAtual,
    obterMensagemRespondendo,
    obterRespostaAtualParaEnvio,
    limparRespostaMensagem,
    atualizarBarraRespostaMensagem,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
    atualizarStatusCabecalho,
    requestAnimationFrame,
  } = deps;

  let fecharPaineisCompositorAtual = () => {};
  let confirmarEnvioAnexoAtual = null;

  const compositor = document.createElement("div");
  compositor.id = "compositorMensagem";
  Object.assign(compositor.style, {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: "8px",
    padding: "10px 14px",
    borderTop: "1px solid #202a2f",
    background: "#0f171b",
    boxSizing: "border-box",
    width: "100%",
    minHeight: "64px",
    position: "relative",
  });

  const ICONE_PLUS_COMPOSITOR = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14"></path>
    </svg>`;
  const ICONE_FIGURINHAS_COMPOSITOR = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="5"></rect>
      <path d="M9 10h.01M15 10h.01M9.3 14.2c.8.8 1.7 1.2 2.7 1.2s1.9-.4 2.7-1.2"></path>
    </svg>`;
  const ICONE_MIC_COMPOSITOR = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3"></rect>
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6"></path>
    </svg>`;

  const botaoAnexar = document.createElement("button");
  botaoAnexar.type = "button";
  botaoAnexar.title = "Anexar";
  botaoAnexar.setAttribute("aria-label", "Anexar");
  botaoAnexar.className = "compositor-acao compositor-anexar";
  botaoAnexar.innerHTML = ICONE_PLUS_COMPOSITOR;
  botaoAnexar.disabled = true;

  const botaoFigurinhas = document.createElement("button");
  botaoFigurinhas.type = "button";
  botaoFigurinhas.title = "Figurinhas";
  botaoFigurinhas.setAttribute("aria-label", "Figurinhas");
  botaoFigurinhas.className = "compositor-acao compositor-figurinhas";
  botaoFigurinhas.innerHTML = ICONE_FIGURINHAS_COMPOSITOR;
  botaoFigurinhas.disabled = true;

  const campoMensagem = document.createElement("textarea");
  campoMensagem.id = "campoMensagem";
  campoMensagem.rows = 1;
  campoMensagem.placeholder = "Digite uma mensagem";
  campoMensagem.disabled = true;

  const botaoMicrofone = document.createElement("button");
  botaoMicrofone.type = "button";
  botaoMicrofone.title = "Gravar áudio";
  botaoMicrofone.setAttribute("aria-label", "Gravar áudio");
  botaoMicrofone.className = "compositor-acao compositor-microfone";
  botaoMicrofone.innerHTML = ICONE_MIC_COMPOSITOR;
  botaoMicrofone.disabled = true;

  // Mantido apenas como controle interno do fluxo de envio por Enter.
  // O botao visual foi removido para seguir o padrao do WhatsApp Web.
  const botaoEnviarMensagem = document.createElement("button");
  botaoEnviarMensagem.id = "botaoEnviarMensagem";
  botaoEnviarMensagem.type = "button";
  botaoEnviarMensagem.disabled = true;
  botaoEnviarMensagem.style.display = "none";

  Object.assign(campoMensagem.style, {
    flex: "1 1 0",
    width: "auto",
    minWidth: "0",
    height: "42px",
    minHeight: "42px",
    maxHeight: "140px",
    boxSizing: "border-box",
    resize: "none",
    overflowY: "hidden",
    padding: "10px 15px",
    margin: "0",
    borderRadius: "21px",
    border: "1px solid #2a3942",
    outline: "none",
    background: "#182229",
    color: "#e9edef",
    font: "inherit",
    fontSize: "14px",
    lineHeight: "20px",
  });

  const barraResposta = document.createElement("div");
  barraResposta.id = "barraRespostaMensagem";
  barraResposta.className = "barra-resposta-mensagem";
  barraResposta.style.display = "none";
  const conteudoBarraResposta = document.createElement("div");
  conteudoBarraResposta.className = "barra-resposta-conteudo";
  const autorBarraResposta = document.createElement("div");
  autorBarraResposta.className = "barra-resposta-autor";
  const previewBarraResposta = document.createElement("div");
  previewBarraResposta.className = "barra-resposta-preview";
  conteudoBarraResposta.appendChild(autorBarraResposta);
  conteudoBarraResposta.appendChild(previewBarraResposta);
  const botaoCancelarResposta = document.createElement("button");
  botaoCancelarResposta.type = "button";
  botaoCancelarResposta.className = "barra-resposta-fechar";
  botaoCancelarResposta.textContent = "×";
  botaoCancelarResposta.title = "Cancelar resposta";
  botaoCancelarResposta.setAttribute("aria-label", "Cancelar resposta");
  barraResposta.appendChild(conteudoBarraResposta);
  barraResposta.appendChild(botaoCancelarResposta);

  const menuAnexos = document.createElement("div");
  menuAnexos.className = "menu-anexos-whatsapp";
  menuAnexos.style.display = "none";

  const painelContatosCompositor = document.createElement("section");
  painelContatosCompositor.className =
    "painel-compositor painel-contatos-compositor";
  painelContatosCompositor.hidden = true;
  painelContatosCompositor.innerHTML = `
    <div class="painel-compositor-topo">
      <strong>Compartilhar contato</strong>
      <button type="button" class="painel-compositor-fechar" aria-label="Fechar">×</button>
    </div>
    <div class="painel-compositor-busca-wrap">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
      <input type="text" class="painel-compositor-busca" placeholder="Pesquisar contato">
    </div>
    <div class="painel-contatos-lista"></div>
  `;

  const painelFigurinhasCompositor = document.createElement("section");
  painelFigurinhasCompositor.className =
    "painel-compositor painel-figurinhas-compositor";
  painelFigurinhasCompositor.hidden = true;
  painelFigurinhasCompositor.innerHTML = `
    <div class="painel-compositor-topo painel-figurinhas-topo">
      <div>
        <strong>Figurinhas</strong>
        <span>Recentes e disponíveis no WhatsApp</span>
      </div>
      <button type="button" class="painel-compositor-fechar" aria-label="Fechar">×</button>
    </div>
    <div class="painel-figurinhas-grade">
      <div class="painel-compositor-vazio">Abra para carregar suas figurinhas.</div>
    </div>
  `;

  compositor.appendChild(barraResposta);
  compositor.appendChild(botaoAnexar);
  compositor.appendChild(botaoFigurinhas);
  compositor.appendChild(campoMensagem);
  compositor.appendChild(botaoMicrofone);
  compositor.appendChild(menuAnexos);
  compositor.appendChild(painelContatosCompositor);
  compositor.appendChild(painelFigurinhasCompositor);

  if (chatPrincipal) {
    chatPrincipal.style.position = "relative";
    chatPrincipal.appendChild(compositor);
  }

  function conversaAtualId() {
    return String(obterConversaAtual?.() || "").trim() || null;
  }

  function atualizarCompositor() {
    const conversaAtual = conversaAtualId();
    const habilitado = !!conversaAtual && !!conversas[conversaAtual];
    compositor.style.display = habilitado ? "flex" : "none";
    campoMensagem.disabled = !habilitado;
    botaoEnviarMensagem.disabled = !habilitado;
    botaoAnexar.disabled = !habilitado;
    botaoFigurinhas.disabled = !habilitado;
    botaoMicrofone.disabled = !habilitado;
    if (!habilitado) {
      fecharPaineisCompositorAtual();
      campoMensagem.value = "";
      limparRespostaMensagem(false);
    } else {
      atualizarBarraRespostaMensagem();
    }
  }

  const DURACAO_ANIMACAO_ENVIO_TEXTO = 620;

  function iniciarAnimacaoEnvioTexto(texto) {
    const valor = String(texto || "").trim();
    if (!valor || !campoMensagem || !mensagens) {
      return null;
    }
    const origem = campoMensagem.getBoundingClientRect();
    const areaMensagens = mensagens.getBoundingClientRect();
    if (!origem.width || !origem.height || !areaMensagens.width) {
      return null;
    }
    const fantasma = document.createElement("div");
    fantasma.className = "mensagem-envio-fantasma";
    fantasma.textContent = valor;
    const larguraMaxima = Math.max(
      120,
      Math.min(460, areaMensagens.width * 0.72),
    );
    Object.assign(fantasma.style, {
      left: "0px",
      top: "0px",
      maxWidth: `${larguraMaxima}px`,
    });
    document.body.appendChild(fantasma);
    const medida = fantasma.getBoundingClientRect();
    const largura = Math.min(larguraMaxima, Math.max(72, medida.width));
    fantasma.style.width = `${largura}px`;
    const altura = fantasma.getBoundingClientRect().height;
    const inicioLeft = Math.max(origem.left + 12, origem.right - largura - 18);
    const inicioTop = origem.top + Math.max(0, (origem.height - altura) / 2);
    const destinoLeft = Math.max(
      areaMensagens.left + 24,
      areaMensagens.right - largura - 28,
    );
    const destinoTop = Math.max(
      areaMensagens.top + 24,
      areaMensagens.bottom - altura - 24,
    );
    const dx = destinoLeft - inicioLeft;
    const dy = destinoTop - inicioTop;
    fantasma.style.left = `${inicioLeft}px`;
    fantasma.style.top = `${inicioTop}px`;
    fantasma.style.setProperty("--envio-x-meio", `${dx * 0.54}px`);
    fantasma.style.setProperty("--envio-y-meio", `${dy * 0.58 - 26}px`);
    fantasma.style.setProperty("--envio-x-quase", `${dx * 0.93}px`);
    fantasma.style.setProperty("--envio-y-quase", `${dy - 12}px`);
    fantasma.style.setProperty("--envio-x", `${dx}px`);
    fantasma.style.setProperty("--envio-y", `${dy}px`);
    fantasma.style.setProperty("--envio-y-impacto", `${dy + 4}px`);
    void fantasma.offsetWidth;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fantasma.classList.add("animando");
      });
    });
    const timer = setTimeout(() => {
      fantasma.remove();
    }, DURACAO_ANIMACAO_ENVIO_TEXTO + 120);
    return {
      falhar() {
        clearTimeout(timer);
        if (!fantasma.isConnected) {
          return;
        }
        fantasma.classList.remove("animando");
        void fantasma.offsetWidth;
        fantasma.classList.add("falhou");
        setTimeout(() => fantasma.remove(), 260);
      },
    };
  }

  function ajustarAlturaCampoMensagem() {
    campoMensagem.style.height = "auto";
    const alturaMinima = 42;
    const alturaMaxima = 140;
    const alturaConteudo = campoMensagem.scrollHeight;
    const altura = Math.min(
      Math.max(alturaConteudo, alturaMinima),
      alturaMaxima,
    );
    campoMensagem.style.height = `${altura}px`;
    campoMensagem.style.overflowY =
      alturaConteudo > alturaMaxima ? "auto" : "hidden";
  }

  async function enviarTextoAtual() {
    const conversaAtual = conversaAtualId();
    const conversa = conversas[conversaAtual];
    const texto = campoMensagem.value.trim();
    if (!conversa || !texto) {
      return;
    }
    const textoOriginal = campoMensagem.value;
    const respostaEnvio = obterRespostaAtualParaEnvio();
    // O evento envio-texto-estado insere a mensagem real pendente, com relogio.
    // Nao criar tambem a bolha temporaria da animacao.
    const animacaoVisualEnvio = null;
    const desarquivadaLocalmente = desarquivarLocalmenteAoEnviar(conversa);
    botaoEnviarMensagem.disabled = true;
    campoMensagem.disabled = true;
    botaoEnviarMensagem.textContent = "…";
    try {
      const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
        conversaId: conversa.id,
        texto,
        resposta: respostaEnvio,
      });
      if (!resultado?.ok) {
        animacaoVisualEnvio?.falhar?.();
        restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);
        statusChat.textContent =
          resultado?.erro || "Não foi possível enviar a mensagem.";
        campoMensagem.value = textoOriginal;
        ajustarAlturaCampoMensagem();
        return;
      }
      if (conversa.provisoriaNovaConversa) {
        delete conversa.provisoriaNovaConversa;
        conversasProvisoriasNovaMensagem.delete(conversa.id);
      }
      campoMensagem.value = "";
      ajustarAlturaCampoMensagem();
      const mensagemRespondendo = obterMensagemRespondendo?.();
      if (
        respostaEnvio &&
        mensagemRespondendo?.idMensagem === respostaEnvio.idMensagem &&
        mensagemRespondendo?.conversaId === conversa.id
      ) {
        limparRespostaMensagem(false);
      }
      atualizarStatusCabecalho();
    } catch (erro) {
      animacaoVisualEnvio?.falhar?.();
      restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);
      statusChat.textContent = erro?.message || "Erro ao enviar mensagem.";
      campoMensagem.value = textoOriginal;
      ajustarAlturaCampoMensagem();
    } finally {
      const conversaAindaAtual = conversaAtualId();
      const aindaAberta = conversaAindaAtual && !!conversas[conversaAindaAtual];
      campoMensagem.disabled = !aindaAberta;
      botaoEnviarMensagem.disabled = !aindaAberta;
      botaoEnviarMensagem.textContent = "➤";
      if (aindaAberta) {
        campoMensagem.focus();
      }
    }
  }

  campoMensagem.addEventListener("input", ajustarAlturaCampoMensagem);

  function inserirTextoNoCampoMensagem(texto) {
    const valor = String(texto || "");
    if (!valor) {
      return;
    }
    const inicio =
      typeof campoMensagem.selectionStart === "number"
        ? campoMensagem.selectionStart
        : campoMensagem.value.length;
    const fim =
      typeof campoMensagem.selectionEnd === "number"
        ? campoMensagem.selectionEnd
        : inicio;
    campoMensagem.setRangeText(valor, inicio, fim, "end");
    ajustarAlturaCampoMensagem();
    campoMensagem.focus();
  }

  async function enviarImagemDaAreaTransferencia() {
    const conversaAtual = conversaAtualId();
    const conversa = conversas[conversaAtual];
    if (!conversa) {
      return false;
    }
    const imagem = clipboard.readImage();
    if (!imagem || imagem.isEmpty()) {
      return false;
    }
    const bytes = imagem.toPNG();
    if (!bytes?.length) {
      return false;
    }
    const nomeArquivo = `whatsiapp-colagem-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}.png`;
    const caminhoTemporario = path.join(os.tmpdir(), nomeArquivo);
    try {
      fs.writeFileSync(caminhoTemporario, bytes);
      const selecionado = {
        ok: true,
        caminho: caminhoTemporario,
        fileName: "Imagem colada.png",
        tipo: "imagem",
      };
      const legenda = campoMensagem.value;
      const respostaEnvio = obterRespostaAtualParaEnvio();
      if (typeof confirmarEnvioAnexoAtual !== "function") {
        statusChat.textContent = "Não foi possível preparar a imagem.";
        return true;
      }
      const confirmacao = await confirmarEnvioAnexoAtual(selecionado, legenda);
      if (!confirmacao?.confirmado) {
        return true;
      }
      const legendaFinal = String(confirmacao.legenda || "").trim();
      botaoAnexar.disabled = true;
      botaoFigurinhas.disabled = true;
      botaoEnviarMensagem.disabled = true;
      botaoFigurinhas.disabled = true;
      botaoMicrofone.disabled = true;
      statusChat.textContent = "Enviando foto...";
      const desarquivadaLocalmente = desarquivarLocalmenteAoEnviar(conversa);
      const resultado = await ipcRenderer.invoke("enviar-anexo", {
        conversaId: conversa.id,
        caminho: caminhoTemporario,
        tipo: "imagem",
        legenda: legendaFinal,
        resposta: respostaEnvio,
      });
      if (!resultado?.ok) {
        restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);
        statusChat.textContent =
          resultado?.erro || "Não foi possível enviar a imagem.";
        return true;
      }
      campoMensagem.value = "";
      ajustarAlturaCampoMensagem();
      const mensagemRespondendo = obterMensagemRespondendo?.();
      if (
        respostaEnvio &&
        mensagemRespondendo?.idMensagem === respostaEnvio.idMensagem &&
        mensagemRespondendo?.conversaId === conversa.id
      ) {
        limparRespostaMensagem(false);
      }
      statusChat.textContent = "";
      return true;
    } catch (erro) {
      statusChat.textContent = erro?.message || "Erro ao colar a imagem.";
      return true;
    } finally {
      try {
        if (fs.existsSync(caminhoTemporario)) {
          fs.unlinkSync(caminhoTemporario);
        }
      } catch {}
      atualizarCompositor();
    }
  }

  async function colarDaAreaTransferencia() {
    if (campoMensagem.disabled) {
      return;
    }
    const formatos = clipboard.availableFormats();
    const temImagem = formatos.some((formato) =>
      /^image\//i.test(String(formato)),
    );
    if (temImagem) {
      const processada = await enviarImagemDaAreaTransferencia();
      if (processada) {
        return;
      }
    }
    const texto = clipboard.readText();
    if (texto) {
      inserirTextoNoCampoMensagem(texto);
    }
  }

  campoMensagem.addEventListener("paste", (evento) => {
    evento.preventDefault();
    colarDaAreaTransferencia();
  });

  campoMensagem.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && obterMensagemRespondendo?.()) {
      evento.preventDefault();
      limparRespostaMensagem(true);
      return;
    }
    const atalhoColar =
      (evento.ctrlKey || evento.metaKey) &&
      String(evento.key || "").toLowerCase() === "v";
    if (atalhoColar) {
      evento.preventDefault();
      colarDaAreaTransferencia();
      return;
    }
    if (evento.key === "Enter" && !evento.shiftKey) {
      evento.preventDefault();
      enviarTextoAtual();
    }
  });

  botaoEnviarMensagem.addEventListener("click", enviarTextoAtual);

  function configurarIntegracoes(integracoes = {}) {
    if (typeof integracoes.fecharPaineisCompositor === "function") {
      fecharPaineisCompositorAtual = integracoes.fecharPaineisCompositor;
    }
    if (typeof integracoes.confirmarEnvioAnexo === "function") {
      confirmarEnvioAnexoAtual = integracoes.confirmarEnvioAnexo;
    }
  }

  console.log("[COMPOSITOR MODULE] initialized");

  return {
    compositor,
    campoMensagem,
    botaoAnexar,
    botaoFigurinhas,
    botaoMicrofone,
    botaoEnviarMensagem,
    barraResposta,
    conteudoBarraResposta,
    autorBarraResposta,
    previewBarraResposta,
    botaoCancelarResposta,
    menuAnexos,
    painelContatosCompositor,
    painelFigurinhasCompositor,
    atualizarCompositor,
    ajustarAlturaCampoMensagem,
    configurarIntegracoes,
  };
}

module.exports = {
  criarModuloCompositorMensagens,
};
