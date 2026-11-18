// Aplicación principal: enrutador, árbol de materias y vistas.
//
// "Enrutador" = la parte que lee la dirección después del # y decide qué mostrar:
//   #/                     → inicio
//   #/LISR                 → índice de la ley
//   #/LISR/27              → artículo 27 de la LISR (lisr-27)
//   #/LISR/27?q=deduccion  → mismo artículo con las palabras resaltadas
//   #/buscar?q=…&en=LISR   → resultados de búsqueda
// Así los enlaces se pueden copiar y compartir, y el botón "atrás" funciona.

import {
  cargarCatalogo, cargarLey, cargarTodas, infoLey, fecha, claveUrl,
  tituloUnidad, tituloCorto, etiquetaDivision,
} from "./datos.js";
import { buscar, fragmento, resaltar, escapar, normalizar } from "./buscador.js";

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
  { siglas: "LIF 2026", nombre: "Ley de Ingresos de la Federación 2026" },
  { siglas: "LIF 2027", nombre: "Ley de Ingresos de la Federación 2027" },
];

const ICONO_RELOJ = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICONO_DOC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>';

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
  try {
    if (partes.length === 0) await vistaInicio();
    else if (partes[0] === "buscar") await vistaBusqueda(params);
    else if (partes.length === 1) await vistaLey(partes[0]);
    else await vistaUnidad(partes[0], partes.slice(1).join("/"), params.get("q"));
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="error"><strong>No se pudo mostrar esta página.</strong><br>${escapar(e.message)}</div>`;
  }
}

function irArriba() {
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
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

  arbol.innerHTML = `
    <details class="materia" open>
      <summary>Fiscal</summary>
      <div class="rama">
        <details class="materia" open>
          <summary>Legislación fiscal</summary>
          <div class="rama">${leyesHtml}
            ${PENDIENTES.map((p) => `<div class="proximamente" title="Se agregará en la fase 3">${escapar(p.siglas)} · en preparación</div>`).join("")}
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
}

async function llenarRamaLey(detalle) {
  if (detalle.dataset.lleno) return;
  detalle.dataset.lleno = "1";
  const ley = await cargarLey(detalle.dataset.siglas);
  const cont = $("[data-contenido]", detalle);
  cont.innerHTML = `<a href="#/${escapar(ley.siglas)}">Índice completo</a>` +
    ley.estructura.map((n) => nodoArbol(ley, n)).join("");
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
// Vistas
// ==========================================================================
function tarjetaLey(l) {
  return `
    <a class="tarjeta" href="#/${escapar(l.siglas)}">
      <span class="siglas">${escapar(l.siglas)}</span>
      <h3>${escapar(l.nombre)}</h3>
      <dl>
        <dt>Última reforma</dt><dd>${l.ultima_reforma ? "DOF " + fecha(l.ultima_reforma) : "Sin reformas"}</dd>
        <dt>Publicación</dt><dd>DOF ${fecha(l.publicacion)}</dd>
        <dt>Contenido</dt><dd>${l.num_articulos} artículos · ${l.num_transitorios} bloques de transitorios</dd>
      </dl>
    </a>`;
}

async function vistaInicio() {
  document.title = "Legislación fiscal federal";
  const catalogo = await cargarCatalogo();
  main.innerHTML = `
    <h1>Legislación fiscal federal</h1>
    <p class="subtitulo">Consulta por ley, título, capítulo y artículo, o busca cualquier palabra en el texto vigente.</p>
    <div class="tarjetas">
      ${catalogo.map(tarjetaLey).join("")}
      ${PENDIENTES.map((p) => `
        <div class="tarjeta pendiente">
          <span class="siglas">${escapar(p.siglas)}</span>
          <h3>${escapar(p.nombre)}</h3>
          <dl><dt>Estado</dt><dd>En preparación</dd></dl>
        </div>`).join("")}
    </div>
    ${AVISO_LEGAL}`;
  irArriba();
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
  if (!info) throw new Error(`No existe el ordenamiento "${siglas}".`);
  if (info.siglas !== siglas) { location.replace(`#/${info.siglas}`); return; }
  const ley = await cargarLey(info.siglas);
  document.title = `${ley.siglas} — ${ley.nombre}`;
  main.innerHTML = `
    <nav class="migas" aria-label="Ubicación"><a href="#/">Inicio</a><span class="sep">›</span><span>${escapar(ley.siglas)}</span></nav>
    <h1>${escapar(ley.nombre)}</h1>
    <div class="insignias">
      <span class="insignia reforma">${ICONO_RELOJ} Última reforma: ${ley.ultima_reforma ? "DOF " + fecha(ley.ultima_reforma) : "sin reformas"}</span>
      <span class="insignia">Publicada: DOF ${fecha(ley.publicacion)}</span>
      <span class="insignia">${ley.num_articulos} artículos</span>
      <a class="insignia" href="${escapar(ley.fuente)}" target="_blank" rel="noopener">${ICONO_DOC} Texto oficial (PDF)</a>
    </div>
    <h2>Índice</h2>
    <div class="indice">${ley.estructura.map((n) => nodoIndice(ley, n)).join("")}</div>
    ${AVISO_LEGAL}`;
  marcarEnArbol(ley.siglas, null);
  irArriba();
}

// ---------- Texto de un artículo ----------
const RE_NOTA = /\bDOF\s+\d{2}-\d{2}-\d{4}/;
const RE_NOTA_VERBO = /(reformad|adicionad|derogad|recorrid|modificad|fe de erratas)/i;
const RE_FRACCION = /^[IVXLC]+\.\s/;
const RE_INCISO = /^[a-zñ]\)\s/;
const RE_NUMERAL = /^\d{1,2}\.\s/;

