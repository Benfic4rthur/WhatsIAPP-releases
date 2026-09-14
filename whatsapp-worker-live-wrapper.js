"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const originalPath = path.join(__dirname, "whatsapp-worker.js");
let fonte = fs.readFileSync(originalPath, "utf8");

// Aceita tanto LF quanto CRLF. No build Windows os arquivos podem chegar com
// \r\n, enquanto o wrapper anterior procurava apenas \n e abortava o worker.
const marcador =
  /async function responderSolicitacao\(id, acao, dados\) \{\r?\n[ \t]*try \{/;

if (!marcador.test(fonte)) {
  throw new Error("Nao foi possivel instalar o logout vivo do Baileys.");
}

const injecao = `async function responderSolicitacao(id, acao, dados) {\n  try {\n    if (acao === "logout-sessao-viva") {\n      encerrando = true;\n\n      if (timerReconexao) {\n        clearTimeout(timerReconexao);\n        timerReconexao = null;\n      }\n\n      let resultadoLogoutVivo = null;\n\n      try {\n        if (!sock || typeof sock.logout !== "function") {\n          throw new Error("Baileys live socket unavailable");\n        }\n\n        await Promise.race([\n          Promise.resolve(sock.logout()),\n          new Promise((_, reject) =>\n            setTimeout(\n              () => reject(new Error("Baileys live logout timeout")),\n              25000,\n            ),\n          ),\n        ]);\n\n        await new Promise((resolve) => setTimeout(resolve, 900));\n\n        console.log("[SESSION LOGOUT] BAILEYS_LIVE_REMOTE_LOGOUT_OK");\n        resultadoLogoutVivo = { ok: true };\n      } catch (erro) {\n        console.warn(\n          \`[SESSION LOGOUT] BAILEYS_LIVE_REMOTE_LOGOUT_FAILED | error=\${erro?.message || erro}\`,\n        );\n        resultadoLogoutVivo = {\n          ok: false,\n          erro: \`Baileys: \${erro?.message || erro || "live logout failed"}\`,\n        };\n      }\n\n      parentPort.postMessage({\n        tipo: "resposta",\n        id,\n        resultado: resultadoLogoutVivo,\n      });\n\n      return;\n    }`;

fonte = fonte.replace(marcador, injecao);

const moduloOriginal = new Module(originalPath, module);
moduloOriginal.filename = originalPath;
moduloOriginal.paths = Module._nodeModulePaths(path.dirname(originalPath));
moduloOriginal._compile(fonte, originalPath);
