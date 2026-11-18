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
  tituloUnidad, tituloCorto, etiquetaDivision, cargarCorrelacionesOficiales, leyDeId,
} from "./datos.js";
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
  { siglas: "RMF", nombre: "Resolución Miscelánea Fiscal 2026" },
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
  const leyesHtml = catalogo.map((l) => `
    <details class="ley" data-siglas="${escapar(l.siglas)}">
      <summary><span class="siglas">${escapar(l.siglas)}</span> <span>${escapar(l.nombre)}</span></summary>
      <div class="rama" data-contenido><div class="proximamente">Cargando…</div></div>
    </details>`).join("");
  const pendientes = PENDIENTES.filter((p) => !catalogo.some((l) => l.siglas === p.siglas) && p.siglas !== "RMF");

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
        <details class="materia">
          <summary>Resoluciones fiscales</summary>
          <div class="rama"><div class="proximamente">RMF 2026 y versiones anticipadas · en preparación</div></div>
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
    ley.estructura.map((n) => nodoArbol(ley, n)).join("");
  marcarNotasEnArbol();
}

function nodoArbol(ley, nodo) {
  const enlaces = nodo.unidades.map((id) => {
    const u = ley.porId.get(id);
    return `<a href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}" data-id="${escapar(u.id)}"
               title="${escapar(tituloUnidad(u))}">${escapar(tituloCorto(u))}</a>`;
  }).join("");
  const esTrans = nodo.nivel === "transitorios";
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
        <dt>Contenido</dt><dd>${l.num_articulos} artículos · ${l.num_transitorios} ${l.num_transitorios === 1 ? "bloque" : "bloques"} de transitorios</dd>
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
      ${catalogo.map(tarjetaLey).join("")}
      ${PENDIENTES.filter((p) => !catalogo.some((l) => l.siglas === p.siglas)).map((p) => `
        <div class="tarjeta pendiente">
          <span class="siglas">${escapar(p.siglas)}</span>
          <h3>${escapar(p.nombre)}</h3>
          <dl><dt>Estado</dt><dd>En preparación</dd></dl>
        </div>`).join("")}
    </div>
    ${AVISO_LEGAL}`;
  irArriba();
  return "Inicio";
}

function rangoArticulos(ley, nodo) {
  const nums = [];
  const recorrer = (n) => {
    n.unidades.forEach((id) => { const u = ley.porId.get(id); if (u.unidad !== "transitorio") nums.push(u.numero); });
    n.hijos.forEach(recorrer);
  };
  recorrer(nodo);
  if (!nums.length) return "";
  return nums.length === 1 ? `Art. ${nums[0]}` : `Arts. ${nums[0]} a ${nums[nums.length - 1]}`;
}

function nodoIndice(ley, nodo) {
  const enlaces = nodo.unidades.map((id) => {
    const u = ley.porId.get(id);
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
        ${enlaces ? `<div class="lista-art">${enlaces}</div>` : ""}
      </div>
    </details>`;
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
      <span class="insignia reforma">${ICONO.reloj} Última reforma: ${ley.ultima_reforma ? "DOF " + fecha(ley.ultima_reforma) : "sin reformas"}</span>
      <span class="insignia">Publicada: DOF ${fecha(ley.publicacion)}</span>
      <span class="insignia">${ley.num_articulos} artículos</span>
      <a class="insignia" href="${escapar(ley.fuente)}" target="_blank" rel="noopener">${ICONO.doc} Texto oficial (PDF)</a>
    </div>
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

function textoHtml(texto, terminos, enlaces = []) {
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
    const c = claseParrafo(l);
    html += `<p${c ? ` class="${c}"` : ""}>${parrafoHtml(l, porRenglon.get(i), marcar)}</p>`;
  }
  return html;
}

// ---------- Copiar con cita ----------
/** "Art. 27 LISR" (o "Transitorios, DOF 18 nov 2015, LISR") */
function citaCorta(u, ley) {
  if (u.unidad === "transitorio") return `Transitorios del decreto publicado en el DOF el ${fecha(u.fecha_publicacion)}, ${ley.siglas}`;
  if (u.unidad === "regla") return `Regla ${u.numero} ${ley.siglas}`;
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
  const numeros = (await infoLey(siglas))?.numeros || {};
  const numero = numeros[clave];
  const orden = Object.keys(numeros).indexOf(clave);   // posición en la ley, para ordenar
  if (numero?.startsWith("Transitorios")) {
    const f = numero.split(" ")[1];
    return { siglas, orden, corto: f ? `Trans. DOF ${fecha(f)}` : "Transitorios",
             texto: `Transitorios${f ? ` DOF ${fecha(f)}` : ""} ${siglas}`, ruta: `#/${siglas}/${clave}` };
  }
  return { siglas, orden, corto: numero || clave.toUpperCase(),
           texto: numero ? `Art. ${numero} ${siglas}` : `${siglas} ${clave.toUpperCase()}`, ruta: `#/${siglas}/${clave}` };
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
  const id = `${ley.siglas.toLowerCase()}-${clave.toLowerCase()}`;
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
    insignias = `<span class="insignia reforma">${ICONO.reloj} Última reforma: DOF ${fecha(u.ultima_reforma)}</span>`;
  } else {
    insignias = `<span class="insignia">${ICONO.reloj} Sin reformas: texto original (DOF ${fecha(ley.publicacion)})</span>`;
  }

  main.innerHTML = `
    <article class="articulo">
      <header class="articulo-cabeza">
        <nav class="migas" aria-label="Ubicación">
          <a href="#/">Inicio</a><span class="sep">›</span><a href="#/${escapar(ley.siglas)}">${escapar(ley.siglas)}</a>${migas}
        </nav>
        <h1>${escapar(tituloUnidad(u))} <span class="siglas-titulo">${escapar(ley.siglas)}</span></h1>
        ${u.titulo_decreto ? `<p class="subtitulo">${escapar(u.titulo_decreto)}</p>` : ""}
        <div class="insignias">
          ${insignias}
          <a class="insignia" href="${escapar(u.fuente)}" target="_blank" rel="noopener">${ICONO.doc} Texto oficial</a>
        </div>
        <div class="acciones" role="toolbar" aria-label="Acciones del artículo">
          <button type="button" class="accion" data-accion="copiar" title="Copia el texto (o solo lo que tengas seleccionado) con su cita">${ICONO.copiar} Copiar con cita</button>
          <button type="button" class="accion" data-accion="cita" title="Copia solo la cita, p. ej. «${escapar(citaCorta(u, ley))}»">${ICONO.cita} Copiar cita</button>
          <button type="button" class="accion" data-accion="enlace" title="Copia un enlace directo a este artículo">${ICONO.enlace} Enlace</button>
          <button type="button" class="accion" data-accion="vincular" title="Relaciona este artículo con otro">${ICONO.vincular} Sugerir correlación</button>
        </div>
      </header>
      <div class="texto-ley" id="texto-ley">${textoHtml(u.texto, terminos, u.enlaces)}</div>
      ${u.reformas.length > 1 ? `
        <details class="historial-reformas">
          <summary>Reformas a este artículo (${u.reformas.length})</summary>
          <p>${u.reformas.map((f) => "DOF " + fecha(f)).join(" · ")}</p>
        </details>` : ""}

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
        <div class="titulo-res"><span class="siglas">${escapar(ley.siglas)}</span>${escapar(tituloUnidad(u))}</div>
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
