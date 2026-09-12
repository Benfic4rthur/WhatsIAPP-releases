function criarModuloAutoresGrupo({
  ipcRenderer,
  console,
  moduloNovaConversa,
  ehConversaGrupo,
  digitosNumeroConversa,
  variantesNumeroBrasilWhatsapp,
  formatarNumeroWhatsapp,
  obterConversaAtual,
  renderMensagens,
}) {
  const nomesParticipantesGrupoCache = new Map();
  const carregamentosParticipantesGrupo = new Set();

  function garantirEstiloAutorGrupo() {
    try {
      if (
        typeof document === "undefined" ||
        document.getElementById("whatsiapp-estilo-autores-grupo")
      ) {
        return;
      }

      const estilo = document.createElement("style");
      estilo.id = "whatsiapp-estilo-autores-grupo";
      estilo.textContent = `
        .mensagem-autor-grupo {
          margin: 0 0 3px 0;
          font-size: 12px;
          line-height: 1.2;
          font-weight: 700;
          color: #22c8b5;
          user-select: text;
        }

        .mensagem.minha .mensagem-autor-grupo {
          display: none;
        }
      `;

      document.head.appendChild(estilo);
    } catch {}
  }

  garantirEstiloAutorGrupo();

  function chavesNomeParticipanteGrupo(valor) {
    const chaves = new Set();
    const bruto = String(valor || "")
      .trim()
      .toLowerCase();

    if (bruto) {
      chaves.add(bruto.replace(/:\d+(?=@)/, ""));
    }

    const digitos =
      digitosNumeroConversa?.(valor) || String(valor || "").replace(/\D/g, "");

    if (digitos) {
      chaves.add(`n:${digitos}`);

      for (const variante of variantesNumeroBrasilWhatsapp?.(digitos) || []) {
        const numeroVariante =
          digitosNumeroConversa?.(variante) ||
          String(variante || "").replace(/\D/g, "");

        if (numeroVariante) {
          chaves.add(`n:${numeroVariante}`);
        }
      }
    }

    return chaves;
  }

  function candidatosAutorMensagemGrupo(msg) {
    const candidatos = [
      msg?.participantPn,
      msg?.participant,
      msg?.participantAlt,
      msg?.author,
      msg?.sender,
    ];

    if (Array.isArray(msg?.participantAliases)) {
      candidatos.push(...msg.participantAliases);
    }

    return Array.from(
      new Set(
        candidatos.map((valor) => String(valor || "").trim()).filter(Boolean),
      ),
    );
  }

  function registrarParticipanteGrupo(mapa, participante) {
    if (!mapa || !participante) return;

    const aliases = [
      participante?.id,
      participante?.numeroWhatsapp,
      participante?.participant,
      ...(Array.isArray(participante?.aliases) ? participante.aliases : []),
    ].filter(Boolean);

    const registro = {
      id: participante?.id || null,
      numeroWhatsapp: participante?.numeroWhatsapp || null,
      nomeSalvo: String(participante?.nomeSalvo || "").trim() || null,
      aliases,
      ehVoce: !!participante?.ehVoce,
    };

    for (const candidato of aliases) {
      for (const chave of chavesNomeParticipanteGrupo(candidato)) {
        mapa.set(chave, registro);
      }
    }
  }

  function aplicarAutoriaNasMensagens(conversa, autoresMensagens) {
    const mensagensPorId = new Map(
      (Array.isArray(conversa?.mensagens) ? conversa.mensagens : [])
        .map((msg) => [String(msg?.idMensagem || "").trim(), msg])
        .filter(([id]) => !!id),
    );

    let autoresAplicados = 0;

    for (const autoria of Array.isArray(autoresMensagens)
      ? autoresMensagens
      : []) {
      const idMensagem = String(autoria?.idMensagem || "").trim();
      const msg = idMensagem ? mensagensPorId.get(idMensagem) : null;

      if (!msg || msg.minha) {
        continue;
      }

      if (autoria?.participant) {
        msg.participant = String(autoria.participant);
      }

      if (autoria?.participantAlt) {
        msg.participantAlt = String(autoria.participantAlt);
      }

      if (autoria?.participantPn) {
        msg.participantPn = String(autoria.participantPn);
      }

      if (Array.isArray(autoria?.participantAliases)) {
        msg.participantAliases = autoria.participantAliases
          .map((valor) => String(valor || "").trim())
          .filter(Boolean);
      }

      autoresAplicados += 1;
    }

    return autoresAplicados;
  }

  async function carregarNomesParticipantesGrupo(conversa) {
    if (!conversa?.id || !ehConversaGrupo?.(conversa)) return;
    if (carregamentosParticipantesGrupo.has(conversa.id)) return;

    carregamentosParticipantesGrupo.add(conversa.id);

    try {
      const resultado = await ipcRenderer.invoke("listar-participantes-grupo", {
        conversaId: conversa.id,
      });

      const mapa = new Map();

      for (const participante of Array.isArray(resultado?.participantes)
        ? resultado.participantes
        : []) {
        registrarParticipanteGrupo(mapa, participante);
      }

      const autoresAplicados = aplicarAutoriaNasMensagens(
        conversa,
        resultado?.autoresMensagens,
      );

      console.log(
        `[GRUPO] participants=${mapa.size} | authors=${Array.isArray(resultado?.autoresMensagens) ? resultado.autoresMensagens.length : 0} | applied=${autoresAplicados} | group=${conversa.id}.`,
      );

      // Atualiza o cache em toda abertura. Participantes podem mudar.
      if (mapa.size) {
        nomesParticipantesGrupoCache.set(conversa.id, mapa);
      } else {
        nomesParticipantesGrupoCache.delete(conversa.id);
      }

      if (obterConversaAtual?.() === conversa.id) {
        renderMensagens?.();
      }
    } catch (erro) {
      console.warn(
        `[GRUPO] participantes indisponiveis para ${conversa.id}: ${erro?.message || erro}`,
      );
    } finally {
      carregamentosParticipantesGrupo.delete(conversa.id);
    }
  }

  function obterRegistroParticipanteGrupo(conversa, candidatos) {
    const mapa = nomesParticipantesGrupoCache.get(conversa?.id);
    if (!mapa) return null;

    for (const participante of Array.isArray(candidatos)
      ? candidatos
      : [candidatos]) {
      if (!participante) continue;

      for (const chave of chavesNomeParticipanteGrupo(participante)) {
        const registro = mapa.get(chave);
        if (registro) return registro;
      }
    }

    return null;
  }

  function obterContatoSalvoDoParticipante(candidatos, registro = null) {
    const contatos = moduloNovaConversa.obterContatosSalvosWhatsapp?.() || [];
    const chavesAlvo = new Set();

    const adicionar = (valor) => {
      for (const chave of chavesNomeParticipanteGrupo(valor)) {
        chavesAlvo.add(chave);
      }
    };

    for (const candidato of Array.isArray(candidatos)
      ? candidatos
      : [candidatos]) {
      adicionar(candidato);
    }

    adicionar(registro?.id);
    adicionar(registro?.numeroWhatsapp);

    for (const alias of Array.isArray(registro?.aliases)
      ? registro.aliases
      : []) {
      adicionar(alias);
    }

    if (!chavesAlvo.size) return null;

    for (const contato of contatos) {
      const chavesContato = new Set();

      for (const valor of [contato?.id, contato?.numeroWhatsapp]) {
        for (const chave of chavesNomeParticipanteGrupo(valor)) {
          chavesContato.add(chave);
        }
      }

      if (!Array.from(chavesAlvo).some((chave) => chavesContato.has(chave))) {
        continue;
      }

      const nome = String(contato?.nome || "").trim();
      if (nome) return contato;
    }

    return null;
  }

  function numeroRealParticipanteGrupo(candidatos, registro = null) {
    const numeroRegistro = String(registro?.numeroWhatsapp || "").replace(
      /\D/g,
      "",
    );

    if (numeroRegistro) {
      return numeroRegistro;
    }

    for (const candidato of Array.isArray(candidatos)
      ? candidatos
      : [candidatos]) {
      const id = String(candidato || "")
        .trim()
        .toLowerCase();

      if (!id || id.endsWith("@lid") || id.endsWith("@g.us")) {
        continue;
      }

      const numero =
        digitosNumeroConversa?.(candidato) || id.replace(/\D/g, "");

      if (numero) {
        return numero;
      }
    }

    return "";
  }

  function resolverNomeParticipanteGrupo(conversa, msg) {
    if (!conversa || !msg || msg.minha || !ehConversaGrupo?.(conversa)) {
      return null;
    }

    const candidatos = candidatosAutorMensagemGrupo(msg);
    if (!candidatos.length) return null;

    const registro = obterRegistroParticipanteGrupo(conversa, candidatos);

    if (registro?.ehVoce) {
      return "Você";
    }

    const nomeSalvoWpp = String(registro?.nomeSalvo || "").trim();
    if (nomeSalvoWpp) {
      return nomeSalvoWpp;
    }

    const contatoSalvo = obterContatoSalvoDoParticipante(candidatos, registro);
    const nomeSalvo = String(contatoSalvo?.nome || "").trim();

    if (nomeSalvo) {
      return nomeSalvo;
    }

    const numero = numeroRealParticipanteGrupo(candidatos, registro);
    if (numero) {
      return formatarNumeroWhatsapp(numero);
    }

    return null;
  }

  return {
    carregarNomesParticipantesGrupo,
    resolverNomeParticipanteGrupo,
  };
}

module.exports = { criarModuloAutoresGrupo };
