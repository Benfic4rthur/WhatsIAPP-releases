function converterVideoAnexoParaMp4(caminhoEntrada, caminhoSaida) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("FFmpeg nao foi localizado pelo ffmpeg-static."));
      return;
    }

    const argumentos = [
      "-y",
      "-i",
      caminhoEntrada,
      "-map_metadata",
      "-1",
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      caminhoSaida,
    ];

    execFile(
      ffmpegPath,
      argumentos,
      {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (erro, _stdout, stderr) => {
        if (!erro) {
          resolve();
          return;
        }

        const detalhe = String(stderr || erro?.message || erro)
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-5)
          .join(" | ");

        reject(
          new Error(
            detalhe
              ? `Falha ao preparar video para o WhatsApp: ${detalhe}`
              : "Falha ao preparar video para o WhatsApp.",
          ),
        );
      },
    );
  });
}

function converterAudioGravadoParaOggOpus(caminhoEntrada, caminhoSaida) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("FFmpeg nao foi localizado pelo ffmpeg-static."));
      return;
    }

    const argumentos = [
      "-y",
      "-i",
      caminhoEntrada,
      "-vn",
      "-c:a",
      "libopus",
      "-application",
      "voip",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-b:a",
      "32k",
      caminhoSaida,
    ];

    execFile(
      ffmpegPath,
      argumentos,
      {
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (erro, _stdout, stderr) => {
        if (!erro) {
          resolve();
          return;
        }

        const detalhe = String(stderr || erro?.message || erro)
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(-4)
          .join(" | ");

        reject(
          new Error(
            detalhe
              ? `Falha ao converter audio para OGG/Opus: ${detalhe}`
              : "Falha ao converter audio para OGG/Opus.",
          ),
        );
      },
    );
  });
}

async function enviarAudioGravadoWpp(conversaId, bytes, mime, resposta = null) {
  if (!client) {
    throw new Error("WPPConnect ainda nao esta conectado.");
  }

  const buffer = Buffer.from(bytes || []);

  if (!buffer.length) {
    throw new Error("A gravacao de audio esta vazia.");
  }

  const { origem, chatId } = await resolverChatIdParaEnvio(conversaId);
  const mimeEntrada = String(mime || "audio/webm");
  const mimeBaseEntrada = mimeEntrada.split(";")[0].trim().toLowerCase();
  const respostaNormalizada = normalizarRespostaWpp(resposta);
  const quotedMsg = await resolverIdCitacaoWpp(chatId, respostaNormalizada);

  garantirPastaMediaWpp();

  const timestamp = Date.now();
  const nomeOgg = `voz_${timestamp}.ogg`;
  const caminhoOgg = path.join(pastaMediaWpp(), sanitizarNomeWpp(nomeOgg));

  let caminhoEntrada = null;

  if (mimeBaseEntrada.includes("ogg")) {
    fs.writeFileSync(caminhoOgg, buffer);
  } else {
    caminhoEntrada = path.join(
      pastaMediaWpp(),
      sanitizarNomeWpp(`voz_origem_${timestamp}.webm`),
    );

    fs.writeFileSync(caminhoEntrada, buffer);

    await converterAudioGravadoParaOggOpus(caminhoEntrada, caminhoOgg);
  }

  if (!fs.existsSync(caminhoOgg) || fs.statSync(caminhoOgg).size <= 0) {
    throw new Error("O audio OGG gerado esta vazio.");
  }

  const bufferOgg = fs.readFileSync(caminhoOgg);
  const tokenEnvioAudioLocal = registrarEnvioAudioLocalWppEmAndamento(
    origem,
    chatId,
  );

  let resultado = null;
  let erroBase64 = null;

  if (typeof client.sendPttFromBase64 === "function") {
    try {
      const base64 = `data:audio/ogg;base64,${bufferOgg.toString("base64")}`;

      resultado = await client.sendPttFromBase64(
        chatId,
        base64,
        nomeOgg,
        "",
        quotedMsg || undefined,
        undefined,
        true,
      );
    } catch (erro) {
      erroBase64 = erro;

      console.warn(
        `WPPConnect sendPttFromBase64 OGG falhou, tentando arquivo: ${erro?.message || erro}`,
      );
    }
  }

  if (!resultado && typeof client.sendPtt === "function") {
    try {
      resultado = await client.sendPtt(
        chatId,
        caminhoOgg,
        nomeOgg,
        "",
        quotedMsg || undefined,
        undefined,
        true,
      );
    } catch (erro) {
      finalizarEnvioAudioLocalWppEmAndamento(tokenEnvioAudioLocal);
      throw erro;
    }
  }

  if (!resultado) {
    finalizarEnvioAudioLocalWppEmAndamento(tokenEnvioAudioLocal);

    if (erroBase64) {
      throw erroBase64;
    }

    throw new Error("Envio de audio gravado indisponivel no WPPConnect.");
  }

  const idRaw = resultado?.id || resultado?.key?.id || resultado?._serialized;

  if (!idRaw) {
    finalizarEnvioAudioLocalWppEmAndamento(tokenEnvioAudioLocal);
    throw new Error("O WhatsApp Web nao confirmou o envio do audio.");
  }

  emitirMensagemEnviadaWpp({
    conversaId: origem,
    idRaw,
    texto: "",
    tipo: "audio",
    mime: "audio/ogg",
    mediaPath: caminhoOgg,
    ack: resultado?.ack,
    resposta: respostaNormalizada,
  });

  // A partir daqui o id final ja esta em mensagensEnviadasWpp.
  finalizarEnvioAudioLocalWppEmAndamento(tokenEnvioAudioLocal);

  await desarquivarAposEnvio(origem, chatId);

  if (caminhoEntrada) {
    try {
      if (fs.existsSync(caminhoEntrada)) {
        fs.unlinkSync(caminhoEntrada);
      }
    } catch {}
  }

  console.log(`WPPConnect envio PTT OGG/Opus: ${origem} -> ${chatId}.`);

  return {
    idMensagem: extrairIdMensagemWpp(idRaw),
    conversaId: origem,
    via: "wppconnect",
  };
}

