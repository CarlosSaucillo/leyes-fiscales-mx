// Aplicación principal: enrutador, árbol de materias y vistas.
//
// "Enrutador" = la parte que lee la dirección después del # y decide qué mostrar:
//   #/                     → inicio
//   #/LISR                 → índice de la ley
//   #/LISR/27              → artículo 27 de la LISR (lisr-27)
//   #/LISR/27?q=deduccion  → mismo artículo con las palabras resaltadas
//   #/buscar?q=…&en=LISR   → resultados de búsqueda
//   #/historial, #/notas   → mis consultas recientes / mis notas y respaldo
// Así los enlaces se pueden copiar y compartir, y el botón "atrás" funciona.

import {
  cargarCatalogo, cargarLey, cargarTodas, infoLey, fecha, claveUrl,
  tituloUnidad, tituloCorto, etiquetaDivision, cargarCorrelacionesOficiales, leyDeId, cargarVersiones,
} from "./datos.js";
import { compararTextos } from "./diff.js";
import { buscar, fragmento, resaltar, escapar, normalizar } from "./buscador.js";
import * as almacen from "./almacen.js";
import { iniciarPestanas, actualizarActiva } from "./pestanas.js";
import { leerReferencia, claveArticulo } from "./ir.js";

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const main = $("#contenido");
const arbol = $("#arbol");
const campoBusqueda = $("#campo-busqueda");

// Ordenamientos que se agregarán en fases siguientes (solo para mostrarlos como "en preparación")
const PENDIENTES = [
  { siglas: "RLISR", nombre: "Reglamento de la Ley del Impuesto sobre la Renta" },
  { siglas: "CFF", nombre: "Código Fiscal de la Federación" },
  { siglas: "RCFF", nombre: "Reglamento del Código Fiscal de la Federación" },
  { siglas: "LIVA", nombre: "Ley del Impuesto al Valor Agregado" },
  { siglas: "RLIVA", nombre: "Reglamento de la Ley del Impuesto al Valor Agregado" },
  { siglas: "LIF2026", nombre: "Ley de Ingresos de la Federación 2026" },
  { siglas: "LIF2027", nombre: "Ley de Ingresos de la Federación 2027" },
];

const ICONO = {
  reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>',
  copiar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  cita: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h4v4H8a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5V8zM15 7h4v4h-3a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5V8z"/></svg>',
  enlace: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>',
  vincular: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  pestana: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M12 12v5M9.5 14.5h5"/></svg>',
};

const AVISO_LEGAL = `<p class="aviso-legal">Textos tomados de los documentos oficiales publicados por la Cámara de Diputados
  (<a href="https://www.diputados.gob.mx/LeyesBiblio/" target="_blank" rel="noopener">LeyesBiblio</a>).
  Herramienta de consulta; el texto con validez oficial es el publicado en el Diario Oficial de la Federación.</p>`;

// ==========================================================================
// Enrutador
// ==========================================================================
function leerRuta() {
  const [ruta, consulta = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const partes = ruta.split("/").filter(Boolean).map(decodeURIComponent);
  return { partes, params: new URLSearchParams(consulta) };
}

async function enrutar() {
  cerrarMenu();
  const { partes, params } = leerRuta();
  let titulo = "Inicio";
  try {
    if (partes.length === 0) titulo = await vistaInicio();
    else if (partes[0] === "buscar") titulo = await vistaBusqueda(params);
    else if (partes[0] === "historial") titulo = vistaHistorial();
    else if (partes[0] === "notas") titulo = await vistaNotas();
    else if (partes[0] === "reformas") titulo = await vistaReformas(partes[1], params.get("anio"));
    else if (partes.length === 1) titulo = await vistaLey(partes[0]);
    else titulo = await vistaUnidad(partes[0], partes.slice(1).join("/"), params.get("q"));
  } catch (e) {
    console.error(e);
    titulo = "Error";
    main.innerHTML = `<div class="error"><strong>No se pudo mostrar esta página.</strong><br>${escapar(e.message)}</div>`;
  }
  if (titulo) actualizarActiva(location.hash || "#/", titulo);
}

function irArriba() {
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}

// ---------- Aviso flotante ("Copiado") ----------
let temporizadorAviso;
function avisar(texto) {
  const a = $("#aviso");
  a.textContent = texto;
  a.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; }, 2200);
}

// ==========================================================================
// Árbol de materias (barra lateral)
// ==========================================================================
async function construirArbol() {
  const catalogo = await cargarCatalogo();
  const nodoLey = (l) => `
    <details class="ley" data-siglas="${escapar(l.siglas)}">
      <summary><span class="siglas">${escapar(l.siglas)}</span> <span>${escapar(l.nombre)}</span></summary>
      <div class="rama" data-contenido><div class="proximamente">Cargando…</div></div>
    </details>`;
  const deMateria = (m) => catalogo.filter((l) => (l.materia?.[1] || "Legislación fiscal") === m);
  const leyesHtml = deMateria("Legislación fiscal").map(nodoLey).join("");
  const resolucionesHtml = deMateria("Resoluciones fiscales").map(nodoLey).join("");
  const pendientes = PENDIENTES.filter((p) => !catalogo.some((l) => l.siglas === p.siglas));

  arbol.innerHTML = `
    <details class="materia" open>
      <summary>Fiscal</summary>
      <div class="rama">
        <details class="materia" open>
          <summary>Legislación fiscal</summary>
          <div class="rama">${leyesHtml}
            ${pendientes.map((p) => `<div class="proximamente" title="Se agregará en la fase 3">${escapar(p.siglas)} · en preparación</div>`).join("")}
          </div>
        </details>
        <details class="materia" open>
          <summary>Resoluciones fiscales</summary>
          <div class="rama">${resolucionesHtml || '<div class="proximamente">En preparación</div>'}</div>
        </details>
      </div>
    </details>`;

  arbol.querySelectorAll("details.ley").forEach((d) =>
    d.addEventListener("toggle", () => { if (d.open) llenarRamaLey(d); }));

  // Selector de ley del formulario "Ir a artículo" y del diálogo de correlaciones
  const opciones = catalogo.map((l) => `<option value="${escapar(l.siglas)}">${escapar(l.siglas)}</option>`).join("");
  $("#ir-ley").innerHTML = opciones;
  $("#corr-ley").innerHTML = opciones;
}

async function llenarRamaLey(detalle) {
  if (detalle.dataset.lleno) return;
  detalle.dataset.lleno = "1";
  const ley = await cargarLey(detalle.dataset.siglas);
  const cont = $("[data-contenido]", detalle);
  cont.innerHTML = `<a href="#/${escapar(ley.siglas)}">Índice completo</a>` +
    ley.estructura.map((n) => nodoArbol(ley, n)).join("") + nodosDocumentos(ley);
  marcarNotasEnArbol();
}

function nodoArbol(ley, nodo) {
  let conTitulo = false;
  const enlaces = nodo.unidades.map((id) => {
    const u = ley.porId.get(id);
    const aviso = u.pendientes?.length || u.nueva_en ? ` <span class="marca-pendiente" title="Con cambios posteriores al compilado">●</span>` : "";
    if (u.unidad === "regla" || u.unidad === "glosario") {
      conTitulo = true;
      return `<a class="con-titulo" href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}" data-id="${escapar(u.id)}"
                 title="${escapar(u.titulo_regla || "")}"><b>${escapar(tituloCorto(u))}</b> ${escapar(u.titulo_regla || "")}${aviso}</a>`;
    }
    return `<a href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}" data-id="${escapar(u.id)}"
               title="${escapar(tituloUnidad(u))}">${escapar(tituloCorto(u))}</a>`;
  }).join("");
  const esTrans = nodo.nivel === "transitorios" || conTitulo;
  return `
    <details>
      <summary><span class="etiqueta">${escapar(nodo.etiqueta)}</span>
        ${nodo.nombre ? `<span class="nombre-div">${escapar(nodo.nombre)}</span>` : ""}</summary>
      <div class="rama">
        ${nodo.hijos.map((h) => nodoArbol(ley, h)).join("")}
        ${enlaces ? `<div class="${esTrans ? "" : "rejilla-art"}">${enlaces}</div>` : ""}
      </div>
    </details>`;
}

