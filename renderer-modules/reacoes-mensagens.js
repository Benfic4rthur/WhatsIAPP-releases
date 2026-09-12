function criarModuloReacoes(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    localStorage,
    statusChat,
    conversas,
    obterConversaAtual,
    renderMensagens,
  } = dependencias;

  const CHAVE_REACOES_MENSAGENS = "whatsiapp.reacoesMensagens.v1";

  function chaveReacoesMensagem(conversaId, idMensagem) {
    const conversa = String(conversaId || "")
      .trim()
      .toLowerCase();
    const id = String(idMensagem || "").trim();

    if (!conversa || !id) {
      return null;
    }

    return `${conversa}|${id}`;
  }

  function normalizarEmojiReacao(emoji) {
    const texto = String(emoji || "").trim();

    if (["♥", "♥️", "❤", "❤️"].includes(texto)) {
      return "❤️";
    }

    return texto;
  }

  function normalizarListaReacoes(reacoes) {
    const mapa = new Map();

    for (const item of Array.isArray(reacoes) ? reacoes : []) {
      const emoji = normalizarEmojiReacao(item?.emoji);
      const total = Math.max(0, Number(item?.total || 0) || 0);

      if (!emoji || total <= 0) {
        continue;
      }

      const anterior = mapa.get(emoji);

      mapa.set(emoji, {
        emoji,
        total: Math.max(total, Number(anterior?.total || 0) || 0),
        minha: !!item?.minha || !!anterior?.minha,
      });
    }

    return Array.from(mapa.values());
  }

  function carregarReacoesPersistidas() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_REACOES_MENSAGENS) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const reacoesMensagensPersistidas = carregarReacoesPersistidas();

  function salvarReacoesPersistidas() {
    try {
      const entradas = Object.entries(reacoesMensagensPersistidas)
        .sort((a, b) => Number(b[1]?.salvoEm || 0) - Number(a[1]?.salvoEm || 0))
        .slice(0, 5000);

      const reduzido = Object.fromEntries(entradas);

      for (const chave of Object.keys(reacoesMensagensPersistidas)) {
        delete reacoesMensagensPersistidas[chave];
      }

      Object.assign(reacoesMensagensPersistidas, reduzido);

      localStorage.setItem(
        CHAVE_REACOES_MENSAGENS,
        JSON.stringify(reacoesMensagensPersistidas),
      );
    } catch {}
  }

  function registrarReacoesLocalmente(conversaId, idMensagem, reacoes) {
    const chave = chaveReacoesMensagem(conversaId, idMensagem);

    if (!chave) {
      return;
    }

    const normalizadas = normalizarListaReacoes(reacoes);

    if (!normalizadas.length) {
      delete reacoesMensagensPersistidas[chave];
    } else {
      reacoesMensagensPersistidas[chave] = {
        reacoes: normalizadas,
        salvoEm: Date.now(),
      };
    }

    salvarReacoesPersistidas();
  }

  function removerRegistroReacoes(conversaId, idMensagem) {
    const chave = chaveReacoesMensagem(conversaId, idMensagem);

    if (!chave || !reacoesMensagensPersistidas[chave]) {
      return;
    }

    delete reacoesMensagensPersistidas[chave];
    salvarReacoesPersistidas();
  }

  function aplicarEstadoReacoesPersistidas(conversaId, msg) {
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      return msg;
    }

    const chave = chaveReacoesMensagem(conversaId, msg?.idMensagem);
    const registro = chave ? reacoesMensagensPersistidas[chave] : null;

    if (!Array.isArray(registro?.reacoes)) {
      return msg;
    }

    return {
      ...msg,
      reacoes: normalizarListaReacoes(registro.reacoes),
    };
  }

  function limparReacoesPersistidasDaConversa(conversaId) {
    const prefixo = `${String(conversaId || "")
      .trim()
      .toLowerCase()}|`;

    if (prefixo === "|") {
      return false;
    }

    let mudou = false;

    for (const chave of Object.keys(reacoesMensagensPersistidas)) {
      if (chave.startsWith(prefixo)) {
        delete reacoesMensagensPersistidas[chave];
        mudou = true;
      }
    }

    if (mudou) {
      salvarReacoesPersistidas();
    }

    return mudou;
  }

  function dadosMensagemParaReacao(msg) {
    if (!msg?.idMensagem || msg?.apagadaParaTodos || msg?.tipo === "apagada") {
      return null;
    }

    const idMensagem = String(msg.idMensagem || "").trim();

    if (!idMensagem || idMensagem.startsWith("local-audio-")) {
      return null;
    }

    return {
      idMensagem,
      idMensagemWpp: msg.idMensagemWpp || null,
      minha: !!msg.minha,
      texto: String(msg.texto || ""),
      tipo: String(msg.tipo || "texto"),
      fileName: msg.fileName || null,
    };
  }

  function atualizarReacoesMensagemNaInterface(
    conversaId,
    idMensagem,
    reacoes,
  ) {
    const conversa = conversas[conversaId];
    const id = String(idMensagem || "").trim();

    if (!conversa || !id || !Array.isArray(conversa.mensagens)) {
      return false;
    }

    const msg = conversa.mensagens.find(
      (item) => String(item?.idMensagem || "") === id,
    );

    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      return false;
    }

    msg.reacoes = normalizarListaReacoes(reacoes);
    registrarReacoesLocalmente(conversaId, id, msg.reacoes);

    if (obterConversaAtual() === conversaId) {
      renderMensagens();
    }

    return true;
  }

  function criarLinhaReacoes(msg) {
    const reacoes = normalizarListaReacoes(msg?.reacoes);

    if (!reacoes.length) {
      return null;
    }

    const linha = document.createElement("div");

    Object.assign(linha.style, {
      position: "absolute",
      bottom: "-12px",
      zIndex: "6",
      display: "flex",
      alignItems: "center",
      maxWidth: "calc(100% - 20px)",
      pointerEvents: "auto",
    });

    if (msg?.minha) {
      linha.style.right = "9px";
    } else {
      linha.style.left = "9px";
    }

    const pill = document.createElement("button");
    pill.type = "button";

    const totalGeral = reacoes.reduce(
      (soma, reacao) => soma + Math.max(0, Number(reacao.total || 0) || 0),
      0,
    );

    const emojis = reacoes
      .slice(0, 3)
      .map((reacao) => reacao.emoji)
      .join(" ");

    pill.textContent = `${emojis}${totalGeral > 1 ? `  ${totalGeral}` : ""}`;
    pill.title = reacoes.some((reacao) => reacao.minha)
      ? "Reações, incluindo a sua"
      : "Reações à mensagem";

    Object.assign(pill.style, {
      minWidth: "28px",
      height: "24px",
      padding: "1px 7px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,.10)",
      background: "#202c33",
      boxShadow: "0 1px 2px rgba(0,0,0,.35)",
      color: "#e9edef",
      cursor: "pointer",
      fontSize: "13px",
      lineHeight: "20px",
      whiteSpace: "nowrap",
    });

    pill.addEventListener("click", (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      abrirReacoesMensagem(msg);
    });

    linha.appendChild(pill);

    return linha;
  }

  function abrirReacoesMensagem(msg) {
    const conversaId = obterConversaAtual();
    const conversa = conversas[conversaId];
    const mensagem = dadosMensagemParaReacao(msg);

    if (!conversa || !mensagem) {
      statusChat.textContent = "Aguarde o envio terminar antes de reagir.";
      return;
    }

    const overlay = document.createElement("div");

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "120250",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
      boxSizing: "border-box",
      background: "rgba(0,0,0,.42)",
    });

    const painel = document.createElement("section");
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-modal", "true");
    painel.setAttribute("aria-label", "Reagir à mensagem");

    Object.assign(painel.style, {
      width: "440px",
      maxWidth: "calc(100vw - 48px)",
      maxHeight: "min(620px, calc(100vh - 48px))",
      overflowX: "hidden",
      overflowY: "auto",
      padding: "16px",
      borderRadius: "16px",
      border: "1px solid #2b3941",
      background: "#111a1f",
      boxShadow: "0 22px 65px rgba(0,0,0,.55)",
      color: "#e9edef",
      boxSizing: "border-box",
    });

    const titulo = document.createElement("div");
    titulo.textContent = "Reagir à mensagem";

    Object.assign(titulo.style, {
      marginBottom: "12px",
      fontSize: "14px",
      fontWeight: "800",
      textAlign: "center",
    });

    const grade = document.createElement("div");

    Object.assign(grade.style, {
      display: "grid",
      gridTemplateColumns: "repeat(6, 1fr)",
      gap: "7px",
    });

    const reacaoMinhaAtual = normalizarListaReacoes(msg?.reacoes).find(
      (item) => item.minha,
    )?.emoji;

    let executando = false;

    const fechar = () => {
      if (!executando) {
        overlay.remove();
      }
    };

    const definirControlesDesabilitados = (desabilitados) => {
      for (const controle of painel.querySelectorAll("button, input")) {
        controle.disabled = !!desabilitados;
      }
    };

    const enviarReacao = async (emoji) => {
      if (executando) {
        return;
      }

      const emojiNormalizado = normalizarEmojiReacao(emoji);

      if (!emojiNormalizado) {
        return;
      }

      executando = true;

      const reacaoFinal =
        emojiNormalizado === reacaoMinhaAtual ? false : emojiNormalizado;

      definirControlesDesabilitados(true);

      try {
        const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
          reagir: {
            conversaId,
            mensagem,
            reacao: reacaoFinal,
          },
        });

        if (!resultado?.ok) {
          throw new Error(
            resultado?.erro || "Não foi possível enviar a reação.",
          );
        }

        atualizarReacoesMensagemNaInterface(
          conversaId,
          mensagem.idMensagem,
          resultado.reacoes || [],
        );

        overlay.remove();
      } catch (erro) {
        executando = false;
        definirControlesDesabilitados(false);
        titulo.textContent = erro?.message || "Não foi possível reagir.";
        titulo.style.color = "#ff8a8a";
      }
    };

    const criarBotaoEmoji = (emoji, tamanho = "rapido") => {
      const emojiNormalizado = normalizarEmojiReacao(emoji);
      const botao = document.createElement("button");
      const ehAtual = emojiNormalizado === reacaoMinhaAtual;

      botao.type = "button";
      botao.textContent = emojiNormalizado;
      botao.title = ehAtual
        ? "Remover esta reação"
        : `Reagir com ${emojiNormalizado}`;

      Object.assign(botao.style, {
        width: "100%",
        height: tamanho === "rapido" ? "48px" : "40px",
        minWidth: "0",
        marginTop: "0",
        padding: "0",
        borderRadius: tamanho === "rapido" ? "12px" : "10px",
        border: ehAtual ? "1px solid #20b35b" : "1px solid #2b3941",
        background: ehAtual ? "rgba(32,179,91,.18)" : "#182329",
        color: "#fff",
        cursor: "pointer",
        fontSize: tamanho === "rapido" ? "24px" : "21px",
        lineHeight: "1",
      });

      botao.addEventListener("mouseenter", () => {
        if (!botao.disabled && !ehAtual) {
          botao.style.background = "#223039";
        }
      });

      botao.addEventListener("mouseleave", () => {
        if (!ehAtual) {
          botao.style.background = "#182329";
        }
      });

      botao.addEventListener("click", () => enviarReacao(emojiNormalizado));

      return botao;
    };

    for (const emoji of ["👍", "❤️", "😂", "😮", "😢", "🙏"]) {
      grade.appendChild(criarBotaoEmoji(emoji, "rapido"));
    }

    const botaoMais = document.createElement("button");
    botaoMais.type = "button";
    botaoMais.textContent = "＋ Mais reações";

    Object.assign(botaoMais.style, {
      width: "100%",
      height: "38px",
      marginTop: "9px",
      borderRadius: "10px",
      border: "1px solid #2b3941",
      background: "#182329",
      color: "#dfe7eb",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: "700",
    });

    const areaMais = document.createElement("div");
    areaMais.style.display = "none";
    areaMais.style.width = "100%";
    areaMais.style.minWidth = "0";
    areaMais.style.marginTop = "12px";

    const divisor = document.createElement("div");
    Object.assign(divisor.style, {
      height: "1px",
      marginBottom: "12px",
      background: "#26343c",
    });

    const subtitulo = document.createElement("div");
    subtitulo.textContent = "Escolha qualquer emoji";

    Object.assign(subtitulo.style, {
      marginBottom: "8px",
      color: "#b9c5cb",
      fontSize: "12px",
      fontWeight: "700",
    });

    const gradeMais = document.createElement("div");

    Object.assign(gradeMais.style, {
      display: "grid",
      gridTemplateColumns: "repeat(9, minmax(0, 1fr))",
      gap: "5px",
      width: "100%",
      minWidth: "0",
      maxHeight: "220px",
      overflowX: "hidden",
      overflowY: "auto",
      paddingRight: "3px",
    });

    const emojisExtras = [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "🤣",
      "😊",
      "😇",
      "🙂",
      "🙃",
      "😉",
      "😍",
      "🥰",
      "😘",
      "😋",
      "😜",
      "🤪",
      "🤨",
      "🧐",
      "🤓",
      "😎",
      "🥳",
      "😏",
      "😒",
      "😔",
      "🥹",
      "😭",
      "😤",
      "😡",
      "🤬",
      "🤯",
      "😱",
      "😨",
      "🤔",
      "🫡",
      "🤭",
      "🫢",
      "🤫",
      "🫠",
      "😴",
      "🤤",
      "🤮",
      "🤢",
      "🤧",
      "😈",
      "👿",
      "💀",
      "☠️",
      "👻",
      "👽",
      "🤖",
      "💩",
      "🤡",
      "👎",
      "👌",
      "🤌",
      "🤏",
      "✌️",
      "🤞",
      "🫰",
      "🤟",
      "🤘",
      "🤙",
      "👈",
      "👉",
      "👆",
      "👇",
      "☝️",
      "👏",
      "🙌",
      "🫶",
      "🤝",
      "💪",
      "🫵",
      "👀",
      "🧠",
      "🫂",
      "💋",
      "💅",
      "👑",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "🤎",
      "💔",
      "❤️‍🔥",
      "❤️‍🩹",
      "💕",
      "💞",
      "💓",
      "💗",
      "💖",
      "💘",
      "💝",
      "💯",
      "🔥",
      "✨",
      "⭐",
      "🌟",
      "⚡",
      "💥",
      "💫",
      "🎉",
      "🎊",
      "✅",
      "❌",
      "⚠️",
      "🚀",
      "🎯",
      "🏆",
      "🥇",
      "🍻",
      "☕",
      "🍕",
      "🍿",
      "🌹",
      "🌈",
      "☀️",
      "🌙",
      "🐶",
      "🐱",
    ];

    const emojisVistos = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);

    for (const emoji of emojisExtras) {
      const normalizado = normalizarEmojiReacao(emoji);

      if (!normalizado || emojisVistos.has(normalizado)) {
        continue;
      }

      emojisVistos.add(normalizado);
      gradeMais.appendChild(criarBotaoEmoji(normalizado, "extra"));
    }

    const areaPersonalizada = document.createElement("div");

    Object.assign(areaPersonalizada.style, {
      display: "flex",
      alignItems: "center",
      gap: "7px",
      width: "100%",
      minWidth: "0",
      marginTop: "12px",
    });

    const campoEmoji = document.createElement("input");
    campoEmoji.type = "text";
    campoEmoji.placeholder = "Qualquer emoji, use Win + .";
    campoEmoji.autocomplete = "off";
    campoEmoji.spellcheck = false;

    Object.assign(campoEmoji.style, {
      flex: "1",
      minWidth: "0",
      height: "38px",
      boxSizing: "border-box",
      padding: "0 11px",
      borderRadius: "10px",
      border: "1px solid #2b3941",
      outline: "none",
      background: "#0d1519",
      color: "#fff",
      fontSize: "18px",
    });

    const botaoUsarEmoji = document.createElement("button");
    botaoUsarEmoji.type = "button";
    botaoUsarEmoji.textContent = "Reagir";

    Object.assign(botaoUsarEmoji.style, {
      flex: "0 0 86px",
      width: "86px",
      minWidth: "86px",
      height: "38px",
      marginTop: "0",
      padding: "0 12px",
      border: "0",
      borderRadius: "10px",
      background: "#20b35b",
      color: "#06120a",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: "800",
    });

    const obterPrimeiroEmojiDigitado = () => {
      const valor = String(campoEmoji.value || "").trim();

      if (!valor) {
        return "";
      }

      try {
        if (typeof Intl?.Segmenter === "function") {
          const segmentador = new Intl.Segmenter(undefined, {
            granularity: "grapheme",
          });

          const primeiro = Array.from(segmentador.segment(valor))[0]?.segment;

          return normalizarEmojiReacao(primeiro || "");
        }
      } catch {}

      return normalizarEmojiReacao(Array.from(valor)[0] || "");
    };

    const reagirComCampo = () => {
      const emoji = obterPrimeiroEmojiDigitado();

      if (!emoji) {
        campoEmoji.focus();
        return;
      }

      enviarReacao(emoji);
    };

    botaoUsarEmoji.addEventListener("click", reagirComCampo);

    campoEmoji.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter") {
        evento.preventDefault();
        reagirComCampo();
      }
    });

    areaPersonalizada.appendChild(campoEmoji);
    areaPersonalizada.appendChild(botaoUsarEmoji);

    const dicaMais = document.createElement("div");
    dicaMais.textContent =
      "Você também pode abrir o seletor de emojis do Windows com Win + .";

    Object.assign(dicaMais.style, {
      marginTop: "7px",
      color: "#71838d",
      fontSize: "10px",
      lineHeight: "1.4",
    });

    areaMais.appendChild(divisor);
    areaMais.appendChild(subtitulo);
    areaMais.appendChild(gradeMais);
    areaMais.appendChild(areaPersonalizada);
    areaMais.appendChild(dicaMais);

    botaoMais.addEventListener("click", () => {
      const abrindo = areaMais.style.display === "none";

      areaMais.style.display = abrindo ? "block" : "none";
      botaoMais.textContent = abrindo ? "− Menos reações" : "＋ Mais reações";

      if (abrindo) {
        painel.style.width = "500px";
      } else {
        painel.style.width = "440px";
      }
    });

    const dica = document.createElement("div");
    dica.textContent = reacaoMinhaAtual
      ? "Clique na sua reação atual para removê-la."
      : "Escolha uma reação.";

    Object.assign(dica.style, {
      marginTop: "10px",
      color: "#8fa1aa",
      fontSize: "11px",
      textAlign: "center",
    });

    painel.appendChild(titulo);
    painel.appendChild(grade);
    painel.appendChild(botaoMais);
    painel.appendChild(areaMais);
    painel.appendChild(dica);
    overlay.appendChild(painel);
    document.body.appendChild(overlay);

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

  return {
    normalizarEmojiReacao,
    normalizarListaReacoes,
    registrarReacoesLocalmente,
    removerRegistroReacoes,
    aplicarEstadoReacoesPersistidas,
    limparReacoesPersistidasDaConversa,
    dadosMensagemParaReacao,
    atualizarReacoesMensagemNaInterface,
    criarLinhaReacoes,
    abrirReacoesMensagem,
  };
}

module.exports = {
  criarModuloReacoes,
};