function timestampMensagemWpp(valor) {
  let numero = Number(valor);

  if (!Number.isFinite(numero) || numero <= 0) {
    numero = Math.floor(Date.now() / 1000);
  }

  if (numero > 1000000000000) {
    numero = Math.floor(numero / 1000);
  }

  return numero;
}

function horarioTimestampWpp(timestamp) {
  return new Date(timestampMensagemWpp(timestamp) * 1000).toLocaleTimeString(
    "pt-BR",
    {
      hour: "2-digit",
      minute: "2-digit",
    },
  );
}

function extensaoMidiaWpp(mime, tipo) {
  const m = String(mime || "").toLowerCase();

  if (m.includes("jpeg")) return ".jpg";
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  if (m.includes("mp4")) return ".mp4";
  if (m.includes("webm")) return ".webm";
  if (m.includes("ogg")) return ".ogg";
  if (m.includes("opus")) return ".ogg";
  if (m.includes("mpeg")) return tipo === "audio" ? ".mp3" : ".mpeg";
  if (m.includes("wav")) return ".wav";
  if (m.includes("pdf")) return ".pdf";
  if (m.includes("zip")) return ".zip";
  if (m.includes("plain")) return ".txt";
  if (m.includes("wordprocessingml")) return ".docx";
  if (m.includes("spreadsheetml")) return ".xlsx";
  if (m.includes("presentationml")) return ".pptx";

  if (tipo === "imagem") return ".jpg";
  if (tipo === "video") return ".mp4";
  if (tipo === "audio") return ".ogg";
  if (tipo === "sticker") return ".webp";

  return "";
}

function converterIdWppParaBaileys(valor) {
  let id = normalizarId(valor);

  if (!id) {
    return null;
  }

  if (id.endsWith("@c.us")) {
    id = id.replace("@c.us", "@s.whatsapp.net");
  }

  return id;
}

