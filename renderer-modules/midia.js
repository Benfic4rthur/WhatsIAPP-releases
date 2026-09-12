function criarPersistenciaMidiasEnviadasLocais({
  localStorage,
  fs,
  pathToFileURL,
}) {
  const CHAVE_MIDIAS_ENVIADAS_LOCAIS = "whatsiapp.midiasEnviadasLocais.v1";

  function carregarMidiasEnviadasLocais() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_MIDIAS_ENVIADAS_LOCAIS) || "{}",
      );
      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const midiasEnviadasLocais = carregarMidiasEnviadasLocais();

  function salvarMidiasEnviadasLocais() {
    try {
      const entradas = Object.entries(midiasEnviadasLocais)
        .sort((a, b) => Number(b[1]?.salvoEm || 0) - Number(a[1]?.salvoEm || 0))
        .slice(0, 250);
      const reduzido = Object.fromEntries(entradas);
      localStorage.setItem(
        CHAVE_MIDIAS_ENVIADAS_LOCAIS,
        JSON.stringify(reduzido),
      );
    } catch {}
  }

  function persistirMidiaEnviadaLocal(dados) {
    const idMensagem = String(dados?.idMensagem || "").trim();
    const mediaPath = String(dados?.mediaPath || "").trim();
    if (!idMensagem || !mediaPath) {
      return;
    }
    midiasEnviadasLocais[idMensagem] = {
      mediaPath,
      mime: dados?.mime || null,
      fileName: dados?.fileName || null,
      salvoEm: Date.now(),
    };
    salvarMidiasEnviadasLocais();
  }

  function recuperarMidiaEnviadaLocal(idMensagem) {
    const id = String(idMensagem || "").trim();
    if (!id) {
      return null;
    }
    const salvo = midiasEnviadasLocais[id];
    if (!salvo?.mediaPath) {
      return null;
    }
    try {
      if (!fs.existsSync(salvo.mediaPath)) {
        delete midiasEnviadasLocais[id];
        salvarMidiasEnviadasLocais();
        return null;
      }
      return {
        mediaPath: salvo.mediaPath,
        mediaUrl: pathToFileURL(salvo.mediaPath).href,
        mime: salvo.mime || null,
        fileName: salvo.fileName || null,
      };
    } catch {
      return null;
    }
  }

  return {
    midiasEnviadasLocais,
    salvarMidiasEnviadasLocais,
    persistirMidiaEnviadaLocal,
    recuperarMidiaEnviadaLocal,
  };
}

