async function listarFigurinhasWpp() {
  if (!client?.page || encerrando) {
    return [];
  }

  try {
    const figurinhas = await client.page.evaluate(async () => {
      const WA = WPP?.whatsapp;

      if (!WA) {
        return [];
      }

      const paraArray = (colecao) => {
        try {
          if (!colecao) return [];
          if (typeof colecao.toArray === "function") return colecao.toArray();
          if (typeof colecao.getModelsArray === "function") {
            return colecao.getModelsArray();
          }
          if (Array.isArray(colecao.models)) return colecao.models;
          if (Array.isArray(colecao._models)) return colecao._models;
          if (Array.isArray(colecao)) return colecao;
        } catch {}

        return [];
      };

      const normalizarChave = (valor) => {
        if (!valor) return "";

        try {
          if (typeof valor === "string") return valor;
          if (typeof valor.toString === "function") {
            const texto = valor.toString();
            if (texto && texto !== "[object Object]") return texto;
          }
        } catch {}

        return String(valor?._serialized || valor?.id || "");
      };

      const stickerStore = WA.StickerStore || null;
      const todosStore = paraArray(stickerStore);
      const candidatos = [];
      const vistos = new Set();

      const chaveSticker = (sticker) =>
        normalizarChave(
          sticker?.filehash ||
            sticker?.id ||
            sticker?.encFilehash ||
            sticker?.mediaData?.filehash,
        );

      const adicionar = (sticker) => {
        if (!sticker) return;

        const chave = chaveSticker(sticker);

        if (!chave || vistos.has(chave)) return;

        vistos.add(chave);
        candidatos.push(sticker);
      };

      const localizarNoStore = (valor) => {
        const alvo = normalizarChave(valor);
        if (!alvo) return null;

        try {
          const direto =
            stickerStore?.get?.(valor) || stickerStore?.get?.(alvo);
          if (direto) return direto;
        } catch {}

        return (
          todosStore.find((item) => {
            const campos = [
              item?.id,
              item?.filehash,
              item?.encFilehash,
              item?.mediaData?.filehash,
            ]
              .map(normalizarChave)
              .filter(Boolean);

            return campos.includes(alvo);
          }) || null
        );
      };

      // Prioriza recentes quando a versão atual do WhatsApp expõe a relação.
      for (const recente of paraArray(WA.RecentStickerStore)) {
        const possiveis = [
          recente?.sticker,
          recente?.stickerModel,
          recente?.model,
          recente?.attributes?.sticker,
        ];

        for (const item of possiveis) {
          adicionar(item);
        }

        const referencias = [
          recente?.stickerId,
          recente?.id,
          recente?.filehash,
          recente?.encFilehash,
          recente?.attributes?.stickerId,
          recente?.attributes?.id,
          recente?.attributes?.filehash,
        ];

        for (const referencia of referencias) {
          adicionar(localizarNoStore(referencia));
        }
      }

      // Inclui figurinhas carregadas nos pacotes/sessão.
      for (const pack of paraArray(WA.StickerPackStore)) {
        const colecoes = [
          pack?.stickers,
          pack?.stickerCollection,
          pack?.models,
        ];

        for (const colecao of colecoes) {
          for (const sticker of paraArray(colecao)) {
            adicionar(sticker);
          }
        }
      }

      for (const sticker of todosStore) {
        adicionar(sticker);
      }

      const blobParaDataUrl = (blob) =>
        new Promise((resolve) => {
          try {
            if (!(blob instanceof Blob)) {
              resolve(null);
              return;
            }

            const reader = new FileReader();
            reader.onloadend = () =>
              resolve(String(reader.result || "") || null);
            reader.onerror = () => resolve(null);
            reader.onabort = () => resolve(null);
            reader.readAsDataURL(blob);
          } catch {
            resolve(null);
          }
        });

      const blobAnimado = async (blob) => {
        try {
          if (!(blob instanceof Blob)) return false;

          const tipo = String(blob.type || "").toLowerCase();
          if (tipo.includes("gif")) return true;
          if (!tipo.includes("webp")) return false;

          const bytes = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
          let texto = "";

          for (const byte of bytes) {
            texto += String.fromCharCode(byte);
          }

          return (
            texto.startsWith("RIFF") &&
            texto.includes("WEBP") &&
            texto.includes("ANIM")
          );
        } catch {
          return false;
        }
      };

      const obterBlob = async (sticker) => {
        let retornoDownload = null;

        try {
          retornoDownload = await sticker?.downloadMedia?.();
        } catch {}

        const possiveis = [
          retornoDownload,
          sticker?.mediaData?.mediaBlob,
          sticker?.mediaObject?.mediaBlob,
          sticker?.mediaObject?.mediaData?.mediaBlob,
        ];

        try {
          if (sticker?.filehash && WA.MediaBlobCache?.get) {
            possiveis.push(WA.MediaBlobCache.get(sticker.filehash));
          }
        } catch {}

        for (const valor of possiveis) {
          if (!valor) continue;
          if (valor instanceof Blob) return valor;

          try {
            const blob = valor.forceToBlob?.();
            if (blob instanceof Blob) return blob;
          } catch {}
        }

        return null;
      };

      const saida = [];

      // Limite evita baixar centenas de blobs de uma vez e travar a UI.
      for (const sticker of candidatos.slice(0, 48)) {
        try {
          const blob = await obterBlob(sticker);
          const dataUrl = await blobParaDataUrl(blob);

          if (!dataUrl) continue;

          const animated =
            sticker?.isAnimated === true ||
            sticker?.animated === true ||
            sticker?.isAnimatedSticker === true ||
            (await blobAnimado(blob));

          saida.push({
            id: chaveSticker(sticker),
            dataUrl,
            mimetype: sticker?.mimetype || blob?.type || "image/webp",
            width: Number(sticker?.width || 0) || null,
            height: Number(sticker?.height || 0) || null,
            animated,
            origem: "sticker-store",
          });
        } catch {}
      }

      // Fallback robusto: o WhatsApp muda a forma dos stores com frequencia.
      // Se os modelos de StickerStore nao entregarem blob, aproveita mensagens
      // de figurinha ja carregadas no MsgStore e usa a API publica de download.
      if (saida.length < 48 && WPP?.chat?.downloadMedia) {
        const mensagensSticker = paraArray(WA.MsgStore)
          .filter((msg) => {
            const tipo = String(
              msg?.type || msg?.mediaType || "",
            ).toLowerCase();
            return tipo === "sticker" || msg?.isSticker === true;
          })
          .sort((a, b) => {
            if (!!a?.id?.fromMe !== !!b?.id?.fromMe) {
              return a?.id?.fromMe ? -1 : 1;
            }

            return (
              Number(b?.t || b?.timestamp || 0) -
              Number(a?.t || a?.timestamp || 0)
            );
          });

        for (const msg of mensagensSticker.slice(0, 60)) {
          if (saida.length >= 48) break;

          try {
            const idMensagem = normalizarChave(
              msg?.id?._serialized || msg?.id || msg?.key?.id,
            );

            if (!idMensagem) continue;

            const blob = await WPP.chat.downloadMedia(idMensagem);
            const dataUrl = await blobParaDataUrl(blob);

            if (!dataUrl) continue;

            const assinatura = String(
              msg?.filehash || msg?.encFilehash || idMensagem,
            );

            if (saida.some((item) => item.id === assinatura)) continue;

            const animated =
              msg?.isAnimated === true ||
              msg?.animated === true ||
              msg?.isAnimatedSticker === true ||
              (await blobAnimado(blob));

            saida.push({
              id: assinatura,
              dataUrl,
              mimetype: msg?.mimetype || blob?.type || "image/webp",
              width: Number(msg?.width || 0) || null,
              height: Number(msg?.height || 0) || null,
              animated,
              origem: "msg-store",
            });
          } catch {}
        }
      }

      return saida;
    });

    const animadas = (Array.isArray(figurinhas) ? figurinhas : []).filter(
      (item) => item?.animated,
    ).length;

    console.log(
      `WPPConnect stickers loaded: ${figurinhas.length} | animated=${animadas}.`,
    );

    return Array.isArray(figurinhas) ? figurinhas : [];
  } catch (erro) {
    console.log(`WPPConnect stickers lookup failed: ${erro?.message || erro}`);
    return [];
  }
}

