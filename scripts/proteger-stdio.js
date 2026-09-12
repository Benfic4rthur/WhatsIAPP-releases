// Um terminal pode fechar enquanto o Electron e seus workers continuam ativos.
// O encaminhamento automatico de stdout/stderr dos workers nao pode derrubar
// a interface por um pipe fechado. Outros erros continuam sendo propagados.
function protegerStdio(stream) {
  stream.on("error", (erro) => {
    if (erro.code !== "EPIPE") throw erro;
  });
}

module.exports = protegerStdio;
