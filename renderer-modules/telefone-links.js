function criarTelefoneLinks(dependencias = {}) {
  const {
    ipcRenderer,
    clipboard,
    document,
    window,
    console,
    conversas,
    conversasProvisoriasNovaMensagem,
    statusChat,
    normalizarNumeroNovaConversa,
    variantesNumeroBrasilWhatsapp,
    conversaExistentePorNumero,
    formatarNumeroWhatsapp,
    ehConversaTecnica,
    fecharPainelNovaConversa,
    bloquearTrancadas,
    ativarAba,
    abrirConversa,
  } = dependencias;

  let menuTelefoneMensagemAtual = null;

  function fecharMenuTelefoneMensagem() {
    if (menuTelefoneMensagemAtual?.isConnected) {
      menuTelefoneMensagemAtual.remove();
    }

    menuTelefoneMensagemAtual = null;
  }

  function numeroWhatsappDeTexto(valor) {
    const bruto = String(valor || "").trim();
    const digitos = bruto.replace(/\D/g, "");

    if (digitos.length < 10 || digitos.length > 15) {
      return null;
    }

    return normalizarNumeroNovaConversa(bruto);
  }

  function normalizarAliasConversaWhatsapp(valor) {
    let id = String(valor || "")
      .trim()
      .toLowerCase();

    if (!id) return null;

    id = id.replace(/:\d+(?=@)/, "");

    if (id.endsWith("@c.us")) {
      id = id.replace(/@c\.us$/i, "@s.whatsapp.net");
    }

    return id;
  }

  function aliasPodeRepresentarTelefoneWhatsapp(valor) {
    const texto = String(valor || "")
      .trim()
      .toLowerCase();

    if (!texto) return false;

    if (texto.includes("@")) {
      return texto.endsWith("@c.us") || texto.endsWith("@s.whatsapp.net");
    }

    return /^[+\d\s().-]+$/.test(texto);
  }

  function conversaExistentePorAliasesWhatsapp(aliases = []) {
    const idsTelefone = new Set();
    const idsInternos = new Set();
    const numeros = new Set();

    for (const alias of aliases) {
      const id = normalizarAliasConversaWhatsapp(alias);
      if (!id) continue;

      if (aliasPodeRepresentarTelefoneWhatsapp(alias)) {
        idsTelefone.add(id);

        for (const numero of variantesNumeroBrasilWhatsapp(alias)) {
          numeros.add(numero);
        }
      } else {
        idsInternos.add(id);
      }
    }

    if (!idsTelefone.size && !idsInternos.size && !numeros.size) return null;

    // Para um clique em numero, telefone real tem prioridade sobre LID.
    for (const [chave, conversa] of Object.entries(conversas)) {
      if (!conversa || ehConversaTecnica(conversa)) continue;

      const idsTelefoneConversa = [chave, conversa.id]
        .filter(aliasPodeRepresentarTelefoneWhatsapp)
        .map(normalizarAliasConversaWhatsapp)
        .filter(Boolean);

      if (idsTelefoneConversa.some((id) => idsTelefone.has(id))) {
        return { chave, conversa };
      }

      const candidatosNumero = [];

      for (const valor of [chave, conversa.id, conversa.numeroWhatsapp]) {
        if (
          valor &&
          (valor === conversa.numeroWhatsapp ||
            aliasPodeRepresentarTelefoneWhatsapp(valor))
        ) {
          candidatosNumero.push(...variantesNumeroBrasilWhatsapp(valor));
        }
      }

      if (candidatosNumero.some((numero) => numeros.has(numero))) {
        return { chave, conversa };
      }
    }

    // LID/aliases internos ficam apenas como fallback depois do telefone.
    for (const [chave, conversa] of Object.entries(conversas)) {
      if (!conversa || ehConversaTecnica(conversa)) continue;

      const idsInternosConversa = [chave, conversa.id]
        .filter(
          (valor) => valor && !aliasPodeRepresentarTelefoneWhatsapp(valor),
        )
        .map(normalizarAliasConversaWhatsapp)
        .filter(Boolean);

      if (idsInternosConversa.some((id) => idsInternos.has(id))) {
        return { chave, conversa };
      }
    }

    return null;
  }

  function abrirConversaPorNumeroWhatsapp(numero, resolucao = null) {
    const digitos =
      numeroWhatsappDeTexto(numero) || String(numero || "").replace(/\D/g, "");

    if (!digitos) return;

    const variantesAlvo = new Set(variantesNumeroBrasilWhatsapp(digitos));

    if (!variantesAlvo.size) {
      return;
    }

    // Primeiro tenta o numero realmente clicado. Assim uma lista de aliases
    // devolvida pelo WhatsApp nunca consegue desviar o clique para outro chat.
    let conversa = conversaExistentePorNumero(digitos);
    let chaveConversa = conversa
      ? Object.keys(conversas).find((chave) => conversas[chave] === conversa) ||
        null
      : null;

    const variantesResolvidas = variantesNumeroBrasilWhatsapp(
      resolucao?.numeroResolvido,
    );
    const resolucaoDoMesmoNumero =
      !variantesResolvidas.length ||
      variantesResolvidas.some((item) => variantesAlvo.has(item));

    const aliasesResolucao = resolucaoDoMesmoNumero
      ? [
          resolucao?.id,
          resolucao?.idCanonico,
          ...(Array.isArray(resolucao?.aliases) ? resolucao.aliases : []),
        ].filter((alias) => {
          if (!alias) return false;

          if (!aliasPodeRepresentarTelefoneWhatsapp(alias)) {
            return true;
          }

          return variantesNumeroBrasilWhatsapp(alias).some((item) =>
            variantesAlvo.has(item),
          );
        })
      : [];

    const aliases = [
      ...Array.from(variantesAlvo).flatMap((numeroVariante) => [
        `${numeroVariante}@c.us`,
        `${numeroVariante}@s.whatsapp.net`,
      ]),
      ...aliasesResolucao,
    ];

    if (!conversa) {
      const encontrada = conversaExistentePorAliasesWhatsapp(aliases);
      conversa = encontrada?.conversa || null;
      chaveConversa = encontrada?.chave || null;
    }

    if (conversa) {
      const nomeAtual = String(conversa.nome || "").trim();
      const nomeResolvido = String(resolucao?.nomeContato || "").trim();
      const nomeAtualEhNumero = /^\+?[\d\s().-]+$/.test(nomeAtual);

      if (nomeResolvido && (!nomeAtual || nomeAtualEhNumero)) {
        conversa.nome = nomeResolvido;
      }
    }

    if (!conversa) {
      const numeroPreferido =
        variantesResolvidas.find((item) => variantesAlvo.has(item)) || digitos;
      const idPreferido = `${numeroPreferido}@s.whatsapp.net`;

      conversa = {
        id: idPreferido,
        nome:
          String(resolucao?.nomeContato || "").trim() ||
          (resolucao?.ehMeuNumero
            ? "Você"
            : formatarNumeroWhatsapp(numeroPreferido)),
        grupo: false,
        arquivada: false,
        trancadaWhatsapp: false,
        trancada: false,
        timestamp: Math.floor(Date.now() / 1000),
        mensagens: [],
        fotoPerfilUrl: null,
        fotoPerfilTentada: false,
        fotoPerfilFalhas: 0,
        numeroWhatsapp: numeroPreferido,
        naoLidasLocal: 0,
        presenca: null,
        provisoriaNovaConversa: true,
      };

      chaveConversa = idPreferido;
      conversas[idPreferido] = conversa;
      conversasProvisoriasNovaMensagem.set(idPreferido, conversa);
    }

    if (!chaveConversa && conversa) {
      chaveConversa =
        Object.keys(conversas).find((chave) => conversas[chave] === conversa) ||
        conversa.id;
    }

    console.log(
      `[PHONE LINK] OPEN | input=${digitos} | self=${resolucao?.ehMeuNumero ? "true" : "false"} | key=${chaveConversa || "-"}`,
    );

    fecharMenuTelefoneMensagem();
    fecharPainelNovaConversa();
    bloquearTrancadas();
    ativarAba("conversas");
    abrirConversa(chaveConversa);

    if (conversa.provisoriaNovaConversa) {
      statusChat.textContent = resolucao?.ehMeuNumero
        ? "Conversa com você mesmo."
        : "Nova conversa. Envie uma mensagem para iniciar.";
    }
  }

  async function abrirMenuTelefoneMensagem(evento, textoNumero) {
    const numero = numeroWhatsappDeTexto(textoNumero);

    if (!numero) return;

    fecharMenuTelefoneMensagem();

    let resultado = null;

    try {
      resultado = await ipcRenderer.invoke("verificar-numero-whatsapp", {
        numero,
      });
    } catch {}

    const menu = document.createElement("div");
    menu.className = "menu-telefone-mensagem";

    const adicionarOpcao = (rotulo, icone, acao) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "menu-telefone-mensagem-opcao";
      botao.innerHTML = `<span class="menu-telefone-mensagem-icone">${icone}</span><span>${rotulo}</span>`;
      botao.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        acao();
      });
      menu.appendChild(botao);
    };

    if (resultado?.ok && resultado?.existe) {
      const numeroMenu =
        String(resultado?.numeroResolvido || "").replace(/\D/g, "") || numero;

      adicionarOpcao(
        `Conversar com ${formatarNumeroWhatsapp(numeroMenu)}`,
        "▣",
        () => abrirConversaPorNumeroWhatsapp(numero, resultado),
      );
    }

    adicionarOpcao("Copiar número de telefone", "▤", () => {
      clipboard.writeText(formatarNumeroWhatsapp(numero));
      fecharMenuTelefoneMensagem();
    });

    document.body.appendChild(menu);
    menuTelefoneMensagemAtual = menu;

    const largura = menu.offsetWidth || 300;
    const altura = menu.offsetHeight || 90;
    const margem = 10;
    const x = Math.min(
      window.innerWidth - largura - margem,
      Math.max(margem, Number(evento?.clientX || 0)),
    );
    const y = Math.min(
      window.innerHeight - altura - margem,
      Math.max(margem, Number(evento?.clientY || 0)),
    );

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }

  function criarLinkTelefoneMensagem(textoNumero) {
    const numero = numeroWhatsappDeTexto(textoNumero);

    if (!numero) {
      return document.createTextNode(textoNumero);
    }

    const link = document.createElement("button");
    link.type = "button";
    link.className = "telefone-link-mensagem";
    link.textContent = textoNumero;
    link.title = "Opções do número de telefone";

    link.addEventListener("click", (evento) => {
      evento.preventDefault();
      evento.stopPropagation();
      abrirMenuTelefoneMensagem(evento, textoNumero);
    });

    return link;
  }

  function proximaOcorrenciaLinkOuTelefone(texto, inicio = 0) {
    const resto = texto.slice(inicio);
    const regexUrl = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;
    const regexTelefone =
      /(?:\+\s?\d[\d\s().-]{8,}\d|\b\d(?:[\d\s().-]*\d){9,14}\b)/;

    const url = regexUrl.exec(resto);
    const telefone = regexTelefone.exec(resto);
    const candidatos = [];

    if (url) candidatos.push({ tipo: "url", match: url });
    if (telefone) candidatos.push({ tipo: "telefone", match: telefone });

    if (!candidatos.length) return null;

    candidatos.sort((a, b) => a.match.index - b.match.index);
    const escolhido = candidatos[0];

    return {
      tipo: escolhido.tipo,
      indice: inicio + escolhido.match.index,
      texto: escolhido.match[0],
    };
  }

  document.addEventListener("pointerdown", (evento) => {
    if (
      menuTelefoneMensagemAtual &&
      !menuTelefoneMensagemAtual.contains(evento.target)
    ) {
      fecharMenuTelefoneMensagem();
    }
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && menuTelefoneMensagemAtual) {
      fecharMenuTelefoneMensagem();
    }
  });

  return {
    fecharMenuTelefoneMensagem,
    numeroWhatsappDeTexto,
    criarLinkTelefoneMensagem,
    proximaOcorrenciaLinkOuTelefone,
    abrirConversaPorNumeroWhatsapp,
  };
}

module.exports = {
  criarTelefoneLinks,
};
