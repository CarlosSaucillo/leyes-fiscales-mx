#!/usr/bin/env python3
"""Extractor de la Resolución Miscelánea Fiscal (RMF) 2026 → web/data/RMF2026.json

Fuente: minisitio de normatividad del SAT (solo documentos oficiales).

Estrategia (para no "armar" texto legal a mano):
  1. Texto vigente = el COMPILADO más reciente que publica el SAT (RMF + modificaciones
     ya integradas por el propio SAT), separado regla por regla.
  2. Modificaciones POSTERIORES al compilado (resoluciones publicadas en el DOF y
     versiones anticipadas aún no publicadas): no se aplican sobre el texto; en cada
     regla afectada se muestra un aviso y el extracto oficial tal como se publicó
     (con sus "…"). Las reglas nuevas se agregan completas desde el documento oficial.
  3. Todas las versiones anticipadas, resoluciones y anexos quedan listados con su PDF.

Uso:
    python3 scripts/build_rmf.py              # usa lo descargado en fuentes/rmf/
    python3 scripts/build_rmf.py --descargar  # vuelve a revisar el portal del SAT

Después hay que correr  python3 scripts/build_data.py --solo LISR  (o cualquier ley)
para regenerar catálogo e hipervínculos, o directamente:  python3 scripts/build_rmf.py --enlazar
"""
import argparse
import html
import json
import re
import statistics
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
import build_data as bd  # noqa: E402  (utilidades comunes: rutas, ids, catálogo, enlaces)

SIGLAS = "RMF2026"
ANIO = 2026
SAT = "https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/"
PAGINA = SAT + f"normatividad_rmf_rgce{ANIO}.html"
FUENTES = RAIZ / "fuentes" / "rmf"
NOMBRE = f"Resolución Miscelánea Fiscal para {ANIO}"

ORDINALES = {1: "Primera", 2: "Segunda", 3: "Tercera", 4: "Cuarta", 5: "Quinta", 6: "Sexta", 7: "Séptima",
             8: "Octava", 9: "Novena", 10: "Décima", 11: "Décima Primera", 12: "Décima Segunda",
             13: "Décima Tercera", 14: "Décima Cuarta", 15: "Décima Quinta", 16: "Décima Sexta"}
MESES = bd.MESES


# ---------------------------------------------------------------------------
# Portal del SAT: qué documentos hay
# ---------------------------------------------------------------------------
def _fecha_de_nombre(url: str) -> str | None:
    """'…_30102026.pdf' → '2026-10-30'"""
    m = re.findall(r"(\d{2})(\d{2})(20\d{2})", url)
    if m:
        d, mth, a = m[-1]
        if 1 <= int(mth) <= 12 and 1 <= int(d) <= 31:
            return f"{a}-{mth}-{d}"
    return None


def leer_portal(descargar: bool) -> list[dict]:
    pagina = FUENTES / "portal.html"
    if descargar or not pagina.exists():
        print(f"  ↓ {PAGINA}")
        req = urllib.request.Request(PAGINA, headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales)"})
        with urllib.request.urlopen(req, timeout=120) as r:
            pagina.write_bytes(r.read())
    h = pagina.read_text(encoding="utf-8", errors="replace")
    docs = []
    for url, txt in re.findall(r'href="([^"]+\.(?:pdf|zip))"[^>]*>(.*?)</a>', h, re.S | re.I):
        t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", txt))).strip()
        url = url if url.startswith("http") else SAT + url.lstrip("/")
        d = {"titulo": t, "url": url, "fecha": _fecha_de_nombre(url)}
        if t == NOMBRE:
            d["tipo"] = "base"
        elif m := re.match(rf"(\d+)a Resolución de Modificaciones a la RMF para {ANIO}", t):
            d |= {"tipo": "modificacion", "rm": int(m.group(1)),
                  "titulo": f"{ORDINALES.get(int(m.group(1)), m.group(1))} Resolución de Modificaciones a la RMF para {ANIO}"}
        elif m := re.match(rf"(\d+)a Versión Anticipada (\d+)a RMRMF {ANIO}", t):
            va, rm = int(m.group(1)), int(m.group(2))
            d |= {"tipo": "anticipada", "rm": rm, "version": va,
                  "titulo": f"{ORDINALES.get(va, va)} versión anticipada de la {ORDINALES.get(rm, rm)} RMRMF {ANIO}"}
        elif m := re.match(rf"Compilado (\d+)a\. RM RMF {ANIO}$", t):
            d |= {"tipo": "compilado", "rm": int(m.group(1))}
        elif re.search(r"Anexo \d+", t) and "/anexos/" in url:
            d["tipo"] = "anexo"
            d["anexo"] = int(re.search(r"Anexo (\d+)", t).group(1))
        else:
            continue
        docs.append(d)
    return docs


def descargar_pdf(url: str, destino: Path, forzar: bool = False) -> Path:
    """Descarga verificando que el PDF llegó completo (el SAT a veces entrega archivos truncados)."""
    if destino.exists() and not forzar and destino.read_bytes()[-1024:].find(b"%%EOF") != -1:
        return destino
    for intento in range(3):
        print(f"  ↓ {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales)"})
        with urllib.request.urlopen(req, timeout=300) as r:
            esperado = int(r.headers.get("Content-Length") or 0)
            datos = r.read()
        if (not esperado or len(datos) == esperado) and b"%%EOF" in datos[-1024:]:
            destino.write_bytes(datos)
            return destino
        print(f"    descarga incompleta ({len(datos):,} de {esperado:,} bytes); reintento {intento + 2}…")
    sys.exit(f"No se pudo descargar completo: {url}")


