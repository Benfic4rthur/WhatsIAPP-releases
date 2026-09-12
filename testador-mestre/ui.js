"use strict";

function criarUiTestadorMestre(deps = {}) {
  const {
    document,
    window,
    localStorage,
    shell,
    executor,
    catalogo,
    bridge,
    versao,
  } = deps;

  const CHAVE_CONFIG = "whatsiapp.testador.config.v1";
  let overlay = null;
  let observerAdmin = null;
  let elementos = null;
  let ultimoRelatorio = null;
  let perfilAtual = "rapido";
  let relatorioOverlay = null;
  let relatorioElementos = null;

  function carregarConfig() {
    try {
      const valor = JSON.parse(localStorage.getItem(CHAVE_CONFIG) || "{}");
      return valor && typeof valor === "object" ? valor : {};
    } catch {
      return {};
    }
  }

  function salvarConfig(parcial = {}) {
    const atual = carregarConfig();
    const novo = { ...atual, ...parcial };
    try {
      localStorage.setItem(CHAVE_CONFIG, JSON.stringify(novo));
    } catch {}
    return novo;
  }

  function obterAlvoTeste() {
    const valorTela = String(elementos?.alvo?.value || "").trim();
    if (valorTela) return valorTela;
    return String(carregarConfig().alvoTeste || "").trim();
  }

  function garantirEstilos() {
    if (document.getElementById("testadorMestreStyle")) return;

    const style = document.createElement("style");
    style.id = "testadorMestreStyle";
    style.textContent = `
      .tm-admin-card {
        margin-top: 16px;
        padding: 16px;
        border: 1px solid #2b3941;
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(16,26,31,.98), rgba(11,20,25,.98));
      }
      .tm-admin-card-topo { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      .tm-admin-card-titulo { color:#e9edef; font-size:15px; font-weight:800; }
      .tm-admin-card-desc { margin-top:5px; max-width:760px; color:#8fa1ab; font-size:12px; line-height:1.45; }
      .tm-admin-badge { flex:0 0 auto; padding:5px 9px; border-radius:999px; background:rgba(37,211,102,.11); border:1px solid rgba(37,211,102,.22); color:#66df92; font-size:11px; font-weight:800; }
      .tm-admin-acoes { margin-top:13px; display:flex; gap:8px; flex-wrap:wrap; }
      .tm-admin-btn { min-height:38px; padding:8px 13px; border-radius:9px; border:1px solid #30414a; background:#182329; color:#e9edef; font:inherit; font-size:12px; font-weight:750; cursor:pointer; }
      .tm-admin-btn.primario { border-color:#20b35b; background:#20b35b; color:#07120b; }
      #testadorMestreOverlay {
        position:fixed; inset:0; z-index:2147483646 !important; display:none; align-items:center; justify-content:center;
        padding:24px; box-sizing:border-box; background:rgba(0,0,0,.76); backdrop-filter:blur(5px);
      }
      #testadorMestreOverlay.aberto { display:flex; }
      .tm-painel { width:min(1180px, calc(100vw - 40px)); height:min(820px, calc(100vh - 40px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid #2b3941; border-radius:18px; background:#0c1317; box-shadow:0 30px 90px rgba(0,0,0,.62); color:#e9edef; }
      .tm-topo { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:17px 19px; border-bottom:1px solid #202a2f; background:#111a1f; }
      .tm-titulo { font-size:19px; font-weight:850; }
      .tm-subtitulo { margin-top:3px; color:#8fa1ab; font-size:11px; }
      .tm-fechar { flex:0 0 auto; width:36px; height:36px; display:grid; place-items:center; padding:0; border:1px solid #26343c; border-radius:10px; background:#182329; color:#dfe7eb; font-size:21px; line-height:1; cursor:pointer; transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease; }
      .tm-fechar:hover { background:#3a2023; border-color:#704047; color:#ffb4b4; }
      .tm-fechar:active { transform:scale(.96); }
      .tm-corpo { flex:1 1 auto; min-height:0; display:grid; grid-template-columns:330px minmax(0,1fr); }
      .tm-lateral { min-height:0; overflow:auto; padding:17px; border-right:1px solid #202a2f; background:#0f171b; }
      .tm-conteudo { min-height:0; display:flex; flex-direction:column; padding:17px; }
      .tm-bloco { margin-bottom:14px; padding:13px; border:1px solid #26343c; border-radius:12px; background:#111a1f; }
      .tm-bloco-titulo { margin-bottom:8px; color:#b9c6cc; font-size:11px; font-weight:850; text-transform:uppercase; letter-spacing:.06em; }
      .tm-select { width:100%; min-height:39px; padding:8px 10px; border:1px solid #30414a; border-radius:9px; outline:none; background:#0c1317; color:#e9edef; font:inherit; font-size:12px; }
      .tm-perfis { display:grid; gap:7px; }
      .tm-perfil { width:100%; min-height:43px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 11px; border:1px solid #30414a; border-radius:10px; background:#182329; color:#e9edef; text-align:left; cursor:pointer; }
      .tm-perfil strong { display:block; font-size:12px; }
      .tm-perfil small { display:block; margin-top:2px; color:#82959f; font-size:10px; }
      .tm-perfil.ativo { border-color:#20b35b; box-shadow:inset 0 0 0 1px rgba(32,179,91,.18); }
      .tm-perfil:disabled { opacity:.42; cursor:not-allowed; }
      .tm-mini-badge { padding:3px 6px; border-radius:999px; background:#202c33; color:#9fb0ba; font-size:9px; font-weight:800; white-space:nowrap; }
      .tm-seguranca { display:grid; gap:6px; color:#9fb0ba; font-size:10px; line-height:1.4; }
      .tm-seguranca span::before { content:'✓'; margin-right:6px; color:#63df91; font-weight:900; }
      .tm-dashboard { flex:0 0 auto; display:grid; gap:9px; }
      .tm-geral-card { min-height:76px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 16px; border:1px solid #26343c; border-radius:14px; background:linear-gradient(135deg,#111a1f,#0e171b); transition:border-color .18s ease, box-shadow .18s ease, background .18s ease; }
      .tm-geral-card.executando { border-color:rgba(83,189,235,.34); box-shadow:inset 0 0 0 1px rgba(83,189,235,.06); }
      .tm-geral-card.pass { border-color:rgba(37,211,102,.34); background:linear-gradient(135deg,rgba(20,45,32,.96),#0e171b); box-shadow:inset 0 0 0 1px rgba(37,211,102,.06); }
      .tm-geral-card.warning { border-color:rgba(255,193,7,.38); background:linear-gradient(135deg,rgba(52,43,18,.96),#0e171b); box-shadow:inset 0 0 0 1px rgba(255,193,7,.05); }
      .tm-geral-card.fail { border-color:rgba(239,83,80,.42); background:linear-gradient(135deg,rgba(54,27,28,.96),#0e171b); box-shadow:inset 0 0 0 1px rgba(239,83,80,.06); }
      .tm-geral-card.cancelado { border-color:rgba(120,144,156,.38); }
      .tm-geral-kicker { display:block; margin-bottom:4px; color:#7f929c; font-size:9px; font-weight:900; letter-spacing:.09em; text-transform:uppercase; }
      .tm-geral-titulo { display:block; font-size:18px; line-height:1.15; font-weight:900; color:#edf4f7; }
      .tm-geral-subtitulo { display:block; margin-top:5px; color:#8fa1ab; font-size:10px; }
      .tm-geral-total { flex:0 0 auto; min-width:108px; text-align:right; }
      .tm-geral-total strong { display:block; font-size:29px; line-height:1; font-weight:950; letter-spacing:-.04em; color:#e9edef; }
      .tm-geral-total span { display:block; margin-top:5px; color:#82959f; font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; }
      .tm-resumo { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .tm-resumo-item { position:relative; overflow:hidden; padding:11px 12px; border:1px solid #26343c; border-radius:11px; background:#111a1f; }
      .tm-resumo-item::before { content:''; position:absolute; left:0; top:0; bottom:0; width:3px; background:#40515a; }
      .tm-resumo-item.pass::before { background:#25d366; }
      .tm-resumo-item.warning::before { background:#f3c64f; }
      .tm-resumo-item.fail::before { background:#ef5350; }
      .tm-resumo-item strong { display:block; font-size:23px; line-height:1; font-weight:900; }
      .tm-resumo-item.pass strong { color:#6ce19a; }
      .tm-resumo-item.warning strong { color:#f6c75b; }
      .tm-resumo-item.fail strong { color:#ff8582; }
      .tm-resumo-item span { display:block; margin-top:5px; color:#82959f; font-size:9px; font-weight:850; text-transform:uppercase; letter-spacing:.06em; }
      .tm-resumo-secundario { display:flex; align-items:center; gap:14px; min-height:24px; padding:0 3px; color:#72858f; font-size:9px; font-weight:750; }
      .tm-resumo-secundario span { white-space:nowrap; }
      .tm-resumo-secundario strong { margin-left:4px; color:#a9bac2; font-size:10px; }
      .tm-progresso { flex:0 0 auto; margin-top:12px; padding:12px; border:1px solid #26343c; border-radius:11px; background:#111a1f; }
      .tm-progresso-topo { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:11px; }
      .tm-progresso-topo strong { font-size:12px; }
      .tm-barra { height:5px; margin-top:9px; overflow:hidden; border-radius:999px; background:#1b272d; }
      .tm-barra span { display:block; width:0; height:100%; background:#20b35b; transition:width .18s ease; }
      .tm-resultados { flex:1 1 auto; min-height:0; overflow:auto; margin-top:12px; padding-right:4px; }
      .tm-resultado { display:grid; grid-template-columns:72px minmax(0,1fr) auto; gap:10px; align-items:start; padding:10px 11px; margin-bottom:6px; border:1px solid #243139; border-radius:10px; background:#10191e; }
      .tm-status { padding:4px 6px; border-radius:7px; text-align:center; font-size:9px; font-weight:900; }
      .tm-status.PASS { background:rgba(37,211,102,.12); color:#6ce19a; }
      .tm-status.WARNING { background:rgba(255,193,7,.12); color:#f6c75b; }
      .tm-status.FAIL, .tm-status.BLOCKED { background:rgba(239,83,80,.13); color:#ff8582; }
      .tm-status.SKIP, .tm-status.MANUAL { background:rgba(120,144,156,.13); color:#a9bac2; }
      .tm-resultado strong { display:block; font-size:11px; }
      .tm-resultado small { display:block; margin-top:3px; color:#83969f; font-size:10px; line-height:1.35; }
      .tm-duracao { color:#667a84; font-size:9px; white-space:nowrap; }
      .tm-acoes { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; padding-top:12px; border-top:1px solid #202a2f; }
      .tm-acoes-grupo { display:flex; gap:7px; flex-wrap:wrap; }
      .tm-btn { min-height:39px; padding:8px 12px; border:1px solid #30414a; border-radius:9px; background:#182329; color:#e9edef; font:inherit; font-size:11px; font-weight:800; cursor:pointer; }
      .tm-btn.primario { border-color:#20b35b; background:#20b35b; color:#07120b; }
      .tm-btn.perigo { border-color:#6e3131; background:#402326; color:#ffaaaa; }
      .tm-btn:disabled { opacity:.4; cursor:not-allowed; }
      .tm-info { color:#7e929c; font-size:10px; line-height:1.4; }

      #testadorMestreRelatorioOverlay {
        position:fixed; inset:0; z-index:2147483647 !important; display:none;
        align-items:center; justify-content:center; padding:24px; box-sizing:border-box;
        background:rgba(0,0,0,.78); backdrop-filter:blur(5px);
      }
      #testadorMestreRelatorioOverlay.aberto { display:flex; }
      .tm-relatorio-painel {
        width:min(980px, calc(100vw - 40px)); height:min(720px, calc(100vh - 40px));
        display:flex; flex-direction:column; overflow:hidden;
        border:1px solid #2b3941; border-radius:15px; background:#0c1317;
        box-shadow:0 28px 80px rgba(0,0,0,.68); color:#e9edef;
      }
      .tm-relatorio-topo {
        flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between;
        gap:16px; padding:16px 18px; border-bottom:1px solid #202a2f; background:#111a1f;
      }
      .tm-relatorio-titulo { font-size:15px; font-weight:850; color:#edf4f7; }
      .tm-relatorio-desc {
        margin-top:4px; color:#8fa1ab; font-size:10px; line-height:1.4;
      }
      .tm-relatorio-fechar {
        flex:0 0 auto;
        width:34px;
        height:34px;
        display:grid;
        place-items:center;
        padding:0;
        border:0;
        border-radius:50%;
        background:transparent;
        color:#8fa1ab;
        font-family:Arial,Helvetica,sans-serif;
        font-size:24px;
        font-weight:400;
        line-height:1;
        cursor:pointer;
        transition:background .15s ease,color .15s ease,transform .15s ease;
      }
      .tm-relatorio-fechar:hover {
        background:rgba(239,83,80,.13);
        color:#ff8582;
      }
      .tm-relatorio-fechar:active {
        transform:scale(.92);
      }
      .tm-relatorio-corpo {
        flex:1 1 auto; min-height:0; margin:0; padding:16px 18px; overflow:auto;
        white-space:pre-wrap; word-break:break-word; font-family:Consolas,"Courier New",monospace;
        font-size:10px; line-height:1.45; color:#d7e2e7; background:#071014;
      }
      .tm-relatorio-acoes {
        flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr;
        gap:8px; padding:12px; border-top:1px solid #202a2f; background:#111a1f;
      }
      .tm-relatorio-acoes .tm-btn-fechar-relatorio { grid-column:1 / -1; }
      .tm-relatorio-feedback {
        min-height:14px; grid-column:1 / -1; color:#7e929c;
        font-size:9px; text-align:center;
      }
      @media (max-width:900px) {
        .tm-corpo { grid-template-columns:1fr; }
        .tm-lateral { max-height:260px; border-right:0; border-bottom:1px solid #202a2f; }
        .tm-geral-card { align-items:flex-start; }
        .tm-resumo { grid-template-columns:repeat(3,1fr); }
      }
    `;
    document.head.appendChild(style);
  }

  function textoRelatorioAtual() {
    return String(ultimoRelatorio?.texto || "").trim();
  }

  async function copiarRelatorioAtual() {
    const texto = textoRelatorioAtual();
    if (!texto) return false;

    try {
      if (window?.navigator?.clipboard?.writeText) {
        await window.navigator.clipboard.writeText(texto);
        return true;
      }
    } catch {}

    try {
      const area = document.createElement("textarea");
      area.value = texto;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand?.("copy") === true;
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }

  function garantirModalRelatorio() {
    if (relatorioOverlay?.isConnected) return relatorioOverlay;

    relatorioOverlay = document.createElement("div");
    relatorioOverlay.id = "testadorMestreRelatorioOverlay";
    relatorioOverlay.innerHTML = `
      <section class="tm-relatorio-painel" role="dialog" aria-modal="true" aria-label="Relatório do Testador Mestre">
        <div class="tm-relatorio-topo">
          <div>
            <div class="tm-relatorio-titulo">Relatório do Testador Mestre</div>
            <div class="tm-relatorio-desc">Resultado completo da bateria, com detalhes e observações. O arquivo também continua salvo na pasta temporária do Testador Mestre.</div>
          </div>
          <button class="tm-relatorio-fechar" type="button" aria-label="Fechar">×</button>
        </div>
        <pre class="tm-relatorio-corpo" data-tm-relatorio="texto"></pre>
        <div class="tm-relatorio-acoes">
          <button class="tm-btn" type="button" data-tm-relatorio="copiar">Copiar relatório</button>
          <button class="tm-btn" type="button" data-tm-relatorio="abrirArquivo">Abrir arquivo salvo</button>
          <div class="tm-relatorio-feedback" data-tm-relatorio="feedback"></div>
          <button class="tm-btn primario tm-btn-fechar-relatorio" type="button" data-tm-relatorio="fechar">Fechar</button>
        </div>
      </section>
    `;

    document.body.appendChild(relatorioOverlay);

    relatorioElementos = {
      texto: relatorioOverlay.querySelector('[data-tm-relatorio="texto"]'),
      copiar: relatorioOverlay.querySelector('[data-tm-relatorio="copiar"]'),
      abrirArquivo: relatorioOverlay.querySelector('[data-tm-relatorio="abrirArquivo"]'),
      fechar: relatorioOverlay.querySelector('[data-tm-relatorio="fechar"]'),
      feedback: relatorioOverlay.querySelector('[data-tm-relatorio="feedback"]'),
    };

    const fecharRelatorio = () => {
      relatorioOverlay?.classList.remove("aberto");
      return true;
    };

    relatorioOverlay.querySelector(".tm-relatorio-fechar")?.addEventListener("click", fecharRelatorio);
    relatorioElementos.fechar?.addEventListener("click", fecharRelatorio);

    relatorioOverlay.addEventListener("click", (evento) => {
      if (evento.target === relatorioOverlay) fecharRelatorio();
    });

    relatorioElementos.copiar?.addEventListener("click", async () => {
      const ok = await copiarRelatorioAtual();
      if (relatorioElementos?.feedback) {
        relatorioElementos.feedback.textContent = ok
          ? "Relatório copiado."
          : "Não foi possível copiar automaticamente.";
      }
    });

    relatorioElementos.abrirArquivo?.addEventListener("click", async () => {
      if (!ultimoRelatorio?.arquivo) return;
      try {
        await shell?.openPath?.(ultimoRelatorio.arquivo);
      } catch {}
    });

    window.addEventListener("keydown", (evento) => {
      if (
        evento.key === "Escape" &&
        relatorioOverlay?.classList.contains("aberto")
      ) {
        fecharRelatorio();
      }
    });

    return relatorioOverlay;
  }

  function abrirRelatorioInterno() {
    if (!textoRelatorioAtual()) return false;

    garantirEstilos();
    garantirModalRelatorio();

    if (relatorioElementos?.texto) {
      relatorioElementos.texto.textContent = textoRelatorioAtual();
      relatorioElementos.texto.scrollTop = 0;
    }
    if (relatorioElementos?.feedback) {
      relatorioElementos.feedback.textContent = "";
    }
    if (relatorioElementos?.abrirArquivo) {
      relatorioElementos.abrirArquivo.disabled = !ultimoRelatorio?.arquivo;
    }

    relatorioOverlay.classList.add("aberto");
    return true;
  }

  function criarOverlay() {
    if (overlay?.isConnected) return overlay;

    overlay = document.createElement("div");
    overlay.id = "testadorMestreOverlay";
    overlay.innerHTML = `
      <section class="tm-painel" role="dialog" aria-modal="true" aria-label="Testador Mestre">
        <div class="tm-topo">
          <div>
            <div class="tm-titulo">Testador Mestre</div>
            <div class="tm-subtitulo">Diagnóstico isolado do WhatsIAPP • módulo ${versao}</div>
          </div>
          <button class="tm-fechar" type="button" aria-label="Fechar">×</button>
        </div>
        <div class="tm-corpo">
          <aside class="tm-lateral">
            <div class="tm-bloco">
              <div class="tm-bloco-titulo">Conversa de teste</div>
              <select class="tm-select" data-tm="alvo"></select>
              <div class="tm-info" style="margin-top:7px;">Só será usada quando as suítes R2 forem habilitadas. A bateria segura nunca envia mensagens.</div>
            </div>
            <div class="tm-bloco">
              <div class="tm-bloco-titulo">Perfil</div>
              <div class="tm-perfis">
                <button class="tm-perfil ativo" type="button" data-tm-perfil="rapido">
                  <span><strong>Rápido Seguro</strong><small>Estrutura, DOM, isolamento e IPC leve</small></span>
                  <span class="tm-mini-badge" data-tm-contagem="rapido">-</span>
                </button>
                <button class="tm-perfil" type="button" data-tm-perfil="seguro">
                  <span><strong>Completo Seguro</strong><small>Inclui leituras reais de workers, sem escrever</small></span>
                  <span class="tm-mini-badge" data-tm-contagem="seguro">-</span>
                </button>
                <button class="tm-perfil" type="button" data-tm-perfil="real">
                  <span><strong>Completo Real</strong><small>Inclui ações reais controladas e ciclo de Status de teste</small></span>
                  <span class="tm-mini-badge" data-tm-contagem="real">-</span>
                </button>
              </div>
            </div>
            <div class="tm-bloco">
              <div class="tm-bloco-titulo">Barreiras ativas</div>
              <div class="tm-seguranca">
                <span>Sem monkey patch</span>
                <span>Sem segundo Baileys/WPP</span>
                <span>Leitura livre só por whitelist</span>
                <span>Status real limitado a publicar/apagar fixture própria</span>
                <span>R3 fisicamente bloqueado</span>
                <span>Executor serial e cancelável</span>
                <span>Namespace próprio de persistência</span>
              </div>
            </div>
            <div class="tm-info" data-tm="matrizInfo"></div>
          </aside>
          <main class="tm-conteudo">
            <div class="tm-dashboard">
              <div class="tm-geral-card" data-tm="resultadoGeral">
                <div>
                  <span class="tm-geral-kicker">Resultado geral</span>
                  <strong class="tm-geral-titulo" data-tm="geralTitulo">Aguardando execução</strong>
                  <span class="tm-geral-subtitulo" data-tm="geralSubtitulo">Execute uma bateria para ver o diagnóstico consolidado.</span>
                </div>
                <div class="tm-geral-total">
                  <strong data-tm="geralPercentual">0%</strong>
                  <span data-tm="geralAprovados">0/0 pass</span>
                </div>
              </div>
              <div class="tm-resumo">
                <div class="tm-resumo-item pass"><strong data-tm-count="PASS">0</strong><span>Pass</span></div>
                <div class="tm-resumo-item warning"><strong data-tm-count="WARNING">0</strong><span>Warnings</span></div>
                <div class="tm-resumo-item fail"><strong data-tm-count="FAIL">0</strong><span>Fails</span></div>
              </div>
              <div class="tm-resumo-secundario">
                <span>Manual <strong data-tm-count="MANUAL">0</strong></span>
                <span>Skip <strong data-tm-count="SKIP">0</strong></span>
                <span>Blocked <strong data-tm-count="BLOCKED">0</strong></span>
              </div>
            </div>
            <div class="tm-progresso">
              <div class="tm-progresso-topo">
                <strong data-tm="etapa">Pronto para executar</strong>
                <span data-tm="contagem">0/0</span>
              </div>
              <div class="tm-barra"><span data-tm="barra"></span></div>
            </div>
            <div class="tm-resultados" data-tm="resultados">
              <div class="tm-info">Nenhuma bateria executada nesta sessão.</div>
            </div>
            <div class="tm-acoes">
              <div class="tm-acoes-grupo">
                <button class="tm-btn primario" type="button" data-tm="executar">Executar bateria</button>
                <button class="tm-btn perigo" type="button" data-tm="cancelar" disabled>Cancelar</button>
              </div>
              <div class="tm-acoes-grupo">
                <button class="tm-btn" type="button" data-tm="abrirRelatorio" disabled>Abrir relatório</button>
              </div>
            </div>
          </main>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);

    elementos = {
      alvo: overlay.querySelector('[data-tm="alvo"]'),
      etapa: overlay.querySelector('[data-tm="etapa"]'),
      contagem: overlay.querySelector('[data-tm="contagem"]'),
      barra: overlay.querySelector('[data-tm="barra"]'),
      resultados: overlay.querySelector('[data-tm="resultados"]'),
      executar: overlay.querySelector('[data-tm="executar"]'),
      cancelar: overlay.querySelector('[data-tm="cancelar"]'),
      abrirRelatorio: overlay.querySelector('[data-tm="abrirRelatorio"]'),
      resultadoGeral: overlay.querySelector('[data-tm="resultadoGeral"]'),
      geralTitulo: overlay.querySelector('[data-tm="geralTitulo"]'),
      geralSubtitulo: overlay.querySelector('[data-tm="geralSubtitulo"]'),
      geralPercentual: overlay.querySelector('[data-tm="geralPercentual"]'),
      geralAprovados: overlay.querySelector('[data-tm="geralAprovados"]'),
      matrizInfo: overlay.querySelector('[data-tm="matrizInfo"]'),
      counts: Object.fromEntries(
        ["PASS", "WARNING", "FAIL", "MANUAL", "SKIP", "BLOCKED"].map((status) => [
          status,
          overlay.querySelector(`[data-tm-count="${status}"]`),
        ]),
      ),
    };

    overlay.querySelector(".tm-fechar")?.addEventListener("click", fechar);
    overlay.addEventListener("click", (evento) => {
      if (evento.target === overlay && !executor.estaExecutando()) fechar();
    });

    for (const botao of overlay.querySelectorAll("[data-tm-perfil]")) {
      botao.addEventListener("click", () => {
        if (botao.disabled || executor.estaExecutando()) return;
        perfilAtual = botao.dataset.tmPerfil || "rapido";
        for (const item of overlay.querySelectorAll("[data-tm-perfil]")) {
          item.classList.toggle("ativo", item === botao);
        }
        atualizarResumoCatalogo();
      });
    }

    elementos.alvo?.addEventListener("change", () => {
      salvarConfig({ alvoTeste: String(elementos.alvo.value || "").trim() });
    });

    elementos.executar?.addEventListener("click", () => executarPerfilAtual());
    elementos.cancelar?.addEventListener("click", () => executor.cancelar());
    elementos.abrirRelatorio?.addEventListener("click", () => {
      abrirRelatorioInterno();
    });

    window.addEventListener("keydown", (evento) => {
      if (
        evento.key === "Escape" &&
        overlay?.classList.contains("aberto") &&
        !executor.estaExecutando()
      ) {
        fechar();
      }
    });

    atualizarResumoCatalogo();
    preencherConversas();
    return overlay;
  }

  function preencherConversas() {
    if (!elementos?.alvo) return;

    const salvo = String(carregarConfig().alvoTeste || "").trim();
    const conversas = bridge
      .listarConversasSanitizadas()
      .filter((item) => !item.tecnica && !item.grupo)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

    elementos.alvo.textContent = "";
    const vazio = document.createElement("option");
    vazio.value = "";
    vazio.textContent = "Nenhuma conversa autorizada";
    elementos.alvo.appendChild(vazio);

    for (const conversa of conversas) {
      const option = document.createElement("option");
      option.value = conversa.id;
      option.textContent = conversa.nome || conversa.id;
      elementos.alvo.appendChild(option);
    }

    if (salvo && conversas.some((item) => item.id === salvo)) {
      elementos.alvo.value = salvo;
    }
  }

  function atualizarResumoCatalogo() {
    if (!overlay) return;
    const resumo = catalogo.resumoCatalogo();
    const rapido = catalogo.testesParaPerfil("rapido").length;
    const seguro = catalogo.testesParaPerfil("seguro").length;
    const real = catalogo.testesParaPerfil("real").length;
    const atual = catalogo.testesParaPerfil(perfilAtual).length;

    overlay.querySelector('[data-tm-contagem="rapido"]')?.replaceChildren(
      document.createTextNode(String(rapido)),
    );
    overlay.querySelector('[data-tm-contagem="seguro"]')?.replaceChildren(
      document.createTextNode(String(seguro)),
    );
    overlay.querySelector('[data-tm-contagem="real"]')?.replaceChildren(
      document.createTextNode(String(real)),
    );

    if (elementos?.matrizInfo) {
      elementos.matrizInfo.textContent =
        `Matriz V1: ${resumo.matrizTotal} casos. Estrutura desta etapa: ${resumo.implementados} automatizados. Perfil selecionado: ${atual} testes.`;
    }
  }

  function abrir() {
    garantirEstilos();
    criarOverlay();
    preencherConversas();
    atualizarResumoCatalogo();

    // O Testador Mestre nasce a partir do painel administrativo, mas precisa
    // ficar visualmente acima dele. Forcamos o overlay no topo da pilha do
    // Chromium sem alterar o z-index ou o comportamento do Admin.
    overlay.style.setProperty("display", "flex", "important");
    overlay.style.setProperty("visibility", "visible", "important");
    overlay.style.setProperty("pointer-events", "auto", "important");
    overlay.style.setProperty("opacity", "1", "important");
    overlay.style.setProperty("z-index", "2147483646", "important");
    overlay.classList.add("aberto");
  }

  function fechar() {
    if (executor.estaExecutando()) return false;

    overlay?.classList.remove("aberto");
    overlay?.style.removeProperty("display");
    overlay?.style.removeProperty("visibility");
    overlay?.style.removeProperty("pointer-events");
    overlay?.style.removeProperty("opacity");
    overlay?.style.removeProperty("z-index");

    return true;
  }

  function definirEstadoResultadoGeral(estado = "") {
    const card = elementos?.resultadoGeral;
    if (!card) return;
    card.classList.remove("executando", "pass", "warning", "fail", "cancelado");
    if (estado) card.classList.add(estado);
  }

  function atualizarResultadoGeral(resultados = [], opcoes = {}) {
    const lista = Array.isArray(resultados) ? resultados : [];
    const totalPrevisto = Math.max(0, Number(opcoes.totalPrevisto || lista.length) || 0);
    const finalizado = !!opcoes.finalizado;
    const cancelado = !!opcoes.cancelado;
    const contagens = {
      PASS: 0,
      WARNING: 0,
      FAIL: 0,
      MANUAL: 0,
      SKIP: 0,
      BLOCKED: 0,
    };

    for (const item of lista) {
      if (Object.prototype.hasOwnProperty.call(contagens, item?.status)) {
        contagens[item.status] += 1;
      }
    }

    const concluidos = lista.length;
    const percentualPass = concluidos
      ? Math.round((contagens.PASS / concluidos) * 100)
      : 0;

    if (elementos?.geralPercentual) {
      elementos.geralPercentual.textContent = `${percentualPass}%`;
    }
    if (elementos?.geralAprovados) {
      elementos.geralAprovados.textContent = `${contagens.PASS}/${concluidos || totalPrevisto || 0} pass`;
    }

    if (cancelado) {
      definirEstadoResultadoGeral("cancelado");
      if (elementos?.geralTitulo) elementos.geralTitulo.textContent = "Execução cancelada";
      if (elementos?.geralSubtitulo) elementos.geralSubtitulo.textContent = `${concluidos}/${totalPrevisto || concluidos} testes concluídos antes do cancelamento.`;
      return;
    }

    if (!finalizado) {
      definirEstadoResultadoGeral(concluidos ? "executando" : "");
      if (elementos?.geralTitulo) elementos.geralTitulo.textContent = concluidos ? "Bateria em execução" : "Preparando bateria";
      if (elementos?.geralSubtitulo) elementos.geralSubtitulo.textContent = `${contagens.PASS} PASS • ${contagens.WARNING} WARNING • ${contagens.FAIL} FAIL`;
      return;
    }

    if (contagens.FAIL > 0 || contagens.BLOCKED > 0) {
      definirEstadoResultadoGeral("fail");
      if (elementos?.geralTitulo) elementos.geralTitulo.textContent = "Bateria concluída com falhas";
    } else if (contagens.WARNING > 0 || contagens.MANUAL > 0 || contagens.SKIP > 0) {
      definirEstadoResultadoGeral("warning");
      if (elementos?.geralTitulo) elementos.geralTitulo.textContent = "Bateria concluída com atenção";
    } else {
      definirEstadoResultadoGeral("pass");
      if (elementos?.geralTitulo) elementos.geralTitulo.textContent = "Tudo aprovado";
    }

    if (elementos?.geralSubtitulo) {
      elementos.geralSubtitulo.textContent = `${contagens.PASS} PASS • ${contagens.WARNING} WARNING • ${contagens.FAIL} FAIL • ${concluidos} testes concluídos`;
    }
  }

  function resetResumo() {
    for (const elemento of Object.values(elementos?.counts || {})) {
      if (elemento) elemento.textContent = "0";
    }
    definirEstadoResultadoGeral("");
    if (elementos?.geralTitulo) elementos.geralTitulo.textContent = "Aguardando execução";
    if (elementos?.geralSubtitulo) elementos.geralSubtitulo.textContent = "Execute uma bateria para ver o diagnóstico consolidado.";
    if (elementos?.geralPercentual) elementos.geralPercentual.textContent = "0%";
    if (elementos?.geralAprovados) elementos.geralAprovados.textContent = "0/0 pass";
  }

  function atualizarCounts(resultados = []) {
    const contagens = {
      PASS: 0,
      WARNING: 0,
      FAIL: 0,
      MANUAL: 0,
      SKIP: 0,
      BLOCKED: 0,
    };
    for (const item of resultados) {
      if (Object.prototype.hasOwnProperty.call(contagens, item.status)) {
        contagens[item.status] += 1;
      }
    }
    for (const [status, total] of Object.entries(contagens)) {
      if (elementos?.counts?.[status]) {
        elementos.counts[status].textContent = String(total);
      }
    }
  }

  function adicionarResultado(resultado) {
    if (!elementos?.resultados || !resultado) return;

    if (elementos.resultados.dataset.vazio !== "0") {
      elementos.resultados.textContent = "";
      elementos.resultados.dataset.vazio = "0";
    }

    const item = document.createElement("div");
    item.className = "tm-resultado";

    const status = document.createElement("div");
    status.className = `tm-status ${resultado.status}`;
    status.textContent = resultado.status;

    const conteudo = document.createElement("div");
    const titulo = document.createElement("strong");
    titulo.textContent = `${resultado.id} • ${resultado.nome}`;
    const detalhe = document.createElement("small");
    detalhe.textContent = resultado.detalhe || resultado.esperado || "";
    conteudo.appendChild(titulo);
    conteudo.appendChild(detalhe);

    const duracao = document.createElement("div");
    duracao.className = "tm-duracao";
    duracao.textContent = `${resultado.duracaoMs || 0} ms`;

    item.appendChild(status);
    item.appendChild(conteudo);
    item.appendChild(duracao);
    elementos.resultados.appendChild(item);
    elementos.resultados.scrollTop = elementos.resultados.scrollHeight;
  }

  async function executarPerfilAtual() {
    if (executor.estaExecutando()) return;
    const testes = catalogo.testesParaPerfil(perfilAtual);
    if (!testes.length) return;

    ultimoRelatorio = null;
    elementos.abrirRelatorio.disabled = true;

    await executor.executar(testes, {
      perfil: perfilAtual,
      contexto: {
        alvoTeste: obterAlvoTeste(),
      },
    });
  }

  function onInicio(dados) {
    abrir();
    resetResumo();
    elementos.resultados.textContent = "";
    elementos.resultados.dataset.vazio = "0";
    elementos.executar.disabled = true;
    elementos.cancelar.disabled = false;
    elementos.alvo.disabled = true;
    elementos.etapa.textContent = "Preparando bateria...";
    elementos.contagem.textContent = `0/${dados.total}`;
    elementos.barra.style.width = "0%";
    atualizarResultadoGeral([], { totalPrevisto: dados.total, finalizado: false });
  }

  function onTesteInicio(dados) {
    elementos.etapa.textContent = `${dados.teste.id} • ${dados.teste.nome}`;
    elementos.contagem.textContent = `${dados.indice}/${dados.total}`;
    elementos.barra.style.width = `${Math.round((dados.indice / Math.max(1, dados.total)) * 100)}%`;
  }

  function onTesteFim(dados) {
    adicionarResultado(dados.resultado);
    const itens = Array.from(elementos.resultados.querySelectorAll(".tm-resultado"));
    const resultados = itens.map((item) => ({
      status: item.querySelector(".tm-status")?.textContent || "FAIL",
    }));
    atualizarCounts(resultados);
    atualizarResultadoGeral(resultados, { totalPrevisto: dados.total, finalizado: false });
    const concluido = dados.indice + 1;
    elementos.contagem.textContent = `${concluido}/${dados.total}`;
    elementos.barra.style.width = `${Math.round((concluido / Math.max(1, dados.total)) * 100)}%`;
  }

  function onFim(execucao, relatorioSalvo) {
    atualizarCounts(execucao.resultados || []);
    atualizarResultadoGeral(execucao.resultados || [], {
      totalPrevisto: catalogo.testesParaPerfil(execucao.perfil).length,
      finalizado: true,
      cancelado: !!execucao.cancelado,
    });
    elementos.etapa.textContent = execucao.cancelado
      ? "Bateria cancelada com segurança"
      : execucao.resumo?.FAIL
        ? "Bateria concluída com falhas"
        : "Bateria concluída";
    elementos.contagem.textContent = `${execucao.resultados.length}/${catalogo.testesParaPerfil(execucao.perfil).length}`;
    elementos.barra.style.width = execucao.cancelado ? elementos.barra.style.width : "100%";
    elementos.executar.disabled = false;
    elementos.cancelar.disabled = true;
    elementos.alvo.disabled = false;
    ultimoRelatorio = relatorioSalvo || null;
    elementos.abrirRelatorio.disabled = !textoRelatorioAtual();

    if (textoRelatorioAtual()) {
      abrirRelatorioInterno();
    }
  }

  function injetarCartaoAdmin() {
    const painel = document.querySelector('[data-admin-painel="testes"]');
    if (!painel || painel.querySelector("#adminTestadorMestreCard")) return false;

    const resumo = catalogo.resumoCatalogo();
    const card = document.createElement("section");
    card.id = "adminTestadorMestreCard";
    card.className = "tm-admin-card";
    card.innerHTML = `
      <div class="tm-admin-card-topo">
        <div>
          <div class="tm-admin-card-titulo">Testador Mestre</div>
          <div class="tm-admin-card-desc">Diagnóstico geral do WhatsIAPP em módulo isolado. Os perfis seguros continuam sem escrita. O Completo Real inclui apenas ações R2 já implementadas e controladas, começando pelo ciclo de Status de teste.</div>
        </div>
        <span class="tm-admin-badge">${resumo.implementados}/${resumo.matrizTotal} base ativa</span>
      </div>
      <div class="tm-admin-acoes">
        <button class="tm-admin-btn primario" type="button" data-tm-admin-abrir>Abrir Testador Mestre</button>
      </div>
    `;

    painel.appendChild(card);
    card.querySelector("[data-tm-admin-abrir]")?.addEventListener("click", abrir);
    return true;
  }

  function observarAdmin() {
    garantirEstilos();
    injetarCartaoAdmin();

    const alvo = document.getElementById("adminOcultoConteudo");
    if (!alvo || observerAdmin) return;

    observerAdmin = new MutationObserver(() => {
      injetarCartaoAdmin();
    });
    observerAdmin.observe(alvo, { childList: true, subtree: true });
  }

  observarAdmin();

  return Object.freeze({
    abrir,
    fechar,
    obterAlvoTeste,
    onInicio,
    onTesteInicio,
    onTesteFim,
    onFim,
    atualizarResumoCatalogo,
    abrirRelatorioInterno,
  });
}

module.exports = {
  criarUiTestadorMestre,
};