function salvarFigurinhaLocalDataUrl(dataUrl) {
  try {
    const texto = String(dataUrl || "");
    const match = texto.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);

    if (!match?.[2]) {
      return null;
    }

    garantirPastaMediaWpp();

    const subtipo = String(match[1] || "webp").toLowerCase();
    const extensao = subtipo.includes("gif") ? ".gif" : ".webp";
    const caminho = path.join(
      pastaMediaWpp(),
      `sticker-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensao}`,
    );

    fs.writeFileSync(caminho, Buffer.from(match[2], "base64"));

    return caminho;
  } catch (erro) {
    console.log(`Sticker local save failed: ${erro?.message || erro}`);
    return null;
  }
}

function figurinhaAnimadaDataUrlWpp(dataUrl) {
  try {
    const texto = String(dataUrl || "");
    const match = texto.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
    if (!match?.[2]) return false;

    const tipo = String(match[1] || "").toLowerCase();
    if (tipo.includes("gif")) return true;
    if (!tipo.includes("webp")) return false;

    const bytes = Buffer.from(match[2], "base64").subarray(0, 512);
    const cabecalho = bytes.toString("latin1");

    return (
      cabecalho.startsWith("RIFF") &&
      cabecalho.includes("WEBP") &&
      cabecalho.includes("ANIM")
    );
  } catch {
    return false;
  }
}