def pdf_a_lineas(pdf: Path) -> list[str]:
    txt = pdf.with_suffix(".txt")
    if not txt.exists() or txt.stat().st_mtime < pdf.stat().st_mtime:
        # Se escribe a un temporal y solo se renombra si la extracción terminó bien
        tmp = txt.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            subprocess.run(["swift", str(RAIZ / "scripts" / "pdf_a_texto.swift"), str(pdf)],
                           stdout=f, stderr=subprocess.DEVNULL, check=True, timeout=900)
        tmp.replace(txt)
    lineas = txt.read_text(encoding="utf-8").splitlines()
    if len(lineas) < 5:
        sys.exit(f"No se pudo leer el texto de {pdf.name} (¿PDF dañado o escaneado?)")
    return lineas


# ---------------------------------------------------------------------------
# Limpieza de encabezados/pies de página
# ---------------------------------------------------------------------------
RUIDO = [
    re.compile(r"^NOTA: Este documento constituye una compilación"),
    re.compile(r"^de dar a conocer el texto actualizado de la Resolución Miscelánea Fiscal"),
    re.compile(r"^del Contribuyente\. Para sustentar legalmente actos o resoluciones"),
    re.compile(r"^Página \d+ de \d+$"),
    re.compile(r"^Nota: El presente documento se da a conocer en el Portal del SAT"),
    re.compile(r"^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d{1,2} de \w+ de \d{4}\s+DIARIO OFICIAL\s*(\(.*\))?$"),
    re.compile(r"^DIARIO OFICIAL\s+(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d{1,2} de \w+ de \d{4}$"),
    re.compile(r"^\(\w+ Sección\)\s+DIARIO OFICIAL"),
    re.compile(r"^￼$"),
]


def limpiar(lineas: list[str]) -> list[str]:
    return limpiar_con_paginas(lineas)[0]


def limpiar_con_paginas(lineas: list[str]) -> tuple[list[str], list[int]]:
    """Quita encabezados/pies y devuelve, para cada renglón, la página del PDF donde está."""
    salida, paginas, pagina = [], [], 1
    for l in lineas:
        if m := re.match(r"^Página (\d+) de \d+$", l.strip()):
            pagina = int(m.group(1))
        if l.strip() and not any(r.search(l.strip()) for r in RUIDO):
            salida.append(l.rstrip())
            paginas.append(pagina)
    return salida, paginas


# ---------------------------------------------------------------------------
# Reconstrucción de párrafos (el PDF corta los renglones al ancho de la página)
# ---------------------------------------------------------------------------
RE_INICIO_LISTA = re.compile(r"^(?:[IVXLC]+\.|[a-zñ]\)|[A-Z]\)|\d{1,2}\.|[a-z]\.)\s|^[-•]\s|^“|^Donde:|^Para tales efectos")


def parrafos(lineas: list[str], ancho: int) -> list[str]:
    """Une renglones físicos en párrafos. Hay corte de párrafo cuando el renglón empieza con
    una etiqueta de lista (I., a), 1.) o cuando el renglón anterior termina en punto/dos puntos
    y además es corto (no llegó al margen derecho)."""
    out: list[str] = []
    anterior = ""            # último renglón FÍSICO (para medir si llegó al margen)
    for l in lineas:
        l = l.strip()
        if not l:
            continue
        if l.startswith("\x00"):        # nota insertada por el extractor: párrafo propio
            out.append(l[1:])
            anterior = "."               # lo que sigue empieza párrafo nuevo
            continue
        if not out:
            out.append(l)
        elif RE_INICIO_LISTA.match(l) or (anterior.endswith((".", ":", ";", "”", ".”")) and len(anterior) < ancho * 0.82):
            out.append(l)
        elif out[-1].endswith("-") and l[:1].islower():
            out[-1] = out[-1][:-1] + l                       # palabra partida: "contribu-" + "yente"
        elif re.search(r"[\w.]-$", out[-1]) or re.search(r"(https?://|www\.)\S*[^\s,;.)]$", out[-1]):
            out[-1] = out[-1] + l                            # "18-" + "J", "NOM-012-" + "SCT", direcciones web
        else:
            out[-1] = out[-1] + " " + l
        anterior = l
    return out


def ancho_tipico(lineas: list[str]) -> int:
    largos = sorted(len(l) for l in lineas if len(l) > 20)
    return largos[int(len(largos) * 0.9)] if largos else 100


# ---------------------------------------------------------------------------
# Índice (Contenido) → nombres completos de Título/Capítulo/Sección/Subsección
# ---------------------------------------------------------------------------
RE_TOC_DIV = re.compile(r"^(Capítulo|Sección|Subsección) (\d+(?:\.\d+)+)\.(?: (.*))?$")
RE_TOC_TIT = re.compile(r"^(\d+)\. (.*)$")
NIVEL_DE = {"Título": "titulo", "Capítulo": "capitulo", "Sección": "seccion", "Subsección": "subseccion"}


def leer_indice(lineas: list[str]) -> tuple[dict, int]:
    """Devuelve ({'2.7': ('capitulo', 'De los Comprobantes…')}, índice donde empieza el cuerpo)."""
    ini = lineas.index("Contenido")
    toc: dict[str, list] = {}
    ultimo = None
    k = ini + 1
    while k < len(lineas):
        l = lineas[k].strip()
        if l == "Glosario" and k > ini + 3 and lineas[k + 1].startswith("Para una mejor comprensión"):
            break
        if m := RE_TOC_DIV.match(l):
            ultimo = m.group(2)
            toc[ultimo] = [NIVEL_DE[m.group(1)], m.group(3) or ""]
        elif (m := RE_TOC_TIT.match(l)) and "." not in m.group(1):
            ultimo = m.group(1)
            toc[ultimo] = ["titulo", m.group(2)]
        elif ultimo and l not in ("Título", "Glosario", "Transitorios"):
            toc[ultimo][1] += " " + l
        k += 1
    return {n: (v[0], re.sub(r"\s+", " ", v[1]).strip()) for n, v in toc.items()}, k


