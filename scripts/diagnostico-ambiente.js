const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

console.log(`WhatsIAPP — Node ${process.version}, ${process.platform}/${process.arch}`);
let falhas = 0;
function verificar(nome, executar) {
  try {
    console.log(`[OK] ${nome}: ${executar()}`);
  } catch (erro) {
    falhas++;
    console.error(`[ERRO] ${nome}: ${erro.message}`);
  }
}
function executavel(arquivo) {
  if (!arquivo) throw new Error("caminho do executavel ausente");
  fs.accessSync(arquivo, fs.constants.X_OK);
  return arquivo;
}

const pacote = require("../package.json");
for (const nome of Object.keys({ ...pacote.dependencies, ...pacote.devDependencies })) {
  verificar(nome, () => require.resolve(nome));
}
verificar("Electron", () => {
  const arquivo = executavel(require("electron"));
  const resultado = spawnSync(arquivo, ["-p", "process.platform + '/' + process.arch"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8", timeout: 15000,
  });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) throw new Error(resultado.stderr || "binario incompativel");
  return resultado.stdout.trim();
});
verificar("FFmpeg", () => {
  const resultado = spawnSync(executavel(require("ffmpeg-static")), ["-version"], {
    encoding: "utf8", timeout: 15000,
  });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) throw new Error(resultado.stderr || "binario incompativel");
  return resultado.stdout.split("\n")[0];
});
verificar("Chrome do Puppeteer", () => executavel(require("puppeteer").executablePath()));
verificar("Interface", () => {
  fs.accessSync(path.join(__dirname, "..", "app.html"));
  return "app.html encontrado";
});
if (falhas) {
  console.error("Reinstale as dependencias nesta maquina com npm ci. Nao copie node_modules de outro sistema.");
  process.exitCode = 1;
} else {
  console.log("Ambiente pronto. Execute npm start e vincule o WhatsApp quando solicitado.");
}
