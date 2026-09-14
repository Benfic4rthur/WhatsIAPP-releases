"use strict";

const fs = require("fs");
const path = require("path");

const MODULOS_WPP = [
  "01-nucleo-sincronizacao.js",
  "02-mensagens-operacoes.js",
  "03-midia-recebimento.js",
  "04-arquivamento-presenca.js",
  "05-inicializacao-wpp.js",
  "06-contatos-grupos.js",
  "07-figurinhas-contatos.js",
  "08-status-base-listagem.js",
  "09-status-operacoes.js",
  "historico-gap.js",
  "10-dispatcher-encerramento.js",
];

const diretorioModulos = path.join(__dirname, "wpp-worker-modules");
let codigoWpp = MODULOS_WPP.map((arquivo) =>
  fs.readFileSync(path.join(diretorioModulos, arquivo), "utf8"),
).join("");

// O WPPConnect 2.2.6 pode entrar no estado QR sem disparar catchQR.
// Mantemos waitForLogin=false para o client ficar disponivel e instalamos
// um fallback que consulta o QR diretamente enquanto a sessao nao estiver
// realmente registrada. Nao confiamos em inChat/qrAceito para encerrar o
// fallback, pois o WPPConnect pode emitir inChat antes de confirmar o login.
const marcadorCreateResolvido =
  /enviarEtapaSincronizacao\("wpp-create-resolved"\);/;

if (!marcadorCreateResolvido.test(codigoWpp)) {
  throw new Error("Nao foi possivel instalar o fallback de QR do WPPConnect.");
}

const injecaoQrFallback = `enviarEtapaSincronizacao("wpp-create-resolved");

  let ultimoQrVisualWpp = null;
  let tentativasQrVisualWpp = 0;

  const timerQrVisualWpp = setInterval(async () => {
    if (encerrando || !client?.page) {
      clearInterval(timerQrVisualWpp);
      return;
    }

    try {
      const pagina = client.page;

      const autenticada = await pagina
        .evaluate(() => {
          try {
            return !!globalThis.WPP?.conn?.isRegistered?.();
          } catch {
            return false;
          }
        })
        .catch(() => false);

      if (autenticada) {
        qrAceito = true;
        qrAguardandoLeitura = false;
        clearInterval(timerQrVisualWpp);
        console.log("[QR FALLBACK] WPPCONNECT_AUTH_CONFIRMED");
        return;
      }

      qrAceito = false;
      qrAguardandoLeitura = true;

      let base64Qr = null;

      try {
        const resultadoQr = await client.getQrCode?.();
        if (resultadoQr?.base64Image) {
          base64Qr = String(resultadoQr.base64Image);
        }
      } catch {}

      if (!base64Qr) {
        const resultadoVisual = await pagina
          .evaluate(() => {
            try {
              const canvases = Array.from(document.querySelectorAll("canvas"));

              for (const canvas of canvases) {
                const rect = canvas.getBoundingClientRect();

                if (
                  rect.width < 160 ||
                  rect.height < 160 ||
                  Math.abs(rect.width - rect.height) > 30
                ) {
                  continue;
                }

                const contenedor = canvas.closest("[data-ref]");
                const imagem = canvas.toDataURL?.();

                if (!imagem) {
                  continue;
                }

                return {
                  base64Image: imagem,
                  urlCode: contenedor?.getAttribute("data-ref") || null,
                };
              }
            } catch {}

            return null;
          })
          .catch(() => null);

        if (resultadoVisual?.base64Image) {
          base64Qr = String(resultadoVisual.base64Image);
        }
      }

      if (!base64Qr) {
        tentativasQrVisualWpp += 1;
        if (tentativasQrVisualWpp % 10 === 0) {
          console.log("[QR FALLBACK] WPPCONNECT_QR_NOT_FOUND");
        }
        return;
      }

      if (base64Qr === ultimoQrVisualWpp) {
        return;
      }

      ultimoQrVisualWpp = base64Qr;

      console.log("[QR FALLBACK] WPPCONNECT_QR_CAPTURED");
      enviarEtapaSincronizacao("qr", "fallback-visual");
      enviar("wpp-qr", base64Qr);
    } catch (erro) {
      tentativasQrVisualWpp += 1;
      if (tentativasQrVisualWpp % 10 === 0) {
        console.log(
          "[QR FALLBACK] WPPCONNECT_QR_CAPTURE_ERROR | " +
            String(erro?.message || erro || "unknown"),
        );
      }
    }
  }, 900);`;