async function resolverConversaMensagemRecebidaWpp(mensagem) {
  let id = normalizarId(
    mensagem?.from || mensagem?.chatId || mensagem?.chat?.id,
  );

  if (!id) {
    return null;
  }

  if (id.endsWith("@c.us")) {
    return id.replace("@c.us", "@s.whatsapp.net");
  }

  if (id.endsWith("@lid") && typeof client?.getPnLidEntry === "function") {
    let info = cacheLidPn.get(id);

    if (!info) {
      try {
        info = await client.getPnLidEntry(id);
        cacheLidPn.set(id, info || null);
      } catch {
        info = null;
      }
    }

    const telefone = converterIdWppParaBaileys(info?.phoneNumber);

    if (telefone?.endsWith("@s.whatsapp.net")) {
      const chaveLid = chaveCanonica(id);
      const chaveTelefone = chaveCanonica(telefone);

      if (chaveLid) {
        aliasesParaChat.set(chaveLid, telefone);
      }

      if (chaveTelefone) {
        aliasesParaChat.set(chaveTelefone, telefone);
      }

      return telefone;
    }
  }

  return id;
}

function tipoMensagemRecebidaWpp(mensagem) {
  const bruto = String(mensagem?.type || "")
    .trim()
    .toLowerCase();

  if (bruto === "chat" || bruto === "text") return "texto";
  if (bruto === "image") return "imagem";
  if (bruto === "video") return "video";
  if (bruto === "audio" || bruto === "ptt") return "audio";
  if (bruto === "document") return "documento";
  if (bruto === "sticker") return "sticker";
  if (bruto === "location") return "localizacao";
  if (bruto === "vcard" || bruto === "multi_vcard") return "contato";

  if (mensagem?.body) {
    return "texto";
  }

  return null;
}

function textoErroInternoWpp(valor) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return false;
  }

  const mensagemNaoEncontrada =
    /\bMessage\s+(?:true|false)_[^\s]+\s+not found\b/i.test(texto);

  const getMessageById = /\bgetMessageById\b/i.test(texto);

  const stackWaJs =
    /@wppconnect-team[\\/]+wa-js/i.test(texto) ||
    /wppconnect-wa-js/i.test(texto);

  return mensagemNaoEncontrada && getMessageById && stackWaJs;
}

function textoParecePayloadMidiaWpp(valor) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return false;
  }

  if (/^data:[^;,]+;base64,/i.test(texto)) {
    return true;
  }

  if (
    /^(?:\/9j\/|iVBORw0KGgo|UklGR|R0lGOD|AAA[A-Za-z0-9+/=]{8,})/.test(texto)
  ) {
    return true;
  }

  if (texto.length < 180) {
    return false;
  }

  const compacto = texto.replace(/\s+/g, "");

  if (compacto.length < 180) {
    return false;
  }

  const caracteresBase64 = (compacto.match(/[A-Za-z0-9+/=]/g) || []).length;

  return caracteresBase64 / compacto.length >= 0.985;
}

function textoLegendaMidiaWpp(mensagem) {
  const caption = String(mensagem?.caption || "").trim();

  if (caption && !textoParecePayloadMidiaWpp(caption)) {
    return caption;
  }

  const body = String(mensagem?.body || "").trim();

  if (body && !textoParecePayloadMidiaWpp(body)) {
    return body;
  }

  return "";
}

function textoMensagemRecebidaWpp(mensagem, tipo) {
  if (tipo === "texto") {
    return String(mensagem?.body || "");
  }

  if (tipo === "imagem" || tipo === "video") {
    return textoLegendaMidiaWpp(mensagem);
  }

  if (tipo === "documento") {
    // O nome fica em fileName; texto deve conservar a pergunta do remetente.
    return textoLegendaMidiaWpp(mensagem);
  }

  if (tipo === "localizacao") {
    return "📍 Localização";
  }

  if (tipo === "contato") {
    const nome =
      mensagem?.vcardFormattedName || mensagem?.notifyName || "Contato";

    return `👤 ${nome}`;
  }

  return "";
}

function dadosBase64MidiaWpp(valor, mimeFallback) {
  const texto = String(valor || "").trim();

  if (!texto) {
    return null;
  }

  const matchDataUrl = texto.match(/^data:([^;,]+)?;base64,([\s\S]*)$/i);

  if (matchDataUrl) {
    const payload = String(matchDataUrl[2] || "").replace(/\s+/g, "");

    // Blob vazio do WhatsApp/WPPConnect pode virar somente
    // "data:audio/ogg;base64,". Nao devemos decodificar o cabecalho
    // como se ele proprio fosse a midia.
    if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
      return null;
    }

    return {
      mime: matchDataUrl[1] || mimeFallback || null,
      buffer: Buffer.from(payload, "base64"),
    };
  }

  const payload = texto.replace(/\s+/g, "");

  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload)) {
    return null;
  }

  return {
    mime: mimeFallback || null,
    buffer: Buffer.from(payload, "base64"),
  };
}

