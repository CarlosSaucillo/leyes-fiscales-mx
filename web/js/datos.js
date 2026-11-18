// Carga de datos: catálogo de leyes y cada ley "bajo demanda" (solo cuando se necesita).
// Las promesas se guardan para no descargar dos veces el mismo archivo.

let catalogoPromesa = null;
const leyes = new Map();            // siglas → Promise<ley>
const avisosCarga = new Set();      // funciones a llamar cuando termina de cargar una ley

export function alCargarLey(fn) { avisosCarga.add(fn); }

async function leerJSON(ruta) {
  let r;
  try {
    r = await fetch(ruta);
  } catch {
    throw new Error(location.protocol === "file:"
      ? "El navegador no permite leer los datos abriendo el archivo con doble clic. Ábrelo con el servidor local (ver README)."
      : `No se pudo descargar ${ruta}. Revisa tu conexión.`);
  }
  if (!r.ok) throw new Error(`No se encontró ${ruta} (error ${r.status}).`);
  return r.json();
}

export function cargarCatalogo() {
  catalogoPromesa ??= leerJSON("data/catalogo.json");
  return catalogoPromesa;
}

export async function infoLey(siglas) {
  const cat = await cargarCatalogo();
  return cat.find((l) => l.siglas.toLowerCase() === String(siglas).toLowerCase()) || null;
}

/** Devuelve la ley con índices auxiliares: porId (Map) y orden (array de unidades). */
export function cargarLey(siglas) {
  if (!leyes.has(siglas)) {
    const p = (async () => {
      const info = await infoLey(siglas);
      if (!info) throw new Error(`No existe el ordenamiento "${siglas}".`);
      const datos = await leerJSON(`data/${info.archivo}`);
      const ley = {
        ...datos.ley,
        unidades: datos.unidades,
        porId: new Map(datos.unidades.map((u, i) => [u.id, { ...u, indice: i }])),
      };
      ley.unidades = [...ley.porId.values()];
      avisosCarga.forEach((fn) => fn(ley));
      return ley;
    })();
    p.catch(() => leyes.delete(siglas));   // si falla, permitir reintentar
    leyes.set(siglas, p);
  }
  return leyes.get(siglas);
}

export async function cargarTodas() {
  const cat = await cargarCatalogo();
  return Promise.all(cat.map((l) => cargarLey(l.siglas)));
}

export function leyYaCargada(siglas) { return leyes.has(siglas); }

/** Correlaciones manuales "de la oficina" (archivo publicado con el sitio). Si no existe, lista vacía. */
let correlacionesPromesa = null;
export function cargarCorrelacionesOficiales() {
  correlacionesPromesa ??= leerJSON("data/correlaciones_manuales.json")
    .then((d) => (Array.isArray(d.correlaciones) ? d.correlaciones : []))
    .catch(() => []);
  return correlacionesPromesa;
}

/** Siglas de la ley a la que pertenece un id ("cff-69-b" → "CFF"), según el catálogo. */
export async function leyDeId(id) {
  const cat = await cargarCatalogo();
  return cat.map((l) => l.siglas)
    .filter((s) => id.startsWith(s.toLowerCase() + "-"))
    .sort((a, b) => b.length - a.length)[0] || null;
}

// ---------- Formatos ----------
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2021-11-12" → "12 nov 2021" */
export function fecha(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
}

/** "lisr-27" → "27" (parte de la URL) */
export const claveUrl = (u) => u.id.slice(u.ley.length + 1);

export function tituloUnidad(u) {
  if (u.unidad === "transitorio") {
    return u.fecha_publicacion ? `Transitorios · DOF ${fecha(u.fecha_publicacion)}` : u.numero;
  }
  if (u.unidad === "regla") return `Regla ${u.numero}`;
  return `Artículo ${u.numero}`;
}

export function tituloCorto(u) {
  if (u.unidad === "transitorio") return u.fecha_publicacion ? `DOF ${fecha(u.fecha_publicacion)}` : u.numero;
  return u.numero;
}

export const etiquetaDivision = (d) => d.etiqueta + (d.nombre ? ` — ${d.nombre}` : "");
