async function marcarConversaComoLidaWpp(dados = {}) {
  if (!client || typeof client.sendSeen !== "function") {
    return {
      ok: false,
      erro: "WPPConnect ainda nao esta pronto para enviar leitura.",
    };
  }

  const conversaId = String(dados?.conversaId || "").trim();

  if (!conversaId) {
    return {
      ok: false,
      erro: "Conversa invalida.",
    };
  }

  const candidatos = [];
  const adicionarCandidato = (valor) => {
    const id = normalizarId(valor);

    if (id && !candidatos.includes(id)) {
      candidatos.push(id);
    }
  };

  try {
    adicionarCandidato(await resolverChatId(conversaId));
  } catch {}

  adicionarCandidato(converterBaileysParaWpp(conversaId));
  adicionarCandidato(conversaId);

  let ultimoErro = null;

  for (const chatId of candidatos) {
    try {
      const resultado = await Promise.race([
        Promise.resolve(client.sendSeen(chatId)),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("Timeout ao enviar leitura pelo WPPConnect.")),
            6000,
          );
        }),
      ]);

      // Atualiza o snapshot do proprio WPP logo depois do sendSeen.
      // O renderer ja zerou visualmente, isto serve para consolidar a
      // autoridade remota e evitar que um estado anterior reapareca.
      setTimeout(() => {
        if (!encerrando && fullReady) {
          atualizarEstadoArquivamento(true, false).catch(() => {});
        }
      }, 180);

      console.log(
        `[LEITURA WPP] SEND_SEEN_OK | conversa=${conversaId} | chat=${chatId} | ` +
          `unread=${Number(resultado?.unreadCount || 0) || 0}`,
      );

      return {
        ok: true,
        conversaId,
        chatId,
        naoLidas: Number(resultado?.unreadCount || 0) || 0,
      };
    } catch (erro) {
      ultimoErro = erro;
    }
  }

  console.warn(
    `[LEITURA WPP] SEND_SEEN_FALHOU | conversa=${conversaId} | ` +
      `erro=${String(ultimoErro?.message || ultimoErro || "unknown")}`,
  );

  return {
    ok: false,
    erro:
      ultimoErro?.message ||
      "WPPConnect nao conseguiu marcar a conversa como lida.",
  };
}