function claseParrafo(linea) {
  if (RE_NOTA.test(linea) && RE_NOTA_VERBO.test(linea) && linea.length < 400 && !/[.;:]$/.test(linea)) return "nota-reforma";
  if (RE_FRACCION.test(linea)) return "fraccion";
  if (RE_INCISO.test(linea)) return "inciso";
  if (RE_NUMERAL.test(linea)) return "numeral";
  if (linea.length < 140 && linea === linea.toUpperCase() && /[A-ZÁÉÍÓÚ]{4}/.test(linea)) return "encabezado-trans";
  return "";
}

const RE_IMAGEN = /^\[\[imagen:([^|\]]+)\|([^\]]*)\]\]$/;

function textoHtml(texto, terminos) {
  const marcar = (s) => (terminos.length ? resaltar(s, terminos) : escapar(s));
  const lineas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  let html = "";
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    // Tablas: renglones consecutivos "| celda | celda |"
    if (l.startsWith("|")) {
      const filas = [];
      while (i < lineas.length && lineas[i].startsWith("|")) {
        filas.push(lineas[i].replace(/^\|\s?|\s?\|$/g, "").split(" | "));
        i++;
      }
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
      html += `<figure class="imagen-oficial">
        <img src="data/${escapar(img[1])}" alt="${escapar(img[2])}" loading="lazy">
        <figcaption>${escapar(img[2])} · imagen tomada del documento oficial</figcaption></figure>`;
      continue;
    }
    const c = claseParrafo(l);
    html += `<p${c ? ` class="${c}"` : ""}>${marcar(l)}</p>`;
  }
  return html;
}