function criarModuloMidia({
  ipcRenderer,
  document,
  window,
  chatPrincipal,
  moduloAudio,
  conversas,
  obterConversaAtual,
}) {
  function criarPlaceholderMidia(texto = "Carregando mídia...") {
    const div = document.createElement("div");
    div.className = "midia-placeholder";
    div.textContent = texto;
    return div;
  }

  let modalMidiaAtual = null;
  let mensagemModalMidiaAtual = null;

  function obterConversaModalMidia() {
    const conversaId = obterConversaAtual?.();

    if (!conversaId || !conversas) {
      return null;
    }

    if (typeof conversas.get === "function") {
      return conversas.get(conversaId) || null;
    }

    return conversas[conversaId] || null;
  }

  function listarMidiasNavegaveis() {
    const conversa = obterConversaModalMidia();

    return (Array.isArray(conversa?.mensagens) ? conversa.mensagens : [])
      .filter(
        (item) =>
          item && ["imagem", "video"].includes(item.tipo) && item.idMensagem,
      )
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  async function garantirMidiaCarregada(msg) {
    if (msg?.mediaUrl) {
      return true;
    }

    const conversa = obterConversaModalMidia();

    if (!conversa?.id || !msg?.idMensagem) {
      return false;
    }

    try {
      const resultado = await ipcRenderer.invoke("carregar-midia", {
        conversaId: conversa.id,
        idMensagem: msg.idMensagem,
      });

      if (!resultado?.ok || !resultado?.mediaUrl) {
        return false;
      }

      msg.mediaUrl = resultado.mediaUrl;
      msg.mediaPath = resultado.mediaPath || msg.mediaPath || null;
      msg.fileName = resultado.fileName || msg.fileName || null;
      msg.erroMidia = null;

      return true;
    } catch {
      return false;
    }
  }

  async function navegarModalMidia(delta) {
    if (!mensagemModalMidiaAtual) {
      return;
    }

    const lista = listarMidiasNavegaveis();
    const idAtual = String(mensagemModalMidiaAtual?.idMensagem || "");
    const indiceAtual = lista.findIndex(
      (item) => String(item?.idMensagem || "") === idAtual,
    );

    if (indiceAtual < 0) {
      return;
    }

    const destino = lista[indiceAtual + delta];

    if (!destino) {
      return;
    }

    if (!(await garantirMidiaCarregada(destino))) {
      return;
    }

    abrirModalMidia(destino);
  }

  function fecharModalMidia() {
    if (modalMidiaAtual && modalMidiaAtual.isConnected) {
      modalMidiaAtual.remove();
    }

    modalMidiaAtual = null;
    mensagemModalMidiaAtual = null;
  }

  function abrirModalMidia(msg) {
    if (!msg?.mediaUrl || !["imagem", "video"].includes(msg.tipo)) {
      return;
    }

    fecharModalMidia();

    const overlay = document.createElement("div");

    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      zIndex: "5000",
      background: "rgba(3,7,9,.97)",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    });

    const barra = document.createElement("div");

    Object.assign(barra.style, {
      flex: "0 0 56px",
      height: "56px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
      padding: "8px 12px",
      boxSizing: "border-box",
      background: "rgba(12,18,22,.96)",
      borderBottom: "1px solid #26343c",
      position: "relative",
      zIndex: "3",
    });

    const viewport = document.createElement("div");

    Object.assign(viewport.style, {
      position: "relative",
      flex: "1 1 auto",
      minHeight: "0",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "default",
      touchAction: "none",
    });

    function botaoControle(texto, titulo, largura = 38) {
      const botao = document.createElement("button");

      botao.type = "button";
      botao.textContent = texto;
      botao.title = titulo;

      Object.assign(botao.style, {
        width: `${largura}px`,
        minWidth: `${largura}px`,
        height: "38px",
        padding: "0",
        margin: "0",
        border: "1px solid #2b3940",
        borderRadius: "9px",
        background: "#182229",
        color: "#e9edef",
        cursor: "pointer",
        fontSize: "15px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
      });

      return botao;
    }

    const fechar = botaoControle("×", "Fechar", 40);

    const listaNavegacao = listarMidiasNavegaveis();
    const indiceNavegacao = listaNavegacao.findIndex(
      (item) =>
        String(item?.idMensagem || "") === String(msg?.idMensagem || ""),
    );

    function criarBotaoNavegacao(texto, titulo, lado, delta, habilitado) {
      const botao = document.createElement("button");

      botao.type = "button";
      botao.textContent = texto;
      botao.title = titulo;
      botao.setAttribute("aria-label", titulo);

      Object.assign(botao.style, {
        position: "absolute",
        top: "50%",
        [lado]: "18px",
        transform: "translateY(-50%)",
        width: "48px",
        height: "48px",
        border: "1px solid rgba(255,255,255,.18)",
        borderRadius: "50%",
        background: "rgba(17,27,33,.82)",
        color: "#e9edef",
        fontSize: "34px",
        lineHeight: "1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: habilitado ? "pointer" : "default",
        opacity: habilitado ? "1" : ".28",
        zIndex: "5",
        padding: "0 0 4px 0",
        boxSizing: "border-box",
        userSelect: "none",
      });

      botao.disabled = !habilitado;

      botao.addEventListener("pointerdown", (evento) => {
        evento.stopPropagation();
      });

      botao.addEventListener("click", (evento) => {
        evento.preventDefault();
        evento.stopPropagation();

        if (!botao.disabled) {
          void navegarModalMidia(delta);
        }
      });

      return botao;
    }

    const anterior = criarBotaoNavegacao(
      "‹",
      "Mídia anterior",
      "left",
      -1,
      indiceNavegacao > 0,
    );

    const proxima = criarBotaoNavegacao(
      "›",
      "Próxima mídia",
      "right",
      1,
      indiceNavegacao >= 0 && indiceNavegacao < listaNavegacao.length - 1,
    );

    fechar.style.position = "absolute";

    fechar.style.right = "10px";

    fechar.style.top = "9px";

    fechar.style.fontSize = "24px";

    if (msg.tipo === "imagem") {
      let escala = 1;
      let offsetX = 0;
      let offsetY = 0;
      let arrastando = false;
      let inicioX = 0;
      let inicioY = 0;
      let origemX = 0;
      let origemY = 0;

      const imagem = document.createElement("img");

      imagem.src = msg.mediaUrl;

      imagem.alt = msg.texto || "Imagem";

      Object.assign(imagem.style, {
        display: "block",
        maxWidth: "calc(100% - 36px)",
        maxHeight: "calc(100% - 36px)",
        width: "auto",
        height: "auto",
        objectFit: "contain",
        transformOrigin: "center center",
        userSelect: "none",
        WebkitUserDrag: "none",
        transition: "transform .10s ease",
        cursor: "zoom-in",
      });

      const baixar = botaoControle("", "Baixar imagem", 40);

      baixar.setAttribute("aria-label", "Baixar imagem");
      baixar.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round"><path d="M12 3v12"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/></svg>';

      function nomeArquivoDownloadImagem() {
        const informado = String(msg?.fileName || "").trim();

        if (informado) {
          return informado;
        }

        const mime = String(msg?.mime || "").toLowerCase();
        let extensao = ".jpg";

        if (mime.includes("png")) extensao = ".png";
        else if (mime.includes("webp")) extensao = ".webp";
        else if (mime.includes("gif")) extensao = ".gif";
        else {
          try {
            const url = new URL(String(msg?.mediaUrl || ""));
            const match = url.pathname.match(/\.(jpe?g|png|webp|gif|bmp)$/i);
            if (match?.[1]) {
              extensao = `.${String(match[1]).toLowerCase()}`;
            }
          } catch {}
        }

        const data = new Date();
        const pad = (valor) => String(valor).padStart(2, "0");
        const carimbo = `${data.getFullYear()}${pad(data.getMonth() + 1)}${pad(data.getDate())}-${pad(data.getHours())}${pad(data.getMinutes())}${pad(data.getSeconds())}`;

        return `WhatsIAPP-imagem-${carimbo}${extensao}`;
      }

      baixar.addEventListener("click", (evento) => {
        evento.preventDefault();
        evento.stopPropagation();

        try {
          const link = document.createElement("a");
          link.href = msg.mediaUrl;
          link.download = nomeArquivoDownloadImagem();
          link.style.display = "none";
          document.body.appendChild(link);
          link.click();
          link.remove();
        } catch (erro) {
          console.warn(
            `[MIDIA] Falha ao baixar imagem: ${erro?.message || erro || "erro desconhecido"}`,
          );
        }
      });

      function limitarPan() {
        if (escala <= 1) {
          offsetX = 0;
          offsetY = 0;
          return;
        }

        const rect = viewport.getBoundingClientRect();

        const imgRect = imagem.getBoundingClientRect();

        const larguraBase = imgRect.width / escala;

        const alturaBase = imgRect.height / escala;

        const sobraX = Math.max(
          0,
          (larguraBase * escala - rect.width) / 2 + 18,
        );

        const sobraY = Math.max(
          0,
          (alturaBase * escala - rect.height) / 2 + 18,
        );

        offsetX = Math.max(-sobraX, Math.min(sobraX, offsetX));

        offsetY = Math.max(-sobraY, Math.min(sobraY, offsetY));
      }

      function aplicarTransformacao(animar = true) {
        limitarPan();

        imagem.style.transition = animar ? "transform .10s ease" : "none";

        imagem.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${escala})`;

        viewport.style.cursor =
          escala > 1 ? (arrastando ? "grabbing" : "grab") : "default";

        imagem.style.cursor = escala > 1 ? "grab" : "zoom-in";
      }

      function alterarZoom(novaEscala, ponto = null) {
        const anterior = escala;

        escala = Math.min(5, Math.max(1, novaEscala));

        if (ponto && anterior !== escala) {
          const rect = viewport.getBoundingClientRect();

          const x = ponto.x - (rect.left + rect.width / 2);

          const y = ponto.y - (rect.top + rect.height / 2);

          const fator = escala / anterior;

          offsetX = x - (x - offsetX) * fator;

          offsetY = y - (y - offsetY) * fator;
        }

        if (escala === 1) {
          offsetX = 0;
          offsetY = 0;
        }

        aplicarTransformacao();
      }

      viewport.addEventListener(
        "wheel",
        (evento) => {
          evento.preventDefault();
          evento.stopPropagation();

          alterarZoom(escala + (evento.deltaY < 0 ? 0.2 : -0.2), {
            x: evento.clientX,
            y: evento.clientY,
          });
        },
        {
          passive: false,
        },
      );

      imagem.addEventListener("dblclick", (evento) => {
        evento.preventDefault();
        evento.stopPropagation();

        if (escala === 1) {
          alterarZoom(2, {
            x: evento.clientX,
            y: evento.clientY,
          });
        } else {
          escala = 1;
          offsetX = 0;
          offsetY = 0;

          aplicarTransformacao();
        }
      });

      viewport.addEventListener("pointerdown", (evento) => {
        if (escala <= 1) {
          return;
        }

        arrastando = true;

        inicioX = evento.clientX;

        inicioY = evento.clientY;

        origemX = offsetX;

        origemY = offsetY;

        viewport.setPointerCapture?.(evento.pointerId);

        aplicarTransformacao(false);
      });

      viewport.addEventListener("pointermove", (evento) => {
        if (!arrastando) {
          return;
        }

        offsetX = origemX + (evento.clientX - inicioX);

        offsetY = origemY + (evento.clientY - inicioY);

        aplicarTransformacao(false);
      });

      function finalizarArrasto(evento) {
        if (!arrastando) {
          return;
        }

        arrastando = false;

        try {
          viewport.releasePointerCapture?.(evento.pointerId);
        } catch {}

        aplicarTransformacao(false);
      }

      viewport.addEventListener("pointerup", finalizarArrasto);

      viewport.addEventListener("pointercancel", finalizarArrasto);

      window.addEventListener("resize", () => {
        if (modalMidiaAtual === overlay) {
          aplicarTransformacao(false);
        }
      });

      imagem.addEventListener(
        "load",
        () => {
          escala = 1;
          offsetX = 0;
          offsetY = 0;

          aplicarTransformacao(false);
        },
        {
          once: true,
        },
      );

      barra.appendChild(baixar);

      viewport.appendChild(imagem);
    } else {
      const video = document.createElement("video");

      video.src = msg.mediaUrl;

      video.controls = true;
      video.autoplay = true;

      Object.assign(video.style, {
        display: "block",
        maxWidth: "calc(100% - 36px)",
        maxHeight: "calc(100% - 36px)",
        width: "auto",
        height: "auto",
        objectFit: "contain",
        background: "#000",
        borderRadius: "10px",
      });

      viewport.appendChild(video);
    }

    barra.appendChild(fechar);

    overlay.appendChild(barra);
    overlay.appendChild(viewport);

    fechar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      fecharModalMidia();
    });

    viewport.addEventListener("click", (evento) => {
      if (evento.target === viewport) {
        fecharModalMidia();
      }
    });

    viewport.appendChild(anterior);
    viewport.appendChild(proxima);

    mensagemModalMidiaAtual = msg;
    modalMidiaAtual = overlay;

    chatPrincipal.appendChild(overlay);
  }

  document.addEventListener("keydown", (evento) => {
    if (!modalMidiaAtual) {
      return;
    }

    if (evento.key === "Escape") {
      fecharModalMidia();
      return;
    }

    if (evento.key === "ArrowLeft") {
      evento.preventDefault();
      void navegarModalMidia(-1);
      return;
    }

    if (evento.key === "ArrowRight") {
      evento.preventDefault();
      void navegarModalMidia(1);
    }
  });

  function criarConteudoMidia(msg, conversa = null) {
    if (!msg.mediaUrl) {
      return criarPlaceholderMidia(
        msg.erroMidia ? msg.erroMidia : "Carregando mídia...",
      );
    }

    if (msg.tipo === "imagem") {
      const img = document.createElement("img");
      img.className = "midia-imagem";
      img.src = msg.mediaUrl;
      img.alt = msg.texto || "Imagem";
      img.loading = "lazy";
      img.style.cursor = "pointer";

      img.addEventListener("click", () => abrirModalMidia(msg));

      return img;
    }

    if (msg.tipo === "sticker") {
      const img = document.createElement("img");
      img.className = "midia-sticker";
      img.src = msg.mediaUrl;
      img.alt = "Figurinha";
      img.loading = "lazy";
      return img;
    }

    if (msg.tipo === "audio") {
      return moduloAudio.criarConteudoAudioWhatsapp(msg, conversa);
    }

    if (msg.tipo === "video") {
      const video = document.createElement("video");
      video.className = "midia-video";
      video.controls = false;
      video.preload = "metadata";
      video.src = msg.mediaUrl;
      video.muted = true;
      video.style.cursor = "pointer";
      video.title = "Abrir vídeo";

      video.addEventListener("click", () => abrirModalMidia(msg));

      return video;
    }

    if (msg.tipo === "documento") {
      const botao = document.createElement("button");
      botao.className = "midia-documento";
      botao.textContent = `📎 ${msg.fileName || msg.texto || "Abrir documento"}`;
      botao.addEventListener("click", async () => {
        if (!msg.mediaPath) return;
        await ipcRenderer.invoke("abrir-arquivo", msg.mediaPath);
      });
      return botao;
    }

    return criarPlaceholderMidia("Mídia");
  }

  return {
    criarConteudoMidia,
    abrirModalMidia,
    fecharModalMidia,
  };
}

module.exports = { criarModuloMidia, criarPersistenciaMidiasEnviadasLocais };