/** Documentos relacionados (RMF): modificaciones, versiones anticipadas y anexos, con su PDF oficial. */
function nodosDocumentos(ley) {
  const d = ley.documentos;
  if (!d) return "";
  const item = (x, extra = "") => `<a class="documento" href="${escapar(x.url)}" target="_blank" rel="noopener"
      title="Abrir el PDF oficial del SAT">${escapar(x.titulo)}${x.fecha ? ` <small>${escapar(fecha(x.fecha))}</small>` : ""}${extra}</a>`;
  const mods = d.modificaciones.map((x) => item(x, x.integrada ? "" : ` <span class="marca-pendiente" title="Aún no integrada en el compilado">●</span>`)).join("");
  const antic = d.anticipadas.map((x) => item(x, x.publicada_dof ? "" : ` <span class="marca-pendiente" title="Aún no publicada en el DOF">●</span>`)).join("");
  return `
    <details><summary><span class="etiqueta">Resoluciones de modificaciones</span></summary><div class="rama">${item(d.base)}${mods}</div></details>
    <details><summary><span class="etiqueta">Versiones anticipadas</span> <span class="nombre-div">${d.anticipadas.length}</span></summary><div class="rama">${antic}</div></details>
    <details><summary><span class="etiqueta">Anexos</span> <span class="nombre-div">${d.anexos.length}</span></summary><div class="rama">${d.anexos.map((x) => item(x)).join("")}</div></details>`;
}

/** Punto junto a los artículos que tienen nota personal. */
function marcarNotasEnArbol() {
  const conNota = almacen.notas();
  arbol.querySelectorAll("a[data-id]").forEach((a) => a.classList.toggle("con-nota", Boolean(conNota[a.dataset.id])));
}

/** Marca en el árbol el artículo abierto y despliega sus ramas. */
async function marcarEnArbol(siglas, id) {
  arbol.querySelectorAll("a.activo").forEach((a) => a.classList.remove("activo"));
  const detalle = arbol.querySelector(`details.ley[data-siglas="${CSS.escape(siglas)}"]`);
  if (!detalle) return;
  await llenarRamaLey(detalle);
  detalle.open = true;
  const enlace = id && detalle.querySelector(`a[data-id="${CSS.escape(id)}"]`);
  if (!enlace) return;
  enlace.classList.add("activo");
  for (let p = enlace.parentElement; p && p !== arbol; p = p.parentElement) {
    if (p.tagName === "DETAILS") p.open = true;
  }
  enlace.scrollIntoView({ block: "nearest" });
}

// ==========================================================================
// Vistas: inicio e índice de ley
// ==========================================================================
function tarjetaLey(l) {
  return `
    <a class="tarjeta" href="#/${escapar(l.siglas)}">
      <span class="siglas">${escapar(l.siglas)}</span>
      <h3>${escapar(l.nombre)}</h3>
      <dl>
        <dt>Última reforma</dt><dd>${l.ultima_reforma ? "DOF " + fecha(l.ultima_reforma) : "Sin reformas"}</dd>
        <dt>Publicación</dt><dd>DOF ${fecha(l.publicacion)}</dd>
        <dt>Contenido</dt><dd>${l.num_articulos} ${l.unidad_nombre || "artículos"} · ${l.num_transitorios} ${l.num_transitorios === 1 ? "bloque" : "bloques"} de transitorios</dd>
        ${l.compilado ? `<dt>Compilado SAT</dt><dd>integra hasta la ${escapar(l.compilado.integra_hasta)}</dd>` : ""}
        ${l.pendientes?.length ? `<dt>Pendiente</dt><dd class="texto-aviso">${l.tipo === "resolucion" ? `${l.pendientes.length} documento(s) aún no integrados`
          : `reforma DOF ${fecha(l.pendientes.at(-1).fecha)} aún no integrada${l.pendientes.at(-1).en_vigor ? ` (vigor: ${fecha(l.pendientes.at(-1).en_vigor)})` : ""}`}</dd>` : ""}
      </dl>
    </a>`;
}

async function vistaInicio() {
  document.title = "Legislación fiscal federal";
  const catalogo = await cargarCatalogo();
  const recientes = almacen.historial().slice(0, 6);
  main.innerHTML = `
    <h1>Legislación fiscal federal</h1>
    <p class="subtitulo">Consulta por ley, título, capítulo y artículo, o busca cualquier palabra en el texto vigente.
      Escribe <kbd>LISR 27</kbd> en el buscador para ir directo a un artículo.</p>
    ${recientes.length ? `
      <h2>Consultados recientemente</h2>
      <ul class="lista-simple">${recientes.map(itemHistorial).join("")}</ul>
      <p><a href="#/historial">Ver todo el historial →</a></p>
      <h2>Ordenamientos</h2>` : ""}
    <div class="tarjetas">
      ${catalogo.filter((l) => l.tipo !== "resolucion").map(tarjetaLey).join("")}
      ${PENDIENTES.filter((p) => !catalogo.some((l) => l.siglas === p.siglas)).map((p) => `
        <div class="tarjeta pendiente">
          <span class="siglas">${escapar(p.siglas)}</span>
          <h3>${escapar(p.nombre)}</h3>
          <dl><dt>Estado</dt><dd>En preparación</dd></dl>
        </div>`).join("")}
    </div>
    ${catalogo.some((l) => l.tipo === "resolucion") ? `<h2>Resoluciones fiscales</h2>
      <div class="tarjetas">${catalogo.filter((l) => l.tipo === "resolucion").map(tarjetaLey).join("")}</div>` : ""}
    ${AVISO_LEGAL}`;
  irArriba();
  return "Inicio";
}

function rangoArticulos(ley, nodo) {
  const nums = [];
  const recorrer = (n) => {
    n.unidades.forEach((id) => { const u = ley.porId.get(id); if (u.unidad === "articulo" || u.unidad === "regla") nums.push(u.numero); });
    n.hijos.forEach(recorrer);
  };
  recorrer(nodo);
  if (!nums.length) return "";
  const [uno, varios] = ley.tipo === "resolucion" ? ["Regla", "Reglas"] : ["Art.", "Arts."];
  return nums.length === 1 ? `${uno} ${nums[0]}` : `${varios} ${nums[0]} a ${nums[nums.length - 1]}`;
}

function nodoIndice(ley, nodo) {
  let conTitulo = false;
  const enlaces = nodo.unidades.map((id) => {
    const u = ley.porId.get(id);
    if (u.titulo_regla && u.unidad !== "transitorio") {
      conTitulo = true;
      return `<a class="con-titulo" href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}"><b>${escapar(tituloCorto(u))}</b> ${escapar(u.titulo_regla)}</a>`;
    }
    return `<a href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}">${escapar(tituloCorto(u))}</a>`;
  }).join("");
  return `
    <details>
      <summary>
        <span class="etiqueta">${escapar(nodo.etiqueta)}</span>
        ${nodo.nombre ? `<span class="nombre-div">${escapar(nodo.nombre)}</span>` : ""}
        <span class="rango">${escapar(rangoArticulos(ley, nodo))}</span>
      </summary>
      <div class="rama">
        ${nodo.hijos.map((h) => nodoIndice(ley, h)).join("")}
        ${enlaces ? `<div class="${conTitulo ? "lista-reglas" : "lista-art"}">${enlaces}</div>` : ""}
      </div>
    </details>`;
}

/** Bloque informativo de la RMF: compilado vigente y documentos posteriores aún no integrados. */
function infoPendientes(ley) {
  const pend = ley.pendientes || [];
  if (!ley.compilado && !pend.length) return "";
  const esRes = ley.tipo === "resolucion";
  return `
    <div class="aviso-compilado${pend.length && !esRes ? " con-pendientes" : ""}">
      ${esRes ? `<p><strong>Texto vigente:</strong> ${escapar(ley.compilado.titulo)} del SAT (integra hasta la ${escapar(ley.compilado.integra_hasta)}).
        <a href="${escapar(ley.compilado.url)}" target="_blank" rel="noopener">PDF</a></p>`
        : `<p><strong>Reformas publicadas que aún no están en el texto de la Cámara de Diputados.</strong>
           El texto que ves es el vigente hasta la reforma del DOF ${escapar(fecha(ley.ultima_reforma))};
           los artículos afectados muestran un aviso con el extracto oficial del decreto.</p>`}
      ${pend.length ? `${esRes ? "<p><strong>Posteriores al compilado</strong> (se muestran como aviso en cada regla afectada; el texto de la regla no se modifica):</p>" : ""}
        <ul>${pend.map((p) => `<li><a href="${escapar(p.url)}" target="_blank" rel="noopener">${escapar(p.titulo)}</a>
          ${p.fecha ? `· ${escapar(fecha(p.fecha))}` : ""} · ${p.tipo === "anticipada" ? "<em>versión anticipada, aún sin publicar en el DOF</em>" : "publicada en el DOF"}
          ${p.en_vigor ? ` · entra en vigor el <strong>${escapar(fecha(p.en_vigor))}</strong>` : ""}</li>`).join("")}</ul>` : ""}
      ${esRes ? `<p class="ayuda">El SAT aclara que el compilado es de consulta: para sustentar actos o resoluciones se usa la publicación en el DOF.</p>` : ""}
    </div>`;
}

