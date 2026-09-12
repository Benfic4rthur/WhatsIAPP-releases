async function listarContatosSalvosWpp() {
  if (!client || encerrando) {
    return [];
  }

  let contatosBrutos = [];
  let origem = "nenhuma";

  if (typeof client.getAllContacts === "function") {
    try {
      const todos = await client.getAllContacts();

      if (Array.isArray(todos) && todos.length) {
        contatosBrutos = todos;
        origem = "client.getAllContacts";
      }
    } catch (erro) {
      console.log(
        `WPPConnect saved contacts getAllContacts failed: ${erro?.message || erro}`,
      );
    }
  }

  // Fallback direto no WA-JS. O filtro onlyMyContacts e a fonte mais
  // confiavel para distinguir agenda real de pushName/nome de conversa.
  if (
    (!contatosBrutos.length ||
      !contatosBrutos.some((item) => item?.isMyContact === true)) &&
    client?.page
  ) {
    try {
      const somenteSalvos = await client.page.evaluate(async () => {
        if (typeof WPP === "undefined" || !WPP.contact) {
          return [];
        }

        if (typeof WPP.contact.list === "function") {
          const lista = await WPP.contact.list({ onlyMyContacts: true });
          return Array.isArray(lista) ? lista : [];
        }

        if (typeof WPP.contact.getAllContacts === "function") {
          const lista = await WPP.contact.getAllContacts();
          return (Array.isArray(lista) ? lista : []).filter(
            (item) => item?.isMyContact === true,
          );
        }

        return [];
      });

      if (Array.isArray(somenteSalvos) && somenteSalvos.length) {
        contatosBrutos = somenteSalvos;
        origem = "WPP.contact.list";
      }
    } catch (erro) {
      console.log(
        `WPPConnect saved contacts WA-JS fallback failed: ${erro?.message || erro}`,
      );
    }
  }

  const unicos = new Map();

  for (const contato of contatosBrutos) {
    const id = normalizarId(
      contato?.id ||
        contato?.wid ||
        contato?._serialized ||
        contato?.phoneNumber,
    );

    if (
      !id ||
      id.endsWith("@g.us") ||
      id === "status@broadcast" ||
      id.endsWith("@broadcast") ||
      id.endsWith("@newsletter") ||
      contato?.isMe === true ||
      contato?.isMyContact !== true ||
      contato?.isWAContact === false
    ) {
      continue;
    }

    const nome = String(
      contato?.name || contato?.formattedName || contato?.shortName || "",
    ).trim();

    if (!nome) {
      continue;
    }

    let numeroWhatsapp = null;

    if (id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")) {
      numeroWhatsapp =
        id.replace(/@(c\.us|s\.whatsapp\.net)$/i, "").replace(/\D/g, "") ||
        null;
    }

    if (
      !numeroWhatsapp &&
      id.endsWith("@lid") &&
      typeof client.getPnLidEntry === "function"
    ) {
      try {
        const info = await client.getPnLidEntry(id);
        const pn = normalizarId(info?.phoneNumber || info?.pn || null);

        if (pn) {
          numeroWhatsapp =
            pn.replace(/@(c\.us|s\.whatsapp\.net)$/i, "").replace(/\D/g, "") ||
            null;
        }
      } catch {}
    }

    const chave = numeroWhatsapp ? `pn:${numeroWhatsapp}` : `id:${id}`;
    const existente = unicos.get(chave);

    if (
      !existente ||
      nome.localeCompare(existente.nome, "pt-BR", { sensitivity: "base" }) < 0
    ) {
      unicos.set(chave, {
        id,
        nome,
        numeroWhatsapp,
        salvo: true,
      });
    }
  }

  const contatos = Array.from(unicos.values()).sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", {
      sensitivity: "base",
    }),
  );

  console.log(
    `WPPConnect saved contacts: ${contatos.length} | source=${origem}.`,
  );

  return contatos;
}

