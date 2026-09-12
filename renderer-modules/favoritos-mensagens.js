function criarModuloFavoritos(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    localStorage,
    statusChat,
    listaConversas,
    conversas,
    ehConversaTecnica,
    normalizarTextoBusca,
    abrirConversa,
    cancelarFixacaoFimConversa,
    localizarMensagemNaTela,
    destacarMensagemRespondida,
    atualizarContadores,
    renderMensagens,
    renderConversas,
    atualizarStatusCabecalho,
    obterConversaAtual,
    obterFiltro,
    obterAbaAtual,
  } = dependencias;

  const CHAVE_FAVORITOS_MENSAGENS = "whatsiapp.favoritosMensagens.v1";

  function chaveFavoritoMensagem(conversaId, idMensagem) {
    const conversa = String(conversaId || "")
      .trim()
      .toLowerCase();
    const id = String(idMensagem || "").trim();

    if (!conversa || !id) {
      return null;
    }

    return `${conversa}|${id}`;
  }

  function carregarFavoritosPersistidos() {
    try {
      const dados = JSON.parse(
        localStorage.getItem(CHAVE_FAVORITOS_MENSAGENS) || "{}",
      );

      return dados && typeof dados === "object" ? dados : {};
    } catch {
      return {};
    }
  }

  const favoritosMensagensPersistidos = carregarFavoritosPersistidos();

  function salvarFavoritosPersistidos() {
    try {
      const entradas = Object.entries(favoritosMensagensPersistidos)
        .sort(
          (a, b) =>
            Number(b[1]?.favoritadoEm || 0) - Number(a[1]?.favoritadoEm || 0),
        )
        .slice(0, 5000);

      const reduzido = Object.fromEntries(entradas);

      for (const chave of Object.keys(favoritosMensagensPersistidos)) {
        delete favoritosMensagensPersistidos[chave];
      }

      Object.assign(favoritosMensagensPersistidos, reduzido);

      localStorage.setItem(
        CHAVE_FAVORITOS_MENSAGENS,
        JSON.stringify(favoritosMensagensPersistidos),
      );
    } catch {}
  }

  function mensagemEstaFavoritada(conversaId, idMensagem) {
    const chave = chaveFavoritoMensagem(conversaId, idMensagem);

    return !!(chave && favoritosMensagensPersistidos[chave]);
  }

  function descricaoFavoritoMensagem(msg) {
    const texto = String(msg?.texto || "")
      .replace(/\s+/g, " ")
      .trim();

    if (texto) {
      return texto.length > 220 ? `${texto.slice(0, 217)}...` : texto;
    }

    const tipo = String(msg?.tipo || "").toLowerCase();

    if (tipo === "imagem") return "📷 Foto";
    if (tipo === "video") return "🎥 Vídeo";
    if (tipo === "audio") return "🎤 Áudio";
    if (tipo === "sticker") return "🧩 Figurinha";
    if (tipo === "documento") return `📎 ${msg?.fileName || "Documento"}`;
    if (tipo === "localizacao") return "📍 Localização";
    if (tipo === "contato") return "👤 Contato";
    if (tipo === "view_once") return "① Mídia de visualização única";

    return "Mensagem";
  }

  function registrarFavoritoLocalmente(conversa, msg) {
    const chave = chaveFavoritoMensagem(conversa?.id, msg?.idMensagem);

    if (!chave || !conversa || !msg) {
      return;
    }

    favoritosMensagensPersistidos[chave] = {
      conversaId: conversa.id,
      conversaNome: conversa.nome || conversa.id,
      idMensagem: String(msg.idMensagem || ""),
      idMensagemWpp: msg.idMensagemWpp || null,
      minha: !!msg.minha,
      texto: String(msg.texto || ""),
      tipo: String(msg.tipo || "texto"),
      fileName: msg.fileName || null,
      horario: msg.horario || "",
      timestamp: Number(msg.timestamp || 0) || 0,
      favoritadoEm: Date.now(),
    };

    salvarFavoritosPersistidos();
  }

  function removerFavoritoLocalmente(conversaId, idMensagem) {
    const chave = chaveFavoritoMensagem(conversaId, idMensagem);

    if (!chave || !favoritosMensagensPersistidos[chave]) {
      return;
    }

    delete favoritosMensagensPersistidos[chave];
    salvarFavoritosPersistidos();
  }

  function atualizarFavoritoEditadoLocalmente(conversaId, idMensagem, texto) {
    const chave = chaveFavoritoMensagem(conversaId, idMensagem);
    const favorito = chave ? favoritosMensagensPersistidos[chave] : null;

    if (!favorito) {
      return;
    }

    favorito.texto = String(texto || "");
    favorito.tipo = "texto";
    favorito.atualizadoEm = Date.now();

    salvarFavoritosPersistidos();
  }

  function limparFavoritosDaConversa(conversaId) {
    const prefixo = `${String(conversaId || "")
      .trim()
      .toLowerCase()}|`;

    if (prefixo === "|") {
      return;
    }

    let mudou = false;

    for (const chave of Object.keys(favoritosMensagensPersistidos)) {
      if (chave.startsWith(prefixo)) {
        delete favoritosMensagensPersistidos[chave];
        mudou = true;
      }
    }

    if (mudou) {
      salvarFavoritosPersistidos();
    }
  }

  function totalFavoritosVisiveis() {
    return Object.values(favoritosMensagensPersistidos).filter((favorito) => {
      const conversa = conversas[favorito?.conversaId];

      return !!(conversa && !ehConversaTecnica(conversa) && !conversa.trancada);
    }).length;
  }

  function dadosMensagemParaFavorito(msg) {
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

  async function alterarFavoritoMensagem(msg) {
    const conversaId = obterConversaAtual();
    const conversa = conversas[conversaId];
    const mensagem = dadosMensagemParaFavorito(msg);

    if (!conversa || !mensagem) {
      statusChat.textContent =
        "Aguarde a mensagem terminar de carregar antes de favoritar.";
      return;
    }

    const favoritar = !mensagemEstaFavoritada(conversaId, mensagem.idMensagem);

    try {
      const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
        favoritar: {
          conversaId,
          mensagem,
          favoritar,
        },
      });

      if (!resultado?.ok) {
        throw new Error(
          resultado?.erro ||
            (favoritar
              ? "Não foi possível favoritar a mensagem."
              : "Não foi possível desfavoritar a mensagem."),
        );
      }

      if (favoritar) {
        registrarFavoritoLocalmente(conversa, msg);
      } else {
        removerFavoritoLocalmente(conversaId, mensagem.idMensagem);
      }

      atualizarContadores();

      if (obterConversaAtual() === conversaId) {
        renderMensagens();
      }

      if (obterAbaAtual() === "favoritos") {
        renderConversas();
      }

      const textoStatus = favoritar
        ? "Mensagem adicionada aos favoritos."
        : "Mensagem removida dos favoritos.";

      statusChat.textContent = textoStatus;

      setTimeout(() => {
        if (statusChat.textContent === textoStatus) {
          atualizarStatusCabecalho();
        }
      }, 1800);
    } catch (erro) {
      statusChat.textContent =
        erro?.message ||
        (favoritar
          ? "Erro ao favoritar a mensagem."
          : "Erro ao desfavoritar a mensagem.");
    }
  }

  function favoritosVisiveisOrdenados() {
    const filtro = obterFiltro();

    return Object.values(favoritosMensagensPersistidos)
      .filter((favorito) => {
        const conversa = conversas[favorito?.conversaId];

        if (!conversa || ehConversaTecnica(conversa) || conversa.trancada) {
          return false;
        }

        if (filtro) {
          const nome = normalizarTextoBusca(
            conversa.nome ||
              favorito?.conversaNome ||
              favorito?.conversaId ||
              "",
          );
          const texto = normalizarTextoBusca(favorito?.texto || "");
          const arquivo = normalizarTextoBusca(favorito?.fileName || "");

          if (
            !nome.includes(filtro) &&
            !texto.includes(filtro) &&
            !arquivo.includes(filtro)
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const tempoA =
          Number(a?.timestamp || 0) || Number(a?.favoritadoEm || 0) / 1000;
        const tempoB =
          Number(b?.timestamp || 0) || Number(b?.favoritadoEm || 0) / 1000;

        return tempoB - tempoA;
      });
  }

  function abrirFavoritoDaLista(favorito) {
    const conversa = conversas[favorito?.conversaId];

    if (!conversa || conversa.trancada) {
      return;
    }

    abrirConversa(conversa.id);
    cancelarFixacaoFimConversa();

    setTimeout(() => {
      const item = localizarMensagemNaTela(favorito.idMensagem);

      if (!item) {
        statusChat.textContent =
          "A mensagem favorita não está carregada neste histórico.";
        return;
      }

      destacarMensagemRespondida(favorito.idMensagem);
    }, 90);
  }

  function criarItemFavorito(favorito) {
    const conversa = conversas[favorito?.conversaId];

    if (!conversa) {
      return null;
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "favorito-item";

    const topo = document.createElement("div");
    topo.className = "favorito-item-topo";

    const nome = document.createElement("span");
    nome.className = "favorito-item-nome";
    nome.textContent =
      conversa.nome || favorito.conversaNome || favorito.conversaId;

    const estrela = document.createElement("span");
    estrela.className = "favorito-item-estrela";
    estrela.textContent = "★";

    topo.appendChild(nome);
    topo.appendChild(estrela);

    const preview = document.createElement("div");
    preview.className = "favorito-item-preview";
    preview.textContent = descricaoFavoritoMensagem(favorito);

    const meta = document.createElement("div");
    meta.className = "favorito-item-meta";

    const autor = favorito.minha ? "Você" : "Contato";
    const horario = String(favorito.horario || "").trim();

    meta.textContent = horario ? `${autor} • ${horario}` : autor;

    item.appendChild(topo);
    item.appendChild(preview);
    item.appendChild(meta);

    item.addEventListener("click", () => {
      abrirFavoritoDaLista(favorito);
    });

    return item;
  }

  function renderFavoritos() {
    const filtro = obterFiltro();
    const favoritos = favoritosVisiveisOrdenados();

    if (!favoritos.length) {
      const vazio = document.createElement("div");
      vazio.className = "vazio-lista";
      vazio.textContent = filtro
        ? "Nenhum favorito encontrado"
        : "Nenhuma mensagem favorita";

      listaConversas.replaceChildren(vazio);
      return;
    }

    const fragmento = document.createDocumentFragment();

    for (const favorito of favoritos) {
      const item = criarItemFavorito(favorito);

      if (item) {
        fragmento.appendChild(item);
      }
    }

    listaConversas.replaceChildren(fragmento);
  }

  return {
    mensagemEstaFavoritada,
    registrarFavoritoLocalmente,
    removerFavoritoLocalmente,
    atualizarFavoritoEditadoLocalmente,
    limparFavoritosDaConversa,
    totalFavoritosVisiveis,
    dadosMensagemParaFavorito,
    alterarFavoritoMensagem,
    renderFavoritos,
  };
}

module.exports = {
  criarModuloFavoritos,
};
