"use strict";
const fs = require('fs');
const { pathToFileURL } = require('url');

// Caminho e URL pertencem sempre a mesma fonte. Prefira um arquivo existente.
function reconciliarReferenciaMidia(...fontes) {
  for (const fonte of fontes) {
    if (!fonte?.mediaPath) continue;
    try {
      if (fs.statSync(fonte.mediaPath).size > 0) {
        return { mediaPath: fonte.mediaPath, mediaUrl: pathToFileURL(fonte.mediaPath).href };
      }
    } catch {}
  }
  for (const fonte of fontes) {
    if (fonte?.mediaUrl && !fonte.mediaUrl.startsWith('file:')) {
      return { mediaPath: null, mediaUrl: fonte.mediaUrl };
    }
  }
  return { mediaPath: null, mediaUrl: null };
}
module.exports = { reconciliarReferenciaMidia };