async function baixarMidiaMensagemRecebidaWpp(mensagem, idMensagem, tipo) {
  if (!["imagem", "video", "audio", "documento", "sticker"].includes(tipo)) {
    return {
      mediaPath: null,
      mediaUrl: null,
      mime: mensagem?.mimetype || null,
      fileName: null,
    };
  }

  if (!client || typeof client.downloadMedia !== "function") {
    return {
      mediaPath: null,
      mediaUrl: null,
      mime: mensagem?.mimetype || null,
      fileName: null,
    };
  }

  // Para mensagens proprias vindas de outro dispositivo, o objeto recebido
  // pelo onAnyMessage pode existir antes de a midia estar completamente
  // materializada. O WPPConnect e mais confiavel quando o download usa o ID
  // serializado da mensagem. Mantemos o objeto apenas como fallback.
  const idSerializado = serializarId(mensagem?.id);
  let base64 = null;
  let erroId = null;

  if (idSerializado) {
    try {
      base64 = await client.downloadMedia(idSerializado);
    } catch (erro) {
      erroId = erro;
    }
  }

  if (!base64) {
    try {
      base64 = await client.downloadMedia(mensagem);
    } catch (erro) {
      throw erroId || erro;
    }
  }

  const dados = dadosBase64MidiaWpp(base64, mensagem?.mimetype);
  const minimoBytes = tipo === "audio" ? 256 : 32;

  if (!dados?.buffer?.length || dados.buffer.length < minimoBytes) {
    throw new Error(
      `Midia recebida ainda indisponivel ou incompleta (${Number(dados?.buffer?.length || 0)} bytes).`,
    );
  }

  garantirPastaMediaWpp();

  const mime = dados.mime || mensagem?.mimetype || null;
  const extensao = extensaoMidiaWpp(mime, tipo);

  const nomeOriginal =
    mensagem?.filename ||
    mensagem?.fileName ||
    (tipo === "documento" ? "Documento" : idMensagem);

  const nomeLimpo = sanitizarNomeWpp(nomeOriginal || idMensagem);
  const temExtensao = !!path.extname(nomeLimpo);

  const nomeFinal = temExtensao ? nomeLimpo : `${nomeLimpo}${extensao}`;

  const caminho = path.join(
    pastaMediaWpp(),
    `${sanitizarNomeWpp(idMensagem)}_recebida_${nomeFinal}`,
  );

  fs.writeFileSync(caminho, dados.buffer);

  return {
    mediaPath: caminho,
    mediaUrl: pathToFileURL(caminho).href,
    mime,
    fileName: tipo === "documento" ? nomeFinal : null,
  };
}

