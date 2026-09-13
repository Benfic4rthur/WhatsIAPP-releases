const { ipcRenderer, shell, clipboard } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  criarModuloUtilitariosConversa,
  ehConversaTecnica,
  descricaoPreview,
  textoHorarioListaConversa,
  normalizarTextoBusca,
} = require("./renderer-modules/utilitarios-conversa.js");
const {
  criarModuloControleConversa,
  descricaoCurtaMensagemResposta,
  hashSenhaTrancadas,
} = require("./renderer-modules/controle-conversa.js");
const {
  criarModuloAdmin,
  escaparHtmlAdmin,
  numeroDecimalAdminRenderer,
  formatarMoedaAdmin,
  formatarMoedaAdminPrecisa,
} = require("./renderer-modules/admin.js");
const conversas = {};
const conversasSombraTesteIA = new Map();
const conversasProvisoriasNovaMensagem = new Map();
let moduloAdminOculto = null;
function diagnosticoSegundoPlanoIA(etapa, dados = {}) {
  try {
    ipcRenderer.send("diagnostico-bg-ia", {
      etapa: String(etapa || "SEM_ETAPA"),
      ...(dados && typeof dados === "object" ? dados : {}),
    });
  } catch {}
}
function diagnosticoPesquisaWebIA(etapa, dados = {}) {
  try {
    ipcRenderer.send("diagnostico-web-ia", {
      etapa: String(etapa || "SEM_ETAPA"),
      ...(dados && typeof dados === "object" ? dados : {}),
    });
  } catch {}
}
async function catalogoRelevanteParaMensagemIA(
  texto,
  conversaId = "",
  mensagensAnteriores = [],
) {
  const consulta = String(texto || "").trim();
  if (!consulta) {
    return false;
  }
  const historico = (
    Array.isArray(mensagensAnteriores) ? mensagensAnteriores : []
  )
    .slice(-8)
    .map((item) => ({
      role:
        String(item?.role || "").trim() === "assistant" ? "assistant" : "user",
      content: String(item?.content || "")
        .trim()
        .slice(0, 900),
    }))
    .filter((item) => item.content);
  try {
    const resultado = await ipcRenderer.invoke(
      "catalogo-verificar-relevancia-ia",
      {
        conversaId: String(conversaId || "").slice(0, 320),
        consulta: consulta.slice(0, 4000),
        mensagensAnteriores: historico,
      },
    );
    return !!resultado?.ok && !!resultado?.relevante;
  } catch {
    return false;
  }
}
async function catalogoMatchDiretoParaMensagemIA(texto) {
  const consulta = String(texto || "").trim();
  if (!consulta) {
    return false;
  }
  try {
    const resultado = await ipcRenderer.invoke(
      "catalogo-verificar-match-direto-ia",
      {
        consulta: consulta.slice(0, 4000),
      },
    );
    return !!resultado?.ok && !!resultado?.relevante;
  } catch {
    return false;
  }
}
function ehReferenciaAoContextoAnteriorIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto || texto.length > 320) {
    return false;
  }
  // Esta funcao identifica apenas dependencia do contexto anterior.
  // Ela nao decide a fonte. Catalogo, web e factual sao resolvidos depois
  // pelo roteador central usando tambem a ultima rota confirmada.
  if (
    /\b(ele|ela|eles|elas|esse|essa|esses|essas|isso|isto|aquilo|aquele|aquela|aqueles|aquelas|dele|dela|deles|delas|desse|dessa|desses|dessas|deste|desta|destes|destas|daquele|daquela|daqueles|daquelas|nele|nela|neles|nelas|nesse|nessa|nesses|nessas|neste|nesta|nestes|nestas|naquele|naquela|naqueles|naquelas)\b/.test(
      texto,
    )
  ) {
    return true;
  }
  if (
    /^(?:e |mas |entao |e ai |nesse caso |nessa situacao |nisso |com base nisso |a partir disso |considerando isso )/.test(
      texto,
    )
  ) {
    return true;
  }
  return /\b(?:mais detalhes|mais informacoes|me fala mais|fala mais|pode falar mais|o que mais|tem mais)\b/.test(
    texto,
  );
}
let conversaAtual = null;
let modoIAAtual = "manual";
let abaAtual = "conversas";
const desarquivamentosLocaisPendentes = new Set();
let filtro = "";
let cargaMidiaEmAndamento = new Set();
let moduloListaConversas = null;
let moduloRenderizacaoMensagens = null;
const moduloUtilitariosConversa = criarModuloUtilitariosConversa({
  document,
  obterModuloListaConversas: () => moduloListaConversas,
  definirAbaAtual: (valor) => {
    abaAtual = valor;
  },
  desarquivamentosLocaisPendentes,
});
const {
  ativarAba,
  recalcularNaoLidasGlobal,
  marcarConversaComoLidaLocal,
  desarquivarAutomaticamentePorMensagem,
  incrementarNaoLidaLocal,
  atualizarContadores,
  renderConversas,
  desarquivarLocalmenteAoEnviar,
  restaurarArquivamentoLocalSeFalhar,
} = moduloUtilitariosConversa;
async function animarConversaParaAba(conversaId, abaDestino, classe) {
  return moduloListaConversas?.animarConversaParaAba?.(
    conversaId,
    abaDestino,
    classe,
  );
}
async function animarTrancamentoConversa(conversaId, vaiTrancar) {
  return moduloListaConversas?.animarTrancamentoConversa?.(
    conversaId,
    vaiTrancar,
  );
}
const desarquivamentosAutomaticosEmAndamento = new Set();
let trancadasLiberadas = false;
const CHAVE_HASH_TRANCADAS = "whatsiapp.trancadas.secretHash.v1";
const CHAVE_OVERRIDES_TRANCADAS = "whatsiapp.trancadas.overrides.v1";
const moduloControleConversa = criarModuloControleConversa({
  document,
  window,
  localStorage,
  conversas,
  CHAVE_HASH_TRANCADAS,
  obterConversaAtual: () => conversaAtual,
  definirConversaAtual: (valor) => {
    conversaAtual = valor;
  },
  obterModoIAAtual: () => modoIAAtual,
  definirModoIAAtual: (valor) => {
    modoIAAtual = valor;
  },
  obterAbaAtual: () => abaAtual,
  definirAbaAtual: (valor) => {
    abaAtual = valor;
  },
  definirFiltro: (valor) => {
    filtro = String(valor || "");
  },
  definirTrancadasLiberadas: (valor) => {
    trancadasLiberadas = !!valor;
  },
  obterModuloListaConversas: () => moduloListaConversas,
});
const {
  cancelarFixacaoFimConversa,
  obterMensagemRespondendo,
  obterRespostaAtualParaEnvio,
  atualizarBarraRespostaMensagem,
  limparRespostaMensagem,
  ativarRespostaMensagem,
  localizarMensagemNaTela,
  destacarMensagemRespondida,
  bloquearTrancadas,
  senhaTrancadasConfigurada,
  configurarSenhaTrancadasSeNecessario,
  solicitarSenhaParaTrancamento,
  limparSelecaoConversa,
  abrirConversa,
} = moduloControleConversa;
const {
  criarPersistenciaNaoLidas,
  criarModuloListaConversas,
} = require("./renderer-modules/lista-conversas.js");
const {
  criarPersistenciaMidiasEnviadasLocais,
} = require("./renderer-modules/midia.js");
const { criarModuloVisaoIA } = require("./renderer-modules/visao-ia.js");
const {
  naoLidasPersistidas,
  salvarNaoLidasPersistidas,
  persistirNaoLidasConversa,
} = criarPersistenciaNaoLidas({
  localStorage,
});
const {
  midiasEnviadasLocais,
  salvarMidiasEnviadasLocais,
  persistirMidiaEnviadaLocal,
  recuperarMidiaEnviadaLocal,
} = criarPersistenciaMidiasEnviadasLocais({
  localStorage,
  fs,
  pathToFileURL,
});
const moduloVisaoIA = criarModuloVisaoIA({
  ipcRenderer,
  localStorage,
});
const {
  prepararContextoVisualIA,
  montarTextoMensagemComContextoVisualIA,
  mensagemSuportaInterpretacaoImagemIA,
} = moduloVisaoIA;
const {
  criarModuloTranscricaoIA,
} = require("./renderer-modules/transcricao-ia.js");
const moduloTranscricaoIA = criarModuloTranscricaoIA({
  ipcRenderer,
  localStorage,
});
const {
  prepararContextoAudioIA,
  montarTextoMensagemComTranscricaoAudioIA,
  mensagemSuportaTranscricaoAudioIA,
} = moduloTranscricaoIA;
const {
  criarModuloDocumentosIA,
} = require("./renderer-modules/documentos-ia.js");
const moduloDocumentosIA = criarModuloDocumentosIA({
  ipcRenderer,
  localStorage,
});
const {
  prepararContextoDocumentoIA,
  prepararContextoDocumentoRelacionadoIA,
  montarTextoMensagemComContextoDocumentoIA,
  montarTextoMensagemComDocumentoRelacionadoIA,
  mensagemSuportaLeituraDocumentoIA,
} = moduloDocumentosIA;
function carregarOverridesTrancadas() {
  try {
    const dados = JSON.parse(
      localStorage.getItem(CHAVE_OVERRIDES_TRANCADAS) || "{}",
    );
    return dados && typeof dados === "object" ? dados : {};
  } catch {
    return {};
  }
}
const overridesTrancadas = carregarOverridesTrancadas();
function salvarOverridesTrancadas() {
  localStorage.setItem(
    CHAVE_OVERRIDES_TRANCADAS,
    JSON.stringify(overridesTrancadas),
  );
}
function idsTrancamento(id, aliases = []) {
  return [id, ...(Array.isArray(aliases) ? aliases : [])]
    .map((valor) => String(valor || "").trim())
    .filter(Boolean);
}
function trancamentoEfetivo(id, trancadaWhatsapp, aliases = []) {
  for (const candidato of idsTrancamento(id, aliases)) {
    if (Object.prototype.hasOwnProperty.call(overridesTrancadas, candidato)) {
      return !!overridesTrancadas[candidato];
    }
  }
  return !!trancadaWhatsapp;
}
const {
  criarModuloConfiguracaoBillingIA,
} = require("./renderer-modules/configuracao-billing-ia.js");
const moduloConfiguracaoBillingIA = criarModuloConfiguracaoBillingIA({
  ipcRenderer,
  document,
  window,
  localStorage,
  requestAnimationFrame,
  formatarMoedaAdmin,
  formatarMoedaAdminPrecisa,
  obterModuloAdminOculto: () => moduloAdminOculto,
});
const {
  NIVEIS_CONTEXTO_IA,
  toastInternoContainer,
  obterPromptInternoIA,
  salvarPromptInternoIA,
  obterPromptPersonalizadoIA,
  salvarPromptPersonalizadoIA,
  obterConfiguracaoComercialCliente,
  aplicarConfiguracaoComercialCliente,
  nivelContextoPermitidoPeloPlano,
  nivelFallbackPermitidoPeloPlano,
  pesquisaWebPermitidaPeloPlano,
  carregarConfiguracaoComercialCliente,
  obterNivelContextoIA,
  salvarNivelContextoIA,
  obterConfiguracaoNivelContextoIA,
  obterLimitesContextoIAParaMotor,
} = moduloConfiguracaoBillingIA;
ipcRenderer.on("abrir-conversa-notificacao", (_evento, dados = {}) => {
  try {
    const conversaId = String(dados?.conversaId || "").trim();
    if (!conversaId) {
      console.warn("[NOTIFICACOES] CLICK_SEM_CONVERSA_ID");
      return;
    }

    const conversa = conversas?.[conversaId];
    if (!conversa) {
      console.warn(
        `[NOTIFICACOES] CLICK_CONVERSA_NAO_ENCONTRADA | conversa=${conversaId}`,
      );
      return;
    }

    console.log(
      `[NOTIFICACOES] CLICK_ABRINDO_CONVERSA | conversa=${conversaId}`,
    );
    abrirConversa(conversaId);
  } catch (erro) {
    console.warn(
      "[NOTIFICACOES] failed to open conversation from Windows notification:",
      erro?.message || erro || "unknown error",
    );
  }
});
const {
  criarModuloSincronizacaoInicial,
} = require("./renderer-modules/sincronizacao-inicial.js");
const moduloSincronizacaoInicial = criarModuloSincronizacaoInicial({
  document,
});
const { aplicarEtapaSincronizacao, obterSincronizacaoInicialConcluida } =
  moduloSincronizacaoInicial;
const {
  criarBootstrapInterface,
} = require("./renderer-modules/bootstrap-interface.js");
const bootstrapInterface = criarBootstrapInterface({
  document,
  escaparHtmlAdmin,
});
const {
  botaoPerfilApp,
  imagemPerfilApp,
  fallbackPerfilApp,
  listaConversas,
  mensagens,
  nomeChat,
  statusChat,
  busca,
  abaConversas,
  abaNaoLidas,
  abaFavoritos,
  abaGrupos,
  abaMais,
  abaArquivadas,
  contadorArquivadas,
  contadorNaoLidas,
  contadorFavoritos,
  abasFiltros,
  lateralTitulo,
  btnRailConversas,
  btnRailArquivadas,
  btnRailFavoritos,
  btnRailTrancadas,
  btnRailConfig,
  btnMenuConversas,
  chatPrincipal,
  botaoArquivar,
  botaoTrancar,
  obterMarkupEstadoInicialChat,
} = bootstrapInterface;
const {
  criarModuloConfiguracoesApp,
} = require("./renderer-modules/configuracoes-app.js");
const moduloConfiguracoesApp = criarModuloConfiguracoesApp({
  ipcRenderer,
  document,
  window,
  localStorage,
  botaoPerfilApp,
  NIVEIS_CONTEXTO_IA,
  CHAVE_HASH_TRANCADAS,
  obterPromptInternoIA,
  salvarPromptInternoIA,
  obterPromptPersonalizadoIA,
  salvarPromptPersonalizadoIA,
  obterNivelContextoIA,
  salvarNivelContextoIA,
  obterConfiguracaoNivelContextoIA,
  carregarConfiguracaoComercialCliente,
  nivelContextoPermitidoPeloPlano,
  nivelFallbackPermitidoPeloPlano,
  pesquisaWebPermitidaPeloPlano,
  obterPesquisaWebAtivaIA,
  salvarPesquisaWebAtivaIA,
  senhaTrancadasConfigurada,
  hashSenhaTrancadas,
  bloquearTrancadas,
  atualizarContadores,
  renderConversas,
  obterModuloAdminOculto: () => moduloAdminOculto,
  obterConfiguracaoComercialCliente,
});
const {
  overlayPromptBaseIA,
  campoPromptBaseIA,
  fecharConfiguracoesApp,
  atualizarResumoConfiguracoesIA,
  abrirEditorPromptIA,
  fecharPromptBaseIAConfig,
  obterTipoPromptIAEmEdicao,
} = moduloConfiguracoesApp;
const {
  criarRecursosVisuaisPerfilContato,
  criarModuloPerfilContato,
} = require("./renderer-modules/perfil-contato.js");
const recursosVisuaisPerfilContato = criarRecursosVisuaisPerfilContato({
  ipcRenderer,
  document,
  conversas,
  listaConversas,
  imagemPerfilApp,
  fallbackPerfilApp,
  obterConversaAtual: () => conversaAtual,
});
const {
  inicialDoContato,
  criarAvatarContato,
  formatarNumeroWhatsapp,
  carregarFotoPerfil,
  processarFilaFotosPerfil,
  enfileirarFotoPerfil,
  definirBaileysProntoParaFotos,
  obterObservadorAvatares,
  ehGrupoConversa,
  prepararCabecalhoContato,
  atualizarCabecalhoConversa,
  carregarMinhaFotoPerfil,
} = recursosVisuaisPerfilContato;
const {
  criarModuloNovaConversa,
} = require("./renderer-modules/nova-conversa.js");
const moduloNovaConversa = criarModuloNovaConversa({
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
});
const {
  idsGruposAtuaisWhatsapp,
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
} = moduloNovaConversa;
const {
  criarModuloAutoresGrupo,
} = require("./renderer-modules/autores-grupo.js");
const moduloAutoresGrupo = criarModuloAutoresGrupo({
  ipcRenderer,
  console,
  moduloNovaConversa,
  ehConversaGrupo,
  digitosNumeroConversa,
  variantesNumeroBrasilWhatsapp,
  formatarNumeroWhatsapp,
  obterConversaAtual: () => conversaAtual,
  renderMensagens,
});
const { carregarNomesParticipantesGrupo, resolverNomeParticipanteGrupo } =
  moduloAutoresGrupo;
const {
  criarModuloNotificacoesPresenca,
} = require("./renderer-modules/notificacoes-presenca.js");
const moduloNotificacoesPresenca = criarModuloNotificacoesPresenca({
  ipcRenderer,
  window,
  document,
  localStorage,
  conversas,
  statusChat,
  toastInternoContainer,
  inicialDoContato,
  abrirConversa,
  ehGrupoConversa,
  renderMensagens,
  obterConversaAtual: () => conversaAtual,
  obterSincronizacaoInicialConcluida,
});
const {
  notificacoesAtivasConversa,
  definirNotificacoesConversa,
  tocarSomNovaMensagem,
  mostrarToastInternoNovaMensagem,
  solicitarNotificacaoExternaMensagem,
  marcarConversaComoLidaWhatsapp,
  atualizarStatusCabecalho,
  assinarPresencaConversa,
} = moduloNotificacoesPresenca;
let moduloMidia = null;
const {
  criarModuloFeedbackEnvio,
} = require("./renderer-modules/feedback-envio.js");
const moduloFeedbackEnvio = criarModuloFeedbackEnvio({
  ipcRenderer,
  document,
  chatPrincipal,
});
void moduloFeedbackEnvio;
const {
  criarModuloFavoritos,
} = require("./renderer-modules/favoritos-mensagens.js");
const moduloFavoritos = criarModuloFavoritos({
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
  obterConversaAtual: () => conversaAtual,
  obterFiltro: () => filtro,
  obterAbaAtual: () => abaAtual,
});
const {
  mensagemEstaFavoritada,
  registrarFavoritoLocalmente,
  removerFavoritoLocalmente,
  atualizarFavoritoEditadoLocalmente,
  limparFavoritosDaConversa,
  totalFavoritosVisiveis,
  alterarFavoritoMensagem,
  dadosMensagemParaFavorito,
  renderFavoritos,
} = moduloFavoritos;
const {
  criarModuloReacoes,
} = require("./renderer-modules/reacoes-mensagens.js");
const moduloReacoes = criarModuloReacoes({
  ipcRenderer,
  document,
  localStorage,
  statusChat,
  conversas,
  obterConversaAtual: () => conversaAtual,
  renderMensagens,
});
const {
  normalizarEmojiReacao,
  normalizarListaReacoes,
  registrarReacoesLocalmente,
  removerRegistroReacoes,
  aplicarEstadoReacoesPersistidas,
  limparReacoesPersistidasDaConversa,
  dadosMensagemParaReacao,
  atualizarReacoesMensagemNaInterface,
  criarLinhaReacoes,
  abrirReacoesMensagem,
} = moduloReacoes;
const {
  criarModuloEstadoMensagens,
} = require("./renderer-modules/estado-mensagens.js");
const moduloEstadoMensagens = criarModuloEstadoMensagens({
  localStorage,
  removerRegistroReacoes,
  removerFavoritoLocalmente,
  atualizarFavoritoEditadoLocalmente,
  limparReacoesPersistidasDaConversa,
  limparFavoritosDaConversa,
});
const {
  obterRegistroMensagemApagada,
  criarTombstoneMensagemApagada,
  registrarMensagemApagadaLocalmente,
  mensagemEstaApagadaLocalmente,
  aplicarEstadoMensagemApagadaPersistida,
  registrarMensagemEditadaLocalmente,
  removerRegistroMensagemEditada,
  aplicarEstadoMensagemEditadaPersistida,
  obterUltimaMensagemCronologica,
  registrarConversaLimpaLocalmente,
  registrarConversaApagadaLocalmente,
  removerRegistroConversaApagada,
  mensagemIgnoradaPorLimpezaPersistida,
  conversaIgnoradaPorExclusaoPersistida,
  limparPersistenciasMensagensDaConversa,
  obterTombstonesPersistidosConversa,
} = moduloEstadoMensagens;
const {
  criarModuloGerenciamentoConversa,
} = require("./renderer-modules/gerenciamento-conversa.js");
const moduloGerenciamentoConversa = criarModuloGerenciamentoConversa({
  ipcRenderer,
  document,
  conversas,
  statusChat,
  naoLidasPersistidas,
  salvarNaoLidasPersistidas,
  registrarConversaLimpaLocalmente,
  registrarConversaApagadaLocalmente,
  limparPersistenciasMensagensDaConversa,
  obterMensagemRespondendo,
  limparRespostaMensagem,
  recalcularNaoLidasGlobal,
  atualizarContadores,
  renderConversas,
  obterConversaAtual: () => conversaAtual,
  renderMensagens,
  atualizarStatusCabecalho,
  limparSelecaoConversa,
});
const { abrirConfirmacaoGerenciamentoConversa } = moduloGerenciamentoConversa;
const {
  criarModuloPrivacidadeConversa,
} = require("./renderer-modules/privacidade-conversa.js");
const moduloPrivacidadeConversa = criarModuloPrivacidadeConversa({
  ipcRenderer,
  document,
  window,
  conversas,
  statusChat,
  botaoArquivar,
  botaoTrancar,
  obterConversaAtual: () => conversaAtual,
  solicitarSenhaParaTrancamento,
  animarTrancamentoConversa,
  overridesTrancadas,
  salvarOverridesTrancadas,
  persistirNaoLidasConversa,
  recalcularNaoLidasGlobal,
  atualizarContadores,
  limparSelecaoConversa,
  renderConversas,
  animarConversaParaAba,
  abaArquivadas,
  abaConversas,
  atualizarStatusCabecalho,
  atualizarCabecalhoConversa,
  abrirConfirmacaoGerenciamentoConversa,
  notificacoesAtivasConversa,
  definirNotificacoesConversa,
  fecharMenuContexto,
  registrarMenuContexto: (menu) => {
    menuContextoAtual = menu;
  },
});
const {
  atualizarBotaoTrancar,
  alterarTrancamento,
  atualizarBotaoArquivar,
  alterarArquivamento,
} = moduloPrivacidadeConversa;
const moduloPerfilContato = criarModuloPerfilContato({
  ipcRenderer,
  shell,
  document,
  window,
  conversas,
  statusChat,
  carregarFotoPerfil,
  criarAvatarContato,
  formatarNumeroWhatsapp,
  privacidadeConversa: moduloPrivacidadeConversa,
  renderConversas,
  atualizarCabecalhoConversa,
  normalizarTextoBusca,
  descricaoCurtaMensagemResposta,
  mensagemEstaFavoritada,
  cancelarFixacaoFimConversa,
  destacarMensagemRespondida,
  abrirConversa,
  carregarUmaMidia,
  abrirModalMidia: (msg) => moduloMidia?.abrirModalMidia?.(msg),
});
const { abrirPerfilContato, fecharPerfilContato } = moduloPerfilContato;
recursosVisuaisPerfilContato.configurarIntegracoes({
  abrirPerfilContato,
});
moduloListaConversas = criarModuloListaConversas({
  ipcRenderer,
  document,
  window,
  localStorage,
  listaConversas,
  busca,
  abaConversas,
  abaNaoLidas,
  abaFavoritos,
  abaGrupos,
  abaMais,
  abaArquivadas,
  contadorArquivadas,
  contadorNaoLidas,
  contadorFavoritos,
  abasFiltros,
  lateralTitulo,
  btnRailConversas,
  btnRailArquivadas,
  btnRailFavoritos,
  btnRailTrancadas,
  btnRailConfig,
  btnMenuConversas,
  botaoPerfilApp,
  conversas,
  idsGruposAtuaisWhatsapp,
  desarquivamentosAutomaticosEmAndamento,
  CHAVE_HASH_TRANCADAS,
  obterConversaAtual: () => conversaAtual,
  obterAbaAtual: () => abaAtual,
  definirAbaAtual: (valor) => {
    abaAtual = valor;
  },
  obterFiltro: () => filtro,
  definirFiltro: (valor) => {
    filtro = String(valor || "");
  },
  obterTrancadasLiberadas: () => trancadasLiberadas,
  definirTrancadasLiberadas: (valor) => {
    trancadasLiberadas = !!valor;
  },
  obterGruposAtuaisWhatsappCarregados:
    moduloNovaConversa.obterGruposAtuaisWhatsappCarregados,
  carregarGruposAtuaisWhatsapp,
  obterUltimaMensagemCronologica,
  criarAvatarContato,
  textoHorarioListaConversa,
  descricaoPreview,
  abrirPerfilContato,
  abrirConversa,
  abrirMenuContexto,
  obterObservadorAvatares,
  enfileirarFotoPerfil,
  ehConversaTecnica,
  ehConversaGrupo,
  renderFavoritos,
  normalizarTextoBusca,
  descricaoCurtaMensagemResposta,
  cancelarFixacaoFimConversa,
  localizarMensagemNaTela,
  destacarMensagemRespondida,
  totalFavoritosVisiveis,
  limparSelecaoConversa,
  abrirPainelNovaConversa,
  hashSenhaTrancadas,
  persistirNaoLidasConversa,
  marcarConversaComoLidaWhatsapp,
});
const {
  criarPersonalizacaoConversa,
} = require("./renderer-modules/personalizacao-conversa.js");
const personalizacaoConversa = criarPersonalizacaoConversa({
  document,
  console,
  localStorage,
  mensagens,
  conversas,
  obterConversaAtual: () => conversaAtual,
});
const { botaoPersonalizarConversa, aplicarAparenciaConversa } =
  personalizacaoConversa;
