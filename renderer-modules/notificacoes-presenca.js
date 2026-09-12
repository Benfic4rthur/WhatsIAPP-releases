function criarModuloNotificacoesPresenca(deps = {}) {
  const {
    ipcRenderer,
    window,
    document,
    localStorage,
    conversas,
    statusChat,
    toastInternoContainer,
    inicialDoContato,
    abrirConversa,
    ehGrupoConversa,
    renderMensagens,
    obterConversaAtual,
    obterSincronizacaoInicialConcluida,
  } = deps;

  const CHAVE_NOTIFICACOES_DESATIVADAS =
    "whatsiapp.notificacoes.desativadas.v1";

  let contextoAudioNotificacao = null;
  let ultimaNotificacaoSonoraEm = 0;

  const timersPresenca = new Map();
  const leiturasWhatsappEmAndamento = new Set();
  const toastIdsRecentes = new Map();
  const somIdsRecentes = new Map();
  const notificacoesExternasRecentes = new Map();
  const JANELA_DEDUP_NOTIFICACAO_EXTERNA_MS = 120000;

  let timerReassinaturaPresenca = null;
  let tentativaAssinaturaPresenca = 0;

  function mensagemRecenteParaToast(dados) {
    const timestamp = Number(dados?.timestamp || 0);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return true;
    }

    const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
    return Date.now() - ms <= 2 * 60 * 1000;
  }

  function toastJaExibido(dados) {
    const agora = Date.now();
    const ttl = 60 * 1000;

    for (const [id, salvoEm] of toastIdsRecentes.entries()) {
      if (agora - salvoEm > ttl) {
        toastIdsRecentes.delete(id);
      }
    }

    const id = String(dados?.idMensagem || "").trim();

    if (!id) {
      return false;
    }

    if (toastIdsRecentes.has(id)) {
      return true;
    }

    toastIdsRecentes.set(id, agora);
    return false;
  }

  function carregarNotificacoesDesativadas() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_NOTIFICACOES_DESATIVADAS) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const notificacoesDesativadas = carregarNotificacoesDesativadas();

  function salvarNotificacoesDesativadas() {
    localStorage.setItem(
      CHAVE_NOTIFICACOES_DESATIVADAS,
      JSON.stringify(notificacoesDesativadas),
    );
  }

  function notificacoesAtivasConversa(conversa) {
    if (!conversa?.id) {
      return false;
    }

    return !notificacoesDesativadas[conversa.id];
  }

  function definirNotificacoesConversa(conversa, ativas) {
    if (!conversa?.id) {
      return;
    }

    if (ativas) {
      delete notificacoesDesativadas[conversa.id];
    } else {
      notificacoesDesativadas[conversa.id] = true;
    }

    salvarNotificacoesDesativadas();
  }

  function limparSonsRecentes() {
    const agora = Date.now();
    const ttl = 2 * 60 * 1000;

    for (const [id, salvoEm] of somIdsRecentes.entries()) {
      if (agora - salvoEm > ttl) {
        somIdsRecentes.delete(id);
      }
    }
  }

  function chaveSomNovaMensagem(dados = {}) {
    const id = String(dados?.idMensagem || "").trim();
    if (id) {
      return id;
    }

    return String(
      `${dados?.conversaId || dados?.id || "sem-conversa"}|${dados?.timestamp || 0}|${dados?.origem || "sem-origem"}`,
    );
  }

  async function tocarSomNovaMensagem(dados = {}) {
    limparSonsRecentes();

    const chaveSom = chaveSomNovaMensagem(dados);
    if (somIdsRecentes.has(chaveSom)) {
      return false;
    }

    const agora = Date.now();

    if (!dados?.idMensagem && agora - ultimaNotificacaoSonoraEm < 250) {
      return false;
    }

    // Reserva a chave apenas enquanto esta tentativa esta em andamento.
    // Se o WebAudio nao iniciar, removemos a chave para a chegada normal da
    // mensagem poder tentar de novo. Isso e importante quando Baileys avisa
    // antes do evento WPP e a mensagem ja aparece como existente no renderer.
    somIdsRecentes.set(chaveSom, agora);
    ultimaNotificacaoSonoraEm = agora;

    try {
      const AudioContextApp = window.AudioContext || window.webkitAudioContext;

      if (!AudioContextApp) {
        somIdsRecentes.delete(chaveSom);
        console.warn("[NOTIFICACOES] SOM_WEBAUDIO_SEM_AUDIOCONTEXT");
        return false;
      }

      if (
        !contextoAudioNotificacao ||
        contextoAudioNotificacao.state === "closed"
      ) {
        contextoAudioNotificacao = new AudioContextApp();
      }

      // Nao aguarda resume indefinidamente. A versao anterior fazia await
      // direto aqui e podia deixar a notificacao sonora presa por minutos.
      if (contextoAudioNotificacao.state === "suspended") {
        try {
          await Promise.race([
            contextoAudioNotificacao.resume(),
            new Promise((resolve) => setTimeout(resolve, 180)),
          ]);
        } catch {}
      }

      if (contextoAudioNotificacao.state !== "running") {
        somIdsRecentes.delete(chaveSom);
        console.warn(
          `[NOTIFICACOES] SOM_WEBAUDIO_AGUARDANDO_RETRY | estado=${contextoAudioNotificacao.state} | visivel=${document?.visibilityState || "unknown"}`,
        );
        return false;
      }

      const inicio = contextoAudioNotificacao.currentTime;
      const ganho = contextoAudioNotificacao.createGain();
      const oscilador = contextoAudioNotificacao.createOscillator();

      oscilador.type = "sine";
      oscilador.frequency.setValueAtTime(880, inicio);
      oscilador.frequency.exponentialRampToValueAtTime(660, inicio + 0.16);

      ganho.gain.setValueAtTime(0.0001, inicio);
      ganho.gain.exponentialRampToValueAtTime(0.12, inicio + 0.015);
      ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.22);

      oscilador.connect(ganho);
      ganho.connect(contextoAudioNotificacao.destination);

      oscilador.start(inicio);
      oscilador.stop(inicio + 0.23);

      oscilador.addEventListener?.(
        "ended",
        () => {
          try {
            oscilador.disconnect();
            ganho.disconnect();
          } catch {}
        },
        { once: true },
      );

      console.log(
        `[NOTIFICACOES] SOM_WEBAUDIO_OK | estado=${contextoAudioNotificacao.state} | visivel=${document?.visibilityState || "unknown"} | origem=${dados?.origem || "renderer"}`,
      );
      return true;
    } catch (erro) {
      somIdsRecentes.delete(chaveSom);
      console.warn(
        `[NOTIFICACOES] SOM_WEBAUDIO_ERRO | ${String(erro?.message || erro || "unknown error").slice(0, 180)}`,
      );
      return false;
    }
  }

  function localizarConversaParaSom(conversaId) {
    const id = String(conversaId || "").trim();

    if (!id) {
      return null;
    }

    if (conversas[id]) {
      return conversas[id];
    }

    return (
      Object.values(conversas || {}).find((conversa) => {
        if (!conversa?.id) {
          return false;
        }

        if (conversa.id === id) {
          return true;
        }

        return Array.isArray(conversa.aliases) && conversa.aliases.includes(id);
      }) || null
    );
  }

  ipcRenderer.on("som-mensagem-imediato", (_, dados) => {
    const conversa = localizarConversaParaSom(dados?.conversaId);

    if (!conversa) {
      console.warn(
        `[NOTIFICACOES] SOM_SUPRIMIDO | motivo=conversa_nao_encontrada | conversa=${String(dados?.conversaId || "")}`,
      );
      return;
    }

    if (conversa.trancada) {
      console.log(
        `[NOTIFICACOES] SOM_SUPRIMIDO | motivo=trancada | conversa=${conversa.id}`,
      );
      return;
    }

    if (!notificacoesAtivasConversa(conversa)) {
      console.log(
        `[NOTIFICACOES] SOM_SUPRIMIDO | motivo=silenciada | conversa=${conversa.id}`,
      );
      return;
    }

    void tocarSomNovaMensagem({
      ...(dados || {}),
      conversaId: conversa.id,
      origem: dados?.origem || "imediato",
    });
  });

  function textoToastNovaMensagem(dados) {
    const tipo = String(dados?.tipo || "").toLowerCase();
    const texto = String(dados?.texto || "")
      .replace(/\s+/g, " ")
      .trim();

    let preview = texto;

    if (tipo === "imagem") {
      preview = texto ? `🖼 ${texto}` : "🖼 Imagem";
    } else if (tipo === "audio") {
      preview = "🎤 Áudio";
    } else if (tipo === "video") {
      preview = texto ? `🎥 ${texto}` : "🎥 Vídeo";
    } else if (tipo === "sticker") {
      preview = "🧩 Figurinha";
    } else if (tipo === "documento") {
      preview = `📎 ${dados?.fileName || texto || "Documento"}`;
    } else if (tipo === "view_once") {
      const viewOnceKind = String(dados?.viewOnceKind || "").toLowerCase();

      if (viewOnceKind === "imagem") {
        preview = "① Foto de visualização única";
      } else if (viewOnceKind === "video") {
        preview = "① Vídeo de visualização única";
      } else if (viewOnceKind === "audio") {
        preview = "① Áudio de reprodução única";
      } else {
        preview = "① Mídia de visualização única";
      }
    }

    if (!preview) {
      preview = "Nova mensagem";
    }

    return preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
  }

  function mostrarToastInternoNovaMensagem(conversa, dados) {
    if (
      !obterSincronizacaoInicialConcluida?.() ||
      !conversa?.id ||
      conversa.trancada ||
      !notificacoesAtivasConversa(conversa) ||
      !mensagemRecenteParaToast(dados) ||
      toastJaExibido(dados)
    ) {
      return;
    }

    if (!toastInternoContainer?.isConnected) {
      console.warn("[NOTIFICACOES] toast container unavailable.");
      return;
    }

    const toast = document.createElement("div");
    toast.className = "toast-interno";

    const avatar = document.createElement("div");
    avatar.className = "toast-interno-avatar";
    avatar.textContent = inicialDoContato(conversa);

    if (conversa.fotoPerfilUrl) {
      const img = document.createElement("img");
      img.src = conversa.fotoPerfilUrl;
      img.alt = conversa.nome || "Foto do contato";

      img.addEventListener(
        "error",
        () => {
          img.remove();
          avatar.textContent = inicialDoContato(conversa);
        },
        { once: true },
      );

      avatar.textContent = "";
      avatar.appendChild(img);
    }

    const conteudo = document.createElement("div");
    conteudo.className = "toast-interno-conteudo";

    const nome = document.createElement("div");
    nome.className = "toast-interno-nome";
    nome.textContent = conversa.nome || conversa.id;

    const preview = document.createElement("div");
    preview.className = "toast-interno-preview";
    preview.textContent = textoToastNovaMensagem(dados);

    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "toast-interno-fechar";
    fechar.textContent = "×";
    fechar.setAttribute("aria-label", "Fechar notificação");

    conteudo.appendChild(nome);
    conteudo.appendChild(preview);

    toast.appendChild(avatar);
    toast.appendChild(conteudo);
    toast.appendChild(fechar);

    toastInternoContainer.prepend(toast);

    let removendo = false;
    let timerRemocao = null;

    const removerToast = () => {
      if (removendo) {
        return;
      }

      removendo = true;
      clearTimeout(timerRemocao);

      toast.classList.remove("visivel");
      toast.classList.add("saindo");

      setTimeout(() => {
        toast.remove();
      }, 190);
    };

    fechar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      removerToast();
    });

    toast.addEventListener("click", () => {
      removerToast();
      abrirConversa(conversa.id);
    });

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        toast.classList.add("visivel");
      });
    });

    timerRemocao = setTimeout(removerToast, 5500);

    while (toastInternoContainer.children.length > 4) {
      toastInternoContainer.lastElementChild?.remove();
    }
  }

  function registrarNotificacaoExternaSeNova(conversa, dados) {
    const agora = Date.now();

    for (const [chave, criadoEm] of notificacoesExternasRecentes.entries()) {
      if (agora - criadoEm > JANELA_DEDUP_NOTIFICACAO_EXTERNA_MS) {
        notificacoesExternasRecentes.delete(chave);
      }
    }

    const identificador = String(
      dados?.idMensagem ||
        dados?.idMensagemWpp ||
        `${conversa?.id || dados?.id || "sem-conversa"}|${dados?.timestamp || 0}|${dados?.tipo || "texto"}|${dados?.texto || ""}`,
    );

    if (notificacoesExternasRecentes.has(identificador)) {
      console.log(
        `[NOTIFICACOES EXTERNAS][RENDERER] duplicada ignorada | id=${identificador}`,
      );
      return false;
    }

    notificacoesExternasRecentes.set(identificador, agora);
    return true;
  }

  function corpoNotificacaoExterna(dados = {}) {
    const tipoNotificacao = String(dados?.tipo || "").toLowerCase();
    const textoNotificacao = String(dados?.texto || "")
      .replace(/\s+/g, " ")
      .trim();

    let corpo = textoNotificacao || "Nova mensagem";

    if (tipoNotificacao === "audio") {
      corpo = "Audio";
    } else if (tipoNotificacao === "imagem" && !textoNotificacao) {
      corpo = "Imagem";
    } else if (tipoNotificacao === "video" && !textoNotificacao) {
      corpo = "Video";
    } else if (tipoNotificacao === "sticker") {
      corpo = "Figurinha";
    } else if (tipoNotificacao === "documento" && !textoNotificacao) {
      corpo = String(dados?.fileName || "Documento");
    }

    return corpo.length > 180 ? `${corpo.slice(0, 177)}...` : corpo;
  }

  // Notificacao externa e independente do toast interno.
  // O processo principal decide se a janela esta realmente fora de foco.
  // Nao usar document.hasFocus() aqui, pois no Electron ele pode permanecer
  // true mesmo com a janela minimizada ou atras de outro aplicativo.
  async function solicitarNotificacaoExternaMensagem(
    conversa,
    dados = {},
    jaExiste = false,
  ) {
    if (
      !obterSincronizacaoInicialConcluida?.() ||
      !conversa?.id ||
      dados?.minha ||
      dados?.testeIntegridadeIA ||
      conversa.trancada ||
      !notificacoesAtivasConversa(conversa) ||
      !registrarNotificacaoExternaSeNova(conversa, dados)
    ) {
      return false;
    }

    console.log(
      `[NOTIFICACOES EXTERNAS][RENDERER] solicitando IPC | conversa=${conversa.id || dados?.id || "desconhecida"} | jaExiste=${!!jaExiste}`,
    );

    try {
      const resultado = await ipcRenderer.invoke(
        "mostrar-notificacao-mensagem",
        {
          conversaId: conversa.id || dados?.conversaId || dados?.chatId || "",
          titulo: conversa.nome || conversa.id || "WhatsIAPP",
          corpo: corpoNotificacaoExterna(dados),
          fotoPerfilUrl: conversa.fotoPerfilUrl || null,
        },
      );

      if (!resultado?.ok) {
        console.warn(
          "[NOTIFICACOES] external notification failed:",
          resultado?.erro || "unknown error",
        );
        return false;
      }

      return true;
    } catch (erro) {
      console.warn(
        "[NOTIFICACOES] external notification IPC failed:",
        erro?.message || erro || "unknown error",
      );
      return false;
    }
  }

  async function marcarConversaComoLidaWhatsapp(conversa, idsMensagem = []) {
    if (!conversa?.id) {
      return;
    }

    const ids = Array.isArray(idsMensagem)
      ? idsMensagem.map(String).filter(Boolean)
      : [];

    const chave = ids.length
      ? `${conversa.id}:${ids.sort().join(",")}`
      : `${conversa.id}:todas`;

    if (leiturasWhatsappEmAndamento.has(chave)) {
      return;
    }

    leiturasWhatsappEmAndamento.add(chave);

    try {
      const resultado = await ipcRenderer.invoke("marcar-conversa-lida", {
        conversaId: conversa.id,
        idsMensagem: ids,
      });

      if (!resultado?.ok) {
        console.warn(
          "Nao foi possivel marcar a conversa como lida no WhatsApp:",
          resultado?.erro || "erro desconhecido",
        );
      }
    } catch (erro) {
      console.warn(
        "Erro ao marcar a conversa como lida no WhatsApp:",
        erro?.message || erro,
      );
    } finally {
      leiturasWhatsappEmAndamento.delete(chave);
    }
  }

  function timestampPresencaMs(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero) || numero <= 0) {
      return null;
    }

    return numero < 1e12 ? numero * 1000 : numero;
  }

  function formatarVistoPorUltimo(timestamp) {
    const ms = timestampPresencaMs(timestamp);

    if (!ms) {
      return "";
    }

    const data = new Date(ms);

    if (Number.isNaN(data.getTime())) {
      return "";
    }

    const agora = new Date();

    const inicioHoje = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate(),
    );

    const inicioData = new Date(
      data.getFullYear(),
      data.getMonth(),
      data.getDate(),
    );

    const diferencaDias = Math.round((inicioHoje - inicioData) / 86400000);

    const horario = data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (diferencaDias === 0) {
      return `visto por último hoje às ${horario}`;
    }

    if (diferencaDias === 1) {
      return `visto por último ontem às ${horario}`;
    }

    const dataCurta = data.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: data.getFullYear() === agora.getFullYear() ? undefined : "numeric",
    });

    return `visto por último em ${dataCurta} às ${horario}`;
  }

  function textoPresencaConversa(conversa) {
    if (!conversa) {
      return "";
    }

    if (ehGrupoConversa(conversa)) {
      return "";
    }

    const presenca = conversa.presenca;

    if (presenca) {
      if (presenca.tipo === "digitando") {
        return "digitando...";
      }

      if (presenca.tipo === "gravando") {
        return "gravando áudio...";
      }

      if (presenca.tipo === "online") {
        return "online";
      }

      if (presenca.lastSeen) {
        return formatarVistoPorUltimo(presenca.lastSeen);
      }
    }

    if (conversa.trancada) {
      return "Conversa trancada";
    }

    if (conversa.arquivada) {
      return "Conversa arquivada";
    }

    return "";
  }

  function atualizarStatusCabecalho() {
    const conversaAtual = obterConversaAtual?.();
    const conversa = conversas[conversaAtual];

    if (!conversa) {
      statusChat.textContent = "";
      return;
    }

    statusChat.textContent = textoPresencaConversa(conversa);
  }

  function limparTimerPresenca(conversaId) {
    const timer = timersPresenca.get(conversaId);

    if (timer) {
      clearTimeout(timer);
      timersPresenca.delete(conversaId);
    }
  }

  function agendarExpiracaoPresenca(conversa) {
    if (!conversa || !conversa.presenca) {
      return;
    }

    limparTimerPresenca(conversa.id);

    const tipo = conversa.presenca.tipo;

    if (!["online", "digitando", "gravando"].includes(tipo)) {
      return;
    }

    const tempo = tipo === "online" ? 18000 : 12000;

    const timer = setTimeout(() => {
      const atual = conversas[conversa.id];

      if (!atual || !atual.presenca) {
        return;
      }

      if (atual.presenca.tipo !== tipo) {
        return;
      }

      atual.presenca = {
        ...atual.presenca,
        tipo: "offline",
      };

      if (obterConversaAtual?.() === atual.id) {
        atualizarStatusCabecalho();
      }

      timersPresenca.delete(atual.id);
    }, tempo);

    timersPresenca.set(conversa.id, timer);
  }

  function cancelarReassinaturaPresenca() {
    if (timerReassinaturaPresenca) {
      clearTimeout(timerReassinaturaPresenca);
      timerReassinaturaPresenca = null;
    }

    tentativaAssinaturaPresenca = 0;
  }

  function agendarReassinaturaPresenca(conversa, atraso = 1000) {
    if (!conversa?.id || ehGrupoConversa(conversa)) {
      return;
    }

    if (obterConversaAtual?.() !== conversa.id) {
      cancelarReassinaturaPresenca();
      return;
    }

    if (timerReassinaturaPresenca) {
      clearTimeout(timerReassinaturaPresenca);
    }

    timerReassinaturaPresenca = setTimeout(() => {
      timerReassinaturaPresenca = null;

      const atual = conversas[conversa.id];

      if (!atual || obterConversaAtual?.() !== conversa.id) {
        cancelarReassinaturaPresenca();
        return;
      }

      assinarPresencaConversa(atual, true);
    }, atraso);
  }

  async function assinarPresencaConversa(conversa, revalidacao = false) {
    if (!conversa || ehGrupoConversa(conversa)) {
      cancelarReassinaturaPresenca();
      return;
    }

    try {
      const resultado = await ipcRenderer.invoke("assinar-presenca-contato", {
        conversaId: conversa.id,
      });

      if (obterConversaAtual?.() !== conversa.id) {
        cancelarReassinaturaPresenca();
        return;
      }

      if (resultado?.ok && resultado.presenca) {
        conversa.presenca = {
          ...resultado.presenca,
          fonte: resultado?.fonte || resultado?.presenca?.fonte || null,
        };

        agendarExpiracaoPresenca(conversa);

        if (obterConversaAtual?.() === conversa.id) {
          atualizarStatusCabecalho();
        }
      }

      if (resultado?.ok && resultado.disponivel && !resultado.pendente) {
        const revalidacoes = tentativaAssinaturaPresenca;
        cancelarReassinaturaPresenca();

        if (revalidacao) {
          const fontePresenca =
            resultado?.fonte === "wpp-fallback"
              ? "WPPConnect fallback"
              : "Baileys";

          console.log(
            `[PRESENCA] ${fontePresenca} ativo para ${conversa.id} ` +
              `apos ${revalidacoes} revalidacoes.`,
          );
        }

        return;
      }

      tentativaAssinaturaPresenca += 1;

      const atraso =
        tentativaAssinaturaPresenca <= 15
          ? 1000
          : tentativaAssinaturaPresenca <= 30
            ? 2000
            : 5000;

      agendarReassinaturaPresenca(conversa, atraso);
    } catch {
      tentativaAssinaturaPresenca += 1;
      agendarReassinaturaPresenca(conversa, 1500);
    }
  }

  ipcRenderer.on("presenca", (_, dados) => {
    const conversa = conversas[dados?.conversaId];

    if (!conversa) {
      return;
    }

    if (obterConversaAtual?.() === conversa.id) {
      cancelarReassinaturaPresenca();
    }

    const tipoAnterior = conversa.presenca?.tipo || null;
    const tipoNovo = dados.tipo || null;
    const lastSeen = dados.lastSeen || conversa.presenca?.lastSeen || null;

    // O WPP pode emitir available e logo depois unavailable. Mantemos o
    // online visivel por um curto periodo sem interferir em typing/recording.
    if (tipoNovo === "offline" && tipoAnterior === "online") {
      limparTimerPresenca(conversa.id);

      const atualizadoEm = Number(
        conversa.presenca?.atualizadoEm || Date.now(),
      );
      const restante = Math.max(0, 2500 - (Date.now() - atualizadoEm));

      if (restante > 0) {
        const timer = setTimeout(() => {
          const atual = conversas[conversa.id];

          if (!atual?.presenca || atual.presenca.tipo !== "online") {
            return;
          }

          atual.presenca = {
            ...atual.presenca,
            tipo: "offline",
            lastSeen,
            atualizadoEm: Date.now(),
          };

          if (obterConversaAtual?.() === atual.id) {
            atualizarStatusCabecalho();
          }

          timersPresenca.delete(atual.id);
        }, restante);

        timersPresenca.set(conversa.id, timer);
        return;
      }
    }

    conversa.presenca = {
      tipo: tipoNovo,
      lastSeen,
      atualizadoEm: dados.atualizadoEm || Date.now(),
      fonte: dados.fonte || conversa.presenca?.fonte || null,
    };

    agendarExpiracaoPresenca(conversa);

    if (obterConversaAtual?.() === conversa.id) {
      atualizarStatusCabecalho();
    }
  });

  console.log("[NOTIFICACOES PRESENCA MODULE] initialized");

  return {
    notificacoesAtivasConversa,
    definirNotificacoesConversa,
    tocarSomNovaMensagem,
    mostrarToastInternoNovaMensagem,
    solicitarNotificacaoExternaMensagem,
    marcarConversaComoLidaWhatsapp,
    atualizarStatusCabecalho,
    assinarPresencaConversa,
    textoPresencaConversa,
    formatarVistoPorUltimo,
  };
}

module.exports = {
  criarModuloNotificacoesPresenca,
};