async function vistaLey(siglas) {
  const info = await infoLey(siglas);
  if (!info) return noCargada(siglas);
  if (info.siglas !== siglas) { location.replace(`#/${info.siglas}`); return null; }
  const ley = await cargarLey(info.siglas);
  document.title = `${ley.siglas} — ${ley.nombre}`;
  main.innerHTML = `
    <nav class="migas" aria-label="Ubicación"><a href="#/">Inicio</a><span class="sep">›</span><span>${escapar(ley.siglas)}</span></nav>
    <h1>${escapar(ley.nombre)}</h1>
    <div class="insignias">
      <span class="insignia reforma">${ICONO.reloj} Última ${ley.tipo === "resolucion" ? "modificación" : "reforma"}: ${ley.ultima_reforma ? "DOF " + fecha(ley.ultima_reforma) : "sin reformas"}</span>
      <span class="insignia">Publicada: DOF ${fecha(ley.publicacion)}</span>
      <span class="insignia">${ley.num_articulos} ${ley.unidad_nombre || "artículos"}</span>
      <a class="insignia" href="${escapar(ley.fuente)}" target="_blank" rel="noopener">${ICONO.doc} Texto oficial (PDF)</a>
    </div>
    ${infoPendientes(ley)}
    <p><a href="#/reformas/${escapar(ley.siglas)}">Ver ${ley.tipo === "resolucion" ? "modificaciones" : "reformas"} por fecha →</a></p>
    <h2>Índice</h2>
    <div class="indice">${ley.estructura.map((n) => nodoIndice(ley, n)).join("")}</div>
    ${AVISO_LEGAL}`;
  marcarEnArbol(ley.siglas, null);
  irArriba();
  return ley.siglas;
}

/** Mensaje para siglas conocidas que aún no se cargan (o desconocidas). */
function noCargada(siglas) {
  const p = PENDIENTES.find((x) => x.siglas.toLowerCase() === String(siglas).toLowerCase());
  main.innerHTML = p
    ? `<div class="error"><strong>${escapar(p.nombre)}</strong> todavía no está cargada; se agregará en una fase siguiente.</div>`
    : `<div class="error">No existe el ordenamiento «${escapar(siglas)}». <a href="#/">Ver los disponibles</a>.</div>`;
  return String(siglas).toUpperCase();
}

// ==========================================================================
// Vista de artículo
// ==========================================================================
const RE_NOTA = /\bDOF\s+\d{2}-\d{2}-\d{4}/;
const RE_NOTA_VERBO = /(reformad|adicionad|derogad|recorrid|modificad|fe de erratas)/i;
const RE_FRACCION = /^[IVXLC]+\.\s/;
const RE_INCISO = /^[a-zñ]\)\s/;
const RE_NUMERAL = /^\d{1,2}\.\s/;
const RE_IMAGEN = /^\[\[imagen:([^|\]]+)\|([^|\]]*)(?:\|(chica))?\]\]$/;

function claseParrafo(linea) {
  if (RE_NOTA.test(linea) && RE_NOTA_VERBO.test(linea) && linea.length < 400 && !/[.;:]$/.test(linea)) return "nota-reforma";
  if (RE_FRACCION.test(linea)) return "fraccion";
  if (RE_INCISO.test(linea)) return "inciso";
  if (RE_NUMERAL.test(linea)) return "numeral";
  if (linea.length < 140 && linea === linea.toUpperCase() && /[A-ZÁÉÍÓÚ]{4}/.test(linea)) return "encabezado-trans";
  return "";
}

const celdas = (l) => l.replace(/^\|\s?|\s?\|$/g, "").split(" | ");

/** Párrafo con sus hipervínculos (referencias a otros artículos) y palabras resaltadas. */
function parrafoHtml(l, enlaces, marcar) {
  if (!enlaces?.length) return marcar(l);
  let html = "", pos = 0;
  for (const [, ini, fin, destino] of enlaces) {
    if (ini < pos) continue;
    const [siglas, clave] = destino.split("/");
    html += marcar(l.slice(pos, ini)) +
      `<a class="ref" href="#/${escapar(destino)}" data-ley="${escapar(siglas)}" data-clave="${escapar(clave)}">${marcar(l.slice(ini, fin))}</a>`;
    pos = fin;
  }
  return html + marcar(l.slice(pos));
}