recursosVisuaisPerfilContato.configurarIntegracoes({
  renderConversas,
  aplicarAparenciaConversa,
  atualizarStatusCabecalho,
  obterBotaoPersonalizarConversa: () => botaoPersonalizarConversa,
});
const CHAVE_PESQUISA_WEB_IA = "whatsiapp.ia.pesquisaWebAtiva.v1";
function obterPesquisaWebAtivaIA() {
  if (!pesquisaWebPermitidaPeloPlano()) {
    return false;
  }
  try {
    const salvo = localStorage.getItem(CHAVE_PESQUISA_WEB_IA);
    // Nova instalacao: pesquisa comeca desligada e o cliente decide ligar.
    return salvo === null ? false : salvo !== "0";
  } catch {
    return false;
  }
}
function salvarPesquisaWebAtivaIA(ativo) {
  const valorFinal = pesquisaWebPermitidaPeloPlano() && !!ativo;
  try {
    localStorage.setItem(CHAVE_PESQUISA_WEB_IA, valorFinal ? "1" : "0");
  } catch {}
  return valorFinal;
}
carregarConfiguracaoComercialCliente().catch(() => {});
const { criarModuloPainelIA } = require("./renderer-modules/painel-ia.js");
const moduloPainelIA = criarModuloPainelIA({
  ipcRenderer,
  document,
  window,
  localStorage,
  conversas,
  obterConversaAtual: () => conversaAtual,
  obterModoIAAtual: () => modoIAAtual,
  definirModoIAAtual: (valor) => {
    modoIAAtual = valor;
  },
  diagnosticoSegundoPlanoIA,
  cancelarSugestaoIAEmAndamento,
  cancelarRespostaAutomaticaIAEmAndamento,
  limparRespostaAutomaticaPendente,
  tentarAgendarRespostaAutomaticaPendente,
  agendarSugestaoIA,
  desarquivarLocalmenteAoEnviar,
  restaurarArquivamentoLocalSeFalhar,
});
const {
  normalizarSugestoesIA,
  sugestoesIACompletas,
  obterModoIAConversa,
  salvarModoIAConversa,
  obterSegundoPlanoIAConversa,
  salvarSegundoPlanoIAConversa,
  obterSugestaoIACache,
  salvarSugestaoIACache,
  definirContextoSugestaoIA,
  mostrarEstadoPainelIA,
  definirGerandoPainelIA,
  exibirSugestoesIA,
  exibirRespostaUnicaIA,
  atualizarControleSegundoPlanoIA,
  atualizarBotoesModoIA,
  aplicarModoIA,
  inicializarEventosPainelIA,
  inicializarControleSegundoPlanoIA,
} = moduloPainelIA;
let timerSugestaoIA = null;
let tokenSugestaoIA = 0;
let gerandoSugestaoIA = false;
const timersRespostaAutomaticaIA = new Map();
const tokensRespostaAutomaticaIA = new Map();
const respostasAutomaticasEmGeracao = new Set();
const respostasAutomaticasProcessadas = new Map();
const respostasAutomaticasPendentes = new Map();
const entradasCurtasIAPorConversa = new Map();
const pendenciasClimaIAPorConversa = new Map();
const ultimaRotaRespostaIAPorConversa = new Map();
const locaisClimaIAPorConversa = new Map();
function registrarUltimaRotaRespostaIA(conversaId, rota) {
  const id = String(conversaId || "").trim();
  const valor = String(rota || "").trim();
  if (!id || !valor) {
    return;
  }
  ultimaRotaRespostaIAPorConversa.set(id, {
    rota: valor,
    atualizadoEm: Date.now(),
  });
}
function obterUltimaRotaRespostaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id) {
    return "";
  }
  const registro = ultimaRotaRespostaIAPorConversa.get(id);
  if (!registro) {
    return "";
  }
  if (Date.now() - Number(registro.atualizadoEm || 0) > 2 * 60 * 60 * 1000) {
    ultimaRotaRespostaIAPorConversa.delete(id);
    return "";
  }
  return String(registro.rota || "").trim();
}
function registrarLocalClimaIA(conversaId, local) {
  const id = String(conversaId || "").trim();
  const valor = String(local || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!id || !valor) {
    return;
  }
  locaisClimaIAPorConversa.set(id, {
    local: valor.slice(0, 100),
    atualizadoEm: Date.now(),
  });
}
function obterLocalClimaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id) {
    return "";
  }
  const registro = locaisClimaIAPorConversa.get(id);
  if (!registro) {
    return "";
  }
  if (Date.now() - Number(registro.atualizadoEm || 0) > 6 * 60 * 60 * 1000) {
    locaisClimaIAPorConversa.delete(id);
    return "";
  }
  return String(registro.local || "").trim();
}
const JANELA_SEQUENCIA_LETRAS_IA_MS = 30000;
const MINIMO_LETRAS_SEQUENCIA_IA = 3;
function normalizarPerguntaConhecimentoIA(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const PALAVRAS_ISOLADAS_COM_SENTIDO_IA = new Set([
  "sim",
  "nao",
  "ok",
  "okay",
  "oi",
  "ola",
  "obrigado",
  "obrigada",
  "valeu",
  "certo",
  "beleza",
  "bora",
  "vamos",
  "fechado",
  "fechou",
  "show",
  "top",
  "partiu",
  "demorou",
  "combinado",
  "perfeito",
  "tranquilo",
  "blz",
  "aham",
  "uhum",
  "pode",
  "quero",
  "manda",
  "envia",
  "qual",
  "quais",
  "quem",
  "onde",
  "quando",
  "quanto",
  "quantos",
  "quantas",
  "como",
  "porque",
  "talvez",
  "depois",
  "hoje",
  "amanha",
  "ontem",
  "aqui",
  "ali",
  "la",
]);
function obterMensagemAnteriorParaEntradaCurtaIA(conversa, mensagemAtual) {
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  for (let i = indiceAtual - 1; i >= 0; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const texto = String(msg.texto || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!texto) {
      continue;
    }
    return {
      msg,
      texto,
    };
  }
  return null;
}
function ehContinuacaoConversacionalCurtaIA(conversa, mensagemAtual) {
  const textoOriginal = String(mensagemAtual?.texto || "")
    .replace(/\s+/g, " ")
    .trim();
  const semPontuacao = textoOriginal.replace(/[?!.,;:…]+$/g, "").trim();
  // Numeros e letras soltas continuam seguindo as regras economicas antigas.
  if (!/^\p{L}{2,18}$/u.test(semPontuacao)) {
    return false;
  }
  const normalizada = normalizarPalavraCurtaIA(semPontuacao);
  if (PALAVRAS_ISOLADAS_COM_SENTIDO_IA.has(normalizada)) {
    return true;
  }
  const anterior = obterMensagemAnteriorParaEntradaCurtaIA(
    conversa,
    mensagemAtual,
  );
  if (!anterior?.msg?.minha) {
    return false;
  }
  const timestampAtual = Number(mensagemAtual?.timestamp || 0) || 0;
  const timestampAnterior = Number(anterior.msg?.timestamp || 0) || 0;
  if (timestampAtual && timestampAnterior) {
    const diferencaMs = Math.abs(timestampAtual - timestampAnterior) * 1000;
    if (diferencaMs > 3 * 60 * 1000) {
      return false;
    }
  }
  const textoAnteriorNormalizado = normalizarPerguntaConhecimentoIA(
    anterior.texto,
  );
  const perguntaDireta = /[?]\s*$/.test(anterior.texto);
  const conviteOuPedido =
    /\b(bora|quer|queres|posso|vamos|topa|manda|envio|enviar|te passo|te mando|quer que|pode ser)\b/.test(
      textoAnteriorNormalizado,
    );
  return perguntaDireta || conviteOuPedido;
}
function normalizarPalavraCurtaIA(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function ehSaudacaoOuDespedidaCurtaIA(valor) {
  const texto = normalizarPalavraCurtaIA(valor);

  if (!texto || texto.includes(" ")) {
    return false;
  }

  return /^(?:o+i+e*|ola+|opa+|e+a+i+|e+a+e+|alo+|salve+|fala(?:e|i)?|yo+|tch+a+u+|ch+a+u+|x+a+u+|adeus+|ate+|falou+|falows?|flw+|fui+|bye+|goodbye+|hi+|hey+|hello+)$/.test(
    texto,
  );
}
function classificarEntradaCurtaIA(valor) {
  const texto = String(valor || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!texto) {
    return {
      tipo: "ignorar",
      texto: "",
    };
  }
  const semPontuacaoFinal = texto.replace(/[?!.,;:…]+$/g, "").trim();
  if (!semPontuacaoFinal) {
    return {
      tipo: "ignorar",
      texto,
    };
  }
  if (/^\d+(?:[.,]\d+)?$/.test(semPontuacaoFinal)) {
    return {
      tipo: "ignorar",
      texto,
    };
  }
  if (/^\p{L}$/u.test(semPontuacaoFinal)) {
    return {
      tipo: "letra",
      texto: semPontuacaoFinal,
    };
  }
  if (/^[^\p{L}\p{N}]+$/u.test(semPontuacaoFinal)) {
    return {
      tipo: "ignorar",
      texto,
    };
  }
  if (/^\p{L}+$/u.test(semPontuacaoFinal)) {
    const normalizada = normalizarPalavraCurtaIA(semPontuacaoFinal);
    if (
      semPontuacaoFinal.length <= 18 &&
      !PALAVRAS_ISOLADAS_COM_SENTIDO_IA.has(normalizada) &&
      !ehSaudacaoOuDespedidaCurtaIA(semPontuacaoFinal)
    ) {
      return {
        tipo: "ignorar",
        texto,
      };
    }
  }
  return {
    tipo: "normal",
    texto,
  };
}
function limparEntradaCurtaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (id) {
    entradasCurtasIAPorConversa.delete(id);
  }
}
function obterSequenciaLetrasRecentesIA(conversa, mensagemAtual) {
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = -1;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  if (indiceAtual < 0) {
    return [];
  }
  const letrasReverso = [];
  let timestampMaisRecente = null;
  for (let i = indiceAtual; i >= 0; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.minha || msg.apagadaParaTodos || msg.tipo === "apagada") {
      break;
    }
    const classificacao = classificarEntradaCurtaIA(msg.texto);
    if (classificacao.tipo !== "letra") {
      break;
    }
    const timestampAtual = Number(msg.timestamp || 0) || 0;
    if (
      timestampMaisRecente &&
      timestampAtual &&
      Math.abs(timestampMaisRecente - timestampAtual) * 1000 >
        JANELA_SEQUENCIA_LETRAS_IA_MS
    ) {
      break;
    }
    letrasReverso.push(classificacao.texto);
    timestampMaisRecente = timestampAtual || timestampMaisRecente;
    if (letrasReverso.length >= 12) {
      break;
    }
  }
  return letrasReverso.reverse();
}
function registrarEntradaCurtaIA(conversa, mensagemAtual) {
  const conversaId = String(conversa?.id || "").trim();
  if (!conversaId || !mensagemAtual || mensagemAtual.minha) {
    return {
      aguardar: false,
      agrupada: false,
      textoEfetivo: String(mensagemAtual?.texto || "").trim(),
    };
  }
  if (
    mensagemAtual.tipo === "imagem" ||
    mensagemAtual.tipo === "audio" ||
    mensagemSuportaLeituraDocumentoIA(mensagemAtual) ||
    (mensagemAtual.tipo === "view_once" &&
      mensagemAtual.viewOnceKind === "imagem")
  ) {
    entradasCurtasIAPorConversa.delete(conversaId);
    return {
      aguardar: false,
      agrupada: false,
      textoEfetivo: String(mensagemAtual?.texto || "").trim(),
    };
  }
  const classificacao = classificarEntradaCurtaIA(mensagemAtual.texto);
  if (classificacao.tipo === "letra") {
    const letras = obterSequenciaLetrasRecentesIA(conversa, mensagemAtual);
    const textoAgrupado = letras.join("");
    const pronta = letras.length >= MINIMO_LETRAS_SEQUENCIA_IA;
    if (pronta) {
      entradasCurtasIAPorConversa.set(conversaId, {
        tipo: "letras",
        baseId: chaveBaseSugestaoIA(conversa, mensagemAtual),
        textoAgrupado,
        pronta: true,
        atualizadoEm: Date.now(),
      });
    } else {
      entradasCurtasIAPorConversa.delete(conversaId);
    }
    return {
      aguardar: !pronta,
      agrupada: pronta,
      textoEfetivo: pronta ? textoAgrupado : classificacao.texto,
    };
  }
  if (classificacao.tipo === "ignorar") {
    entradasCurtasIAPorConversa.delete(conversaId);
    if (ehContinuacaoConversacionalCurtaIA(conversa, mensagemAtual)) {
      return {
        aguardar: false,
        agrupada: false,
        textoEfetivo: classificacao.texto,
      };
    }
    return {
      aguardar: true,
      agrupada: false,
      textoEfetivo: classificacao.texto,
    };
  }
  entradasCurtasIAPorConversa.delete(conversaId);
  return {
    aguardar: false,
    agrupada: false,
    textoEfetivo: classificacao.texto,
  };
}
function obterEstadoEntradaCurtaIA(conversa, mensagemAtual) {
  const textoOriginal = String(mensagemAtual?.texto || "").trim();
  if (!conversa || !mensagemAtual) {
    return {
      aguardar: false,
      agrupada: false,
      textoEfetivo: textoOriginal,
    };
  }
  if (
    mensagemAtual.tipo === "imagem" ||
    mensagemAtual.tipo === "audio" ||
    mensagemSuportaLeituraDocumentoIA(mensagemAtual) ||
    (mensagemAtual.tipo === "view_once" &&
      mensagemAtual.viewOnceKind === "imagem")
  ) {
    return {
      aguardar: false,
      agrupada: false,
      textoEfetivo: textoOriginal,
    };
  }
  const classificacao = classificarEntradaCurtaIA(textoOriginal);
  if (classificacao.tipo === "letra") {
    const letras = obterSequenciaLetrasRecentesIA(conversa, mensagemAtual);
    const textoAgrupado = letras.join("");
    const pronta = letras.length >= MINIMO_LETRAS_SEQUENCIA_IA;
    return {
      aguardar: !pronta,
      agrupada: pronta,
      textoEfetivo: pronta ? textoAgrupado : textoOriginal,
    };
  }
  if (classificacao.tipo === "ignorar") {
    if (ehContinuacaoConversacionalCurtaIA(conversa, mensagemAtual)) {
      return {
        aguardar: false,
        agrupada: false,
        textoEfetivo: textoOriginal,
      };
    }
    return {
      aguardar: true,
      agrupada: false,
      textoEfetivo: textoOriginal,
    };
  }
  return {
    aguardar: false,
    agrupada: false,
    textoEfetivo: textoOriginal,
  };
}
function ehNumeroIsoladoContextoIA(valor) {
  const texto = String(valor || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!;:…]+$/g, "")
    .trim();
  return /^[+-]?\d+(?:[.,]\d+)?$/.test(texto);
}
function ehLetraUnicaContextoIA(valor) {
  const texto = String(valor || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?!.,;:…]+$/g, "")
    .trim();
  return /^\p{L}$/u.test(texto);
}
function obterMensagemAnteriorTextoContextoIA(lista, indice) {
  for (let i = indice - 1; i >= 0 && i >= indice - 8; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const texto = String(msg.texto || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!texto) {
      continue;
    }
    return {
      msg,
      texto,
      indice: i,
    };
  }
  return null;
}
function fraseEsperaComplementoNumericoIA(valor) {
  const original = String(valor || "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !original ||
    original.includes("?") ||
    ehNumeroIsoladoContextoIA(original)
  ) {
    return false;
  }
  const texto = normalizarPerguntaConhecimentoIA(original);
  if (!texto) {
    return false;
  }
  const terminaComCampo =
    /\b(idade|numero|valor|preco|quantidade|nota|tamanho|peso|altura|distancia|velocidade|ano|dia|mes|hora|horario|cep|cpf|rg|telefone|placa|codigo)\s*(?:e|eh|foi|fica|ficou|deu|da|de|:|=)?$/.test(
      texto,
    );
  const terminaComExpressaoIncompleta =
    /\b(e|eh|sao|foi|fica|ficou|deu|custa|custou|vale|totaliza|tenho|tem|quero|preciso|comprei|peguei|levei|foram|da|de|por|uns|umas)\s*$/.test(
      texto,
    );
  const terminaComSeparador = /[:=]\s*$/.test(original);
  return (
    terminaComCampo || terminaComExpressaoIncompleta || terminaComSeparador
  );
}
function obterComplementoNumericoMesmaPessoaIA(lista, indice) {
  const atual = lista[indice];
  const anterior = obterMensagemAnteriorTextoContextoIA(lista, indice);
  if (
    !atual ||
    !anterior?.msg ||
    anterior.msg.minha !== atual.minha ||
    ehNumeroIsoladoContextoIA(anterior.texto) ||
    !fraseEsperaComplementoNumericoIA(anterior.texto)
  ) {
    return null;
  }
  if (!mesmaSequenciaMicroIA(atual, anterior.msg, 90000)) {
    return null;
  }
  return {
    indiceAnterior: anterior.indice,
    textoAnterior: anterior.texto,
  };
}
function mensagemEhInicioDeComplementoNumericoIA(lista, indice) {
  const msg = lista[indice];
  const proxima = lista[indice + 1];
  if (
    !msg ||
    !proxima ||
    msg.minha !== proxima.minha ||
    !ehNumeroIsoladoContextoIA(proxima.texto) ||
    !fraseEsperaComplementoNumericoIA(msg.texto)
  ) {
    return false;
  }
  const complemento = obterComplementoNumericoMesmaPessoaIA(lista, indice + 1);
  return complemento?.indiceAnterior === indice;
}
function numeroIsoladoTemContextoIA(lista, indice) {
  const atual = lista[indice];
  const anterior = obterMensagemAnteriorTextoContextoIA(lista, indice);
  if (!atual || !anterior?.msg) {
    return false;
  }
  if (anterior.msg.minha === atual.minha) {
    return !!obterComplementoNumericoMesmaPessoaIA(lista, indice);
  }
  const texto = normalizarPerguntaConhecimentoIA(anterior.texto);
  if (!texto) {
    return false;
  }
  const parecePergunta =
    anterior.texto.includes("?") ||
    /^(quanto|quantos|quantas|qual|que|me diz|me fala|informa|diz)\b/.test(
      texto,
    );
  if (!parecePergunta) {
    return false;
  }
  return (
    /\b(quanto|quantos|quantas|idade|numero|valor|preco|dia|mes|ano|hora|horario|quantidade|nota|escala|tamanho|peso|altura|distancia|velocidade|codigo|cep|cpf|rg|telefone|placa)\b/.test(
      texto,
    ) || /\b(?:de|entre)\s+\d+\s+(?:a|e)\s+\d+\b/.test(texto)
  );
}
function letraUnicaTemContextoIA(lista, indice) {
  const atual = lista[indice];
  const anterior = obterMensagemAnteriorTextoContextoIA(lista, indice);
  if (!atual || !anterior?.msg || anterior.msg.minha === atual.minha) {
    return false;
  }
  const texto = normalizarPerguntaConhecimentoIA(anterior.texto);
  if (!texto) {
    return false;
  }
  const parecePergunta =
    anterior.texto.includes("?") ||
    /\b(escolhe|escolha|responda|opcao|alternativa)\b/.test(texto);
  if (!parecePergunta) {
    return false;
  }
  return (
    /\b(opcao|alternativa|letra|sim ou nao|s ou n)\b/.test(texto) ||
    /\b[a-z]\s*(?:ou|\/)\s*[a-z]\b/.test(texto)
  );
}
function mesmaSequenciaMicroIA(msgA, msgB, limiteMs = 30000) {
  if (!msgA || !msgB || !!msgA.minha !== !!msgB.minha) {
    return false;
  }
  const a = Number(msgA.timestamp || 0) || 0;
  const b = Number(msgB.timestamp || 0) || 0;
  if (!a || !b) {
    return true;
  }
  return Math.abs(a - b) * 1000 <= limiteMs;
}
function obterSequenciaLetrasContextoIA(lista, indice) {
  const atual = lista[indice];
  if (!atual || !ehLetraUnicaContextoIA(atual.texto)) {
    return null;
  }
  const proxima = lista[indice + 1];
  if (
    proxima &&
    ehLetraUnicaContextoIA(proxima.texto) &&
    mesmaSequenciaMicroIA(atual, proxima)
  ) {
    return {
      ultima: false,
      letras: [],
    };
  }
  const letrasReverso = [];
  for (let i = indice; i >= 0 && letrasReverso.length < 12; i -= 1) {
    const msg = lista[i];
    if (
      !msg ||
      !ehLetraUnicaContextoIA(msg.texto) ||
      !mesmaSequenciaMicroIA(atual, msg)
    ) {
      break;
    }
    letrasReverso.push(
      String(msg.texto || "")
        .replace(/[?!.,;:…]+$/g, "")
        .trim(),
    );
  }
  return {
    ultima: true,
    letras: letrasReverso.reverse(),
  };
}
function obterSequenciaNumerosContextoIA(lista, indice) {
  const atual = lista[indice];
  if (!atual || !ehNumeroIsoladoContextoIA(atual.texto)) {
    return null;
  }
  const proxima = lista[indice + 1];
  if (
    proxima &&
    ehNumeroIsoladoContextoIA(proxima.texto) &&
    mesmaSequenciaMicroIA(atual, proxima, 90000)
  ) {
    return {
      ultima: false,
      quantidade: 0,
    };
  }
  let quantidade = 0;
  for (let i = indice; i >= 0 && quantidade < 100; i -= 1) {
    const msg = lista[i];
    if (
      !msg ||
      !ehNumeroIsoladoContextoIA(msg.texto) ||
      !mesmaSequenciaMicroIA(atual, msg, 90000)
    ) {
      break;
    }
    if (numeroIsoladoTemContextoIA(lista, i)) {
      break;
    }
    quantidade += 1;
  }
  return {
    ultima: true,
    quantidade,
  };
}
function obterTextoMensagemParaContextoIA(lista, indice) {
  const msg = lista[indice];
  if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
    return "";
  }
  const texto = String(msg.texto || "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    msg.tipo === "imagem" ||
    (msg.tipo === "view_once" && msg.viewOnceKind === "imagem")
  ) {
    return montarTextoMensagemComContextoVisualIA(msg, texto);
  }
  if (msg.tipo === "audio") {
    return montarTextoMensagemComTranscricaoAudioIA(msg, texto);
  }
  if (mensagemSuportaLeituraDocumentoIA(msg)) {
    return montarTextoMensagemComContextoDocumentoIA(msg, texto);
  }
  if (!texto) {
    return "";
  }
  if (mensagemEhInicioDeComplementoNumericoIA(lista, indice)) {
    return "";
  }
  if (ehLetraUnicaContextoIA(texto)) {
    const sequencia = obterSequenciaLetrasContextoIA(lista, indice);
    if (!sequencia?.ultima) {
      return "";
    }
    if (sequencia.letras.length >= MINIMO_LETRAS_SEQUENCIA_IA) {
      return sequencia.letras.join("");
    }
    return letraUnicaTemContextoIA(lista, indice) ? texto : "";
  }
  if (ehNumeroIsoladoContextoIA(texto)) {
    const complementoMesmaPessoa = obterComplementoNumericoMesmaPessoaIA(
      lista,
      indice,
    );
    if (complementoMesmaPessoa) {
      return `${complementoMesmaPessoa.textoAnterior} ${texto}`.trim();
    }
    if (numeroIsoladoTemContextoIA(lista, indice)) {
      return texto;
    }
    const sequencia = obterSequenciaNumerosContextoIA(lista, indice);
    if (!sequencia?.ultima) {
      return "";
    }
    if (sequencia.quantidade >= 2) {
      return "[sequencia de numeros isolados]";
    }
    return "";
  }
  return texto;
}
function ehContinuacaoFactualCurtaIA(
  conversa,
  mensagemAtual,
  textoEfetivo = mensagemAtual?.texto,
) {
  const texto = normalizarPerguntaConhecimentoIA(textoEfetivo);
  if (
    !texto ||
    texto.split(" ").length > 5 ||
    !/^(e )?(qual|quais|quem|onde|quando|quanto|quantos|quantas|como)\b/.test(
      texto,
    )
  ) {
    return false;
  }
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  const configuracao = obterConfiguracaoNivelContextoIA();
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  let mensagensTextoVistas = 0;
  for (
    let i = indiceAtual - 1;
    i >= 0 && mensagensTextoVistas < configuracao.mensagens;
    i -= 1
  ) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const textoAnterior = obterTextoMensagemParaContextoIA(lista, i);
    if (!textoAnterior) {
      continue;
    }
    mensagensTextoVistas += 1;
    if (
      !msg.minha &&
      ehPerguntaConhecimentoGeralIA(textoAnterior) &&
      !perguntaPedeMemoriaHistoricaIA(textoAnterior)
    ) {
      return true;
    }
  }
  return false;
}
function montarContextoContinuacaoFactualCurtaIA(conversa, mensagemAtual) {
  const configuracao = obterConfiguracaoNivelContextoIA();
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  let indiceAncora = -1;
  let mensagensTextoVistas = 0;
  for (
    let i = indiceAtual - 1;
    i >= 0 && mensagensTextoVistas < configuracao.mensagens;
    i -= 1
  ) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const textoAnterior = obterTextoMensagemParaContextoIA(lista, i);
    if (!textoAnterior) {
      continue;
    }
    mensagensTextoVistas += 1;
    if (
      !msg.minha &&
      ehPerguntaConhecimentoGeralIA(textoAnterior) &&
      !perguntaPedeMemoriaHistoricaIA(textoAnterior)
    ) {
      indiceAncora = i;
      break;
    }
  }
  if (indiceAncora < 0) {
    return montarContextoFactualAssistidoIA(conversa, mensagemAtual);
  }
  const contexto = [];
  for (let i = indiceAncora; i < indiceAtual; i += 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const conteudo = obterTextoMensagemParaContextoIA(lista, i);
    if (!conteudo) {
      continue;
    }
    contexto.push({
      role: msg.minha ? "assistant" : "user",
      content: conteudo.slice(0, 700),
    });
  }
  return contexto.slice(-configuracao.mensagens);
}
function ehReferenciaExplicitaDocumentoIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto) {
    return false;
  }
  return /\b(pdf|documento|arquivo|anexo)\b/.test(texto);
}
function ehPedidoExplicitoPesquisaWebIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto) {
    return false;
  }
  return /\b(pesquisa|pesquisar|pesquise|procura|procurar|procure|busca|buscar|busque|consulta|consultar|consulte|olha na internet|olhe na internet|ve na internet|ver na internet|ache na internet|acha na internet|manda o link|me manda o link|tem link|qual o link)\b/.test(
    texto,
  );
}
function ehConsultaMeteorologicaAtualIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto) {
    return false;
  }
  const temaMeteorologico =
    /\b(clima|tempo|chuva|chover|chove|chovendo|temperatura|frio|calor|graus|vento|ventando|umidade|tempestade|temporal|granizo|neve|previsao)\b/.test(
      texto,
    );
  const referenciaTemporal =
    /\b(hoje|amanha|agora|mais tarde|essa noite|esta noite|depois de amanha|fim de semana|sabado|domingo|segunda|terca|quarta|quinta|sexta|esta semana|essa semana|semana que vem|proxima semana|proximos dias|proximas horas|proximos dias|proximas semanas|daqui a (?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete) (?:hora|horas|dia|dias|semana|semanas)|vai|vai estar|vai fazer|previsao)\b/.test(
      texto,
    );
  return temaMeteorologico && referenciaTemporal;
}
function extrairLocalizacaoMeteorologicaExplicitaIA(valor) {
  const texto = String(valor || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!texto) {
    return "";
  }
  const padroes = [
    /\b(?:aqui\s+)?em\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,70}?)(?=[?!.;,]|$)/i,
    /\b(?:na cidade de|no municipio de|no município de)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,70}?)(?=[?!.;,]|$)/i,
  ];
  for (const padrao of padroes) {
    const match = texto.match(padrao);
    const local = String(match?.[1] || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!local) {
      continue;
    }
    const normalizado = normalizarPerguntaConhecimentoIA(local);
    if (
      !normalizado ||
      /^(casa|minha casa|aqui|minha cidade|cidade|algum lugar|qualquer lugar)$/.test(
        normalizado,
      )
    ) {
      continue;
    }
    return local;
  }
  return "";
}
function extrairLocalizacaoMeteorologicaRecenteIA(conversa, mensagemAtual) {
  const direta = extrairLocalizacaoMeteorologicaExplicitaIA(
    mensagemAtual?.texto,
  );
  if (direta) {
    return direta;
  }
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  let vistas = 0;
  for (let i = indiceAtual - 1; i >= 0 && vistas < 6; i -= 1) {
    const msg = lista[i];
    const anterior = obterTextoMensagemParaContextoIA(lista, i);
    if (!msg || !anterior) {
      continue;
    }
    vistas += 1;
    const match = String(anterior).match(
      /\b(?:estou|to|tô|estamos|moramos|moro|fico|ficamos|aqui)\s+(?:em|no|na)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,70}?)(?=[?!.;,]|$)/i,
    );
    const local = String(match?.[1] || "")
      .replace(/\s+/g, " ")
      .trim();
    if (local) {
      return local;
    }
  }
  return "";
}
function registrarPendenciaClimaIA(conversaId, perguntaOriginal) {
  const id = String(conversaId || "").trim();
  const pergunta = String(perguntaOriginal || "").trim();
  if (!id || !pergunta) {
    return;
  }
  pendenciasClimaIAPorConversa.set(id, {
    pergunta,
    criadaEm: Date.now(),
  });
  diagnosticoPesquisaWebIA("CLIMA_AGUARDANDO_LOCAL", {
    id,
    perguntaChars: pergunta.length,
  });
}
function obterPendenciaClimaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id) {
    return null;
  }
  const pendencia = pendenciasClimaIAPorConversa.get(id);
  if (!pendencia) {
    return null;
  }
  if (Date.now() - Number(pendencia.criadaEm || 0) > 30 * 60 * 1000) {
    pendenciasClimaIAPorConversa.delete(id);
    return null;
  }
  return pendencia;
}
function limparPendenciaClimaIA(conversaId) {
  pendenciasClimaIAPorConversa.delete(String(conversaId || "").trim());
}
function reconstruirPendenciaClimaDaConversaIA(conversa, mensagemAtual) {
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  if (!lista.length || !mensagemAtual) {
    return null;
  }
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  let encontrouPedidoLocal = false;
  let mensagensVistas = 0;
  for (let i = indiceAtual - 1; i >= 0 && mensagensVistas < 6; i -= 1) {
    const msg = lista[i];
    const texto = obterTextoMensagemParaContextoIA(lista, i);
    if (!msg || !texto) {
      continue;
    }
    mensagensVistas += 1;
    if (!encontrouPedidoLocal) {
      const normalizado = normalizarPerguntaConhecimentoIA(texto);
      if (
        msg.minha &&
        /^(em que cidade tu ta|em qual cidade tu ta|qual cidade|em que cidade voce esta|em qual cidade voce esta)$/.test(
          normalizado,
        )
      ) {
        encontrouPedidoLocal = true;
        continue;
      }
      return null;
    }
    if (!msg.minha && ehConsultaMeteorologicaAtualIA(texto)) {
      const pendencia = {
        pergunta: String(texto).trim(),
        criadaEm: Date.now(),
        reconstruida: true,
      };
      diagnosticoPesquisaWebIA("CLIMA_PENDENCIA_RECONSTRUIDA", {
        perguntaChars: pendencia.pergunta.length,
      });
      return pendencia;
    }
  }
  return null;
}
function ehRespostaProvavelLocalizacaoClimaIA(valor) {
  const original = String(valor || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!original || original.length > 80) {
    return false;
  }
  const texto = normalizarPerguntaConhecimentoIA(original);
  const palavras = texto.split(/\s+/).filter(Boolean);
  if (!palavras.length || palavras.length > 7) {
    return false;
  }
  if (
    /^(sim|nao|talvez|acho que sim|acho que nao|sei la|ok|beleza|blz|valeu|obrigado|obrigada)$/.test(
      texto,
    )
  ) {
    return false;
  }
  return (
    /^[A-Za-zÀ-ÿ0-9.' ,\/-]+$/.test(original) && /[A-Za-zÀ-ÿ]/.test(original)
  );
}
function montarConsultaClimaComLocalIA(perguntaOriginal, local) {
  const pergunta = String(perguntaOriginal || "").trim();
  const cidade = String(local || "").trim();
  return `${pergunta}\nLocal informado para a previsao: ${cidade}`;
}
function ehConsultaWebEspecificaIA(
  conversa,
  mensagemAtual,
  textoEfetivo = mensagemAtual?.texto,
) {
  const texto = normalizarPerguntaConhecimentoIA(textoEfetivo);
  if (!texto) {
    return false;
  }
  const pedidoExplicito = ehPedidoExplicitoPesquisaWebIA(textoEfetivo);
  const marcadorTemporalAtual =
    /\b(hoje|agora|atual|atualmente|atualizado|atualizada|mais recente|ultimo|ultima|ultimos|ultimas)\b/.test(
      texto,
    );
  const assuntoNaturalmenteAtualizavel =
    /\b(cotacao|cambio|dolar|euro|moeda|taxa|juros|inflacao|ibovespa|bitcoin|cripto|placar|resultado|noticia|noticias|presidente|governador|prefeito|ministro|ministra|ceo)\b/.test(
      texto,
    );
  // "Disponivel" sozinho e ambiguo, por exemplo "voce esta disponivel hoje?".
  // So tratamos disponibilidade como sinal de web quando existe contexto
  // comercial claro. Estoque, por si so, ja e um sinal comercial suficiente.
  const disponibilidadeComercial =
    /\bestoque\b/.test(texto) ||
    /\b(?:produto|produtos|item|itens|modelo|modelos|peca|pecas|loja|lojas|venda|comprar|compra)\b.{0,45}\b(?:disponivel|disponiveis|disponibilidade)\b/.test(
      texto,
    ) ||
    /\b(?:disponivel|disponiveis|disponibilidade)\b.{0,45}\b(?:produto|produtos|item|itens|modelo|modelos|peca|pecas|loja|lojas|venda|comprar|compra)\b/.test(
      texto,
    );
  const sinalWebDinamico =
    /\b(cotacao|previsao|placar|resultado agora|noticia|noticias|lancamento|lancou)\b/.test(
      texto,
    ) || disponibilidadeComercial;
  const indicadorFinanceiroAtual =
    /\b(faturamento|receita|lucro|prejuizo|ebitda|dividendo|dividendos|balanco|resultados? trimestrais?)\b/.test(
      texto,
    ) &&
    (marcadorTemporalAtual ||
      /\b(empresa|companhia|acao|acoes|trimestre|semestre|exercicio|ano fiscal|[1-4]t\s*\d{2,4}|[1-4]q\s*\d{2,4})\b/.test(
        texto,
      ));
  const informacaoAtual =
    sinalWebDinamico ||
    indicadorFinanceiroAtual ||
    (marcadorTemporalAtual && assuntoNaturalmenteAtualizavel);
  const precoOuCompra =
    /\b(preco|precos|valor|valores|quanto custa|quanto ta|quanto esta|por quanto|onde comprar|onde vende|loja|lojas|promocao|oferta|frete)\b/.test(
      texto,
    );
  const consultaMeteorologicaAtual =
    ehConsultaMeteorologicaAtualIA(textoEfetivo);
  if (
    pedidoExplicito ||
    informacaoAtual ||
    precoOuCompra ||
    consultaMeteorologicaAtual
  ) {
    return true;
  }
  const curtaDependente =
    texto.split(" ").length <= 7 &&
    /^(e |mas |entao )?(quanto|qual valor|e ai|achou|conseguiu|tem link|onde vende|onde compra|e o preco|e quanto e)\b/.test(
      texto,
    );
  if (!curtaDependente) {
    return false;
  }
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  let vistas = 0;
  for (let i = indiceAtual - 1; i >= 0 && vistas < 8; i -= 1) {
    const msg = lista[i];
    const anterior = obterTextoMensagemParaContextoIA(lista, i);
    if (!msg || !anterior) {
      continue;
    }
    vistas += 1;
    const normalizado = normalizarPerguntaConhecimentoIA(anterior);
    if (
      /\b(preco|valor|quanto custa|comprar|vende|loja|produto|peca|pecas|bateria|modelo|moto|carro|celular|notebook|iphone|macbook|cotacao|estoque|disponivel|pesquisa|internet|link)\b/.test(
        normalizado,
      )
    ) {
      return true;
    }
  }
  return false;
}
function ehContinuacaoPesquisaWebRoteamentoIA(
  conversa,
  mensagemAtual,
  textoEfetivo = mensagemAtual?.texto,
) {
  const texto = normalizarPerguntaConhecimentoIA(textoEfetivo);
  if (!texto || texto.length > 260) {
    return false;
  }
  const palavras = texto.split(/\s+/).filter(Boolean);
  const rotaAnteriorConhecida = obterUltimaRotaRespostaIA(conversa?.id);
  if (rotaAnteriorConhecida && rotaAnteriorConhecida !== "web") {
    return false;
  }
  // Referencias nomeadas a um dado vindo da pesquisa anterior precisam manter
  // a rota web mesmo quando a frase passa do limite de 12 palavras. Ex.:
  // "Considerando essa cotacao, quanto seria...". Sem isso, um valor em R$
  // pode coincidir com um preco do catalogo e sequestrar a continuacao web.
  const referenciaNomeadaPesquisaAnterior =
    /\b(?:essa mesma|esse mesmo|esta mesma|este mesmo|aquela mesma|aquele mesmo|essa|esse|esta|este|aquela|aquele|nessa|nesse|nesta|neste|naquela|naquele|a)\s+(?:cotacao|taxa|cambio|previsao|noticia|informacao|resultado|placar|valor|preco|dados)\b/.test(
      texto,
    );
  if (rotaAnteriorConhecida === "web" && referenciaNomeadaPesquisaAnterior) {
    return true;
  }
  if (palavras.length > 12) {
    return false;
  }
  const temConectorDeContinuidade =
    /^(e |mas |entao |e ai |nesse caso |e nesse caso )/.test(texto);
  const temReferenciaAoAssuntoAnterior =
    /\b(ele|ela|eles|elas|isso|nisso|disso|desse|dessa|dele|dela|la|ali)\b/.test(
      texto,
    );
  // Perguntas factuais completas, com assunto proprio, iniciam um novo tema.
  // Ex.: "Qual a capital da Argentina?" nao deve herdar uma pesquisa web anterior.
  if (
    ehPerguntaConhecimentoGeralIA(textoEfetivo) &&
    !perguntaFactualDependeDoContextoIA(textoEfetivo) &&
    !temConectorDeContinuidade &&
    !temReferenciaAoAssuntoAnterior
  ) {
    return false;
  }
  const perguntaElipticaCurta =
    palavras.length <= 8 &&
    /^(?:quanto|qual valor|onde|quando|e quanto|e qual|e onde|e quando)\b/.test(
      texto,
    );
  const pareceDependente =
    temConectorDeContinuidade ||
    temReferenciaAoAssuntoAnterior ||
    perguntaElipticaCurta;
  if (!pareceDependente) {
    return false;
  }
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  let mensagensAnterioresVistas = 0;
  for (
    let i = indiceAtual - 1;
    i >= 0 && mensagensAnterioresVistas < 6;
    i -= 1
  ) {
    const msg = lista[i];
    if (!msg || msg.minha || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const anterior = obterTextoMensagemParaContextoIA(lista, i);
    if (!anterior) {
      continue;
    }
    mensagensAnterioresVistas += 1;
    if (
      ehPedidoExplicitoPesquisaWebIA(anterior) ||
      ehConsultaWebEspecificaIA(conversa, msg, anterior)
    ) {
      return true;
    }
    // Se encontramos outra pergunta factual independente antes de uma rota web,
    // nao carregamos uma pesquisa antiga para um assunto novo.
    if (
      ehPerguntaConhecimentoGeralIA(anterior) &&
      !perguntaFactualDependeDoContextoIA(anterior)
    ) {
      return false;
    }
  }
  return false;
}
async function resolverFonteRespostaIA({
  conversa,
  mensagemAtual,
  textoEfetivo,
  conversaId,
  respostaLocalClimaPendente = false,
  consultaClimaAtual = false,
} = {}) {
  const texto = String(textoEfetivo || mensagemAtual?.texto || "").trim();
  const id = String(conversaId || conversa?.id || "").trim();
  const pedidoExplicitoPesquisaWeb = ehPedidoExplicitoPesquisaWebIA(texto);
  const factualEstavelSemWeb = ehPerguntaFactualEstavelSemWebIA(texto);
  const rotaAnteriorIA = obterUltimaRotaRespostaIA(id);
  const continuacaoPesquisaWeb =
    !factualEstavelSemWeb &&
    (respostaLocalClimaPendente ||
      ehContinuacaoPesquisaWebRoteamentoIA(conversa, mensagemAtual, texto));
  const consultaWebEspecifica =
    !factualEstavelSemWeb &&
    (respostaLocalClimaPendente ||
      ehConsultaWebEspecificaIA(conversa, mensagemAtual, texto) ||
      continuacaoPesquisaWeb);
  // Precedencia fechada das fontes:
  // 1. pedido explicito de web e clima nao podem ser sequestrados pelo catalogo;
  // 2. continuacao confirmada de web permanece web;
  // 3. match direto forte pode iniciar catalogo a partir de qualquer rota;
  // 4. continuacao de catalogo so existe quando a ultima rota foi catalogo.
  const priorizarWeb =
    pedidoExplicitoPesquisaWeb ||
    respostaLocalClimaPendente ||
    consultaClimaAtual ||
    (continuacaoPesquisaWeb && rotaAnteriorIA === "web");
  let catalogoDiretoRelevante = false;
  let catalogoContinuacaoRelevante = false;
  if (!priorizarWeb) {
    const referenciaCatalogoAnterior =
      rotaAnteriorIA === "catalogo" && ehReferenciaAoContextoAnteriorIA(texto);

    if (referenciaCatalogoAnterior) {
      catalogoContinuacaoRelevante = await catalogoRelevanteParaMensagemIA(
        texto,
        id,
        montarContextoPesquisaWebIA(conversa, mensagemAtual),
      );
    }

    if (!catalogoContinuacaoRelevante) {
      catalogoDiretoRelevante = await catalogoMatchDiretoParaMensagemIA(texto);
    }

    if (
      !catalogoDiretoRelevante &&
      !catalogoContinuacaoRelevante &&
      rotaAnteriorIA === "catalogo"
    ) {
      catalogoContinuacaoRelevante = await catalogoRelevanteParaMensagemIA(
        texto,
        id,
        montarContextoPesquisaWebIA(conversa, mensagemAtual),
      );
    }
  }
  const catalogoRelevante =
    catalogoDiretoRelevante || catalogoContinuacaoRelevante;
  const precisaPesquisaWeb =
    pedidoExplicitoPesquisaWeb ||
    consultaClimaAtual ||
    respostaLocalClimaPendente ||
    (consultaWebEspecifica && !catalogoRelevante);
  const continuacaoFactualCurta = ehContinuacaoFactualCurtaIA(
    conversa,
    mensagemAtual,
    texto,
  );
  const perguntaConhecimentoGeral =
    !precisaPesquisaWeb &&
    !catalogoRelevante &&
    (ehPerguntaConhecimentoGeralIA(texto) || continuacaoFactualCurta) &&
    !perguntaPedeMemoriaHistoricaIA(texto);
  const rotaPretendida = precisaPesquisaWeb
    ? "web"
    : catalogoRelevante
      ? "catalogo"
      : perguntaConhecimentoGeral
        ? "factual"
        : "automatica";
  return {
    pedidoExplicitoPesquisaWeb,
    factualEstavelSemWeb,
    continuacaoPesquisaWeb,
    consultaWebEspecifica,
    rotaAnteriorIA,
    priorizarWeb,
    catalogoDiretoRelevante,
    catalogoContinuacaoRelevante,
    catalogoRelevante,
    catalogoEhContinuacao: catalogoContinuacaoRelevante,
    precisaPesquisaWeb,
    continuacaoFactualCurta,
    perguntaConhecimentoGeral,
    rotaPretendida,
  };
}
function montarContextoPesquisaWebIA(
  conversa,
  mensagemAtual,
  forcarContexto = false,
) {
  const textoAtual = String(mensagemAtual?.texto || "").trim();
  const precisaContexto =
    forcarContexto || perguntaFactualDependeDoContextoIA(textoAtual);
  // Consulta web direta nao precisa carregar a conversa inteira.
  // Quando o roteador ja confirmou que e continuacao web, forcarContexto
  // garante o par minimo anterior e evita enviar follow-up sem referente.
  if (!precisaContexto) {
    return [];
  }
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  const limite = 2;
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  const anteriores = [];
  for (let i = indiceAtual - 1; i >= 0 && anteriores.length < limite; i -= 1) {
    const msg = lista[i];
    const conteudo = obterTextoMensagemParaContextoIA(lista, i);
    if (!msg || !conteudo) {
      continue;
    }
    anteriores.push({
      role: msg.minha ? "assistant" : "user",
      content: conteudo.slice(0, 600),
    });
  }
  return anteriores.reverse();
}
function ehPerguntaConhecimentoGeralIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto) {
    return false;
  }
  // Perguntas pessoais, opinativas ou de decisão continuam com as três opções.
  if (
    /\b(o que (tu|voce) acha|tu acha|voce acha|acha que|prefere|gosta|sente|quer que|devo|devia|faria no meu lugar|qual tua|qual seu|onde tu|onde voce|quando tu|quando voce)\b/.test(
      texto,
    )
  ) {
    return false;
  }
  const inicioFactual =
    /^(quem (foi|e|era)|onde (fica|ficava|nasceu|morreu|se localiza)|quando (foi|aconteceu|nasceu|morreu)|qual(?: e| foi| era| a| o| pais| cidade| capital| moeda| idioma| lingua| populacao| distancia| altura| tamanho| profundidade)|quais |quanto(?:s|as)? |quantos |quantas |em que ano|em qual ano|como se chama|o que (e|foi|era|significa)|quem (inventou|descobriu|criou|fundou|venceu|ganhou)|me (diz|fala) (quem|onde|quando|qual|quais|quanto|quantos|quantas|o que)|sabe (quem|onde|quando|qual|quais|quanto|quantos|quantas|o que)|voce sabe (quem|onde|quando|qual|quais|quanto|quantos|quantas|o que))\b/;
  if (inicioFactual.test(texto)) {
    return true;
  }
  const parecePergunta =
    texto.includes("?") || /^(me diz|me fala|sabe|voce sabe)\b/.test(texto);
  if (!parecePergunta) {
    return false;
  }
  const termosConhecimento =
    /\b(capital|cidade|pais|estado|continente|populacao|habitantes|presidente|rei|rainha|imperador|inventor|descobriu|fundou|nasceu|morreu|ano|data|seculo|moeda|idioma|lingua|rio|lago|oceano|mar|montanha|altura|distancia|profundidade|tamanho|velocidade|temperatura|planeta|estrela|especie|animal|cientifico|copa|guerra|independencia|revolucao|historia|geografia|biologia|quimica|fisica)\b/;
  return termosConhecimento.test(texto);
}
function ehPerguntaPessoalSimplesIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto || texto.length > 320) {
    return false;
  }
  // Perguntas reflexivas/opinativas continuam no fluxo completo, pois podem
  // depender mais do contexto e do estilo recente da conversa.
  if (
    /\b(tu acha|voce acha|acha que|o que (tu|voce) acha|opina|opiniao|filosof|moral|etica|sentido da vida|certo ou errado|bem ou mal|por que as pessoas|porque as pessoas)\b/.test(
      texto,
    )
  ) {
    return false;
  }
  const padroesPessoais = [
    /\bqual (?:e )?(?:a )?(?:sua|tua) (?:personalidade|jeito|estilo|perfil|preferencia|rotina|mania|hobbie|hobby)\b/,
    /\bqual (?:e )?(?:o )?(?:seu|teu) (?:jeito|estilo|perfil|hobbie|hobby)\b/,
    /\b(?:voce|tu) (?:gosta|prefere|costuma|normalmente|geralmente|se considera|e mais|tem costume|faz quando|responde quando)\b/,
    /\bcomo (?:voce|tu) (?:costuma|normalmente|geralmente|reage|responde|age|lida)\b/,
    /\bquando (?:voce|tu) .{0,100}\bcomo (?:voce|tu)?\s*(?:costuma|normalmente|geralmente|responde|age|reage)?\b/,
    /\bo que (?:voce|tu) (?:gosta|prefere|costuma|faz quando)\b/,
    /\b(?:seu|teu|sua|tua) .{0,45}favorit[oa]\b/,
  ];
  return padroesPessoais.some((padrao) => padrao.test(texto));
}
function perguntaPedeMemoriaHistoricaIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto) {
    return false;
  }
  // Pedidos explicitos de lembranca precisam consultar a janela completa
  // permitida pelo nivel de contexto, e nao a rota factual economica.
  return /\b(lembra|lembrar|recorda|recordar|te perguntei|eu te perguntei|te falei|eu te falei|falei antes|perguntei antes|mencionei|comentamos|conversamos|mais pra cima|mais acima|mensagens? atras|antes disso|ontem)\b/.test(
    texto,
  );
}
function perguntaFactualDependeDoContextoIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto) {
    return false;
  }
  // Follow-ups curtos de produto nao sao fatos independentes.
  // Eles precisam do item anterior para fazer sentido.
  if (ehReferenciaAoContextoAnteriorIA(valor)) {
    return true;
  }
  // Conectores e pronomes indicam dependencia real do assunto anterior.
  if (
    /^(e |mas |entao |e ai |nesse caso |nesse pais |nessa cidade |la |ali )/.test(
      texto,
    ) ||
    /\b(ele|ela|eles|elas|isso|nisso|disso|desse|dessa|dele|dela|la|ali)\b/.test(
      texto,
    )
  ) {
    return true;
  }
  // Perguntas elipticas curtas tambem dependem de um referente anterior.
  // Ex.: "Qual a populacao?", "Quanto custa?", "Onde fica?"
  // Uma pergunta completa como "Qual e a capital do Uruguai?" nao depende.
  const limpa = texto.replace(/[?!.]+$/g, "").trim();
  return /^(?:qual(?: e)? (?:a|o) (?:capital|populacao|moeda|idioma|lingua|preco|valor|tamanho|cor)|quais(?: sao)? (?:os|as)? ?(?:tamanhos|cores|opcoes|modelos)|quanto(?: custa| e| fica)?|onde fica|onde e|quando foi|quem e)$/.test(
    limpa,
  );
}
function ehPerguntaFactualEstavelSemWebIA(valor) {
  const texto = normalizarPerguntaConhecimentoIA(valor);
  if (!texto || !ehPerguntaConhecimentoGeralIA(valor)) {
    return false;
  }
  if (
    perguntaFactualDependeDoContextoIA(valor) ||
    ehPedidoExplicitoPesquisaWebIA(valor) ||
    ehConsultaMeteorologicaAtualIA(valor)
  ) {
    return false;
  }
  // Perguntas pessoais, subjetivas ou sobre experiencias do interlocutor
  // pertencem a conversa normal, mesmo quando comecam com "qual foi".
  if (
    /\b(seu|sua|seus|suas|teu|tua|teus|tuas|favorito|favorita|favoritos|favoritas|achou|acha|gostou|prefere|preferiu|assistiu|viu|fez|foi ao|foi no|foi na)\b/.test(
      texto,
    )
  ) {
    return false;
  }
  // Assuntos naturalmente dinamicos continuam podendo usar web.
  if (
    /\b(hoje|agora|atual|atualmente|atualizado|atualizada|mais recente|ultimo|ultima|ultimos|ultimas|preco|precos|valor|valores|quanto custa|quanto ta|quanto esta|cotacao|estoque|disponivel|disponibilidade|noticia|noticias|lancamento|placar|resultado|ranking|presidente|governador|prefeito|ministro|ministra|ceo|diretor|diretora|campeao|campea|populacao|habitantes)\b/.test(
      texto,
    )
  ) {
    return false;
  }
  return true;
}
function montarContextoFactualAssistidoIA(conversa, mensagemAtual) {
  if (!perguntaFactualDependeDoContextoIA(mensagemAtual?.texto)) {
    return [];
  }
  const configuracao = obterConfiguracaoNivelContextoIA();
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  const anteriores = [];
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  for (
    let i = indiceAtual - 1;
    i >= 0 && anteriores.length < configuracao.mensagens;
    i -= 1
  ) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const texto = obterTextoMensagemParaContextoIA(lista, i);
    if (!texto) {
      continue;
    }
    anteriores.push({
      role: msg.minha ? "assistant" : "user",
      content: texto.slice(0, 700),
    });
  }
  return anteriores.reverse();
}
function obterUltimaMensagemRelevanteIA(conversa) {
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    return msg;
  }
  return null;
}
function montarContextoTextoIA(
  conversa,
  mensagemAtualOverride = null,
  conteudoAtualOverride = "",
  opcoes = {},
) {
  const configuracao = obterConfiguracaoNivelContextoIA();
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const mensagensTexto = [];
  const baseOverride = mensagemAtualOverride
    ? chaveBaseSugestaoIA(conversa, mensagemAtualOverride)
    : "";
  const conteudoOverride = String(conteudoAtualOverride || "").trim();
  const documentoAtivoId = String(opcoes?.documentoAtivoId || "").trim();

  for (let i = 0; i < lista.length; i += 1) {
    const msg = lista[i];
    const ehOverride =
      !!baseOverride &&
      chaveBaseSugestaoIA(conversa, msg) === baseOverride &&
      !!conteudoOverride;
    const conteudo = ehOverride
      ? conteudoOverride
      : documentoAtivoId && mensagemSuportaLeituraDocumentoIA(msg)
        ? referenciaDocumentoParaContextoIA(msg, documentoAtivoId)
        : obterTextoMensagemParaContextoIA(lista, i);

    if (!msg || !conteudo) {
      continue;
    }

    mensagensTexto.push({
      role: msg.minha ? "assistant" : "user",
      content: conteudo.slice(0, ehOverride ? 12000 : 1800),
    });
  }

  return mensagensTexto.slice(-configuracao.mensagens);
}
function normalizarFormatacaoRespostaIAParaWhatsapp(valor) {
  return String(valor || "")
    .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
    .trim();
}
function normalizarSugestoesFormatacaoIA(sugestoes = {}) {
  const origem = sugestoes && typeof sugestoes === "object" ? sugestoes : {};
  return {
    positiva: normalizarFormatacaoRespostaIAParaWhatsapp(origem.positiva),
    neutra: normalizarFormatacaoRespostaIAParaWhatsapp(origem.neutra),
    negativa: normalizarFormatacaoRespostaIAParaWhatsapp(origem.negativa),
  };
}
function referenciaDocumentoParaContextoIA(msg, documentoAtivoId = "") {
  if (!mensagemSuportaLeituraDocumentoIA(msg)) {
    return "";
  }
  const id = String(msg?.idMensagem || "").trim();
  const nome = String(
    msg?.fileName || msg?.documentoIAFileName || "documento.pdf",
  ).trim();
  const ativo = !!documentoAtivoId && id === String(documentoAtivoId).trim();
  return ativo ? `[Documento ativo: ${nome}]` : `[Documento anterior: ${nome}]`;
}
function chaveBaseSugestaoIA(conversa, ultimaMensagem) {
  return String(
    ultimaMensagem?.idMensagem ||
      ultimaMensagem?.timestamp ||
      `${conversa?.id || ""}:${ultimaMensagem?.texto || ""}`,
  );
}
function cancelarSugestaoIAEmAndamento() {
  clearTimeout(timerSugestaoIA);
  timerSugestaoIA = null;
  tokenSugestaoIA += 1;
  gerandoSugestaoIA = false;
}
async function prepararContextoVisualMensagemAtualIA(conversa, mensagemAtual) {
  try {
    await prepararContextoVisualIA(
      conversa,
      mensagemAtual,
      obterConfiguracaoNivelContextoIA().mensagens,
    );
  } catch {}
}
function montarMensagemAtualComContextoVisualIA(mensagemAtual, textoBase = "") {
  return montarTextoMensagemComContextoVisualIA(mensagemAtual, textoBase);
}
async function prepararContextoAudioMensagemAtualIA(conversa, mensagemAtual) {
  try {
    const resultado = await prepararContextoAudioIA(
      conversa,
      mensagemAtual,
      obterConfiguracaoNivelContextoIA().mensagens,
    );

    if (resultado?.aplicavel) {
      try {
        moduloAudio?.atualizarTranscricaoVisivel?.(mensagemAtual);
      } catch {}
    }

    return resultado || { ok: true, aplicavel: false };
  } catch (erro) {
    return {
      ok: false,
      aplicavel: mensagemSuportaTranscricaoAudioIA(mensagemAtual),
      erro: erro?.message || "Falha ao preparar transcricao de audio.",
    };
  }
}
async function prepararContextoDocumentoMensagemAtualIA(
  conversa,
  mensagemAtual,
) {
  try {
    const conversaId = String(conversa?.id || "").trim();
    const rotaAnterior = obterUltimaRotaRespostaIA(conversaId);
    const permitirContinuacao =
      rotaAnterior === "documento" &&
      !ehPedidoExplicitoPesquisaWebIA(mensagemAtual?.texto) &&
      !ehConsultaMeteorologicaAtualIA(mensagemAtual?.texto);

    return (
      (await prepararContextoDocumentoRelacionadoIA(conversa, mensagemAtual, {
        permitirContinuacao,
        incluirComparaveis: true,
      })) || {
        ok: true,
        aplicavel: false,
      }
    );
  } catch (erro) {
    return {
      ok: false,
      aplicavel: mensagemSuportaLeituraDocumentoIA(mensagemAtual),
      erro: erro?.message || "Falha ao preparar leitura do documento.",
    };
  }
}
function obterPainelRespostaIAParaTranscricao() {
  return document.getElementById("respostaIA");
}
function iniciarAnimacaoTranscricaoAudioPainelIA(conversaId) {
  const id = String(conversaId || "").trim();

  if (!id || conversaAtual !== id) {
    return false;
  }

  mostrarEstadoPainelIA("Transcrevendo áudio...");
  definirGerandoPainelIA(true);

  const painel = obterPainelRespostaIAParaTranscricao();

  if (painel) {
    painel.classList.add("ia-transcrevendo-audio");
    painel.dataset.transcricaoAudioConversa = id;
  }

  return true;
}
function finalizarAnimacaoTranscricaoAudioPainelIA(conversaId) {
  const id = String(conversaId || "").trim();
  const painel = obterPainelRespostaIAParaTranscricao();

  if (!painel || painel.dataset.transcricaoAudioConversa !== id) {
    return false;
  }

  painel.classList.remove("ia-transcrevendo-audio");
  delete painel.dataset.transcricaoAudioConversa;
  return true;
}
function mostrarPensandoDepoisDaTranscricaoIA(conversaId, automatico = false) {
  const id = String(conversaId || "").trim();

  if (!id || conversaAtual !== id) {
    return;
  }

  mostrarEstadoPainelIA(
    automatico
      ? "Áudio transcrito. Pensando na resposta automática..."
      : "Áudio transcrito. Pensando na resposta...",
  );
  definirGerandoPainelIA(true);
}
function montarMensagemAtualComContextoMidiaIA(mensagemAtual, textoBase = "") {
  const comVisao = montarMensagemAtualComContextoVisualIA(
    mensagemAtual,
    textoBase,
  );
  const comAudio = montarTextoMensagemComTranscricaoAudioIA(
    mensagemAtual,
    comVisao,
  );

  return montarTextoMensagemComContextoDocumentoIA(mensagemAtual, comAudio, {
    documentoAtualSemPergunta:
      mensagemSuportaLeituraDocumentoIA(mensagemAtual) &&
      !String(textoBase || "").trim(),
  });
}
async function gerarSugestaoIA(conversaId) {
  if (modoIAAtual !== "assistido") {
    return;
  }
  const conversa = conversas[conversaId];
  if (!conversa || conversaAtual !== conversaId) {
    return;
  }
  const ultimaMensagem = obterUltimaMensagemRelevanteIA(conversa);
  if (!ultimaMensagem) {
    mostrarEstadoPainelIA("Ainda não há mensagens para a IA analisar.");
    return;
  }
  if (ultimaMensagem.minha) {
    mostrarEstadoPainelIA(
      "Aguardando uma nova mensagem do contato para sugerir respostas.",
    );
    return;
  }
  const estadoEntradaCurta = obterEstadoEntradaCurtaIA(
    conversa,
    ultimaMensagem,
  );
  if (estadoEntradaCurta.aguardar) {
    mostrarEstadoPainelIA("Aguardando mais contexto antes de chamar a IA.");
    return;
  }
  await prepararContextoVisualMensagemAtualIA(conversa, ultimaMensagem);

  const audioAtualPrecisaTranscrever =
    mensagemSuportaTranscricaoAudioIA(ultimaMensagem) &&
    !moduloTranscricaoIA.hidratarTranscricaoDoCache(ultimaMensagem);

  if (audioAtualPrecisaTranscrever) {
    ultimaMensagem.transcricaoIAStatus = "transcrevendo";
    ultimaMensagem.transcricaoIAErro = null;
    try {
      moduloAudio?.atualizarTranscricaoVisivel?.(ultimaMensagem);
    } catch {}
    iniciarAnimacaoTranscricaoAudioPainelIA(conversaId);
  }

  const resultadoTranscricaoAudio = await prepararContextoAudioMensagemAtualIA(
    conversa,
    ultimaMensagem,
  );

  if (audioAtualPrecisaTranscrever) {
    finalizarAnimacaoTranscricaoAudioPainelIA(conversaId);
    ultimaMensagem.transcricaoIAStatus = resultadoTranscricaoAudio?.ok
      ? "concluida"
      : "erro";
    try {
      moduloAudio?.atualizarTranscricaoVisivel?.(ultimaMensagem);
    } catch {}

    if (resultadoTranscricaoAudio?.ok) {
      mostrarPensandoDepoisDaTranscricaoIA(conversaId, false);
    } else if (conversaAtual === conversaId) {
      definirGerandoPainelIA(false);
    }
  }

  const resultadoLeituraDocumento =
    await prepararContextoDocumentoMensagemAtualIA(conversa, ultimaMensagem);

  const textoUltimaBase = String(
    estadoEntradaCurta.textoEfetivo || ultimaMensagem.texto || "",
  ).trim();
  const textoUltimaMidiaAtual = montarMensagemAtualComContextoMidiaIA(
    ultimaMensagem,
    textoUltimaBase,
  );
  const documentoRelacionadoAtivo = !!(
    resultadoLeituraDocumento?.ok &&
    resultadoLeituraDocumento?.aplicavel &&
    resultadoLeituraDocumento?.texto
  );
  const documentoAnteriorRelacionado =
    documentoRelacionadoAtivo && !resultadoLeituraDocumento?.documentoAtual;
  const textoUltima = documentoAnteriorRelacionado
    ? montarTextoMensagemComDocumentoRelacionadoIA(
        resultadoLeituraDocumento,
        textoUltimaMidiaAtual,
      )
    : textoUltimaMidiaAtual;
  const textoUltimaRoteamento = mensagemSuportaLeituraDocumentoIA(
    ultimaMensagem,
  )
    ? textoUltimaBase || "documento pdf recebido para analise"
    : textoUltimaBase || textoUltima;
  if (!textoUltima) {
    if (mensagemSuportaLeituraDocumentoIA(ultimaMensagem)) {
      mostrarEstadoPainelIA(
        resultadoLeituraDocumento?.erro ||
          "Não consegui ler esse PDF agora. Tente novamente em instantes.",
        "ia-erro",
      );
      return;
    }
    if (mensagemSuportaTranscricaoAudioIA(ultimaMensagem)) {
      mostrarEstadoPainelIA(
        "Não consegui transcrever esse áudio agora. Tente novamente em instantes.",
        "ia-erro",
      );
      return;
    }

    mostrarEstadoPainelIA(
      "A última mensagem ainda não trouxe conteúdo suficiente para a IA analisar.",
    );
    return;
  }
  const baseId = chaveBaseSugestaoIA(conversa, ultimaMensagem);
  const cache = obterSugestaoIACache(conversaId);
  if (cache?.baseId === baseId) {
    if (cache.ignorada) {
      mostrarEstadoPainelIA(
        "Sugestões ignoradas. Uma nova mensagem do contato gerará outras opções.",
      );
      return;
    }
    if (cache.modoResposta === "unica" && String(cache.resposta || "").trim()) {
      exibirRespostaUnicaIA(conversaId, baseId, cache.resposta);
      return;
    }
    if (sugestoesIACompletas(cache.sugestoes)) {
      exibirSugestoesIA(
        conversaId,
        baseId,
        cache.sugestoes,
        cache.selecionada || "neutra",
      );
      return;
    }
  }
  const consultaClimaAtual = ehConsultaMeteorologicaAtualIA(
    textoUltimaRoteamento,
  );
  const localClimaExplicito = consultaClimaAtual
    ? extrairLocalizacaoMeteorologicaExplicitaIA(textoUltimaRoteamento)
    : "";
  if (localClimaExplicito) {
    registrarLocalClimaIA(conversaId, localClimaExplicito);
  }
  const localClimaAtual = consultaClimaAtual
    ? localClimaExplicito || obterLocalClimaIA(conversaId)
    : "";
  const pendenciaClima =
    obterPendenciaClimaIA(conversaId) ||
    reconstruirPendenciaClimaDaConversaIA(conversa, ultimaMensagem);
  const respostaLocalClimaPendente =
    !!pendenciaClima &&
    !consultaClimaAtual &&
    ehRespostaProvavelLocalizacaoClimaIA(textoUltimaRoteamento);
  if (consultaClimaAtual && !localClimaAtual) {
    const respostaLocal = "Em que cidade tu tá?";
    registrarPendenciaClimaIA(conversaId, textoUltimaRoteamento);
    registrarUltimaRotaRespostaIA(conversaId, "clima-pendente");
    salvarSugestaoIACache(conversaId, {
      baseId,
      modoResposta: "unica",
      resposta: respostaLocal,
      ignorada: false,
      geradaEm: Date.now(),
    });
    diagnosticoPesquisaWebIA("CLIMA_PEDIU_LOCAL_ASSISTIDO", {
      conversaId,
      groqChamada: false,
    });
    exibirRespostaUnicaIA(conversaId, baseId, respostaLocal);
    return;
  }
  const textoConsultaWeb = respostaLocalClimaPendente
    ? montarConsultaClimaComLocalIA(
        pendenciaClima.pergunta,
        textoUltimaRoteamento,
      )
    : consultaClimaAtual && localClimaAtual
      ? montarConsultaClimaComLocalIA(textoUltimaRoteamento, localClimaAtual)
      : textoUltima;
  if (respostaLocalClimaPendente) {
    registrarLocalClimaIA(conversaId, textoUltimaRoteamento);
    limparPendenciaClimaIA(conversaId);
  }
  const decisaoFonteBase = await resolverFonteRespostaIA({
    conversa,
    mensagemAtual: ultimaMensagem,
    textoEfetivo: textoUltimaRoteamento,
    conversaId,
    respostaLocalClimaPendente,
    consultaClimaAtual,
  });
  const documentoEhContinuacao =
    documentoRelacionadoAtivo &&
    String(resultadoLeituraDocumento?.motivo || "") === "continuacao";
  const referenciaExplicitaDocumento = ehReferenciaExplicitaDocumentoIA(
    textoUltimaRoteamento,
  );
  const continuacaoReferencialDocumento =
    documentoEhContinuacao &&
    (ehReferenciaAoContextoAnteriorIA(textoUltimaRoteamento) ||
      perguntaFactualDependeDoContextoIA(textoUltimaRoteamento));
  const priorizarDocumento =
    documentoRelacionadoAtivo &&
    !ehPedidoExplicitoPesquisaWebIA(textoUltimaRoteamento) &&
    !consultaClimaAtual &&
    (referenciaExplicitaDocumento ||
      continuacaoReferencialDocumento ||
      !documentoEhContinuacao ||
      (!decisaoFonteBase.catalogoRelevante &&
        !decisaoFonteBase.precisaPesquisaWeb));
  const decisaoFonte = priorizarDocumento
    ? {
        pedidoExplicitoPesquisaWeb: false,
        factualEstavelSemWeb: false,
        continuacaoPesquisaWeb: false,
        consultaWebEspecifica: false,
        catalogoDiretoRelevante: false,
        catalogoContinuacaoRelevante: false,
        catalogoRelevante: false,
        catalogoEhContinuacao: false,
        precisaPesquisaWeb: false,
        continuacaoFactualCurta: false,
        perguntaConhecimentoGeral: false,
        rotaPretendida: "documento",
      }
    : decisaoFonteBase;
  const {
    pedidoExplicitoPesquisaWeb,
    factualEstavelSemWeb,
    continuacaoPesquisaWeb,
    consultaWebEspecifica,
    catalogoDiretoRelevante,
    catalogoContinuacaoRelevante,
    catalogoRelevante,
    precisaPesquisaWeb,
    continuacaoFactualCurta,
    perguntaConhecimentoGeral,
    rotaPretendida,
  } = decisaoFonte;
  const pesquisaWebAtiva = obterPesquisaWebAtivaIA();
  const usarPesquisaWeb = pesquisaWebAtiva && precisaPesquisaWeb;
  diagnosticoPesquisaWebIA("FONTE_DECISAO", {
    rota: "assistido",
    documento: priorizarDocumento,
    documentoMotivo: String(resultadoLeituraDocumento?.motivo || ""),
    documentosComparaveis: Array.isArray(
      resultadoLeituraDocumento?.documentosComparaveis,
    )
      ? resultadoLeituraDocumento.documentosComparaveis.length
      : 0,
    pedidoExplicito: pedidoExplicitoPesquisaWeb,
    factualEstavel: factualEstavelSemWeb,
    catalogoFollowupReferencial: catalogoContinuacaoRelevante,
    consultaWeb: consultaWebEspecifica,
    webContinuacao: continuacaoPesquisaWeb,
    webContextoForcado: continuacaoPesquisaWeb && !respostaLocalClimaPendente,
    catalogoDireto: catalogoDiretoRelevante,
    catalogoContinuacao: catalogoContinuacaoRelevante,
    catalogo: catalogoRelevante,
    clima: consultaClimaAtual,
    climaPendente: respostaLocalClimaPendente,
    localClima: !!(localClimaAtual || respostaLocalClimaPendente),
    web: usarPesquisaWeb,
  });
  if (precisaPesquisaWeb && !pesquisaWebAtiva) {
    diagnosticoPesquisaWebIA("BLOQUEADA_OFF_ASSISTIDO", {
      conversaId,
      pedidoExplicito: ehPedidoExplicitoPesquisaWebIA(textoUltimaRoteamento),
      groqChamada: false,
    });
    mostrarEstadoPainelIA(
      "A pesquisa na internet está desativada nas Configurações de IA. Nenhuma chamada à Groq foi feita.",
    );
    definirGerandoPainelIA(false);
    return;
  }
  registrarUltimaRotaRespostaIA(
    conversaId,
    priorizarDocumento ? "documento" : usarPesquisaWeb ? "web" : rotaPretendida,
  );
  if (usarPesquisaWeb || perguntaConhecimentoGeral) {
    const token = ++tokenSugestaoIA;
    gerandoSugestaoIA = true;
    definirContextoSugestaoIA(conversaId, baseId);
    mostrarEstadoPainelIA(
      usarPesquisaWeb
        ? "Pesquisando na internet e preparando uma resposta..."
        : "Pensando em uma resposta...",
    );
    definirGerandoPainelIA(true);
    if (usarPesquisaWeb) {
      diagnosticoPesquisaWebIA("ROTA_ASSISTIDO", {
        conversaId,
        tamanhoMensagem: textoUltimaRoteamento.length,
      });
    }
    try {
      const resultado = usarPesquisaWeb
        ? await ipcRenderer.invoke("gerar-resposta-web-ia", {
            conversaId,
            nomeContato: conversa.nome || conversa.id,
            promptInterno: obterPromptInternoIA(),
            promptPersonalizado: obterPromptPersonalizadoIA(),
            mensagensAnteriores: respostaLocalClimaPendente
              ? []
              : montarContextoPesquisaWebIA(
                  conversa,
                  ultimaMensagem,
                  continuacaoPesquisaWeb,
                ),
            mensagemAtual: textoConsultaWeb.slice(0, 2200),
            limitesContexto: obterLimitesContextoIAParaMotor(),
            forcarPesquisaWeb: true,
            consultaClima: !!(consultaClimaAtual || respostaLocalClimaPendente),
            usarCatalogo: false,
          })
        : await ipcRenderer.invoke("gerar-resposta-factual-ia", {
            conversaId,
            nomeContato: conversa.nome || conversa.id,
            promptPersonalizado: obterPromptPersonalizadoIA(),
            mensagensAnteriores: factualEstavelSemWeb
              ? []
              : continuacaoFactualCurta
                ? montarContextoContinuacaoFactualCurtaIA(
                    conversa,
                    ultimaMensagem,
                  )
                : montarContextoFactualAssistidoIA(conversa, ultimaMensagem),
            mensagemAtual: textoUltima.slice(0, 1800),
            limitesContexto: obterLimitesContextoIAParaMotor(),
            usarCatalogo: false,
          });
      if (
        token !== tokenSugestaoIA ||
        conversaAtual !== conversaId ||
        modoIAAtual !== "assistido"
      ) {
        return;
      }
      const resposta = normalizarFormatacaoRespostaIAParaWhatsapp(
        resultado?.resposta,
      );
      if (usarPesquisaWeb) {
        diagnosticoPesquisaWebIA("RESULTADO_ASSISTIDO", {
          conversaId,
          ok: !!resultado?.ok,
          pesquisou: !!resultado?.pesquisou,
          fontes: Number(resultado?.fontes || 0) || 0,
          erro: resultado?.erro ? String(resultado.erro).slice(0, 180) : "",
        });
      }
      if (!resultado?.ok || !resposta) {
        mostrarEstadoPainelIA(
          resultado?.erro || "Não foi possível gerar a resposta.",
          "ia-erro",
        );
        return;
      }
      salvarSugestaoIACache(conversaId, {
        baseId,
        modoResposta: "unica",
        resposta,
        ignorada: false,
        geradaEm: Date.now(),
      });
      exibirRespostaUnicaIA(conversaId, baseId, resposta);
    } catch (erro) {
      if (token === tokenSugestaoIA && conversaAtual === conversaId) {
        mostrarEstadoPainelIA(
          erro?.message || "Erro ao acessar a IA.",
          "ia-erro",
        );
      }
    } finally {
      if (token === tokenSugestaoIA) {
        gerandoSugestaoIA = false;
        definirGerandoPainelIA(false);
      }
    }
    return;
  }
  const contexto = priorizarDocumento
    ? montarContextoTextoIA(conversa, ultimaMensagem, textoUltima, {
        documentoAtivoId: resultadoLeituraDocumento?.documentoId || "",
      })
    : montarContextoTextoIA(conversa);
  if (!contexto.length) {
    mostrarEstadoPainelIA(
      "Não há mensagens de texto suficientes para gerar sugestões.",
    );
    return;
  }
  const token = ++tokenSugestaoIA;
  gerandoSugestaoIA = true;
  definirContextoSugestaoIA(conversaId, baseId);
  mostrarEstadoPainelIA("Pensando em 3 respostas...");
  definirGerandoPainelIA(true);
  try {
    const resultado = await ipcRenderer.invoke("gerar-sugestao-ia", {
      conversaId,
      nomeContato: conversa.nome || conversa.id,
      promptInterno: obterPromptInternoIA(),
      promptPersonalizado: obterPromptPersonalizadoIA(),
      mensagens: contexto,
      limitesContexto: obterLimitesContextoIAParaMotor(),
      usarCatalogo: catalogoRelevante,
      catalogoEhContinuacao: catalogoContinuacaoRelevante,
    });
    if (
      token !== tokenSugestaoIA ||
      conversaAtual !== conversaId ||
      modoIAAtual !== "assistido"
    ) {
      return;
    }
    if (!resultado?.ok) {
      mostrarEstadoPainelIA(
        resultado?.erro || "Não foi possível gerar as sugestões.",
        "ia-erro",
      );
      return;
    }
    const sugestoes = normalizarSugestoesFormatacaoIA(
      normalizarSugestoesIA(resultado.sugestoes),
    );
    if (!sugestoesIACompletas(sugestoes)) {
      mostrarEstadoPainelIA(
        "A IA não retornou as três opções de resposta.",
        "ia-erro",
      );
      return;
    }
    salvarSugestaoIACache(conversaId, {
      baseId,
      sugestoes,
      selecionada: "neutra",
      ignorada: false,
      geradaEm: Date.now(),
    });
    exibirSugestoesIA(conversaId, baseId, sugestoes, "neutra");
  } catch (erro) {
    if (token === tokenSugestaoIA && conversaAtual === conversaId) {
      mostrarEstadoPainelIA(
        erro?.message || "Erro ao acessar a IA.",
        "ia-erro",
      );
    }
  } finally {
    if (token === tokenSugestaoIA) {
      gerandoSugestaoIA = false;
      definirGerandoPainelIA(false);
    }
  }
}
function agendarSugestaoIA(conversaId, atraso = 420) {
  clearTimeout(timerSugestaoIA);
  if (modoIAAtual !== "assistido") {
    return;
  }
  timerSugestaoIA = setTimeout(() => {
    timerSugestaoIA = null;
    gerarSugestaoIA(conversaId);
  }, atraso);
}
function limparCacheRespostasAutomaticas() {
  const agora = Date.now();
  const ttl = 6 * 60 * 60 * 1000;
  for (const [chave, timestamp] of respostasAutomaticasProcessadas.entries()) {
    if (agora - Number(timestamp || 0) > ttl) {
      respostasAutomaticasProcessadas.delete(chave);
    }
  }
  if (respostasAutomaticasProcessadas.size > 1200) {
    const excedente = respostasAutomaticasProcessadas.size - 1200;
    for (const chave of Array.from(
      respostasAutomaticasProcessadas.keys(),
    ).slice(0, excedente)) {
      respostasAutomaticasProcessadas.delete(chave);
    }
  }
}
function obterTokenRespostaAutomaticaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id) {
    return 0;
  }
  return Number(tokensRespostaAutomaticaIA.get(id) || 0) || 0;
}
function avancarTokenRespostaAutomaticaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id) {
    return 0;
  }
  const novoToken = obterTokenRespostaAutomaticaIA(id) + 1;
  tokensRespostaAutomaticaIA.set(id, novoToken);
  return novoToken;
}
function podeExecutarRespostaAutomaticaIA(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id || obterModoIAConversa(id) !== "automatico") {
    return false;
  }
  return conversaAtual === id || obterSegundoPlanoIAConversa(id);
}
function mostrarEstadoPainelIAConversa(conversaId, texto, classe = "") {
  if (conversaAtual !== String(conversaId || "").trim()) {
    return;
  }
  mostrarEstadoPainelIA(texto, classe);
}
function atualizarIndicadorGeracaoAutomaticaIA() {
  definirGerandoPainelIA(
    !!conversaAtual && respostasAutomaticasEmGeracao.has(conversaAtual),
  );
}
function cancelarRespostaAutomaticaIAEmAndamento(
  conversaId = conversaAtual,
  forcar = false,
) {
  const id = String(conversaId || "").trim();
  if (!id) {
    diagnosticoSegundoPlanoIA("CANCELAR_SEM_ID", {
      forcar,
    });
    return false;
  }
  const modo = obterModoIAConversa(id);
  const segundoPlano = obterSegundoPlanoIAConversa(id);
  const timer = timersRespostaAutomaticaIA.get(id);
  const emGeracao = respostasAutomaticasEmGeracao.has(id);
  const tokenAntes = obterTokenRespostaAutomaticaIA(id);
  if (!forcar && modo === "automatico" && segundoPlano) {
    diagnosticoSegundoPlanoIA("CANCELAR_IGNORADO_BG_ATIVO", {
      id,
      forcar,
      modo,
      segundoPlano,
      temTimer: !!timer,
      emGeracao,
      token: tokenAntes,
    });
    return false;
  }
  diagnosticoSegundoPlanoIA("CANCELAR_EXECUTADO", {
    id,
    forcar,
    modo,
    segundoPlano,
    temTimer: !!timer,
    emGeracao,
    tokenAntes,
  });
  if (timer) {
    clearTimeout(timer);
  }
  timersRespostaAutomaticaIA.delete(id);
  const tokenDepois = avancarTokenRespostaAutomaticaIA(id);
  respostasAutomaticasEmGeracao.delete(id);
  atualizarIndicadorGeracaoAutomaticaIA();
  diagnosticoSegundoPlanoIA("CANCELAR_FINALIZADO", {
    id,
    tokenAntes,
    tokenDepois,
  });
  return true;
}
function limparRespostaAutomaticaPendente(conversaId) {
  const id = String(conversaId || "").trim();
  if (!id) {
    return;
  }
  respostasAutomaticasPendentes.delete(id);
}
function eventoMensagemEhUltimaRelevanteIA(conversa, dados) {
  if (!conversa || !dados || dados.minha) {
    return false;
  }
  const ultima = obterUltimaMensagemRelevanteIA(conversa);
  if (!ultima || ultima.minha) {
    return false;
  }
  return (
    chaveBaseSugestaoIA(conversa, ultima) ===
    chaveBaseSugestaoIA(conversa, dados)
  );
}
function registrarRespostaAutomaticaPendente(conversaId, conversa) {
  const id = String(conversaId || "").trim();
  if (
    obterModoIAConversa(id) !== "automatico" ||
    !id ||
    !conversa ||
    conversa.trancada
  ) {
    return;
  }
  const ultimaMensagem = obterUltimaMensagemRelevanteIA(conversa);
  if (!ultimaMensagem || ultimaMensagem.minha) {
    limparRespostaAutomaticaPendente(id);
    return;
  }
  respostasAutomaticasPendentes.set(id, {
    baseId: chaveBaseSugestaoIA(conversa, ultimaMensagem),
    criadaEm: Date.now(),
  });
}
function tentarAgendarRespostaAutomaticaPendente(conversaId, atraso = 4000) {
  const id = String(conversaId || "").trim();
  const pendente = respostasAutomaticasPendentes.get(id);
  if (!id || !pendente || !podeExecutarRespostaAutomaticaIA(id)) {
    diagnosticoSegundoPlanoIA("AGENDAR_BLOQUEADA_GATE", {
      id: id || "vazio",
      temPendente: !!pendente,
      modo: id ? obterModoIAConversa(id) : "sem_id",
      segundoPlano: id ? obterSegundoPlanoIAConversa(id) : false,
      atual: conversaAtual || "nenhuma",
      podeExecutar: id ? podeExecutarRespostaAutomaticaIA(id) : false,
    });
    return false;
  }
  diagnosticoSegundoPlanoIA("AGENDAR_GATE_OK", {
    id,
    atual: conversaAtual || "nenhuma",
    segundoPlano: obterSegundoPlanoIAConversa(id),
  });
  const conversa = conversas[id];
  const ultimaMensagem = obterUltimaMensagemRelevanteIA(conversa);
  if (
    !conversa ||
    conversa.trancada ||
    !ultimaMensagem ||
    ultimaMensagem.minha ||
    chaveBaseSugestaoIA(conversa, ultimaMensagem) !== pendente.baseId
  ) {
    diagnosticoSegundoPlanoIA("AGENDAR_BLOQUEADA_ESTADO", {
      id,
      temConversa: !!conversa,
      trancada: !!conversa?.trancada,
      temUltima: !!ultimaMensagem,
      ultimaMinha: !!ultimaMensagem?.minha,
      baseConfere:
        !!ultimaMensagem &&
        chaveBaseSugestaoIA(conversa, ultimaMensagem) === pendente.baseId,
    });
    limparRespostaAutomaticaPendente(id);
    return false;
  }
  const chaveProcessada = chaveRespostaAutomaticaProcessada(
    id,
    pendente.baseId,
  );
  if (respostasAutomaticasEmGeracao.has(id)) {
    diagnosticoSegundoPlanoIA("AGENDAR_JA_EM_GERACAO", {
      id,
    });
    return true;
  }
  if (timersRespostaAutomaticaIA.has(id)) {
    diagnosticoSegundoPlanoIA("AGENDAR_TIMER_EXISTENTE", {
      id,
    });
    return true;
  }
  if (respostasAutomaticasProcessadas.has(chaveProcessada)) {
    diagnosticoSegundoPlanoIA("AGENDAR_JA_PROCESSADA", {
      id,
    });
    limparRespostaAutomaticaPendente(id);
    return false;
  }
  if (conversaAtual === id) {
    mostrarEstadoPainelIA(
      "Mensagem recebida enquanto esta conversa estava fechada. O Automático vai responder em alguns segundos.",
    );
  }
  diagnosticoSegundoPlanoIA("AGENDAR_CHAMANDO_TIMER", {
    id,
    atraso,
  });
  agendarRespostaAutomaticaIA(id, pendente.baseId, atraso);
  return true;
}
function obterMensagemPorBaseIA(conversa, baseId) {
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const procurado = String(baseId || "");
  if (!procurado) {
    return null;
  }
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    if (chaveBaseSugestaoIA(conversa, msg) === procurado) {
      return msg;
    }
  }
  return null;
}
function normalizarTextoContextoIA(valor) {
  return String(valor || "")
    .replace(/\s+/g, " ")
    .trim();
}
function limitarTextoContextoIA(texto, limite) {
  const valor = normalizarTextoContextoIA(texto);
  if (!valor || valor.length <= limite) {
    return valor;
  }
  return `${valor.slice(0, Math.max(0, limite - 3)).trimEnd()}...`;
}
function montarContextoAutomaticoIA(conversa, mensagemAtual, opcoes = {}) {
  const configuracao = obterConfiguracaoNivelContextoIA();
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  const documentoAtivoId = String(opcoes?.documentoAtivoId || "").trim();
  let indiceAtual = -1;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  if (indiceAtual < 0) {
    indiceAtual = lista.length;
  }
  // Usa ate o limite de mensagens definido pelo nivel de contexto atual.
  // A mensagem que disparou a automacao e enviada separadamente e nao conta
  // neste limite. Midias sem texto ficam de fora ate OCR/transcricao existirem.
  const candidatas = [];
  for (
    let i = indiceAtual - 1;
    i >= 0 && candidatas.length < configuracao.mensagens;
    i -= 1
  ) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const texto =
      documentoAtivoId && mensagemSuportaLeituraDocumentoIA(msg)
        ? referenciaDocumentoParaContextoIA(msg, documentoAtivoId)
        : obterTextoMensagemParaContextoIA(lista, i);
    if (!texto) {
      continue;
    }
    candidatas.push({
      role: msg.minha ? "assistant" : "user",
      content: texto,
    });
  }
  candidatas.reverse();
  // Orcamento global de caracteres para impedir que poucas mensagens enormes
  // consumam toda a cota de tokens. As mensagens mais recentes recebem mais
  // espaco; se for necessario cortar, as mais antigas saem primeiro.
  const LIMITE_TOTAL_CARACTERES = Math.max(
    2000,
    Math.min(100000, configuracao.tokensContexto * 3),
  );
  const QUANTIDADE_RECENTES_PRIORITARIAS = Math.min(
    20,
    Math.max(10, Math.ceil(configuracao.mensagens * 0.2)),
  );
  const LIMITE_RECENTE = 900;
  const LIMITE_ANTIGA = 320;
  const preparadas = candidatas.map((item, indice) => {
    const distanciaDoFim = candidatas.length - 1 - indice;
    const limite =
      distanciaDoFim < QUANTIDADE_RECENTES_PRIORITARIAS
        ? LIMITE_RECENTE
        : LIMITE_ANTIGA;
    return {
      role: item.role,
      content: limitarTextoContextoIA(item.content, limite),
    };
  });
  const selecionadasReverso = [];
  let totalCaracteres = 0;
  for (let i = preparadas.length - 1; i >= 0; i -= 1) {
    const item = preparadas[i];
    const custo = item.content.length;
    if (
      selecionadasReverso.length > 0 &&
      totalCaracteres + custo > LIMITE_TOTAL_CARACTERES
    ) {
      break;
    }
    selecionadasReverso.push(item);
    totalCaracteres += custo;
  }
  return selecionadasReverso.reverse();
}
function montarContextoCatalogoAutomaticoIA(
  conversa,
  mensagemAtual,
  ehContinuacao = false,
) {
  // Match direto do catalogo nao precisa carregar o historico da conversa.
  // Continuacoes referenciais recebem somente o par mais recente necessario
  // para resolver frases como "e os tamanhos?" ou "esse modelo".
  if (!ehContinuacao) {
    return [];
  }
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  const anteriores = [];
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  for (let i = indiceAtual - 1; i >= 0 && anteriores.length < 2; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const texto = obterTextoMensagemParaContextoIA(lista, i);
    if (!texto) {
      continue;
    }
    anteriores.push({
      role: msg.minha ? "assistant" : "user",
      content: limitarTextoContextoIA(texto, 600),
    });
  }
  return anteriores.reverse();
}
function montarContextoPessoalSimplesIA(conversa, mensagemAtual) {
  const lista = Array.isArray(conversa?.mensagens) ? conversa.mensagens : [];
  const baseAtual = chaveBaseSugestaoIA(conversa, mensagemAtual);
  const anteriores = [];
  let indiceAtual = lista.length;
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (chaveBaseSugestaoIA(conversa, lista[i]) === baseAtual) {
      indiceAtual = i;
      break;
    }
  }
  // Perguntas pessoais simples precisam do estilo recente, mas raramente
  // justificam carregar as 15 mensagens do modo automatico completo.
  // Mantemos no maximo 5 mensagens e um orcamento pequeno de caracteres.
  for (let i = indiceAtual - 1; i >= 0 && anteriores.length < 5; i -= 1) {
    const msg = lista[i];
    if (!msg || msg.apagadaParaTodos || msg.tipo === "apagada") {
      continue;
    }
    const texto = obterTextoMensagemParaContextoIA(lista, i);
    if (!texto) {
      continue;
    }
    anteriores.push({
      role: msg.minha ? "assistant" : "user",
      content: limitarTextoContextoIA(texto, 500),
    });
  }
  anteriores.reverse();
  const selecionadasReverso = [];
  let totalCaracteres = 0;
  const LIMITE_TOTAL_CARACTERES = 2000;
  for (let i = anteriores.length - 1; i >= 0; i -= 1) {
    const item = anteriores[i];
    const custo = item.content.length;
    if (
      selecionadasReverso.length > 0 &&
      totalCaracteres + custo > LIMITE_TOTAL_CARACTERES
    ) {
      break;
    }
    selecionadasReverso.push(item);
    totalCaracteres += custo;
  }
  return selecionadasReverso.reverse();
}
function chaveRespostaAutomaticaProcessada(conversaId, baseId) {
  return `${String(conversaId || "").trim()}|${String(baseId || "").trim()}`;
}
function sinalizarFalhaTesteIntegridadeIAGlobal(conversaId, erro) {
  const id = String(conversaId || "").trim();
  const conversaTeste = conversas[id];
  if (!id || !conversaTeste?.testeIntegridadeIA) {
    return false;
  }
  ipcRenderer.send("admin-teste-ia-falha-resposta", {
    conversaTesteId: id,
    erro: String(
      erro || "A etapa foi interrompida antes de produzir resposta.",
    ),
  });
  return true;
}
async function enviarRespostaLocalAutomaticaIA({
  id,
  baseIdEsperada,
  token,
  chaveProcessada,
  textoResposta,
  statusSucesso,
  diagnosticoPrefixo = "LOCAL",
}) {
  try {
    const conversaAindaAtual = conversas[id];
    const ultimaAgora = obterUltimaMensagemRelevanteIA(conversaAindaAtual);
    if (
      !conversaAindaAtual ||
      conversaAindaAtual.trancada ||
      !ultimaAgora ||
      ultimaAgora.minha ||
      chaveBaseSugestaoIA(conversaAindaAtual, ultimaAgora) !== baseIdEsperada
    ) {
      diagnosticoPesquisaWebIA(`${diagnosticoPrefixo}_ENVIO_CANCELADO`, {
        id,
        motivo: "estado_conversa_mudou",
      });
      respostasAutomaticasProcessadas.delete(chaveProcessada);
      sinalizarFalhaTesteIntegridadeIAGlobal(
        id,
        "A resposta local foi cancelada porque o estado da conversa sombra mudou.",
      );
      return false;
    }
    const desarquivadaLocalmente =
      desarquivarLocalmenteAoEnviar(conversaAindaAtual);
    diagnosticoSegundoPlanoIA("ENVIO_INICIO", {
      id,
      tamanhoResposta: String(textoResposta || "").length,
      semGroq: true,
    });
    const envio = await ipcRenderer.invoke("enviar-mensagem-texto", {
      conversaId: id,
      texto: String(textoResposta || ""),
      resposta: null,
    });
    diagnosticoSegundoPlanoIA("ENVIO_FIM", {
      id,
      ok: !!envio?.ok,
      semGroq: true,
      erro: envio?.erro ? String(envio.erro).slice(0, 180) : "",
    });
    if (!envio?.ok) {
      respostasAutomaticasProcessadas.delete(chaveProcessada);
      restaurarArquivamentoLocalSeFalhar(
        conversaAindaAtual,
        desarquivadaLocalmente,
      );
      mostrarEstadoPainelIAConversa(
        id,
        envio?.erro || "Não foi possível enviar a resposta automática.",
        "ia-erro",
      );
      sinalizarFalhaTesteIntegridadeIAGlobal(
        id,
        envio?.erro || "Falha ao registrar a resposta local da etapa.",
      );
      return false;
    }
    limparRespostaAutomaticaPendente(id);
    mostrarEstadoPainelIAConversa(
      id,
      statusSucesso || "Resposta local enviada sem chamar a Groq.",
    );
    return true;
  } finally {
    if (token === obterTokenRespostaAutomaticaIA(id)) {
      respostasAutomaticasEmGeracao.delete(id);
      atualizarIndicadorGeracaoAutomaticaIA();
    }
  }
}
async function gerarEEnviarRespostaAutomaticaIA(
  conversaId,
  baseIdEsperada,
  token,
) {
  const id = String(conversaId || "").trim();
  diagnosticoSegundoPlanoIA("GERAR_ENTRADA", {
    id: id || "vazio",
    token,
    tokenAtual: id ? obterTokenRespostaAutomaticaIA(id) : 0,
    modo: id ? obterModoIAConversa(id) : "sem_id",
    segundoPlano: id ? obterSegundoPlanoIAConversa(id) : false,
    atual: conversaAtual || "nenhuma",
    podeExecutar: id ? podeExecutarRespostaAutomaticaIA(id) : false,
  });
  if (
    !podeExecutarRespostaAutomaticaIA(id) ||
    token !== obterTokenRespostaAutomaticaIA(id)
  ) {
    diagnosticoSegundoPlanoIA("GERAR_BLOQUEADA_GATE", {
      id: id || "vazio",
      token,
      tokenAtual: id ? obterTokenRespostaAutomaticaIA(id) : 0,
      podeExecutar: id ? podeExecutarRespostaAutomaticaIA(id) : false,
    });
    sinalizarFalhaTesteIntegridadeIAGlobal(
      id,
      "A etapa foi bloqueada pelo gate do modo automático antes de iniciar.",
    );
    return;
  }
  const conversa = conversas[id];
  if (!conversa || conversa.trancada) {
    diagnosticoSegundoPlanoIA("GERAR_BLOQUEADA_CONVERSA", {
      id,
      temConversa: !!conversa,
      trancada: !!conversa?.trancada,
    });
    sinalizarFalhaTesteIntegridadeIAGlobal(
      id,
      "A conversa sombra deixou de estar disponível durante a etapa.",
    );
    return;
  }
  const ultimaMensagem = obterUltimaMensagemRelevanteIA(conversa);
  if (
    !ultimaMensagem ||
    ultimaMensagem.minha ||
    chaveBaseSugestaoIA(conversa, ultimaMensagem) !== baseIdEsperada
  ) {
    diagnosticoSegundoPlanoIA("GERAR_BLOQUEADA_ULTIMA", {
      id,
      temUltima: !!ultimaMensagem,
      ultimaMinha: !!ultimaMensagem?.minha,
      baseConfere:
        !!ultimaMensagem &&
        chaveBaseSugestaoIA(conversa, ultimaMensagem) === baseIdEsperada,
    });
    sinalizarFalhaTesteIntegridadeIAGlobal(
      id,
      "A mensagem ativa mudou antes da etapa começar a responder.",
    );
    return;
  }
  const estadoEntradaCurta = obterEstadoEntradaCurtaIA(
    conversa,
    ultimaMensagem,
  );
  if (estadoEntradaCurta.aguardar) {
    diagnosticoSegundoPlanoIA("GERAR_BLOQUEADA_CURTA", {
      id,
    });
    limparRespostaAutomaticaPendente(id);
    mostrarEstadoPainelIAConversa(
      id,
      "Mensagem curta recebida. Aguardando mais contexto antes de chamar a IA.",
    );
    sinalizarFalhaTesteIntegridadeIAGlobal(
      id,
      "A etapa foi classificada como mensagem curta aguardando contexto.",
    );
    return;
  }
  await prepararContextoVisualMensagemAtualIA(conversa, ultimaMensagem);

  const audioAtualPrecisaTranscrever =
    mensagemSuportaTranscricaoAudioIA(ultimaMensagem) &&
    !moduloTranscricaoIA.hidratarTranscricaoDoCache(ultimaMensagem);

  if (audioAtualPrecisaTranscrever) {
    ultimaMensagem.transcricaoIAStatus = "transcrevendo";
    ultimaMensagem.transcricaoIAErro = null;
    try {
      moduloAudio?.atualizarTranscricaoVisivel?.(ultimaMensagem);
    } catch {}
    iniciarAnimacaoTranscricaoAudioPainelIA(id);
  }

  const resultadoTranscricaoAudio = await prepararContextoAudioMensagemAtualIA(
    conversa,
    ultimaMensagem,
  );

  if (audioAtualPrecisaTranscrever) {
    finalizarAnimacaoTranscricaoAudioPainelIA(id);
    ultimaMensagem.transcricaoIAStatus = resultadoTranscricaoAudio?.ok
      ? "concluida"
      : "erro";
    try {
      moduloAudio?.atualizarTranscricaoVisivel?.(ultimaMensagem);
    } catch {}

    if (resultadoTranscricaoAudio?.ok) {
      mostrarPensandoDepoisDaTranscricaoIA(id, true);
    } else if (conversaAtual === id) {
      definirGerandoPainelIA(false);
    }
  }

  const resultadoLeituraDocumento =
    await prepararContextoDocumentoMensagemAtualIA(conversa, ultimaMensagem);

  const textoAtualBase = String(
    estadoEntradaCurta.textoEfetivo || ultimaMensagem.texto || "",
  ).trim();
  const textoAtualMidiaAtual = montarMensagemAtualComContextoMidiaIA(
    ultimaMensagem,
    textoAtualBase,
  );
  const documentoRelacionadoAtivo = !!(
    resultadoLeituraDocumento?.ok &&
    resultadoLeituraDocumento?.aplicavel &&
    resultadoLeituraDocumento?.texto
  );
  const documentoAnteriorRelacionado =
    documentoRelacionadoAtivo && !resultadoLeituraDocumento?.documentoAtual;
  const textoAtual = documentoAnteriorRelacionado
    ? montarTextoMensagemComDocumentoRelacionadoIA(
        resultadoLeituraDocumento,
        textoAtualMidiaAtual,
      )
    : textoAtualMidiaAtual;
  const textoAtualRoteamento = mensagemSuportaLeituraDocumentoIA(ultimaMensagem)
    ? textoAtualBase || "documento pdf recebido para analise"
    : textoAtualBase || textoAtual;
  if (!textoAtual) {
    if (mensagemSuportaLeituraDocumentoIA(ultimaMensagem)) {
      const chaveFalhaDocumento = chaveRespostaAutomaticaProcessada(
        id,
        baseIdEsperada,
      );
      limparCacheRespostasAutomaticas();
      if (!respostasAutomaticasProcessadas.has(chaveFalhaDocumento)) {
        respostasAutomaticasProcessadas.set(chaveFalhaDocumento, Date.now());
        await enviarRespostaLocalAutomaticaIA({
          id,
          baseIdEsperada,
          token,
          chaveProcessada: chaveFalhaDocumento,
          textoResposta: resultadoLeituraDocumento?.ocrNecessario
            ? "Esse PDF parece ser escaneado e eu ainda não consegui ler o texto dele."
            : "Não consegui ler esse PDF agora. Pode me mandar de novo?",
          statusSucesso:
            "A leitura do documento falhou e foi enviada uma resposta local segura.",
          diagnosticoPrefixo: "DOCUMENTO_FALHA",
        });
      }
      return;
    }
    if (mensagemSuportaInterpretacaoImagemIA(ultimaMensagem)) {
      const chaveFalhaVisao = chaveRespostaAutomaticaProcessada(
        id,
        baseIdEsperada,
      );
      limparCacheRespostasAutomaticas();
      if (!respostasAutomaticasProcessadas.has(chaveFalhaVisao)) {
        respostasAutomaticasProcessadas.set(chaveFalhaVisao, Date.now());
        await enviarRespostaLocalAutomaticaIA({
          id,
          baseIdEsperada,
          token,
          chaveProcessada: chaveFalhaVisao,
          textoResposta:
            "Não consegui analisar essa imagem agora. Pode me mandar de novo?",
          statusSucesso:
            "A análise visual falhou após nova tentativa. Foi enviada uma resposta local segura.",
          diagnosticoPrefixo: "VISAO_FALHA",
        });
      }
      return;
    }
    if (mensagemSuportaTranscricaoAudioIA(ultimaMensagem)) {
      const chaveFalhaAudio = chaveRespostaAutomaticaProcessada(
        id,
        baseIdEsperada,
      );
      limparCacheRespostasAutomaticas();
      if (!respostasAutomaticasProcessadas.has(chaveFalhaAudio)) {
        respostasAutomaticasProcessadas.set(chaveFalhaAudio, Date.now());
        await enviarRespostaLocalAutomaticaIA({
          id,
          baseIdEsperada,
          token,
          chaveProcessada: chaveFalhaAudio,
          textoResposta:
            "Não consegui entender esse áudio agora. Pode me mandar de novo?",
          statusSucesso:
            "A transcrição do áudio falhou após nova tentativa. Foi enviada uma resposta local segura.",
          diagnosticoPrefixo: "AUDIO_FALHA",
        });
      }
      return;
    }
    mostrarEstadoPainelIAConversa(
      id,
      "Modo Automático ativo. A mensagem recebida ainda não possui conteúdo suficiente para a IA analisar.",
    );
    sinalizarFalhaTesteIntegridadeIAGlobal(
      id,
      "A etapa ficou sem conteúdo efetivo para enviar ao motor.",
    );
    return;
  }
  const chaveProcessada = chaveRespostaAutomaticaProcessada(id, baseIdEsperada);
  limparCacheRespostasAutomaticas();
  if (respostasAutomaticasProcessadas.has(chaveProcessada)) {
    diagnosticoSegundoPlanoIA("GERAR_JA_PROCESSADA", {
      id,
    });
    sinalizarFalhaTesteIntegridadeIAGlobal(
      id,
      "A etapa foi ignorada porque a mensagem já constava como processada.",
    );
    return;
  }
  respostasAutomaticasProcessadas.set(chaveProcessada, Date.now());
  respostasAutomaticasEmGeracao.add(id);
  atualizarIndicadorGeracaoAutomaticaIA();
  mostrarEstadoPainelIAConversa(
    id,
    "Automático ativo. Analisando a conversa e preparando a resposta...",
  );

  const nomeArquivoDocumentoAtual = String(
    ultimaMensagem?.fileName || "",
  ).trim();
  const documentoAtualSemPergunta = !!(
    documentoRelacionadoAtivo &&
    resultadoLeituraDocumento?.documentoAtual &&
    mensagemSuportaLeituraDocumentoIA(ultimaMensagem) &&
    (!textoAtualBase ||
      (nomeArquivoDocumentoAtual &&
        textoAtualBase.localeCompare(nomeArquivoDocumentoAtual, undefined, {
          sensitivity: "accent",
        }) === 0))
  );

  if (documentoAtualSemPergunta) {
    registrarUltimaRotaRespostaIA(id, "documento");
    diagnosticoPesquisaWebIA("DOCUMENTO_SOZINHO_AUTOMATICO", {
      id,
      documentoId: String(resultadoLeituraDocumento?.documentoId || ""),
      arquivo: nomeArquivoDocumentoAtual.slice(0, 160),
      groqChamada: false,
    });

    await enviarRespostaLocalAutomaticaIA({
      id,
      baseIdEsperada,
      token,
      chaveProcessada,
      textoResposta:
        "Recebi e consegui ler o documento. O que você gostaria de saber sobre ele?",
      statusSucesso:
        "Documento lido. Foi enviada uma resposta local aguardando a pergunta do contato.",
      diagnosticoPrefixo: "DOCUMENTO_SOZINHO",
    });
    return;
  }

  const consultaClimaAtual =
    ehConsultaMeteorologicaAtualIA(textoAtualRoteamento);
  const localClimaExplicito = consultaClimaAtual
    ? extrairLocalizacaoMeteorologicaExplicitaIA(textoAtualRoteamento)
    : "";
  if (localClimaExplicito) {
    registrarLocalClimaIA(id, localClimaExplicito);
  }
  const localClimaAtual = consultaClimaAtual
    ? localClimaExplicito || obterLocalClimaIA(id)
    : "";
  const pendenciaClima =
    obterPendenciaClimaIA(id) ||
    reconstruirPendenciaClimaDaConversaIA(conversa, ultimaMensagem);
  const respostaLocalClimaPendente =
    !!pendenciaClima &&
    !consultaClimaAtual &&
    ehRespostaProvavelLocalizacaoClimaIA(textoAtualRoteamento);
  if (consultaClimaAtual && !localClimaAtual) {
    const respostaLocal = "Em que cidade tu tá?";
    registrarPendenciaClimaIA(id, textoAtualRoteamento);
    registrarUltimaRotaRespostaIA(id, "clima-pendente");
    diagnosticoPesquisaWebIA("CLIMA_PEDIU_LOCAL_AUTOMATICO", {
      id,
      groqChamada: false,
    });
    await enviarRespostaLocalAutomaticaIA({
      id,
      baseIdEsperada,
      token,
      chaveProcessada,
      textoResposta: respostaLocal,
      statusSucesso:
        "Localização necessária para consultar o clima. Nenhuma chamada à Groq foi feita.",
      diagnosticoPrefixo: "CLIMA",
    });
    return;
  }
  const textoConsultaWeb = respostaLocalClimaPendente
    ? montarConsultaClimaComLocalIA(
        pendenciaClima.pergunta,
        textoAtualRoteamento,
      )
    : consultaClimaAtual && localClimaAtual
      ? montarConsultaClimaComLocalIA(textoAtualRoteamento, localClimaAtual)
      : textoAtual;
  if (respostaLocalClimaPendente) {
    registrarLocalClimaIA(id, textoAtualRoteamento);
    limparPendenciaClimaIA(id);
  }
  const decisaoFonteBase = await resolverFonteRespostaIA({
    conversa,
    mensagemAtual: ultimaMensagem,
    textoEfetivo: textoAtualRoteamento,
    conversaId: id,
    respostaLocalClimaPendente,
    consultaClimaAtual,
  });
  const documentoEhContinuacao =
    documentoRelacionadoAtivo &&
    String(resultadoLeituraDocumento?.motivo || "") === "continuacao";
  const referenciaExplicitaDocumento =
    ehReferenciaExplicitaDocumentoIA(textoAtualRoteamento);
  const continuacaoReferencialDocumento =
    documentoEhContinuacao &&
    (ehReferenciaAoContextoAnteriorIA(textoAtualRoteamento) ||
      perguntaFactualDependeDoContextoIA(textoAtualRoteamento));
  const priorizarDocumento =
    documentoRelacionadoAtivo &&
    !ehPedidoExplicitoPesquisaWebIA(textoAtualRoteamento) &&
    !consultaClimaAtual &&
    (referenciaExplicitaDocumento ||
      continuacaoReferencialDocumento ||
      !documentoEhContinuacao ||
      (!decisaoFonteBase.catalogoRelevante &&
        !decisaoFonteBase.precisaPesquisaWeb));
  const decisaoFonte = priorizarDocumento
    ? {
        pedidoExplicitoPesquisaWeb: false,
        factualEstavelSemWeb: false,
        continuacaoPesquisaWeb: false,
        consultaWebEspecifica: false,
        catalogoDiretoRelevante: false,
        catalogoContinuacaoRelevante: false,
        catalogoRelevante: false,
        catalogoEhContinuacao: false,
        precisaPesquisaWeb: false,
        continuacaoFactualCurta: false,
        perguntaConhecimentoGeral: false,
        rotaPretendida: "documento",
      }
    : decisaoFonteBase;
  const {
    pedidoExplicitoPesquisaWeb,
    factualEstavelSemWeb,
    continuacaoPesquisaWeb,
    consultaWebEspecifica,
    catalogoDiretoRelevante,
    catalogoContinuacaoRelevante,
    catalogoRelevante,
    precisaPesquisaWeb,
    continuacaoFactualCurta,
    perguntaConhecimentoGeral,
    rotaPretendida,
    catalogoEhContinuacao,
  } = decisaoFonte;
  const pesquisaWebAtiva = conversa?.testeIntegridadeIA
    ? pesquisaWebPermitidaPeloPlano()
    : obterPesquisaWebAtivaIA();
  const usarPesquisaWeb = pesquisaWebAtiva && precisaPesquisaWeb;
  diagnosticoPesquisaWebIA("FONTE_DECISAO", {
    rota: "automatico",
    documento: priorizarDocumento,
    documentoMotivo: String(resultadoLeituraDocumento?.motivo || ""),
    documentosComparaveis: Array.isArray(
      resultadoLeituraDocumento?.documentosComparaveis,
    )
      ? resultadoLeituraDocumento.documentosComparaveis.length
      : 0,
    pedidoExplicito: pedidoExplicitoPesquisaWeb,
    factualEstavel: factualEstavelSemWeb,
    catalogoFollowupReferencial: catalogoContinuacaoRelevante,
    consultaWeb: consultaWebEspecifica,
    webContinuacao: continuacaoPesquisaWeb,
    webContextoForcado: continuacaoPesquisaWeb && !respostaLocalClimaPendente,
    catalogoDireto: catalogoDiretoRelevante,
    catalogoContinuacao: catalogoContinuacaoRelevante,
    catalogo: catalogoRelevante,
    clima: consultaClimaAtual,
    climaPendente: respostaLocalClimaPendente,
    localClima: !!(localClimaAtual || respostaLocalClimaPendente),
    web: usarPesquisaWeb,
  });
  if (precisaPesquisaWeb && !pesquisaWebAtiva) {
    const respostaSemPesquisa =
      "Não consigo consultar a internet agora, então prefiro não chutar.";
    diagnosticoPesquisaWebIA("BLOQUEADA_OFF_AUTOMATICO", {
      id,
      pedidoExplicito: ehPedidoExplicitoPesquisaWebIA(textoAtualRoteamento),
      groqChamada: false,
      respostaLocal: true,
    });
    try {
      const conversaAindaAtual = conversas[id];
      const ultimaAgora = obterUltimaMensagemRelevanteIA(conversaAindaAtual);
      if (
        !conversaAindaAtual ||
        conversaAindaAtual.trancada ||
        !ultimaAgora ||
        ultimaAgora.minha ||
        chaveBaseSugestaoIA(conversaAindaAtual, ultimaAgora) !== baseIdEsperada
      ) {
        diagnosticoPesquisaWebIA("BLOQUEADA_OFF_ENVIO_CANCELADO", {
          id,
          motivo: "estado_conversa_mudou",
        });
        respostasAutomaticasProcessadas.delete(chaveProcessada);
        sinalizarFalhaTesteIntegridadeIAGlobal(
          id,
          "A etapa sem pesquisa foi cancelada porque o estado da conversa sombra mudou.",
        );
        return;
      }
      const desarquivadaLocalmente =
        desarquivarLocalmenteAoEnviar(conversaAindaAtual);
      diagnosticoSegundoPlanoIA("ENVIO_INICIO", {
        id,
        tamanhoResposta: respostaSemPesquisa.length,
        semGroq: true,
      });
      const envio = await ipcRenderer.invoke("enviar-mensagem-texto", {
        conversaId: id,
        texto: respostaSemPesquisa,
        resposta: null,
      });
      diagnosticoSegundoPlanoIA("ENVIO_FIM", {
        id,
        ok: !!envio?.ok,
        semGroq: true,
        erro: envio?.erro ? String(envio.erro).slice(0, 180) : "",
      });
      if (!envio?.ok) {
        respostasAutomaticasProcessadas.delete(chaveProcessada);
        restaurarArquivamentoLocalSeFalhar(
          conversaAindaAtual,
          desarquivadaLocalmente,
        );
        mostrarEstadoPainelIAConversa(
          id,
          envio?.erro || "Não foi possível enviar a resposta automática.",
          "ia-erro",
        );
        sinalizarFalhaTesteIntegridadeIAGlobal(
          id,
          envio?.erro || "Falha ao registrar a resposta da etapa sem pesquisa.",
        );
        return;
      }
      limparRespostaAutomaticaPendente(id);
      mostrarEstadoPainelIAConversa(
        id,
        "Pesquisa web desativada. O WhatsIAPP respondeu sem chamar a Groq.",
      );
    } finally {
      if (token === obterTokenRespostaAutomaticaIA(id)) {
        respostasAutomaticasEmGeracao.delete(id);
        atualizarIndicadorGeracaoAutomaticaIA();
      }
    }
    return;
  }
  const perguntaPessoalSimples =
    !perguntaConhecimentoGeral &&
    ehPerguntaPessoalSimplesIA(textoAtualRoteamento);
  registrarUltimaRotaRespostaIA(
    id,
    priorizarDocumento ? "documento" : usarPesquisaWeb ? "web" : rotaPretendida,
  );
  const historico = usarPesquisaWeb
    ? respostaLocalClimaPendente
      ? []
      : montarContextoPesquisaWebIA(
          conversa,
          ultimaMensagem,
          continuacaoPesquisaWeb,
        )
    : catalogoRelevante
      ? montarContextoCatalogoAutomaticoIA(
          conversa,
          ultimaMensagem,
          catalogoEhContinuacao,
        )
      : perguntaConhecimentoGeral
        ? factualEstavelSemWeb
          ? []
          : continuacaoFactualCurta
            ? montarContextoContinuacaoFactualCurtaIA(conversa, ultimaMensagem)
            : montarContextoFactualAssistidoIA(conversa, ultimaMensagem)
        : priorizarDocumento
          ? montarContextoAutomaticoIA(conversa, ultimaMensagem, {
              documentoAtivoId: resultadoLeituraDocumento?.documentoId || "",
            })
          : perguntaPessoalSimples || estadoEntradaCurta.agrupada
            ? montarContextoPessoalSimplesIA(conversa, ultimaMensagem)
            : montarContextoAutomaticoIA(conversa, ultimaMensagem);
  try {
    diagnosticoSegundoPlanoIA("GROQ_INICIO", {
      id,
      rota: usarPesquisaWeb
        ? "web"
        : catalogoRelevante
          ? catalogoEhContinuacao
            ? "catalogo-followup"
            : "catalogo-direto"
          : perguntaConhecimentoGeral
            ? "factual"
            : "automatica",
      historico: Array.isArray(historico) ? historico.length : 0,
      tamanhoMensagem: textoAtualRoteamento.length,
    });
    if (usarPesquisaWeb) {
      diagnosticoPesquisaWebIA("ROTA_AUTOMATICO", {
        id,
        segundoPlano: obterSegundoPlanoIAConversa(id),
        historico: Array.isArray(historico) ? historico.length : 0,
        tamanhoMensagem: textoAtualRoteamento.length,
      });
    }
    const executarChamadaGeracaoAutomaticaIA = async () => {
      if (usarPesquisaWeb) {
        return ipcRenderer.invoke("gerar-resposta-web-ia", {
          conversaId: id,
          nomeContato: conversa.nome || conversa.id,
          promptInterno: obterPromptInternoIA(),
          promptPersonalizado: obterPromptPersonalizadoIA(),
          mensagensAnteriores: historico,
          mensagemAtual: textoConsultaWeb.slice(0, 2200),
          limitesContexto: obterLimitesContextoIAParaMotor(),
          forcarPesquisaWeb: true,
          consultaClima: !!(consultaClimaAtual || respostaLocalClimaPendente),
          usarCatalogo: false,
        });
      }
      if (perguntaConhecimentoGeral) {
        return ipcRenderer.invoke("gerar-resposta-factual-ia", {
          conversaId: id,
          nomeContato: conversa.nome || conversa.id,
          promptPersonalizado: obterPromptPersonalizadoIA(),
          mensagensAnteriores: historico,
          mensagemAtual: textoAtual.slice(0, 1800),
          limitesContexto: obterLimitesContextoIAParaMotor(),
          usarCatalogo: false,
        });
      }
      return ipcRenderer.invoke("gerar-resposta-automatica-ia", {
        conversaId: id,
        nomeContato: conversa.nome || conversa.id,
        promptInterno: obterPromptInternoIA(),
        promptPersonalizado: obterPromptPersonalizadoIA(),
        mensagensAnteriores: historico,
        mensagemAtual: textoAtual.slice(0, priorizarDocumento ? 12000 : 4000),
        limitesContexto: obterLimitesContextoIAParaMotor(),
        usarCatalogo: catalogoRelevante,
        catalogoEhContinuacao,
      });
    };
    const executarTentativaGeracaoAutomaticaIA = async (tentativa) => {
      try {
        return await executarChamadaGeracaoAutomaticaIA();
      } catch (erroGeracao) {
        const mensagemErro = String(
          erroGeracao?.message || erroGeracao || "erro desconhecido",
        ).slice(0, 220);
        diagnosticoSegundoPlanoIA("GROQ_ERRO_TENTATIVA", {
          id,
          tentativa,
          erro: mensagemErro,
        });
        return {
          ok: false,
          resposta: "",
          erro: mensagemErro,
        };
      }
    };
    const geracaoFalhou = (resultadoGeracao) =>
      !resultadoGeracao?.ok || !String(resultadoGeracao?.resposta || "").trim();
    const estadoPermiteRetentativaGeracaoIA = () => {
      if (
        token !== obterTokenRespostaAutomaticaIA(id) ||
        !podeExecutarRespostaAutomaticaIA(id)
      ) {
        return false;
      }
      const conversaRetentativa = conversas[id];
      const ultimaRetentativa =
        obterUltimaMensagemRelevanteIA(conversaRetentativa);
      return !!(
        conversaRetentativa &&
        !conversaRetentativa.trancada &&
        ultimaRetentativa &&
        !ultimaRetentativa.minha &&
        chaveBaseSugestaoIA(conversaRetentativa, ultimaRetentativa) ===
          baseIdEsperada
      );
    };
    let resultado = await executarTentativaGeracaoAutomaticaIA(1);
    if (usarPesquisaWeb) {
      diagnosticoPesquisaWebIA("RESULTADO_AUTOMATICO", {
        id,
        ok: !!resultado?.ok,
        pesquisou: !!resultado?.pesquisou,
        fontes: Number(resultado?.fontes || 0) || 0,
        erro: resultado?.erro ? String(resultado.erro).slice(0, 180) : "",
      });
    }
    diagnosticoSegundoPlanoIA("GROQ_FIM", {
      id,
      ok: !!resultado?.ok,
      temResposta: !!String(resultado?.resposta || "").trim(),
      erro: resultado?.erro ? String(resultado.erro).slice(0, 180) : "",
    });
    if (resultado?.codigo === "GROQ_CHAVE_AUSENTE") {
      // Reenviar o documento nao corrige uma chave ausente neste computador.
      // Mantem a mensagem pendente e avisa somente o operador da aplicacao.
      respostasAutomaticasProcessadas.delete(chaveProcessada);
      mostrarEstadoPainelIAConversa(id, resultado.erro, "ia-erro");
      diagnosticoSegundoPlanoIA("CONFIGURACAO_IA_PENDENTE", {
        id, codigo: resultado.codigo,
      });
      sinalizarFalhaTesteIntegridadeIAGlobal(id, resultado.erro);
      return;
    }
    if (geracaoFalhou(resultado)) {
      if (!estadoPermiteRetentativaGeracaoIA()) {
        diagnosticoSegundoPlanoIA("GROQ_RETRY_CANCELADA", {
          id,
          motivo: "estado_ou_gate_mudou",
        });
        respostasAutomaticasProcessadas.delete(chaveProcessada);
        return;
      }
      diagnosticoSegundoPlanoIA("GROQ_RETRY_AGENDADA", {
        id,
        atrasoMs: 700,
      });
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (!estadoPermiteRetentativaGeracaoIA()) {
        diagnosticoSegundoPlanoIA("GROQ_RETRY_CANCELADA", {
          id,
          motivo: "estado_ou_gate_mudou_apos_espera",
        });
        respostasAutomaticasProcessadas.delete(chaveProcessada);
        return;
      }
      diagnosticoSegundoPlanoIA("GROQ_RETRY_INICIO", {
        id,
      });
      resultado = await executarTentativaGeracaoAutomaticaIA(2);
      if (usarPesquisaWeb) {
        diagnosticoPesquisaWebIA("RESULTADO_AUTOMATICO_RETRY", {
          id,
          ok: !!resultado?.ok,
          pesquisou: !!resultado?.pesquisou,
          fontes: Number(resultado?.fontes || 0) || 0,
          erro: resultado?.erro ? String(resultado.erro).slice(0, 180) : "",
        });
      }
      diagnosticoSegundoPlanoIA("GROQ_RETRY_FIM", {
        id,
        ok: !!resultado?.ok,
        temResposta: !!String(resultado?.resposta || "").trim(),
        erro: resultado?.erro ? String(resultado.erro).slice(0, 180) : "",
      });
    }
    if (
      token !== obterTokenRespostaAutomaticaIA(id) ||
      !podeExecutarRespostaAutomaticaIA(id)
    ) {
      diagnosticoSegundoPlanoIA("POS_GROQ_CANCELADO_GATE", {
        id,
        token,
        tokenAtual: obterTokenRespostaAutomaticaIA(id),
        podeExecutar: podeExecutarRespostaAutomaticaIA(id),
      });
      sinalizarFalhaTesteIntegridadeIAGlobal(
        id,
        "A resposta ficou pronta, mas a etapa foi cancelada pelo gate antes do envio.",
      );
      return;
    }
    // Trava final: mesmo em segundo plano, nunca envia se chegou outra
    // mensagem ou se o usuario respondeu manualmente antes da conclusao.
    const conversaAindaAtual = conversas[id];
    const ultimaAgora = obterUltimaMensagemRelevanteIA(conversaAindaAtual);
    if (
      !conversaAindaAtual ||
      conversaAindaAtual.trancada ||
      !ultimaAgora ||
      ultimaAgora.minha ||
      chaveBaseSugestaoIA(conversaAindaAtual, ultimaAgora) !== baseIdEsperada
    ) {
      diagnosticoSegundoPlanoIA("ENVIO_CANCELADO_ESTADO", {
        id,
        temConversa: !!conversaAindaAtual,
        trancada: !!conversaAindaAtual?.trancada,
        temUltima: !!ultimaAgora,
        ultimaMinha: !!ultimaAgora?.minha,
        baseConfere:
          !!ultimaAgora &&
          chaveBaseSugestaoIA(conversaAindaAtual, ultimaAgora) ===
            baseIdEsperada,
      });
      sinalizarFalhaTesteIntegridadeIAGlobal(
        id,
        "A resposta ficou pronta, mas a mensagem ativa mudou antes do envio.",
      );
      return;
    }
    if (geracaoFalhou(resultado)) {
      const erroGeracao =
        resultado?.erro || "Não foi possível gerar a resposta automática.";
      mostrarEstadoPainelIAConversa(id, erroGeracao, "ia-erro");
      diagnosticoSegundoPlanoIA("GROQ_FALHA_FINAL", {
        id,
        erro: String(erroGeracao).slice(0, 180),
      });
      if (conversaAindaAtual?.testeIntegridadeIA) {
        respostasAutomaticasProcessadas.delete(chaveProcessada);
        ipcRenderer.send("admin-teste-ia-falha-resposta", {
          conversaTesteId: id,
          erro: erroGeracao,
        });
        return;
      }
      diagnosticoSegundoPlanoIA("FALLBACK_LOCAL_GERACAO", {
        id,
        motivo: "duas_tentativas_sem_resposta",
      });
      await enviarRespostaLocalAutomaticaIA({
        id,
        baseIdEsperada,
        token,
        chaveProcessada,
        textoResposta:
          "Não consegui responder essa agora. Pode me mandar de novo?",
        statusSucesso:
          "A IA falhou duas vezes. Foi enviada uma resposta local pedindo para repetir a mensagem.",
        diagnosticoPrefixo: "FALLBACK_IA",
      });
      return;
    }
    const textoResposta = normalizarFormatacaoRespostaIAParaWhatsapp(
      resultado.resposta,
    );
    const desarquivadaLocalmente =
      desarquivarLocalmenteAoEnviar(conversaAindaAtual);
    diagnosticoSegundoPlanoIA("ENVIO_INICIO", {
      id,
      tamanhoResposta: textoResposta.length,
    });
    const envio = await ipcRenderer.invoke("enviar-mensagem-texto", {
      conversaId: id,
      texto: textoResposta,
      resposta: null,
    });
    diagnosticoSegundoPlanoIA("ENVIO_FIM", {
      id,
      ok: !!envio?.ok,
      erro: envio?.erro ? String(envio.erro).slice(0, 180) : "",
    });
    if (
      token !== obterTokenRespostaAutomaticaIA(id) ||
      !podeExecutarRespostaAutomaticaIA(id)
    ) {
      sinalizarFalhaTesteIntegridadeIAGlobal(
        id,
        "O envio da etapa foi concluído, mas o gate mudou antes da confirmação.",
      );
      return;
    }
    if (!envio?.ok) {
      respostasAutomaticasProcessadas.delete(chaveProcessada);
      restaurarArquivamentoLocalSeFalhar(
        conversaAindaAtual,
        desarquivadaLocalmente,
      );
      mostrarEstadoPainelIAConversa(
        id,
        envio?.erro || "Não foi possível enviar a resposta automática.",
        "ia-erro",
      );
      sinalizarFalhaTesteIntegridadeIAGlobal(
        id,
        envio?.erro || "Falha ao registrar a resposta automática da etapa.",
      );
      return;
    }
    limparRespostaAutomaticaPendente(id);
    mostrarEstadoPainelIAConversa(
      id,
      "Resposta automática enviada. Aguardando a próxima mensagem nesta conversa.",
    );
  } catch (erro) {
    diagnosticoSegundoPlanoIA("ERRO_FLUXO", {
      id,
      erro: String(erro?.message || erro || "erro desconhecido").slice(0, 220),
    });
    respostasAutomaticasProcessadas.delete(chaveProcessada);
    if (
      token === obterTokenRespostaAutomaticaIA(id) &&
      podeExecutarRespostaAutomaticaIA(id)
    ) {
      const erroFluxo =
        erro?.message || "Erro ao gerar ou enviar a resposta automática.";
      mostrarEstadoPainelIAConversa(id, erroFluxo, "ia-erro");
      if (conversa?.testeIntegridadeIA) {
        ipcRenderer.send("admin-teste-ia-falha-resposta", {
          conversaTesteId: id,
          erro: erroFluxo,
        });
      }
    }
  } finally {
    if (token === obterTokenRespostaAutomaticaIA(id)) {
      respostasAutomaticasEmGeracao.delete(id);
      atualizarIndicadorGeracaoAutomaticaIA();
    }
  }
}
function agendarRespostaAutomaticaIA(conversaId, baseId, atraso = 4000) {
  const id = String(conversaId || "").trim();
  if (!id || !podeExecutarRespostaAutomaticaIA(id)) {
    diagnosticoSegundoPlanoIA("TIMER_BLOQUEADO", {
      id: id || "vazio",
      modo: id ? obterModoIAConversa(id) : "sem_id",
      segundoPlano: id ? obterSegundoPlanoIAConversa(id) : false,
      atual: conversaAtual || "nenhuma",
    });
    return;
  }
  const timerAnterior = timersRespostaAutomaticaIA.get(id);
  if (timerAnterior) {
    clearTimeout(timerAnterior);
  }
  const token = avancarTokenRespostaAutomaticaIA(id);
  diagnosticoSegundoPlanoIA("TIMER_CRIADO", {
    id,
    atraso,
    token,
    substituiuTimer: !!timerAnterior,
  });
  const timer = setTimeout(() => {
    if (timersRespostaAutomaticaIA.get(id) === timer) {
      timersRespostaAutomaticaIA.delete(id);
    }
    diagnosticoSegundoPlanoIA("TIMER_DISPAROU", {
      id,
      token,
      tokenAtual: obterTokenRespostaAutomaticaIA(id),
      podeExecutar: podeExecutarRespostaAutomaticaIA(id),
    });
    gerarEEnviarRespostaAutomaticaIA(id, baseId, token);
  }, atraso);
  timersRespostaAutomaticaIA.set(id, timer);
}
inicializarEventosPainelIA();
const {
  criarModuloCompositorMensagens,
} = require("./renderer-modules/compositor-mensagens.js");
const moduloCompositorMensagens = criarModuloCompositorMensagens({
  ipcRenderer,
  document,
  clipboard,
  crypto,
  fs,
  os,
  path,
  chatPrincipal,
  mensagens,
  statusChat,
  conversas,
  conversasProvisoriasNovaMensagem,
  obterConversaAtual: () => conversaAtual,
  obterMensagemRespondendo,
  obterRespostaAtualParaEnvio,
  limparRespostaMensagem,
  atualizarBarraRespostaMensagem,
  desarquivarLocalmenteAoEnviar,
  restaurarArquivamentoLocalSeFalhar,
  atualizarStatusCabecalho,
  requestAnimationFrame,
});
const {
  compositor,
  campoMensagem,
  botaoAnexar,
  botaoFigurinhas,
  botaoMicrofone,
  botaoEnviarMensagem,
  barraResposta,
  conteudoBarraResposta,
  autorBarraResposta,
  previewBarraResposta,
  botaoCancelarResposta,
  menuAnexos,
  painelContatosCompositor,
  painelFigurinhasCompositor,
  atualizarCompositor,
  ajustarAlturaCampoMensagem,
} = moduloCompositorMensagens;
moduloControleConversa.configurarIntegracoes({
  mensagens,
  compositor,
  campoMensagem,
  barraResposta,
  conteudoBarraResposta,
  autorBarraResposta,
  previewBarraResposta,
  botaoCancelarResposta,
  requestAnimationFrame,
});
const { criarModuloAudio } = require("./renderer-modules/audio.js");
const moduloAudio = criarModuloAudio({
  ipcRenderer,
  document,
  compositor,
  campoMensagem,
  botaoAnexar,
  botaoFigurinhas,
  botaoMicrofone,
  botaoEnviarMensagem,
  statusChat,
  conversas,
  obterConversaAtual: () => conversaAtual,
  atualizarContadores,
  renderConversas,
  renderMensagens,
  atualizarCompositor,
  desarquivarLocalmenteAoEnviar,
  restaurarArquivamentoLocalSeFalhar,
  obterRespostaAtualParaEnvio,
  obterMensagemRespondendo,
  limparRespostaMensagem,
  obterImagemPerfilApp: () => imagemPerfilApp,
  inicialDoContato,
  obterModoIAConversa,
  hidratarTranscricaoAudio: (msg) =>
    moduloTranscricaoIA.hidratarTranscricaoDoCache(msg),
  transcreverAudioMensagem: (conversa, msg) =>
    prepararContextoAudioIA(conversa, msg, 1),
});
const { criarModuloAnexos } = require("./renderer-modules/anexos.js");
const moduloAnexos = criarModuloAnexos({
  ipcRenderer,
  document,
  pathToFileURL,
  chatPrincipal,
  menuAnexos,
  painelContatosCompositor,
  painelFigurinhasCompositor,
  botaoAnexar,
  botaoFigurinhas,
  botaoEnviarMensagem,
  botaoMicrofone,
  campoMensagem,
  statusChat,
  conversas,
  obterConversaAtual: () => conversaAtual,
  obterContatosSalvosWhatsapp: moduloNovaConversa.obterContatosSalvosWhatsapp,
  carregarContatosSalvosWhatsapp,
  normalizarTextoBusca,
  digitosNumeroConversa,
  contatoSalvoExistentePorId,
  criarAvatarContato,
  solicitarFotoContatoSalvo,
  formatarNumeroWhatsapp,
  desarquivarLocalmenteAoEnviar,
  restaurarArquivamentoLocalSeFalhar,
  obterRespostaAtualParaEnvio,
  obterMensagemRespondendo,
  limparRespostaMensagem,
  ajustarAlturaCampoMensagem,
  atualizarCompositor,
  renderMensagens,
  renderConversas,
  atualizarContadores,
});
const {
  fecharPaineisCompositor,
  confirmarEnvioAnexo,
  reconciliarVideoOtimista,
} = moduloAnexos;
moduloCompositorMensagens.configurarIntegracoes({
  fecharPaineisCompositor,
  confirmarEnvioAnexo,
});
const { criarModuloFigurinhas } = require("./renderer-modules/figurinhas.js");
const moduloFigurinhas = criarModuloFigurinhas({
  ipcRenderer,
  fs,
  path,
  document,
  painelFigurinhasCompositor,
  botaoFigurinhas,
  statusChat,
  conversas,
  obterConversaAtual: () => conversaAtual,
  fecharPaineisCompositor,
  desarquivarLocalmenteAoEnviar,
  restaurarArquivamentoLocalSeFalhar,
  obterRespostaAtualParaEnvio,
});
void moduloFigurinhas;
moduloControleConversa.configurarIntegracoes({
  nomeChat,
  statusChat,
  mensagens,
  campoMensagem,
  moduloAudio,
  obterMarkupEstadoInicialChat,
  aplicarAparenciaConversa,
  atualizarBotaoArquivar,
  atualizarBotaoTrancar,
  atualizarCompositor,
  atualizarCabecalhoConversa,
  atualizarBotoesModoIA,
  atualizarControleSegundoPlanoIA,
  atualizarIndicadorGeracaoAutomaticaIA,
  mostrarEstadoPainelIA,
  cancelarRespostaAutomaticaIAEmAndamento,
  cancelarSugestaoIAEmAndamento,
  fecharPerfilContato,
  obterModoIAConversa,
  obterUltimaMensagemRelevanteIA,
  chaveBaseSugestaoIA,
  marcarConversaComoLidaLocal,
  marcarConversaComoLidaWhatsapp,
  atualizarStatusCabecalho,
  renderConversas,
  renderMensagens,
  carregarFotoPerfil,
  assinarPresencaConversa,
  ehConversaGrupo,
  carregarNomesParticipantesGrupo,
  carregarMidiasDaConversa,
  agendarSugestaoIA,
  tentarAgendarRespostaAutomaticaPendente,
  chaveRespostaAutomaticaProcessada,
  limparCacheRespostasAutomaticas,
  respostasAutomaticasProcessadas,
  respostasAutomaticasPendentes,
  agendarRespostaAutomaticaIA,
});
inicializarControleSegundoPlanoIA();
// Arquivar e Trancar agora ficam dentro do perfil do contato.
// Os elementos internos foram criados antes da inicializacao dos modulos
// e continuam sem ser adicionados ao cabecalho.
const {
  criarModuloEventosWhatsapp,
} = require("./renderer-modules/eventos-whatsapp.js");
criarModuloEventosWhatsapp({
  ipcRenderer,
  document,
  fs,
  pathToFileURL,
  conversas,
  conversasSombraTesteIA,
  conversasProvisoriasNovaMensagem,
  desarquivamentosLocaisPendentes,
  naoLidasPersistidas,
  respostasAutomaticasPendentes,
  botaoPerfilApp,
  nomeChat,
  statusChat,
  mensagens,
  moduloAudio,
  reconciliarVideoOtimista,
  aplicarEtapaSincronizacao,
  definirBaileysProntoParaFotos,
  enfileirarFotoPerfil,
  processarFilaFotosPerfil,
  carregarMinhaFotoPerfil,
  conversaIgnoradaPorExclusaoPersistida,
  trancamentoEfetivo,
  aplicarEstadoMensagemApagadaPersistida,
  mensagemIgnoradaPorLimpezaPersistida,
  aplicarEstadoMensagemEditadaPersistida,
  aplicarEstadoReacoesPersistidas,
  recuperarMidiaEnviadaLocal,
  obterTombstonesPersistidosConversa,
  atualizarContadores,
  recalcularNaoLidasGlobal,
  renderConversas,
  configurarSenhaTrancadasSeNecessario,
  obterConversaAtual: () => conversaAtual,
  definirConversaAtual: (valor) => {
    conversaAtual = valor;
  },
  atualizarStatusCabecalho,
  renderMensagens,
  carregarUmaMidia,
  atualizarBotaoArquivar,
  atualizarBotaoTrancar,
  atualizarCompositor,
  atualizarCabecalhoConversa,
  obterMarkupEstadoInicialChat,
  ehConversaTecnica,
  persistirNaoLidasConversa,
  marcarConversaComoLidaLocal,
  incrementarNaoLidaLocal,
  desarquivarAutomaticamentePorMensagem,
  persistirMidiaEnviadaLocal,
  normalizarListaReacoes,
  notificacoesAtivasConversa,
  tocarSomNovaMensagem,
  mostrarToastInternoNovaMensagem,
  solicitarNotificacaoExternaMensagem,
  obterEstadoEntradaCurtaIA,
  registrarEntradaCurtaIA,
  diagnosticoSegundoPlanoIA,
  obterModoIAConversa,
  obterSegundoPlanoIAConversa,
  limparRespostaAutomaticaPendente,
  limparEntradaCurtaIA,
  eventoMensagemEhUltimaRelevanteIA,
  cancelarRespostaAutomaticaIAEmAndamento,
  registrarRespostaAutomaticaPendente,
  tentarAgendarRespostaAutomaticaPendente,
  marcarConversaComoLidaWhatsapp,
  obterModoIAAtual: () => modoIAAtual,
  obterUltimaMensagemRelevanteIA,
  mostrarEstadoPainelIA,
  agendarRespostaAutomaticaIA,
  chaveBaseSugestaoIA,
  cancelarSugestaoIAEmAndamento,
  agendarSugestaoIA,
  registrarReacoesLocalmente,
  obterSincronizacaoInicialConcluida,
});
moduloListaConversas.configurarNavegacao();
let menuContextoAtual = null;
function fecharMenuContexto() {
  if (menuContextoAtual && menuContextoAtual.isConnected) {
    menuContextoAtual.remove();
  }
  menuContextoAtual = null;
}
const {
  criarModuloEncaminhamento,
} = require("./renderer-modules/encaminhamento.js");
const moduloEncaminhamento = criarModuloEncaminhamento({
  ipcRenderer,
  document,
  statusChat,
  conversas,
  obterConversaAtual: () => conversaAtual,
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
});
const { abrirEncaminhamentoMensagem } = moduloEncaminhamento;
const {
  criarModuloAcoesMensagens,
} = require("./renderer-modules/acoes-mensagens.js");
const moduloAcoesMensagens = criarModuloAcoesMensagens({
  ipcRenderer,
  document,
  window,
  clipboard,
  statusChat,
  conversas,
  obterConversaAtual: () => conversaAtual,
  obterMensagemRespondendo,
  atualizarBarraRespostaMensagem,
  limparRespostaMensagem,
  registrarMensagemEditadaLocalmente,
  registrarMensagemApagadaLocalmente,
  obterRegistroMensagemApagada,
  criarTombstoneMensagemApagada,
  moduloAudio,
  midiasEnviadasLocais,
  salvarMidiasEnviadasLocais,
  atualizarContadores,
  recalcularNaoLidasGlobal,
  renderConversas,
  renderMensagens,
  atualizarStatusCabecalho,
  fecharMenuContexto,
  definirMenuContextoAtual: (menu) => {
    menuContextoAtual = menu;
  },
  ativarRespostaMensagem,
  dadosMensagemParaReacao,
  abrirReacoesMensagem,
  dadosMensagemParaFavorito,
  mensagemEstaFavoritada,
  alterarFavoritoMensagem,
  abrirEncaminhamentoMensagem,
});
const { abrirMenuContextoMensagem } = moduloAcoesMensagens;
function abrirMenuContexto(evento, conversa) {
  moduloPrivacidadeConversa.abrirMenuContextoLista(evento, conversa);
}
moduloListaConversas.configurarFoco();
document.addEventListener("click", fecharMenuContexto);
window.addEventListener("blur", fecharMenuContexto);
document.addEventListener("keydown", (evento) => {
  if (evento.key === "Escape") {
    fecharMenuContexto();
  }
});
const { criarTelefoneLinks } = require("./renderer-modules/telefone-links.js");
const telefoneLinks = criarTelefoneLinks({
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
});
const { criarLinkTelefoneMensagem, proximaOcorrenciaLinkOuTelefone } =
  telefoneLinks;
