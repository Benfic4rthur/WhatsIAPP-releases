const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const ffmpegPathRenderer = require("ffmpeg-static");

function criarModuloAudio(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    compositor,
    campoMensagem,
    botaoAnexar,
    botaoFigurinhas,
    botaoMicrofone,
    botaoEnviarMensagem,
    statusChat,
    conversas,
    obterConversaAtual,
    atualizarContadores,
    renderConversas,
    renderMensagens,
    atualizarCompositor,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
    obterRespostaAtualParaEnvio,
    obterMensagemRespondendo,
    limparRespostaMensagem,
    obterImagemPerfilApp,
    inicialDoContato,
    obterModoIAConversa,
    hidratarTranscricaoAudio,
    transcreverAudioMensagem,
  } = dependencias;

  let gravadorAudio = null;
  let streamGravacao = null;
  let partesGravacao = [];
  let conversaGravacao = null;
  let inicioGravacao = 0;
  let timerGravacao = null;

  let blobAudioPendente = null;
  let urlAudioPendente = null;
  let duracaoAudioPendenteMs = 0;
  let audioOggPendente = null;
  let promessaConversaoAudioPendente = null;
  const audiosLocaisPendentes = new Map();
  const renderizadoresTranscricaoAudio = new WeakMap();

  let descartarAoParar = false;
  let envioAudioAutorizado = false;
  let enviarAoParar = false;
  let gravacaoPausada = false;
  let inicioPausaGravacao = 0;
  let totalPausadoMs = 0;

  const ICONE_LIXEIRA_GRAVACAO = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M9 3h6l1 2h4v2h-1l-1 12a3 3 0 0 1-2.99 2.75H9A3 3 0 0 1 6.01 19L5 7H4V5h4l1-2Zm-1.99 4 .99 11h8l1-11H7.01ZM10 9h2v7h-2V9Zm4 0h2v7h-2V9Z"/>
  </svg>`;
  const ICONE_PAUSA_GRAVACAO = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M8 5h3v14H8V5Zm5 0h3v14h-3V5Z"/>
  </svg>`;
  const ICONE_PLAY_GRAVACAO = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M8 5v14l11-7L8 5Z"/>
  </svg>`;
  const ICONE_ENVIAR_GRAVACAO = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M3.4 20.4 20.85 13a1.1 1.1 0 0 0 0-2L3.4 3.6a.85.85 0 0 0-1.17.99l1.92 6.52a1 1 0 0 0 .72.69l6.8 1.2-6.8 1.2a1 1 0 0 0-.72.69l-1.92 6.52a.85.85 0 0 0 1.17.99Z"/>
  </svg>`;

  const barraGravacao = document.createElement("div");
  barraGravacao.className = "gravacao-whatsapp";
  barraGravacao.style.display = "none";

  const botaoCancelarGravacao = document.createElement("button");
  botaoCancelarGravacao.type = "button";
  botaoCancelarGravacao.className =
    "gravacao-whatsapp-acao gravacao-whatsapp-excluir";
  botaoCancelarGravacao.title = "Cancelar gravação";
  botaoCancelarGravacao.setAttribute("aria-label", "Cancelar gravação");
  botaoCancelarGravacao.innerHTML = ICONE_LIXEIRA_GRAVACAO;

  const estadoGravacao = document.createElement("div");
  estadoGravacao.className = "gravacao-whatsapp-estado";

  const topoGravacao = document.createElement("div");
  topoGravacao.className = "gravacao-whatsapp-topo";

  const indicadorGravacao = document.createElement("span");
  indicadorGravacao.className = "gravacao-whatsapp-indicador";

  const tempoGravacao = document.createElement("span");
  tempoGravacao.className = "gravacao-whatsapp-tempo";
  tempoGravacao.textContent = "0:00";

  topoGravacao.appendChild(indicadorGravacao);
  topoGravacao.appendChild(tempoGravacao);

  const ondaGravacao = document.createElement("div");
  ondaGravacao.className = "gravacao-whatsapp-onda";

  for (let indice = 0; indice < 48; indice += 1) {
    const barra = document.createElement("span");
    barra.style.animationDelay = `${(indice % 12) * 0.08}s`;
    barra.style.height = `${8 + (indice % 6) * 2}px`;
    ondaGravacao.appendChild(barra);
  }

  estadoGravacao.appendChild(topoGravacao);
  estadoGravacao.appendChild(ondaGravacao);

  const acoesGravacao = document.createElement("div");
  acoesGravacao.className = "gravacao-whatsapp-acoes";

  const botaoPausarGravacao = document.createElement("button");
  botaoPausarGravacao.type = "button";
  botaoPausarGravacao.className =
    "gravacao-whatsapp-acao gravacao-whatsapp-pausar";
  botaoPausarGravacao.title = "Pausar gravação";
  botaoPausarGravacao.setAttribute("aria-label", "Pausar gravação");
  botaoPausarGravacao.innerHTML = ICONE_PAUSA_GRAVACAO;

  const botaoEnviarGravacaoDireta = document.createElement("button");
  botaoEnviarGravacaoDireta.type = "button";
  botaoEnviarGravacaoDireta.className =
    "gravacao-whatsapp-acao gravacao-whatsapp-enviar";
  botaoEnviarGravacaoDireta.title = "Enviar gravação";
  botaoEnviarGravacaoDireta.setAttribute("aria-label", "Enviar gravação");
  botaoEnviarGravacaoDireta.innerHTML = ICONE_ENVIAR_GRAVACAO;

  acoesGravacao.appendChild(botaoPausarGravacao);
  acoesGravacao.appendChild(botaoEnviarGravacaoDireta);

  barraGravacao.appendChild(botaoCancelarGravacao);
  barraGravacao.appendChild(estadoGravacao);
  barraGravacao.appendChild(acoesGravacao);

  const painelAudio = document.createElement("div");

  Object.assign(painelAudio.style, {
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    flex: "0 1 760px",
    width: "calc(100% - 24px)",
    maxWidth: "760px",
    minWidth: "0",
    height: "48px",
    padding: "4px 7px",
    margin: "0 auto",
    borderRadius: "24px",
    background: "#182229",
    border: "1px solid #2a3942",
    boxSizing: "border-box",
  });

  const playerAudioGravado = document.createElement("audio");
  playerAudioGravado.preload = "metadata";
  playerAudioGravado.style.display = "none";

  const botaoPlayAudio = document.createElement("button");
  botaoPlayAudio.type = "button";
  botaoPlayAudio.textContent = "▶";
  botaoPlayAudio.title = "Ouvir gravação";

  Object.assign(botaoPlayAudio.style, {
    flex: "0 0 38px",
    width: "38px",
    height: "38px",
    minWidth: "38px",
    minHeight: "38px",
    padding: "0",
    margin: "0",
    border: "0",
    borderRadius: "50%",
    background: "#20b35b",
    color: "#fff",
    cursor: "pointer",
    fontSize: "14px",
    lineHeight: "1",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  });

  const progressoAudio = document.createElement("input");
  progressoAudio.type = "range";
  progressoAudio.min = "0";
  progressoAudio.max = "1000";
  progressoAudio.step = "1";
  progressoAudio.value = "0";

  Object.assign(progressoAudio.style, {
    flex: "1",
    minWidth: "80px",
    cursor: "pointer",
    accentColor: "#20b35b",
  });

  const tempoAudio = document.createElement("span");
  tempoAudio.textContent = "0:00";

  Object.assign(tempoAudio.style, {
    minWidth: "40px",
    color: "#aebbc2",
    fontSize: "12px",
    textAlign: "right",
  });

  const botaoExcluirAudio = document.createElement("button");
  botaoExcluirAudio.type = "button";
  botaoExcluirAudio.textContent = "🗑";
  botaoExcluirAudio.title = "Descartar gravação";

  const botaoEnviarAudio = document.createElement("button");
  botaoEnviarAudio.type = "button";
  botaoEnviarAudio.textContent = "➤";
  botaoEnviarAudio.title = "Enviar gravação";

  for (const botao of [botaoExcluirAudio, botaoEnviarAudio]) {
    Object.assign(botao.style, {
      flex: "0 0 38px",
      width: "38px",
      height: "38px",
      minWidth: "38px",
      minHeight: "38px",
      padding: "0",
      margin: "0",
      border: "0",
      borderRadius: "50%",
      color: "#fff",
      cursor: "pointer",
      fontSize: "16px",
      lineHeight: "1",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      boxSizing: "border-box",
    });
  }

  botaoExcluirAudio.style.background = "#472429";
  botaoEnviarAudio.style.background = "#20b35b";

  painelAudio.appendChild(playerAudioGravado);
  painelAudio.appendChild(botaoPlayAudio);
  painelAudio.appendChild(progressoAudio);
  painelAudio.appendChild(tempoAudio);
  painelAudio.appendChild(botaoExcluirAudio);
  painelAudio.appendChild(botaoEnviarAudio);

  compositor.appendChild(barraGravacao);
  compositor.appendChild(painelAudio);

  function formatarDuracaoGravacao(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));

    const min = Math.floor(total / 60);

    const seg = String(total % 60).padStart(2, "0");

    return `${min}:${seg}`;
  }

  function obterDuracaoGravacaoAtual() {
    const referencia = gravacaoPausada
      ? inicioPausaGravacao || Date.now()
      : Date.now();

    return Math.max(0, referencia - inicioGravacao - totalPausadoMs);
  }

  function atualizarTextoGravacao() {
    tempoGravacao.textContent = formatarDuracaoGravacao(
      obterDuracaoGravacaoAtual(),
    );
  }

  function atualizarEstadoBotaoPausar() {
    const pausada = gravacaoPausada || gravadorAudio?.state === "paused";

    botaoPausarGravacao.innerHTML = pausada
      ? ICONE_PLAY_GRAVACAO
      : ICONE_PAUSA_GRAVACAO;
    botaoPausarGravacao.title = pausada
      ? "Retomar gravação"
      : "Pausar gravação";
    botaoPausarGravacao.setAttribute(
      "aria-label",
      pausada ? "Retomar gravação" : "Pausar gravação",
    );

    barraGravacao.classList.toggle("pausada", Boolean(pausada));
  }

  async function converterBlobAudioParaOgg(blob) {
    if (!blob?.size || !ffmpegPathRenderer) {
      return null;
    }

    const mimeBase = String(blob.type || "audio/webm")
      .split(";")[0]
      .trim()
      .toLowerCase();

    const bufferEntrada = Buffer.from(await blob.arrayBuffer());

    if (!bufferEntrada.length) {
      return null;
    }

    const extensaoEntrada = mimeBase.includes("ogg")
      ? ".ogg"
      : mimeBase.includes("mp4") || mimeBase.includes("m4a")
        ? ".m4a"
        : mimeBase.includes("wav")
          ? ".wav"
          : ".webm";

    const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const caminhoEntrada = path.join(
      os.tmpdir(),
      `whatsiapp-audio-${id}${extensaoEntrada}`,
    );
    const caminhoSaida = path.join(os.tmpdir(), `whatsiapp-audio-${id}.ogg`);

    fs.writeFileSync(caminhoEntrada, bufferEntrada);

    try {
      await new Promise((resolve, reject) => {
        execFile(
          ffmpegPathRenderer,
          [
            "-y",
            "-loglevel",
            "error",
            "-fflags",
            "+genpts",
            "-i",
            caminhoEntrada,
            "-vn",
            "-c:a",
            "libopus",
            "-application",
            "voip",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-b:a",
            "32k",
            "-avoid_negative_ts",
            "make_zero",
            caminhoSaida,
          ],
          {
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
          },
          (erro) => {
            if (erro) {
              reject(erro);
              return;
            }

            resolve();
          },
        );
      });

      if (!fs.existsSync(caminhoSaida)) {
        return null;
      }

      const convertido = fs.readFileSync(caminhoSaida);

      if (!convertido.length) {
        return null;
      }

      return {
        bytes: convertido,
        mime: "audio/ogg; codecs=opus",
      };
    } catch {
      return null;
    } finally {
      for (const caminho of [caminhoEntrada, caminhoSaida]) {
        try {
          if (fs.existsSync(caminho)) {
            fs.unlinkSync(caminho);
          }
        } catch {}
      }
    }
  }

  function iniciarConversaoAudioPendente(blob) {
    audioOggPendente = null;

    promessaConversaoAudioPendente = converterBlobAudioParaOgg(blob)
      .then((resultado) => {
        if (blobAudioPendente === blob && resultado?.bytes?.length) {
          audioOggPendente = resultado;
        }

        return resultado;
      })
      .catch(() => null);
  }

  function criarAudioOtimista(conversa, blob, resposta = null) {
    if (!conversa || !blob?.size) {
      return null;
    }

    const localId = `local-audio-${Date.now()}-${crypto
      .randomBytes(3)
      .toString("hex")}`;

    const mediaUrl = URL.createObjectURL(blob);
    const agora = new Date();

    const mensagem = {
      idMensagem: localId,
      texto: "",
      tipo: "audio",
      mime: blob.type || "audio/webm",
      fileName: null,
      viewOnceKind: null,
      horario: agora.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Math.floor(Date.now() / 1000),
      minha: true,
      mediaPath: null,
      mediaUrl,
      rawBase64: null,
      statusEntrega: "pendente",
      resposta: resposta ? { ...resposta } : null,
      animacaoEntrada: "envio",
    };

    conversa.mensagens.push(mensagem);
    conversa.timestamp = mensagem.timestamp;

    audiosLocaisPendentes.set(localId, {
      conversaId: conversa.id,
      mediaUrl,
    });

    atualizarContadores();
    renderConversas();

    if (obterConversaAtual() === conversa.id) {
      renderMensagens();
    }

    return localId;
  }

  function removerAudioOtimista(conversa, localId) {
    if (!conversa || !localId) {
      return;
    }

    const indice = conversa.mensagens.findIndex(
      (msg) => msg.idMensagem === localId,
    );

    if (indice >= 0) {
      conversa.mensagens.splice(indice, 1);
    }

    const pendente = audiosLocaisPendentes.get(localId);

    if (pendente?.mediaUrl) {
      try {
        URL.revokeObjectURL(pendente.mediaUrl);
      } catch {}
    }

    audiosLocaisPendentes.delete(localId);

    renderConversas();

    if (obterConversaAtual() === conversa.id) {
      renderMensagens();
    }
  }

  function pararTracksGravacao() {
    try {
      for (const track of streamGravacao?.getTracks?.() || []) {
        track.stop();
      }
    } catch {}

    streamGravacao = null;
  }

  function definirVisibilidadeControleCompositor(elemento, visivel) {
    if (!elemento) return;

    if (visivel) {
      elemento.style.removeProperty("display");
      return;
    }

    // O CSS dos botoes usa display com !important. Sem a prioridade aqui,
    // o microfone/figurinhas/anexo reapareciam por cima da barra de gravacao.
    elemento.style.setProperty("display", "none", "important");
  }

  function mostrarControlesNormais() {
    barraGravacao.style.display = "none";
    painelAudio.style.display = "none";
    compositor.style.justifyContent = "";

    definirVisibilidadeControleCompositor(campoMensagem, true);
    definirVisibilidadeControleCompositor(botaoAnexar, true);
    definirVisibilidadeControleCompositor(botaoFigurinhas, true);
    definirVisibilidadeControleCompositor(botaoMicrofone, true);
    botaoEnviarMensagem.style.setProperty("display", "none", "important");
  }

  function mostrarBarraGravacao() {
    painelAudio.style.display = "none";
    barraGravacao.style.display = "flex";
    compositor.style.justifyContent = "center";

    definirVisibilidadeControleCompositor(campoMensagem, false);
    definirVisibilidadeControleCompositor(botaoAnexar, false);
    definirVisibilidadeControleCompositor(botaoFigurinhas, false);
    definirVisibilidadeControleCompositor(botaoMicrofone, false);
    botaoEnviarMensagem.style.setProperty("display", "none", "important");
  }

  function mostrarRevisaoAudio() {
    barraGravacao.style.display = "none";
    painelAudio.style.display = "flex";
    compositor.style.justifyContent = "center";

    definirVisibilidadeControleCompositor(campoMensagem, false);
    definirVisibilidadeControleCompositor(botaoAnexar, false);
    definirVisibilidadeControleCompositor(botaoFigurinhas, false);
    definirVisibilidadeControleCompositor(botaoMicrofone, false);
    botaoEnviarMensagem.style.setProperty("display", "none", "important");
  }

  function resetarPlayerAudio() {
    try {
      playerAudioGravado.pause();
    } catch {}

    playerAudioGravado.currentTime = 0;
    botaoPlayAudio.textContent = "▶";
    progressoAudio.value = "0";
  }

  function limparAudioPendente({ limparStatus = true } = {}) {
    resetarPlayerAudio();

    enviarAoParar = false;
    gravacaoPausada = false;
    inicioPausaGravacao = 0;
    totalPausadoMs = 0;
    atualizarEstadoBotaoPausar();

    if (urlAudioPendente) {
      try {
        URL.revokeObjectURL(urlAudioPendente);
      } catch {}
    }

    urlAudioPendente = null;
    blobAudioPendente = null;
    duracaoAudioPendenteMs = 0;
    audioOggPendente = null;
    promessaConversaoAudioPendente = null;
    conversaGravacao = null;
    envioAudioAutorizado = false;

    playerAudioGravado.removeAttribute("src");
    playerAudioGravado.load();

    tempoAudio.textContent = "0:00";

    mostrarControlesNormais();
    atualizarCompositor();

    if (limparStatus) {
      statusChat.textContent = "";
    }
  }

  function restaurarInterfaceGravacao() {
    clearInterval(timerGravacao);
    timerGravacao = null;
    enviarAoParar = false;
    gravacaoPausada = false;
    inicioPausaGravacao = 0;
    totalPausadoMs = 0;
    atualizarEstadoBotaoPausar();

    mostrarControlesNormais();
    atualizarCompositor();
  }

  function entrarModoRevisaoAudio(blob, duracaoMs) {
    if (urlAudioPendente) {
      try {
        URL.revokeObjectURL(urlAudioPendente);
      } catch {}
    }

    blobAudioPendente = blob;
    duracaoAudioPendenteMs = Math.max(0, duracaoMs || 0);

    urlAudioPendente = URL.createObjectURL(blob);

    playerAudioGravado.src = urlAudioPendente;

    playerAudioGravado.load();

    progressoAudio.value = "0";
    tempoAudio.textContent = formatarDuracaoGravacao(duracaoAudioPendenteMs);

    iniciarConversaoAudioPendente(blob);

    mostrarRevisaoAudio();

    statusChat.textContent = "Áudio gravado, ouça, descarte ou envie.";
  }

  function cancelarGravacaoAtual() {
    if (["recording", "paused"].includes(gravadorAudio?.state)) {
      descartarAoParar = true;

      try {
        gravadorAudio.stop();
      } catch {
        pararTracksGravacao();
        restaurarInterfaceGravacao();
      }

      return;
    }

    descartarAoParar = false;
    pararTracksGravacao();
    restaurarInterfaceGravacao();
  }

  function descartarAudioAoTrocarConversa() {
    if (["recording", "paused"].includes(gravadorAudio?.state)) {
      descartarAoParar = true;

      try {
        gravadorAudio.stop();
      } catch {
        pararTracksGravacao();
      }
    } else {
      pararTracksGravacao();
    }

    if (blobAudioPendente) {
      limparAudioPendente({
        limparStatus: false,
      });
    }

    partesGravacao = [];
    conversaGravacao = null;
    envioAudioAutorizado = false;

    mostrarControlesNormais();
  }

  async function iniciarGravacaoAudio() {
    if (
      !obterConversaAtual() ||
      !conversas[obterConversaAtual()] ||
      blobAudioPendente ||
      gravadorAudio
    ) {
      return;
    }

    try {
      streamGravacao = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const opcoesMime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];

      const mime =
        opcoesMime.find((valor) =>
          window.MediaRecorder?.isTypeSupported?.(valor),
        ) || "";

      gravadorAudio = mime
        ? new MediaRecorder(streamGravacao, {
            mimeType: mime,
          })
        : new MediaRecorder(streamGravacao);

      partesGravacao = [];
      conversaGravacao = obterConversaAtual();
      inicioGravacao = Date.now();
      descartarAoParar = false;
      envioAudioAutorizado = false;
      enviarAoParar = false;
      gravacaoPausada = false;
      inicioPausaGravacao = 0;
      totalPausadoMs = 0;
      atualizarEstadoBotaoPausar();

      gravadorAudio.addEventListener("dataavailable", (evento) => {
        if (evento.data?.size) {
          partesGravacao.push(evento.data);
        }
      });

      gravadorAudio.addEventListener("stop", () => {
        clearInterval(timerGravacao);
        timerGravacao = null;

        const duracao = obterDuracaoGravacaoAtual();

        const mimeFinal = gravadorAudio?.mimeType || "audio/webm";

        const blob = new Blob(partesGravacao, {
          type: mimeFinal,
        });

        const deveDescartar = descartarAoParar;
        const deveEnviarDireto = enviarAoParar;

        descartarAoParar = false;
        enviarAoParar = false;
        partesGravacao = [];
        gravacaoPausada = false;
        inicioPausaGravacao = 0;
        totalPausadoMs = 0;
        atualizarEstadoBotaoPausar();

        pararTracksGravacao();
        gravadorAudio = null;

        if (deveDescartar) {
          mostrarControlesNormais();
          atualizarCompositor();
          return;
        }

        if (!blob.size) {
          mostrarControlesNormais();
          atualizarCompositor();

          statusChat.textContent = "A gravação ficou vazia.";
          return;
        }

        if (deveEnviarDireto) {
          entrarModoRevisaoAudio(blob, duracao);

          setTimeout(() => {
            enviarAudioPendente();
          }, 0);
          return;
        }

        entrarModoRevisaoAudio(blob, duracao);
      });

      gravadorAudio.start(250);

      atualizarTextoGravacao();
      atualizarEstadoBotaoPausar();

      mostrarBarraGravacao();

      timerGravacao = setInterval(() => {
        atualizarTextoGravacao();
      }, 250);
    } catch (erro) {
      pararTracksGravacao();
      gravadorAudio = null;
      mostrarControlesNormais();
      atualizarCompositor();

      statusChat.textContent = "Não consegui acessar o microfone.";
    }
  }

  function alternarPausaGravacao() {
    if (!gravadorAudio) {
      return;
    }

    try {
      if (gravadorAudio.state === "recording") {
        gravadorAudio.pause();
        gravacaoPausada = true;
        inicioPausaGravacao = Date.now();
        atualizarTextoGravacao();
        atualizarEstadoBotaoPausar();
        return;
      }

      if (gravadorAudio.state === "paused") {
        totalPausadoMs += Math.max(0, Date.now() - inicioPausaGravacao);
        gravacaoPausada = false;
        inicioPausaGravacao = 0;
        gravadorAudio.resume();
        atualizarEstadoBotaoPausar();
      }
    } catch (erro) {
      statusChat.textContent =
        erro?.message || "Não foi possível alterar a gravação.";
    }
  }

  function enviarGravacaoDireta() {
    if (!["recording", "paused"].includes(gravadorAudio?.state)) {
      return;
    }

    if (gravadorAudio.state === "paused") {
      totalPausadoMs += Math.max(0, Date.now() - inicioPausaGravacao);
      gravacaoPausada = false;
      inicioPausaGravacao = 0;
    }

    enviarAoParar = true;
    descartarAoParar = false;

    try {
      gravadorAudio.stop();
    } catch (erro) {
      enviarAoParar = false;
      statusChat.textContent =
        erro?.message || "Não foi possível enviar a gravação.";
    }
  }

  async function enviarAudioPendente() {
    if (!blobAudioPendente || !conversaGravacao) {
      return;
    }

    envioAudioAutorizado = true;

    const conversaDestino = conversaGravacao;
    const blobDestino = blobAudioPendente;
    const duracaoDestino = duracaoAudioPendenteMs;
    const convertidoPronto = audioOggPendente;
    const promessaConversao = promessaConversaoAudioPendente;
    const respostaDestino = obterRespostaAtualParaEnvio();

    const conversaObjeto = conversas[conversaDestino] || null;

    if (!conversaObjeto) {
      return;
    }

    let desarquivadaLocalmente = false;
    let localId = null;

    try {
      let audioConvertido = convertidoPronto;

      if (!audioConvertido?.bytes?.length && promessaConversao) {
        audioConvertido = await promessaConversao;
      }

      if (!audioConvertido?.bytes?.length) {
        audioConvertido = await converterBlobAudioParaOgg(blobDestino);
      }

      if (!audioConvertido?.bytes?.length) {
        throw new Error(
          "Não foi possível preparar a mensagem de voz em OGG/Opus.",
        );
      }

      if (!envioAudioAutorizado) {
        return;
      }

      const bufferOgg = Buffer.from(audioConvertido.bytes);
      const mimeEnvio = "audio/ogg; codecs=opus";
      const blobOgg = new Blob([bufferOgg], {
        type: mimeEnvio,
      });

      desarquivadaLocalmente = desarquivarLocalmenteAoEnviar(conversaObjeto);

      localId = criarAudioOtimista(conversaObjeto, blobOgg, respostaDestino);

      limparAudioPendente({
        limparStatus: true,
      });

      envioAudioAutorizado = true;

      const resultado = await ipcRenderer.invoke("enviar-audio-gravado", {
        conversaId: conversaDestino,
        bytes: Array.from(bufferOgg),
        mime: mimeEnvio,
        resposta: respostaDestino,
      });

      if (!resultado?.ok) {
        restaurarArquivamentoLocalSeFalhar(
          conversaObjeto,
          desarquivadaLocalmente,
        );

        removerAudioOtimista(conversaObjeto, localId);

        entrarModoRevisaoAudio(blobDestino, duracaoDestino);

        statusChat.textContent =
          resultado?.erro || "Não foi possível enviar o áudio.";

        envioAudioAutorizado = false;
        return;
      }

      const mensagemLocal = conversaObjeto.mensagens.find(
        (msg) =>
          msg.idMensagem === localId ||
          (resultado.idMensagem && msg.idMensagem === resultado.idMensagem),
      );

      if (mensagemLocal && resultado.idMensagem) {
        const urlAnterior = mensagemLocal.mediaUrl;

        mensagemLocal.idMensagem = resultado.idMensagem;
        mensagemLocal.statusEntrega = "enviada";
        mensagemLocal.mime = resultado.mime || mimeEnvio;
        mensagemLocal.mediaPath =
          resultado.mediaPath || mensagemLocal.mediaPath || null;
        mensagemLocal.mediaUrl =
          resultado.mediaUrl || mensagemLocal.mediaUrl || null;

        if (
          resultado.mediaUrl &&
          urlAnterior &&
          urlAnterior !== resultado.mediaUrl &&
          String(urlAnterior).startsWith("blob:")
        ) {
          try {
            URL.revokeObjectURL(urlAnterior);
          } catch {}
        }
      }

      audiosLocaisPendentes.delete(localId);

      if (
        respostaDestino &&
        obterMensagemRespondendo()?.idMensagem === respostaDestino.idMensagem &&
        obterMensagemRespondendo()?.conversaId === conversaObjeto.id
      ) {
        limparRespostaMensagem(false);
      }

      if (obterConversaAtual() === conversaObjeto.id) {
        renderMensagens();
      }
    } catch (erro) {
      if (desarquivadaLocalmente) {
        restaurarArquivamentoLocalSeFalhar(
          conversaObjeto,
          desarquivadaLocalmente,
        );
      }

      if (localId) {
        removerAudioOtimista(conversaObjeto, localId);
      }

      if (blobDestino?.size) {
        entrarModoRevisaoAudio(blobDestino, duracaoDestino);
      }

      envioAudioAutorizado = false;

      statusChat.textContent = erro?.message || "Erro ao enviar o áudio.";
    } finally {
      botaoEnviarAudio.disabled = false;
      botaoExcluirAudio.disabled = false;
      botaoPlayAudio.disabled = false;
      progressoAudio.disabled = false;
    }
  }

  function descartarAudioPendente() {
    envioAudioAutorizado = false;

    limparAudioPendente({
      limparStatus: true,
    });
  }

  botaoMicrofone.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    iniciarGravacaoAudio();
  });

  botaoPausarGravacao.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    alternarPausaGravacao();
  });

  botaoEnviarGravacaoDireta.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    enviarGravacaoDireta();
  });

  botaoCancelarGravacao.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    cancelarGravacaoAtual();
  });

  botaoEnviarAudio.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    enviarAudioPendente();
  });

  botaoExcluirAudio.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();
    descartarAudioPendente();
  });

  botaoPlayAudio.addEventListener("click", (evento) => {
    evento.preventDefault();
    evento.stopPropagation();

    if (!urlAudioPendente) {
      return;
    }

    if (playerAudioGravado.paused) {
      playerAudioGravado.play();
    } else {
      playerAudioGravado.pause();
    }
  });

  playerAudioGravado.addEventListener("play", () => {
    botaoPlayAudio.textContent = "❚❚";
  });

  playerAudioGravado.addEventListener("pause", () => {
    botaoPlayAudio.textContent = "▶";
  });

  playerAudioGravado.addEventListener("ended", () => {
    botaoPlayAudio.textContent = "▶";
    progressoAudio.value = "0";
    playerAudioGravado.currentTime = 0;
  });

  playerAudioGravado.addEventListener("timeupdate", () => {
    const duracao =
      Number.isFinite(playerAudioGravado.duration) &&
      playerAudioGravado.duration > 0
        ? playerAudioGravado.duration
        : duracaoAudioPendenteMs / 1000;

    if (duracao > 0) {
      progressoAudio.value = String(
        Math.round((playerAudioGravado.currentTime / duracao) * 1000),
      );
    }

    tempoAudio.textContent = formatarDuracaoGravacao(
      playerAudioGravado.currentTime * 1000,
    );
  });

  progressoAudio.addEventListener("input", (evento) => {
    evento.stopPropagation();

    const duracao =
      Number.isFinite(playerAudioGravado.duration) &&
      playerAudioGravado.duration > 0
        ? playerAudioGravado.duration
        : duracaoAudioPendenteMs / 1000;

    if (duracao <= 0) {
      return;
    }

    playerAudioGravado.currentTime =
      (Number(progressoAudio.value) / 1000) * duracao;
  });

  let audioMensagemEmReproducao = null;
  let estadoReproducaoAudioMensagem = null;

  function formatarTempoAudioMensagem(segundos) {
    const total = Math.max(0, Math.floor(Number(segundos || 0) || 0));
    const minutos = Math.floor(total / 60);
    const resto = String(total % 60).padStart(2, "0");
    return `${minutos}:${resto}`;
  }

  function alturasOndaAudioMensagem(chave, quantidade = 42) {
    let seed = 0;
    const texto = String(chave || "audio");

    for (let i = 0; i < texto.length; i += 1) {
      seed = (seed * 31 + texto.charCodeAt(i)) >>> 0;
    }

    const alturas = [];

    for (let i = 0; i < quantidade; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      alturas.push(5 + (seed % 15));
    }

    return alturas;
  }

  function criarAvatarAudioMensagem(msg, conversa) {
    const avatar = document.createElement("div");
    avatar.className = "midia-audio-avatar";

    let url = null;
    let fallback = "A";

    if (msg?.minha) {
      url = obterImagemPerfilApp?.()?.src || null;
      fallback = "EU";
    } else {
      url = conversa?.fotoPerfilUrl || null;
      fallback = inicialDoContato(conversa || { nome: "Contato" });
    }

    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = msg?.minha ? "Minha foto" : conversa?.nome || "Contato";
      img.loading = "lazy";
      avatar.appendChild(img);
    } else {
      const texto = document.createElement("span");
      texto.textContent = fallback;
      avatar.appendChild(texto);
    }

    const mic = document.createElement("span");
    mic.className = "midia-audio-mic";
    mic.textContent = "🎙";
    avatar.appendChild(mic);

    return avatar;
  }

  function criarConteudoAudioWhatsapp(msg, conversa) {
    const bloco = document.createElement("div");
    bloco.className = "midia-audio-bloco";

    const player = document.createElement("div");
    player.className =
      "midia-audio-whatsapp" + (msg?.minha ? " minha" : " recebida");

    const audio = document.createElement("audio");
    audio.className = "midia-audio-elemento";
    audio.preload = "metadata";
    audio.src = msg.mediaUrl;

    const idAudioMensagem = String(
      msg?.idMensagem || msg?.mediaUrl || "",
    ).trim();
    audio.dataset.idMensagem = idAudioMensagem;

    const estadoAnteriorMesmoAudio =
      estadoReproducaoAudioMensagem &&
      idAudioMensagem &&
      estadoReproducaoAudioMensagem.idMensagem === idAudioMensagem
        ? { ...estadoReproducaoAudioMensagem }
        : null;

    const play = document.createElement("button");
    play.type = "button";
    play.className = "midia-audio-play";
    play.setAttribute("aria-label", "Reproduzir áudio");
    play.innerHTML = '<span class="midia-audio-play-icone">▶</span>';

    if (estadoAnteriorMesmoAudio?.tocando) {
      play.classList.add("tocando");
      play.setAttribute("aria-label", "Pausar áudio");
      play.innerHTML = '<span class="midia-audio-play-icone pausa">Ⅱ</span>';
    }

    const centro = document.createElement("div");
    centro.className = "midia-audio-centro";

    const onda = document.createElement("div");
    onda.className = "midia-audio-onda";
    onda.setAttribute("role", "slider");
    onda.setAttribute("aria-label", "Posição do áudio");
    onda.setAttribute("aria-valuemin", "0");
    onda.setAttribute("aria-valuemax", "100");
    onda.setAttribute("aria-valuenow", "0");

    const barras = alturasOndaAudioMensagem(
      msg?.idMensagem || msg?.mediaUrl || "audio",
    ).map((altura) => {
      const barra = document.createElement("span");
      barra.style.height = `${altura}px`;
      onda.appendChild(barra);
      return barra;
    });

    const meta = document.createElement("div");
    meta.className = "midia-audio-meta";

    const tempo = document.createElement("span");
    tempo.className = "midia-audio-tempo";
    tempo.textContent = "0:00";

    const tipo = document.createElement("span");
    tipo.className = "midia-audio-tipo";
    tipo.textContent = "Mensagem de voz";

    meta.appendChild(tempo);
    meta.appendChild(tipo);
    centro.appendChild(onda);
    centro.appendChild(meta);

    const avatar = criarAvatarAudioMensagem(msg, conversa);

    if (msg?.minha) {
      player.appendChild(avatar);
      player.appendChild(play);
      player.appendChild(centro);
    } else {
      player.appendChild(play);
      player.appendChild(centro);
      player.appendChild(avatar);
    }

    player.appendChild(audio);
    bloco.appendChild(player);

    if (!msg?.minha) {
      try {
        hidratarTranscricaoAudio?.(msg);
      } catch {}

      const areaTranscricao = document.createElement("div");
      areaTranscricao.className = "midia-audio-transcricao";
      areaTranscricao.dataset.idMensagem = String(msg?.idMensagem || "").trim();
      bloco.appendChild(areaTranscricao);

      let transcricaoExpandida = false;

      function textoTranscricaoAtual() {
        return String(msg?.transcricaoIA || "")
          .replace(/\s+/g, " ")
          .trim();
      }

      function renderizarTranscricaoAudio() {
        areaTranscricao.innerHTML = "";
        areaTranscricao.classList.remove("erro", "carregando");

        const textoTranscricao = textoTranscricaoAtual();
        const erroTranscricao = String(msg?.transcricaoIAErro || "").trim();
        const modoConversa = String(
          obterModoIAConversa?.(conversa?.id) || "manual",
        ).trim();

        if (textoTranscricao) {
          areaTranscricao.style.display = "block";

          const cabecalho = document.createElement("div");
          cabecalho.className = "midia-audio-transcricao-cabecalho";

          const label = document.createElement("span");
          label.className = "midia-audio-transcricao-label";
          label.textContent = "Transcrição";
          cabecalho.appendChild(label);

          const texto = document.createElement("div");
          texto.className = "midia-audio-transcricao-texto";
          texto.textContent = textoTranscricao;
          texto.classList.toggle("expandida", transcricaoExpandida);

          areaTranscricao.appendChild(cabecalho);
          areaTranscricao.appendChild(texto);

          if (textoTranscricao.length > 150) {
            const alternar = document.createElement("button");
            alternar.type = "button";
            alternar.className = "midia-audio-transcricao-alternar";
            alternar.textContent = transcricaoExpandida
              ? "Ver menos"
              : "Ver mais";

            alternar.addEventListener("click", (evento) => {
              evento.preventDefault();
              evento.stopPropagation();
              transcricaoExpandida = !transcricaoExpandida;
              renderizarTranscricaoAudio();
            });

            areaTranscricao.appendChild(alternar);
          }

          return;
        }

        if (msg?.transcricaoIAStatus === "transcrevendo") {
          areaTranscricao.style.display = "flex";
          areaTranscricao.classList.add("carregando");

          const status = document.createElement("span");
          status.className = "midia-audio-transcricao-status";
          status.textContent = "Transcrevendo áudio";
          areaTranscricao.appendChild(status);
          return;
        }

        // Áudios recebidos também precisam oferecer uma ação explícita quando
        // chegaram antes da configuração da IA ou quando a resposta automática
        // ainda não foi disparada. Em modo automático o botão funciona como
        // fallback para mensagens já existentes, sem duplicar transcrições.
        const podeTranscreverManual =
          typeof transcreverAudioMensagem === "function";

        if (!podeTranscreverManual) {
          areaTranscricao.style.display = "none";
          return;
        }

        areaTranscricao.style.display = "flex";
        areaTranscricao.classList.toggle("erro", !!erroTranscricao);

        const acao = document.createElement("button");
        acao.type = "button";
        acao.className = "midia-audio-transcricao-acao";
        acao.textContent = erroTranscricao
          ? "Tentar transcrever novamente"
          : "Transcrever áudio";
        acao.title = erroTranscricao || "Gerar transcrição deste áudio";

        acao.addEventListener("click", async (evento) => {
          evento.preventDefault();
          evento.stopPropagation();

          if (msg?.transcricaoIAStatus === "transcrevendo") {
            return;
          }

          msg.transcricaoIAStatus = "transcrevendo";
          msg.transcricaoIAErro = null;
          renderizarTranscricaoAudio();

          try {
            const resultado = await transcreverAudioMensagem(conversa, msg);

            if (!resultado?.ok || !textoTranscricaoAtual()) {
              msg.transcricaoIAStatus = "erro";
              msg.transcricaoIAErro =
                resultado?.erro || "Não foi possível transcrever este áudio.";
            } else {
              msg.transcricaoIAStatus = "concluida";
              msg.transcricaoIAErro = null;
            }
          } catch (erro) {
            msg.transcricaoIAStatus = "erro";
            msg.transcricaoIAErro =
              erro?.message || "Não foi possível transcrever este áudio.";
          }

          renderizarTranscricaoAudio();
        });

        areaTranscricao.appendChild(acao);
      }

      renderizadoresTranscricaoAudio.set(
        areaTranscricao,
        renderizarTranscricaoAudio,
      );
      renderizarTranscricaoAudio();
    }

    function atualizarProgresso() {
      const duracao = Number(audio.duration || 0);
      const atual = Number(audio.currentTime || 0);
      const percentual = duracao > 0 ? Math.min(1, atual / duracao) : 0;
      const totalAtivas = Math.round(percentual * barras.length);

      barras.forEach((barra, indice) => {
        barra.classList.toggle("ativa", indice < totalAtivas);
      });

      onda.setAttribute("aria-valuenow", String(Math.round(percentual * 100)));

      if (!audio.paused && atual > 0) {
        tempo.textContent = formatarTempoAudioMensagem(atual);
      } else if (duracao > 0) {
        tempo.textContent = formatarTempoAudioMensagem(duracao);
      }
    }

    play.addEventListener("click", async () => {
      if (audio.paused) {
        if (
          audioMensagemEmReproducao &&
          audioMensagemEmReproducao !== audio &&
          !audioMensagemEmReproducao.paused
        ) {
          audioMensagemEmReproducao.pause();
        }

        audioMensagemEmReproducao = audio;

        try {
          await audio.play();
        } catch {}
      } else {
        audio.pause();
      }
    });

    onda.addEventListener("click", (evento) => {
      const duracao = Number(audio.duration || 0);

      if (!duracao) {
        return;
      }

      const rect = onda.getBoundingClientRect();
      const percentual = Math.max(
        0,
        Math.min(1, (evento.clientX - rect.left) / Math.max(1, rect.width)),
      );

      audio.currentTime = duracao * percentual;
      atualizarProgresso();
    });

    let retomadaAposRerenderExecutada = false;

    async function retomarAudioAposRerender() {
      if (
        retomadaAposRerenderExecutada ||
        !estadoAnteriorMesmoAudio?.tocando ||
        !idAudioMensagem
      ) {
        return;
      }

      const estadoAtual = estadoReproducaoAudioMensagem;

      if (!estadoAtual?.tocando || estadoAtual.idMensagem !== idAudioMensagem) {
        return;
      }

      const tempo = Math.max(
        0,
        Number(
          estadoAtual.currentTime ?? estadoAnteriorMesmoAudio.currentTime,
        ) || 0,
      );

      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(Math.max(0, audio.duration - 0.05), tempo);
      } else {
        audio.currentTime = tempo;
      }

      retomadaAposRerenderExecutada = true;

      try {
        await audio.play();
      } catch {
        retomadaAposRerenderExecutada = false;
      }
    }

    audio.addEventListener("loadedmetadata", () => {
      atualizarProgresso();
      void retomarAudioAposRerender();
    });
    audio.addEventListener("durationchange", atualizarProgresso);
    audio.addEventListener("canplay", () => {
      void retomarAudioAposRerender();
    });
    audio.addEventListener("timeupdate", () => {
      atualizarProgresso();

      if (
        estadoReproducaoAudioMensagem?.idMensagem === idAudioMensagem &&
        audioMensagemEmReproducao === audio
      ) {
        estadoReproducaoAudioMensagem.currentTime = Number(
          audio.currentTime || 0,
        );
      }
    });

    audio.addEventListener("play", () => {
      if (
        audioMensagemEmReproducao &&
        audioMensagemEmReproducao !== audio &&
        !audioMensagemEmReproducao.paused
      ) {
        try {
          audioMensagemEmReproducao.pause();
        } catch {}
      }

      audioMensagemEmReproducao = audio;
      estadoReproducaoAudioMensagem = {
        idMensagem: idAudioMensagem,
        currentTime: Number(audio.currentTime || 0),
        tocando: true,
      };
      play.classList.add("tocando");
      play.setAttribute("aria-label", "Pausar áudio");
      play.innerHTML = '<span class="midia-audio-play-icone pausa">Ⅱ</span>';
    });

    audio.addEventListener("pause", () => {
      play.classList.remove("tocando");
      play.setAttribute("aria-label", "Reproduzir áudio");
      play.innerHTML = '<span class="midia-audio-play-icone">▶</span>';
      atualizarProgresso();

      if (estadoReproducaoAudioMensagem?.idMensagem === idAudioMensagem) {
        estadoReproducaoAudioMensagem.currentTime = Number(
          audio.currentTime || 0,
        );

        // Se o elemento foi removido por um rerender do chat, o áudio pode
        // continuar/reaparecer em outro elemento. Nesse caso não tratamos a
        // remoção do DOM como uma pausa pedida pelo usuário.
        if (audio.isConnected) {
          estadoReproducaoAudioMensagem.tocando = false;
        }
      }
    });

    audio.addEventListener("ended", () => {
      if (audioMensagemEmReproducao === audio) {
        audioMensagemEmReproducao = null;
      }

      if (estadoReproducaoAudioMensagem?.idMensagem === idAudioMensagem) {
        estadoReproducaoAudioMensagem = null;
      }

      audio.currentTime = 0;
      atualizarProgresso();
    });

    return bloco;
  }

  function atualizarTranscricaoVisivel(msg) {
    const idMensagem = String(msg?.idMensagem || "").trim();

    if (!idMensagem) {
      return false;
    }

    let atualizou = false;

    for (const area of document.querySelectorAll(".midia-audio-transcricao")) {
      if (String(area?.dataset?.idMensagem || "") !== idMensagem) {
        continue;
      }

      const renderizar = renderizadoresTranscricaoAudio.get(area);

      if (typeof renderizar === "function") {
        renderizar();
        atualizou = true;
      }
    }

    return atualizou;
  }

  function reconciliarAudioOtimista(conversa, dados) {
    if (!conversa || !dados || !dados.minha || dados.tipo !== "audio") {
      return false;
    }

    const entradaOtimista = Array.from(audiosLocaisPendentes.entries()).find(
      ([localId, info]) =>
        info?.conversaId === conversa.id &&
        conversa.mensagens.some((msg) => msg.idMensagem === localId),
    );

    if (!entradaOtimista) {
      return false;
    }

    const [localId] = entradaOtimista;
    const mensagemLocal = conversa.mensagens.find(
      (msg) => msg.idMensagem === localId,
    );

    if (!mensagemLocal) {
      return false;
    }

    const urlAnterior = mensagemLocal.mediaUrl;

    mensagemLocal.idMensagem = dados.idMensagem || mensagemLocal.idMensagem;
    mensagemLocal.idMensagemWpp =
      dados.idMensagemWpp || mensagemLocal.idMensagemWpp || null;
    mensagemLocal.resposta = dados.resposta || mensagemLocal.resposta || null;
    mensagemLocal.texto = dados.texto ?? mensagemLocal.texto;
    mensagemLocal.mime = dados.mime || mensagemLocal.mime;
    mensagemLocal.fileName = dados.fileName || mensagemLocal.fileName;
    mensagemLocal.horario = dados.horario || mensagemLocal.horario;
    mensagemLocal.timestamp = dados.timestamp || mensagemLocal.timestamp;
    mensagemLocal.mediaPath = dados.mediaPath || mensagemLocal.mediaPath;
    mensagemLocal.mediaUrl = dados.mediaUrl || mensagemLocal.mediaUrl;
    mensagemLocal.statusEntrega =
      dados.statusEntrega || mensagemLocal.statusEntrega;

    if (
      dados.mediaUrl &&
      urlAnterior &&
      urlAnterior !== dados.mediaUrl &&
      String(urlAnterior).startsWith("blob:")
    ) {
      try {
        URL.revokeObjectURL(urlAnterior);
      } catch {}
    }

    audiosLocaisPendentes.delete(localId);
    return true;
  }

  function removerRegistroAudioOtimista(
    idMensagem,
    { revogarUrl = false } = {},
  ) {
    const id = String(idMensagem || "").trim();

    if (!id) {
      return false;
    }

    const pendente = audiosLocaisPendentes.get(id);

    if (revogarUrl && pendente?.mediaUrl) {
      try {
        URL.revokeObjectURL(pendente.mediaUrl);
      } catch {}
    }

    return audiosLocaisPendentes.delete(id);
  }

  return {
    descartarAudioAoTrocarConversa,
    reconciliarAudioOtimista,
    removerRegistroAudioOtimista,
    criarConteudoAudioWhatsapp,
    atualizarTranscricaoVisivel,
  };
}

module.exports = {
  criarModuloAudio,
};