function textoHtml(texto, terminos, enlaces = [], opciones = {}) {
  const tablas = new Set(opciones.tablas || []);
  const marcar = (s) => (terminos.length ? resaltar(s, terminos) : escapar(s));
  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  // enlaces: [renglón, inicio, fin, "SIGLAS/clave"] → agrupados por renglón
  const porRenglon = new Map();
  for (const e of enlaces) {
    if (!porRenglon.has(e[0])) porRenglon.set(e[0], []);
    porRenglon.get(e[0]).push(e);
  }
  porRenglon.forEach((lista) => lista.sort((a, b) => a[1] - b[1]));
  let html = "";
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // Tablas: renglones consecutivos "| celda | celda |"
    if (l.startsWith("|")) {
      const filas = [];
      while (i < lineas.length && lineas[i].startsWith("|")) filas.push(celdas(lineas[i++]));
      i--;
      const [cabeza, ...cuerpo] = filas.length > 1 ? filas : [null, ...filas];
      html += `<div class="tabla-envoltura"><table class="tabla-ley">
        ${cabeza ? `<thead><tr>${cabeza.map((c) => `<th>${marcar(c)}</th>`).join("")}</tr></thead>` : ""}
        <tbody>${cuerpo.map((f) => `<tr>${f.map((c) => `<td>${marcar(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
      continue;
    }
    // Imágenes oficiales (tarifas y fórmulas que el documento publica como imagen)
    const img = l.match(RE_IMAGEN);
    if (img) {
      if (img[3]) {   // símbolo pequeño: va en línea, no como figura
        html += `<p><img class="imagen-chica" src="data/${escapar(img[1])}" alt="${escapar(img[2])}" title="${escapar(img[2])}"></p>`;
        continue;
      }
      html += `<figure class="imagen-oficial">
        <img src="data/${escapar(img[1])}" alt="${escapar(img[2])}" loading="lazy">
        <figcaption>${escapar(img[2])} · imagen tomada del documento oficial</figcaption></figure>`;
      continue;
    }
    if (tablas.has(i)) {
      html += `<details class="tabla-pdf"><summary>⚠ Tabla del documento oficial: el PDF no permite extraerla con fidelidad.
        ${opciones.pdf ? `<a href="${escapar(opciones.pdf)}" target="_blank" rel="noopener">Consúltala en el PDF</a>` : "Consúltala en el PDF oficial"}
        (ver texto extraído)</summary><p class="texto-extraido">${marcar(l)}</p></details>`;
      continue;
    }
    const c = claseParrafo(l);
    html += `<p${c ? ` class="${c}"` : ""}>${parrafoHtml(l, porRenglon.get(i), marcar)}</p>`;
  }
  return html;
}

// ---------- Versiones guardadas y comparación ----------
const textoComparable = (u) => {
  const quitar = new Set(u.tablas_pdf || []);
  return u.texto.split("\n").map((l) => l.trim()).filter(Boolean).filter((_, i) => !quitar.has(i)).join("\n");
};

async function pintarVersiones(u, ley) {
  const zona = $("#zona-versiones");
  if (!zona) return;
  if (u.nueva_en || !["articulo", "regla", "glosario"].includes(u.unidad)) {
    zona.closest(".panel").hidden = true;
    return;
  }
  const v = await cargarVersiones(ley.siglas);
  if (!v || v.versiones.length < 2) {
    zona.innerHTML = `<p class="vacio">Por ahora hay una sola versión guardada de esta ${ley.tipo === "resolucion" ? "resolución" : "ley"}
      (${escapar(v?.versiones[0]?.etiqueta || "texto actual")}). Cuando se publique el texto actualizado, aquí podrás ver qué cambió.</p>`;
    return;
  }
  const anteriores = v.versiones.filter((x) => x.clave !== v.actual);
  const conCambio = anteriores.filter((x) => u.id in (v.cambios[x.clave] || {}));
  const desde = anteriores[0];
  if (!conCambio.length) {
    zona.innerHTML = `<p class="vacio">Sin cambios en las ${v.versiones.length} versiones guardadas (desde: ${escapar(desde.etiqueta)}).</p>`;
    return;
  }
  zona.innerHTML = `
    <p class="ayuda">Versiones guardadas en las que este texto era distinto. Elige una para ver qué cambió hasta la versión actual
      (<del>tachado</del> = se quitó, <ins>subrayado</ins> = se agregó).</p>
    <div class="botonera">${conCambio.map((x) => `<button type="button" class="boton" data-version="${escapar(x.clave)}">${escapar(x.etiqueta)}</button>`).join("")}</div>
    <div id="resultado-diff"></div>`;
  zona.querySelectorAll("[data-version]").forEach((b) => b.addEventListener("click", () => {
    zona.querySelectorAll("[data-version]").forEach((x) => x.classList.toggle("primario", x === b));
    const viejo = v.cambios[b.dataset.version][u.id];
    const destino = $("#resultado-diff", zona);
    if (viejo === null) {
      destino.innerHTML = `<p class="vacio">En esa versión este ${u.unidad === "regla" ? "regla" : "artículo"} no existía.</p>`;
      return;
    }
    const { html, cambios } = compararTextos(viejo, textoComparable(u));
    const actual = v.versiones.find((x) => x.clave === v.actual);
    destino.innerHTML = `<p class="resumen-diff"><strong>${escapar(b.textContent)}</strong> → <strong>${escapar(actual.etiqueta)}</strong>
      · ${cambios} cambio${cambios === 1 ? "" : "s"}${u.tablas_pdf ? " · (las tablas no se comparan)" : ""}</p>
      <div class="texto-ley diff">${html}</div>`;
  }));
}

// ---------- Avisos de cambios posteriores al compilado (RMF) ----------
function avisosPendientes(u, ley, terminos) {
  const esRes = ley.tipo === "resolucion";
  const textoBase = esRes ? "el del compilado del SAT" : "el publicado por la Cámara de Diputados";
  const vigor = (x) => (x.en_vigor ? ` Entra en vigor el <strong>${escapar(fecha(x.en_vigor))}</strong>.` : "");
  const bloques = [];
  if (u.nueva_en) {
    const n = u.nueva_en;
    const que = u.unidad === "transitorio" ? "Disposiciones transitorias y de vigencia de un decreto"
      : esRes ? "Regla nueva adicionada por la" : "Artículo nuevo adicionado por el";
    bloques.push(`<div class="aviso-cambio nueva">
      <p><strong>${que}</strong> ${u.unidad === "transitorio" ? "—" : ""}
      <a href="${escapar(n.url)}" target="_blank" rel="noopener">${escapar(n.documento)}</a>
      ${n.fecha ? `(${escapar(fecha(n.fecha))})` : ""}: ${escapar(n.estado)}.${vigor(n)}
      El texto se tomó de ese documento oficial.</p></div>`);
  }
  const pendientes = u.pendientes || [];
  pendientes.forEach((p, i) => {
    const abierto = i === pendientes.length - 1 ? " open" : "";   // solo el más reciente, abierto
    const accion = p.derogada ? (esRes ? "Derogada por la" : "Derogado por el") : (esRes ? "Modificada por la" : "Reformado por el");
    bloques.push(`<details class="aviso-cambio"${abierto}>
      <summary><strong>${accion} ${escapar(p.documento)}</strong>
        ${p.fecha ? `· ${escapar(fecha(p.fecha))}` : ""} — ${escapar(p.estado)}</summary>
      <p class="ayuda">El texto principal de abajo es ${textoBase} y <strong>todavía no incluye este cambio</strong>.${vigor(p)}
        Extracto oficial, tal como se publicó («…» = sin cambios):</p>
      ${p.titulo_regla ? `<p class="epigrafe">${escapar(p.titulo_regla)}</p>` : ""}
      <div class="texto-ley extracto">${textoHtml(p.texto, terminos)}</div>
      <p><a href="${escapar(p.url)}" target="_blank" rel="noopener">${ICONO.doc} Ver el documento oficial (PDF)</a></p>
    </details>`);
  });
  return bloques.join("");
}

// ---------- Copiar con cita ----------
/** "Art. 27 LISR" (o "Transitorios, DOF 18 nov 2015, LISR") */
function citaCorta(u, ley) {
  if (u.unidad === "transitorio") return `Transitorios del decreto publicado en el DOF el ${fecha(u.fecha_publicacion)}, ${ley.siglas}`;
  if (u.unidad === "regla") return `Regla ${u.numero}. de la ${ley.nombre.replace("Resolución Miscelánea Fiscal", "RMF")}`;
  if (u.unidad === "glosario") return `Glosario de la ${ley.nombre.replace("Resolución Miscelánea Fiscal", "RMF")}`;
  return `Art. ${u.numero} ${ley.siglas}`;
}

function citaLarga(u, ley) {
  const reforma = u.ultima_reforma ? `última reforma DOF ${fecha(u.ultima_reforma)}`
    : u.unidad === "articulo" ? `sin reformas desde su publicación (DOF ${fecha(ley.publicacion)})` : "";
  return `${citaCorta(u, ley)}${reforma ? `, ${reforma}` : ""}. Fuente: Cámara de Diputados, ${ley.nombre}, texto vigente (${u.fuente}).`;
}

/** Texto limpio para pegar en Word o correo: sin notas de reforma; tablas con tabuladores. */
function textoParaCopiar(lineas) {
  return lineas.map((l) => l.trim()).filter(Boolean)
    .filter((l) => claseParrafo(l) !== "nota-reforma")
    .map((l) => {
      if (l.startsWith("|")) return celdas(l).join("\t");
      const img = l.match(RE_IMAGEN);
      return img ? `[${img[2]}: ver imagen en el documento oficial]` : l;
    })
    .join("\n\n");
}

async function copiar(texto, mensaje) {
  try {
    await navigator.clipboard.writeText(texto);
    avisar(mensaje);
  } catch {
    // Respaldo para navegadores que no permiten el portapapeles moderno
    const t = Object.assign(document.createElement("textarea"), { value: texto });
    document.body.append(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    avisar(ok ? mensaje : "No se pudo copiar: selecciona el texto y usa ⌘C / Ctrl+C");
  }
}

// ---------- Correlaciones ----------
/** "cff-69-b" → {texto: "Art. 69-B CFF", ruta: "#/CFF/69-b"} usando el catálogo (sin descargar la ley). */
async function etiquetaDeId(id) {
  const siglas = await leyDeId(id);
  if (!siglas) return { siglas: null, texto: id, ruta: null };
  const clave = id.slice(siglas.length + 1);
  const info = await infoLey(siglas);
  const numeros = info?.numeros || {};
  const numero = numeros[clave];
  const orden = Object.keys(numeros).indexOf(clave);   // posición en la ley, para ordenar
  if (numero?.startsWith("Transitorios")) {
    const f = numero.split(" ")[1];
    return { siglas, orden, corto: f ? `Trans. DOF ${fecha(f)}` : "Transitorios",
             texto: `Transitorios${f ? ` DOF ${fecha(f)}` : ""} ${siglas}`, ruta: `#/${siglas}/${clave}` };
  }
  const pre = info?.tipo === "resolucion" ? "Regla" : "Art.";
  return { siglas, orden, corto: numero || clave.toUpperCase(),
           texto: numero ? `${pre} ${numero} ${siglas}` : `${siglas} ${clave.toUpperCase()}`, ruta: `#/${siglas}/${clave}` };
}

/** Lista compacta de artículos agrupada por ley: "LISR: 9 · 27 · 28   CFF: 29 · 29-A" */
async function listaRemisiones(ids) {
  const catalogo = await cargarCatalogo();
  const ordenLey = (sg) => catalogo.findIndex((l) => l.siglas === sg);
  const etiquetas = (await Promise.all(ids.map(etiquetaDeId)))
    .sort((a, b) => ordenLey(a.siglas) - ordenLey(b.siglas) || a.orden - b.orden);
  const porLey = new Map();
  etiquetas.forEach((e) => {
    if (!porLey.has(e.siglas)) porLey.set(e.siglas, []);
    porLey.get(e.siglas).push(e);
  });
  return [...porLey].map(([siglas, es]) => `
    <div class="remisiones-ley"><span class="siglas">${escapar(siglas || "")}</span>
      ${es.map((e) => `<a href="${escapar(e.ruta || "#/")}" title="${escapar(e.texto)}">${escapar(e.corto)}</a>`).join("")}
    </div>`).join("");
}

async function pintarCorrelaciones(u) {
  const zona = $("#zona-correlaciones");
  if (!zona) return;
  const oficiales = await cargarCorrelacionesOficiales();
  const propias = almacen.correlacionesPropias();
  const relacion = (c) => (c.de === u.id ? c.a : c.a === u.id ? c.de : null);
  const items = [
    ...oficiales.filter(relacion).map((c) => ({ ...c, otro: relacion(c), propia: false })),
    ...propias.filter(relacion).map((c) => ({ ...c, otro: relacion(c), propia: true })),
  ];
  const remite = u.referencias || [];
  const citado = u.citado_por || [];
  const etiquetas = await Promise.all(items.map((c) => etiquetaDeId(c.otro)));
  zona.innerHTML = `
    ${remite.length ? `<h3 class="subtitulo-panel">Este artículo remite a <span class="contador">${remite.length}</span></h3>
      ${await listaRemisiones(remite)}` : ""}
    ${citado.length ? `<h3 class="subtitulo-panel">Remiten a este artículo <span class="contador">${citado.length}</span></h3>
      ${await listaRemisiones(citado)}` : ""}
    ${remite.length || citado.length ? `<p class="ayuda">Detectadas automáticamente cuando el texto dice a qué ley se refiere
      («artículo 27 de esta Ley», «del Código Fiscal de la Federación»…).</p>` : ""}
    <h3 class="subtitulo-panel">Correlaciones manuales</h3>
    ${items.length ? `<ul class="lista-correlaciones">${items.map((c, i) => `
      <li>
        <a href="${escapar(etiquetas[i].ruta || "#/")}">${escapar(etiquetas[i].texto)}</a>
        ${c.nota ? `<span class="nota-corr">— ${escapar(c.nota)}</span>` : ""}
        <span class="origen-corr">${c.propia ? "tuya (solo en este navegador)" : "de la oficina"}</span>
        ${c.propia ? `<button type="button" class="quitar" data-de="${escapar(c.de)}" data-a="${escapar(c.a)}" aria-label="Quitar correlación">×</button>` : ""}
      </li>`).join("")}</ul>`
      : `<p class="vacio">Ninguna. Usa «Sugerir correlación» para vincular este artículo con otro.</p>`}`;
  zona.querySelectorAll("button.quitar").forEach((b) => b.addEventListener("click", () => {
    almacen.quitarCorrelacion(b.dataset.de, b.dataset.a);
    pintarCorrelaciones(u);
  }));
}

function abrirDialogoCorrelacion(u, ley) {
  const dlg = $("#dialogo-correlacion");
  $("#corr-origen").textContent = `Vincular ${citaCorta(u, ley)} con:`;
  $("#corr-ley").value = ley.siglas;
  $("#corr-art").value = "";
  $("#corr-nota").value = "";
  $("#corr-error").hidden = true;
  dlg.dataset.origen = u.id;
  dlg.showModal();
  $("#corr-art").focus();
}

async function guardarCorrelacionDesdeDialogo(e) {
  e.preventDefault();
  const dlg = $("#dialogo-correlacion");
  const error = $("#corr-error");
  const siglas = $("#corr-ley").value;
  const clave = claveArticulo($("#corr-art").value);
  const ley = await cargarLey(siglas);
  const destino = `${siglas.toLowerCase()}-${clave}`;
  if (!clave || !ley.porId.has(destino)) {
    error.textContent = `No existe el artículo «${$("#corr-art").value}» en ${siglas}.`;
    error.hidden = false;
    return;
  }
  if (destino === dlg.dataset.origen) {
    error.textContent = "Elige un artículo distinto.";
    error.hidden = false;
    return;
  }
  const nuevo = almacen.agregarCorrelacion(dlg.dataset.origen, destino, $("#corr-nota").value);
  dlg.close();
  avisar(nuevo ? "Correlación guardada" : "Esa correlación ya existía");
  const { partes } = leerRuta();
  const actual = (await cargarLey(partes[0])).porId.get(dlg.dataset.origen);
  if (actual) pintarCorrelaciones(actual);
}

// ---------- Notas ----------
let esperaNota;
function conectarNotas(u, ley) {
  const area = $("#nota-articulo");
  const estado = $("#estado-nota");
  area.value = almacen.nota(u.id);
  const pintarEstado = () => {
    const n = almacen.notas()[u.id];
    estado.textContent = n ? `Guardada · ${almacen.haceCuanto(n.actualizado)}` : "Se guarda sola mientras escribes";
  };
  pintarEstado();
  area.addEventListener("input", () => {
    estado.textContent = "Guardando…";
    clearTimeout(esperaNota);
    esperaNota = setTimeout(() => {
      const ok = almacen.guardarNota(u.id, area.value, { ley: ley.siglas, titulo: citaCorta(u, ley), ruta: `#/${ley.siglas}/${claveUrl(u)}` });
      ok ? pintarEstado() : (estado.textContent = "⚠ No se pudo guardar (¿navegación privada?)");
      marcarNotasEnArbol();
    }, 400);
  });
}