const { criarModuloMidia } = require("./renderer-modules/midia.js");
moduloMidia = criarModuloMidia({
  ipcRenderer,
  document,
  window,
  chatPrincipal,
  moduloAudio,
  conversas,
  obterConversaAtual: () => conversaAtual,
  recuperarImagem: carregarUmaMidia,
});
const { criarConteudoMidia } = moduloMidia;
const sincronizacaoConversa = require('./renderer-modules/sincronizacao-conversa').criarSincronizacaoConversa({
  document, ipcRenderer, obterConversaAtual: () => conversaAtual,
  carregarMidias: carregarMidiasDaConversa,
});
moduloControleConversa.configurarIntegracoes({ sincronizacaoConversa });
const {
  criarModuloRenderizacaoMensagens,
} = require("./renderer-modules/renderizacao-mensagens.js");
moduloRenderizacaoMensagens = criarModuloRenderizacaoMensagens({
  ipcRenderer,
  shell,
  document,
  console,
  mensagens,
  conversas,
  cargaMidiaEmAndamento,
  obterConversaAtual: () => conversaAtual,
  proximaOcorrenciaLinkOuTelefone,
  criarLinkTelefoneMensagem,
  criarConteudoMidia,
  resolverNomeParticipanteGrupo,
  descricaoCurtaMensagemResposta,
  destacarMensagemRespondida,
  abrirMenuContextoMensagem,
  criarLinhaReacoes,
  mensagemEstaFavoritada,
});
function renderMensagens() {
  return moduloRenderizacaoMensagens?.renderMensagens?.();
}
async function carregarUmaMidia(conversa, msg, opcoes) {
  return moduloRenderizacaoMensagens?.carregarUmaMidia?.(conversa, msg, opcoes);
}
async function carregarMidiasDaConversa() {
  return moduloRenderizacaoMensagens?.carregarMidiasDaConversa?.();
}
bootstrapInterface.finalizarInterface({
  atualizarCompositor,
  ajustarAlturaCampoMensagem,
  prepararCabecalhoContato,
  atualizarCabecalhoConversa,
  carregarMinhaFotoPerfil,
  aplicarModoIA,
  fecharConfiguracoesApp,
});
// =========================================================
// AREA ADMINISTRATIVA OCULTA
// Implementacao movida para renderer-modules/admin.js
// =========================================================
try {
  moduloAdminOculto = criarModuloAdmin({
    ipcRenderer,
    crypto,
    os,
    conversas,
    conversasSombraTesteIA,
    mensagens,
    botaoPerfilApp,
    aplicarConfiguracaoComercialCliente,
    atualizarResumoConfiguracoesIA,
    abrirEditorPromptIA,
    campoPromptBaseIA,
    cancelarRespostaAutomaticaIAEmAndamento,
    ehConversaTecnica,
    entradasCurtasIAPorConversa,
    fecharPromptBaseIAConfig,
    limparEntradaCurtaIA,
    limparPendenciaClimaIA,
    limparRespostaAutomaticaPendente,
    locaisClimaIAPorConversa,
    nivelContextoPermitidoPeloPlano,
    nivelFallbackPermitidoPeloPlano,
    obterNivelContextoIA,
    obterPromptInternoIA,
    overlayPromptBaseIA,
    pendenciasClimaIAPorConversa,
    pesquisaWebPermitidaPeloPlano,
    respostasAutomaticasEmGeracao,
    respostasAutomaticasPendentes,
    respostasAutomaticasProcessadas,
    salvarModoIAConversa,
    salvarNivelContextoIA,
    salvarPesquisaWebAtivaIA,
    salvarSegundoPlanoIAConversa,
    timersRespostaAutomaticaIA,
    ultimaRotaRespostaIAPorConversa,
    obterConfiguracaoComercialCliente,
    obterConversaAtual: () => conversaAtual,
    obterTipoPromptIAEmEdicao,
  });
  console.log("[ADMIN MODULE] initialized");
} catch (erro) {
  moduloAdminOculto = null;
  console.error(
    "[ADMIN MODULE] init failed:",
    erro?.stack || erro?.message || erro,
  );
}

