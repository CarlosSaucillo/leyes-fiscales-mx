// Comparación de dos versiones de un texto legal.
// 1) Se alinean los párrafos (iguales / quitados / agregados).
// 2) Los párrafos que cambiaron se comparan palabra por palabra: <del> lo que se quitó, <ins> lo que se agregó.
// Algoritmo: subsecuencia común más larga (LCS), suficiente para textos del tamaño de un artículo.

import { escapar } from "./buscador.js";

const comparable = (s) => s.replace(/\s+/g, "");

/** Operaciones LCS entre dos listas: [["=", i, j] | ["-", i] | ["+", j]]. null si es demasiado grande. */
function operaciones(a, b, iguales) {
  const n = a.length, m = b.length;
  if (n * m > 6e6) return null;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = iguales(a[i], b[j]) ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (iguales(a[i], b[j])) { ops.push(["=", i, j]); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push(["-", i]); i++; }
    else { ops.push(["+", j]); j++; }
  }
  while (i < n) ops.push(["-", i++]);
  while (j < m) ops.push(["+", j++]);
  return ops;
}

/** Diferencia palabra por palabra de un párrafo, como HTML. */
function diffPalabras(viejo, nuevo) {
  const a = viejo.match(/\S+|\s+/g) || [];
  const b = nuevo.match(/\S+|\s+/g) || [];
  const ops = operaciones(a, b, (x, y) => x === y || (!x.trim() && !y.trim()));
  if (!ops) return `<del>${escapar(viejo)}</del> <ins>${escapar(nuevo)}</ins>`;
  let html = "", del = "", ins = "";
  const vaciar = () => {
    if (del.trim()) html += `<del>${escapar(del)}</del>`;
    if (ins.trim()) html += `<ins>${escapar(ins)}</ins>`;
    if (!del.trim() && !ins.trim()) html += escapar(del || ins);
    del = ins = "";
  };
  for (const op of ops) {
    if (op[0] === "=") { vaciar(); html += escapar(a[op[1]]); }
    else if (op[0] === "-") del += a[op[1]];
    else ins += b[op[1]];
  }
  vaciar();
  return html;
}

/** Proporción de palabras compartidas (para decidir si dos párrafos son "el mismo, modificado"). */
function parecido(x, y) {
  const A = new Set(x.toLowerCase().split(/\s+/)), B = y.toLowerCase().split(/\s+/);
  const comunes = B.filter((p) => A.has(p)).length;
  return comunes / Math.max(A.size, B.length, 1);
}

/**
 * Compara dos textos (párrafos separados por "\n").
 * Devuelve { html, cambios } con solo los párrafos que cambiaron y uno de contexto alrededor.
 */
export function compararTextos(viejo, nuevo) {
  const pa = viejo.split("\n").map((p) => p.trim()).filter(Boolean);
  const pb = nuevo.split("\n").map((p) => p.trim()).filter(Boolean);
  const ops = operaciones(pa, pb, (x, y) => comparable(x) === comparable(y)) ||
    [...pa.map((_, i) => ["-", i]), ...pb.map((_, j) => ["+", j])];

  // Bloques: igual | cambio (párrafo viejo→nuevo) | quitado | agregado
  const bloques = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k][0] === "=") { bloques.push({ tipo: "igual", texto: pb[ops[k][2]] }); continue; }
    const quitados = [], agregados = [];
    while (k < ops.length && ops[k][0] !== "=") {
      (ops[k][0] === "-" ? quitados : agregados).push(ops[k][0] === "-" ? pa[ops[k][1]] : pb[ops[k][1]]);
      k++;
    }
    k--;
    // Emparejar cada párrafo quitado con el agregado más parecido (sin cruzar el orden): es el mismo
    // párrafo modificado (p. ej. la fracción II que pasó a ser IV). Lo que no se empareja, quitado o agregado.
    let desde = 0;
    for (const q of quitados) {
      let mejor = -1, puntaje = 0.35;
      for (let j = desde; j < agregados.length; j++) {
        const p = parecido(q, agregados[j]);
        if (p > puntaje) { puntaje = p; mejor = j; }
      }
      if (mejor < 0) { bloques.push({ tipo: "quitado", texto: q }); continue; }
      for (let j = desde; j < mejor; j++) bloques.push({ tipo: "agregado", texto: agregados[j] });
      bloques.push({ tipo: "cambio", viejo: q, nuevo: agregados[mejor] });
      desde = mejor + 1;
    }
    for (let j = desde; j < agregados.length; j++) bloques.push({ tipo: "agregado", texto: agregados[j] });
  }

  const cambios = bloques.filter((b) => b.tipo !== "igual").length;
  const mostrar = bloques.map((b, i) => b.tipo !== "igual" ||
    bloques[i - 1]?.tipo && bloques[i - 1].tipo !== "igual" || bloques[i + 1]?.tipo && bloques[i + 1].tipo !== "igual");
  let html = "", ocultos = 0;
  const cortar = () => { if (ocultos) html += `<p class="d-omitido">… ${ocultos} párrafo${ocultos === 1 ? "" : "s"} sin cambios …</p>`; ocultos = 0; };
  bloques.forEach((b, i) => {
    if (!mostrar[i]) { ocultos++; return; }
    cortar();
    if (b.tipo === "igual") html += `<p class="d-igual">${escapar(b.texto)}</p>`;
    else if (b.tipo === "cambio") html += `<p class="d-cambio">${diffPalabras(b.viejo, b.nuevo)}</p>`;
    else if (b.tipo === "quitado") html += `<p class="d-quitado"><del>${escapar(b.texto)}</del></p>`;
    else html += `<p class="d-agregado"><ins>${escapar(b.texto)}</ins></p>`;
  });
  cortar();
  return { html, cambios };
}
