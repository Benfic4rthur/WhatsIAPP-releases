function ehConversaTecnica(conversa) {
  if (conversa?.testeIntegridadeIA) {
    return true;
  }

  const id = String(conversa?.id || "")
    .trim()
    .toLowerCase();
  const nome = String(conversa?.nome || "")
    .trim()
    .toLowerCase();

  if (id === "status@broadcast" || nome === "status@broadcast") {
    return true;
  }
  if (id.endsWith("@newsletter") || id.endsWith("@broadcast")) {
    return true;
  }
  return false;
}

function descricaoPreview(msg) {
  if (!msg) return "Sem mensagens carregadas";

  let texto = msg.texto || "";
  if (msg.tipo === "imagem") texto = texto ? `🖼 ${texto}` : "🖼 Imagem";
  if (msg.tipo === "audio") texto = "🎤 Áudio";
  if (msg.tipo === "video") texto = texto ? `🎥 ${texto}` : "🎥 Vídeo";
  if (msg.tipo === "sticker") texto = "🧩 Figurinha";
  if (msg.tipo === "documento") {
    texto = `📎 ${msg.fileName || msg.texto || "Documento"}`;
  }
  if (msg.tipo === "view_once") {
    if (msg.viewOnceKind === "imagem") {
      texto = "① Foto de visualização única";
    } else if (msg.viewOnceKind === "video") {
      texto = "① Vídeo de visualização única";
    } else if (msg.viewOnceKind === "audio") {
      texto = "① Áudio de reprodução única";
    } else {
      texto = "① Mídia de visualização única";
    }
  }

  return `${msg.minha ? "Você: " : ""}${texto}`;
}

function textoHorarioListaConversa(conversa, ultima) {
  const direto = String(ultima?.horario || "").trim();
  if (direto) {
    return direto;
  }

  const timestamp = Number(ultima?.timestamp || conversa?.timestamp || 0) || 0;
  if (!timestamp) {
    return "";
  }

  const data = new Date(timestamp * 1000);
  const hoje = new Date();
  if (data.toDateString() === hoje.toDateString()) {
    return data.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  if (data.toDateString() === ontem.toDateString()) {
    return "ontem";
  }

  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function normalizarTextoBusca(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function criarModuloUtilitariosConversa(deps = {}) {
  const {
    document,
    obterModuloListaConversas,
    definirAbaAtual,
    desarquivamentosLocaisPendentes,
  } = deps;

  function obterListaConversas() {
    return typeof obterModuloListaConversas === "function"
      ? obterModuloListaConversas()
      : null;
  }

  function ativarAba(nome) {
    const moduloListaConversas = obterListaConversas();
    if (moduloListaConversas?.ativarAba) {
      return moduloListaConversas.ativarAba(nome);
    }

    definirAbaAtual?.(nome);
    const abaPrincipal = [
      "conversas",
      "nao-lidas",
      "favoritos",
      "grupos",
    ].includes(nome);

    document
      ?.getElementById("abaConversas")
      ?.classList.toggle("ativa", nome === "conversas");
    document
      ?.getElementById("abaNaoLidas")
      ?.classList.toggle("ativa", nome === "nao-lidas");
    document
      ?.getElementById("abaFavoritos")
      ?.classList.toggle("ativa", nome === "favoritos");
    document
      ?.getElementById("abaGrupos")
      ?.classList.toggle("ativa", nome === "grupos");
    document
      ?.getElementById("btnRailConversas")
      ?.classList.toggle("ativa", abaPrincipal);
    document
      ?.getElementById("btnRailArquivadas")
      ?.classList.toggle("ativa", nome === "arquivadas");
    document
      ?.getElementById("btnRailFavoritos")
      ?.classList.toggle("ativa", nome === "favoritos");
  }

  function recalcularNaoLidasGlobal() {
    return obterListaConversas()?.recalcularNaoLidasGlobal?.();
  }

  function marcarConversaComoLidaLocal(conversa) {
    return obterListaConversas()?.marcarConversaComoLidaLocal?.(conversa);
  }

  async function desarquivarAutomaticamentePorMensagem(
    conversaId,
    tentativa = 1,
  ) {
    return obterListaConversas()?.desarquivarAutomaticamentePorMensagem?.(
      conversaId,
      tentativa,
    );
  }

  function incrementarNaoLidaLocal(conversa) {
    return obterListaConversas()?.incrementarNaoLidaLocal?.(conversa);
  }

  function atualizarContadores() {
    return obterListaConversas()?.atualizarContadores?.();
  }

  function renderConversas() {
    return obterListaConversas()?.renderConversas?.();
  }

  function desarquivarLocalmenteAoEnviar(conversa) {
    if (!conversa?.id || !conversa.arquivada || conversa.trancada) {
      return false;
    }

    desarquivamentosLocaisPendentes?.add?.(conversa.id);
    conversa.arquivada = false;
    atualizarContadores();
    renderConversas();
    return true;
  }

  function restaurarArquivamentoLocalSeFalhar(conversa, foiDesarquivada) {
    if (!conversa?.id || !foiDesarquivada) {
      return;
    }

    desarquivamentosLocaisPendentes?.delete?.(conversa.id);
    conversa.arquivada = true;
    atualizarContadores();
    renderConversas();
  }

  return {
    ativarAba,
    recalcularNaoLidasGlobal,
    marcarConversaComoLidaLocal,
    desarquivarAutomaticamentePorMensagem,
    incrementarNaoLidaLocal,
    atualizarContadores,
    renderConversas,
    desarquivarLocalmenteAoEnviar,
    restaurarArquivamentoLocalSeFalhar,
  };
}

module.exports = {
  criarModuloUtilitariosConversa,
  ehConversaTecnica,
  descricaoPreview,
  textoHorarioListaConversa,
  normalizarTextoBusca,
};