# ---------------------------------------------------------------------------
# Cuerpo del compilado → reglas
# ---------------------------------------------------------------------------
RE_REGLA = re.compile(r"^(\d+(?:\.\d+){1,4})\. (.*)$")
RE_DIV = re.compile(r"^(Título|Capítulo|Sección|Subsección) (\d+(?:\.\d+)*)\.(?: (.*))?$")
RE_ANOT_OBJ = re.compile(r"^(Regla (\d+(?:\.\d+)+)\.|Glosario.*|Numeral \d+.*|Título \d+.*|Capítulo [\d.]+.*|Sección [\d.]+.*|Subsección [\d.]+.*|Transitorios?.*)$")
RE_ANOT = re.compile(r"^- (Reformad[oa]s?|Adicionad[oa]s?|Derogad[oa]s?|Se deroga)\b(.*)$")
RE_ANOT_FECHA = re.compile(r"publicad[oa] en el DOF el (\d{1,2}) de (\w+) de (\d{4})")
RE_REFS = re.compile(
    r"^(?:(?:CFF|LISR|LIVA|LIEPS|LFD|LIF|LA|LCF|RCFF|RLISR|RLIVA|RMF|RGCE|LFDC|LSAT|RISAT|LISH|LGSM|LIC|LMV|"
    r"LFPCA|CPEUM|LSS|LFT|LGTOC|LFPIORPI|LINFONAVIT|LFPRH|LGCG|LOAPF|LFEA|LGPC|LFRCF|RLFD|RLA|RLIEPS)\s+\S"
    r"|Ley\b.*\d|Decreto\b.*(?:DOF|\d)|Acuerdo\b.*DOF|Reglamento\b.*\d|Anexo \d|Transitorio\b|Resolución\b.*\d)")
RE_REFS_CONT = re.compile(r"^[\d.,\s\-–A-Za-z]{1,60}$")


def _tupla(n: str) -> tuple:
    return tuple(int(x) for x in n.split("."))


def _iso(m: re.Match) -> str | None:
    d, mes, a = m.groups()
    n = MESES.get(mes.lower())
    return f"{a}-{n:02d}-{int(d):02d}" if n else None


RE_PARECE_REF = re.compile(r"\bDOF\b|\d{1,2}/\d{2}/\d{4}|\d,\s|^\d")


def es_titulo(l: str) -> bool:
    """Renglón que puede formar parte del título (epígrafe) de una regla."""
    l = l.strip()
    return bool(l) and not l.endswith((".", ";", ":", "…")) and not RE_REFS.match(l) \
        and not RE_INICIO_LISTA.match(l) and len(l) < 200 and l not in ("…", "...") \
        and not re.match(r"^(Título|Capítulo|Sección|Subsección)\s+\d", l)


ANCHO = 100   # ancho típico de renglón del documento en turno (se fija al parsear)
# Un renglón de referencias que termina así ya está completo (no sigue abajo)
RE_FIN_REFS = re.compile(r"(?:[\d.]|\b(?:Primero|Segundo|Tercero|Cuarto|Quinto|Sexto|Séptimo|Octavo|Noveno|Décimo|"
                         r"Único|Transitorio|Transitorios|Bis|Ter|Quáter|[A-Z]))\s*$")


def separar_epigrafe(buffer: list[str]) -> tuple[list[str], list[str]]:
    """Del final del buffer toma los renglones del título (epígrafe) de la siguiente regla.
    - El renglón inmediato anterior al número de regla siempre es parte del título.
    - Hacia arriba se agregan renglones sin punto final (hasta 7).
    - Se descarta de arriba la cola de referencias de la regla anterior: renglones en
      minúscula, con fecha "dd/mm/aaaa", o la continuación de un renglón de referencias
      que llegó al margen derecho."""
    if not buffer:
        return buffer, []
    k = len(buffer) - 1
    while k > 0 and len(buffer) - k < 7 and es_titulo(buffer[k - 1]):
        k -= 1
    # Referencias que siguen en los renglones de abajo: un renglón continúa las referencias solo si el
    # anterior llegó al margen derecho (el texto se "desbordó"). El primero que no llega cierra las referencias.
    if k > 0 and RE_REFS.match(buffer[k - 1].strip()):
        j = k
        # sigue solo si el renglón anterior llegó al margen Y quedó "a media frase" (termina en palabra o coma);
        # si termina en número o punto ("…RMF 2.7.1.8.") las referencias ya estaban completas
        while j < len(buffer) - 1 and len(buffer[j - 1].strip()) >= ANCHO * 0.85 \
                and not RE_FIN_REFS.search(buffer[j - 1].strip()):
            j += 1
        k = j
    while k < len(buffer) - 1 and (not (buffer[k].strip()[:1].isupper() or buffer[k].strip()[:1] in "“(¿")
                                   or re.search(r"\d{1,2}/\d{2}/\d{4}", buffer[k])):
        k += 1
    return buffer[:k], buffer[k:]


def separar_referencias(texto: list[str]) -> tuple[list[str], str]:
    """Renglones finales con las referencias del SAT ('CFF 28, 30, RMF 2.8.1.4.').
    Empiezan en un renglón con sigla de ley (y el renglón previo cierra un párrafo)."""
    for i in range(len(texto) - 1, max(-1, len(texto) - 6), -1):
        l = texto[i].strip()
        previo = texto[i - 1].strip() if i > 0 else "."
        if RE_REFS.match(l) and previo.endswith((".", ":", "”", ")")):
            return texto[:i], " ".join(x.strip() for x in texto[i:])
    return texto, ""


