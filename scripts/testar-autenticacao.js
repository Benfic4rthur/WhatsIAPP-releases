"use strict";
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const raiz = path.resolve(__dirname, '..');
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');
const silencio = { log() {}, warn() {}, error() {} };
const noop = () => {};
const tick = () => new Promise(setImmediate);
function funcao(fonte, nome) {
  const match = fonte.match(new RegExp(`^(?:async )?function ${nome}\\([^]*?^}`, 'm'));
  assert(match, `Funcao ausente: ${nome}`);
  return match[0];
}

function mainHarness() {
  const eventos = [], workers = [];
  class Worker extends EventEmitter {
    constructor(arquivo) { super(); this.arquivo = arquivo; workers.push(this); }
    postMessage() {}
  }
  const contexto = vm.createContext({
    console: silencio, path, __dirname: raiz, Worker,
    app: { getPath: () => '/perfil-de-teste' },
    enviarParaTela: (evento, dados) => eventos.push({ evento, dados }),
    registrarMarcoInicializacao: noop, imprimirResumoDiagnosticoInicializacao: noop,
    agendarSincronizacaoHistoricoGapWpp: noop, enviarCatalogoAoWpp: noop,
    sincronizarContatosSalvosAutoritativos: noop,
    liberarFallbacksBaileysImediatamente: noop,
    setTimeout: noop, clearTimeout: noop,
    formatarTempoDiagnostico: String, tempoMonotonicoMs: () => 0,
    diagnosticoInicioInicializacao: null,
    baileysProntoInicial: false, wppAutenticado: false, wppFullReady: false,
    fullReadyInicialLiberado: false, estadoPrivacidadeCompleto: true,
    estadoPrivacidadePronto: true, fotosPrincipaisProntas: true,
    conversasBase: [{ id: 'cache' }], ultimaEtapaSincronizacaoInicial: null,
    dadosFullReadyInicialPendente: null, archiveWorker: null, whatsappWorker: null,
    encerrando: false, historicoGapWppExecutado: false,
    historicoGapWppEmAndamento: false, timerHistoricoGapWpp: null,
    wppRecepcaoAoVivoPronta: false, solicitacoesPendentes: new Map(),
    qrsPendentes: { baileys: null, wpp: null }, qrOrigemAtiva: null,
  });
  const fonte = ler('index.js');
  for (const nome of ['atualizarQrConexao', 'tentarLiberarFullReadyInicial', 'registrarWorker', 'criarWorkerArquivadas']) {
    vm.runInContext(funcao(fonte, nome), contexto);
  }
  const baileys = new EventEmitter();
  contexto.registrarWorker(baileys, 'baileys');
  const emitir = (worker, evento, dados) => worker.emit('message', { tipo: 'evento', evento, dados });
  const autenticar = (worker, autenticada = true) => emitir(worker, 'sessao-autenticada', { autenticada });
  const liberacoes = () => eventos.filter(e => e.evento === 'sincronizacao-etapa' && e.dados.etapa === 'full-ready' && e.dados.origem === 'bootstrap');
  return { contexto, eventos, workers, baileys, emitir, autenticar, liberacoes };
}