codigoWpp = codigoWpp.replace(
  marcadorCreateResolvido,
  injecaoQrFallback,
);

// Aceita tanto LF quanto CRLF. No build Windows os arquivos podem chegar com
// \r\n, enquanto o wrapper anterior procurava apenas \n e abortava o worker.
const marcador =
  /async function responderSolicitacao\(id, acao, dados\) \{\r?\n[ \t]*try \{/;

if (!marcador.test(codigoWpp)) {
  throw new Error("Nao foi possivel instalar o logout vivo do WPPConnect.");
}

const injecao = `async function responderSolicitacao(id, acao, dados) {\n  try {\n    if (acao === "logout-sessao-viva") {\n      if (!client || typeof client.logout !== "function") {\n        parentPort.postMessage({\n          tipo: "resposta",\n          id,\n          resultado: {\n            ok: false,\n            erro: "WPPConnect live client unavailable",\n          },\n        });\n        return;\n      }\n\n      encerrando = true;\n\n      try {\n        client?.stopPhoneWatchdog?.();\n      } catch {}\n\n      let erroLogout = null;\n      let navegacaoEsperada = false;\n\n      try {\n        await Promise.race([\n          Promise.resolve(client.logout()),\n          new Promise((_, reject) =>\n            setTimeout(\n              () => reject(new Error("WPPConnect live logout timeout")),\n              25000,\n            ),\n          ),\n        ]);\n      } catch (erro) {\n        erroLogout = erro;\n        const texto = String(erro?.message || erro || "").toLowerCase();\n        navegacaoEsperada =\n          texto.includes("execution context was destroyed") ||\n          texto.includes("most likely because of a navigation") ||\n          texto.includes("cannot find context with specified id") ||\n          texto.includes("target closed") ||\n          texto.includes("detached frame");\n\n        if (!navegacaoEsperada) {\n          console.warn(\n            \`[SESSION LOGOUT] WPPCONNECT_LIVE_REMOTE_LOGOUT_FAILED | error=\${erro?.message || erro}\`,\n          );\n          parentPort.postMessage({\n            tipo: "resposta",\n            id,\n            resultado: {\n              ok: false,\n              erro: \`WPPConnect: \${erro?.message || erro || "live logout failed"}\`,\n            },\n          });\n          return;\n        }\n      }\n\n      // client.logout() normalmente navega a pagina do WhatsApp Web. Nessa\n      // navegacao o contexto JS pode ser destruido mesmo quando o pedido de\n      // revogacao foi enviado corretamente. Mantemos o worker vivo por alguns\n      // segundos para a requisicao remota terminar antes do fechamento do app.\n      await new Promise((resolve) => setTimeout(resolve, 3500));\n\n      let autenticadaDepois = null;\n      try {\n        autenticadaDepois = !!(await Promise.race([\n          Promise.resolve(client.isAuthenticated()),\n          new Promise((_, reject) =>\n            setTimeout(() => reject(new Error("auth check timeout")), 5000),\n          ),\n        ]));\n      } catch {}\n\n      console.log(\n        \`[SESSION LOGOUT] WPPCONNECT_LIVE_REMOTE_LOGOUT_OK | navigation=\${navegacaoEsperada} | authenticated_after=\${autenticadaDepois}\`,\n      );\n\n      parentPort.postMessage({\n        tipo: "resposta",\n        id,\n        resultado: {\n          ok: true,\n          navegacaoEsperada,\n          autenticadaDepois,\n          erroNavegacao: navegacaoEsperada\n            ? String(erroLogout?.message || erroLogout || "")\n            : null,\n        },\n      });\n      return;\n    }`;

codigoWpp = codigoWpp.replace(marcador, injecao);

const executarWpp = new Function(
  "exports",
  "require",
  "module",
  "__filename",
  "__dirname",
  codigoWpp,
);

executarWpp(module.exports, require, module, __filename, __dirname);