async function vistaUnidad(siglas, clave, consulta) {
  const info = await infoLey(siglas);
  if (!info) return noCargada(siglas);
  const ley = await cargarLey(info.siglas);
  const id = `${ley.siglas.toLowerCase()}-${claveArticulo(clave) || clave.toLowerCase()}`;
  const u = ley.porId.get(id);
  if (!u) {
    // Sugerencias: artículos que empiezan con el mismo número (27 → 27, 27-A…)
    const base = clave.toLowerCase().match(/^\d+/)?.[0];
    const sugerencias = base ? ley.unidades.filter((x) => x.unidad !== "transitorio" && claveUrl(x).match(/^\d+/)?.[0] === base) : [];
    main.innerHTML = `
      <nav class="migas"><a href="#/">Inicio</a><span class="sep">›</span><a href="#/${escapar(ley.siglas)}">${escapar(ley.siglas)}</a></nav>
      <div class="error">No existe el artículo <strong>${escapar(clave.toUpperCase())}</strong> en ${escapar(ley.nombre)}.
      ${sugerencias.length ? `¿Buscabas ${sugerencias.map((x) => `<a href="#/${escapar(ley.siglas)}/${escapar(claveUrl(x))}">${escapar(tituloUnidad(x))}</a>`).join(", ")}?`
        : `<a href="#/${escapar(ley.siglas)}">Ver el índice</a>.`}</div>`;
    return `${ley.siglas} ${clave.toUpperCase()}`;
  }

  document.title = `${tituloUnidad(u)} ${ley.siglas}`;
  const pdfPagina = u.pagina ? `${u.fuente}#page=${u.pagina}` : u.fuente;
  const terminos = consulta ? consulta.split(/\s+/).map(normalizar).filter((t) => t.length > 2) : [];
  const migas = u.ruta.map((r) => `<span class="sep">›</span><span>${escapar(etiquetaDivision(r))}</span>`).join("");
  const anterior = ley.unidades[u.indice - 1];
  const siguiente = ley.unidades[u.indice + 1];
  const rutaUnidad = (x) => `#/${ley.siglas}/${claveUrl(x)}`;

  almacen.registrarHistorial({
    id: u.id, ley: ley.siglas, titulo: citaCorta(u, ley), ruta: rutaUnidad(u),
    ubicacion: u.ruta.filter((r) => r.nivel !== "transitorios").map((r) => r.etiqueta).join(" › "),
  });

  let insignias;
  if (u.unidad === "transitorio") {
    insignias = u.fecha_publicacion ? `<span class="insignia">Publicado: DOF ${fecha(u.fecha_publicacion)}</span>` : "";
  } else if (u.ultima_reforma) {
    insignias = `<span class="insignia reforma">${ICONO.reloj} Última ${ley.tipo === "resolucion" ? "modificación" : "reforma"}: DOF ${fecha(u.ultima_reforma)}</span>`;
  } else {
    insignias = u.nueva_en ? `<span class="insignia reforma">${ICONO.reloj} ${ley.tipo === "resolucion" ? "Regla nueva" : "Artículo nuevo"} (${escapar(u.nueva_en.documento)})</span>`
      : `<span class="insignia">${ICONO.reloj} Sin ${ley.tipo === "resolucion" ? "modificaciones" : "reformas"}: texto original (DOF ${fecha(ley.publicacion)})</span>`;
  }

  main.innerHTML = `
    <article class="articulo">
      <header class="articulo-cabeza">
        <nav class="migas" aria-label="Ubicación">
          <a href="#/">Inicio</a><span class="sep">›</span><a href="#/${escapar(ley.siglas)}">${escapar(ley.siglas)}</a>${migas}
        </nav>
        <h1>${escapar(tituloUnidad(u))} <span class="siglas-titulo">${escapar(ley.siglas)}</span></h1>
        ${u.titulo_decreto ? `<p class="subtitulo">${escapar(u.titulo_decreto)}</p>` : ""}
        ${u.titulo_regla && u.unidad === "regla" ? `<p class="epigrafe">${escapar(u.titulo_regla)}</p>` : ""}
        <div class="insignias">
          ${insignias}
          <a class="insignia" href="${escapar(pdfPagina)}" target="_blank" rel="noopener">${ICONO.doc} Texto oficial${u.pagina ? ` (pág. ${u.pagina})` : ""}</a>
        </div>
        <div class="acciones" role="toolbar" aria-label="Acciones del artículo">
          <button type="button" class="accion" data-accion="copiar" title="Copia el texto (o solo lo que tengas seleccionado) con su cita">${ICONO.copiar} Copiar con cita</button>
          <button type="button" class="accion" data-accion="cita" title="Copia solo la cita, p. ej. «${escapar(citaCorta(u, ley))}»">${ICONO.cita} Copiar cita</button>
          <button type="button" class="accion" data-accion="enlace" title="Copia un enlace directo a este artículo">${ICONO.enlace} Enlace</button>
          <button type="button" class="accion" data-accion="vincular" title="Relaciona este artículo con otro">${ICONO.vincular} Sugerir correlación</button>
        </div>
      </header>
      ${avisosPendientes(u, ley, terminos)}
      ${u.formula_pdf ? `<div class="aviso-cambio"><p><strong>Esta regla incluye fórmulas</strong> que el PDF del SAT presenta como imagen
        y no se pueden mostrar aquí. <a href="${escapar(pdfPagina)}" target="_blank" rel="noopener">Consúltalas en el PDF${u.pagina ? ` (página ${u.pagina})` : ""}</a>.</p></div>` : ""}
      <div class="texto-ley" id="texto-ley">${textoHtml(u.texto, terminos, u.enlaces, { tablas: u.tablas_pdf, pdf: pdfPagina })}</div>
      ${u.referencias_sat ? `<p class="referencias-sat"><span>Referencias:</span> ${parrafoHtml(u.referencias_sat, (u.enlaces_refs || []).map(([i, f, d]) => [0, i, f, d]), escapar)}</p>` : ""}
      ${u.reformas.length > 1 ? `
        <details class="historial-reformas">
          <summary>Reformas a este artículo (${u.reformas.length})</summary>
          <p>${u.reformas.map((f) => "DOF " + fecha(f)).join(" · ")}</p>
        </details>` : ""}

      <section class="panel" aria-labelledby="titulo-versiones">
        <h2 id="titulo-versiones">Versiones</h2>
        <div id="zona-versiones"><p class="cargando">Cargando…</p></div>
      </section>

      <section class="panel" aria-labelledby="titulo-correlaciones">
        <h2 id="titulo-correlaciones">Correlaciones</h2>
        <div id="zona-correlaciones"><p class="cargando">Cargando…</p></div>
      </section>

      <section class="panel" aria-labelledby="titulo-nota">
        <h2 id="titulo-nota">Mi nota</h2>
        <textarea id="nota-articulo" rows="4" placeholder="Escribe aquí tus apuntes sobre este artículo. Solo tú los ves."></textarea>
        <p class="estado-nota" id="estado-nota"></p>
      </section>

      <nav class="navegacion-art" aria-label="Artículos contiguos">
        ${anterior ? `<a href="${escapar(rutaUnidad(anterior))}"><small>← Anterior</small>${escapar(tituloUnidad(anterior))}</a>` : ""}
        ${siguiente ? `<a class="siguiente" href="${escapar(rutaUnidad(siguiente))}"><small>Siguiente →</small>${escapar(tituloUnidad(siguiente))}</a>` : ""}
      </nav>
    </article>`;

  // Acciones
  main.querySelector(".acciones").addEventListener("click", (e) => {
    const accion = e.target.closest("[data-accion]")?.dataset.accion;
    if (accion === "copiar") {
      const sel = window.getSelection();
      const seleccion = sel && !sel.isCollapsed && $("#texto-ley").contains(sel.anchorNode) ? sel.toString().trim() : "";
      const cuerpo = seleccion || textoParaCopiar(u.texto.split("\n"));
      const encabezado = seleccion ? "" : `${tituloUnidad(u)} de la ${ley.nombre}\n\n`;
      copiar(`${encabezado}${cuerpo}\n\n(${citaLarga(u, ley)})`, seleccion ? "Selección copiada con su cita" : "Artículo copiado con su cita");
    } else if (accion === "cita") {
      copiar(citaCorta(u, ley), `Copiado: ${citaCorta(u, ley)}`);
    } else if (accion === "enlace") {
      copiar(`${location.origin}${location.pathname}${rutaUnidad(u)}`, "Enlace copiado");
    } else if (accion === "vincular") {
      abrirDialogoCorrelacion(u, ley);
    }
  });
  conectarNotas(u, ley);
  pintarCorrelaciones(u);
  pintarVersiones(u, ley);

  marcarEnArbol(ley.siglas, u.id);
  const primera = terminos.length && $("mark", main);
  if (primera) {
    main.focus({ preventScroll: true });
    primera.scrollIntoView({ block: "center" });
  } else {
    irArriba();
  }
  return citaCorta(u, ley);
}