function testarSequencia() {
  for (const baileysSalvo of [false, true]) for (const wppSalvo of [false, true]) {
    const h = mainHarness(), c = h.contexto;
    c.criarWorkerArquivadas();
    assert.equal(h.workers.length, 0, 'WPP nao inicia antes da conexao real');
    h.emitir(h.baileys, 'status', { tipo: 'conectado' });
    assert.equal(h.workers.length, 0, 'Status de historico nao autentica');
    assert.equal(c.tentarLiberarFullReadyInicial(), false, 'Cache nao libera login');
    if (!baileysSalvo) h.emitir(h.baileys, 'qr', 'qr-baileys');
    assert.equal(h.workers.length, 0, 'QR gerado nao equivale a leitura');
    h.autenticar(h.baileys);
    assert.equal(h.workers.length, 1);
    const wpp = h.workers[0];
    h.autenticar(h.baileys);
    assert.equal(h.workers.length, 1, 'Open duplicado nao duplica WPP');
    h.emitir(wpp, 'wpp-status', { texto: 'inChat' });
    h.emitir(wpp, 'wpp-ready', { qrConfirmado: true });
    h.emitir(wpp, 'sync-stage', { etapa: 'full-ready' });
    assert.equal(h.liberacoes().length, 0, 'Pagina pronta nao autentica WPP');
    if (!wppSalvo) h.emitir(wpp, 'wpp-qr', 'qr-wpp');
    const qrs = h.eventos.filter(e => e.evento === 'qr' && e.dados).map(e => e.dados);
    assert.deepEqual(qrs, [...(baileysSalvo ? [] : ['qr-baileys']), ...(wppSalvo ? [] : ['qr-wpp'])]);
    h.autenticar(wpp);
    assert.equal(h.liberacoes().length, 0, 'Autenticacao ainda espera sincronizacao');
    c.estadoPrivacidadeCompleto = true;
    h.emitir(wpp, 'sync-stage', { etapa: 'full-ready' });
    assert.equal(h.liberacoes().length, 1);
    h.emitir(wpp, 'sync-stage', { etapa: 'full-ready' });
    assert.equal(h.liberacoes().length, 1);
  }
  // Confirmacao atrasada de WPP nao libera depois de Baileys desconectar.
  const h = mainHarness();
  h.autenticar(h.baileys);
  const wpp = h.workers[0];
  h.emitir(wpp, 'wpp-qr', 'qr-wpp');
  h.autenticar(h.baileys, false);
  h.emitir(h.baileys, 'qr', 'qr-baileys-novo');
  h.emitir(wpp, 'wpp-qr', 'qr-wpp-renovado');
  assert.equal(h.eventos.at(-1).dados, 'qr-baileys-novo');
  h.autenticar(wpp);
  h.emitir(wpp, 'sync-stage', { etapa: 'full-ready' });
  assert.equal(h.liberacoes().length, 0);
  h.autenticar(wpp, false);
  assert.equal(h.contexto.wppFullReady, false);
  assert.equal(h.contexto.estadoPrivacidadeCompleto, false);
  wpp.emit('exit', 1);
  assert.equal(h.contexto.wppAutenticado, false);
  assert.equal(h.contexto.archiveWorker, null);
  assert(!ler('index.js').includes('agendarFallbackPrivacidadeInicial'), 'Sem bypass por tempo');
  assert(!ler('main-updater.js').includes('emit(evento'), 'Sem retencao de eventos no wrapper');
}

function testarCatalogoWpp() {
  const fonte = ler('wpp-worker-modules/01-nucleo-sincronizacao.js');
  const c = vm.createContext({
    Date,
    modoStream: 'MAIN',
    infoStream: 'NORMAL',
    quantidadeConversasBaileys: 0,
    resumoConversasBaileysRecebido: false,
    primeiraLeituraVaziaFinalEm: 0,
  });
  for (const nome of [
    'receberResumoConversasBaileys',
    'streamWppEstaFinal',
    'quantidadeCatalogoWppPronta',
  ]) {
    vm.runInContext(funcao(fonte, nome), c);
  }
  assert.equal(c.receberResumoConversasBaileys({ quantidade: 845 }), true);
  assert.equal(c.quantidadeCatalogoWppPronta(0), false, 'Vazio transitorio nao conclui');
  assert.equal(c.quantidadeCatalogoWppPronta(3), false, 'Catalogo parcial nao conclui');
  assert.equal(c.quantidadeCatalogoWppPronta(825), false, 'Somente arquivadas ainda e parcial');
  assert.equal(c.quantidadeCatalogoWppPronta(843), true, 'Catalogo final compativel conclui');
  assert(!fonte.includes('client.getAllChats'), 'Sem API deprecated getAllChats');
  assert(!fonte.includes('WAPI.getAllChats'), 'Sem fallback deprecated direto');
  assert(!fonte.includes('mainReady ||'), 'Sem latch de QR usado como prontidao');
}

