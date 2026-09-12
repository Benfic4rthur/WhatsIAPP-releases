function criarModuloFigurinhas(dependencias = {}) {
  const {
    ipcRenderer,
    fs,
    path,
    document,
    painelFigurinhasCompositor,
    botaoFigurinhas,
    statusChat,
    conversas,
    obterConversaAtual,
    fecharPaineisCompositor,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
    obterRespostaAtualParaEnvio,
  } = dependencias;

  const gradeFigurinhasCompositor = painelFigurinhasCompositor?.querySelector(
    ".painel-figurinhas-grade",
  );
  let figurinhasWhatsappCache = [];
  let envioFigurinhaCompositorEmAndamento = false;
  let carregandoFigurinhasWhatsapp = false;

  function dataUrlFigurinhaPorArquivo(caminho) {
    try {
      const arquivo = String(caminho || "").trim();

      if (!arquivo || !fs.existsSync(arquivo)) {
        return null;
      }

      const bytes = fs.readFileSync(arquivo);

      if (!bytes?.length) {
        return null;
      }

      const extensao = path.extname(arquivo).toLowerCase();
      const mime =
        extensao === ".png"
          ? "image/png"
          : extensao === ".jpg" || extensao === ".jpeg"
            ? "image/jpeg"
            : "image/webp";

      return `data:${mime};base64,${bytes.toString("base64")}`;
    } catch {
      return null;
    }
  }

  function figurinhaAnimadaPorArquivo(caminho) {
    try {
      const arquivo = String(caminho || "").trim();
      if (!arquivo || !fs.existsSync(arquivo)) return false;

      const bytes = fs.readFileSync(arquivo);
      if (!bytes?.length) return false;

      const cabecalho = bytes.subarray(0, Math.min(bytes.length, 512));
      const texto = cabecalho.toString("latin1");

      return (
        texto.startsWith("GIF87a") ||
        texto.startsWith("GIF89a") ||
        (texto.startsWith("RIFF") &&
          texto.includes("WEBP") &&
          texto.includes("ANIM"))
      );
    } catch {
      return false;
    }
  }

  async function coletarFigurinhasHistoricoLocal(limite = 48) {
    const candidatas = [];

    for (const conversa of Object.values(conversas)) {
      if (!conversa || !Array.isArray(conversa.mensagens)) continue;

      for (const msg of conversa.mensagens) {
        if (msg?.tipo !== "sticker" || !msg?.idMensagem) continue;

        candidatas.push({
          conversa,
          msg,
          minha: !!msg.minha,
          timestamp: Number(msg.timestamp || 0) || 0,
        });
      }
    }

    candidatas.sort((a, b) => {
      if (a.minha !== b.minha) return a.minha ? -1 : 1;
      return b.timestamp - a.timestamp;
    });

    const saida = [];
    const vistos = new Set();

    for (const item of candidatas) {
      if (saida.length >= limite) break;

      const chave = `${item.conversa.id}:${item.msg.idMensagem}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      let mediaPath = String(item.msg.mediaPath || "").trim();

      if ((!mediaPath || !fs.existsSync(mediaPath)) && item.msg.idMensagem) {
        try {
          const resultado = await ipcRenderer.invoke("carregar-midia", {
            conversaId: item.conversa.id,
            idMensagem: item.msg.idMensagem,
          });

          if (resultado?.ok && resultado.mediaPath) {
            mediaPath = String(resultado.mediaPath);
            item.msg.mediaPath = mediaPath;
            item.msg.mediaUrl = resultado.mediaUrl || item.msg.mediaUrl || null;
          }
        } catch {}
      }

      let dataUrl = dataUrlFigurinhaPorArquivo(mediaPath);

      if (!dataUrl && /^data:image\//i.test(String(item.msg.mediaUrl || ""))) {
        dataUrl = String(item.msg.mediaUrl);
      }

      if (!dataUrl) continue;

      saida.push({
        id: `historico:${chave}`,
        dataUrl,
        mimetype: "image/webp",
        animated: figurinhaAnimadaPorArquivo(mediaPath),
        origem: item.minha ? "historico-enviada" : "historico-recebida",
      });
    }

    return saida;
  }

  function mesclarFigurinhasSemDuplicar(...listas) {
    const saida = [];
    const vistos = new Set();

    for (const lista of listas) {
      for (const item of Array.isArray(lista) ? lista : []) {
        const dataUrl = String(item?.dataUrl || "");
        if (!dataUrl) continue;

        // Para o painel, o proprio conteudo e a chave mais segura para evitar
        // duplicatas vindas do store e do historico local.
        const assinatura =
          dataUrl.length > 220
            ? `${dataUrl.slice(0, 140)}:${dataUrl.slice(-80)}`
            : dataUrl;

        if (vistos.has(assinatura)) continue;
        vistos.add(assinatura);
        saida.push(item);
      }
    }

    return saida;
  }

  function renderizarFigurinhasCompositor() {
    if (!gradeFigurinhasCompositor) {
      return;
    }

    const fragmento = document.createDocumentFragment();

    for (const figurinha of figurinhasWhatsappCache.slice(0, 60)) {
      if (!figurinha?.dataUrl) continue;

      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "painel-figurinha-item";
      botao.title = "Enviar figurinha";

      const img = document.createElement("img");
      img.src = figurinha.dataUrl;
      img.alt = "Figurinha";
      img.loading = "lazy";

      botao.appendChild(img);

      botao.addEventListener("click", async (evento) => {
        evento.preventDefault();
        evento.stopPropagation();

        const conversaAtual = obterConversaAtual();
        const conversa = conversas[conversaAtual];
        if (!conversa || envioFigurinhaCompositorEmAndamento) return;

        envioFigurinhaCompositorEmAndamento = true;
        botao.disabled = true;
        statusChat.textContent = "Enviando figurinha...";
        const desarquivadaLocalmente = desarquivarLocalmenteAoEnviar(conversa);

        try {
          const resultado = await ipcRenderer.invoke(
            "enviar-figurinha-whatsapp",
            {
              conversaId: conversa.id,
              dataUrl: figurinha.dataUrl,
              mimetype: figurinha.mimetype || "image/webp",
              animated: !!figurinha.animated,
              origem: figurinha.origem || null,
              idOrigem: figurinha.id || null,
              resposta: obterRespostaAtualParaEnvio(),
            },
          );

          if (!resultado?.ok) {
            restaurarArquivamentoLocalSeFalhar(
              conversa,
              desarquivadaLocalmente,
            );
            statusChat.textContent =
              resultado?.erro || "Não foi possível enviar a figurinha.";
            return;
          }

          painelFigurinhasCompositor.hidden = true;
          statusChat.textContent = "";
        } catch (erro) {
          restaurarArquivamentoLocalSeFalhar(conversa, desarquivadaLocalmente);
          statusChat.textContent =
            erro?.message || "Não foi possível enviar a figurinha.";
        } finally {
          envioFigurinhaCompositorEmAndamento = false;
          botao.disabled = false;
        }
      });

      fragmento.appendChild(botao);
    }

    if (!fragmento.childNodes.length) {
      const vazio = document.createElement("div");
      vazio.className = "painel-compositor-vazio painel-figurinhas-vazio";
      vazio.textContent =
        "Nenhuma figurinha carregada no WhatsApp neste momento.";
      fragmento.appendChild(vazio);
    }

    gradeFigurinhasCompositor.replaceChildren(fragmento);
  }

  async function abrirPainelFigurinhas() {
    fecharPaineisCompositor({ manter: "figurinhas" });
    painelFigurinhasCompositor.hidden = false;

    if (figurinhasWhatsappCache.length) {
      renderizarFigurinhasCompositor();
      return;
    }

    if (carregandoFigurinhasWhatsapp) {
      return;
    }

    carregandoFigurinhasWhatsapp = true;
    gradeFigurinhasCompositor.innerHTML =
      '<div class="painel-compositor-vazio">Carregando suas figurinhas...</div>';

    try {
      const resultado = await ipcRenderer.invoke("listar-figurinhas-whatsapp");
      const figurinhasWpp = Array.isArray(resultado?.figurinhas)
        ? resultado.figurinhas
        : [];

      // O store interno do WhatsApp varia entre versoes. Se ele vier vazio ou
      // parcial, completa com figurinhas reais ja presentes no historico local.
      const figurinhasHistorico =
        figurinhasWpp.length >= 24
          ? []
          : await coletarFigurinhasHistoricoLocal(48);

      figurinhasWhatsappCache = mesclarFigurinhasSemDuplicar(
        figurinhasWpp,
        figurinhasHistorico,
      ).slice(0, 60);

      renderizarFigurinhasCompositor();
    } catch {
      gradeFigurinhasCompositor.innerHTML =
        '<div class="painel-compositor-vazio">Não foi possível carregar as figurinhas.</div>';
    } finally {
      carregandoFigurinhasWhatsapp = false;
    }
  }

  for (const fechar of painelFigurinhasCompositor.querySelectorAll(
    ".painel-compositor-fechar",
  )) {
    fechar.addEventListener("click", (evento) => {
      evento.stopPropagation();
      painelFigurinhasCompositor.hidden = true;
    });
  }

  painelFigurinhasCompositor.addEventListener("click", (evento) => {
    evento.stopPropagation();
  });

  botaoFigurinhas.addEventListener("click", (evento) => {
    evento.stopPropagation();

    if (!painelFigurinhasCompositor.hidden) {
      painelFigurinhasCompositor.hidden = true;
      return;
    }

    abrirPainelFigurinhas();
  });

  return {
    abrirPainelFigurinhas,
  };
}

module.exports = {
  criarModuloFigurinhas,
};