async function enviarFigurinhaWpp(
  conversaId,
  dataUrl,
  resposta = null,
  metadados = {},
) {
  if (!client) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  const conteudo = String(dataUrl || "").trim();

  if (!/^data:image\//i.test(conteudo)) {
    throw new Error("Figurinha invalida.");
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);
  const respostaNormalizada = normalizarRespostaWpp(resposta);
  const quotedMsg = await resolverIdCitacaoWpp(chatId, respostaNormalizada);
  const mimetype = String(metadados?.mimetype || "image/webp").toLowerCase();
  const animated =
    metadados?.animated === true || figurinhaAnimadaDataUrlWpp(conteudo);

  let envioConfirmado = false;
  let idRaw = null;
  let ack = 1;
  let viaEnvio = null;
  let ultimoErro = null;

  // IMPORTANTE: cada caminho abaixo pode disparar o envio mesmo quando a API
  // retorna undefined/null. Por isso nunca encadeamos outro metodo apenas
  // porque o retorno veio vazio. Fallback so acontece quando houve excecao ou
  // quando o metodo simplesmente nao existe.
  if (client?.page && mimetype.includes("webp")) {
    try {
      const retorno = await client.page.evaluate(
        async ({
          chatIdPagina,
          conteudoPagina,
          mimetypePagina,
          quotedMsgPagina,
        }) => {
          if (!WPP?.chat?.sendFileMessage) {
            return { disponivel: false };
          }

          const resultado = await WPP.chat.sendFileMessage(
            chatIdPagina,
            conteudoPagina,
            {
              type: "sticker",
              mimetype: mimetypePagina || "image/webp",
              quotedMsg: quotedMsgPagina || undefined,
              waitForAck: true,
            },
          );

          const id =
            resultado?.id?._serialized ||
            resultado?.id ||
            resultado?.key?.id ||
            resultado?._serialized ||
            null;

          return {
            disponivel: true,
            enviado: true,
            id: typeof id === "string" ? id : null,
            ack: Number(resultado?.ack ?? 1) || 1,
          };
        },
        {
          chatIdPagina: chatId,
          conteudoPagina: conteudo,
          mimetypePagina: mimetype,
          quotedMsgPagina: quotedMsg || null,
        },
      );

      if (retorno?.disponivel && retorno?.enviado) {
        envioConfirmado = true;
        idRaw = retorno.id || null;
        ack = retorno.ack ?? 1;
        viaEnvio = animated ? "raw-webp-animated" : "raw-webp";
      }
    } catch (erro) {
      ultimoErro = erro;
      console.log(`Sticker raw send failed: ${erro?.message || erro}`);
    }
  }

  // Animada: se o envio raw nao estiver disponivel ou realmente falhar,
  // tentamos SOMENTE o metodo de sticker animado. Nunca convertemos depois
  // para sticker estatico, pois isso altera a figurinha original.
  if (!envioConfirmado && animated) {
    if (typeof client.sendImageAsStickerGif !== "function") {
      throw new Error(
        ultimoErro?.message ||
          "Envio de figurinha animada indisponivel no WPPConnect.",
      );
    }

    try {
      const resultado = await client.sendImageAsStickerGif(
        chatId,
        conteudo,
        quotedMsg ? { quotedMsg } : undefined,
      );

      envioConfirmado = true;
      idRaw =
        resultado?.id || resultado?.key?.id || resultado?._serialized || null;
      ack = resultado?.ack ?? 1;
      viaEnvio = "sticker-gif-fallback";
    } catch (erro) {
      ultimoErro = erro;
      console.log(`Sticker animated send failed: ${erro?.message || erro}`);
    }
  }

  // Estatica: apenas se o envio raw realmente falhou/nao existe.
  if (!envioConfirmado && !animated) {
    if (typeof client.sendImageAsSticker !== "function") {
      throw new Error(
        ultimoErro?.message || "Envio de figurinha indisponivel no WPPConnect.",
      );
    }

    try {
      const resultado = await client.sendImageAsSticker(
        chatId,
        conteudo,
        quotedMsg ? { quotedMsg } : undefined,
      );

      envioConfirmado = true;
      idRaw =
        resultado?.id || resultado?.key?.id || resultado?._serialized || null;
      ack = resultado?.ack ?? 1;
      viaEnvio = "sticker-image-fallback";
    } catch (erro) {
      ultimoErro = erro;
      console.log(`Sticker static send failed: ${erro?.message || erro}`);
    }
  }

  if (!envioConfirmado) {
    throw new Error(
      ultimoErro?.message || "Envio de figurinha indisponivel no WPPConnect.",
    );
  }

  // Se a API devolveu um ID serializavel, conseguimos materializar a mensagem
  // local imediatamente. Se nao devolveu, nao inventamos ID nem enviamos de
  // novo: o evento real do WhatsApp vai inserir a mensagem uma unica vez.
  if (idRaw) {
    const mediaPath = salvarFigurinhaLocalDataUrl(conteudo);

    emitirMensagemEnviadaWpp({
      conversaId: origem,
      idRaw,
      texto: "",
      tipo: "sticker",
      mime: mimetype || "image/webp",
      mediaPath,
      ack,
      resposta: respostaNormalizada,
    });
  }

  await desarquivarAposEnvio(origem, chatId);

  console.log(
    `WPPConnect sticker sent once: ${origem} -> ${chatId} | animated=${animated ? "true" : "false"} | method=${viaEnvio || "unknown"} | id=${idRaw ? "yes" : "no"}.`,
  );

  return {
    idMensagem: idRaw ? extrairIdMensagemWpp(idRaw) : null,
    conversaId: origem,
    via: "wppconnect",
    animated,
    metodo: viaEnvio,
    envioUnico: true,
  };
}