RE_NUMERICO = re.compile(r"^[\d.,%$()\-–]+$")


def marcar_contenido_no_textual(u: dict) -> None:
    """Tablas que el PDF desarma (párrafos casi solo de números) y fórmulas que son imagen ("Donde:" sin fórmula)."""
    ps = u["texto"].split("\n")
    tablas = []
    for i, p in enumerate(ps):
        toks = p.split()
        if len(toks) >= 12 and sum(1 for t in toks if RE_NUMERICO.match(t)) / len(toks) >= 0.45:
            tablas.append(i)
    if tablas:
        u["tablas_pdf"] = tablas
    if any(p.strip().startswith("Donde:") for p in ps):
        u["formula_pdf"] = True


def parsear_compilado(lineas_crudas: list[str], fuente: str) -> tuple[list[dict], dict, dict]:
    lineas, paginas = limpiar_con_paginas(lineas_crudas)
    toc, ini = leer_indice(lineas)
    global ANCHO
    ancho = ANCHO = ancho_tipico(lineas)
    diag = {"anotaciones_sueltas": [], "descartadas": [], "toc": toc}

    unidades: list[dict] = []
    buffer: list[str] = []          # renglones desde el inicio de la unidad abierta
    abierta: dict | None = None     # unidad en construcción
    anotaciones: dict[str, list] = {}
    titulo_actual = "0"
    ultima_regla: tuple = ()
    en_transitorios = False

    def ruta_de(numero: str) -> list[dict]:
        partes = numero.split(".")
        ruta = []
        for i in range(1, len(partes)):
            n = ".".join(partes[:i])
            if n in toc:
                nivel, nombre = toc[n]
                ruta.append({"nivel": nivel, "etiqueta": f"{bd.ETIQUETA_NIVEL.get(nivel, 'Subsección')} {n}", "nombre": nombre})
        return ruta

    def cerrar(texto: list[str]):
        nonlocal abierta
        if abierta is None:
            return
        cuerpo, refs = separar_referencias(texto) if abierta["unidad"] == "regla" else (texto, "")
        ps = parrafos(cuerpo, ancho)
        notas = anotaciones.pop(abierta["numero"], []) if abierta["unidad"] == "regla" else []
        fechas = sorted({f for _, f in notas if f})
        for tipo, f in notas:
            if f:
                d = f.split("-")
                ps.append(f"Regla {tipo.lower()} DOF {d[2]}-{d[1]}-{d[0]}")
        abierta["texto"] = "\n".join(ps)
        abierta["referencias_sat"] = refs
        abierta["reformas"] = fechas
        abierta["ultima_reforma"] = fechas[-1] if fechas else None
        abierta["notas_compilado"] = [t for t, _ in notas]
        marcar_contenido_no_textual(abierta)
        unidades.append(abierta)
        abierta = None

    k = ini
    # --- Glosario ---
    abierta = {"unidad": "glosario", "numero": "Glosario", "titulo_regla": "Acrónimos y definiciones",
               "ruta": [{"nivel": "glosario", "etiqueta": "Glosario", "nombre": "Acrónimos y definiciones"}], "fuente": fuente}
    k += 1
    while k < len(lineas):
        l = lineas[k].strip()

        # Anotaciones del compilado: "Regla 2.1.6." + "- Reformada en la Primera RMRMF…"
        if RE_ANOT_OBJ.match(l) and k + 1 < len(lineas) and RE_ANOT.match(lineas[k + 1].strip()):
            objetivo = l
            j = k + 1
            notas = []
            while j < len(lineas) and RE_ANOT.match(lineas[j].strip()):
                nota = lineas[j].strip()
                # la nota puede seguir en el renglón siguiente
                # la anotación termina en su punto final (puede ocupar 2 o 3 renglones)
                while j + 1 < len(lineas) and not nota.endswith(".") and not RE_ANOT.match(lineas[j + 1].strip()) \
                        and not RE_ANOT_OBJ.match(lineas[j + 1].strip()) and len(nota) < 400:
                    j += 1
                    nota += " " + lineas[j].strip()
                m = RE_ANOT_FECHA.search(nota)
                tipo = RE_ANOT.match(nota).group(1)
                notas.append((tipo, _iso(m) if m else None))
                j += 1
            if en_transitorios or (abierta and abierta["unidad"] == "glosario" and objetivo.startswith("Numeral")):
                # dentro de los transitorios o del glosario: queda como nota en su lugar, sin cerrar el bloque
                for tipo, f in notas:
                    fecha_dof = "-".join(reversed(f.split("-"))) if f else ""
                    buffer.append("\x00" + f"{objetivo} {tipo.lower()} DOF {fecha_dof}".strip())
                k = j
                continue
            if (m := re.match(r"Regla (\d+(?:\.\d+)+)\.", objetivo)):
                anotaciones.setdefault(m.group(1), []).extend(notas)
            else:
                diag["anotaciones_sueltas"].append((objetivo, notas))
            # todo lo anterior pertenece a la unidad abierta; lo que sigue es el título de la siguiente
            cerrar(buffer)
            buffer = []
            k = j
            continue

        # Encabezados de división (si no están en el índice del documento, se toman del cuerpo)
        if (m := RE_DIV.match(l)) and m.group(2) not in toc and m.group(3) and \
                (m.group(1) == "Título" or ".".join(m.group(2).split(".")[:-1]) in toc):
            nombre = m.group(3).strip()
            while k + 1 < len(lineas) and lineas[k + 1].strip()[:1].islower():
                k += 1
                nombre += " " + lineas[k].strip()
            toc[m.group(2)] = (NIVEL_DE[m.group(1)], nombre)
            diag.setdefault("fuera_de_indice", []).append(m.group(2))
            ultima_regla = _tupla(m.group(2))
            cerrar(buffer)
            buffer = []
            if m.group(1) == "Título":
                titulo_actual = m.group(2)
            k += 1
            continue
        if (m := RE_DIV.match(l)) and m.group(2) in toc:
            cuerpo, _ = buffer, []
            cerrar(cuerpo)
            buffer = []
            num = m.group(2)
            ultima_regla = _tupla(num)   # el SAT a veces numera una Sección después de reglas mayores (3.9.1 tras 3.9.18)
            if m.group(1) == "Título":
                titulo_actual = num
            # saltar renglones de continuación del nombre (se toma completo del índice)
            nombre = toc[num][1]
            acumulado = (m.group(3) or "").strip()
            while k + 1 < len(lineas) and len(acumulado) < len(nombre) and \
                    nombre.startswith((acumulado + " " + lineas[k + 1].strip()).strip()):
                k += 1
                acumulado = (acumulado + " " + lineas[k].strip()).strip()
            k += 1
            continue

        # Transitorios de la RMF (al final)
        if l == "Transitorios" and abierta and abierta["unidad"] == "regla" and _tupla(abierta["numero"])[0] >= 11:
            resto, _ = buffer, None
            cerrar(resto)
            buffer = []
            en_transitorios = True
            abierta = {"unidad": "transitorio", "numero": "Transitorios", "titulo_regla": "Transitorios",
                       "titulo_decreto": f"Transitorios de la {NOMBRE}", "fecha_publicacion": f"{ANIO - 1}-12-28",
                       "ruta": [{"nivel": "transitorios", "etiqueta": "Transitorios", "nombre": None}], "fuente": fuente}
            k += 1
            continue

        # Inicio de regla
        if not en_transitorios and (m := RE_REGLA.match(l)):
            num, resto = m.groups()
            t = _tupla(num)
            padre = ".".join(num.split(".")[:-1])
            arranque = resto[:1]
            if num.split(".")[0] == titulo_actual and (padre in toc or padre == titulo_actual) and t > ultima_regla \
                    and (arranque.isupper() or arranque in "(“\"" or not resto):
                previo, epigrafe = separar_epigrafe(buffer)
                cerrar(previo)
                abierta = {"unidad": "regla", "numero": num, "titulo_regla": " ".join(epigrafe).strip(),
                           "ruta": ruta_de(num), "fuente": fuente, "pagina": paginas[k]}
                buffer = [resto] if resto else []
                ultima_regla = t
                k += 1
                continue
            diag["descartadas"].append((k, l[:80]))

        buffer.append(l)
        k += 1

    cerrar(buffer)
    return unidades, anotaciones, diag