async function listarGruposAtuaisWpp() {
  if (!client?.page || encerrando) {
    return [];
  }

  let gruposAtivos = [];

  try {
    gruposAtivos = await client.page.evaluate(async () => {
      const serializar = (valor) => {
        if (!valor) return null;

        if (typeof valor === "string") {
          return valor;
        }

        if (typeof valor?.toString === "function") {
          const texto = valor.toString();

          if (texto && texto !== "[object Object]") {
            return texto;
          }
        }

        return valor?._serialized || valor?.id || null;
      };

      const normalizar = (valor) => {
        const texto = String(serializar(valor) || "")
          .trim()
          .toLowerCase()
          .replace(/:\d+(?=@)/, "");

        if (!texto) return null;

        if (texto.endsWith("@c.us") || texto.endsWith("@s.whatsapp.net")) {
          return `u:${texto.replace(/@(c\.us|s\.whatsapp\.net)$/i, "")}`;
        }

        if (texto.endsWith("@lid")) {
          return `l:${texto.replace(/@lid$/i, "")}`;
        }

        return texto;
      };

      const meusIds = new Set();

      const adicionarMeuId = (valor) => {
        const id = normalizar(valor);

        if (id) {
          meusIds.add(id);
        }
      };

      try {
        adicionarMeuId(WPP?.conn?.getMyUserWid?.());
      } catch {}

      try {
        adicionarMeuId(WPP?.conn?.getMyUserLid?.());
      } catch {}

      try {
        adicionarMeuId(WPP?.conn?.getMyUserId?.());
      } catch {}

      try {
        adicionarMeuId(WPP?.conn?.getMyDeviceId?.());
      } catch {}

      if (!meusIds.size || !WPP?.group?.getAllGroups) {
        return [];
      }

      let grupos = [];

      try {
        grupos = await WPP.group.getAllGroups();
      } catch {
        grupos = [];
      }

      const resultado = [];

      for (const chat of Array.isArray(grupos) ? grupos : []) {
        const id = String(serializar(chat?.id) || "")
          .trim()
          .toLowerCase()
          .replace(/:\d+(?=@)/, "");

        if (!id.endsWith("@g.us")) {
          continue;
        }

        let participantes = Array.isArray(chat?.groupMetadata?.participants)
          ? chat.groupMetadata.participants
          : null;

        if (!participantes && WPP?.group?.getParticipants) {
          try {
            participantes = await WPP.group.getParticipants(id);
          } catch {
            participantes = null;
          }
        }

        if (!Array.isArray(participantes) || !participantes.length) {
          continue;
        }

        const idsParticipantes = participantes
          .map((item) => normalizar(item?.id || item?.wid || item))
          .filter(Boolean);

        const aindaParticipa = idsParticipantes.some((idParticipante) =>
          meusIds.has(idParticipante),
        );

        if (!aindaParticipa) {
          continue;
        }

        resultado.push({
          id,
          nome:
            chat?.name ||
            chat?.formattedTitle ||
            chat?.groupMetadata?.subject ||
            chat?.subject ||
            null,
          arquivada: !!chat?.archive,
          trancada: !!chat?.isLocked,
          totalParticipantes: idsParticipantes.length,
        });
      }

      return resultado;
    });
  } catch (erro) {
    console.log(
      `WPPConnect active groups lookup failed: ${erro?.message || erro}`,
    );

    return [];
  }

  const estadoPorGrupo = new Map();

  for (const item of Array.isArray(ultimoEstado) ? ultimoEstado : []) {
    const aliases = [
      item?.id,
      ...(Array.isArray(item?.aliases) ? item.aliases : []),
    ]
      .map(normalizarId)
      .filter(Boolean);

    const idGrupo = aliases.find((alias) => alias.endsWith("@g.us"));

    if (idGrupo) {
      estadoPorGrupo.set(idGrupo, item);
    }
  }

  const grupos = [];
  const vistos = new Set();

  for (const grupo of Array.isArray(gruposAtivos) ? gruposAtivos : []) {
    const idGrupo = normalizarId(grupo?.id);

    if (!idGrupo?.endsWith("@g.us") || vistos.has(idGrupo)) {
      continue;
    }

    vistos.add(idGrupo);

    const estado = estadoPorGrupo.get(idGrupo) || null;
    const aliases = new Set([idGrupo]);

    for (const alias of Array.isArray(estado?.aliases) ? estado.aliases : []) {
      const idAlias = normalizarId(alias);

      if (idAlias) {
        aliases.add(idAlias);
      }
    }

    grupos.push({
      id: idGrupo,
      nome: grupo?.nome || estado?.nome || null,
      arquivada:
        typeof estado?.arquivada === "boolean"
          ? !!estado.arquivada
          : !!grupo?.arquivada,
      trancada:
        typeof estado?.trancada === "boolean"
          ? !!estado.trancada
          : !!grupo?.trancada,
      aliases: Array.from(aliases),
      grupo: true,
      totalParticipantes: Number(grupo?.totalParticipantes || 0) || 0,
    });
  }

  console.log(
    `WPPConnect active groups: ${grupos.length} | membership=current.`,
  );

  return grupos;
}

