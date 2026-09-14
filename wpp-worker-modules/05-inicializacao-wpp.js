let revisaoAutenticacaoWpp = 0;
let verificacaoAutenticacaoWpp = null;

function invalidarAutenticacaoWpp(origem) {
  revisaoAutenticacaoWpp++;
  qrAceito = false;
  fullReady = false;
  whatsappPronto = false;
  prontidaoInicialFinalizada = false;
  estadoPrivacidadeCompleto = false;
  enviar("sessao-autenticada", { autenticada: false, origem });
}

async function confirmarAutenticacaoWpp(origem) {
  if (encerrando || !client) return false;
  if (verificacaoAutenticacaoWpp) return verificacaoAutenticacaoWpp;

  const revisao = revisaoAutenticacaoWpp;
  verificacaoAutenticacaoWpp = (async () => {
    // inChat, MAIN e FULL_READY sao estados da pagina, nao prova de login.
    // Falha de contexto durante navegacao e desconhecida, nunca autenticada.
    const autenticada = await client.isAuthenticated().catch(() => null);
    if (encerrando || revisao !== revisaoAutenticacaoWpp) return false;
    if (autenticada !== true) {
      if (autenticada === false && qrAceito) invalidarAutenticacaoWpp(origem);
      return false;
    }
    if (!qrAceito) {
      qrAceito = true;
      qrAguardandoLeitura = false;
      enviar("sessao-autenticada", { autenticada: true, origem });
      enviarEtapaSincronizacao("wpp-autenticado", origem);
      enviar("wpp-qr-read", { status: origem });
      enviar("wpp-ready", {
        conectado: true,
        sincronizando: true,
        qrConfirmado: true,
      });
    }
    return true;
  })();
  try {
    return await verificacaoAutenticacaoWpp;
  } finally {
    verificacaoAutenticacaoWpp = null;
  }
}

function processoWppExiste(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    return erro?.code !== "ESRCH";
  }
}

function executarProcessoWpp(arquivo, argumentos, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(
      arquivo,
      argumentos,
      { encoding: "utf8", timeout, windowsHide: true },
      (erro, stdout, stderr) => {
        if (erro) {
          reject(erro);
          return;
        }

        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      },
    );
  });
}

async function obterProcessoWpp(pid) {
  try {
    if (process.platform === "win32") {
      const script =
        `$p = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"; ` +
        `if ($p) { $p | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress }`;
      const { stdout } = await executarProcessoWpp(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
      );
      const dados = stdout.trim() ? JSON.parse(stdout.trim()) : null;
      return dados
        ? {
            pid: Number(dados.ProcessId || pid),
            ppid: Number(dados.ParentProcessId || 0),
            nome: String(dados.Name || ""),
            comando: String(dados.CommandLine || ""),
          }
        : null;
    }

    const { stdout } = await executarProcessoWpp("ps", [
      "-p",
      String(pid),
      "-o",
      "ppid=",
      "-o",
      "comm=",
      "-o",
      "command=",
    ]);
    const linha = stdout.trim();
    const match = linha.match(/^\s*(\d+)\s+(\S+)\s+([\s\S]+)$/);

    return match
      ? {
          pid,
          ppid: Number(match[1] || 0),
          nome: String(match[2] || ""),
          comando: String(match[3] || ""),
        }
      : null;
  } catch (erro) {
    console.warn(
      `WPPConnect: não foi possível inspecionar o processo ${pid}:`,
      erro?.message || erro,
    );
    return null;
  }
}

function processoWppEhChromeDoPerfil(processo, perfil) {
  const nome = String(processo?.nome || "").toLowerCase();
  const comando = String(processo?.comando || "");
  const perfilNormalizado = path.resolve(perfil);
  const processoTexto = `${nome} ${comando}`.toLowerCase();
  const comandoNormalizado = comando.toLowerCase();
  const pareceChrome =
    processoTexto.includes("chrome") || processoTexto.includes("chromium");
  const argumentosPerfil = [
    `--user-data-dir=${perfilNormalizado}`,
    `--user-data-dir=\"${perfilNormalizado}\"`,
    `--user-data-dir='${perfilNormalizado}'`,
  ];

  return (
    pareceChrome &&
    argumentosPerfil.some((argumento) =>
      comandoNormalizado.includes(argumento.toLowerCase()),
    )
  );
}

