// Almacén local del navegador (localStorage): pestañas, historial, notas y correlaciones.
// Todo se queda en ESTE navegador; nadie más lo ve. Para no perderlo hay respaldo
// (exportar/importar un archivo .json) en la página "Mis notas".

const PREFIJO = "lf:";

export function leer(clave, porDefecto) {
  try {
    const v = localStorage.getItem(PREFIJO + clave);
    return v === null ? porDefecto : JSON.parse(v);
  } catch {
    return porDefecto;
  }
}

export function guardar(clave, valor) {
  try {
    localStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false; // almacenamiento lleno o bloqueado (p. ej. navegación privada)
  }
}

// ---------- Historial ----------
const MAX_HISTORIAL = 200;

/** Registra una consulta: {id, ley, titulo, ruta, ubicacion, fecha}. La más reciente queda primero. */
export function registrarHistorial(entrada) {
  const h = leer("historial", []).filter((x) => x.id !== entrada.id);
  h.unshift({ ...entrada, fecha: Date.now() });
  guardar("historial", h.slice(0, MAX_HISTORIAL));
}
export const historial = () => leer("historial", []);
export const borrarHistorial = () => guardar("historial", []);

// ---------- Notas por artículo ----------
export const notas = () => leer("notas", {});
export const nota = (id) => notas()[id]?.texto || "";

export function guardarNota(id, texto, meta = {}) {
  const todas = notas();
  if (texto.trim()) todas[id] = { texto, actualizado: Date.now(), ...meta };
  else delete todas[id];
  return guardar("notas", todas);
}

// ---------- Correlaciones manuales (propias de este navegador) ----------
export const correlacionesPropias = () => leer("correlaciones", []);

export function agregarCorrelacion(de, a, nota = "") {
  const lista = correlacionesPropias();
  const existe = lista.some((c) => (c.de === de && c.a === a) || (c.de === a && c.a === de));
  if (!existe) {
    lista.push({ de, a, nota: nota.trim(), fecha: new Date().toISOString().slice(0, 10) });
    guardar("correlaciones", lista);
  }
  return !existe;
}

export function quitarCorrelacion(de, a) {
  guardar("correlaciones", correlacionesPropias().filter((c) => !(c.de === de && c.a === a)));
}

// ---------- Respaldo ----------
export function respaldo() {
  return {
    tipo: "respaldo-legislacion-fiscal",
    version: 1,
    exportado: new Date().toISOString(),
    notas: notas(),
    correlaciones: correlacionesPropias(),
  };
}

/** Mezcla un respaldo con lo que ya hay. En notas repetidas gana la más reciente. Devuelve conteos. */
export function importarRespaldo(datos) {
  if (!datos || datos.tipo !== "respaldo-legislacion-fiscal") {
    throw new Error("El archivo no es un respaldo de este buscador.");
  }
  const actuales = notas();
  let nNotas = 0;
  for (const [id, n] of Object.entries(datos.notas || {})) {
    if (!n?.texto) continue;
    if (!actuales[id] || (n.actualizado || 0) > (actuales[id].actualizado || 0)) {
      actuales[id] = n;
      nNotas++;
    }
  }
  guardar("notas", actuales);
  let nCorr = 0;
  for (const c of datos.correlaciones || []) {
    if (c?.de && c?.a && agregarCorrelacion(c.de, c.a, c.nota || "")) nCorr++;
  }
  return { nNotas, nCorr };
}

/** Descarga un objeto como archivo .json */
export function descargarJSON(nombre, objeto) {
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "hace 5 min", "ayer 18:20", "12 nov" */
export function haceCuanto(ms) {
  const seg = (Date.now() - ms) / 1000;
  if (seg < 60) return "hace un momento";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  const f = new Date(ms);
  const hoy = new Date();
  const hora = f.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  if (f.toDateString() === hoy.toDateString()) return `hoy ${hora}`;
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  if (f.toDateString() === ayer.toDateString()) return `ayer ${hora}`;
  return f.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: f.getFullYear() === hoy.getFullYear() ? undefined : "numeric" });
}