async function listarGruposEmComumWpp(dados = {}) {
  if (!client?.page || encerrando) {
    return [];
  }

  const conversaId = normalizarId(dados?.conversaId);
  const numeroWhatsapp = String(dados?.numeroWhatsapp || "").replace(/\D/g, "");
  const aliasesAlvo = new Set();

  adicionarVariantesDeId(aliasesAlvo, conversaId);

  const numeros = new Set();
  for (const valor of [numeroWhatsapp, conversaId]) {
    for (const numero of variantesNumeroBrasilWpp(valor)) {
      numeros.add(numero);
    }
  }

  for (const numero of numeros) {
    adicionarVariantesDeId(aliasesAlvo, `${numero}@c.us`);
    adicionarVariantesDeId(aliasesAlvo, `${numero}@s.whatsapp.net`);
  }

  if (typeof client.getPnLidEntry === "function") {
    const candidatos = Array.from(aliasesAlvo).slice(0, 8);

    for (const candidato of candidatos) {
      try {
        const info = await aguardarComTimeoutWpp(
          client.getPnLidEntry(candidato),
          4500,
          null,
        );

        adicionarVariantesDeId(aliasesAlvo, info?.lid);
        adicionarVariantesDeId(aliasesAlvo, info?.phoneNumber);
        adicionarVariantesDeId(aliasesAlvo, info?.pn);
      } catch {}
    }
  }

  const aliases = Array.from(aliasesAlvo).filter(Boolean);

  if (!aliases.length) {
    return [];
  }

  let grupos = [];

  try {
    grupos = await client.page.evaluate(async (aliasesEntrada) => {
      const serializar = (valor) => {
        if (!valor) return null;
        if (typeof valor === "string") return valor;

        if (typeof valor?.toString === "function") {
          const texto = valor.toString();
          if (texto && texto !== "[object Object]") return texto;
        }

        return valor?._serialized || valor?.id || null;
      };

      const normalizar = (valor) => {
        const texto = String(serializar(valor) || "")
          .trim()
          .toLowerCase()
          .replace(/:\d+(?=@)/, "");

        if (!texto) return null;

        if (texto.endsWith("@c.us") || texto.endsWith("@s.whatsapp.net")) {
          return `u:${texto.replace(/@(c\.us|s\.whatsapp\.net)$/i, "")}`;
        }

        if (texto.endsWith("@lid")) {
          return `l:${texto.replace(/@lid$/i, "")}`;
        }

        return texto;
      };

      const alvos = new Set(
        (Array.isArray(aliasesEntrada) ? aliasesEntrada : [])
          .map(normalizar)
          .filter(Boolean),
      );

      if (!alvos.size || !WPP?.group?.getAllGroups) {
        return [];
      }

      const meusIds = new Set();
      const adicionarMeuId = (valor) => {
        const id = normalizar(valor);
        if (id) meusIds.add(id);
      };

      try {
        adicionarMeuId(WPP?.conn?.getMyUserWid?.());
      } catch {}
      try {
        adicionarMeuId(WPP?.conn?.getMyUserLid?.());
      } catch {}
      try {
        adicionarMeuId(WPP?.conn?.getMyUserId?.());
      } catch {}
      try {
        adicionarMeuId(WPP?.conn?.getMyDeviceId?.());
      } catch {}

      let todos = [];
      try {
        todos = await WPP.group.getAllGroups();
      } catch {
        todos = [];
      }

      const resultado = [];

      for (const chat of Array.isArray(todos) ? todos : []) {
        const id = String(serializar(chat?.id) || "")
          .trim()
          .toLowerCase()
          .replace(/:\d+(?=@)/, "");

        if (!id.endsWith("@g.us")) continue;

        let participantes = Array.isArray(chat?.groupMetadata?.participants)
          ? chat.groupMetadata.participants
          : null;

        if (
          (!participantes || !participantes.length) &&
          WPP?.group?.getParticipants
        ) {
          try {
            participantes = await WPP.group.getParticipants(id);
          } catch {
            participantes = null;
          }
        }

        if (!Array.isArray(participantes) || !participantes.length) continue;

        const idsParticipantes = participantes
          .map((item) => normalizar(item?.id || item?.wid || item))
          .filter(Boolean);

        const temAlvo = idsParticipantes.some((idParticipante) =>
          alvos.has(idParticipante),
        );
        if (!temAlvo) continue;

        const aindaParticipo = meusIds.size
          ? idsParticipantes.some((idParticipante) =>
              meusIds.has(idParticipante),
            )
          : true;

        if (!aindaParticipo) continue;

        resultado.push({
          id,
          nome:
            chat?.name ||
            chat?.formattedTitle ||
            chat?.groupMetadata?.subject ||
            chat?.subject ||
            id,
          totalParticipantes: idsParticipantes.length,
        });
      }

      return resultado;
    }, aliases);
  } catch (erro) {
    console.log(
      `WPPConnect common groups lookup failed: ${erro?.message || erro}`,
    );
    return [];
  }

  const unicos = new Map();
  for (const grupo of Array.isArray(grupos) ? grupos : []) {
    const id = normalizarId(grupo?.id);
    if (!id?.endsWith("@g.us") || unicos.has(id)) continue;

    unicos.set(id, {
      id,
      nome: grupo?.nome || id,
      totalParticipantes: Number(grupo?.totalParticipantes || 0) || 0,
    });
  }

  const lista = Array.from(unicos.values()).sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", {
      sensitivity: "base",
    }),
  );

  console.log(
    `[PERFIL] common groups=${lista.length} | contact=${conversaId || numeroWhatsapp || "unknown"}.`,
  );

  return lista;
}