# ---------------------------------------------------------------------------
# Resoluciones de modificaciones y versiones anticipadas posteriores al compilado
# ---------------------------------------------------------------------------
RE_PARA_QUEDAR = re.compile(r"para\s+quedar\s+(?:de\s+la\s+siguiente\s+manera|como\s+sigue)\s*:?", re.I)
RE_FIN_ZONA = re.compile(r"”\s*\n(?=(?:PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|SÉPTIMO|OCTAVO|NOVENO|DÉCIMO|ÚNICO)\b"
                         r"|Transitori|Atentamente|Primero\.|Segundo\.|Único\.)")


def parsear_modificacion(lineas_crudas: list[str]) -> dict:
    """Extractos por regla de las zonas 'para quedar de la siguiente manera: “…”' y reglas derogadas.
    Las zonas sin reglas (p. ej. reformas a transitorios) se devuelven aparte."""
    lineas = limpiar(lineas_crudas)
    texto = "\n".join(lineas)
    ancho = ancho_tipico(lineas)
    global ANCHO
    ANCHO = ancho
    derogadas = set()
    for m in re.finditer(r"se\s+derogan?\s+(?:la|las)\s+reglas?\s+([\d.,;\sy]+?)(?:\s+de\s+la\s+Resolución|\s+de\s+la\s+RMF|,?\s+para\s+quedar|$)", texto, re.S):
        derogadas.update(re.findall(r"\d+(?:\.\d+){1,4}(?=\.)", m.group(1)))
    extractos: dict[str, dict] = {}
    otras_zonas: list[str] = []
    for m in RE_PARA_QUEDAR.finditer(texto):
        ini = texto.find("“", m.end())
        if ini < 0:
            continue
        f = RE_FIN_ZONA.search(texto, ini)
        fin = f.start() if f else texto.rfind("”")
        zl = [l for l in texto[ini + 1:fin].split("\n")]
        actual, buf, hubo_reglas = None, [], False
        for idx, l in enumerate(zl):
            mr = RE_REGLA.match(l.strip())
            previo = zl[idx - 1].strip() if idx else ""
            if mr and (idx == 0 or es_titulo(previo) or previo in ("…", "...")):
                hubo_reglas = True
                resto_previo, epi = separar_epigrafe(buf)
                if actual:
                    extractos[actual]["lineas"] = resto_previo
                actual = mr.group(1)
                extractos[actual] = {"titulo_regla": " ".join(epi).strip(), "lineas": []}
                buf = [mr.group(2)] if mr.group(2) else []
            else:
                buf.append(l)
        if actual:
            extractos[actual]["lineas"] = buf
        if not hubo_reglas:
            otras_zonas.append("\n".join(parrafos(zl, ancho)))
    for n, e in extractos.items():
        cuerpo, refs = separar_referencias(e.pop("lineas"))
        e["texto"] = "\n".join(parrafos(cuerpo, ancho))
        e["referencias_sat"] = refs
        e["completa"] = "…" not in e["texto"] and "..." not in e["texto"]
    return {"extractos": extractos, "derogadas": sorted(derogadas, key=_tupla), "otras_zonas": otras_zonas,
            "texto_completo": "\n".join(parrafos(lineas, ancho))}


