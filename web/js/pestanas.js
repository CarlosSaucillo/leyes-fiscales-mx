// Pestañas de consulta ("consultas en activo"), como las de un navegador:
// cada pestaña recuerda la página que tiene abierta (su ruta #/…).
// Navegar dentro de la página cambia la pestaña activa; "+" abre una nueva;
// Ctrl/⌘ + clic (o clic con la rueda) sobre un enlace lo abre en pestaña nueva.

import { leer, guardar } from "./almacen.js";
import { escapar } from "./buscador.js";

const MAX = 12;
const barra = document.getElementById("pestanas");
let estado = leer("pestanas", null);
let enrutarFn = () => {};

const nuevaId = () => Math.random().toString(36).slice(2, 9);

if (!estado || !Array.isArray(estado.lista) || !estado.lista.length) {
  estado = { lista: [{ id: nuevaId(), ruta: "#/", titulo: "Inicio" }], activa: null };
  estado.activa = estado.lista[0].id;
}
if (!estado.lista.some((p) => p.id === estado.activa)) estado.activa = estado.lista[0].id;

const activa = () => estado.lista.find((p) => p.id === estado.activa);
const persistir = () => guardar("pestanas", estado);

function ir(ruta) {
  if (location.hash === ruta || (ruta === "#/" && !location.hash)) enrutarFn();
  else location.hash = ruta;
}

function pintar() {
  barra.innerHTML = `
    <div class="lista-pestanas" role="tablist" aria-label="Consultas abiertas">
      ${estado.lista.map((p) => `
        <div class="pestana ${p.id === estado.activa ? "activa" : ""}" role="tab"
             aria-selected="${p.id === estado.activa}" data-id="${p.id}" title="${escapar(p.titulo)}">
          <button class="pestana-ir" type="button" data-id="${p.id}">${escapar(p.titulo)}</button>
          <button class="pestana-cerrar" type="button" data-cerrar="${p.id}" aria-label="Cerrar ${escapar(p.titulo)}">×</button>
        </div>`).join("")}
    </div>
    <button class="pestana-nueva" type="button" ${estado.lista.length >= MAX ? "disabled" : ""}
            title="Nueva pestaña (también: Ctrl/⌘ + clic en cualquier enlace)" aria-label="Nueva pestaña">+</button>`;
  barra.querySelector(".pestana.activa")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** La app avisa qué página quedó abierta para guardar la ruta y el título en la pestaña activa. */
export function actualizarActiva(ruta, titulo) {
  const p = activa();
  p.ruta = ruta || "#/";
  p.titulo = titulo;
  persistir();
  pintar();
}

export function abrirEnNueva(ruta) {
  if (estado.lista.length >= MAX) {
    // Sin lugar: se reutiliza la pestaña activa
    ir(ruta);
    return;
  }
  const p = { id: nuevaId(), ruta, titulo: "…" };
  const i = estado.lista.findIndex((x) => x.id === estado.activa);
  estado.lista.splice(i + 1, 0, p);
  estado.activa = p.id;
  persistir();
  pintar();
  ir(ruta);
}

function activar(id) {
  if (id === estado.activa) return;
  estado.activa = id;
  persistir();
  pintar();
  ir(activa().ruta);
}

function cerrar(id) {
  const i = estado.lista.findIndex((p) => p.id === id);
  if (i < 0) return;
  estado.lista.splice(i, 1);
  if (!estado.lista.length) estado.lista.push({ id: nuevaId(), ruta: "#/", titulo: "Inicio" });
  if (id === estado.activa) {
    estado.activa = estado.lista[Math.min(i, estado.lista.length - 1)].id;
    persistir();
    pintar();
    ir(activa().ruta);
  } else {
    persistir();
    pintar();
  }
}

/** Arranque: si la dirección trae una ruta (enlace compartido) se abre en la pestaña activa;
 *  si no, se restaura la última página de la pestaña activa. */
export function iniciarPestanas(enrutar) {
  enrutarFn = enrutar;
  const tieneRuta = location.hash && location.hash !== "#" && location.hash !== "#/";
  if (!tieneRuta && activa().ruta !== "#/") {
    history.replaceState(null, "", activa().ruta);
  }
  pintar();

  barra.addEventListener("click", (e) => {
    const cerrarId = e.target.closest("[data-cerrar]")?.dataset.cerrar;
    if (cerrarId) return cerrar(cerrarId);
    const id = e.target.closest(".pestana-ir")?.dataset.id;
    if (id) return activar(id);
    if (e.target.closest(".pestana-nueva")) abrirEnNueva("#/");
  });
  barra.addEventListener("auxclick", (e) => {          // clic con la rueda cierra la pestaña
    const id = e.target.closest(".pestana")?.dataset.id;
    if (e.button === 1 && id) { e.preventDefault(); cerrar(id); }
  });

  // Ctrl/⌘ + clic o clic con la rueda sobre cualquier enlace interno → pestaña nueva
  const enlaceInterno = (e) => {
    const a = e.target.closest('a[href^="#/"]');
    return a && !a.closest("#pestanas") ? a : null;
  };
  document.addEventListener("click", (e) => {
    const a = enlaceInterno(e);
    if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); abrirEnNueva(a.getAttribute("href")); }
  });
  document.addEventListener("auxclick", (e) => {
    const a = enlaceInterno(e);
    if (a && e.button === 1) { e.preventDefault(); abrirEnNueva(a.getAttribute("href")); }
  });
}