function testarDefesaSnapshotParcialMain() {
  const fonte = ler('index.js');
  let publicacoes = 0;
  const conversasBase = Array.from({ length: 100 }, (_, indice) => ({
    id: `5511${String(indice).padStart(8, '0')}@s.whatsapp.net`,
  }));
  const c = vm.createContext({
    console: silencio,
    conversasBase,
    estadoArquivamento: new Map([['u:551100000001', false]]),
    estadoTrancamento: new Map([['u:551100000001', false]]),
    estadoAliasesPrivacidade: new Map(),
    estadoPrivacidadeConhecido: new Set(['u:551100000001']),
    estadoNaoLidasWpp: new Map(),
    estadoPrivacidadeCompleto: false,
    estadoPrivacidadePronto: false,
    sequenciaEstadoNaoLidasWpp: 0,
    geracaoEstadoNaoLidasWpp: 'teste',
    salvarCachePrivacidade: noop,
    enviarConversasMescladas: () => { publicacoes++; },
    liberarMensagensPendentesPrivacidade: noop,
    tentarLiberarFullReadyInicial: noop,
  });
  for (const nome of ['serializarId', 'chaveCanonica', 'atualizarEstadoArquivamento']) {
    vm.runInContext(funcao(fonte, nome), c);
  }
  assert.equal(c.atualizarEstadoArquivamento({ itens: [], completo: true }), false);
  assert.equal(c.estadoPrivacidadeConhecido.size, 1, 'Vazio nao apaga cache anterior');
  assert.equal(publicacoes, 0, 'Vazio nao publica lista destrutiva');
  const parcial = c.conversasBase.slice(0, 3).map((conversa) => ({
    id: conversa.id.replace('@s.whatsapp.net', '@c.us'),
    aliases: [conversa.id],
    arquivada: true,
    trancada: false,
  }));
  assert.equal(c.atualizarEstadoArquivamento({ itens: parcial, completo: true }), false);
  assert.equal(c.estadoPrivacidadeConhecido.size, 1, 'Parcial nao reduz cache anterior');
  assert.equal(publicacoes, 0, 'Parcial nao publica lista destrutiva');
  const completo = c.conversasBase.map((conversa) => ({
    id: conversa.id.replace('@s.whatsapp.net', '@c.us'),
    aliases: [conversa.id],
    arquivada: false,
    trancada: false,
  }));
  assert.equal(c.atualizarEstadoArquivamento({ itens: completo, completo: true }), true);
  assert.equal(c.estadoPrivacidadeCompleto, true);
  assert.equal(publicacoes, 1, 'Catalogo compativel publica uma vez');
}