def _ids(unidades: list[dict]) -> None:
    for u in unidades:
        u["id"] = f"{SIGLAS.lower()}-glosario" if u["unidad"] == "glosario" else \
            f"{SIGLAS.lower()}-transitorios-1" if u["unidad"] == "transitorio" else bd.id_unidad(SIGLAS, u["numero"])


# ---------------------------------------------------------------------------
def validar(unidades, diag, base_numeros: set, anot_sobrantes: dict) -> list[str]:
    reglas = [u for u in unidades if u["unidad"] == "regla"]
    r = [f"{len(reglas)} reglas + glosario + {sum(1 for u in unidades if u['unidad'] == 'transitorio')} bloque(s) de transitorios"]
    nums = [u["numero"] for u in reglas]
    dup = sorted({n for n in nums if nums.count(n) > 1})
    r.append(f"⚠ reglas duplicadas: {dup}" if dup else "✓ sin reglas duplicadas")
    sin_titulo = [u["numero"] for u in reglas if not u["titulo_regla"]]
    r.append(f"⚠ reglas sin título (epígrafe): {sin_titulo}" if sin_titulo else "✓ todas las reglas tienen título")
    # Un título no debería traer números de regla ni fechas "dd/mm/aaaa" (señal de que absorbió referencias)
    raros = [f"{u['numero']}: «{u['titulo_regla'][:60]}»" for u in reglas
             if re.search(r"\d{1,2}/\d{2}/\d{4}|\bDOF\b", u["titulo_regla"])]   # (mencionar otras reglas sí es normal)
    r.append(f"⚠ títulos que parecen incluir referencias: {raros[:10]}" if raros else "✓ ningún título absorbió referencias")
    largos = [u["numero"] for u in reglas if len(u["titulo_regla"]) > 260]
    if largos:
        r.append(f"  títulos de más de 260 caracteres (así vienen en el documento): {largos}")
    vacias = [u["numero"] for u in reglas if not u["texto"].strip()]
    if vacias:
        r.append(f"⚠ reglas sin texto: {vacias}")
    sin_ruta = [u["numero"] for u in reglas if not u["ruta"]]
    if sin_ruta:
        r.append(f"⚠ reglas sin ubicación en el índice: {sin_ruta[:10]}")
    # Cotejo contra la RMF original (DOF): toda diferencia debe estar explicada por una anotación
    adicionadas = {u["numero"] for u in reglas if any(t.startswith("Adicionad") for t in u.get("notas_compilado", []))
                   or u.get("nueva_en")}
    if base_numeros:
        nuevas = set(nums) - base_numeros
        faltan = base_numeros - set(nums)
        sin_explicar = sorted(nuevas - adicionadas, key=_tupla)
        r.append(f"  cotejo con la RMF publicada en el DOF: {len(base_numeros)} reglas originales; "
                 f"{len(nuevas)} nuevas en el compilado ({len(adicionadas & nuevas)} anotadas como adicionadas); "
                 f"{len(faltan)} originales ya no aparecen")
        if sin_explicar:
            r.append(f"⚠ reglas nuevas sin anotación de «Adicionada»: {sin_explicar[:15]}")
        if faltan:
            r.append(f"  reglas originales que ya no aparecen (derogadas/reubicadas; revisar): {sorted(faltan, key=_tupla)[:20]}")
    if anot_sobrantes:
        r.append(f"⚠ anotaciones que no encontraron su regla: {list(anot_sobrantes)[:10]}")
    if diag["anotaciones_sueltas"]:
        r.append(f"  anotaciones de divisiones/glosario: {[o for o, _ in diag['anotaciones_sueltas']][:10]}")
    r.append(f"  renglones con forma de número de regla tratados como texto: {len(diag['descartadas'])}")
    if diag.get("fuera_de_indice"):
        r.append(f"  divisiones que el SAT no incluyó en el índice del documento (tomadas del cuerpo): {diag['fuera_de_indice']}")
    return r