async function listarParticipantesGrupoWpp(dados = {}) {
  if (!client?.page || encerrando) {
    return { participantes: [], euNoGrupo: false, total: 0 };
  }

  const conversaId = normalizarId(dados?.conversaId);
  if (!conversaId?.endsWith("@g.us")) {
    throw new Error("Grupo invalido para listar participantes.");
  }

  const chatId = await resolverChatId(conversaId);
  if (!chatId?.endsWith("@g.us")) {
    throw new Error("Nao consegui localizar o grupo no WPPConnect.");
  }

  const resultado = await client.page.evaluate(async (grupoId) => {
    const serializarLocal = (valor) => {
      if (!valor) return null;
      if (typeof valor === "string") return valor;
      if (valor?._serialized) return valor._serialized;
      if (valor?.id?._serialized) return valor.id._serialized;

      try {
        const texto = valor.toString?.();
        if (texto && texto !== "[object Object]") return texto;
      } catch {}

      return valor?.id || null;
    };

    const normalizarLocal = (valor) =>
      String(serializarLocal(valor) || "")
        .trim()
        .toLowerCase()
        .replace(/:\d+(?=@)/, "");

    const meusIds = new Set();
    const adicionarMeu = (valor) => {
      const id = normalizarLocal(valor);
      if (id) meusIds.add(id);
    };

    try {
      adicionarMeu(WPP?.conn?.getMyUserWid?.());
    } catch {}
    try {
      adicionarMeu(WPP?.conn?.getMyUserLid?.());
    } catch {}
    try {
      adicionarMeu(WPP?.conn?.getMyUserId?.());
    } catch {}
    try {
      adicionarMeu(WPP?.conn?.getMyDeviceId?.());
    } catch {}

    const participantes = await WPP.group.getParticipants(grupoId);
    const contactStore = WPP?.whatsapp?.ContactStore;

    const lista = [];

    for (const participante of Array.isArray(participantes)
      ? participantes
      : []) {
      const id = normalizarLocal(
        participante?.id || participante?.wid || participante,
      );
      if (!id) continue;

      let contato = null;
      try {
        contato = contactStore?.get?.(id) || null;
      } catch {}

      const nome =
        contato?.name ||
        contato?.formattedName ||
        contato?.shortName ||
        contato?.pushname ||
        contato?.verifiedName ||
        participante?.name ||
        participante?.pushname ||
        null;

      const nomeSalvo =
        contato?.isMyContact === true
          ? contato?.name ||
            contato?.formattedName ||
            contato?.shortName ||
            null
          : null;

      const numeroWhatsapp =
        id.endsWith("@c.us") || id.endsWith("@s.whatsapp.net")
          ? String(id.split("@")[0] || "").replace(/\D/g, "")
          : "";

      const ehVoce =
        participante?.isMe === true ||
        contato?.isMe === true ||
        meusIds.has(id);

      lista.push({
        id,
        nome: nome ? String(nome) : null,
        nomeSalvo: nomeSalvo ? String(nomeSalvo) : null,
        numeroWhatsapp: numeroWhatsapp || null,
        admin: participante?.isAdmin === true,
        superAdmin: participante?.isSuperAdmin === true,
        ehVoce,
      });
    }

    lista.sort((a, b) => {
      if (a.ehVoce && !b.ehVoce) return -1;
      if (!a.ehVoce && b.ehVoce) return 1;
      if ((a.admin || a.superAdmin) && !(b.admin || b.superAdmin)) return -1;
      if (!(a.admin || a.superAdmin) && (b.admin || b.superAdmin)) return 1;
      return String(a.nome || a.numeroWhatsapp || a.id).localeCompare(
        String(b.nome || b.numeroWhatsapp || b.id),
      );
    });

    return {
      participantes: lista,
      euNoGrupo: meusIds.size ? lista.some((item) => item.ehVoce) : true,
      total: lista.length,
    };
  }, chatId);

  const participantes = Array.isArray(resultado?.participantes)
    ? resultado.participantes
    : [];

  // Em grupos, mensagens podem identificar o remetente por LID. LID nao e
  // telefone. Resolvem-se esses aliases aqui para o renderer poder exibir
  // nome salvo quando existir e, caso contrario, o numero real do WhatsApp.
  for (const participante of participantes) {
    const idParticipante = normalizarId(participante?.id);
    const aliases = new Set();

    if (idParticipante) aliases.add(idParticipante);

    if (
      idParticipante?.endsWith("@lid") &&
      typeof client?.getPnLidEntry === "function"
    ) {
      let info = cacheLidPn.has(idParticipante)
        ? cacheLidPn.get(idParticipante)
        : undefined;

      if (info === undefined) {
        try {
          info = await client.getPnLidEntry(idParticipante);
          cacheLidPn.set(idParticipante, info || null);
        } catch {
          info = null;
          cacheLidPn.set(idParticipante, null);
        }
      }

      const pn = normalizarId(info?.phoneNumber);
      if (pn) {
        aliases.add(pn);

        const numeroReal = String(pn.split("@")[0] || "").replace(/\D/g, "");
        if (numeroReal) participante.numeroWhatsapp = numeroReal;
      }

      const lidResolvido = normalizarId(info?.lid);
      if (lidResolvido) aliases.add(lidResolvido);
    } else if (idParticipante) {
      const numeroDireto = String(idParticipante.split("@")[0] || "").replace(
        /\D/g,
        "",
      );
      if (numeroDireto) participante.numeroWhatsapp = numeroDireto;
    }

    if (participante?.numeroWhatsapp) {
      aliases.add(
        `${String(participante.numeroWhatsapp).replace(/\D/g, "")}@c.us`,
      );
      aliases.add(
        `${String(participante.numeroWhatsapp).replace(/\D/g, "")}@s.whatsapp.net`,
      );
    }

    participante.aliases = Array.from(aliases).filter(Boolean);
  }

  const participantesPorAlias = new Map();

  for (const participante of participantes) {
    const aliases = [
      participante?.id,
      ...(Array.isArray(participante?.aliases) ? participante.aliases : []),
    ];

    if (participante?.numeroWhatsapp) {
      const numero = String(participante.numeroWhatsapp).replace(/\D/g, "");
      if (numero) {
        aliases.push(`${numero}@c.us`, `${numero}@s.whatsapp.net`);
      }
    }

    for (const alias of aliases) {
      const chave = normalizarId(alias);
      if (chave) participantesPorAlias.set(chave, participante);
    }
  }

  const autoresMensagens = [];

  // A fonte mais confiavel agora e o proprio ID das mensagens que o
  // WhatsIAPP ja tem no cache. Para cada ID recebido, consultamos a mensagem
  // exata no WA-JS e lemos o participante real do grupo. Isso evita depender
  // de uma varredura generica do historico, que em algumas contas devolve
  // apenas uma mensagem.
  try {
    const idsAlvo = Array.from(
      new Set(
        (Array.isArray(dados?.idsMensagens) ? dados.idsMensagens : [])
          .map((valor) => String(valor || "").trim())
          .filter(Boolean),
      ),
    ).slice(-180);

    const mensagensAlvo = (
      Array.isArray(dados?.mensagensAlvo) ? dados.mensagensAlvo : []
    )
      .map((item) => ({
        idMensagem: String(item?.idMensagem || "").trim(),
        timestamp: Number(item?.timestamp || 0) || 0,
        texto: String(item?.texto || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 1200),
        tipo: String(item?.tipo || "texto")
          .trim()
          .toLowerCase(),
        fileName: String(item?.fileName || "")
          .trim()
          .slice(0, 260),
      }))
      .filter((item) => item.idMensagem)
      .slice(-180);

    const autoresDiretos = await client.page.evaluate(
      async (grupoId, idsMensagemAlvo, mensagensAlvoEntrada) => {
        const serializarLocal = (valor) => {
          if (!valor) return null;
          if (typeof valor === "string") return valor;
          if (valor?._serialized) return valor._serialized;
          if (valor?.id?._serialized) return valor.id._serialized;

          try {
            const texto = valor.toString?.();
            if (texto && texto !== "[object Object]") return texto;
          } catch {}

          return valor?.id || null;
        };

        const extrairIdLocal = (valor) => {
          let texto = String(serializarLocal(valor) || "").trim();
          if (!texto) return null;

          const partes = texto.split("_").filter(Boolean);

          if (partes.length > 1) {
            if (["out", "in"].includes(String(partes.at(-1)).toLowerCase())) {
              partes.pop();
            }

            const ultimo = partes.at(-1);

            if (ultimo && !ultimo.includes("@")) {
              return ultimo;
            }
          }

          return texto;
        };

        const normalizarLocal = (valor) =>
          String(serializarLocal(valor) || "")
            .trim()
            .toLowerCase()
            .replace(/:\d+(?=@)/, "");

        const normalizarTextoLocal = (valor) =>
          String(valor || "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();

        const timestampLocal = (mensagem) => {
          const valor =
            mensagem?.t ??
            mensagem?.timestamp ??
            mensagem?.messageTimestamp ??
            0;

          const numero = Number(valor || 0);
          if (!Number.isFinite(numero) || numero <= 0) return 0;

          // Algumas representacoes podem chegar em ms.
          return numero > 10_000_000_000
            ? Math.floor(numero / 1000)
            : Math.floor(numero);
        };

        const textoLocal = (mensagem) =>
          String(
            mensagem?.body ??
              mensagem?.content ??
              mensagem?.caption ??
              mensagem?.text ??
              mensagem?.filename ??
              mensagem?.fileName ??
              "",
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1200);

        const tipoLocal = (mensagem) => {
          const bruto = String(mensagem?.type || "texto")
            .trim()
            .toLowerCase();

          if (["chat", "text", "conversation"].includes(bruto)) {
            return "texto";
          }

          if (["ptt", "voice", "audio"].includes(bruto)) {
            return "audio";
          }

          if (["image", "imagem"].includes(bruto)) {
            return "imagem";
          }

          if (["video"].includes(bruto)) {
            return "video";
          }

          if (["document", "documento"].includes(bruto)) {
            return "documento";
          }

          if (["sticker"].includes(bruto)) {
            return "sticker";
          }

          return bruto || "texto";
        };

        const extrairAutorLocal = (mensagem) => {
          const candidatosAutor = [
            ["author", mensagem?.author],
            ["sender.id", mensagem?.sender?.id],
            ["sender.wid", mensagem?.sender?.wid],
            ["senderObj.id", mensagem?.senderObj?.id],
            ["participant", mensagem?.participant],
            ["id.participant", mensagem?.id?.participant],
            ["from", mensagem?.from],
          ];

          for (const [fonte, valor] of candidatosAutor) {
            const normalizado = normalizarLocal(valor);

            if (!normalizado || normalizado.endsWith("@g.us")) {
              continue;
            }

            return {
              autor: normalizado,
              fonteAutor: fonte,
            };
          }

          return {
            autor: "",
            fonteAutor: "",
          };
        };

        const alvosEntrada = Array.isArray(mensagensAlvoEntrada)
          ? mensagensAlvoEntrada.map((item) => ({
              idMensagem: String(item?.idMensagem || "").trim(),
              timestamp: Number(item?.timestamp || 0) || 0,
              texto: String(item?.texto || "")
                .replace(/\s+/g, " ")
                .trim(),
              tipo: String(item?.tipo || "texto")
                .trim()
                .toLowerCase(),
              fileName: String(item?.fileName || "").trim(),
            }))
          : [];

        const alvosUsados = new Set();

        const resultadoPorId = new Map();

        const registrarMensagem = (
          mensagem,
          idForcado = null,
          fonteForcada = null,
        ) => {
          if (!mensagem) return;

          const fromMe =
            mensagem?.fromMe === true ||
            mensagem?.id?.fromMe === true ||
            mensagem?.id?._fromMe === true;

          if (fromMe) return;

          const idMensagem = String(
            idForcado || extrairIdLocal(mensagem?.id) || "",
          ).trim();

          const autorInfo = extrairAutorLocal(mensagem);
          const autor = autorInfo.autor;
          const fonteAutor = String(
            fonteForcada || autorInfo.fonteAutor || "",
          ).trim();

          if (!idMensagem || !autor) {
            return;
          }

          resultadoPorId.set(idMensagem, {
            idMensagem,
            autor,
            fonteAutor,
          });
        };

        if (
          typeof WPP === "undefined" ||
          !WPP.chat ||
          typeof WPP.chat.getMessageById !== "function"
        ) {
          return [];
        }

        // 1. Busca exata pelas mensagens que estao aparecendo no WhatsIAPP.
        const idsCurtos = Array.isArray(idsMensagemAlvo)
          ? idsMensagemAlvo.slice(-180)
          : [];

        const tamanhoLote = 20;

        for (let i = 0; i < idsCurtos.length; i += tamanhoLote) {
          const lote = idsCurtos.slice(i, i + tamanhoLote);

          const idsCompletos = lote.map(
            (id) => `false_${grupoId}_${String(id || "").trim()}`,
          );

          let mensagensLote = [];

          try {
            const retorno = await WPP.chat.getMessageById(idsCompletos);
            mensagensLote = Array.isArray(retorno) ? retorno : [retorno];
          } catch {
            const individuais = await Promise.allSettled(
              lote.map(async (id) => {
                const candidatos = [
                  `false_${grupoId}_${id}`,
                  `false_${grupoId}_${id}_in`,
                ];

                for (const candidato of candidatos) {
                  try {
                    const mensagem = await WPP.chat.getMessageById(candidato);
                    if (mensagem) {
                      return {
                        id,
                        mensagem,
                      };
                    }
                  } catch {}
                }

                return null;
              }),
            );

            for (const item of individuais) {
              if (item.status !== "fulfilled" || !item.value?.mensagem) {
                continue;
              }

              registrarMensagem(item.value.mensagem, item.value.id);
            }

            continue;
          }

          for (let j = 0; j < mensagensLote.length; j += 1) {
            registrarMensagem(mensagensLote[j], lote[j] || null);
          }
        }

        // 2. Fallback principal para o WhatsApp Web atual:
        // getMessages() pode retornar o historico bruto sem o ID serializado.
        // Nesse caso casamos a mensagem WPP com a mensagem que ja existe no
        // WhatsIAPP usando timestamp + conteudo/tipo, e aplicamos o remetente
        // real retornado em sender/author.
        let historicoBruto = 0;
        let casadasPorFingerprint = 0;
        let ambiguas = 0;

        if (
          typeof WPP.chat.getMessages === "function" &&
          resultadoPorId.size < idsCurtos.length
        ) {
          try {
            const mensagens = await WPP.chat.getMessages(grupoId, {
              count: 300,
            });

            const listaHistorico = Array.isArray(mensagens) ? mensagens : [];
            historicoBruto = listaHistorico.length;

            for (const mensagem of listaHistorico) {
              const fromMe =
                mensagem?.fromMe === true ||
                mensagem?.id?.fromMe === true ||
                mensagem?.id?._fromMe === true;

              if (fromMe) {
                continue;
              }

              const autorInfo = extrairAutorLocal(mensagem);

              if (!autorInfo.autor) {
                continue;
              }

              // Se veio com ID utilizavel, continua sendo o melhor caminho.
              const idDireto = extrairIdLocal(mensagem?.id);

              if (idDireto && idsCurtos.includes(String(idDireto))) {
                registrarMensagem(
                  mensagem,
                  idDireto,
                  `history:${autorInfo.fonteAutor}`,
                );
                continue;
              }

              const ts = timestampLocal(mensagem);
              const texto = normalizarTextoLocal(textoLocal(mensagem));
              const tipo = tipoLocal(mensagem);

              if (!ts) {
                continue;
              }

              const candidatos = [];

              for (const alvo of alvosEntrada) {
                if (
                  !alvo?.idMensagem ||
                  alvosUsados.has(alvo.idMensagem) ||
                  resultadoPorId.has(alvo.idMensagem)
                ) {
                  continue;
                }

                const diferencaTempo = Math.abs(
                  Number(alvo.timestamp || 0) - ts,
                );

                if (diferencaTempo > 3) {
                  continue;
                }

                const textoAlvo = normalizarTextoLocal(
                  alvo.texto || alvo.fileName || "",
                );
                const tipoAlvo = String(alvo.tipo || "texto")
                  .trim()
                  .toLowerCase();

                let pontos = 0;

                if (diferencaTempo === 0) pontos += 10;
                else if (diferencaTempo === 1) pontos += 7;
                else pontos += 4;

                if (texto && textoAlvo) {
                  if (texto === textoAlvo) {
                    pontos += 30;
                  } else if (
                    texto.length >= 12 &&
                    textoAlvo.length >= 12 &&
                    (texto.includes(textoAlvo) || textoAlvo.includes(texto))
                  ) {
                    pontos += 18;
                  } else {
                    // Duas mensagens com texto diferente no mesmo instante
                    // nao devem ser casadas apenas pelo horario.
                    continue;
                  }
                } else if (!texto && !textoAlvo) {
                  pontos += 5;
                }

                if (tipo && tipoAlvo && tipo === tipoAlvo) {
                  pontos += 5;
                }

                candidatos.push({
                  alvo,
                  pontos,
                  diferencaTempo,
                });
              }

              candidatos.sort(
                (a, b) =>
                  b.pontos - a.pontos || a.diferencaTempo - b.diferencaTempo,
              );

              const melhor = candidatos[0];
              const segundo = candidatos[1];

              if (!melhor || melhor.pontos < 10) {
                continue;
              }

              // Se dois candidatos ficaram praticamente empatados, e mais
              // seguro nao atribuir um remetente errado.
              if (
                segundo &&
                segundo.pontos === melhor.pontos &&
                segundo.diferencaTempo === melhor.diferencaTempo
              ) {
                ambiguas += 1;
                continue;
              }

              alvosUsados.add(melhor.alvo.idMensagem);

              registrarMensagem(
                mensagem,
                melhor.alvo.idMensagem,
                `fingerprint:${autorInfo.fonteAutor}`,
              );

              casadasPorFingerprint += 1;
            }
          } catch {}
        }

        const listaFinal = Array.from(resultadoPorId.values());

        const fontes = {};
        for (const item of listaFinal) {
          const chave = String(item?.fonteAutor || "desconhecida");
          fontes[chave] = (fontes[chave] || 0) + 1;
        }

        return {
          autores: listaFinal,
          fontes,
          encontrados: listaFinal.length,
          solicitados: idsCurtos.length,
          historicoBruto,
          casadasPorFingerprint,
          ambiguas,
        };
      },
      chatId,
      idsAlvo,
      mensagensAlvo,
    );

    const listaAutoresDiretos = Array.isArray(autoresDiretos?.autores)
      ? autoresDiretos.autores
      : [];

    console.log(
      `[GRUPO WPP AUTORES] requested=${Number(autoresDiretos?.solicitados || idsAlvo.length)} ` +
        `| history=${Number(autoresDiretos?.historicoBruto || 0)} ` +
        `| matched=${Number(autoresDiretos?.casadasPorFingerprint || 0)} ` +
        `| ambiguous=${Number(autoresDiretos?.ambiguas || 0)} ` +
        `| found=${Number(autoresDiretos?.encontrados || listaAutoresDiretos.length)} ` +
        `| sources=${JSON.stringify(autoresDiretos?.fontes || {})} | group=${chatId}.`,
    );

    for (const item of listaAutoresDiretos) {
      const idMensagem = String(item?.idMensagem || "").trim();
      let autorId = normalizarId(item?.autor);

      if (!idMensagem || !autorId) {
        continue;
      }

      let participante = participantesPorAlias.get(autorId) || null;
      const aliasesAutor = new Set([autorId]);
      let numeroWhatsapp = String(participante?.numeroWhatsapp || "").replace(
        /\D/g,
        "",
      );

      if (
        autorId.endsWith("@lid") &&
        typeof client?.getPnLidEntry === "function"
      ) {
        let info = cacheLidPn.has(autorId)
          ? cacheLidPn.get(autorId)
          : undefined;

        if (info === undefined) {
          try {
            info = await client.getPnLidEntry(autorId);
            cacheLidPn.set(autorId, info || null);
          } catch {
            info = null;
            cacheLidPn.set(autorId, null);
          }
        }

        const pn = normalizarId(info?.phoneNumber);
        const lid = normalizarId(info?.lid);

        if (pn) aliasesAutor.add(pn);
        if (lid) aliasesAutor.add(lid);

        if (!numeroWhatsapp && pn) {
          numeroWhatsapp = String(pn.split("@")[0] || "").replace(/\D/g, "");
        }

        if (!participante) {
          participante =
            (pn ? participantesPorAlias.get(pn) : null) ||
            (lid ? participantesPorAlias.get(lid) : null) ||
            null;
        }
      }

      if (!numeroWhatsapp && participante?.numeroWhatsapp) {
        numeroWhatsapp = String(participante.numeroWhatsapp).replace(/\D/g, "");
      }

      if (numeroWhatsapp) {
        aliasesAutor.add(`${numeroWhatsapp}@c.us`);
        aliasesAutor.add(`${numeroWhatsapp}@s.whatsapp.net`);
      }

      if (participante) {
        const idParticipante = normalizarId(participante?.id);
        if (idParticipante) aliasesAutor.add(idParticipante);

        for (const alias of Array.isArray(participante?.aliases)
          ? participante.aliases
          : []) {
          const normalizado = normalizarId(alias);
          if (normalizado) aliasesAutor.add(normalizado);
        }
      }

      const participant = converterIdWppParaBaileys(autorId);
      const participantPn = numeroWhatsapp
        ? `${numeroWhatsapp}@s.whatsapp.net`
        : null;

      autoresMensagens.push({
        idMensagem,
        participant: participant || autorId,
        participantPn,
        participantAliases: Array.from(aliasesAutor).filter(Boolean),
      });
    }
  } catch (erro) {
    console.warn(
      `[PERFIL GRUPO] autores WA-JS indisponiveis | group=${chatId} | erro=${erro?.message || erro}`,
    );
  }

  console.log(
    `[PERFIL GRUPO] participants=${participantes.length} | authors=${autoresMensagens.length} ` +
      `| requested=${Array.isArray(dados?.idsMensagens) ? dados.idsMensagens.length : 0} ` +
      `| group=${chatId} | self=${resultado?.euNoGrupo === false ? "false" : "true"}.`,
  );

  return {
    participantes,
    autoresMensagens,
    euNoGrupo: resultado?.euNoGrupo !== false,
    total: Number(resultado?.total || participantes.length) || 0,
  };
}

async function sairGrupoWpp(dados = {}) {
  if (!client || encerrando) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  const conversaId = normalizarId(dados?.conversaId);
  if (!conversaId?.endsWith("@g.us")) {
    throw new Error("Grupo invalido.");
  }

  const chatId = await resolverChatId(conversaId);
  if (!chatId?.endsWith("@g.us")) {
    throw new Error("Nao consegui localizar o grupo no WPPConnect.");
  }

  if (typeof client.leaveGroup !== "function") {
    throw new Error("Saida de grupo indisponivel no WPPConnect.");
  }

  await client.leaveGroup(chatId);

  console.log(`[PERFIL GRUPO] left group=${chatId}.`);

  return {
    ok: true,
    conversaId: chatId,
  };
}

function variantesNumeroBrasilWpp(valor) {
  const bruto = String(valor || "").trim();
  let digitos = bruto
    .replace(/:\d+(?=@)/, "")
    .replace(/@(c\.us|s\.whatsapp\.net|lid)$/i, "")
    .replace(/\D/g, "");

  if (!digitos) return [];

  if (
    !bruto.startsWith("+") &&
    (digitos.length === 10 || digitos.length === 11)
  ) {
    digitos = `55${digitos}`;
  }

  const saida = new Set([digitos]);

  if (digitos.startsWith("55")) {
    const nacional = digitos.slice(2);

    if (nacional.length === 11 && nacional[2] === "9") {
      saida.add(`55${nacional.slice(0, 2)}${nacional.slice(3)}`);
    } else if (nacional.length === 10) {
      saida.add(`55${nacional.slice(0, 2)}9${nacional.slice(2)}`);
    }
  }

  return Array.from(saida).filter(
    (numero) => numero.length >= 10 && numero.length <= 15,
  );
}

function statusNumeroExisteWpp(status) {
  return !!(
    status &&
    status?.erro !== true &&
    (status.numberExists === true || status.canReceiveMessage === true)
  );
}

async function verificarNumeroWhatsappWpp(valor) {
  const bruto = String(valor || "").trim();
  const variantes = variantesNumeroBrasilWpp(bruto);

  if (!variantes.length) {
    throw new Error("Numero invalido.");
  }

  if (!client || typeof client.checkNumberStatus !== "function") {
    throw new Error("Consulta de numero indisponivel no WPPConnect.");
  }

  let status = null;
  let numeroResolvido = variantes[0];

  for (const numeroCandidato of variantes) {
    const idCandidato = `${numeroCandidato}@c.us`;
    const tentativa = await aguardarComTimeoutWpp(
      client.checkNumberStatus(idCandidato),
      15000,
      null,
    );

    if (statusNumeroExisteWpp(tentativa)) {
      status = tentativa;
      numeroResolvido = numeroCandidato;
      break;
    }

    if (!status) {
      status = tentativa;
    }
  }

  const existe = statusNumeroExisteWpp(status);
  const idResolvido = `${numeroResolvido}@c.us`;
  const aliases = new Set();

  const adicionarAlias = (valorAlias) => {
    const serializado = serializarId(valorAlias) || normalizarId(valorAlias);
    const normalizado = normalizarId(serializado);

    if (!normalizado) return;

    aliases.add(normalizado);

    if (normalizado.endsWith("@c.us")) {
      aliases.add(normalizado.replace("@c.us", "@s.whatsapp.net"));
    }

    if (normalizado.endsWith("@s.whatsapp.net")) {
      aliases.add(normalizado.replace("@s.whatsapp.net", "@c.us"));
    }
  };

  for (const numeroCandidato of variantes) {
    adicionarAlias(`${numeroCandidato}@c.us`);
    adicionarAlias(`${numeroCandidato}@s.whatsapp.net`);
  }

  adicionarAlias(idResolvido);
  adicionarAlias(status?.id);
  adicionarAlias(status?.wid);
  adicionarAlias(status?.to);

  if (typeof client.getPnLidEntry === "function") {
    const idsPn = Array.from(aliases).filter(
      (alias) => alias.endsWith("@c.us") || alias.endsWith("@s.whatsapp.net"),
    );

    for (const idPn of idsPn.slice(0, 4)) {
      try {
        const info = await aguardarComTimeoutWpp(
          client.getPnLidEntry(idPn),
          5000,
          null,
        );

        adicionarAlias(info?.lid);
        adicionarAlias(info?.phoneNumber);
        adicionarAlias(info?.pn);
      } catch {}
    }
  }

  let meuId = null;

  try {
    meuId = await client.page?.evaluate(() => {
      try {
        const wid = WPP?.conn?.getMyUserWid?.();
        return wid?.toString?.() || wid?._serialized || null;
      } catch {
        return null;
      }
    });
  } catch {}

  const aliasesMeu = new Set();

  const adicionarAliasMeu = (valorAlias) => {
    const normalizado = normalizarId(serializarId(valorAlias) || valorAlias);
    if (!normalizado) return;

    aliasesMeu.add(normalizado);
    adicionarAlias(normalizado);

    if (normalizado.endsWith("@c.us")) {
      const alternativo = normalizado.replace("@c.us", "@s.whatsapp.net");
      aliasesMeu.add(alternativo);
      adicionarAlias(alternativo);
    }

    if (normalizado.endsWith("@s.whatsapp.net")) {
      const alternativo = normalizado.replace("@s.whatsapp.net", "@c.us");
      aliasesMeu.add(alternativo);
      adicionarAlias(alternativo);
    }
  };

  adicionarAliasMeu(meuId);

  if (
    normalizarId(meuId)?.endsWith("@lid") &&
    typeof client.getPnLidEntry === "function"
  ) {
    try {
      const infoMeuId = await aguardarComTimeoutWpp(
        client.getPnLidEntry(meuId),
        5000,
        null,
      );

      adicionarAliasMeu(infoMeuId?.phoneNumber);
      adicionarAliasMeu(infoMeuId?.pn);
      adicionarAliasMeu(infoMeuId?.lid);
    } catch {}
  }

  const meusNumeros = new Set();

  for (const aliasMeu of aliasesMeu) {
    for (const numeroMeu of variantesNumeroBrasilWpp(aliasMeu)) {
      meusNumeros.add(numeroMeu);
    }
  }

  const numerosConsulta = new Set(variantes);
  const ehMeuNumero =
    meusNumeros.size > 0 &&
    Array.from(meusNumeros).some((numero) => numerosConsulta.has(numero));

  let idCanonico = null;

  if (ehMeuNumero && meuId) {
    idCanonico = normalizarId(meuId);
  }

  if (!idCanonico && existe) {
    idCanonico =
      normalizarId(serializarId(status?.id)) ||
      normalizarId(serializarId(status?.wid)) ||
      normalizarId(idResolvido);
  }

  let nomeContato = null;

  if (existe && client?.page) {
    try {
      nomeContato = await client.page.evaluate((ids) => {
        try {
          const store = WPP?.whatsapp?.ContactStore;
          if (!store) return null;

          for (const id of ids || []) {
            const contato = store.get?.(id);
            const nome =
              contato?.name ||
              contato?.formattedName ||
              contato?.shortName ||
              contato?.pushname ||
              contato?.verifiedName ||
              null;

            if (nome) return String(nome);
          }
        } catch {}

        return null;
      }, Array.from(aliases));
    } catch {}
  }

  console.log(
    `WPPConnect number status: input=${variantes[0]} | resolved=${numeroResolvido} | exists=${existe ? "true" : "false"} | self=${ehMeuNumero ? "true" : "false"} | canonical=${idCanonico || "-"}.`,
  );

  return {
    ok: true,
    existe,
    numero: variantes[0],
    numeroResolvido,
    id: existe ? idCanonico : null,
    idCanonico: existe ? idCanonico : null,
    aliases: existe ? Array.from(aliases) : [],
    ehMeuNumero,
    nomeContato: nomeContato || null,
    isBusiness: !!status?.isBusiness,
  };
}

