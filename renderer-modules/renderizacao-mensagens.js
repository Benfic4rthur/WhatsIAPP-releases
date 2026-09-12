const { criarIndicadorStatus } = require('../scripts/status-entrega');
function criarModuloRenderizacaoMensagens(dependencias = {}) {
  const {
    ipcRenderer,
    shell,
    document,
    console,
    mensagens,
    conversas,
    cargaMidiaEmAndamento,
    obterConversaAtual,
    proximaOcorrenciaLinkOuTelefone,
    criarLinkTelefoneMensagem,
    criarConteudoMidia,
    resolverNomeParticipanteGrupo,
    descricaoCurtaMensagemResposta,
    destacarMensagemRespondida,
    abrirMenuContextoMensagem,
    criarLinhaReacoes,
    mensagemEstaFavoritada,
  } = dependencias;

  function normalizarUrlExterna(valor) {
    const texto = String(valor || "");
    if (/^https?:\/\//i.test(texto)) {
      return texto;
    }
    if (/^www\./i.test(texto)) {
      return `https://${texto}`;
    }
    return null;
  }
  function separarPontuacaoFinalUrl(valor) {
    let url = String(valor || "");
    let final = "";
    while (/[.,!?;:]$/.test(url)) {
      final = url.slice(-1) + final;
      url = url.slice(0, -1);
    }
    return {
      url,
      final,
    };
  }

  function adicionarTextoComLinks(elemento, valor) {
    const texto = String(valor || "");
    let indice = 0;
    while (indice < texto.length) {
      const ocorrencia = proximaOcorrenciaLinkOuTelefone(texto, indice);
      if (!ocorrencia) {
        elemento.appendChild(document.createTextNode(texto.slice(indice)));
        break;
      }
      if (ocorrencia.indice > indice) {
        elemento.appendChild(
          document.createTextNode(texto.slice(indice, ocorrencia.indice)),
        );
      }
      if (ocorrencia.tipo === "url") {
        const partes = separarPontuacaoFinalUrl(ocorrencia.texto);
        const urlExterna = normalizarUrlExterna(partes.url);
        if (urlExterna) {
          const link = document.createElement("a");
          link.href = urlExterna;
          link.textContent = partes.url;
          link.title = "Abrir link";
          link.rel = "noreferrer";
          Object.assign(link.style, {
            color: "#53bdeb",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
            cursor: "pointer",
            overflowWrap: "anywhere",
          });
          link.addEventListener("click", async (evento) => {
            evento.preventDefault();
            evento.stopPropagation();
            try {
              await shell.openExternal(urlExterna);
            } catch (erro) {
              console.warn("Open link failed:", erro?.message || erro);
            }
          });
          elemento.appendChild(link);
        } else {
          elemento.appendChild(document.createTextNode(partes.url));
        }
        if (partes.final) {
          elemento.appendChild(document.createTextNode(partes.final));
        }
      } else {
        elemento.appendChild(criarLinkTelefoneMensagem(ocorrencia.texto));
      }
      indice = ocorrencia.indice + ocorrencia.texto.length;
    }
  }
  function adicionarTextoFormatadoComLinks(elemento, valor) {
    const texto = String(valor || "");
    const regexNegrito = /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*/g;
    let indice = 0;
    let match = null;

    while ((match = regexNegrito.exec(texto))) {
      if (match.index > indice) {
        adicionarTextoComLinks(elemento, texto.slice(indice, match.index));
      }

      const conteudoNegrito = String(match[1] || match[2] || "");
      const negrito = document.createElement("strong");
      negrito.style.fontWeight = "700";
      adicionarTextoComLinks(negrito, conteudoNegrito);
      elemento.appendChild(negrito);

      indice = match.index + match[0].length;
    }

    if (indice < texto.length) {
      adicionarTextoComLinks(elemento, texto.slice(indice));
    }
  }

  function criarTextoMensagem(msg) {
    if (!msg.texto) return null;
    const texto = document.createElement("div");
    texto.className = "mensagem-texto";
    Object.assign(texto.style, {
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    });
    adicionarTextoFormatadoComLinks(texto, msg.texto);
    return texto;
  }

  const CHAVE_RESPOSTAS_STATUS = "whatsiapp-status-respostas-contexto-v1";
  let cacheRespostasStatusRaw = null;
  let cacheRespostasStatus = {};

  function candidatosIdMensagemStatus(valor) {
    const texto = String(valor || "").trim();
    const candidatos = new Set();

    if (!texto) {
      return candidatos;
    }

    candidatos.add(texto);

    const partes = texto.split("_").filter(Boolean);
    const indiceBroadcast = partes.findIndex((parte) =>
      String(parte).toLowerCase().includes("status@broadcast"),
    );

    if (indiceBroadcast >= 0 && partes[indiceBroadcast + 1]) {
      candidatos.add(String(partes[indiceBroadcast + 1]).trim());
    }

    // IDs serializados do WPP podem terminar em _out/_in.
    // O historico do chat normalmente usa apenas o ID cru da mensagem.
    const partesMensagem = [...partes];
    if (
      ["out", "in"].includes(String(partesMensagem.at(-1) || "").toLowerCase())
    ) {
      partesMensagem.pop();
    }

    const ultimo = String(partesMensagem.at(-1) || "").trim();
    if (ultimo && !ultimo.includes("@")) {
      candidatos.add(ultimo);
    }

    return new Set(Array.from(candidatos).filter(Boolean));
  }

  function carregarMapaRespostasStatus() {
    try {
      const raw = window.localStorage.getItem(CHAVE_RESPOSTAS_STATUS) || "{}";

      if (raw === cacheRespostasStatusRaw) {
        return cacheRespostasStatus;
      }

      const dados = JSON.parse(raw);
      cacheRespostasStatusRaw = raw;
      cacheRespostasStatus = dados && typeof dados === "object" ? dados : {};

      return cacheRespostasStatus;
    } catch {
      cacheRespostasStatusRaw = null;
      cacheRespostasStatus = {};
      return cacheRespostasStatus;
    }
  }

  function alvoStatusPersistidoDaMensagem(msg) {
    const mapa = carregarMapaRespostasStatus();
    const candidatos = new Set([
      ...candidatosIdMensagemStatus(msg?.idMensagem),
      ...candidatosIdMensagemStatus(msg?.idMensagemWpp),
    ]);

    for (const candidato of candidatos) {
      const registro = mapa?.[candidato];

      if (!registro || Number(registro?.salvoEm || 0) <= 0) {
        continue;
      }

      return {
        idMensagem: String(
          registro.idMensagem || registro.idMensagemRaw || "",
        ).trim(),
        idMensagemWpp: String(registro.idMensagemWpp || "").trim() || null,
        preferirMeuStatus: !!registro.preferirMeuStatus,
        persistidoPorEnvio: true,
      };
    }

    return null;
  }

  function extrairAlvoStatusDaResposta(resposta, msg, original) {
    if (!resposta?.idMensagem) {
      return null;
    }

    const alvoPersistido = alvoStatusPersistidoDaMensagem(msg);

    if (alvoPersistido?.idMensagem) {
      return alvoPersistido;
    }

    const idMensagem = String(resposta.idMensagem || "").trim();
    const idMensagemWpp = String(resposta.idMensagemWpp || "").trim();
    const origem = `${idMensagemWpp} ${idMensagem}`.toLowerCase();

    if (origem.includes("status@broadcast")) {
      return {
        idMensagem,
        idMensagemWpp: idMensagemWpp || null,
        preferirMeuStatus: !!resposta.minha,
      };
    }

    // Em algumas reacoes recebidas do Status, o WPPConnect entrega apenas
    // o ID curto da mensagem citada. Nesse caso nao aparece "status@broadcast".
    // O sinal seguro que temos no renderer e: a citacao aponta para uma
    // mensagem nossa que nao existe no historico privado e a mensagem recebida
    // e apenas um emoji, exatamente o formato usado pela reacao ao Status.
    const textoAtual = String(msg?.texto || "").trim();
    const apenasEmoji =
      !!textoAtual &&
      textoAtual.length <= 24 &&
      !/[\p{L}\p{N}]/u.test(textoAtual);

    const tipoResposta = String(resposta?.tipo || "").toLowerCase();
    const tipoCompativel = ["imagem", "video", "texto"].includes(tipoResposta);

    if (!original && resposta.minha === true && apenasEmoji && tipoCompativel) {
      return {
        idMensagem,
        idMensagemWpp: idMensagemWpp || null,
        preferirMeuStatus: true,
        inferidoPorReacao: true,
      };
    }

    return null;
  }

  function previewCitacaoStatus(resposta, original) {
    const base = original || resposta || {};
    const tipo = String(base?.tipo || resposta?.tipo || "").toLowerCase();
    const texto = String(base?.texto || resposta?.texto || "").trim();

    const parecePayload =
      texto.length > 180 &&
      (/^data:/i.test(texto) ||
        /^\/9j\//.test(texto) ||
        /^[A-Za-z0-9+/=\r\n]+$/.test(texto));

    if (tipo === "imagem") {
      return "📷 Foto";
    }

    if (tipo === "video") {
      return "🎥 Vídeo";
    }

    if (tipo === "audio") {
      return "🎤 Áudio";
    }

    if (tipo === "texto" && texto && !parecePayload) {
      return texto.length > 170 ? `${texto.slice(0, 167)}...` : texto;
    }

    return parecePayload ? "Status" : descricaoCurtaMensagemResposta(base);
  }

  function criarCitacaoNaMensagem(msg, conversa) {
    const resposta = msg?.resposta;
    if (!resposta?.idMensagem) {
      return null;
    }
    const original = conversa?.mensagens?.find(
      (item) => String(item?.idMensagem || "") === String(resposta.idMensagem),
    );
    const minhaOriginal =
      typeof resposta.minha === "boolean"
        ? resposta.minha
        : typeof original?.minha === "boolean"
          ? original.minha
          : false;
    const autor = minhaOriginal
      ? "Você"
      : resolverNomeParticipanteGrupo(conversa, original || resposta) ||
        conversa?.nome ||
        "Contato";
    const alvoStatusInicial = extrairAlvoStatusDaResposta(
      resposta,
      msg,
      original,
    );
    const preview = alvoStatusInicial
      ? previewCitacaoStatus(resposta, original)
      : descricaoCurtaMensagemResposta(original || resposta);
    const citacao = document.createElement("div");
    citacao.className = "mensagem-citacao";
    citacao.title = "Ir para a mensagem respondida";
    const nome = document.createElement("div");
    nome.className = "mensagem-citacao-autor";
    nome.textContent = autor;
    const texto = document.createElement("div");
    texto.className = "mensagem-citacao-preview";
    texto.textContent = preview;
    citacao.appendChild(nome);
    citacao.appendChild(texto);
    citacao.addEventListener("click", (evento) => {
      evento.stopPropagation();

      // Resolve novamente no momento do clique. A resposta enviada pode
      // aparecer no chat antes de o IPC de envio retornar e antes de o
      // vinculo Status -> mensagem ser persistido no localStorage.
      const alvoStatus = extrairAlvoStatusDaResposta(resposta, msg, original);

      if (alvoStatus) {
        console.log(
          `[STATUS LINK] CLICK_STATUS | id=${alvoStatus.idMensagem} | ` +
            `inferido=${!!alvoStatus.inferidoPorReacao} | ` +
            `persistido=${!!alvoStatus.persistidoPorEnvio}`,
        );

        document.dispatchEvent(
          new CustomEvent("whatsiapp:abrir-status-citado", {
            detail: alvoStatus,
          }),
        );
        return;
      }

      console.log(
        `[STATUS LINK] CLICK_MENSAGEM | id=${String(resposta.idMensagem || "")}`,
      );
      destacarMensagemRespondida(resposta.idMensagem);
    });
    return citacao;
  }
  let ultimaConversaRenderizada = null;

  function obterCaixaMensagemNaTela(idMensagem) {
    const id = String(idMensagem || "").trim();
    if (!id) {
      return null;
    }

    for (const caixa of mensagens.querySelectorAll(
      ".mensagem[data-id-mensagem]",
    )) {
      if (String(caixa?.dataset?.idMensagem || "") === id) {
        return caixa;
      }
    }

    return null;
  }

  function capturarEstadoVisualAntesDoRender(conversaId) {
    const id = String(conversaId || "").trim();

    if (
      !id ||
      ultimaConversaRenderizada !== id ||
      !mensagens.querySelector(".mensagem")
    ) {
      return null;
    }

    const distanciaDoFim = Math.max(
      0,
      mensagens.scrollHeight - mensagens.scrollTop - mensagens.clientHeight,
    );
    const containerRect = mensagens.getBoundingClientRect();
    let ancora = null;

    for (const caixa of mensagens.querySelectorAll(
      ".mensagem[data-id-mensagem]",
    )) {
      const rect = caixa.getBoundingClientRect();

      if (rect.bottom > containerRect.top + 1) {
        ancora = {
          idMensagem: String(caixa.dataset.idMensagem || ""),
          offsetTopo: rect.top - containerRect.top,
        };
        break;
      }
    }

    const audios = [];

    for (const audio of mensagens.querySelectorAll(
      "audio.midia-audio-elemento",
    )) {
      const caixa = audio.closest(".mensagem");
      const idMensagem = String(caixa?.dataset?.idMensagem || "").trim();
      const tempoAtual = Math.max(0, Number(audio.currentTime || 0) || 0);
      const tocando = !audio.paused && !audio.ended;

      if (!idMensagem || (!tocando && tempoAtual <= 0)) {
        continue;
      }

      audios.push({
        idMensagem,
        tempoAtual,
        tocando,
        playbackRate: Number(audio.playbackRate || 1) || 1,
        volume: Number(audio.volume ?? 1),
        muted: !!audio.muted,
      });
    }

    return {
      scrollTop: mensagens.scrollTop,
      pertoDoFim: distanciaDoFim <= 80,
      ancora,
      audios,
    };
  }

  function pausarAudiosAntesDeRemover() {
    for (const audio of mensagens.querySelectorAll(
      "audio.midia-audio-elemento",
    )) {
      if (audio.paused || audio.ended) {
        continue;
      }

      try {
        audio.pause();
      } catch {}
    }
  }

  function restaurarEstadoAudioDepoisDoRender(conversaId, estados = []) {
    if (!Array.isArray(estados) || !estados.length) {
      return;
    }

    for (const estado of estados) {
      const caixa = obterCaixaMensagemNaTela(estado?.idMensagem);
      const audio = caixa?.querySelector("audio.midia-audio-elemento");

      if (!caixa || !audio) {
        continue;
      }

      const aplicarEstado = async () => {
        if (obterConversaAtual() !== conversaId) {
          return;
        }

        try {
          audio.playbackRate = Number(estado.playbackRate || 1) || 1;
          audio.volume = Math.max(
            0,
            Math.min(1, Number(estado.volume ?? 1) || 0),
          );
          audio.muted = !!estado.muted;

          const tempo = Math.max(0, Number(estado.tempoAtual || 0) || 0);
          if (tempo > 0) {
            audio.currentTime = tempo;
          }
        } catch {}

        if (!estado.tocando) {
          return;
        }

        try {
          await audio.play();
        } catch (erro) {
          console.warn(
            `[RENDER MENSAGENS] AUDIO_RESTORE_FALHOU | conversa=${conversaId} | mensagem=${String(estado.idMensagem || "")} | erro=${String(erro?.message || erro || "desconhecido")}`,
          );
        }
      };

      if (audio.readyState >= 1) {
        void aplicarEstado();
      } else {
        audio.addEventListener(
          "loadedmetadata",
          () => {
            void aplicarEstado();
          },
          { once: true },
        );
      }
    }
  }

  function manterFimDepoisDeImagemCarregar(conversaId, conversa, estadoAnterior) {
    // Quando a conversa ja estava no fim, uma imagem nova pode aumentar a
    // altura da bolha somente depois do evento load. O scroll feito logo apos
    // o render acontece antes desse crescimento e deixa a ultima mensagem
    // parcialmente fora da tela. Corrigimos somente a ultima imagem e somente
    // quando o usuario estava acompanhando o fim da conversa.
    if (estadoAnterior && !estadoAnterior.pertoDoFim) {
      return;
    }

    const ultima = Array.isArray(conversa?.mensagens)
      ? conversa.mensagens.at(-1)
      : null;

    if (
      !ultima ||
      ultima.tipo !== "imagem" ||
      !ultima.idMensagem ||
      !ultima.mediaUrl
    ) {
      return;
    }

    const caixa = obterCaixaMensagemNaTela(ultima.idMensagem);
    const imagem = caixa?.querySelector?.("img.midia-imagem");

    if (!imagem) {
      return;
    }

    const scrollTopDepoisDoRender = Number(mensagens.scrollTop || 0) || 0;

    const fixarNoFimSeUsuarioNaoSubiu = () => {
      if (obterConversaAtual() !== conversaId) {
        return;
      }

      // Se o usuario rolou para cima enquanto a imagem carregava, respeita a
      // posicao escolhida e nao o arrasta de volta para o fim.
      if (Number(mensagens.scrollTop || 0) + 6 < scrollTopDepoisDoRender) {
        return;
      }

      const executar = () => {
        if (obterConversaAtual() === conversaId) {
          mensagens.scrollTop = mensagens.scrollHeight;
        }
      };

      const raf = document?.defaultView?.requestAnimationFrame;
      if (typeof raf === "function") {
        raf(executar);
      } else {
        setTimeout(executar, 0);
      }
    };

    if (imagem.complete && Number(imagem.naturalWidth || 0) > 0) {
      fixarNoFimSeUsuarioNaoSubiu();
      return;
    }

    imagem.addEventListener("load", fixarNoFimSeUsuarioNaoSubiu, {
      once: true,
    });
  }

  function restaurarEstadoVisualDepoisDoRender(conversaId, estado) {
    if (!estado) {
      mensagens.scrollTop = mensagens.scrollHeight;
      return;
    }

    if (estado.pertoDoFim) {
      mensagens.scrollTop = mensagens.scrollHeight;
    } else {
      const ancora = estado.ancora
        ? obterCaixaMensagemNaTela(estado.ancora.idMensagem)
        : null;

      if (ancora) {
        const containerRect = mensagens.getBoundingClientRect();
        const novoOffset =
          ancora.getBoundingClientRect().top - containerRect.top;
        mensagens.scrollTop += novoOffset - estado.ancora.offsetTopo;
      } else {
        mensagens.scrollTop = Math.max(
          0,
          Math.min(
            Number(estado.scrollTop || 0) || 0,
            Math.max(0, mensagens.scrollHeight - mensagens.clientHeight),
          ),
        );
      }
    }

    restaurarEstadoAudioDepoisDoRender(conversaId, estado.audios);

    const audioTocando = estado.audios.some((item) => !!item?.tocando);

    if (!estado.pertoDoFim || audioTocando) {
      console.log(
        `[RENDER MENSAGENS] ESTADO_PRESERVADO | conversa=${conversaId} | scroll=${
          estado.pertoDoFim ? "fim" : "mantido"
        } | audio=${audioTocando ? "retomado" : "nenhum"}`,
      );
    }
  }

  function renderMensagens() {
    const conversaId = String(obterConversaAtual() || "").trim();
    const conversa = conversas[conversaId];

    if (!conversa) {
      return;
    }

    const estadoAnterior = capturarEstadoVisualAntesDoRender(conversaId);

    // O elemento <audio> antigo pode continuar tocando mesmo depois de sair do DOM.
    // Pausamos explicitamente antes do rerender e, quando for a mesma conversa,
    // retomamos no novo player a partir do ponto capturado.
    pausarAudiosAntesDeRemover();
    mensagens.innerHTML = "";

    if (!conversa.mensagens.length) {
      mensagens.innerHTML =
        '<div class="vazio">Nenhuma mensagem carregada</div>';
      ultimaConversaRenderizada = conversaId;
      return;
    }

    conversa.mensagens
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .forEach((msg) => {
        const caixa = document.createElement("div");
        caixa.className = "mensagem" + (msg.minha ? " minha" : " recebida");
        caixa.dataset.idMensagem = msg.idMensagem || "";
        if (msg.animacaoEntrada === "envio") {
          caixa.classList.add("mensagem-animacao-envio");
          msg.animacaoEntrada = null;
        } else if (msg.animacaoEntrada === "recebida") {
          caixa.classList.add("mensagem-animacao-recebida");
          msg.animacaoEntrada = null;
        }
        if (!msg.apagadaParaTodos && msg.tipo !== "apagada") {
          caixa.addEventListener("contextmenu", (evento) => {
            abrirMenuContextoMensagem(evento, msg);
          });
        }
        const autorGrupo = resolverNomeParticipanteGrupo(conversa, msg);
        if (autorGrupo) {
          const autorGrupoEl = document.createElement("div");
          autorGrupoEl.className = "mensagem-autor-grupo";
          autorGrupoEl.textContent = `${autorGrupo}:`;
          autorGrupoEl.title = autorGrupo;
          caixa.appendChild(autorGrupoEl);
        }
        if (msg.apagadaParaTodos || msg.tipo === "apagada") {
          const avisoApagada = document.createElement("div");
          avisoApagada.className = "mensagem-texto mensagem-apagada-aviso";
          avisoApagada.textContent = msg.minha
            ? "⊘ Você apagou esta mensagem"
            : "⊘ Esta mensagem foi apagada";
          Object.assign(avisoApagada.style, {
            color: "#9aa7ad",
            fontStyle: "italic",
            whiteSpace: "nowrap",
            userSelect: "none",
          });
          caixa.appendChild(avisoApagada);
        } else {
          const citacao = criarCitacaoNaMensagem(msg, conversa);
          if (citacao) {
            caixa.appendChild(citacao);
          }
          if (
            ["imagem", "audio", "video", "documento", "sticker"].includes(
              msg.tipo,
            )
          ) {
            caixa.classList.add("mensagem-midia", `mensagem-midia-${msg.tipo}`);
            caixa.appendChild(criarConteudoMidia(msg, conversa));
            if (msg.texto && (msg.tipo !== "documento" ||
                (msg.texto !== msg.fileName && msg.texto !== "Documento"))) {
              const texto = criarTextoMensagem(msg);
              if (texto) caixa.appendChild(texto);
            }
          } else {
            const texto = criarTextoMensagem(msg);
            if (texto) {
              if (msg.tipo === "view_once") {
                Object.assign(texto.style, {
                  whiteSpace: "pre-line",
                  color: "#d5dee3",
                  lineHeight: "1.45",
                });
              }
              caixa.appendChild(texto);
            }
          }
        }
        if (!msg.apagadaParaTodos && msg.tipo !== "apagada") {
          const linhaReacoes = criarLinhaReacoes(msg);
          if (linhaReacoes) {
            caixa.style.position = "relative";
            caixa.style.marginBottom = "14px";
            caixa.appendChild(linhaReacoes);
          }
        }
        const hora = document.createElement("span");
        hora.className = "hora";

        const indicadorFavorito =
          !msg.apagadaParaTodos &&
          msg.tipo !== "apagada" &&
          mensagemEstaFavoritada(conversa.id, msg.idMensagem)
            ? "★  "
            : "";
        const indicadorEditada =
          msg.editada && !msg.apagadaParaTodos && msg.tipo !== "apagada"
            ? "editada  "
            : "";

        const horaTexto = document.createElement("span");
        horaTexto.className = "hora-texto";
        horaTexto.textContent = `${indicadorFavorito}${indicadorEditada}${msg.horario || ""}`;
        hora.appendChild(horaTexto);

        const status = criarIndicadorStatus(document, msg, 'mensagem-status');
        if (status) hora.appendChild(status);
        if (msg.envioTextoLocal && msg.statusEntrega === 'erro') {
          const tentar = document.createElement('button');
          tentar.type = 'button';
          tentar.className = 'envio-tentar-novamente';
          tentar.textContent = 'Revisar e tentar novamente';
          tentar.title = msg.erroEnvio || 'Envio não confirmado';
          tentar.addEventListener('click', () => {
            const campo = document.getElementById('campoMensagem');
            if (!campo || campo.value.trim()) return;
            campo.value = msg.texto || '';
            campo.dispatchEvent(new document.defaultView.Event('input', { bubbles: true }));
            campo.focus();
          });
          hora.appendChild(tentar);
        }

        caixa.appendChild(hora);
        mensagens.appendChild(caixa);
      });

    ultimaConversaRenderizada = conversaId;
    restaurarEstadoVisualDepoisDoRender(conversaId, estadoAnterior);
    manterFimDepoisDeImagemCarregar(conversaId, conversa, estadoAnterior);
  }
  async function carregarUmaMidia(conversa, msg) {
    const chave = `${conversa.id}:${msg.idMensagem}`;
    if (cargaMidiaEmAndamento.has(chave)) {
      return;
    }
    cargaMidiaEmAndamento.add(chave);
    try {
      const resultado = await ipcRenderer.invoke("carregar-midia", {
        conversaId: conversa.id,
        idMensagem: msg.idMensagem,
      });
      if (resultado?.ok) {
        msg.mediaUrl = resultado.mediaUrl;
        msg.mediaPath = resultado.mediaPath;
        msg.fileName = resultado.fileName || msg.fileName;
        msg.erroMidia = null;
      } else {
        msg.erroMidia = resultado?.erro || "Mídia indisponível";
      }
    } catch (erro) {
      msg.erroMidia = erro?.message || "Mídia indisponível";
    } finally {
      cargaMidiaEmAndamento.delete(chave);
    }
    if (obterConversaAtual() === conversa.id) {
      renderMensagens();
    }
  }
  async function carregarMidiasDaConversa() {
    const conversa = conversas[obterConversaAtual()];
    if (!conversa) return;
    const pendentes = conversa.mensagens
      .filter(
        (msg) =>
          ["imagem", "audio", "video", "documento", "sticker"].includes(
            msg.tipo,
          ) &&
          !msg.mediaUrl &&
          !msg.erroMidia &&
          msg.idMensagem,
      )
      // prioriza as mídias mais recentes, que são as mais prováveis de ainda
      // estarem disponíveis nos servidores do WhatsApp
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const tamanhoLote = 4;
    for (let i = 0; i < pendentes.length; i += tamanhoLote) {
      if (obterConversaAtual() !== conversa.id) return;
      const lote = pendentes.slice(i, i + tamanhoLote);
      await Promise.all(lote.map((msg) => carregarUmaMidia(conversa, msg)));
    }
  }

  return {
    renderMensagens,
    carregarUmaMidia,
    carregarMidiasDaConversa,
  };
}

module.exports = {
  criarModuloRenderizacaoMensagens,
};