// ==========================================================================
// Reformas: línea de tiempo por ley y novedades de todas las leyes
// ==========================================================================
/** Agrupa las unidades de una ley por fecha de reforma: [{fecha, unidades, pendiente, documento}] (más reciente primero). */
function reformasPorFecha(ley) {
  const grupos = new Map();
  const agregar = (fecha, u, extra = {}) => {
    if (!fecha) return;
    if (!grupos.has(fecha)) grupos.set(fecha, { fecha, unidades: [], ...extra });
    const g = grupos.get(fecha);
    if (!g.unidades.includes(u)) g.unidades.push(u);
  };
  for (const u of ley.unidades) {
    if (u.unidad !== "articulo" && u.unidad !== "regla") continue;
    if (u.nueva_en) agregar(u.nueva_en.fecha, u, { pendiente: true, documento: u.nueva_en.documento, en_vigor: u.nueva_en.en_vigor });
    else u.reformas.forEach((f) => agregar(f, u));
    (u.pendientes || []).forEach((p) => agregar(p.fecha, u, { pendiente: true, documento: p.documento, en_vigor: p.en_vigor }));
  }
  return [...grupos.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Las versiones anticipadas se publican en el portal del SAT, no en el DOF. */
const origenFecha = (g) => (/versión anticipada/i.test(g.documento || "") ? "Portal SAT" : "DOF");

function chipUnidad(ley, u) {
  const con = u.unidad === "regla" && u.titulo_regla;
  return `<a class="${con ? "con-titulo" : ""}" href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}"
    title="${escapar(u.titulo_regla || tituloUnidad(u))}">${con ? `<b>${escapar(u.numero)}</b> ${escapar(u.titulo_regla)}` : escapar(u.numero)}</a>`;
}

async function vistaReformas(siglas, anio) {
  if (!siglas) return vistaNovedades();
  const info = await infoLey(siglas);
  if (!info) return noCargada(siglas);
  const ley = await cargarLey(info.siglas);
  const grupos = reformasPorFecha(ley);
  const anios = [...new Set(grupos.map((g) => g.fecha.slice(0, 4)))];
  const visibles = anio ? grupos.filter((g) => g.fecha.startsWith(anio)) : grupos;
  const unidadN = ley.tipo === "resolucion" ? ["regla", "reglas"] : ["artículo", "artículos"];
  document.title = `Reformas — ${ley.siglas}`;
  main.innerHTML = `
    <nav class="migas"><a href="#/">Inicio</a><span class="sep">›</span><a href="#/${escapar(ley.siglas)}">${escapar(ley.siglas)}</a><span class="sep">›</span><span>Reformas</span></nav>
    <h1>Reformas por fecha · ${escapar(ley.siglas)}</h1>
    <p class="subtitulo">${escapar(ley.nombre)}. Cada fecha muestra los ${unidadN[1]} que se ${ley.tipo === "resolucion" ? "modificaron" : "reformaron"} ese día,
      según las notas oficiales del texto${ley.tipo === "resolucion" ? " compilado del SAT" : ""}.</p>
    <div class="filtros" role="group" aria-label="Filtrar por año">
      <a class="chip ${!anio ? "activo" : ""}" href="#/reformas/${escapar(ley.siglas)}">Todas</a>
      ${anios.map((a) => `<a class="chip ${a === anio ? "activo" : ""}" href="#/reformas/${escapar(ley.siglas)}?anio=${a}">${a}</a>`).join("")}
    </div>
    ${visibles.length ? visibles.map((g) => `
      <section class="grupo-reforma${g.pendiente ? " pendiente" : ""}">
        <h2>${origenFecha(g)} ${escapar(fecha(g.fecha))} <span class="contador">${g.unidades.length} ${g.unidades.length === 1 ? unidadN[0] : unidadN[1]}</span></h2>
        ${g.pendiente ? `<p class="texto-aviso">${escapar(g.documento)}: publicado, aún no integrado al texto${g.en_vigor ? ` · entra en vigor el ${escapar(fecha(g.en_vigor))}` : ""}</p>` : ""}
        <div class="${ley.tipo === "resolucion" ? "lista-reglas" : "lista-art"}">${g.unidades.map((u) => chipUnidad(ley, u)).join("")}</div>
      </section>`).join("") : `<p class="vacio">Sin reformas registradas${anio ? ` en ${escapar(anio)}` : ""}.</p>`}
    ${AVISO_LEGAL}`;
  irArriba();
  return `Reformas ${ley.siglas}`;
}

async function vistaNovedades() {
  document.title = "Novedades";
  main.innerHTML = `<h1>Novedades</h1><p class="cargando">Revisando todas las leyes…</p>`;
  const leyes = await cargarTodas();
  const hoy = new Date();
  const haceUnAnio = new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate()).toISOString().slice(0, 10);
  const filas = [];
  for (const ley of leyes) {
    for (const g of reformasPorFecha(ley)) {
      if (g.fecha >= haceUnAnio || g.pendiente) filas.push({ ley, ...g });
    }
  }
  filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || Number(Boolean(b.pendiente)) - Number(Boolean(a.pendiente)));
  const pendientes = leyes.filter((l) => l.pendientes?.length);
  main.innerHTML = `
    <h1>Novedades</h1>
    <p class="subtitulo">Reformas y modificaciones de los últimos 12 meses en todas las leyes cargadas, de la más reciente a la más antigua.</p>
    ${pendientes.length ? `<div class="aviso-compilado con-pendientes"><p><strong>Publicado en el DOF o en el portal del SAT, aún no integrado al texto:</strong></p>
      <ul>${pendientes.flatMap((l) => l.pendientes.map((p) => `<li><a href="#/reformas/${escapar(l.siglas)}">${escapar(l.siglas)}</a> ·
        <a href="${escapar(p.url)}" target="_blank" rel="noopener">${escapar(p.titulo)}</a> · ${escapar(fecha(p.fecha))}
        ${p.en_vigor ? ` · entra en vigor el <strong>${escapar(fecha(p.en_vigor))}</strong>` : ""}</li>`)).join("")}</ul></div>` : ""}
    <table class="tabla-novedades">
      <thead><tr><th>Fecha</th><th>Ordenamiento</th><th>Cambios</th></tr></thead>
      <tbody>${filas.map((f) => `<tr${f.pendiente ? ' class="pendiente"' : ""}>
        <td>${origenFecha(f)} ${escapar(fecha(f.fecha))}${f.pendiente ? '<br><small class="texto-aviso">aún no integrado</small>' : ""}</td>
        <td><a href="#/reformas/${escapar(f.ley.siglas)}">${escapar(f.ley.siglas)}</a></td>
        <td>${f.unidades.length} ${f.ley.tipo === "resolucion" ? (f.unidades.length === 1 ? "regla" : "reglas") : (f.unidades.length === 1 ? "artículo" : "artículos")}:
          ${f.unidades.slice(0, 12).map((u) => `<a href="#/${escapar(f.ley.siglas)}/${escapar(claveUrl(u))}">${escapar(u.numero)}</a>`).join(", ")}${f.unidades.length > 12 ? "…" : ""}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${AVISO_LEGAL}`;
  irArriba();
  return "Novedades";
}

// ==========================================================================
// Historial y notas
// ==========================================================================
function itemHistorial(h) {
  return `<li><a href="${escapar(h.ruta)}">${escapar(h.titulo)}</a>
    ${h.ubicacion ? `<span class="ubicacion">${escapar(h.ubicacion)}</span>` : ""}
    <span class="cuando">${escapar(almacen.haceCuanto(h.fecha))}</span></li>`;
}

function vistaHistorial() {
  document.title = "Historial de consultas";
  const h = almacen.historial();
  const porLey = new Map();
  h.forEach((x) => { if (!porLey.has(x.ley)) porLey.set(x.ley, []); porLey.get(x.ley).push(x); });
  main.innerHTML = `
    <h1>Historial de consultas</h1>
    <p class="subtitulo">Artículos que abriste en este navegador, del más reciente al más antiguo.</p>
    ${h.length ? `
      ${[...porLey].map(([ley, items]) => `
        <h2>${escapar(ley)} <span class="contador">${items.length}</span></h2>
        <ul class="lista-simple">${items.map(itemHistorial).join("")}</ul>`).join("")}
      <p><button type="button" class="boton" id="borrar-historial">Borrar historial</button></p>`
      : `<p class="vacio">Aún no has consultado artículos.</p>`}`;
  $("#borrar-historial")?.addEventListener("click", () => {
    if (confirm("¿Borrar todo el historial de consultas de este navegador?")) {
      almacen.borrarHistorial();
      vistaHistorial();
    }
  });
  irArriba();
  return "Historial";
}

async function vistaNotas() {
  document.title = "Mis notas";
  const todas = Object.entries(almacen.notas()).sort((a, b) => b[1].actualizado - a[1].actualizado);
  const propias = almacen.correlacionesPropias();
  main.innerHTML = `
    <h1>Mis notas</h1>
    <p class="subtitulo">Tus notas y correlaciones se guardan solo en este navegador. Haz un respaldo de vez en cuando
      para no perderlas si cambias de computadora o borras los datos del navegador.</p>
    ${todas.length ? `<ul class="lista-notas">${todas.map(([id, n]) => `
        <li>
          <a href="${escapar(n.ruta || "#/")}">${escapar(n.titulo || id)}</a>
          <span class="cuando">${escapar(almacen.haceCuanto(n.actualizado))}</span>
          <p>${escapar(n.texto).replace(/\n/g, "<br>")}</p>
        </li>`).join("")}</ul>`
      : `<p class="vacio">Aún no tienes notas. Abre un artículo y escribe en «Mi nota», al final del texto.</p>`}

    <h2>Respaldo</h2>
    <div class="botonera">
      <button type="button" class="boton" id="exportar">Exportar respaldo (.json)</button>
      <label class="boton">Importar respaldo<input type="file" id="importar" accept="application/json,.json" hidden></label>
    </div>
    <p class="ayuda">El respaldo incluye tus ${todas.length} nota(s) y ${propias.length} correlación(es). Al importar, se combinan con lo que ya tienes.</p>

    <h2>Correlaciones para la oficina</h2>
    <p class="ayuda">Tus correlaciones solo las ves tú. Para que toda la oficina las vea, descarga este archivo y envíalo a quien
      administra el sitio, que lo reemplaza en <code>web/data/correlaciones_manuales.json</code>.</p>
    <div class="botonera">
      <button type="button" class="boton" id="exportar-corr" ${propias.length ? "" : "disabled"}>Exportar correlaciones para la oficina</button>
    </div>`;

  $("#exportar").addEventListener("click", () =>
    almacen.descargarJSON(`respaldo-legislacion-fiscal-${new Date().toISOString().slice(0, 10)}.json`, almacen.respaldo()));
  $("#importar").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    try {
      const r = almacen.importarRespaldo(JSON.parse(await archivo.text()));
      avisar(`Importado: ${r.nNotas} nota(s) y ${r.nCorr} correlación(es)`);
      vistaNotas();
      marcarNotasEnArbol();
    } catch (err) {
      avisar(err.message.includes("respaldo") ? err.message : "El archivo no se pudo leer como respaldo.");
    }
  });
  $("#exportar-corr").addEventListener("click", async () => {
    const oficiales = await cargarCorrelacionesOficiales();
    const juntas = [...oficiales];
    for (const c of propias) {
      if (!juntas.some((x) => (x.de === c.de && x.a === c.a) || (x.de === c.a && x.a === c.de))) juntas.push(c);
    }
    almacen.descargarJSON("correlaciones_manuales.json", {
      _descripcion: "Correlaciones entre artículos sugeridas a mano por el equipo. Formato: {de, a, nota, fecha}.",
      correlaciones: juntas,
    });
  });
  irArriba();
  return "Mis notas";
}

// ==========================================================================
// Búsqueda
// ==========================================================================
const POR_PAGINA = 40;

async function vistaBusqueda(params) {
  const consulta = params.get("q") || "";
  const catalogo = await cargarCatalogo();
  const elegidas = (params.get("en") || "").split(",").filter(Boolean);
  campoBusqueda.value = consulta;
  document.title = consulta ? `«${consulta}» — búsqueda` : "Búsqueda";

  const chips = catalogo.map((l) => `
    <label class="chip"><input type="checkbox" value="${escapar(l.siglas)}" ${!elegidas.length || elegidas.includes(l.siglas) ? "checked" : ""}>
    ${escapar(l.siglas)}</label>`).join("");

  main.innerHTML = `
    <h1>Búsqueda</h1>
    <div class="filtros" role="group" aria-label="Filtrar por ley"><span class="titulo-filtro">Buscar en:</span>${chips}</div>
    <div id="zona-resultados"><p class="cargando">Preparando el índice de búsqueda…</p></div>`;

  main.querySelectorAll(".filtros input").forEach((c) => c.addEventListener("change", () => {
    const marcadas = [...main.querySelectorAll(".filtros input:checked")].map((x) => x.value);
    const en = marcadas.length === catalogo.length ? "" : marcadas.join(",");
    location.replace(rutaBusqueda(consulta, en));
  }));

  const zona = $("#zona-resultados");
  const tituloPestana = consulta ? `«${consulta.length > 18 ? consulta.slice(0, 18) + "…" : consulta}»` : "Búsqueda";
  if (!consulta.trim()) {
    zona.innerHTML = `<p class="vacio">Escribe una o varias palabras en el buscador de arriba. Se ignoran acentos y mayúsculas;
      "deduc" encuentra "deducción" y "deducciones". Para ir directo a un artículo escribe, por ejemplo, <kbd>LISR 27</kbd>.</p>`;
    return tituloPestana;
  }

  await cargarTodas();
  const res = buscar(consulta, elegidas);
  if (!res.length) {
    zona.innerHTML = `<p class="vacio">Sin coincidencias para «${escapar(consulta)}». Prueba con menos palabras o con la raíz de la palabra.</p>`;
    return tituloPestana;
  }

  const leyes = new Map(await Promise.all(catalogo.map(async (l) => [l.siglas, await cargarLey(l.siglas)])));
  let mostrados = 0;
  zona.innerHTML = `<p class="resumen-busqueda">${res.length} resultado${res.length === 1 ? "" : "s"} para «${escapar(consulta)}»</p>
    <ol class="resultados"></ol>`;
  const lista = $(".resultados", zona);

  const pintarMas = () => {
    const tramo = res.slice(mostrados, mostrados + POR_PAGINA);
    lista.insertAdjacentHTML("beforeend", tramo.map((r) => {
      const ley = leyes.get(r.ley);
      const u = ley.porId.get(r.id);
      const ruta = u.ruta.map(etiquetaDivision).join(" › ");
      return `<li class="resultado"><a href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}?q=${encodeURIComponent(consulta)}">
        <div class="titulo-res"><span class="siglas">${escapar(ley.siglas)}</span>${escapar(tituloUnidad(u))}${u.titulo_regla && u.unidad === "regla" ? ` <span class="epigrafe-res">${escapar(u.titulo_regla)}</span>` : ""}</div>
        <div class="ruta-res">${escapar(ruta)}</div>
        <div class="fragmento">${fragmento(u.texto, r.terms, consulta)}</div></a></li>`;
    }).join(""));
    mostrados += tramo.length;
    $(".mas-resultados", zona)?.remove();
    if (mostrados < res.length) {
      zona.insertAdjacentHTML("beforeend",
        `<div class="mas-resultados"><button class="boton" type="button">Mostrar más (${res.length - mostrados} restantes)</button></div>`);
      $(".mas-resultados button", zona).addEventListener("click", pintarMas);
    }
  };
  pintarMas();
  return tituloPestana;
}

const rutaBusqueda = (q, en = "") =>
  `#/buscar?q=${encodeURIComponent(q)}${en ? `&en=${encodeURIComponent(en)}` : ""}`;

