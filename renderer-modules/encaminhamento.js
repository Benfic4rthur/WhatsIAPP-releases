function criarModuloEncaminhamento(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    statusChat,
    conversas,
    obterConversaAtual,
    carregarContatosSalvosWhatsapp,
    descricaoCurtaMensagemResposta,
    contatoSalvoExistentePorId,
    criarAvatarContato,
    solicitarFotoContatoSalvo,
    formatarNumeroWhatsapp,
    obterOuCriarConversaContatoSalvo,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
    atualizarContadores,
    renderConversas,
    atualizarStatusCabecalho,
  } = dependencias;

  function dadosMensagemParaEncaminhar(msg) {
    if (!msg?.idMensagem) {
      return null;
    }

    return {
      idMensagem: String(msg.idMensagem),
      idMensagemWpp: msg.idMensagemWpp || null,
      minha: !!msg.minha,
      texto: String(msg.texto || ""),
      tipo: String(msg.tipo || "texto"),
      mime: msg.mime || null,
      fileName: msg.fileName || null,
      mediaPath: msg.mediaPath || null,
    };
  }

  async function abrirEncaminhamentoMensagem(msg) {
    const conversaAtual = obterConversaAtual();
    const mensagemOrigem = dadosMensagemParaEncaminhar(msg);

    if (!mensagemOrigem || !conversaAtual || !conversas[conversaAtual]) {
      return;
    }

    if (mensagemOrigem.tipo === "view_once") {
      statusChat.textContent =
        "Mensagens de visualização única não podem ser encaminhadas.";
      return;
    }

    let contatosDisponiveis = [];

    try {
      contatosDisponiveis = await carregarContatosSalvosWhatsapp(true);
    } catch {
      statusChat.textContent = "Não foi possível carregar os contatos salvos.";
      return;
    }

    const contatosPorId = new Map(
      contatosDisponiveis.map((contato) => [String(contato.id), contato]),
    );

    const conversaOrigemId = conversaAtual;
    const selecionadas = new Set();

    const overlay = document.createElement("div");
    overlay.className = "encaminhar-overlay";

    const painel = document.createElement("section");
    painel.className = "encaminhar-painel";
    painel.setAttribute("role", "dialog");
    painel.setAttribute("aria-modal", "true");
    painel.setAttribute("aria-label", "Encaminhar mensagem");

    const topo = document.createElement("div");
    topo.className = "encaminhar-topo";

    const blocoTitulo = document.createElement("div");

    const titulo = document.createElement("div");
    titulo.className = "encaminhar-titulo";
    titulo.textContent = "Encaminhar mensagem";

    const subtitulo = document.createElement("div");
    subtitulo.className = "encaminhar-subtitulo";
    subtitulo.textContent = "Selecione até 5 contatos salvos";

    blocoTitulo.appendChild(titulo);
    blocoTitulo.appendChild(subtitulo);

    const fechar = document.createElement("button");
    fechar.type = "button";
    fechar.className = "encaminhar-fechar";
    fechar.textContent = "×";
    fechar.title = "Fechar";
    fechar.setAttribute("aria-label", "Fechar");

    topo.appendChild(blocoTitulo);
    topo.appendChild(fechar);

    const preview = document.createElement("div");
    preview.className = "encaminhar-preview";

    const previewIcone = document.createElement("div");
    previewIcone.className = "encaminhar-preview-icone";

    const tipo = String(mensagemOrigem.tipo || "").toLowerCase();

    previewIcone.textContent =
      tipo === "imagem"
        ? "📷"
        : tipo === "video"
          ? "🎥"
          : tipo === "audio"
            ? "🎤"
            : tipo === "documento"
              ? "📎"
              : tipo === "sticker"
                ? "🧩"
                : "➤";

    const previewTexto = document.createElement("div");
    previewTexto.className = "encaminhar-preview-texto";
    previewTexto.textContent = descricaoCurtaMensagemResposta(msg);

    preview.appendChild(previewIcone);
    preview.appendChild(previewTexto);

    const buscaEncaminhar = document.createElement("input");
    buscaEncaminhar.type = "text";
    buscaEncaminhar.className = "encaminhar-busca";
    buscaEncaminhar.placeholder = "Buscar contato salvo";
    buscaEncaminhar.autocomplete = "off";

    const lista = document.createElement("div");
    lista.className = "encaminhar-lista";

    const rodape = document.createElement("div");
    rodape.className = "encaminhar-rodape";

    const status = document.createElement("div");
    status.className = "encaminhar-status";

    const botaoEnviar = document.createElement("button");
    botaoEnviar.type = "button";
    botaoEnviar.className = "encaminhar-enviar";
    botaoEnviar.disabled = true;
    botaoEnviar.textContent = "Encaminhar";

    rodape.appendChild(status);
    rodape.appendChild(botaoEnviar);

    painel.appendChild(topo);
    painel.appendChild(preview);
    painel.appendChild(buscaEncaminhar);
    painel.appendChild(lista);
    painel.appendChild(rodape);
    overlay.appendChild(painel);
    document.body.appendChild(overlay);

    function atualizarRodape() {
      const total = selecionadas.size;

      botaoEnviar.disabled = total === 0;
      botaoEnviar.textContent =
        total > 0 ? `Encaminhar (${total})` : "Encaminhar";

      if (!status.classList.contains("erro")) {
        status.textContent =
          total === 0
            ? "Nenhum contato selecionado"
            : `${total} de 5 selecionado${total === 1 ? "" : "s"}`;
      }
    }

    function listaBase() {
      return contatosDisponiveis.slice();
    }

    function renderListaEncaminhar() {
      const termo = String(buscaEncaminhar.value || "")
        .trim()
        .toLowerCase();

      let candidatas = listaBase();

      if (termo) {
        candidatas = candidatas.filter((contato) => {
          const nome = String(contato.nome || "").toLowerCase();
          const numero = String(
            contato.numeroWhatsapp || contato.id || "",
          ).toLowerCase();

          return nome.includes(termo) || numero.includes(termo);
        });
      } else {
        candidatas = candidatas.slice(0, 120);
      }

      const fragmento = document.createDocumentFragment();

      if (!candidatas.length) {
        const vazio = document.createElement("div");
        vazio.className = "encaminhar-vazio";
        vazio.textContent = "Nenhum contato salvo encontrado";
        fragmento.appendChild(vazio);
      }

      for (const contato of candidatas) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "encaminhar-item";
        item.dataset.conversaId = contato.id;

        if (selecionadas.has(contato.id)) {
          item.classList.add("selecionada");
        }

        const conversaVisual = contatoSalvoExistentePorId(contato) || {
          id: contato.id,
          nome: contato.nome,
          numeroWhatsapp: contato.numeroWhatsapp || null,
          fotoPerfilUrl: contato.fotoPerfilUrl || null,
          fotoPerfilTentada: false,
        };

        const avatar = criarAvatarContato(conversaVisual, 40);
        avatar.classList.add("encaminhar-avatar");

        if (!conversaVisual.fotoPerfilUrl) {
          solicitarFotoContatoSalvo(contato, avatar);
        }

        const info = document.createElement("div");
        info.className = "encaminhar-item-info";

        const nome = document.createElement("div");
        nome.className = "encaminhar-item-nome";
        nome.textContent = contato.nome;

        const detalhe = document.createElement("div");
        detalhe.className = "encaminhar-item-detalhe";
        detalhe.textContent = formatarNumeroWhatsapp(
          contato.numeroWhatsapp || contato.id,
        );

        info.appendChild(nome);
        info.appendChild(detalhe);

        const check = document.createElement("span");
        check.className = "encaminhar-check";
        check.textContent = selecionadas.has(contato.id) ? "✓" : "";

        item.appendChild(avatar);
        item.appendChild(info);
        item.appendChild(check);

        item.addEventListener("click", () => {
          status.classList.remove("erro");

          if (selecionadas.has(contato.id)) {
            selecionadas.delete(contato.id);
          } else {
            if (selecionadas.size >= 5) {
              status.textContent = "Você pode selecionar no máximo 5 contatos.";
              status.classList.add("erro");
              return;
            }

            selecionadas.add(contato.id);
          }

          renderListaEncaminhar();
          atualizarRodape();
        });

        fragmento.appendChild(item);
      }

      lista.replaceChildren(fragmento);
    }

    let fechando = false;

    function fecharModal() {
      if (fechando) {
        return;
      }

      fechando = true;
      overlay.classList.add("saindo");

      setTimeout(() => {
        overlay.remove();
      }, 180);
    }

    async function confirmarEncaminhamento() {
      if (!selecionadas.size || botaoEnviar.disabled) {
        return;
      }

      const destinos = Array.from(selecionadas);

      botaoEnviar.disabled = true;
      fechar.disabled = true;
      buscaEncaminhar.disabled = true;
      lista.classList.add("bloqueada");
      status.classList.remove("erro");

      let enviados = 0;
      const falhas = [];

      for (let indice = 0; indice < destinos.length; indice += 1) {
        const destinoId = destinos[indice];
        const contatoDestino = contatosPorId.get(String(destinoId));
        const conversaDestino = contatoDestino
          ? obterOuCriarConversaContatoSalvo(contatoDestino)
          : null;

        if (!conversaDestino) {
          falhas.push(contatoDestino?.nome || destinoId);
          continue;
        }

        status.textContent = `Encaminhando ${indice + 1} de ${destinos.length}...`;

        const desarquivadaLocalmente =
          desarquivarLocalmenteAoEnviar(conversaDestino);

        try {
          const resultado = await ipcRenderer.invoke("enviar-mensagem-texto", {
            encaminhar: {
              conversaOrigemId,
              conversaDestinoId: conversaDestino.id,
              mensagem: mensagemOrigem,
            },
          });

          if (!resultado?.ok) {
            restaurarArquivamentoLocalSeFalhar(
              conversaDestino,
              desarquivadaLocalmente,
            );

            falhas.push(conversaDestino.nome || destinoId);
            continue;
          }

          enviados += 1;
        } catch {
          restaurarArquivamentoLocalSeFalhar(
            conversaDestino,
            desarquivadaLocalmente,
          );

          falhas.push(conversaDestino.nome || destinoId);
        }
      }

      atualizarContadores();
      renderConversas();

      if (!falhas.length) {
        fecharModal();

        statusChat.textContent =
          enviados === 1
            ? "Mensagem encaminhada."
            : `Mensagem encaminhada para ${enviados} conversas.`;

        setTimeout(() => {
          if (
            statusChat.textContent === "Mensagem encaminhada." ||
            statusChat.textContent ===
              `Mensagem encaminhada para ${enviados} conversas.`
          ) {
            atualizarStatusCabecalho();
          }
        }, 2200);

        return;
      }

      status.textContent =
        `Enviado para ${enviados} de ${destinos.length}. ` +
        `Falhou: ${falhas.join(", ")}.`;
      status.classList.add("erro");

      fechar.disabled = false;
      buscaEncaminhar.disabled = false;
      lista.classList.remove("bloqueada");
      botaoEnviar.disabled = selecionadas.size === 0;
    }

    fechar.addEventListener("click", fecharModal);

    overlay.addEventListener("click", (evento) => {
      if (evento.target === overlay) {
        fecharModal();
      }
    });

    overlay.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape") {
        fecharModal();
      }
    });

    buscaEncaminhar.addEventListener("input", renderListaEncaminhar);
    botaoEnviar.addEventListener("click", confirmarEncaminhamento);

    overlay.tabIndex = -1;

    renderListaEncaminhar();
    atualizarRodape();

    requestAnimationFrame(() => {
      overlay.classList.add("aberto");
    });

    setTimeout(() => {
      buscaEncaminhar.focus();
    }, 30);
  }

  return {
    abrirEncaminhamentoMensagem,
  };
}

module.exports = {
  criarModuloEncaminhamento,
};
