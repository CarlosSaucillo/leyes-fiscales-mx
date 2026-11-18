// Búsqueda de texto libre con MiniSearch (índice invertido: palabra → artículos donde aparece).
// Cada ley se agrega al índice en cuanto se carga, así que la búsqueda crece "bajo demanda".
import { alCargarLey } from "./datos.js";

/** Minúsculas y sin acentos: "Deducción" → "deduccion" (ñ → n). */
export const normalizar = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Palabras demasiado comunes que no aportan a la búsqueda
const VACIAS = new Set(("a al ante con contra de del desde el en entre hacia hasta la las le les lo los " +
  "para por que se sin sobre su sus un una uno unos unas y o u e ni no como esta este estos estas ese esa " +
  "dicho dicha dichos dichas cual cuales cuando mas ya es son ser sera seran ha han").split(" "));

const indice = new MiniSearch({
  idField: "id",
  fields: ["numero", "texto", "ruta"],
  storeFields: ["ley", "numero", "unidad"],
  processTerm: (t) => {
    const n = normalizar(t);
    return VACIAS.has(n) ? null : n;
  },
  searchOptions: {
    boost: { numero: 4, ruta: 1.5 },
    combineWith: "AND",
    prefix: (t) => t.length >= 4,
    // Tolera un error de dedo solo en palabras largas ("deducibel" → "deducible")
    fuzzy: (t) => (t.length >= 7 ? 1 : false),
  },
});

const indexadas = new Set();
const textoNormalizado = new Map();   // id → texto sin acentos (para premiar frases exactas)

/** Texto "plano" para buscar: sin marcas de imagen ni separadores de tabla. */
export const textoPlano = (t) => t
  .replace(/\[\[imagen:[^|\]]+\|([^|\]]*)(?:\|[^\]]*)?\]\]/g, "$1")
  .replace(/^\|\s?|\s?\|$/gm, "")
  .replace(/ \| /g, " · ");

alCargarLey((ley) => {
  if (indexadas.has(ley.siglas)) return;
  indexadas.add(ley.siglas);
  ley.unidades.forEach((u) => textoNormalizado.set(u.id, normalizar(textoPlano(u.texto)).replace(/\s+/g, " ")));
  indice.addAll(ley.unidades.map((u) => ({
    id: u.id, ley: u.ley, numero: u.numero, unidad: u.unidad, texto: textoPlano(u.texto),
    ruta: u.ruta.map((r) => `${r.etiqueta} ${r.nombre || ""}`).join(" "),
  })));
});

/**
 * Busca `consulta` en las leyes indicadas (array de siglas; vacío = todas).
 * Devuelve [{id, ley, numero, score, terms}] ordenado por relevancia.
 */
export function buscar(consulta, leyesFiltro = []) {
  const q = consulta.trim();
  if (!q) return [];
  const filtro = leyesFiltro.length ? (r) => leyesFiltro.includes(r.ley) : undefined;
  let res = indice.search(q, { filter: filtro });
  // Si exigir todas las palabras no da nada, se relaja a "cualquiera"
  if (!res.length) res = indice.search(q, { filter: filtro, combineWith: "OR" });

  // Premiar la frase exacta, y más si aparece al inicio del artículo (donde suele definirse el tema)
  const frase = normalizar(q).replace(/\s+/g, " ");
  if (frase.includes(" ")) {
    for (const r of res) {
      const t = textoNormalizado.get(r.id) || "";
      const pos = t.indexOf(frase);
      if (pos >= 0) r.score *= pos < 300 ? 4 : 2;
    }
    res.sort((a, b) => b.score - a.score);
  }
  return res;
}

// ---------- Fragmento con resaltado ----------
const escapar = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Normaliza conservando posiciones (un carácter de salida por carácter de entrada). */
function normalizarPosicional(s) {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD")[0].toLowerCase();
    out += base.length === ch.length ? base : ch; // por seguridad, nunca cambiar la longitud
  }
  return out;
}

/** Busca las palabras del texto que empiezan con alguno de los términos encontrados. */
function rangos(texto, terminos) {
  const norm = normalizarPosicional(texto);
  const res = [];
  for (const t of terminos) {
    if (!t) continue;
    const re = new RegExp(`(?<![a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z0-9]*`, "g");
    for (const m of norm.matchAll(re)) res.push([m.index, m.index + m[0].length]);
  }
  res.sort((a, b) => a[0] - b[0]);
  const unidos = [];
  for (const r of res) {
    const ult = unidos[unidos.length - 1];
    if (ult && r[0] <= ult[1]) ult[1] = Math.max(ult[1], r[1]);
    else unidos.push([...r]);
  }
  return unidos;
}

/** HTML seguro con las coincidencias envueltas en <mark>. */
export function resaltar(texto, terminos) {
  const rs = rangos(texto, terminos);
  let html = "", pos = 0;
  for (const [a, b] of rs) {
    html += escapar(texto.slice(pos, a)) + "<mark>" + escapar(texto.slice(a, b)) + "</mark>";
    pos = b;
  }
  return html + escapar(texto.slice(pos));
}

/** Fragmento de ~260 caracteres alrededor de la zona con más coincidencias. */
export function fragmento(texto, terminos, consulta = "", ancho = 260) {
  const plano = textoPlano(texto).replace(/\s*\n\s*/g, " ");
  const rs = rangos(plano, terminos);
  if (!rs.length) return escapar(plano.slice(0, ancho)) + (plano.length > ancho ? "…" : "");
  // Si la frase exacta aparece, el fragmento se centra en ella; si no, en la zona con más coincidencias
  const frase = normalizar(consulta).replace(/\s+/g, " ").trim();
  const posFrase = frase.includes(" ") ? normalizarPosicional(plano).indexOf(frase) : -1;
  let mejor = rs[0][0], mejorCuenta = 0;
  if (posFrase >= 0) {
    mejor = posFrase;
  } else {
    for (const [a] of rs) {
      const cuenta = rs.filter(([x]) => x >= a && x < a + ancho).length;
      if (cuenta > mejorCuenta) { mejor = a; mejorCuenta = cuenta; }
    }
  }
  let ini = Math.max(0, mejor - 60);
  if (ini > 0) ini = plano.indexOf(" ", ini) + 1 || ini;
  let fin = Math.min(plano.length, ini + ancho);
  if (fin < plano.length) fin = plano.lastIndexOf(" ", fin) > ini ? plano.lastIndexOf(" ", fin) : fin;
  return (ini > 0 ? "…" : "") + resaltar(plano.slice(ini, fin), terminos) + (fin < plano.length ? "…" : "");
}

export { escapar };