async function responderSolicitacao(id, acao, dados) {
  try {
    if (acao === "marcar-conversa-lida") {
      const resultado = await marcarConversaComoLidaWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "recuperar-midia-historica") {
      const resultado = await recuperarMidiaHistoricaWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "listar-midia-links-docs") {
      const resultado = await listarMidiaLinksDocsHistoricoWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === 'buscar-historico-recente-conversa') {
      const resultado = await buscarHistoricoRecenteConversaWpp(dados || {});
      parentPort.postMessage({ tipo: 'resposta', id, resultado });
      return;
    }
    if (acao === "buscar-historico-gap") {
      const resultado = await buscarHistoricoGapWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "listar-contatos-salvos") {
      const contatos = await listarContatosSalvosWpp();

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          contatos,
        },
      });

      return;
    }

    if (acao === "verificar-numero-whatsapp") {
      const resultado = await verificarNumeroWhatsappWpp(dados?.numero);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "listar-figurinhas") {
      const figurinhas = await listarFigurinhasWpp();

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          figurinhas,
        },
      });

      return;
    }

    if (acao === "enviar-figurinha") {
      const resultado = await enviarFigurinhaWpp(
        dados?.conversaId,
        dados?.dataUrl,
        dados?.resposta,
        {
          mimetype: dados?.mimetype,
          animated: dados?.animated,
          origem: dados?.origem,
          idOrigem: dados?.idOrigem,
        },
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "enviar-contato") {
      const resultado = await enviarContatoWpp(
        dados?.conversaId,
        dados?.contatoId,
        dados?.numeroWhatsapp,
        dados?.nome,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "listar-grupos-atuais") {
      const grupos = await listarGruposAtuaisWpp();

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          grupos,
        },
      });

      return;
    }

    if (acao === "listar-grupos-em-comum") {
      const grupos = await listarGruposEmComumWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          grupos,
        },
      });

      return;
    }

    if (acao === "listar-participantes-grupo") {
      const resultado = await listarParticipantesGrupoWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          participantes: resultado.participantes,
          autoresMensagens: Array.isArray(resultado.autoresMensagens)
            ? resultado.autoresMensagens
            : [],
          euNoGrupo: resultado.euNoGrupo,
          total: resultado.total,
        },
      });

      return;
    }

    if (acao === "sair-grupo") {
      const resultado = await sairGrupoWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "listar-status") {
      const resultado = await listarStatusWpp();

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "carregar-midia-status") {
      const resultado = await baixarMidiaStatusWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "marcar-status-visto") {
      const resultado = await marcarStatusVistoWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "reagir-status") {
      const resultado = await reagirStatusWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "responder-status") {
      const resultado = await responderStatusWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "publicar-status") {
      const resultado = await publicarStatusWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "listar-visualizadores-status") {
      const resultado = await listarVisualizadoresStatusWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === "apagar-status") {
      const resultado = await apagarStatusWpp(dados || {});

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado,
      });

      return;
    }

    if (acao === 'enviar-localizacao') {
      const resultado = await enviarLocalizacaoWpp(dados);
      parentPort.postMessage({tipo:'resposta',id,resultado:{ok:true,...resultado}});
      return;
    }
    if (acao === 'recuperar-cartoes-conversa') {
      const resultado=await recuperarCartoesConversaWpp(dados);
      parentPort.postMessage({tipo:'resposta',id,resultado:{ok:true,...resultado}});
      return;
    }
    if (acao === "enviar-texto") {
      let resultado = null;

      if (dados?.gerenciarConversa) {
        resultado = await executarOperacaoConversaWpp(
          dados.gerenciarConversa?.conversaId,
          dados.gerenciarConversa?.acao,
        );
      } else if (dados?.favoritar) {
        resultado = await favoritarMensagemWpp(
          dados.favoritar?.conversaId,
          dados.favoritar?.mensagem,
          dados.favoritar?.favoritar !== false,
        );
      } else if (dados?.reagir) {
        resultado = await reagirMensagemWpp(
          dados.reagir?.conversaId,
          dados.reagir?.mensagem,
          dados.reagir?.reacao,
        );
      } else if (dados?.editar) {
        resultado = await editarMensagemWpp(
          dados.editar?.conversaId,
          dados.editar?.mensagem,
          dados.editar?.novoTexto,
        );
      } else if (dados?.excluir) {
        resultado = await apagarMensagemWpp(
          dados.excluir?.conversaId,
          dados.excluir?.mensagem,
          !!dados.excluir?.paraTodos,
        );
      } else if (dados?.encaminhar) {
        resultado = await encaminharMensagemWpp(
          dados.encaminhar?.conversaOrigemId,
          dados.encaminhar?.conversaDestinoId,
          dados.encaminhar?.mensagem,
        );
      } else {
        resultado = await enviarTextoWpp(
          dados?.conversaId,
          dados?.texto,
          dados?.resposta,
          dados?.idLocalEnvio,
        );
      }

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "enviar-anexo") {
      const resultado = await enviarAnexoWpp(
        dados?.conversaId,
        dados?.caminho,
        dados?.tipo,
        dados?.legenda,
        dados?.resposta,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "enviar-audio-gravado") {
      const resultado = await enviarAudioGravadoWpp(
        dados?.conversaId,
        dados?.bytes,
        dados?.mime,
        dados?.resposta,
      );

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "assinar-presenca") {
      const resultado = await assinarPresencaWpp(dados?.conversaId);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          ...resultado,
        },
      });

      return;
    }

    if (acao === "arquivar") {
      const conversaId = dados?.conversaId;
      const arquivar = !!dados?.arquivar;

      if (!client) {
        const enfileirado = enfileirarArquivamentoAguardandoCliente(
          conversaId,
          arquivar,
        );

        parentPort.postMessage({
          tipo: "resposta",
          id,
          resultado: enfileirado
            ? {
                ok: true,
                arquivada: arquivar,
                pendente: true,
              }
            : {
                ok: false,
                erro: "Nao consegui identificar a conversa para arquivar.",
              },
        });

        return;
      }

      await arquivarConversa(conversaId, arquivar);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          arquivada: arquivar,
          estado: ultimoEstado,
        },
      });

      return;
    }

    if (acao === "atualizar-estado") {
      const estado = await atualizarEstadoArquivamento(true, true);

      parentPort.postMessage({
        tipo: "resposta",
        id,
        resultado: {
          ok: true,
          estado,
        },
      });

      return;
    }

    parentPort.postMessage({
      tipo: "resposta",
      id,
      resultado: {
        ok: false,
        erro: `Ação desconhecida: ${acao}`,
      },
    });
  } catch (erro) {
    console.error("Erro no WPP worker:", erro);

    parentPort.postMessage({
      tipo: "resposta",
      id,
      resultado: {
        ok: false,
        erro: erro?.message || "Erro no módulo de arquivamento.",
        codigo: erro?.codigo || null,
        caminhoFallback: erro?.caminhoFallback || null,
        detalhe: erro?.causa || null,
      },
    });
  }
}

