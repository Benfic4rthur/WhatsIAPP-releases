"use strict";

const texto = (v, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function urlHttp(valor) {
  try {
    const u = new URL(texto(valor, 4096));
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
function miniatura(valor) {
  if (!valor) return null;
  if (valor.type === 'Buffer' && Array.isArray(valor.data)) {
    if (valor.data.length > 500000) return null;
    valor = Buffer.from(valor.data);
  }
  if (valor instanceof Uint8Array && valor.length > 500000) return null;
  if (valor instanceof Uint8Array) valor = Buffer.from(valor).toString('base64');
  if (typeof valor !== 'string' || valor.length > 700000) return null;
  const base = valor.replace(/^data:image\/(jpeg|png|webp);base64,/, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base)) return null;
  const buf = Buffer.from(base, 'base64');
  const mime = buf[0] === 255 && buf[1] === 216 ? 'jpeg'
    : buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : buf.toString('ascii',0,4) === 'RIFF' && buf.toString('ascii',8,12) === 'WEBP' ? 'webp' : null;
  return mime ? `data:image/${mime};base64,${base}` : null;
}
function localizacao(valor) {
  if (!valor || typeof valor.latitude === 'boolean' || typeof valor.longitude === 'boolean' || valor.latitude == null || valor.longitude == null ||
      String(valor.latitude).trim() === '' || String(valor.longitude).trim() === '') return null;
  const latitude = Number(valor.latitude), longitude = Number(valor.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) return null;
  return { latitude, longitude, nome: texto(valor.nome,300), endereco: texto(valor.endereco,600), miniatura: miniatura(valor.miniatura) };
}
function previaLink(valor) {
  const url = urlHttp(valor?.url);
  if (!url) return null;
  const titulo = texto(valor.titulo,500), descricao = texto(valor.descricao), imagem = miniatura(valor.miniatura);
  return titulo || descricao || imagem ? {url,titulo,descricao,miniatura:imagem} : null;
}
function extrairCartoesBaileys(msg = {}) {
  const l = msg.locationMessage, p = msg.extendedTextMessage;
  return {
    localizacao: l ? localizacao({latitude:l.degreesLatitude,longitude:l.degreesLongitude,nome:l.name,endereco:l.address,miniatura:l.jpegThumbnail}) : null,
    previaLink: p ? previaLink({url:urlHttp(p.canonicalUrl) || urlHttp(p.matchedText),titulo:p.title,descricao:p.description,miniatura:p.jpegThumbnail}) : null,
  };
}
function extrairCartoesWpp(msg = {}) {
  const p = msg.linkPreview || msg;
  return {
    localizacao: msg.type === 'location' ? localizacao({latitude:msg.lat,longitude:msg.lng,nome:msg.name,endereco:msg.loc || msg.address,miniatura:msg.thumbnail || msg.body}) : null,
    previaLink: previaLink({url:urlHttp(p.canonicalUrl) || urlHttp(p.matchedText),titulo:p.title,descricao:p.description,miniatura:p.thumbnail || p.jpegThumbnail}),
  };
}
function mesclarCartoes(anterior = {}, novo = {}) {
  const a = localizacao(anterior.localizacao), b = localizacao(novo.localizacao);
  const x = previaLink(anterior.previaLink), y = previaLink(novo.previaLink);
  const completar = (old, current) => Object.fromEntries(Object.keys(current).map(k=>[k,current[k] || old[k] || current[k]]));
  return {
    localizacao: a && b && a.latitude === b.latitude && a.longitude === b.longitude ? completar(a,b) : b || a,
    previaLink: x && y && x.url === y.url ? completar(x,y) : y || x,
  };
}
function urlMapa(l) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${l.latitude},${l.longitude}`)}`;
}
module.exports = {urlHttp,miniatura,localizacao,previaLink,extrairCartoesBaileys,extrairCartoesWpp,mesclarCartoes,urlMapa};