async function vistaUnidad(siglas, clave, consulta) {
  const info = await infoLey(siglas);
  if (!info) throw new Error(`No existe el ordenamiento "${siglas}".`);
  const ley = await cargarLey(info.siglas);
  const id = `${ley.siglas.toLowerCase()}-${clave.toLowerCase()}`;
  const u = ley.porId.get(id);
  if (!u) {
    main.innerHTML = `
      <nav class="migas"><a href="#/">Inicio</a><span class="sep">›</span><a href="#/${escapar(ley.siglas)}">${escapar(ley.siglas)}</a></nav>
      <div class="error">No existe el artículo <strong>${escapar(clave)}</strong> en ${escapar(ley.nombre)}.
      <a href="#/${escapar(ley.siglas)}">Ver el índice</a>.</div>`;
    return;
  }

  document.title = `${tituloUnidad(u)} ${ley.siglas}`;
  const terminos = consulta ? consulta.split(/\s+/).map(normalizar).filter((t) => t.length > 2) : [];
  const migas = u.ruta.map((r) => `<span class="sep">›</span><span>${escapar(etiquetaDivision(r))}</span>`).join("");
  const anterior = ley.unidades[u.indice - 1];
  const siguiente = ley.unidades[u.indice + 1];
  const enlaceUnidad = (x) => `#/${escapar(ley.siglas)}/${escapar(claveUrl(x))}`;

  let insignias;
  if (u.unidad === "transitorio") {
    insignias = u.fecha_publicacion ? `<span class="insignia">Publicado: DOF ${fecha(u.fecha_publicacion)}</span>` : "";
  } else if (u.ultima_reforma) {
    insignias = `<span class="insignia reforma">${ICONO_RELOJ} Última reforma: DOF ${fecha(u.ultima_reforma)}</span>`;
  } else {
    insignias = `<span class="insignia">${ICONO_RELOJ} Sin reformas: texto original (DOF ${fecha(ley.publicacion)})</span>`;
  }

  main.innerHTML = `
    <article class="articulo">
      <header class="articulo-cabeza">
        <nav class="migas" aria-label="Ubicación">
          <a href="#/">Inicio</a><span class="sep">›</span><a href="#/${escapar(ley.siglas)}">${escapar(ley.siglas)}</a>${migas}
        </nav>
        <h1>${escapar(tituloUnidad(u))} <span style="color:var(--texto-tenue);font-weight:500">${escapar(ley.siglas)}</span></h1>
        ${u.titulo_decreto ? `<p class="subtitulo">${escapar(u.titulo_decreto)}</p>` : ""}
        <div class="insignias">
          ${insignias}
          <a class="insignia" href="${escapar(u.fuente)}" target="_blank" rel="noopener">${ICONO_DOC} Texto oficial</a>
        </div>
      </header>
      <div class="texto-ley">${textoHtml(u.texto, terminos)}</div>
      ${u.reformas.length > 1 ? `
        <details class="historial-reformas">
          <summary>Reformas a este artículo (${u.reformas.length})</summary>
          <p>${u.reformas.map((f) => "DOF " + fecha(f)).join(" · ")}</p>
        </details>` : ""}
      <nav class="navegacion-art" aria-label="Artículos contiguos">
        ${anterior ? `<a href="${enlaceUnidad(anterior)}"><small>← Anterior</small>${escapar(tituloUnidad(anterior))}</a>` : ""}
        ${siguiente ? `<a class="siguiente" href="${enlaceUnidad(siguiente)}"><small>Siguiente →</small>${escapar(tituloUnidad(siguiente))}</a>` : ""}
      </nav>
    </article>`;

  marcarEnArbol(ley.siglas, u.id);
  const primera = terminos.length && $("mark", main);
  if (primera) {
    main.focus({ preventScroll: true });
    primera.scrollIntoView({ block: "center" });
  } else {
    irArriba();
  }
}

// ---------- Búsqueda ----------
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
  if (!consulta.trim()) {
    zona.innerHTML = `<p class="vacio">Escribe una o varias palabras en el buscador de arriba. Se ignoran acentos y mayúsculas;
      "deduc" encuentra "deducción" y "deducciones".</p>`;
    return;
  }

  await cargarTodas();
  const filtro = elegidas.length ? elegidas : [];
  const res = buscar(consulta, filtro);
  if (!res.length) {
    zona.innerHTML = `<p class="vacio">Sin coincidencias para «${escapar(consulta)}». Prueba con menos palabras o con la raíz de la palabra.</p>`;
    return;
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
      return `<li class="resultado"><a href="#/${escapar(ley.siglas)}/${escapar(claveUrl(u))}?q=${encodeURIComponent(r.terms.join(" "))}">
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
}

const rutaBusqueda = (q, en = "") =>
  `#/buscar?q=${encodeURIComponent(q)}${en ? `&en=${encodeURIComponent(en)}` : ""}`;

// ==========================================================================
// Barra superior: búsqueda, tema y menú
// ==========================================================================
let espera;
$("#form-busqueda").addEventListener("submit", (e) => {
  e.preventDefault();
  const { params } = leerRuta();
  const en = leerRuta().partes[0] === "buscar" ? params.get("en") || "" : "";
  location.hash = rutaBusqueda(campoBusqueda.value, en);
});
campoBusqueda.addEventListener("input", () => {
  // En la página de búsqueda, los resultados se actualizan mientras escribes
  if (leerRuta().partes[0] !== "buscar") return;
  clearTimeout(espera);
  espera = setTimeout(() => {
    location.replace(rutaBusqueda(campoBusqueda.value, leerRuta().params.get("en") || ""));
  }, 250);
});

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
  if (e.key === "/" && document.activeElement !== campoBusqueda && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
    e.preventDefault();
    campoBusqueda.focus();
  }
});

// ==========================================================================
window.addEventListener("hashchange", enrutar);
construirArbol()
  .catch((e) => { arbol.innerHTML = `<p class="proximamente">${escapar(e.message)}</p>`; })
  .finally(enrutar);
