const { mesclarStatus } = require('../scripts/status-entrega');
const { abrirDialogoLocalizacao } = require('./cartoes-mensagem');
function criarModuloAnexos(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    pathToFileURL,
    chatPrincipal,
    menuAnexos,
    painelContatosCompositor,
    painelFigurinhasCompositor,
    botaoAnexar,
    botaoFigurinhas,
    botaoEnviarMensagem,
    botaoMicrofone,
    campoMensagem,
    statusChat,
    conversas,
    obterConversaAtual,
    obterContatosSalvosWhatsapp,
    carregarContatosSalvosWhatsapp,
    normalizarTextoBusca,
    digitosNumeroConversa,
    contatoSalvoExistentePorId,
    criarAvatarContato,
    solicitarFotoContatoSalvo,
    formatarNumeroWhatsapp,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
    obterRespostaAtualParaEnvio,
    obterMensagemRespondendo,
    limparRespostaMensagem,
    ajustarAlturaCampoMensagem,
    atualizarCompositor,
    renderMensagens,
    renderConversas,
    atualizarContadores,
  } = dependencias;

  const videosLocaisPendentes = new Map();

  function criarVideoOtimista(
    conversa,
    selecionado,
    legenda = "",
    resposta = null,
  ) {
    if (!conversa || !selecionado?.caminho) {
      return null;
    }

    const localId = `local-video-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2, 8)}`;

    let mediaUrl = null;

    try {
      mediaUrl = pathToFileURL(selecionado.caminho).href;
    } catch {}

    const agora = new Date();
    const mensagem = {
      idMensagem: localId,
      idMensagemWpp: null,
      resposta: resposta ? { ...resposta } : null,
      texto: String(legenda || "").trim(),
      tipo: "video",
      mime: "video/mp4",
      fileName: selecionado.fileName || null,
      viewOnceKind: null,
      horario: agora.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Math.floor(Date.now() / 1000),
      minha: true,
      mediaPath: selecionado.caminho,
      mediaUrl,
      rawBase64: null,
      statusEntrega: "pendente",
      animacaoEntrada: "envio",
    };

    conversa.mensagens = Array.isArray(conversa.mensagens)
      ? conversa.mensagens
      : [];
    conversa.mensagens.push(mensagem);
    conversa.timestamp = mensagem.timestamp;

    videosLocaisPendentes.set(localId, {
      conversaId: conversa.id,
      mediaPath: selecionado.caminho,
      mediaUrl,
    });

    atualizarContadores?.();
    renderConversas?.();

    if (obterConversaAtual?.() === conversa.id) {
      renderMensagens?.();
    }

    return localId;
  }

  function removerVideoOtimista(conversa, localId) {
    if (!conversa || !localId) {
      return false;
    }

    const indice = Array.isArray(conversa.mensagens)
      ? conversa.mensagens.findIndex((msg) => msg.idMensagem === localId)
      : -1;

    if (indice >= 0) {
      conversa.mensagens.splice(indice, 1);
    }

    videosLocaisPendentes.delete(localId);
    renderConversas?.();

    if (obterConversaAtual?.() === conversa.id) {
      renderMensagens?.();
    }

    return indice >= 0;
  }

  function reconciliarVideoOtimista(conversa, dados) {
    if (!conversa || !dados?.minha || dados.tipo !== "video") {
      return false;
    }

    const entrada = Array.from(videosLocaisPendentes.entries()).find(
      ([localId, info]) =>
        info?.conversaId === conversa.id &&
        conversa.mensagens?.some((msg) => msg.idMensagem === localId),
    );

    if (!entrada) {
      return false;
    }

    const [localId] = entrada;
    const mensagemLocal = conversa.mensagens.find(
      (msg) => msg.idMensagem === localId,
    );

    if (!mensagemLocal) {
      videosLocaisPendentes.delete(localId);
      return false;
    }

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
    mensagemLocal.rawBase64 =
      dados.rawBase64 || mensagemLocal.rawBase64 || null;
    mensagemLocal.statusEntrega =
      mesclarStatus(mensagemLocal.statusEntrega, dados.statusEntrega);

    videosLocaisPendentes.delete(localId);
    return true;
  }

  const ICONES_ANEXO_WHATSAPP = {
    arquivo: `<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7z"></path><path d="M14 3v6h5"></path></svg>`,
    midia: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.5"></circle><path d="m5 17 5-5 3 3 2-2 4 4"></path></svg>`,
    audio: `<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"></path><circle cx="6.5" cy="18" r="3"></circle><circle cx="16.5" cy="16" r="3"></circle></svg>`,
    contato: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"></circle><path d="M5.5 20a6.5 6.5 0 0 1 13 0"></path></svg>`,
  };

  function criarOpcaoAnexo(texto, tipo) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = `menu-anexos-item menu-anexos-item-${tipo}`;
    botao.innerHTML = `
    <span class="menu-anexos-icone">${ICONES_ANEXO_WHATSAPP[tipo] || ""}</span>
    <span>${texto}</span>
  `;

    botao.addEventListener("click", async (evento) => {
      evento.stopPropagation();
      fecharPaineisCompositor({
        manter: tipo === "contato" ? "contatos" : null,
      });

      if (tipo === "contato") {
        await abrirPainelCompartilharContato();
        return;
      }
      if (tipo === 'localizacao') {
        const conversa = conversas[obterConversaAtual()];
        if (conversa) abrirDialogoLocalizacao({document,ipcRenderer,conversaId:conversa.id,nomeConversa:conversa.nome});
        return;
      }

      await selecionarEEnviarAnexo(tipo);
    });

    return botao;
  }

  menuAnexos.appendChild(criarOpcaoAnexo("Documento", "arquivo"));
  menuAnexos.appendChild(criarOpcaoAnexo("Fotos e vídeos", "midia"));
  menuAnexos.appendChild(criarOpcaoAnexo("Áudio", "audio"));
  menuAnexos.appendChild(criarOpcaoAnexo("Contato", "contato"));
  menuAnexos.appendChild(criarOpcaoAnexo('📍 Localização', 'localizacao'));

  function confirmarEnvioAnexo(selecionado, legenda) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");

      Object.assign(overlay.style, {
        position: "absolute",
        inset: "0",
        zIndex: "6000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(4,8,10,.96)",
      });

      const card = document.createElement("div");

      Object.assign(card.style, {
        width: "620px",
        maxWidth: "calc(100% - 36px)",
        maxHeight: "calc(100% - 36px)",
        padding: "16px",
        borderRadius: "14px",
        background: "#111a1f",
        border: "1px solid #2b3940",
        boxShadow: "0 20px 60px rgba(0,0,0,.5)",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        color: "#e9edef",
        boxSizing: "border-box",
      });

      const titulo = document.createElement("div");

      titulo.textContent = selecionado.fileName || "Arquivo selecionado";

      Object.assign(titulo.style, {
        fontWeight: "700",
        fontSize: "14px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      });

      const preview = document.createElement("div");

      Object.assign(preview.style, {
        minHeight: "180px",
        height: "min(56vh, 500px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "10px",
        background: "#05090b",
        position: "relative",
      });

      let urlLocal = null;

      try {
        urlLocal = pathToFileURL(selecionado.caminho).href;
      } catch {}

      function mostrarPreviewIndisponivel(texto) {
        preview.innerHTML = "";

        const aviso = document.createElement("div");

        aviso.textContent = texto;

        Object.assign(aviso.style, {
          padding: "20px",
          color: "#9fb0ba",
          fontSize: "13px",
          textAlign: "center",
          lineHeight: "1.5",
        });

        preview.appendChild(aviso);
      }

      if (selecionado.tipo === "imagem" && urlLocal) {
        const img = document.createElement("img");

        img.src = urlLocal;

        Object.assign(img.style, {
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          display: "block",
        });

        img.addEventListener(
          "error",
          () => {
            mostrarPreviewIndisponivel(
              "Não consegui gerar a prévia desta imagem. O arquivo ainda pode ser enviado.",
            );
          },
          {
            once: true,
          },
        );

        preview.appendChild(img);
      } else if (selecionado.tipo === "video" && urlLocal) {
        const video = document.createElement("video");

        video.src = urlLocal;
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;

        Object.assign(video.style, {
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
          background: "#000",
        });

        const carregando = document.createElement("div");

        carregando.textContent = "Carregando vídeo...";

        Object.assign(carregando.style, {
          position: "absolute",
          color: "#9fb0ba",
          fontSize: "13px",
          pointerEvents: "none",
        });

        preview.appendChild(carregando);
        preview.appendChild(video);

        const removerCarregando = () => {
          carregando.remove();
        };

        video.addEventListener("loadedmetadata", removerCarregando, {
          once: true,
        });

        video.addEventListener("canplay", removerCarregando, {
          once: true,
        });

        video.addEventListener(
          "error",
          () => {
            mostrarPreviewIndisponivel(
              "Este vídeo não pode ser reproduzido pelo player do Electron neste formato ou codec. Ele ainda pode ser enviado.",
            );
          },
          {
            once: true,
          },
        );

        // Força o Chromium a iniciar a leitura dos metadados.
        try {
          video.load();
        } catch {}
      } else {
        const arquivo = document.createElement("div");

        arquivo.textContent = `📎 ${selecionado.fileName || "Arquivo"}`;

        arquivo.style.color = "#b7c5cc";

        preview.appendChild(arquivo);
      }

      const permiteLegenda = ["imagem", "video"].includes(selecionado.tipo);
      let campoLegenda = null;

      if (permiteLegenda) {
        const legendaWrap = document.createElement("div");

        Object.assign(legendaWrap.style, {
          display: "flex",
          alignItems: "flex-end",
          gap: "8px",
          padding: "8px 10px",
          borderRadius: "12px",
          background: "#182229",
          border: "1px solid #2b3940",
        });

        campoLegenda = document.createElement("textarea");
        campoLegenda.rows = 1;
        campoLegenda.placeholder = "Adicionar legenda...";
        campoLegenda.value = String(legenda || "");

        Object.assign(campoLegenda.style, {
          flex: "1 1 auto",
          minWidth: "0",
          minHeight: "38px",
          maxHeight: "120px",
          padding: "8px 4px",
          margin: "0",
          border: "0",
          outline: "none",
          resize: "none",
          overflowY: "hidden",
          background: "transparent",
          color: "#e9edef",
          font: "inherit",
          fontSize: "14px",
          lineHeight: "20px",
          boxSizing: "border-box",
        });

        const ajustarAlturaLegenda = () => {
          campoLegenda.style.height = "auto";
          const altura = Math.min(Math.max(campoLegenda.scrollHeight, 38), 120);
          campoLegenda.style.height = `${altura}px`;
          campoLegenda.style.overflowY =
            campoLegenda.scrollHeight > 120 ? "auto" : "hidden";
        };

        campoLegenda.addEventListener("input", ajustarAlturaLegenda);
        legendaWrap.appendChild(campoLegenda);
        card.appendChild(legendaWrap);

        requestAnimationFrame?.(() => {
          ajustarAlturaLegenda();
          campoLegenda.focus();
          campoLegenda.setSelectionRange(
            campoLegenda.value.length,
            campoLegenda.value.length,
          );
        });
      }

      const acoes = document.createElement("div");

      Object.assign(acoes.style, {
        display: "flex",
        justifyContent: "flex-end",
        gap: "8px",
      });

      const cancelar = document.createElement("button");

      cancelar.type = "button";
      cancelar.textContent = "Cancelar";

      const enviar = document.createElement("button");

      enviar.type = "button";
      enviar.textContent = "Enviar";

      for (const botao of [cancelar, enviar]) {
        Object.assign(botao.style, {
          padding: "10px 16px",
          borderRadius: "9px",
          border: "0",
          cursor: "pointer",
          color: "#fff",
          fontWeight: "600",
        });
      }

      cancelar.style.background = "#28343a";

      enviar.style.background = "#20b35b";

      acoes.appendChild(cancelar);
      acoes.appendChild(enviar);

      card.insertBefore(titulo, card.firstChild);
      card.insertBefore(preview, titulo.nextSibling);
      card.appendChild(acoes);
      overlay.appendChild(card);

      chatPrincipal.appendChild(overlay);

      let finalizado = false;

      const finalizar = (valor) => {
        if (finalizado) {
          return;
        }

        finalizado = true;

        try {
          const video = preview.querySelector("video");

          video?.pause?.();
        } catch {}

        overlay.remove();
        resolve(valor);
      };

      cancelar.addEventListener("click", (evento) => {
        evento.stopPropagation();
        finalizar({
          confirmado: false,
          legenda: String(legenda || ""),
        });
      });

      const confirmarComLegendaAtual = () => {
        finalizar({
          confirmado: true,
          legenda: permiteLegenda
            ? String(campoLegenda?.value || "").trim()
            : String(legenda || "").trim(),
        });
      };

      enviar.addEventListener("click", (evento) => {
        evento.stopPropagation();
        confirmarComLegendaAtual();
      });

      campoLegenda?.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter" && !evento.shiftKey) {
          evento.preventDefault();
          evento.stopPropagation();
          confirmarComLegendaAtual();
        }
      });

      overlay.addEventListener("click", (evento) => {
        if (evento.target === overlay) {
          finalizar({
            confirmado: false,
            legenda: String(legenda || ""),
          });
        }
      });

      overlay.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape") {
          finalizar({
            confirmado: false,
            legenda: String(legenda || ""),
          });
        }
      });

      overlay.tabIndex = -1;
      if (!campoLegenda) {
        overlay.focus();
      }
    });
  }

  const buscaContatosCompositor = painelContatosCompositor.querySelector(
    ".painel-compositor-busca",
  );
  const listaContatosCompositor = painelContatosCompositor.querySelector(
    ".painel-contatos-lista",
  );

  function fecharPaineisCompositor({ manter = null } = {}) {
    if (manter !== "anexos") {
      menuAnexos.style.display = "none";
    }

    if (manter !== "contatos") {
      painelContatosCompositor.hidden = true;
    }

    if (manter !== "figurinhas") {
      painelFigurinhasCompositor.hidden = true;
    }
  }

  function criarItemContatoCompartilhar(contato) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "painel-contato-item";

    const conversaVisual = contatoSalvoExistentePorId(contato) || {
      id: contato.id,
      nome: contato.nome,
      numeroWhatsapp: contato.numeroWhatsapp || null,
      fotoPerfilUrl: contato.fotoPerfilUrl || null,
      fotoPerfilTentada: false,
    };

    const avatar = criarAvatarContato(conversaVisual, 42);

    if (!conversaVisual.fotoPerfilUrl) {
      solicitarFotoContatoSalvo(contato, avatar);
    }

    const info = document.createElement("span");
    info.className = "painel-contato-info";

    const nome = document.createElement("strong");
    nome.textContent = contato.nome;

    const numero = document.createElement("small");
    numero.textContent = formatarNumeroWhatsapp(
      contato.numeroWhatsapp || contato.id,
    );

    info.appendChild(nome);
    info.appendChild(numero);
    botao.appendChild(avatar);
    botao.appendChild(info);

    botao.addEventListener("click", async (evento) => {
      evento.stopPropagation();

      const conversaAtual = obterConversaAtual();
      const conversa = conversas[conversaAtual];

      if (!conversa) {
        return;
      }

      botao.disabled = true;
      statusChat.textContent = "Compartilhando contato...";

      const desarquivadaLocalmente = desarquivarLocalmenteAoEnviar(conversa);

      try {
        const resultado = await ipcRenderer.invoke("enviar-contato-whatsapp", {
          conversaId: conversa.id,
          contatoId: contato.id,
          numeroWhatsapp: contato.numeroWhatsapp || null,
          nome: contato.nome,
        });

        if (!resultado?.ok) {
          restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);
          statusChat.textContent =
            resultado?.erro || "Não foi possível compartilhar o contato.";
          return;
        }

        painelContatosCompositor.hidden = true;
        statusChat.textContent = "";
      } catch (erro) {
        restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);
        statusChat.textContent =
          erro?.message || "Não foi possível compartilhar o contato.";
      } finally {
        botao.disabled = false;
      }
    });

    return botao;
  }

  function renderizarContatosCompositor() {
    if (!listaContatosCompositor) {
      return;
    }

    const termo = normalizarTextoBusca(buscaContatosCompositor?.value || "");
    const termoNumero = String(buscaContatosCompositor?.value || "").replace(
      /\D/g,
      "",
    );
    const contatos = (obterContatosSalvosWhatsapp?.() || [])
      .filter((contato) => {
        if (!contato?.id || !contato?.nome) return false;
        if (!termo && !termoNumero) return true;

        const nome = normalizarTextoBusca(contato.nome);
        const numero = digitosNumeroConversa(
          contato.numeroWhatsapp || contato.id,
        );

        return (
          nome.includes(termo) ||
          (!!termoNumero && String(numero || "").includes(termoNumero))
        );
      })
      .slice(0, 300);

    const fragmento = document.createDocumentFragment();

    for (const contato of contatos) {
      fragmento.appendChild(criarItemContatoCompartilhar(contato));
    }

    if (!contatos.length) {
      const vazio = document.createElement("div");
      vazio.className = "painel-compositor-vazio";
      vazio.textContent = "Nenhum contato salvo encontrado.";
      fragmento.appendChild(vazio);
    }

    listaContatosCompositor.replaceChildren(fragmento);
  }

  async function abrirPainelCompartilharContato() {
    fecharPaineisCompositor({ manter: "contatos" });
    painelContatosCompositor.hidden = false;
    listaContatosCompositor.innerHTML =
      '<div class="painel-compositor-vazio">Carregando contatos salvos...</div>';

    try {
      await carregarContatosSalvosWhatsapp(false);
      renderizarContatosCompositor();
      setTimeout(() => buscaContatosCompositor?.focus(), 0);
    } catch {
      listaContatosCompositor.innerHTML =
        '<div class="painel-compositor-vazio">Não foi possível carregar os contatos.</div>';
    }
  }

  buscaContatosCompositor?.addEventListener(
    "input",
    renderizarContatosCompositor,
  );

  for (const fechar of painelContatosCompositor.querySelectorAll(
    ".painel-compositor-fechar",
  )) {
    fechar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      painelContatosCompositor.hidden = true;
    });
  }

  painelContatosCompositor.addEventListener("click", (evento) => {
    evento.stopPropagation();
  });

  async function selecionarEEnviarAnexo(tipo) {
    const conversaAtual = obterConversaAtual();
    const conversa = conversas[conversaAtual];

    if (!conversa) {
      return;
    }

    let videoOtimistaId = null;
    let desarquivadaLocalmente = false;

    try {
      const selecionado = await ipcRenderer.invoke("selecionar-anexo", {
        tipo,
      });

      if (!selecionado?.ok || selecionado.cancelado) {
        return;
      }

      const legenda = campoMensagem.value;
      const respostaEnvio = obterRespostaAtualParaEnvio();
      const mensagemRespondendo = obterMensagemRespondendo?.() || null;

      const confirmacao = await confirmarEnvioAnexo(selecionado, legenda);

      if (!confirmacao?.confirmado) {
        return;
      }

      const legendaFinal = String(confirmacao.legenda || "").trim();

      botaoAnexar.disabled = true;
      botaoFigurinhas.disabled = true;
      botaoEnviarMensagem.disabled = true;
      botaoFigurinhas.disabled = true;
      botaoMicrofone.disabled = true;

      statusChat.textContent =
        selecionado.tipo === "imagem"
          ? "Enviando foto..."
          : selecionado.tipo === "video"
            ? "Enviando vídeo..."
            : selecionado.tipo === "audio"
              ? "Enviando áudio..."
              : "Enviando arquivo...";

      desarquivadaLocalmente = desarquivarLocalmenteAoEnviar(conversa);

      videoOtimistaId =
        selecionado.tipo === "video"
          ? criarVideoOtimista(
              conversa,
              selecionado,
              legendaFinal,
              respostaEnvio,
            )
          : null;

      const resultado = await ipcRenderer.invoke("enviar-anexo", {
        conversaId: conversa.id,
        caminho: selecionado.caminho,
        tipo: selecionado.tipo,
        legenda: legendaFinal,
        resposta: respostaEnvio,
      });

      if (!resultado?.ok) {
        restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);

        if (videoOtimistaId) {
          removerVideoOtimista(conversa, videoOtimistaId);
        }

        statusChat.textContent =
          resultado?.erro || "Não foi possível enviar o arquivo.";
        return;
      }

      if (videoOtimistaId) {
        const mensagemLocal = conversa.mensagens?.find(
          (msg) => msg.idMensagem === videoOtimistaId,
        );

        if (mensagemLocal && resultado.idMensagem) {
          mensagemLocal.idMensagem = resultado.idMensagem;
          mensagemLocal.statusEntrega = mesclarStatus(mensagemLocal.statusEntrega, resultado.statusEntrega);
          videosLocaisPendentes.delete(videoOtimistaId);

          if (obterConversaAtual?.() === conversa.id) {
            renderMensagens?.();
          }
        }
      }

      campoMensagem.value = "";
      ajustarAlturaCampoMensagem();

      if (
        respostaEnvio &&
        mensagemRespondendo?.idMensagem === respostaEnvio.idMensagem &&
        mensagemRespondendo?.conversaId === conversa.id
      ) {
        limparRespostaMensagem(false);
      }

      statusChat.textContent = "";
    } catch (erro) {
      restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);

      if (videoOtimistaId) {
        removerVideoOtimista(conversa, videoOtimistaId);
      }

      statusChat.textContent = erro?.message || "Erro ao enviar o arquivo.";
    } finally {
      atualizarCompositor();
    }
  }

  botaoAnexar.addEventListener("click", (evento) => {
    evento.stopPropagation();

    const abrir = menuAnexos.style.display !== "block";
    fecharPaineisCompositor({ manter: abrir ? "anexos" : null });
    menuAnexos.style.display = abrir ? "block" : "none";
  });

  document.addEventListener("click", () => {
    fecharPaineisCompositor();
  });

  return {
    fecharPaineisCompositor,
    confirmarEnvioAnexo,
    abrirPainelCompartilharContato,
    selecionarEEnviarAnexo,
    reconciliarVideoOtimista,
    removerVideoOtimista,
  };
}

module.exports = {
  criarModuloAnexos,
};