function aguardarMidiaOutroDispositivoWpp(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function materializarMidiaOutroDispositivoWpp(
  mensagem,
  conversaId,
  idMensagem,
  tipo,
) {
  const atrasos = [250, 650, 1200];
  let ultimoErro = null;

  for (const atraso of atrasos) {
    await aguardarMidiaOutroDispositivoWpp(atraso);

    try {
      const midia = await baixarMidiaMensagemRecebidaWpp(
        mensagem,
        idMensagem,
        tipo,
      );

      if (midia?.mediaPath && midia?.mediaUrl) {
        console.log(
          `[SYNC OUTRO DISPOSITIVO] MIDIA_OK | id=${idMensagem} | tipo=${tipo} | atraso=${atraso}ms`,
        );
        return midia;
      }
    } catch (erro) {
      ultimoErro = erro;
    }
  }

  // Ultimo fallback: o WPPConnect pode ja ter colocado a mensagem no
  // historico do chat mesmo quando o evento onAnyMessage chegou cedo demais.
  // Reutilizamos a recuperacao pontual existente em 02-mensagens-operacoes.js.
  try {
    const recuperada = await recuperarMidiaHistoricaWpp({
      conversaId,
      idMensagem,
    });

    if (recuperada?.ok && recuperada?.mediaPath && recuperada?.mediaUrl) {
      console.log(
        `[SYNC OUTRO DISPOSITIVO] MIDIA_OK_HISTORICO | id=${idMensagem} | tipo=${tipo}`,
      );
      return recuperada;
    }
  } catch (erro) {
    ultimoErro = erro;
  }

  throw ultimoErro || new Error("Midia de outro dispositivo indisponivel.");
}

function mensagemRecebidaIgnoravelWpp(mensagem) {
  const origem = normalizarId(
    mensagem?.from || mensagem?.chatId || mensagem?.chat?.id,
  );

  if (!origem) {
    return true;
  }

  if (
    origem === "status@broadcast" ||
    origem.endsWith("@broadcast") ||
    origem.endsWith("@newsletter")
  ) {
    return true;
  }

  if (mensagem?.isNotification || mensagem?.isPSA) {
    return true;
  }

  return false;
}

async function processarMensagemRecebidaWpp(mensagem) {
  if (!mensagem || mensagemRecebidaIgnoravelWpp(mensagem)) {
    return;
  }

  if (textoErroInternoWpp(mensagem?.body)) {
    console.warn(
      `[WPP FILTRO] ERRO_INTERNO_IGNORADO | fluxo=recebida | id=${extrairIdMensagemWpp(mensagem?.id) || "sem-id"}`,
    );
    return;
  }

  // onMessage e destinado a mensagens recebidas, mas mantemos a guarda
  // para evitar eco em caso de mudanca de comportamento da biblioteca.
  if (mensagem.fromMe) {
    return;
  }

  const idMensagem = extrairIdMensagemWpp(mensagem.id);

  if (!idMensagem) {
    return;
  }

  const conversaId = await resolverConversaMensagemRecebidaWpp(mensagem);

  if (!conversaId) {
    return;
  }

  let tipo = tipoMensagemRecebidaWpp(mensagem);

  if (!tipo) {
    return;
  }

  const timestamp = timestampMensagemWpp(mensagem.timestamp || mensagem.t);

  let viewOnceKind = null;
  let texto = textoMensagemRecebidaWpp(mensagem, tipo);
  let mediaPath = null;
  let mediaUrl = null;
  let mime = mensagem?.mimetype || null;
  let fileName = mensagem?.filename || mensagem?.fileName || null;

  if (
    mensagem.isViewOnce &&
    (tipo === "imagem" || tipo === "video" || tipo === "audio")
  ) {
    viewOnceKind =
      tipo === "imagem" ? "imagem" : tipo === "video" ? "video" : "audio";

    tipo = "view_once";

    texto =
      viewOnceKind === "imagem"
        ? "① Foto de visualização única\\nAbra no celular para visualizar"
        : viewOnceKind === "video"
          ? "① Vídeo de visualização única\\nAbra no celular para visualizar"
          : "① Áudio de reprodução única\\nAbra no celular para ouvir";
  } else {
    try {
      const midia = await baixarMidiaMensagemRecebidaWpp(
        mensagem,
        idMensagem,
        tipo,
      );

      mediaPath = midia.mediaPath;
      mediaUrl = midia.mediaUrl;
      mime = midia.mime || mime;
      fileName = midia.fileName || fileName;
    } catch (erro) {
      console.warn(
        `WPPConnect media receive failed: ${idMensagem}: ` +
          `${erro?.message || erro}`,
      );
    }
  }

  const nome =
    nomeDoChat(mensagem?.chat) ||
    mensagem?.notifyName ||
    mensagem?.sender?.name ||
    mensagem?.sender?.pushname ||
    null;

  const participant = converterIdWppParaBaileys(mensagem?.author);

  const resposta = respostaRecebidaWpp(mensagem);

  enviar("mensagem", {
    id: conversaId,
    nome,
    arquivada: false,
    trancada: false,
    idMensagem,
    idMensagemWpp: serializarId(mensagem.id) || null,
    resposta,
    texto,
    tipo,
    mime,
    fileName,
    viewOnceKind,
    horario: horarioTimestampWpp(timestamp),
    timestamp,
    minha: false,
    remoteJid: conversaId,
    participant: participant || null,
    lidaPorMim: false,
    statusEntrega: null,
    mediaPath,
    mediaUrl,
    rawBase64: null,
  });

  console.log(`WPPConnect mensagem recebida: ${tipo} em ${conversaId}.`);
}

let listenerMensagensPropriasWpp = null;
const mensagensPropriasAoVivoWppRecentes = new Map();

// Protege o envio de audio feito pelo proprio WhatsIAPP contra o onAnyMessage.
// O WPPConnect pode disparar onAnyMessage antes de sendPttFromBase64/sendPtt
// devolver o id final. Nesse intervalo o audio local ainda nao esta em
// mensagensEnviadasWpp e poderia entrar como se tivesse vindo de outro
// dispositivo, criando uma segunda bolha sem midia reproduzivel.
const enviosAudioLocaisWppEmAndamento = new Map();

function chaveConversaEnvioAudioLocalWpp(valor) {
  const id = normalizarId(valor);

  if (!id) {
    return null;
  }

  const chave = chaveCanonica(id);
  return chave || id.replace(/@c\.us$/i, "@s.whatsapp.net");
}

function registrarEnvioAudioLocalWppEmAndamento(origem, chatId) {
  const token = `audio-local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chaves = new Set();

  for (const valor of [origem, chatId]) {
    const chave = chaveConversaEnvioAudioLocalWpp(valor);
    if (chave) chaves.add(chave);
  }

  enviosAudioLocaisWppEmAndamento.set(token, {
    token,
    chaves,
    criadoEm: Date.now(),
  });

  return token;
}

function finalizarEnvioAudioLocalWppEmAndamento(token) {
  if (token) {
    enviosAudioLocaisWppEmAndamento.delete(token);
  }
}

function ehReflexoDeAudioLocalWpp(conversaId, tipo) {
  if (tipo !== "audio" || !enviosAudioLocaisWppEmAndamento.size) {
    return false;
  }

  const agora = Date.now();
  const chave = chaveConversaEnvioAudioLocalWpp(conversaId);

  for (const [token, item] of enviosAudioLocaisWppEmAndamento.entries()) {
    if (agora - Number(item?.criadoEm || 0) > 30000) {
      enviosAudioLocaisWppEmAndamento.delete(token);
      continue;
    }

    if (chave && item?.chaves?.has?.(chave)) {
      return true;
    }
  }

  return false;
}

function limparMensagensPropriasAoVivoWppRecentes() {
  const agora = Date.now();
  const ttl = 2 * 60 * 1000;

  for (const [id, criadoEm] of mensagensPropriasAoVivoWppRecentes.entries()) {
    if (agora - criadoEm > ttl) {
      mensagensPropriasAoVivoWppRecentes.delete(id);
    }
  }

  while (mensagensPropriasAoVivoWppRecentes.size > 500) {
    const primeiro = mensagensPropriasAoVivoWppRecentes.keys().next().value;
    mensagensPropriasAoVivoWppRecentes.delete(primeiro);
  }
}


async function reconciliarAckOutroDispositivoWpp(
  mensagem,
  conversaId,
  idMensagem,
) {
  if (
    !client ||
    typeof client.getMessageById !== "function" ||
    !idMensagem ||
    !conversaId
  ) {
    return;
  }

  const idSerializado = serializarId(mensagem?.id);

  if (!idSerializado) {
    return;
  }

  const atrasos = [300, 900, 1800, 3200];

  for (const atraso of atrasos) {
    await aguardarMidiaOutroDispositivoWpp(atraso);

    try {
      const atual = await client.getMessageById(idSerializado);
      const statusEntrega = normalizarAckWpp(atual?.ack);

      if (
        statusEntrega &&
        statusEntrega !== "pendente"
      ) {
        emitirStatusEntregaWpp(
          idMensagem,
          conversaId,
          statusEntrega,
          "RECONCILIACAO_OUTRO_DISPOSITIVO",
        );

        if (statusEntrega === "lida") {
          return;
        }
      }
    } catch {}
  }
}

async function processarMensagemPropriaAoVivoWpp(mensagem) {
  // onAnyMessage pode receber replay historico durante a inicializacao.
  // So aceitamos espelhamento de outro dispositivo depois da prontidao real.
  if (!prontidaoInicialFinalizada || !mensagem || !mensagem.fromMe) {
    return;
  }

  if (textoErroInternoWpp(mensagem?.body)) {
    console.warn(
      `[WPP FILTRO] ERRO_INTERNO_IGNORADO | fluxo=propria | id=${extrairIdMensagemWpp(mensagem?.id) || "sem-id"}`,
    );
    return;
  }

  const idMensagem = extrairIdMensagemWpp(mensagem.id);

  if (!idMensagem) {
    return;
  }

  // Mensagens enviadas pelo proprio WhatsIAPP ja sao materializadas pelo
  // fluxo de envio. O onAnyMessage existe para captar principalmente envios
  // feitos por OUTRO dispositivo vinculado, como WhatsApp Web ou celular.
  if (mensagensEnviadasWpp.has(idMensagem)) {
    return;
  }

  limparMensagensPropriasAoVivoWppRecentes();

  if (mensagensPropriasAoVivoWppRecentes.has(idMensagem)) {
    return;
  }

  const conversaId = await resolverConversaDaMensagemWpp(mensagem);
  const idNormalizado = normalizarId(conversaId);

  if (
    !idNormalizado ||
    idNormalizado === "status@broadcast" ||
    idNormalizado.endsWith("@broadcast") ||
    idNormalizado.endsWith("@newsletter")
  ) {
    return;
  }

  let tipo = tipoMensagemRecebidaWpp(mensagem);

  if (!tipo) {
    return;
  }

  if (ehReflexoDeAudioLocalWpp(idNormalizado, tipo)) {
    console.log(
      `[SYNC OUTRO DISPOSITIVO] reflexo local ignorado: audio em ${idNormalizado}.`,
    );
    return;
  }

  // Mensagens proprias criadas em outro dispositivo tambem precisam entrar
  // no mapa acompanhado pelo onAck. Antes elas apareciam no WhatsIAPP, mas
  // os eventos posteriores de entregue/lida eram descartados porque
  // registrarAckWpp() so atualiza IDs presentes em mensagensEnviadasWpp.
  // Registramos antes de baixar midia para nao perder ACK enquanto imagem,
  // video ou audio ainda esta sendo materializado.
  registrarEnvioWpp(mensagem.id, idNormalizado);

  const statusEntregaInicial =
    normalizarAckWpp(mensagem?.ack);
  atualizarStatusConhecidoEnvioWpp(idMensagem, statusEntregaInicial);

  mensagensPropriasAoVivoWppRecentes.set(idMensagem, Date.now());

  const timestamp = timestampMensagemWpp(mensagem.timestamp || mensagem.t);
  let viewOnceKind = null;
  let texto = textoMensagemRecebidaWpp(mensagem, tipo);
  let mediaPath = null;
  let mediaUrl = null;
  let mime = mensagem?.mimetype || null;
  let fileName = mensagem?.filename || mensagem?.fileName || null;

  if (
    mensagem.isViewOnce &&
    (tipo === "imagem" || tipo === "video" || tipo === "audio")
  ) {
    viewOnceKind =
      tipo === "imagem" ? "imagem" : tipo === "video" ? "video" : "audio";

    tipo = "view_once";

    texto =
      viewOnceKind === "imagem"
        ? "① Foto de visualização única\nAbra no celular para visualizar"
        : viewOnceKind === "video"
          ? "① Vídeo de visualização única\nAbra no celular para visualizar"
          : "① Áudio de reprodução única\nAbra no celular para ouvir";
  } else {
    try {
      const midia = await baixarMidiaMensagemRecebidaWpp(
        mensagem,
        idMensagem,
        tipo,
      );

      mediaPath = midia.mediaPath;
      mediaUrl = midia.mediaUrl;
      mime = midia.mime || mime;
      fileName = midia.fileName || fileName;
    } catch (erro) {
      console.warn(
        `[SYNC OUTRO DISPOSITIVO] midia indisponivel: ${idMensagem}: ` +
          `${erro?.message || erro}`,
      );
    }
  }

  const nome =
    nomeDoChat(mensagem?.chat) ||
    mensagem?.notifyName ||
    mensagem?.sender?.name ||
    mensagem?.sender?.pushname ||
    null;

  const payloadMensagemPropria = {
    id: idNormalizado,
    nome,
    arquivada: false,
    trancada: false,
    idMensagem,
    idMensagemWpp: serializarId(mensagem.id) || null,
    resposta: respostaRecebidaWpp(mensagem),
    texto,
    tipo,
    mime,
    fileName,
    viewOnceKind,
    horario: horarioTimestampWpp(timestamp),
    timestamp,
    minha: true,
    remoteJid: idNormalizado,
    participant: converterIdWppParaBaileys(mensagem?.author) || null,
    lidaPorMim: true,
    statusEntrega: statusEntregaInicial,
    mediaPath,
    mediaUrl,
    rawBase64: null,
  };

  // A mensagem aparece imediatamente. Se a midia ainda nao estava pronta no
  // momento do onAnyMessage, fazemos o download em background e reenviamos o
  // MESMO id para o renderer. O renderer mescla os campos de midia no registro
  // existente, sem criar uma segunda bolha.
  enviar("mensagem", payloadMensagemPropria);

  void reconciliarAckOutroDispositivoWpp(
    mensagem,
    idNormalizado,
    idMensagem,
  );

  if (
    !viewOnceKind &&
    ["imagem", "video", "audio", "documento", "sticker"].includes(tipo) &&
    !mediaUrl
  ) {
    void materializarMidiaOutroDispositivoWpp(
      mensagem,
      idNormalizado,
      idMensagem,
      tipo,
    )
      .then((midiaAtualizada) => {
        enviar("mensagem", {
          ...payloadMensagemPropria,
          mime: midiaAtualizada?.mime || payloadMensagemPropria.mime,
          fileName:
            midiaAtualizada?.fileName || payloadMensagemPropria.fileName,
          mediaPath: midiaAtualizada?.mediaPath || null,
          mediaUrl: midiaAtualizada?.mediaUrl || null,
        });
      })
      .catch((erro) => {
        console.warn(
          `[SYNC OUTRO DISPOSITIVO] MIDIA_FALHOU | id=${idMensagem} | tipo=${tipo} | erro=${erro?.message || erro}`,
        );
      });
  }

  console.log(
    `[SYNC OUTRO DISPOSITIVO] mensagem propria ao vivo: ${tipo} em ${idNormalizado}.`,
  );
}

function registrarMensagensAoVivoWpp() {
  if (
    !client ||
    typeof client.onMessage !== "function" ||
    listenerMensagensWpp
  ) {
    return false;
  }

  try {
    // Mensagens recebidas de contatos continuam ativas imediatamente.
    // Este listener ja existia antes e nao depende do FULL_READY.
    listenerMensagensWpp = client.onMessage((mensagem) => {
      processarMensagemRecebidaWpp(mensagem).catch((erro) => {
        console.error(
          "WPPConnect mensagem recebida: erro ao processar:",
          erro?.message || erro,
        );
      });
    });

    enviar("wpp-live-ready", {
      ativo: true,
    });

    console.log("WPPConnect: recepcao de mensagens ao vivo registrada.");

    return true;
  } catch (erro) {
    console.error(
      "WPPConnect: falha ao registrar recepcao ao vivo:",
      erro?.message || erro,
    );

    return false;
  }
}

function registrarMensagensPropriasAoVivoWpp() {
  if (
    !client ||
    !prontidaoInicialFinalizada ||
    typeof client.onAnyMessage !== "function" ||
    listenerMensagensPropriasWpp
  ) {
    return false;
  }

  try {
    listenerMensagensPropriasWpp = client.onAnyMessage((mensagem) => {
      processarMensagemPropriaAoVivoWpp(mensagem).catch((erro) => {
        console.error(
          "[SYNC OUTRO DISPOSITIVO] erro ao processar mensagem propria:",
          erro?.message || erro,
        );
      });
    });

    console.log(
      "WPPConnect: sincronizacao de outro dispositivo ativada apos FULL_READY.",
    );

    return true;
  } catch (erro) {
    console.warn(
      "WPPConnect: onAnyMessage indisponivel para sincronizacao entre dispositivos:",
      erro?.message || erro,
    );

    return false;
  }
}
