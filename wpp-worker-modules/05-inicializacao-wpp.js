function confirmarAutenticacaoWpp(origem) {
  if (qrAceito) return;
  qrAguardandoLeitura = false;
  qrAceito = true;
  enviarEtapaSincronizacao("wpp-autenticado", origem);
  enviar("wpp-ready", { conectado: true, sincronizando: true });
}

function limparBloqueioPerfilWppStale() {
  const perfil = path.join(
    workerData.userDataPath,
    "wppconnect-profile",
  );
  const bloqueio = path.join(perfil, "SingletonLock");

  try {
    const alvo = fs.readlinkSync(bloqueio);
    const pid = Number(String(alvo).match(/-(\d+)$/)?.[1] || 0);
    if (pid > 0) {
      try {
        process.kill(pid, 0);
        console.warn(`WPPConnect: perfil ainda usado pelo Chrome (pid=${pid}).`);
        return;
      } catch (erro) {
        if (erro?.code !== "ESRCH") return;
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
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      console.warn("WPPConnect: não foi possível verificar bloqueio do perfil:", erro?.message || erro);
    }
  }
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

  const executavel = path.join(
    process.resourcesPath,
    "wppconnect-chrome",
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing",
  );

  return fs.existsSync(executavel) ? executavel : null;
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

    const estado = await atualizarEstadoArquivamento(true, true);

    const temEstado =
      Array.isArray(estado) && estado.length > 0 && ultimoEstado.length > 0;

    const aliasesProntos = aliasesParaChat.size > 0;

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

  timerProntidao = setInterval(async () => {
    if (encerrando || !client) {
      return;
    }

    const agoraPronto = await verificarProntidao();

    if (agoraPronto && !prontidaoInicialFinalizada) {
      await concluirProntidaoInicial();
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

  const tokenStore = new wppconnect.tokenStore.FileTokenStore({
    path: path.join(workerData.userDataPath, "wppconnect-tokens"),
  });

  enviar("wpp-status", {
    texto: "Iniciando módulo de Arquivadas...",
  });

  ultimoPercentualLoadingWpp = null;
  ultimaMensagemLoadingWpp = null;

  enviarEtapaSincronizacao("wpp-create-call");

  migrarPerfilWppLegado();
  limparBloqueioPerfilWppStale();

  client = await wppconnect.create({
    session: "whatsiapp-arquivo",

    tokenStore,

    headless: true,
    logQR: false,

    // Evita encerrar a sessão enquanto
    // o WhatsApp Web ainda está sincronizando.
    autoClose: 600000,

    // Presence must become available as soon as the WPP client exists.
    // Do not wait for the whole device sync to finish before returning the client.
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
      qrAceito = false;
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
        qrAceito = false;
      }

      if (statusNormalizado === "qrreadsuccess" || statusNormalizado === "islogged") {
        // Somente estes estados confirmam que o QR foi aceito. Estados como
        // syncing/inchat podem chegar antes da leitura e não podem esconder
        // o QR que o usuário ainda precisa escanear.
        qrAguardandoLeitura = false;
        confirmarAutenticacaoWpp(statusNormalizado);
      } else if (
        statusNormalizado === "inchat" ||
        statusNormalizado === "syncing"
      ) {
        if (qrAguardandoLeitura) {
          enviarEtapaSincronizacao(
            statusNormalizado === "syncing"
              ? "wpp-sincronizando"
              : "wpp-interface",
            statusNormalizado,
          );
          enviar("wpp-status", {
            texto: `${statusTexto} — aguardando leitura do QR Code`,
          });
          return;
        }

        qrAceito = true;

        if (statusNormalizado === "syncing") {
          enviarEtapaSincronizacao("wpp-sincronizando", statusNormalizado);
        } else if (statusNormalizado === "inchat") {
          enviarEtapaSincronizacao("wpp-interface", statusNormalizado);
        }

        // Fecha o modal de QR assim que o celular aceita a leitura.
        // A sincronização do WPPConnect continua em background.
        enviar("wpp-ready", {
          conectado: true,
          sincronizando: statusNormalizado === "syncing",
        });
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
}