// ==========================================================================
// Barra superior y lateral: búsqueda, "ir a", tema y menú
// ==========================================================================
let espera;
$("#form-busqueda").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = campoBusqueda.value.trim();
  // "LISR 27", "art. 69-B CFF"… → directo al artículo
  const ref = leerReferencia(texto, await cargarCatalogo());
  if (ref) {
    location.hash = `#/${ref.siglas}/${ref.clave}`;
    campoBusqueda.value = "";
    campoBusqueda.blur();
    return;
  }
  const { partes, params } = leerRuta();
  location.hash = rutaBusqueda(texto, partes[0] === "buscar" ? params.get("en") || "" : "");
});
// Al entrar al buscador se empieza a preparar el índice de todas las leyes (mientras escribes)
campoBusqueda.addEventListener("focus", () => { cargarTodas().catch(() => {}); }, { once: true });
campoBusqueda.addEventListener("input", () => {
  // En la página de búsqueda, los resultados se actualizan mientras escribes
  if (leerRuta().partes[0] !== "buscar") return;
  clearTimeout(espera);
  espera = setTimeout(() => {
    location.replace(rutaBusqueda(campoBusqueda.value, leerRuta().params.get("en") || ""));
  }, 250);
});

$("#form-ir").addEventListener("submit", async (e) => {
  e.preventDefault();
  const siglas = $("#ir-ley").value;
  const texto = $("#ir-art").value.trim();
  const error = $("#ir-error");
  error.hidden = true;
  if (!texto) return;
  // También acepta "CFF 69-B" escrito completo en el campo de artículo
  const ref = leerReferencia(texto, await cargarCatalogo());
  location.hash = ref ? `#/${ref.siglas}/${ref.clave}` : `#/${siglas}/${claveArticulo(texto)}`;
  $("#ir-art").value = "";
});

