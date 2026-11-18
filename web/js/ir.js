// "Ir directo": entiende referencias escritas a mano como
//   "LISR 27", "isr 113e", "art. 69-B CFF", "artículo 27 de la LISR", "liva 1o-a", "lisr 82 bis"
// y las convierte en {siglas, clave} → #/LISR/27

import { normalizar } from "./buscador.js";

// Alias (ya normalizados: minúsculas, sin acentos ni espacios) → siglas del catálogo
const ALIAS = {
  lisr: "LISR", isr: "LISR", leyisr: "LISR",
  rlisr: "RLISR", risr: "RLISR", reglamentolisr: "RLISR", reglamentoisr: "RLISR",
  cff: "CFF", codigo: "CFF", codigofiscal: "CFF",
  rcff: "RCFF", reglamentocff: "RCFF",
  liva: "LIVA", iva: "LIVA",
  rliva: "RLIVA", riva: "RLIVA", reglamentoiva: "RLIVA",
};

const SUFIJOS = "bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies";
// Número de regla de la RMF (2.7.1.1) o de artículo (27, 69-B, 1o.-A, 82 Bis)
const NUM = `\\d+(?:\\.\\d+){1,4}\\.?|\\d+(?:o(?![a-z]))?(?:[\\s.-]*(?:${SUFIJOS}|[a-z](?![a-z])))*`;
// Siglas, con año opcional solo si después viene el número de artículo: "lif2027 3", "lif 2027 3", "lif27 3"
const SIG = "[a-z]+(?:\\d{2}(?:\\d{2})?(?=\\s)|\\s\\d{4}(?=\\s))?";
const ART = "(?:art(?:iculo|\\.)?|regla)?\\s*";
const RE_SIG_NUM = new RegExp(`^(${SIG})\\s*${ART}(${NUM})$`);
const RE_NUM_SIG = new RegExp(`^${ART}(${NUM})\\s*(?:de\\s+(?:la|el)\\s+)?(${SIG})$`);

/** "1o.-A" → "1-a";  "17 H bis" → "17-h-bis";  "113e" → "113-e" (misma regla que el extractor) */
export function claveArticulo(numero) {
  let n = normalizar(numero).trim();
  n = n.replace(/^(\d+)o(?![a-z])/, "$1");
  n = n.replace(/(\d)([a-z])/g, "$1-$2");
  return n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Siglas del catálogo a partir de lo que escribió el usuario (o null). */
export function resolverSiglas(texto, catalogo) {
  const t = normalizar(texto).replace(/[\s.]/g, "");
  const directa = catalogo.find((l) => l.siglas.toLowerCase() === t);
  if (directa) return directa.siglas;
  // "lif" / "rmf" (o "miscelanea") sin año → la del año en curso (o la más reciente cargada)
  const anual = t.match(/^(lif|rmf|miscelanea)(\d{2}|\d{4})?$/);
  if (anual) {
    const pref = anual[1] === "lif" ? "LIF" : "RMF";
    const anio = anual[2] ? (anual[2].length === 2 ? "20" + anual[2] : anual[2]) : String(new Date().getFullYear());
    const docs = catalogo.filter((l) => l.siglas.startsWith(pref)).map((l) => l.siglas).sort();
    return docs.find((s) => s === `${pref}${anio}`) || (!anual[2] ? docs.at(-1) : null) || `${pref}${anio}`;
  }
  return ALIAS[t] || null;
}

/** Intenta leer "LISR 27" y variantes. Devuelve {siglas, clave, numero} o null si no parece una referencia. */
export function leerReferencia(texto, catalogo) {
  const t = normalizar(texto).replace(/\s+/g, " ").trim();
  const m = t.match(RE_SIG_NUM) || t.match(RE_NUM_SIG);
  if (!m) return null;
  const [sig, num] = t.match(RE_SIG_NUM) ? [m[1], m[2]] : [m[2], m[1]];
  const siglas = resolverSiglas(sig, catalogo);
  if (!siglas) return null;
  return { siglas, clave: claveArticulo(num), numero: num.toUpperCase() };
}