async function encerrarChromeWppOrfao(pid, perfil) {
  const processo = await obterProcessoWpp(pid);

  if (!processo || !processoWppEhChromeDoPerfil(processo, perfil)) {
    return false;
  }

  const paiExiste = processoWppExiste(processo.ppid);
  const orfao =
    process.platform === "win32"
      ? processo.ppid <= 0 || !paiExiste
      : processo.ppid === 1;

  if (!orfao) {
    console.warn(
      `WPPConnect: perfil em uso por uma instância ativa ` +
        `(chrome=${pid}, parent=${processo.ppid}).`,
    );
    return false;
  }

  console.warn(
    `WPPConnect: encerrando Chromium órfão do perfil ` +
      `(chrome=${pid}, parent=${processo.ppid}).`,
  );

  try {
    if (process.platform === "win32") {
      await executarProcessoWpp(
        "taskkill.exe",
        ["/PID", String(pid), "/T", "/F"],
        10000,
      );
    } else {
      process.kill(pid, "SIGTERM");

      for (let tentativa = 0; tentativa < 30 && processoWppExiste(pid); tentativa++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (processoWppExiste(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
  } catch (erro) {
    if (processoWppExiste(pid)) {
      console.warn(
        `WPPConnect: falha ao encerrar Chromium órfão ${pid}:`,
        erro?.message || erro,
      );
      return false;
    }
  }

  return !processoWppExiste(pid);
}

async function limparBloqueioPerfilWppStale() {
  const perfil = path.join(
    workerData.userDataPath,
    "wppconnect-profile",
  );
  const bloqueio = path.join(perfil, "SingletonLock");

  try {
    const alvo = fs.readlinkSync(bloqueio);
    const pid = Number(String(alvo).match(/-(\d+)$/)?.[1] || 0);
    if (pid > 0 && processoWppExiste(pid)) {
      const encerrado = await encerrarChromeWppOrfao(pid, perfil);

      if (!encerrado && processoWppExiste(pid)) {
        console.warn(`WPPConnect: perfil ainda usado pelo Chrome (pid=${pid}).`);
        return false;
      }
    }

    for (const nome of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
      try {
        fs.unlinkSync(path.join(perfil, nome));
      } catch (erro) {
        if (erro?.code !== "ENOENT") {
          console.warn(`WPPConnect: não removi ${nome}:`, erro?.message || erro);
        }
      }
    }
    console.log("WPPConnect: bloqueio stale do perfil removido.");
    return true;
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      console.warn("WPPConnect: não foi possível verificar bloqueio do perfil:", erro?.message || erro);
    }
    return erro?.code === "ENOENT";
  }
}

function normalizarPerfilWppAntesDoChrome(perfil) {
  const pastaDefault = path.join(perfil, "Default");
  const pastaSessoes = path.join(pastaDefault, "Sessions");
  const preferencias = path.join(pastaDefault, "Preferences");
  let sessoesRemovidas = 0;

  // Um Chromium morto à força grava todas as abas para restauração. Depois de
  // várias tentativas, dezenas de WhatsApp Web são restaurados ao mesmo tempo
  // e cada um mostra "aberto em outra janela". Esses arquivos guardam abas,
  // não a autenticação do WhatsApp, que permanece no restante do perfil.
  try {
    for (const nome of fs.readdirSync(pastaSessoes)) {
      fs.rmSync(path.join(pastaSessoes, nome), {
        recursive: true,
        force: true,
      });
      sessoesRemovidas++;
    }
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      console.warn(
        "WPPConnect: não foi possível limpar abas restauradas:",
        erro?.message || erro,
      );
    }
  }

  try {
    const dados = JSON.parse(fs.readFileSync(preferencias, "utf8"));
    dados.profile = dados.profile || {};
    dados.profile.exit_type = "Normal";
    dados.profile.exited_cleanly = true;

    const temporario = `${preferencias}.whatsiapp.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(dados), "utf8");
    fs.renameSync(temporario, preferencias);
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      console.warn(
        "WPPConnect: não foi possível normalizar o estado do Chromium:",
        erro?.message || erro,
      );
    }
  }

  if (sessoesRemovidas > 0) {
    console.log(
      `WPPConnect: ${sessoesRemovidas} arquivos de abas antigas removidos; ` +
        "autenticação preservada.",
    );
  }

  return sessoesRemovidas;
}

function migrarPerfilWppLegado() {
  const destino = path.join(
    workerData.userDataPath,
    "wppconnect-profile",
  );
  const origem = path.resolve(process.cwd(), "tokens", "whatsiapp-arquivo");

  try {
    if (fs.existsSync(destino) || !fs.existsSync(origem)) {
      return false;
    }

    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.cpSync(origem, destino, { recursive: true, errorOnExist: false });
    console.log("WPPConnect: perfil legado migrado para a pasta de dados do aplicativo.");
    return true;
  } catch (erro) {
    console.warn(
      "WPPConnect: nao foi possivel migrar o perfil legado:",
      erro?.message || erro,
    );
    return false;
  }
}

function obterChromeEmpacotado() {
  if (!process.resourcesPath) {
    return null;
  }

  const executavel = require('./scripts/recursos-desktop').caminhoChrome(process.resourcesPath);

  return executavel && fs.existsSync(executavel) ? executavel : null;
}

function registrarEventosDeEstado() {
  if (!client) return;

  try {
    client.onStateChange?.((state) => {
      estadoConexao = String(state || "");

      console.log(`WPPConnect onStateChange: ${estadoConexao}`);

      if (estadoConexao.toUpperCase() === "CONNECTED") {
        confirmarAutenticacaoWpp("state:CONNECTED");
      }

      if (["CONNECTED", "NORMAL"].includes(estadoConexao.toUpperCase())) {
        whatsappPronto = true;
        enviarEtapaSincronizacao("wpp-interface", estadoConexao);

        if (prontidaoInicialFinalizada) {
          agendarLeituraImediata();
        }

        if (presencaConversaPendente) {
          executarPresencaPendente().catch(() => {});
        }

        agendarRevalidacaoPresenca(700, `state:${estadoConexao}`);
      }
    });
  } catch {}

  try {
    client.onStreamModeChanged?.((mode) => {
      modoStream = String(mode || "");

      console.log(`WPPConnect stream mode: ${modoStream}`);

      if (modoStream.toUpperCase() === "MAIN") {
        confirmarAutenticacaoWpp("stream:MAIN");
        whatsappPronto = true;
        enviarEtapaSincronizacao("wpp-interface", "MAIN");

        if (prontidaoInicialFinalizada) {
          agendarLeituraImediata();
        }

        if (presencaConversaPendente) {
          executarPresencaPendente().catch(() => {});
        }

        agendarRevalidacaoPresenca(700, "stream:MAIN");
      }
    });
  } catch {}

  try {
    client.onStreamInfoChanged?.((info) => {
      infoStream = String(info?.mode || info?.state || info || "");

      console.log(`WPPConnect stream info: ${infoStream}`);

      if (infoStream.toUpperCase() === "NORMAL") {
        whatsappPronto = true;
        enviarEtapaSincronizacao("wpp-interface", "NORMAL");

        if (prontidaoInicialFinalizada) {
          agendarLeituraImediata();
        }

        if (presencaConversaPendente) {
          executarPresencaPendente().catch(() => {});
        }

        agendarRevalidacaoPresenca(700, "stream-info:NORMAL");
      }
    });
  } catch {}
}

async function concluirProntidaoInicial() {
  if (
    encerrando ||
    !client ||
    !fullReady ||
    !qrAceito ||
    prontidaoInicialFinalizada ||
    preparandoProntidaoInicial
  ) {
    return false;
  }

  // Pode existir uma leitura disparada por CONNECTED/NORMAL que começou
  // antes do FULL_READY. Ela usa um snapshot parcial e nao resolve todos
  // os aliases LID -> telefone. Espera essa leitura acabar e tenta de novo
  // no proximo ciclo, agora com FULL_READY verdadeiro.
  if (sincronizando) {
    return false;
  }

  preparandoProntidaoInicial = true;

  try {
    console.log(
      "WPPConnect: preparando chats e aliases antes de liberar o WhatsIAPP.",
    );

    enviarEtapaSincronizacao(
      "wpp-preparando-chats",
      "Carregando chats e aliases",
    );

    const revisao = revisaoAutenticacaoWpp;
    const estado = await atualizarEstadoArquivamento(true, true);
    if (encerrando || !qrAceito || revisao !== revisaoAutenticacaoWpp) return false;

    // Uma conta sem conversas tambem pode estar completamente sincronizada.
    const temEstado = Array.isArray(estado);
    const aliasesProntos = temEstado && (estado.length === 0 || aliasesParaChat.size > 0);

    const pronto = estadoPrivacidadeCompleto && temEstado && aliasesProntos;

    if (!pronto) {
      console.log(
        `WPPConnect: estado inicial ainda incompleto ` +
          `(chats=${ultimoEstado.length}, aliases=${aliasesParaChat.size}, ` +
          `completo=${estadoPrivacidadeCompleto}).`,
      );

      return false;
    }

    prontidaoInicialFinalizada = true;

    console.log(
      `WPPConnect: prontidao real confirmada, ` +
        `${ultimoEstado.length} chats e ${aliasesParaChat.size} aliases.`,
    );

    enviarEtapaSincronizacao(
      "wpp-chats-prontos",
      `${ultimoEstado.length} chats | ${aliasesParaChat.size} aliases`,
    );

    // ESTE e o unico ponto que libera a interface do WhatsIAPP.
    // FULL_READY do WA-JS sozinho nao e suficiente.
    enviarEtapaSincronizacao("full-ready", "FULL_READY + CHATS + ALIASES");

    if (catalogoBaileys.length) {
      receberCatalogoBaileys(catalogoBaileys);
    }

    return true;
  } catch (erro) {
    console.error(
      "WPPConnect: erro ao preparar prontidao inicial:",
      erro?.message || erro,
    );

    return false;
  } finally {
    preparandoProntidaoInicial = false;
  }
}

function iniciarMonitorProntidao() {
  clearInterval(timerProntidao);

  let verificando = false;
  timerProntidao = setInterval(async () => {
    if (encerrando || !client || verificando) {
      return;
    }

    verificando = true;
    try {
      const agoraPronto = await verificarProntidao();
      if (agoraPronto && !prontidaoInicialFinalizada) {
        await concluirProntidaoInicial();
      }
    } catch (erro) {
      console.warn("WPPConnect: falha ao verificar prontidao:", erro?.message || erro);
    } finally {
      verificando = false;
    }
  }, 500);
}

function iniciarPolling() {
  clearInterval(timerAtualizacao);

  // Monitor leve de arquivamento entre dispositivos. Ele observa apenas o
  // campo archive do ChatStore e deve refletir mudancas em ate ~3 segundos.
  iniciarMonitorArquivamentoRapidoWpp();

  // A reconciliacao tambem carrega unreadCount, que agora e autoritativo.
  // Roda a cada 2s para leitura feita no celular/WhatsApp Web aparecer no
  // WhatsIAPP dentro da meta de aproximadamente 3 segundos.
  timerAtualizacao = setInterval(() => {
    if (!fullReady) {
      verificarProntidao().catch(() => {});
      return;
    }

    atualizarEstadoArquivamento(true, false).catch((erro) => {
      console.error(
        "Erro ao atualizar estado WPP:",
        erro?.message || erro,
      );
    });
  }, 2000);
}

async function iniciar() {
  prontidaoInicialFinalizada = false;
  preparandoProntidaoInicial = false;

  enviarEtapaSincronizacao("wpp-iniciando");

  enviar("wpp-status", {
    texto: "Iniciando módulo de Arquivadas...",
  });

  ultimoPercentualLoadingWpp = null;
  ultimaMensagemLoadingWpp = null;

  enviarEtapaSincronizacao("wpp-create-call");

  migrarPerfilWppLegado();
  const perfilDisponivel = await limparBloqueioPerfilWppStale();
  if (!perfilDisponivel) {
    throw new Error(
      "O perfil do WPPConnect está aberto por outra instância do WhatsIAPP.",
    );
  }
  normalizarPerfilWppAntesDoChrome(
    path.join(workerData.userDataPath, "wppconnect-profile"),
  );

  client = await wppconnect.create({
    session: "whatsiapp-arquivo",

    headless: true,
    logQR: false,

    // Evita encerrar a sessão enquanto
    // o WhatsApp Web ainda está sincronizando.
    autoClose: 600000,

    // Mantem o cliente acessivel ao logout remoto durante o login.
    // waitForLogin() e chamado explicitamente abaixo, com o cliente atribuido.
    waitForLogin: false,
    deviceSyncTimeout: 0,

    useChrome: false,
    debug: false,
    devtools: false,
    updatesLog: false,
    disableWelcome: true,
    disableGoogleAnalytics: true,

    deviceName: "WhatsIAPP Arquivadas",

    puppeteerOptions: {
      userDataDir: path.join(workerData.userDataPath, "wppconnect-profile"),
      ...(obterChromeEmpacotado()
        ? { executablePath: obterChromeEmpacotado() }
        : {}),
    },

    browserArgs: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculateNativeWinOcclusion",
    ],

    onLoadingScreen: (percent, message) => {
      registrarLoadingScreenWpp(percent, message);
    },

    catchQR: (base64Qrimg, _asciiQR, attempts) => {
      // O WPPConnect pode informar um estado antigo de "syncing/inChat"
      // antes de perceber que a sessão foi desvinculada no celular.
      // Nesse caso qrAceito poderia ficar true e esconder um QR novo.
      // Sempre que um QR real for gerado, a sessão está aguardando login.
      invalidarAutenticacaoWpp("qr");
      qrAguardandoLeitura = true;

      console.log(`WPPConnect: QR gerado, tentativa ${attempts}.`);

      enviarEtapaSincronizacao("qr");
      enviar("wpp-qr", base64Qrimg);
    },

    statusFind: (statusSession) => {
      const statusTexto = String(statusSession || "");

      console.log(`WPPConnect status: ${statusTexto}`);

      const statusNormalizado = statusTexto.toLowerCase();

      if (
        statusNormalizado === "notlogged" ||
        statusNormalizado === "disconnectedmobile" ||
        statusNormalizado === "qrreadfail" ||
        statusNormalizado === "qrreaderror" ||
        statusNormalizado === "deletetoken"
      ) {
        invalidarAutenticacaoWpp(statusNormalizado);
      }

      if (["qrreadsuccess", "islogged", "inchat", "syncing"].includes(statusNormalizado)) {
        // Apenas solicita verificacao pela API publica; nenhum texto autentica.
        void confirmarAutenticacaoWpp(statusNormalizado);
      }

      enviar("wpp-status", {
        texto: statusTexto,
      });
    },
  });

  enviarEtapaSincronizacao("wpp-create-resolved");

  if (encerrando) {
    try {
      await client.close();
    } catch {}

    return;
  }

  enviarEtapaSincronizacao("wpp-client");

  console.log(
    `WPPConnect presenca: client disponivel, liberando assinatura pendente imediatamente.`,
  );

  registrarEventosDeEstado();
  registrarAckWpp();
  registrarMensagensAoVivoWpp();
  registrarReacoesWpp();

  if (arquivamentosAguardandoCliente.size) {
    setTimeout(() => {
      processarArquivamentosAguardandoCliente().catch((erro) => {
        console.error(
          "Erro ao liberar fila inicial de arquivamento:",
          erro?.message || erro,
        );
      });
    }, 100);
  }

  if (presencaConversaPendente) {
    executarPresencaPendente().catch(() => {});
  }

  agendarRevalidacaoPresenca(650, "client-ready");

  iniciarMonitorProntidao();

  if (catalogoBaileys.length) {
    receberCatalogoBaileys(catalogoBaileys);
  }

  // waitForLogin=false devolve o cliente antes da injecao da WAPI.
  // Aguarda a API sem bloquear o polling ou deixar rejeicoes sem tratamento.
  client.page.waitForFunction(
    () => typeof window.WAPI?.startPhoneWatchdog === "function",
    { timeout: 60000 },
  ).then(() => {
    if (!encerrando) return client.startPhoneWatchdog?.(30000);
  }).catch((erro) => {
    if (!encerrando) {
      console.warn("WPPConnect: watchdog indisponivel:", erro?.message || erro);
    }
  });

  console.log("WPPConnect: aguardando FULL_READY antes de listar conversas.");

  iniciarPolling();

  // waitForLogin=false sozinho nao executa o ciclo que emite
  // notLogged/isLogged/qrReadSuccess. O QR continua vindo de catchQR.
  await client.waitForLogin();
  await confirmarAutenticacaoWpp("waitForLogin");
}