$("#form-correlacion").addEventListener("submit", guardarCorrelacionDesdeDialogo);
$("#corr-cancelar").addEventListener("click", () => $("#dialogo-correlacion").close());

const botonTema = $("#boton-tema");
function pintarBotonTema() {
  const oscuro = document.documentElement.dataset.tema === "oscuro";
  botonTema.setAttribute("aria-label", oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
}
botonTema.addEventListener("click", () => {
  const nuevo = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
  document.documentElement.dataset.tema = nuevo;
  localStorage.setItem("tema", nuevo);
  pintarBotonTema();
});
pintarBotonTema();

const botonMenu = $("#boton-menu");
const velo = $("#velo");
function abrirMenu() {
  document.body.classList.add("menu-abierto");
  velo.hidden = false;
  botonMenu.setAttribute("aria-expanded", "true");
}
function cerrarMenu() {
  document.body.classList.remove("menu-abierto");
  velo.hidden = true;
  botonMenu.setAttribute("aria-expanded", "false");
}
botonMenu.addEventListener("click", () =>
  document.body.classList.contains("menu-abierto") ? cerrarMenu() : abrirMenu());
velo.addEventListener("click", cerrarMenu);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarMenu();
  // "/" lleva al buscador, como en muchos sitios de consulta
  if (e.key === "/" && document.activeElement !== campoBusqueda && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault();
    campoBusqueda.focus();
  }
});

// ==========================================================================
window.addEventListener("hashchange", enrutar);
iniciarPestanas(enrutar);
construirArbol()
  .catch((e) => { arbol.innerHTML = `<p class="proximamente">${escapar(e.message)}</p>`; })
  .finally(enrutar);