// =========================================================
// TESTADOR MESTRE
// Modulo de QA isolado. Nao participa do fluxo normal do WhatsIAPP.
// =========================================================
try {
  const {
    criarTestadorMestre,
  } = require("./testador-mestre/index.js");

  criarTestadorMestre({
    ipcRenderer,
    document,
    window,
    localStorage,
    fs,
    os,
    path,
    shell,
    obterEstadoRenderer: () => ({
      conversaAtual: String(conversaAtual || "").trim() || null,
      modoIAAtual: String(modoIAAtual || "manual"),
      abaAtual: String(abaAtual || "conversas"),
      filtro: String(filtro || ""),
      trancadasLiberadas: !!trancadasLiberadas,
      sincronizacaoConcluida: !!obterSincronizacaoInicialConcluida(),
    }),
    obterConversas: () => Object.values(conversas),
    ehConversaTecnica,
    hooksRenderer: {
      normalizarTextoBusca,
      totalFavoritosVisiveis,
      notificacoesAtivasConversa,
      definirNotificacoesConversa,
      mostrarToastInternoNovaMensagem,
      registrarFavoritoLocalmente,
      removerFavoritoLocalmente,
      atualizarFavoritoEditadoLocalmente,
      mensagemEstaFavoritada,
      registrarReacoesLocalmente,
      removerRegistroReacoes,
      aplicarEstadoReacoesPersistidas,
      registrarMensagemEditadaLocalmente,
      removerRegistroMensagemEditada,
      aplicarEstadoMensagemEditadaPersistida,
      registrarMensagemApagadaLocalmente,
      aplicarEstadoMensagemApagadaPersistida,
      limparPersistenciasMensagensDaConversa,
      obterAparenciaConversa: personalizacaoConversa?.obterAparenciaConversa,
      pesquisaWebPermitidaPeloPlano,
      niveisContextoIA: Object.keys(NIVEIS_CONTEXTO_IA || {}),
    },
  });

  console.log("[TESTADOR MESTRE] module initialized");
} catch (erro) {
  console.error(
    "[TESTADOR MESTRE] init failed:",
    erro?.stack || erro?.message || erro,
  );
}
