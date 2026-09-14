"use strict";

const path = require("path");

const MAC_APP_TARGET = "/Applications/WhatsIAPP.app";

function plataformaUpdater(plataforma = process.platform, arquitetura = process.arch) {
  if (plataforma === "win32" && arquitetura === "x64") return "windows-x64";
  if (plataforma === "darwin" && arquitetura === "arm64") return "macos-arm64";
  return null;
}

function parseSemver(valor) {
  const texto = String(valor || "").trim().replace(/^v/i, "");
  const match = texto.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
    raw: texto,
  };
}

function compararVersoes(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return null;
  for (const chave of ["major", "minor", "patch"]) {
    if (va[chave] > vb[chave]) return 1;
    if (va[chave] < vb[chave]) return -1;
  }
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;
  if (va.prerelease === vb.prerelease) return 0;
  return String(va.prerelease).localeCompare(String(vb.prerelease), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function ehPrerelease(valor) {
  return !!parseSemver(valor)?.prerelease;
}

function ehVersaoSuperior(candidata, atual) {
  if (ehPrerelease(candidata)) return false;
  return compararVersoes(candidata, atual) === 1;
}

function escaparRegex(valor) {
  return String(valor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nomeArquivoDeUrl(valor) {
  try {
    const url = new URL(String(valor));
    return decodeURIComponent(path.posix.basename(url.pathname));
  } catch {
    return path.basename(String(valor || ""));
  }
}

function arquivoWindowsX64Esperado(versao) {
  return `WhatsIAPP-Setup-${versao}-x64.exe`;
}

function selecionarArquivoWindowsX64(info) {
  const versao = String(info?.version || "").replace(/^v/i, "");
  if (!parseSemver(versao) || ehPrerelease(versao)) return null;
  const esperado = arquivoWindowsX64Esperado(versao);
  const arquivos = Array.isArray(info?.files) ? info.files : [];
  return arquivos.find((item) => nomeArquivoDeUrl(item?.url || item?.path) === esperado) || null;
}

function validarUpdateWindows(info, versaoAtual) {
  const versao = String(info?.version || "").replace(/^v/i, "");
  if (!ehVersaoSuperior(versao, versaoAtual)) {
    return { ok: false, motivo: "versao-nao-superior" };
  }
  const arquivo = selecionarArquivoWindowsX64(info);
  if (!arquivo) return { ok: false, motivo: "asset-windows-x64-ausente" };
  const nomes = (Array.isArray(info?.files) ? info.files : []).map((item) =>
    nomeArquivoDeUrl(item?.url || item?.path),
  );
  if (nomes.some((nome) => /\.(dmg|zip)$/i.test(nome) || /arm64/i.test(nome))) {
    return { ok: false, motivo: "metadados-misturam-plataformas" };
  }
  return { ok: true, versao, arquivo };
}

function selecionarAssetMacArm64(assets, versao) {
  const limpa = String(versao || "").replace(/^v/i, "");
  if (!parseSemver(limpa) || ehPrerelease(limpa)) return null;
  const regex = new RegExp(`^WhatsIAPP-${escaparRegex(limpa)}-arm64\\.dmg$`, "i");
  return (Array.isArray(assets) ? assets : []).find((asset) => regex.test(String(asset?.name || ""))) || null;
}

function selecionarLatestMacYml(assets) {
  return (Array.isArray(assets) ? assets : []).find(
    (asset) => String(asset?.name || "").toLowerCase() === "latest-mac.yml",
  ) || null;
}

function extrairMetadadosLatestMac(texto, nomeArquivo) {
  const linhas = String(texto || "").split(/\r?\n/);
  const alvo = String(nomeArquivo || "");
  let ativo = false;
  let resultado = null;
  for (const linha of linhas) {
    const urlMatch = linha.match(/^\s*-\s+url:\s*(.+?)\s*$/);
    if (urlMatch) {
      const nome = String(urlMatch[1] || "").trim().replace(/^['"]|['"]$/g, "");
      ativo = nome === alvo;
      if (ativo) resultado = { url: nome, sha512: null, size: null };
      continue;
    }
    if (!ativo || !resultado) continue;
    const sha = linha.match(/^\s+sha512:\s*(.+?)\s*$/);
    if (sha) {
      resultado.sha512 = String(sha[1] || "").trim().replace(/^['"]|['"]$/g, "");
      continue;
    }
    const size = linha.match(/^\s+size:\s*(\d+)\s*$/);
    if (size) resultado.size = Number(size[1]);
  }
  return resultado;
}

function hostGitHubPermitido(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "github.com" || host === "api.github.com" || host.endsWith(".githubusercontent.com");
}

function urlGitHubPermitida(valor) {
  try {
    const url = new URL(String(valor || ""));
    return url.protocol === "https:" && hostGitHubPermitido(url.hostname);
  } catch {
    return false;
  }
}

function validarCaminhoDmg(caminho, diretorio, nomeEsperado) {
  const dir = path.resolve(String(diretorio || ""));
  const arquivo = path.resolve(String(caminho || ""));
  if (!dir || !arquivo || arquivo === dir) return false;
  if (!arquivo.startsWith(`${dir}${path.sep}`)) return false;
  if (path.basename(arquivo) !== String(nomeEsperado || "")) return false;
  return /^WhatsIAPP-\d+\.\d+\.\d+-arm64\.dmg$/i.test(path.basename(arquivo));
}

function validarCaminhoAplicacaoMac(caminho) {
  return path.posix.normalize(String(caminho || "")) === MAC_APP_TARGET;
}

function normalizarEstadoPendente(dados, versaoAtual) {
  if (!dados || typeof dados !== "object") return null;
  const versao = String(dados.versao || "").replace(/^v/i, "");
  if (!parseSemver(versao) || ehPrerelease(versao)) return null;
  if (!ehVersaoSuperior(versao, versaoAtual)) return null;
  return {
    versao,
    arquivo: String(dados.arquivo || ""),
    baixadoEm: Number(dados.baixadoEm || 0) || 0,
    adiado: !!dados.adiado,
  };
}

function criarScriptQuarentenaTemporario() {
  return `#!/bin/sh
# TEMPORARY TEST-ONLY HELPER.
# Remove before the final production updater is distributed.
TARGET="/Applications/WhatsIAPP.app"
OLD_PID="$1"
EXPECTED_VERSION="$2"
LOG_FILE="$3"
SELF="$0"

log_line() {
  printf '%s %s\\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$1" >> "$LOG_FILE" 2>/dev/null || true
}

cleanup() {
  rm -f -- "$SELF" 2>/dev/null || true
}

case "$EXPECTED_VERSION" in
  ''|*[!0-9.]* ) log_line "[UPDATER MAC HELPER] invalid expected version"; cleanup; exit 2 ;;
esac

log_line "[UPDATER MAC HELPER] started expected=$EXPECTED_VERSION old_pid=$OLD_PID"

waited=0
while kill -0 "$OLD_PID" 2>/dev/null; do
  sleep 1
  waited=$((waited + 1))
  if [ "$waited" -ge 90 ]; then
    log_line "[UPDATER MAC HELPER] old process timeout"
    cleanup
    exit 3
  fi
done

waited=0
stable_count=0
last_size=""
while [ "$waited" -lt 1200 ]; do
  if [ -d "$TARGET" ] && [ -f "$TARGET/Contents/Info.plist" ]; then
    VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TARGET/Contents/Info.plist" 2>/dev/null || true)
    if [ "$VERSION" = "$EXPECTED_VERSION" ]; then
      CURRENT_SIZE=$(/usr/bin/du -sk "$TARGET" 2>/dev/null | /usr/bin/awk '{print $1}')
      if [ -n "$CURRENT_SIZE" ] && [ "$CURRENT_SIZE" = "$last_size" ]; then
        stable_count=$((stable_count + 1))
      else
        stable_count=0
        last_size="$CURRENT_SIZE"
      fi
      if [ "$stable_count" -ge 2 ]; then
        break
      fi
    else
      stable_count=0
      last_size=""
    fi
  fi
  sleep 2
  waited=$((waited + 2))
done

if [ "$waited" -ge 1200 ]; then
  log_line "[UPDATER MAC HELPER] replacement timeout"
  cleanup
  exit 4
fi

if [ "$TARGET" != "/Applications/WhatsIAPP.app" ]; then
  log_line "[UPDATER MAC HELPER] target guard failed"
  cleanup
  exit 5
fi

if /usr/bin/xattr -dr com.apple.quarantine "$TARGET" >> "$LOG_FILE" 2>&1; then
  log_line "[UPDATER MAC HELPER] quarantine removed"
else
  log_line "[UPDATER MAC HELPER] quarantine removal failed"
fi

if /usr/bin/open "$TARGET" >> "$LOG_FILE" 2>&1; then
  log_line "[UPDATER MAC HELPER] updated app opened"
else
  log_line "[UPDATER MAC HELPER] updated app open failed"
fi

cleanup
exit 0
`;
}

module.exports = {
  MAC_APP_TARGET,
  plataformaUpdater,
  parseSemver,
  compararVersoes,
  ehPrerelease,
  ehVersaoSuperior,
  arquivoWindowsX64Esperado,
  selecionarArquivoWindowsX64,
  validarUpdateWindows,
  selecionarAssetMacArm64,
  selecionarLatestMacYml,
  extrairMetadadosLatestMac,
  hostGitHubPermitido,
  urlGitHubPermitida,
  validarCaminhoDmg,
  validarCaminhoAplicacaoMac,
  normalizarEstadoPendente,
  criarScriptQuarentenaTemporario,
};