async function testarWpp() {
  const eventos = [];
  let autenticada = false, resolverLogin, opcoes, loginChamado = 0;
  const client = {
    isAuthenticated: async () => autenticada,
    waitForLogin: () => { loginChamado++; return new Promise(resolve => { resolverLogin = resolve; }); },
    page: { waitForFunction: async () => true },
  };
  const c = vm.createContext({
    console: silencio, path, process: {}, fs: { existsSync: () => false, readlinkSync: () => { throw { code: 'ENOENT' }; } },
    workerData: { userDataPath: '/perfil-de-teste' },
    encerrando: false, client: null, fullReady: false, qrAceito: false,
    qrAguardandoLeitura: false, whatsappPronto: false, estadoPrivacidadeCompleto: false,
    prontidaoInicialFinalizada: false, preparandoProntidaoInicial: false,
    ultimoPercentualLoadingWpp: null, ultimaMensagemLoadingWpp: null,
    arquivamentosAguardandoCliente: new Map(), presencaConversaPendente: null,
    catalogoBaileys: [], timerProntidao: null, timerAtualizacao: null,
    quantidadeConversasBaileys: 1, resumoConversasBaileysRecebido: true,
    quantidadeCatalogoWppPronta: (total) => total >= 1,
    enviar: (evento, dados) => eventos.push({ evento, dados }),
    enviarEtapaSincronizacao: (etapa) => eventos.push({ evento: 'sync-stage', dados: { etapa } }),
    wppconnect: { create: async (args) => { opcoes = args; return client; } },
    registrarAckWpp: noop, registrarMensagensAoVivoWpp: noop, registrarReacoesWpp: noop,
    agendarRevalidacaoPresenca: noop, iniciarMonitorArquivamentoRapidoWpp: noop,
    clearInterval: noop, setInterval: noop,
  });
  vm.runInContext(ler('wpp-worker-modules/05-inicializacao-wpp.js'), c);
  const perfilTeste = path.resolve('/perfil-de-teste/wppconnect-profile');
  const perfilComEspacos = path.resolve('/perfil de teste/wppconnect-profile');
  assert.equal(
    c.processoWppEhChromeDoPerfil(
      {
        nome: 'chrome.exe',
        comando: `chrome.exe --user-data-dir="${perfilTeste}"`,
      },
      perfilTeste,
    ),
    true,
    'Reconhece somente o Chromium que usa exatamente o perfil do WPPConnect',
  );
  assert.equal(
    c.processoWppEhChromeDoPerfil(
      {
        nome: '/Aplicativos/Google',
        comando: `Chrome for Testing --user-data-dir="${perfilComEspacos}"`,
      },
      perfilComEspacos,
    ),
    true,
    'Reconhece o comando do Chrome no macOS mesmo com espaços no caminho',
  );
  assert.equal(
    c.processoWppEhChromeDoPerfil(
      { nome: 'chrome.exe', comando: `chrome.exe --user-data-dir="${path.resolve('/outro-perfil')}"` },
      perfilTeste,
    ),
    false,
    'Nao encerra outro Chrome do usuario',
  );
  const perfilTemporario = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsiapp-wpp-profile-'));
  const pastaDefault = path.join(perfilTemporario, 'Default');
  const pastaSessoes = path.join(pastaDefault, 'Sessions');
  const arquivoAuth = path.join(pastaDefault, 'IndexedDB', 'auth-preservada');
  const preferencias = path.join(pastaDefault, 'Preferences');
  fs.mkdirSync(pastaSessoes, { recursive: true });
  fs.mkdirSync(path.dirname(arquivoAuth), { recursive: true });
  fs.writeFileSync(path.join(pastaSessoes, 'Session_1'), 'aba antiga');
  fs.writeFileSync(path.join(pastaSessoes, 'Tabs_1'), 'aba antiga');
  fs.writeFileSync(arquivoAuth, 'credencial');
  fs.writeFileSync(preferencias, JSON.stringify({ profile: { exit_type: 'Crashed' } }));
  c.fs = fs;
  assert.equal(c.normalizarPerfilWppAntesDoChrome(perfilTemporario), 2);
  assert.deepEqual(fs.readdirSync(pastaSessoes), [], 'Remove somente a restauracao de abas');
  assert.equal(fs.readFileSync(arquivoAuth, 'utf8'), 'credencial', 'Preserva dados de autenticacao');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(preferencias, 'utf8')).profile,
    { exit_type: 'Normal', exited_cleanly: true },
  );
  fs.rmSync(perfilTemporario, { recursive: true, force: true });
  c.migrarPerfilWppLegado = noop;
  const inicio = c.iniciar();
  await tick();
  assert.equal(loginChamado, 1, 'Fluxo oficial explicitamente iniciado');
  assert.equal(opcoes.waitForLogin, false, 'Cliente disponivel durante login/logout');
  assert(!('tokenStore' in opcoes), 'Sem API deprecated de tokens');
  assert.equal(opcoes.puppeteerOptions.userDataDir, path.join('/perfil-de-teste', 'wppconnect-profile'));
  opcoes.catchQR('qr-oficial', '', 1);
  for (const status of ['inChat', 'syncing', 'isLogged', 'qrReadSuccess']) {
    opcoes.statusFind(status);
    await tick();
  }
  assert.equal(c.qrAceito, false, 'Texto nao substitui autenticacao real');
  assert.equal(eventos.filter(e => e.evento === 'sessao-autenticada' && e.dados.autenticada).length, 0);
  client.isAuthenticated = async () => { throw new Error('Execution context was destroyed'); };
  assert.equal(await c.confirmarAutenticacaoWpp('navigation'), false);
  assert.equal(c.qrAguardandoLeitura, true);
  let resolverConsulta;
  client.isAuthenticated = () => new Promise(resolve => { resolverConsulta = resolve; });
  const consulta = c.confirmarAutenticacaoWpp('consulta-antiga');
  opcoes.catchQR('qr-renovado', '', 2);
  resolverConsulta(true);
  assert.equal(await consulta, false, 'Consulta anterior a um QR novo e descartada');
  client.isAuthenticated = async () => autenticada;
  autenticada = true;
  opcoes.statusFind('qrReadSuccess');
  await tick();
  resolverLogin(true);
  await inicio;
  assert.equal(c.qrAceito, true);
  assert.equal(c.qrAguardandoLeitura, false);
  assert.equal(eventos.filter(e => e.evento === 'sessao-autenticada' && e.dados.autenticada).length, 1);
  autenticada = false;
  assert.equal(await c.confirmarAutenticacaoWpp('revogado'), false);
  assert.equal(c.qrAceito, false);
  assert.equal(c.fullReady, false);
  autenticada = true;
  assert.equal(await c.confirmarAutenticacaoWpp('restaurado'), true);
  // FULL_READY com snapshot incompleto ou revogado nao libera a interface.
  c.fullReady = true; c.sincronizando = false; c.ultimoEstado = []; c.aliasesParaChat = new Map();
  c.atualizarEstadoArquivamento = async () => [];
  assert.equal(await c.concluirProntidaoInicial(), false);
  c.atualizarEstadoArquivamento = async () => { c.estadoPrivacidadeCompleto = true; return []; };
  assert.equal(await c.concluirProntidaoInicial(), false, 'Snapshot vazio nao libera a interface');
  c.ultimoEstado = [{ id: '551100000001@c.us' }];
  c.aliasesParaChat.set('u:551100000001', '551100000001@c.us');
  c.atualizarEstadoArquivamento = async () => c.ultimoEstado;
  assert.equal(await c.concluirProntidaoInicial(), true, 'Catalogo atual libera a interface');
  assert(eventos.some(e => e.evento === 'sync-stage' && e.dados.etapa === 'full-ready'));
}