async function resolverContatoVcardWpp(contatoId, numeroWhatsapp) {
  const numero = String(numeroWhatsapp || "").replace(/\D/g, "");

  if (numero) {
    return `${numero}@c.us`;
  }

  let id = normalizarId(contatoId);

  if (!id) {
    throw new Error("Contato invalido.");
  }

  if (id.endsWith("@s.whatsapp.net")) {
    return id.replace("@s.whatsapp.net", "@c.us");
  }

  if (id.endsWith("@c.us")) {
    return id;
  }

  if (id.endsWith("@lid") && typeof client?.getPnLidEntry === "function") {
    try {
      const info = await client.getPnLidEntry(id);
      let pn = normalizarId(info?.phoneNumber || info?.pn || null);

      if (pn?.endsWith("@s.whatsapp.net")) {
        pn = pn.replace("@s.whatsapp.net", "@c.us");
      }

      if (pn?.endsWith("@c.us")) {
        return pn;
      }
    } catch {}
  }

  throw new Error("Nao consegui resolver o numero deste contato salvo.");
}

async function enviarContatoWpp(
  conversaId,
  contatoId,
  numeroWhatsapp,
  nome = "Contato",
) {
  if (!client) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  if (typeof client.sendContactVcard !== "function") {
    throw new Error("Compartilhamento de contato indisponivel no WPPConnect.");
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);
  const contatoVcard = await resolverContatoVcardWpp(contatoId, numeroWhatsapp);
  const nomeFinal = String(nome || "Contato").trim() || "Contato";

  const resultado = await client.sendContactVcard(
    chatId,
    contatoVcard,
    nomeFinal,
  );

  const idRaw = resultado?.id || resultado?.key?.id || resultado?._serialized;

  if (!idRaw) {
    throw new Error("O WhatsApp Web nao confirmou o compartilhamento.");
  }

  emitirMensagemEnviadaWpp({
    conversaId: origem,
    idRaw,
    texto: `👤 ${nomeFinal}`,
    tipo: "contato",
    ack: resultado?.ack ?? 1,
  });

  await desarquivarAposEnvio(origem, chatId);

  console.log(`WPPConnect contact sent: ${origem} -> ${chatId}.`);

  return {
    idMensagem: extrairIdMensagemWpp(idRaw),
    conversaId: origem,
    via: "wppconnect",
  };
}

