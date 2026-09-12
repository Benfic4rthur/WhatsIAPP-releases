function criarModuloNovaConversa(dependencias = {}) {
  const {
    ipcRenderer,
    document,
    requestAnimationFrame,
    conversas,
    conversasProvisoriasNovaMensagem,
    statusChat,
    naoLidasPersistidas,
    normalizarTextoBusca,
    criarAvatarContato,
    formatarNumeroWhatsapp,
    ehConversaTecnica,
    trancamentoEfetivo,
    bloquearTrancadas,
    ativarAba,
    abrirConversa,
  } = dependencias;

  let contatosSalvosWhatsapp = [];
  let carregamentoContatosSalvosWhatsapp = null;
  const idsGruposAtuaisWhatsapp = new Set();
  let gruposAtuaisWhatsappCarregados = false;

  const btnNovaConversa = document?.getElementById?.("btnNovaConversa") || null;
  const painelNovaConversa =
    document?.getElementById?.("painelNovaConversa") || null;
  const btnVoltarNovaConversa =
    document?.getElementById?.("btnVoltarNovaConversa") || null;
  const buscaNovaConversa =
    document?.getElementById?.("buscaNovaConversa") || null;
  const listaNovaConversa =
    document?.getElementById?.("listaNovaConversa") || null;

  async function carregarContatosSalvosWhatsapp(forcar = false) {
    if (carregamentoContatosSalvosWhatsapp) {
      return carregamentoContatosSalvosWhatsapp;
    }

    if (!forcar && contatosSalvosWhatsapp.length) {
      return contatosSalvosWhatsapp;
    }

    carregamentoContatosSalvosWhatsapp = ipcRenderer
      .invoke("listar-contatos-salvos-whatsapp")
      .then((resultado) => {
        if (!resultado?.ok || !Array.isArray(resultado?.contatos)) {
          throw new Error(
            resultado?.erro || "Não foi possível carregar os contatos salvos.",
          );
        }

        const fotosAnteriores = new Map(
          contatosSalvosWhatsapp.map((item) => [
            String(item?.numeroWhatsapp || item?.id || ""),
            item?.fotoPerfilUrl || null,
          ]),
        );

        contatosSalvosWhatsapp = resultado.contatos
          .filter((contato) => contato?.id && contato?.nome)
          .map((contato) => {
            const id = String(contato.id);
            const numeroWhatsapp = contato.numeroWhatsapp || null;
            const chaveFoto = String(numeroWhatsapp || id);

            return {
              id,
              nome: String(contato.nome),
              numeroWhatsapp,
              fotoPerfilUrl: fotosAnteriores.get(chaveFoto) || null,
            };
          })
          .sort((a, b) =>
            String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", {
              sensitivity: "base",
            }),
          );

        return contatosSalvosWhatsapp;
      })
      .finally(() => {
        carregamentoContatosSalvosWhatsapp = null;
      });

    return carregamentoContatosSalvosWhatsapp;
  }

  function ehConversaGrupo(conversa) {
    if (!conversa?.id) {
      return false;
    }

    return (
      !!conversa.grupo ||
      String(conversa.id || "")
        .toLowerCase()
        .endsWith("@g.us")
    );
  }

  async function carregarGruposAtuaisWhatsapp() {
    const resultado = await ipcRenderer.invoke("listar-grupos-whatsapp");

    if (!resultado?.ok || !Array.isArray(resultado?.grupos)) {
      return false;
    }

    idsGruposAtuaisWhatsapp.clear();

    for (const grupo of resultado.grupos) {
      const id = String(grupo?.id || "").trim();

      if (!id) {
        continue;
      }

      idsGruposAtuaisWhatsapp.add(id);

      const atual = conversas[id];
      const trancadaWhatsapp = !!grupo.trancada;

      if (atual) {
        atual.grupo = true;
        atual.nome = grupo.nome || atual.nome || id;
        atual.arquivada = !!grupo.arquivada;
        atual.trancadaWhatsapp = trancadaWhatsapp;
        atual.trancada = trancamentoEfetivo(id, trancadaWhatsapp);

        if (Array.isArray(grupo.mensagens) && !atual.mensagens?.length) {
          atual.mensagens = grupo.mensagens.slice();
        }

        atual.timestamp = Math.max(
          Number(atual.timestamp || 0) || 0,
          Number(grupo.timestamp || 0) || 0,
        );

        continue;
      }

      conversas[id] = {
        id,
        nome: grupo.nome || id,
        grupo: true,
        arquivada: !!grupo.arquivada,
        trancadaWhatsapp,
        trancada: trancamentoEfetivo(id, trancadaWhatsapp),
        timestamp: Number(grupo.timestamp || 0) || 0,
        mensagens: Array.isArray(grupo.mensagens)
          ? grupo.mensagens.slice()
          : [],
        fotoPerfilUrl: null,
        fotoPerfilTentada: false,
        fotoPerfilFalhas: 0,
        numeroWhatsapp: null,
        naoLidasLocal: Number(naoLidasPersistidas[id] || 0) || 0,
        presenca: null,
      };
    }

    gruposAtuaisWhatsappCarregados = true;
    return true;
  }

  function contatoSalvoExistentePorId(contato) {
    if (!contato?.id) {
      return null;
    }

    if (conversas[contato.id]) {
      return conversas[contato.id];
    }

    if (contato.numeroWhatsapp) {
      return conversaExistentePorNumero(contato.numeroWhatsapp);
    }

    return null;
  }

  function obterOuCriarConversaContatoSalvo(contato) {
    const existente = contatoSalvoExistentePorId(contato);

    if (existente) {
      if (contato?.nome) {
        existente.nome = contato.nome;
      }

      return existente;
    }

    const id = String(contato?.id || "").trim();

    if (!id) {
      return null;
    }

    const conversa = {
      id,
      nome:
        contato.nome || formatarNumeroWhatsapp(contato.numeroWhatsapp || id),
      grupo: false,
      arquivada: false,
      trancadaWhatsapp: false,
      trancada: false,
      timestamp: Math.floor(Date.now() / 1000),
      mensagens: [],
      fotoPerfilUrl: null,
      fotoPerfilTentada: false,
      fotoPerfilFalhas: 0,
      numeroWhatsapp: contato.numeroWhatsapp || null,
      naoLidasLocal: 0,
      presenca: null,
      provisoriaNovaConversa: true,
    };

    conversas[id] = conversa;
    conversasProvisoriasNovaMensagem.set(id, conversa);

    return conversa;
  }

  function digitosNumeroConversa(valor) {
    return String(valor || "")
      .replace(/@s\.whatsapp\.net$/i, "")
      .replace(/@c\.us$/i, "")
      .replace(/@lid$/i, "")
      .replace(/\D/g, "");
  }

  function normalizarNumeroNovaConversa(valor) {
    const bruto = String(valor || "").trim();
    let digitos = bruto.replace(/\D/g, "");

    if (!digitos) {
      return null;
    }

    if (
      !bruto.startsWith("+") &&
      (digitos.length === 10 || digitos.length === 11)
    ) {
      digitos = `55${digitos}`;
    }

    if (digitos.length < 10 || digitos.length > 15) {
      return null;
    }

    return digitos;
  }

  function variantesNumeroBrasilWhatsapp(valor) {
    const bruto = String(valor || "").trim();

    if (/@(?:lid|g\.us|broadcast|newsletter)$/i.test(bruto)) {
      return [];
    }

    const normalizado =
      normalizarNumeroNovaConversa(bruto) || digitosNumeroConversa(bruto);
    const saida = new Set();

    if (!normalizado) return [];

    saida.add(normalizado);

    if (!normalizado.startsWith("55")) {
      return Array.from(saida);
    }

    const nacional = normalizado.slice(2);

    if (nacional.length === 11 && nacional[2] === "9") {
      saida.add(`55${nacional.slice(0, 2)}${nacional.slice(3)}`);
    } else if (nacional.length === 10) {
      saida.add(`55${nacional.slice(0, 2)}9${nacional.slice(2)}`);
    }

    return Array.from(saida);
  }

  function conversaExistentePorNumero(numero) {
    const alvos = new Set(variantesNumeroBrasilWhatsapp(numero));

    if (!alvos.size) {
      return null;
    }

    return (
      Object.values(conversas).find((conversa) => {
        if (!conversa || ehConversaTecnica(conversa)) {
          return false;
        }

        const candidatos = [conversa.id, conversa.numeroWhatsapp]
          .flatMap((valor) => variantesNumeroBrasilWhatsapp(valor))
          .filter(Boolean);

        return candidatos.some((candidato) => alvos.has(candidato));
      }) || null
    );
  }

  function fecharPainelNovaConversa() {
    if (!painelNovaConversa) {
      return;
    }

    painelNovaConversa.hidden = true;

    if (buscaNovaConversa) {
      buscaNovaConversa.value = "";
    }
  }

  const cacheFotosContatosSalvos = new Map();
  const filaFotosContatosSalvos = [];
  const fotosContatosSalvosNaFila = new Set();
  let fotosContatosSalvosAtivas = 0;
  const MAX_FOTOS_CONTATOS_SALVOS_SIMULTANEAS = 4;

  function chaveFotoContatoSalvo(contato) {
    return String(contato?.numeroWhatsapp || contato?.id || "")
      .trim()
      .toLowerCase();
  }

  function jidFotoContatoSalvo(contato) {
    const numero = String(contato?.numeroWhatsapp || "").replace(/\D/g, "");

    if (numero) {
      return `${numero}@s.whatsapp.net`;
    }

    const id = String(contato?.id || "").trim();

    if (id.endsWith("@c.us")) {
      return id.replace(/@c\.us$/i, "@s.whatsapp.net");
    }

    return id || null;
  }

  function aplicarFotoContatoSalvoNoAvatar(avatar, url, nome = "Contato") {
    if (!avatar || !url) {
      return;
    }

    const fallback =
      avatar.dataset.fallbackContato ||
      String(avatar.textContent || "?").trim() ||
      String(nome || "?")
        .trim()
        .charAt(0)
        .toUpperCase() ||
      "?";

    avatar.dataset.fallbackContato = fallback;
    avatar.textContent = "";

    const img = document.createElement("img");
    img.src = url;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = nome || "Foto do contato";

    Object.assign(img.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      borderRadius: "50%",
    });

    img.addEventListener(
      "error",
      () => {
        img.remove();
        avatar.textContent = fallback;
      },
      { once: true },
    );

    avatar.appendChild(img);
  }

  function processarFilaFotosContatosSalvos() {
    while (
      fotosContatosSalvosAtivas < MAX_FOTOS_CONTATOS_SALVOS_SIMULTANEAS &&
      filaFotosContatosSalvos.length
    ) {
      const item = filaFotosContatosSalvos.shift();
      const chave = item?.chave;

      if (!item?.contato || !chave) {
        continue;
      }

      fotosContatosSalvosNaFila.delete(chave);

      const registro = cacheFotosContatosSalvos.get(chave) || {
        url: null,
        carregando: false,
        tentativas: 0,
        avatares: new Set(),
      };

      if (registro.url || registro.carregando) {
        continue;
      }

      registro.carregando = true;
      registro.tentativas += 1;
      cacheFotosContatosSalvos.set(chave, registro);
      fotosContatosSalvosAtivas += 1;

      ipcRenderer
        .invoke("carregar-foto-perfil", {
          conversaId: jidFotoContatoSalvo(item.contato),
        })
        .then((resultado) => {
          if (resultado?.ok && resultado?.url) {
            registro.url = resultado.url;
            item.contato.fotoPerfilUrl = resultado.url;

            for (const avatar of Array.from(registro.avatares)) {
              if (avatar?.isConnected) {
                aplicarFotoContatoSalvoNoAvatar(
                  avatar,
                  resultado.url,
                  item.contato.nome,
                );
              } else {
                registro.avatares.delete(avatar);
              }
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          registro.carregando = false;
          fotosContatosSalvosAtivas = Math.max(
            0,
            fotosContatosSalvosAtivas - 1,
          );
          processarFilaFotosContatosSalvos();
        });
    }
  }

  function solicitarFotoContatoSalvo(contato, avatar) {
    if (!contato || !avatar) {
      return;
    }

    if (contato.fotoPerfilUrl) {
      aplicarFotoContatoSalvoNoAvatar(
        avatar,
        contato.fotoPerfilUrl,
        contato.nome,
      );
      return;
    }

    const chave = chaveFotoContatoSalvo(contato);
    const jid = jidFotoContatoSalvo(contato);

    if (!chave || !jid) {
      return;
    }

    let registro = cacheFotosContatosSalvos.get(chave);

    if (!registro) {
      registro = {
        url: null,
        carregando: false,
        tentativas: 0,
        avatares: new Set(),
      };
      cacheFotosContatosSalvos.set(chave, registro);
    }

    registro.avatares.add(avatar);

    if (registro.url) {
      contato.fotoPerfilUrl = registro.url;
      aplicarFotoContatoSalvoNoAvatar(avatar, registro.url, contato.nome);
      return;
    }

    if (
      registro.carregando ||
      fotosContatosSalvosNaFila.has(chave) ||
      registro.tentativas >= 2
    ) {
      return;
    }

    fotosContatosSalvosNaFila.add(chave);
    filaFotosContatosSalvos.push({ contato, chave });
    processarFilaFotosContatosSalvos();
  }

  async function abrirPainelNovaConversa() {
    if (!painelNovaConversa || !buscaNovaConversa || !listaNovaConversa) {
      return;
    }

    painelNovaConversa.hidden = false;
    buscaNovaConversa.value = "";
    listaNovaConversa.innerHTML =
      '<div class="nova-conversa-vazio">Carregando contatos salvos...</div>';

    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 0);

    raf(() => {
      buscaNovaConversa.focus();
    });

    try {
      await carregarContatosSalvosWhatsapp(true);
      renderizarListaNovaConversa();
    } catch {
      listaNovaConversa.innerHTML =
        '<div class="nova-conversa-vazio">Não foi possível carregar os contatos salvos.</div>';
    }
  }

  function criarItemNovaConversaContatoSalvo(contato) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "nova-conversa-item";

    const conversaVisual = contatoSalvoExistentePorId(contato) || {
      id: contato.id,
      nome: contato.nome,
      numeroWhatsapp: contato.numeroWhatsapp || null,
      fotoPerfilUrl: contato.fotoPerfilUrl || null,
      fotoPerfilTentada: false,
    };

    const avatar = criarAvatarContato(conversaVisual, 46);

    if (!conversaVisual.fotoPerfilUrl) {
      solicitarFotoContatoSalvo(contato, avatar);
    }

    const info = document.createElement("div");
    info.className = "nova-conversa-item-info";

    const nome = document.createElement("div");
    nome.className = "nova-conversa-item-nome";
    nome.textContent = contato.nome;

    const numero = document.createElement("div");
    numero.className = "nova-conversa-item-numero";
    numero.textContent = formatarNumeroWhatsapp(
      contato.numeroWhatsapp || contato.id,
    );

    info.appendChild(nome);
    info.appendChild(numero);

    item.appendChild(avatar);
    item.appendChild(info);

    item.addEventListener("click", () => {
      const conversa = obterOuCriarConversaContatoSalvo(contato);

      if (!conversa) {
        return;
      }

      fecharPainelNovaConversa();
      bloquearTrancadas();
      ativarAba("conversas");
      abrirConversa(conversa.id);

      if (conversa.provisoriaNovaConversa) {
        statusChat.textContent =
          "Nova conversa. Envie uma mensagem para iniciar.";
      }
    });

    return item;
  }

  function renderizarListaNovaConversa() {
    if (!listaNovaConversa || !buscaNovaConversa) {
      return;
    }

    const termoBruto = buscaNovaConversa.value.trim();
    const termo = normalizarTextoBusca(termoBruto);
    const termoNumero = termoBruto.replace(/\D/g, "");
    const fragmento = document.createDocumentFragment();

    const lista = contatosSalvosWhatsapp
      .filter((contato) => {
        if (!contato?.id || !contato?.nome) {
          return false;
        }

        if (!termo) {
          return true;
        }

        const nome = normalizarTextoBusca(contato.nome);
        const numero = digitosNumeroConversa(
          contato.numeroWhatsapp || contato.id,
        );

        return (
          nome.includes(termo) ||
          (!!termoNumero && numero.includes(termoNumero))
        );
      })
      .slice(0, 300);

    for (const contato of lista) {
      fragmento.appendChild(criarItemNovaConversaContatoSalvo(contato));
    }

    if (!lista.length) {
      const vazio = document.createElement("div");
      vazio.className = "nova-conversa-vazio";
      vazio.textContent = termoBruto
        ? "Nenhum contato salvo encontrado."
        : "Nenhum contato salvo foi sincronizado com o WhatsApp.";
      fragmento.appendChild(vazio);
    }

    listaNovaConversa.replaceChildren(fragmento);
  }

  btnNovaConversa?.addEventListener("click", abrirPainelNovaConversa);
  btnVoltarNovaConversa?.addEventListener("click", fecharPainelNovaConversa);
  buscaNovaConversa?.addEventListener("input", renderizarListaNovaConversa);

  buscaNovaConversa?.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      fecharPainelNovaConversa();
    }
  });

  return {
    idsGruposAtuaisWhatsapp,
    obterContatosSalvosWhatsapp: () => contatosSalvosWhatsapp,
    obterGruposAtuaisWhatsappCarregados: () => gruposAtuaisWhatsappCarregados,
    carregarContatosSalvosWhatsapp,
    carregarGruposAtuaisWhatsapp,
    ehConversaGrupo,
    contatoSalvoExistentePorId,
    obterOuCriarConversaContatoSalvo,
    digitosNumeroConversa,
    normalizarNumeroNovaConversa,
    variantesNumeroBrasilWhatsapp,
    conversaExistentePorNumero,
    fecharPainelNovaConversa,
    solicitarFotoContatoSalvo,
    abrirPainelNovaConversa,
    renderizarListaNovaConversa,
  };
}

module.exports = {
  criarModuloNovaConversa,
};