async function testarBaileys() {
  const fonte = ler('whatsapp-worker.js');
  const inicio = fonte.indexOf('    sock.ev.on("connection.update"');
  const fim = fonte.indexOf('    sock.ev.on("lid-mapping.update"', inicio);
  let handler, resolverQR;
  const eventos = [], reconexoes = [];
  const c = vm.createContext({
    sock: { ev: { on: (_, fn) => { handler = fn; } } },
    minhaGeracao: 1, geracaoSocket: 1, baileysConectadoParaFotos: false,
    baileysConectadoEm: 0, conectando: true, resetandoSessao: false, encerrando: false,
    falhas428Consecutivas: 0, primeiraFalha428Em: 0, ressincronizacaoAppStateExecutada: false,
    console: silencio, QRCode: { toDataURL: () => new Promise(resolve => { resolverQR = resolve; }) },
    enviar: (evento, dados) => eventos.push({ evento, dados }),
    enviarEtapaSincronizacao: noop, limparTimerReconexao: noop, setTimeout: noop,
    agendarReconexao: ms => reconexoes.push(ms), DisconnectReason: { loggedOut: 401 }, state: { creds: {} },
    recriarSessaoParaQr: async () => eventos.push({ evento: 'reset-auth-only' }),
  });
  vm.runInContext(fonte.slice(inicio, fim), c);
  const qr = handler({ qr: 'primeiro' });
  await handler({ connection: 'open' });
  resolverQR('qr-atrasado'); await qr;
  assert(!eventos.some(e => e.evento === 'qr' && e.dados), 'QR atrasado nao reaparece apos open');
  assert(eventos.some(e => e.evento === 'sessao-autenticada' && e.dados.autenticada));
  await handler({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  assert.equal(eventos.filter(e => e.evento === 'sessao-autenticada').at(-1).dados.autenticada, false);
  assert.deepEqual(reconexoes, [2500], 'restartRequired reconecta sem apagar credenciais');
  await handler({ connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert(eventos.some(e => e.evento === 'reset-auth-only'));
  const total = eventos.length;
  c.geracaoSocket = 2; await handler({ connection: 'open' });
  assert.equal(eventos.length, total, 'Socket antigo nao autentica');
}

function testarRendererEWrappers() {
  const { criarModuloSincronizacaoInicial } = require('../renderer-modules/sincronizacao-inicial');
  const elemento = () => ({ classList: { add: noop, remove: noop, toggle: noop }, querySelector: () => elemento(), remove: noop });
  const setIntervalOriginal = global.setInterval, setTimeoutOriginal = global.setTimeout;
  global.setInterval = noop; global.setTimeout = noop;
  try {
    const ui = criarModuloSincronizacaoInicial({ document: { createElement: elemento, body: { appendChild: noop } } });
    ui.aplicarEtapaSincronizacao({ etapa: 'full-ready', origem: 'wpp' });
    assert.equal(ui.obterSincronizacaoInicialConcluida(), false);
    ui.aplicarEtapaSincronizacao({ etapa: 'full-ready', origem: 'bootstrap' });
    assert.equal(ui.obterSincronizacaoInicialConcluida(), true);
  } finally { global.setInterval = setIntervalOriginal; global.setTimeout = setTimeoutOriginal; }
  for (const eol of ['\n', '\r\n']) {
    let codigo;
    vm.runInNewContext(ler('wpp-worker-live-wrapper.js'), {
      require: id => id === 'fs' ? { readFileSync: arquivo => fs.readFileSync(arquivo, 'utf8').replace(/\r?\n/g, eol) } : require(id),
      __dirname: raiz, __filename: path.join(raiz, 'wpp-worker-live-wrapper.js'), module: { exports: {} },
      Function: function (...args) { codigo = args.at(-1); new Function(...args); return noop; },
    });
    assert(codigo.includes('logout-sessao-viva'));
    assert(!codigo.includes('QR FALLBACK'));
    let compilado;
    class Modulo {
      static _nodeModulePaths() { return []; }
      _compile(fonte) { new vm.Script(fonte); compilado = fonte; }
    }
    vm.runInNewContext(ler('whatsapp-worker-live-wrapper.js'), {
      require: id => id === 'module' ? Modulo : id === 'fs' ? { readFileSync: arquivo => fs.readFileSync(arquivo, 'utf8').replace(/\r?\n/g, eol) } : require(id),
      __dirname: raiz, module: {},
    });
    assert(compilado.includes('logout-sessao-viva'));
  }
}

(async () => {
  testarSequencia(); console.log('Autenticacao: sequencia, 4 combinacoes de sessoes, cache e reinicio PASS');
  testarCatalogoWpp(); console.log('Autenticacao: catalogo WPP transitorio, final e APIs atuais PASS');
  testarDefesaSnapshotParcialMain(); console.log('Autenticacao: snapshot parcial nao apaga conversas PASS');
  await testarWpp(); console.log('Autenticacao: API WPP, QR renovado, navegacao, revogacao e snapshot PASS');
  await testarBaileys(); console.log('Autenticacao: open/QR/515/401 e socket obsoleto PASS');
  testarRendererEWrappers(); console.log('Autenticacao: interface e wrappers LF/CRLF com logout remoto PASS');
})().catch(erro => { console.error(erro); process.exitCode = 1; });