async function encerrar() {
  encerrando = true;

  clearInterval(timerAtualizacao);
  pararMonitorArquivamentoRapidoWpp();

  clearInterval(timerProntidao);

  clearTimeout(timerCatalogo);
  clearTimeout(timerArquivamentosAguardando);
  clearTimeout(timerRevalidacaoPresenca);
  limparReforcosPresencaWpp();
  presencaIdsAssinadosWpp.clear();
  arquivamentosAguardandoCliente.clear();

  try {
    listenerPresenca?.dispose?.();
  } catch {}

  listenerPresenca = null;
  presencaConversaPendente = null;

  try {
    listenerAckWpp?.dispose?.();
  } catch {}

  listenerAckWpp = null;

  try {
    listenerMensagensWpp?.dispose?.();
  } catch {}

  listenerMensagensWpp = null;

  try {
    listenerReacoesWpp?.dispose?.();
  } catch {}

  listenerReacoesWpp = null;

  try {
    enviar("wpp-live-ready", {
      ativo: false,
    });
  } catch {}

  try {
    client?.stopPhoneWatchdog?.();
  } catch {}

  try {
    await client?.close?.();
  } catch {}

  setTimeout(() => process.exit(0), 150);
}

parentPort.on("message", (mensagem) => {
  if (!mensagem) return;

  if (mensagem.tipo === "solicitacao") {
    responderSolicitacao(mensagem.id, mensagem.acao, mensagem.dados || {});

    return;
  }

  if (mensagem.tipo === "catalogo-conversas") {
    // Ignorado de proposito.
    // O catalogo do Baileys pode conter chats historicos/apagados.
    // A lista atual deve vir exclusivamente do WhatsApp Web/WPPConnect.
    return;
  }

  if (mensagem.tipo === "resumo-conversas-baileys") {
    receberResumoConversasBaileys(mensagem.dados || {});
    return;
  }

  if (mensagem.tipo === "encerrar") {
    encerrar();
  }
});

iniciar().catch(async (erro) => {
  console.error("Falha ao iniciar WPPConnect:", erro);

  enviar("wpp-status", {
    texto: erro?.message || "Falha ao iniciar módulo de Arquivadas.",
  });

  // Se a inicialização falhar depois que o Chromium abriu, feche-o antes de
  // encerrar o worker. Isso evita deixar o perfil bloqueado para a tentativa
  // seguinte e impede a restauração de várias abas do WhatsApp.
  try {
    await client?.close?.();
  } catch {}

  throw erro;
});