def numeros_base(lineas: list[str]) -> set:
    """Números de regla de la RMF original publicada en el DOF (para el cotejo)."""
    lineas = limpiar(lineas)
    nums, ultimo, titulo = set(), (), "0"
    for l in lineas:
        if m := re.match(r"^Título (\d+)\. ", l):
            titulo = m.group(1)
        if m := re.match(r"^(?:Título|Capítulo|Sección|Subsección) (\d+(?:\.\d+)*)\.", l.strip()):
            ultimo = _tupla(m.group(1))
        if (m := RE_REGLA.match(l.strip())) and m.group(1).split(".")[0] == titulo and \
                (m.group(2)[:1].isupper() or m.group(2)[:1] in "(“"):
            t = _tupla(m.group(1))
            if t > ultimo:
                nums.add(m.group(1))
                ultimo = t
    return nums


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--descargar", action="store_true", help="revisar el portal del SAT y bajar documentos nuevos")
    ap.add_argument("--enlazar", action="store_true", help="solo regenerar catálogo e hipervínculos")
    args = ap.parse_args()
    FUENTES.mkdir(parents=True, exist_ok=True)
    if args.enlazar:
        bd.generar_versiones_todas()
        bd.actualizar_catalogo()
        bd.enlazar_todas()
        return

    print(f"=== {SIGLAS}: {NOMBRE} ===")
    docs = leer_portal(args.descargar)
    compilados = sorted([d for d in docs if d["tipo"] == "compilado"], key=lambda d: d["rm"])
    if not compilados:
        sys.exit("No encontré un compilado de la RMF en el portal del SAT.")
    comp = compilados[-1]
    base = next(d for d in docs if d["tipo"] == "base")
    rms = sorted([d for d in docs if d["tipo"] == "modificacion"], key=lambda d: d["rm"])
    max_rm = max((d["rm"] for d in rms), default=0)
    print(f"  compilado vigente: {comp['titulo']} · resoluciones publicadas: {max_rm}")

    pdf_comp = descargar_pdf(comp["url"], FUENTES / f"compilado{comp['rm']}.pdf", forzar=args.descargar)
    pdf_base = descargar_pdf(base["url"], FUENTES / "base.pdf")
    unidades, sobrantes, diag = parsear_compilado(pdf_a_lineas(pdf_comp), comp["url"])
    base_nums = numeros_base(pdf_a_lineas(pdf_base))

    # Fechas DOF de las resoluciones (del encabezado del compilado o del nombre del archivo)
    encabezado = " ".join(pdf_a_lineas(pdf_comp)[:15])
    for d in rms:
        ordn = ORDINALES[d["rm"]]
        if m := re.search(rf"{ordn} (?:Resolución de Modificaciones a la Resolución Miscelánea\s+Fiscal \(RMRMF\)|RMRMF) para {ANIO}, "
                          rf"publicada en el citado órgano de\s+difusión el (\d{{1,2}}) de (\w+) de (\d{{4}})", encabezado):
            d["fecha"] = _iso(m)
        d["integrada"] = d["rm"] <= comp["rm"]

    # Posteriores al compilado: resoluciones ya en el DOF y versiones anticipadas aún sin publicar
    pendientes = [d for d in rms if d["rm"] > comp["rm"]]
    anticipadas = [d for d in docs if d["tipo"] == "anticipada"]
    for d in anticipadas:
        d["publicada_dof"] = d["rm"] <= max_rm
    pendientes += sorted([d for d in anticipadas if not d["publicada_dof"] and d["url"].endswith(".pdf")],
                         key=lambda d: (d["rm"], d["version"]))
    por_numero = {u["numero"]: u for u in unidades if u["unidad"] == "regla"}
    reporte_pend = []
    for d in pendientes:
        nombre_pdf = re.sub(r"[^\w.-]", "_", Path(d["url"]).name)
        mod = parsear_modificacion(pdf_a_lineas(descargar_pdf(d["url"], FUENTES / nombre_pdf)))
        es_dof = d["tipo"] == "modificacion"
        etiqueta = d["titulo"] + (f" (DOF {d['fecha']})" if es_dof and d.get("fecha") else f" ({d.get('fecha')})")
        nuevas = 0
        for num, e in mod["extractos"].items():
            if num in mod["derogadas"]:
                continue            # se reporta una sola vez, como derogación (abajo)
            aviso = {"documento": d["titulo"], "fecha": d.get("fecha"), "url": d["url"],
                     "estado": "publicada en el DOF; aún no integrada en el compilado del SAT" if es_dof
                     else "versión anticipada en el portal del SAT; aún no publicada en el DOF",
                     "titulo_regla": e["titulo_regla"], "texto": e["texto"], "referencias_sat": e["referencias_sat"]}
            if num in por_numero:
                por_numero[num].setdefault("pendientes", []).append(aviso)
            elif e["completa"] and re.match(r"^\d+(\.\d+)+$", num):
                nueva = {"unidad": "regla", "numero": num, "titulo_regla": e["titulo_regla"], "ruta": [],
                         "fuente": d["url"], "texto": e["texto"], "referencias_sat": e["referencias_sat"],
                         "reformas": [d["fecha"]] if es_dof and d.get("fecha") else [], "ultima_reforma": d.get("fecha") if es_dof else None,
                         "nueva_en": aviso}
                por_numero[num] = nueva
                nuevas += 1
        trans_rmf = next((u for u in unidades if u["unidad"] == "transitorio"), None)
        for zona in mod["otras_zonas"]:
            if trans_rmf is not None:
                trans_rmf.setdefault("pendientes", []).append(
                    {"documento": d["titulo"], "fecha": d.get("fecha"), "url": d["url"], "titulo_regla": "Transitorios",
                     "estado": "publicada en el DOF; aún no integrada en el compilado del SAT" if es_dof
                     else "versión anticipada en el portal del SAT; aún no publicada en el DOF", "texto": zona})
        for num in mod["derogadas"]:
            if num in por_numero:
                por_numero[num].setdefault("pendientes", []).append(
                    {"documento": d["titulo"], "fecha": d.get("fecha"), "url": d["url"], "derogada": True,
                     "estado": "publicada en el DOF; aún no integrada en el compilado del SAT" if es_dof
                     else "versión anticipada; aún no publicada en el DOF", "texto": "Esta regla se deroga.", "titulo_regla": ""})
        reporte_pend.append(f"  {etiqueta}: {len(mod['extractos'])} reglas tocadas, {nuevas} nuevas agregadas completas, "
                            f"{len(mod['derogadas'])} derogadas")

    # Reglas nuevas: ubicarlas en su lugar y con su ruta
    toc = diag["toc"]
    reglas = sorted([u for u in por_numero.values()], key=lambda u: _tupla(u["numero"]))
    for u in reglas:
        if not u["ruta"]:
            partes = u["numero"].split(".")
            u["ruta"] = [{"nivel": toc[".".join(partes[:i])][0],
                          "etiqueta": f"{bd.ETIQUETA_NIVEL.get(toc['.'.join(partes[:i])][0], 'Subsección')} {'.'.join(partes[:i])}",
                          "nombre": toc[".".join(partes[:i])][1]}
                         for i in range(1, len(partes)) if ".".join(partes[:i]) in toc]
    glosario = [u for u in unidades if u["unidad"] == "glosario"]
    trans = [u for u in unidades if u["unidad"] == "transitorio"]
    todas = glosario + reglas + trans

    for u in todas:
        u["ley"] = SIGLAS
        u["id"] = f"{SIGLAS.lower()}-glosario" if u["unidad"] == "glosario" else \
            f"{SIGLAS.lower()}-transitorios-1" if u["unidad"] == "transitorio" else bd.id_unidad(SIGLAS, u["numero"])
        u.setdefault("reformas", [])
        u.setdefault("ultima_reforma", None)
        u["titulo"] = next((f"{x['etiqueta']} — {x['nombre']}" for x in u["ruta"] if x["nivel"] == "titulo"), None)
        u["capitulo"] = next((f"{x['etiqueta']} — {x['nombre']}" for x in u["ruta"] if x["nivel"] == "capitulo"), None)
        u["seccion"] = next((f"{x['etiqueta']} — {x['nombre']}" for x in u["ruta"] if x["nivel"] == "seccion"), None)
        u["referencias"] = []

    hoy = date.today().isoformat()
    ultima_dof = max((d["fecha"] for d in rms if d.get("fecha")), default=None)
    meta = {
        "siglas": SIGLAS, "nombre": NOMBRE, "tipo": "resolucion", "materia": ["Fiscal", "Resoluciones fiscales"],
        "estatus": "vigente", "publicacion": f"{ANIO - 1}-12-28", "ultima_reforma": ultima_dof,
        "fuente": comp["url"], "fuente_doc": comp["url"], "ley_padre": None, "reglamento": None,
        "compilado": {"titulo": comp["titulo"], "integra_hasta": f"{ORDINALES[comp['rm']]} RMRMF",
                      "url": comp["url"]},
        "documentos": {
            "base": base,
            "modificaciones": rms,
            "anticipadas": sorted(anticipadas, key=lambda d: (d["rm"], d["version"])),
            "anexos": sorted([d for d in docs if d["tipo"] == "anexo"], key=lambda d: (d["anexo"], d["titulo"])),
        },
        "pendientes": [{"titulo": d["titulo"], "fecha": d.get("fecha"), "url": d["url"], "tipo": d["tipo"]} for d in pendientes],
        "generado": hoy,
        "num_articulos": len(reglas),
        "num_transitorios": len(trans),
        "unidad_nombre": "reglas",
    }
    meta["estructura"] = bd.construir_estructura(todas)
    datos = {"ley": meta, "unidades": todas}

    reporte = validar(todas, diag, base_nums, sobrantes) + ["", "Posteriores al compilado:"] + (reporte_pend or ["  ninguno"])

    # Versiones: la RMF original del DOF y cada compilado del SAT (textos oficiales completos)
    reporte += ["", "Versiones guardadas:"]
    unid_base, _, _ = parsear_compilado(pdf_a_lineas(pdf_base), base["url"])
    _ids(unid_base)
    bd.guardar_version(SIGLAS, f"{ANIO - 1}-12-28", "RMF original (DOF 28-12-2025)", base["url"], unid_base)
    reporte.append(f"  RMF original (DOF): {sum(1 for x in unid_base if x['unidad'] == 'regla')} reglas")
    for c in compilados:
        f_rm = next((d.get("fecha") for d in rms if d["rm"] == c["rm"]), None)
        if not f_rm:
            reporte.append(f"⚠ sin fecha para el {c['titulo']}; no se guarda como versión")
            continue
        if c is comp:
            unid_c = [x for x in todas if not x.get("nueva_en")]
        else:
            unid_c, _, _ = parsear_compilado(pdf_a_lineas(descargar_pdf(c["url"], FUENTES / f"compilado{c['rm']}.pdf")), c["url"])
            _ids(unid_c)
        bd.guardar_version(SIGLAS, f_rm, f"Compilado del SAT con la {ORDINALES[c['rm']]} RMRMF (DOF {f_rm[8:]}-{f_rm[5:7]}-{f_rm[:4]})",
                           c["url"], unid_c)
        reporte.append(f"  {c['titulo']} ({f_rm}): {sum(1 for x in unid_c if x['unidad'] == 'regla')} reglas")
    # Validación cruzada: un título que cambia entre versiones sin anotación suele ser un error de extracción
    fotos = [json.loads(f.read_text(encoding="utf-8")) for f in sorted((bd.HISTORICO / SIGLAS).glob("*.json"))]
    anotadas = {x["id"] for x in todas if x.get("reformas")}
    def distintos(grupo):
        return sorted({uid for f in grupo for uid, tit in f.get("titulos", {}).items()
                       if uid not in anotadas and fotos[-1].get("titulos", {}).get(uid) not in (None, tit)})
    comp_fotos = [f for f in fotos if f["version"] != f"{ANIO - 1}-12-28"]
    d_comp, d_dof = distintos(comp_fotos), distintos(fotos)
    reporte.append(f"⚠ títulos distintos entre compilados sin anotación (revisar extracción): {d_comp}" if d_comp
                   else "✓ los títulos de las reglas coinciden entre todos los compilados del SAT")
    if set(d_dof) - set(d_comp):
        reporte.append(f"  títulos distintos solo en la RMF original del DOF (otro formato de página; no afecta el texto vigente): "
                       f"{sorted(set(d_dof) - set(d_comp))}")
    for u in todas:
        u.pop("notas_compilado", None)
    (bd.SALIDA / f"{SIGLAS}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (bd.REPORTES / f"validacion_{SIGLAS}.txt").write_text(
        f"Reporte de validación — {SIGLAS} — {hoy}\n\n" + "\n".join(reporte) + "\n", encoding="utf-8")
    for l in reporte:
        print(f"  {l}")
    bd.generar_versiones_todas()
    bd.actualizar_catalogo()
    bd.enlazar_todas()


if __name__ == "__main__":
    main()
