#!/usr/bin/env python3
"""Extractor de leyes fiscales mexicanas: LeyesBiblio (Cámara de Diputados) → JSON.

Descarga los .doc oficiales, los convierte a texto (textutil, incluido en macOS)
y los separa en unidades (artículos y bloques de transitorios) con su jerarquía
(Título › Capítulo › Sección…), fechas de reforma DOF y metadatos.

Salida: web/data/<SIGLAS>.json (uno por ordenamiento), web/data/catalogo.json y
web/data/reportes/validacion.txt.

Uso:
    python3 scripts/build_data.py --solo LISR              # una ley
    python3 scripts/build_data.py                          # todas las registradas
    python3 scripts/build_data.py --solo LISR --descargar  # re-descargar el .doc oficial

Nunca se completa ni corrige texto a mano: si algo no se extrae bien, el
reporte de validación lo marca con ⚠ para revisarlo contra el documento oficial.
"""
import argparse
import hashlib
import html.parser
import json
import re
import statistics
import subprocess
import sys
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = RAIZ / "fuentes"
SALIDA = RAIZ / "web" / "data"
REPORTES = SALIDA / "reportes"
IMAGENES_SALIDA = SALIDA / "img"
# Ubicación (revisada a mano) de las imágenes oficiales: tarifas y fórmulas que el
# documento de la Cámara publica como imagen y no como texto.
IMAGENES_CONFIG = RAIZ / "scripts" / "imagenes_oficiales.json"
# Fotos completas de cada versión (se guardan en el repositorio; no se publican)
HISTORICO = RAIZ / "historico"
VERSIONES = SALIDA / "versiones"

LEYESBIBLIO = "https://www.diputados.gob.mx/LeyesBiblio"

LEGISLACION = ["Fiscal", "Legislación fiscal"]

# Registro de ordenamientos. `archivo` es la ruta del .doc dentro de LeyesBiblio;
# `pdf` el documento oficial para consulta humana. Para actualizar una ley solo
# hay que volver a correr el script con --descargar (o cambiar aquí el archivo).
NORMAS = {
    "LISR": {
        "nombre": "Ley del Impuesto sobre la Renta",
        "tipo": "ley", "archivo": "doc/LISR.doc", "pdf": "pdf/LISR.pdf",
        "reglamento": "RLISR", "historial": "ref/lisr.htm",
    },
    "RLISR": {
        "nombre": "Reglamento de la Ley del Impuesto sobre la Renta",
        "tipo": "reglamento", "archivo": "regley/Reg_LISR_060516.doc",
        "pdf": "regley/Reg_LISR_060516.pdf", "ley_padre": "LISR",
    },
    "CFF": {
        "nombre": "Código Fiscal de la Federación",
        "tipo": "ley", "archivo": "doc/CFF.doc", "pdf": "pdf/CFF.pdf",
        "reglamento": "RCFF", "historial": "ref/cff.htm",
    },
    "RCFF": {
        "nombre": "Reglamento del Código Fiscal de la Federación",
        "tipo": "reglamento", "archivo": "regley/Reg_CFF.doc",
        "pdf": "regley/Reg_CFF.pdf", "ley_padre": "CFF",
    },
    "LIVA": {
        "nombre": "Ley del Impuesto al Valor Agregado",
        "tipo": "ley", "archivo": "doc/LIVA.doc", "pdf": "pdf/LIVA.pdf",
        "reglamento": "RLIVA", "historial": "ref/liva.htm",
    },
    "RLIVA": {
        "nombre": "Reglamento de la Ley del Impuesto al Valor Agregado",
        "tipo": "reglamento", "archivo": "regley/Reg_LIVA_250914.doc",
        "pdf": "regley/Reg_LIVA_250914.pdf", "ley_padre": "LIVA",
    },
    "LIF2026": {
        "nombre": "Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2026",
        "tipo": "ley", "archivo": "doc/LIF_2026.doc", "pdf": "pdf/LIF_2026.pdf",
    },
    "LIF2027": {
        "nombre": "Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2027",
        "tipo": "ley", "archivo": "doc/LIF_2027.doc", "pdf": "pdf/LIF_2027.pdf",
    },
}

# ---------------------------------------------------------------------------
# Expresiones regulares
# ---------------------------------------------------------------------------
_SUF = (r"(?:BIS|Bis|TER|Ter|QU[ÁA]TER|Qu[áa]ter|QUINQUIES|Quinquies|QUINTUS|Quintus|"
        r"SEXIES|Sexies|SEPTIES|Septies|OCTIES|Octies|NONIES|Nonies|DECIES|Decies)")
# 1, 1o, 2o.-A, 29-B, 17-H Bis, 111 Bis, 82-Ter, 1o.-A BIS
_NUM = rf"\d+o?(?:\.?-(?:{_SUF}|[A-Z]))?(?:\s{_SUF})?"
RE_ARTICULO = re.compile(rf"^Art[ií]culo\s+({_NUM})[.:]\s*-?\s*(.*)$")
# Conteo independiente, deliberadamente laxo (para la validación cruzada)
RE_ARTICULO_LAXO = re.compile(r"^Art[ií]culo\s+\d")

_ORD = (r"PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]|SEXT[OA]|S[ÉE]PTIM[OA]|"
        r"OCTAV[OA]|NOVEN[OA]|D[ÉE]CIM[OA](?:\s+(?:PRIMER[OA]|SEGUND[OA]|TERCER[OA]|CUART[OA]|QUINT[OA]))?|"
        r"[ÚU]NIC[OA]")
RE_DIVISION = re.compile(
    rf"^(T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N|APARTADO)\s+([IVXLCDM]+|\d+o?|{_ORD})\b\.?\s*(.*)$",
    re.IGNORECASE,
)
NIVELES = {"TITULO": "titulo", "CAPITULO": "capitulo", "SECCION": "seccion", "APARTADO": "apartado"}
ORDEN_NIVEL = {"titulo": 1, "capitulo": 2, "seccion": 3, "apartado": 4}
ETIQUETA_NIVEL = {"titulo": "Título", "capitulo": "Capítulo", "seccion": "Sección", "apartado": "Apartado",
                  "subseccion": "Subsección"}
# Documentos generados por otros extractores (scripts/build_rmf.py) que también van al catálogo
EXTRAS = ["RMF2026"]

# Notas oficiales al pie: "Párrafo reformado DOF 09-12-2019"
RE_ANOTACION = re.compile(
    r"(?:reformad|adicionad|derogad|recorrid|modificad)\w*[^\n]*?DOF\s+\d{2}-\d{2}-\d{4}",
    re.IGNORECASE,
)
RE_FECHA_DOF = re.compile(r"(\d{2})-(\d{2})-(\d{4})")

# Zona de transitorios y decretos
RE_TRANSITORIOS = re.compile(r"^(TRANSITORIOS?|Transitorios?)\s*$")
RE_DECRETOS = re.compile(r"^ART[ÍI]CULOS TRANSITORIOS DE DECRETOS DE REFORMA")
RE_DECRETO = re.compile(r"^DECRETO\b")
# Encabezados del decreto de expedición que aparecen tras el último artículo
# (p. ej. LISR: "DISPOSICIONES DE VIGENCIA TEMPORAL…", "ARTÍCULO OCTAVO.")
RE_ENCABEZADO_DECRETO = re.compile(
    r"^(DISPOSICIONES (DE VIGENCIA TEMPORAL|TRANSITORIAS)\b|"
    r"ART[ÍI]CULOS? (PRIMERO|SEGUNDO|TERCERO|CUARTO|QUINTO|SEXTO|S[ÉE]PTIMO|OCTAVO|NOVENO|D[ÉE]CIMO)\b)"
)

RE_ULTIMA_REFORMA = re.compile(r"[ÚU]ltima reforma publicada\s+DOF\s+(\d{2}-\d{2}-\d{4})")
RE_PUBLICACION = re.compile(
    r"[Pp]ublicad[oa] en el Diario Oficial de la Federaci[óo]n el (\d{1,2}) de (\w+) de (\d{4})"
)
MESES = {m: i for i, m in enumerate(
    "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(), 1)}

NOMBRES_PROPIOS = {
    "méxico": "México", "mexicanos": "Mexicanos", "federación": "Federación",
    "internet": "Internet", "ciudad de méxico": "Ciudad de México",
}


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
def sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def iso_dof(f: str) -> str:
    """'09-12-2019' → '2019-12-09'"""
    d, m, a = RE_FECHA_DOF.fullmatch(f).groups()
    return f"{a}-{m}-{d}"


def iso_texto(m: re.Match) -> str | None:
    dia, mes, anio = m.groups()
    n = MESES.get(mes.lower())
    return f"{anio}-{n:02d}-{int(dia):02d}" if n else None


def oracion(s: str) -> str:
    """Texto en MAYÚSCULAS → estilo oración ('DE LAS PERSONAS FÍSICAS' → 'De las personas físicas')."""
    s = s.strip()
    if not s.isupper():
        return s
    t = s.lower()
    for k, v in NOMBRES_PROPIOS.items():
        t = re.sub(rf"\b{k}\b", v, t)
    return t[:1].upper() + t[1:]


def ordinal_bonito(o: str) -> str:
    o = o.strip().rstrip(".")
    if re.fullmatch(r"[IVXLCDM]+", o):
        return o
    if re.fullmatch(r"\d+o?", o):
        return o
    return o.lower() if o.upper() in ("ÚNICO", "UNICO", "ÚNICA", "UNICA") else o.capitalize()


def id_unidad(siglas: str, numero: str) -> str:
    """('LIVA', '1o.-A') → 'liva-1-a';  ('CFF', '17-H Bis') → 'cff-17-h-bis'"""
    n = sin_acentos(numero).lower()
    n = re.sub(r"^(\d+)o\b", r"\1", n)          # 1o → 1
    n = re.sub(r"[^a-z0-9]+", "-", n).strip("-")
    return f"{siglas.lower()}-{n}"


def descargar(siglas: str) -> None:
    url = f"{LEYESBIBLIO}/{NORMAS[siglas]['archivo']}"
    print(f"  ↓ {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        (FUENTES / f"{siglas}.doc").write_bytes(r.read())


def convertir(siglas: str, formato: str = "txt") -> Path:
    """.doc → .txt (texto) o .html (para recuperar la estructura de las tablas)."""
    doc, salida = FUENTES / f"{siglas}.doc", FUENTES / f"{siglas}.{formato}"
    if salida.exists() and doc.exists() and salida.stat().st_mtime >= doc.stat().st_mtime:
        return salida
    if not doc.exists():
        sys.exit(f"No existe {doc}; corre con --descargar")
    try:
        subprocess.run(["textutil", "-convert", formato, str(doc), "-output", str(salida)],
                       check=True, capture_output=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        sys.exit(f"No pude convertir {doc.name}: 'textutil' solo existe en macOS.")
    return salida


# ---------------------------------------------------------------------------
# Tablas: el .txt pone cada celda en un renglón suelto; el .html conserva filas
# y columnas. Se busca cada tabla del HTML en el texto, celda por celda, y solo
# si coincide exactamente se sustituye por renglones "| celda | celda |".
# ---------------------------------------------------------------------------
def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(" ", " ")).strip()


class _LectorTablas(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.tablas, self._prof, self._fila, self._celda = [], 0, None, None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._prof += 1
            if self._prof == 1:
                self.tablas.append([])
        elif self._prof == 1 and tag == "tr":
            self._fila = []
        elif self._prof == 1 and tag == "td":
            self._celda = []
        elif self._celda is not None and tag in ("p", "br"):
            self._celda.append("\n")

    def handle_endtag(self, tag):
        if tag == "table":
            self._prof -= 1
        elif self._prof == 1 and tag == "td" and self._celda is not None:
            parrafos = [_norm(p) for p in "".join(self._celda).split("\n")]
            self._fila.append([p for p in parrafos if p])
            self._celda = None
        elif self._prof == 1 and tag == "tr" and self._fila is not None:
            self.tablas[-1].append(self._fila)
            self._fila = None

    def handle_data(self, data):
        if self._celda is not None:
            self._celda.append(data)


def insertar_tablas(lineas: list[str], html_path: Path) -> tuple[list[str], list[str]]:
    lector = _LectorTablas()
    lector.feed(html_path.read_text(encoding="utf-8", errors="replace"))
    avisos, pos, hechas = [], 0, 0
    tablas = [t for t in lector.tablas if any(p for fila in t for celda in fila for p in celda)]
    for n, tabla in enumerate(tablas, 1):
        parrafos = [p for fila in tabla for celda in fila for p in celda]

        def intentar(k):
            i = k
            for p in parrafos:
                while i < len(lineas) and not lineas[i].strip():
                    i += 1
                if i >= len(lineas) or _norm(lineas[i]) != p:
                    return None
                i += 1
            return i

        inicio = fin = None
        for k in range(pos, len(lineas)):
            if _norm(lineas[k]) == parrafos[0] and (fin := intentar(k)) is not None:
                inicio = k
                break
        if inicio is None:
            avisos.append(f"⚠ tabla {n} (empieza con «{parrafos[0][:50]}») no se localizó en el texto; "
                          f"se deja celda por renglón")
            continue
        filas = ["| " + " | ".join(" ".join(c).replace("|", "/") for c in fila) + " |" for fila in tabla]
        lineas[inicio:fin] = [""] + filas + [""]
        pos = inicio + len(filas) + 2
        hechas += 1
    avisos.insert(0, f"{'✓' if hechas == len(tablas) else '⚠'} tablas reconstruidas: {hechas} de {len(tablas)}")
    return lineas, avisos


# ---------------------------------------------------------------------------
# Imágenes oficiales (tarifas, fórmulas): se extraen tal cual del .doc y se
# colocan donde indica scripts/imagenes_oficiales.json. La "huella" MD5 asegura
# que si el documento cambia, el reporte lo marque en vez de poner una imagen
# equivocada.
# ---------------------------------------------------------------------------
def extraer_imagenes(siglas: str) -> list[bytes]:
    d = (FUENTES / f"{siglas}.doc").read_bytes()
    imgs, pos = [], 0
    while (i := d.find(b"\x89PNG\r\n\x1a\n", pos)) != -1:
        j = d.find(b"IEND", i)
        if j == -1:
            break
        imgs.append(d[i:j + 8])
        pos = j + 8
    return imgs


RE_HYPERLINK = re.compile(r'HYPERLINK\s+(?:"[^"]*"\s*)?(?:\\l\s*"[^"]*"\s*)?', re.I)
RE_RESIDUO_WORD = re.compile(r'HYPERLINK|MERGEFORMAT|INCLUDEPICTURE|EMBED Word|^import "http', re.I)

RE_NOTA_LINEA = re.compile(r"^\S.{0,200}(reformad|adicionad|derogad|recorrid)\w*.*DOF\s+\d{2}-\d{2}-\d{4}", re.I)


def insertar_imagenes(siglas: str, lineas: list[str]) -> tuple[list[str], list[str]]:
    imgs = extraer_imagenes(siglas)
    config = json.loads(IMAGENES_CONFIG.read_text(encoding="utf-8")).get(siglas, []) if IMAGENES_CONFIG.exists() else []
    avisos = []
    if not imgs and not config:
        return lineas, avisos
    IMAGENES_SALIDA.mkdir(parents=True, exist_ok=True)
    configuradas = {c["n"] for c in config}
    sin_config = [n for n in range(1, len(imgs) + 1) if n not in configuradas]
    if sin_config:
        avisos.append(f"⚠ imágenes del documento sin ubicar en imagenes_oficiales.json: {sin_config} "
                      f"(contenido que no está en el texto: revisar contra el PDF oficial)")
    for c in config:
        n = c["n"]
        if n > len(imgs):
            avisos.append(f"⚠ imagen {n}: el documento ya no tiene tantas imágenes")
            continue
        huella = hashlib.md5(imgs[n - 1]).hexdigest()
        if huella != c["md5"]:
            avisos.append(f"⚠ imagen {n} ({c.get('alt', '')}): cambió en el documento oficial (MD5 distinto); revisar")
            continue
        if c.get("omitir"):
            continue
        coincide = (lambda l: _norm(l) == c["ancla"]) if c.get("exacta") else (lambda l: c["ancla"] in _norm(l))
        apariciones = [k for k, l in enumerate(lineas) if coincide(l)]
        k_ocurr = c.get("ocurrencia", 1)
        if len(apariciones) < k_ocurr:
            avisos.append(f"⚠ imagen {n} ({c['alt']}): no se encontró el párrafo «{c['ancla'][:60]}»")
            continue
        a = apariciones[k_ocurr - 1]
        if "reemplazar_ancla" in c:   # corrección verificada contra el PDF oficial (ver "nota" en la config)
            lineas[a] = c["reemplazar_ancla"]
            avisos.append(f"  imagen {n}: renglón «{c['ancla']}» corregido a «{c['reemplazar_ancla']}» — {c.get('nota', '')}")
        k = a + 1
        # Si al párrafo le sigue su nota "Párrafo reformado DOF…", la imagen va después de la nota
        sig = next((j for j in range(k, min(k + 4, len(lineas))) if lineas[j].strip()), None)
        if sig is not None and RE_NOTA_LINEA.match(lineas[sig].strip()):
            k = sig + 1
        nombre = f"{siglas}-{n:02d}.png"
        (IMAGENES_SALIDA / nombre).write_bytes(imgs[n - 1])
        lineas[k:k] = ["", f"[[imagen:img/{nombre}|{c['alt']}{'|chica' if c.get('chica') else ''}]]", ""]
    colocadas = sum(1 for c in config if not c.get("omitir")) - sum(1 for a in avisos if a.startswith("⚠ imagen"))
    avisos.insert(0, f"{'✓' if not any(a.startswith('⚠') for a in avisos) else '⚠'} imágenes oficiales: "
                     f"{len(imgs)} en el documento, {colocadas} colocadas, "
                     f"{sum(1 for c in config if c.get('omitir'))} omitidas (decorativas o duplicadas)")
    return lineas, avisos


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------
def leer_encabezado(lineas: list[str], i: int) -> tuple[str | None, int]:
    """Busca el nombre de una división en las líneas siguientes. Devuelve (nombre, último índice usado)."""
    j = i + 1
    while j < len(lineas):
        cand = lineas[j].replace("\t", " ").strip()
        if not cand or RE_ANOTACION.search(cand):
            j += 1
            continue
        if (len(cand) < 400 and not RE_DIVISION.match(cand) and not RE_ARTICULO.match(cand)
                and not RE_TRANSITORIOS.match(cand) and not cand.endswith((".", ":", ";"))):
            return cand, j
        return None, i
    return None, i


def parsear(siglas: str, lineas: list[str]) -> tuple[dict, dict]:
    reg = NORMAS[siglas]
    fuente = f"{LEYESBIBLIO}/{reg['pdf']}"
    meta = {
        "siglas": siglas, "nombre": reg["nombre"], "tipo": reg["tipo"],
        "materia": LEGISLACION, "estatus": "vigente",
        "publicacion": None, "ultima_reforma": None,
        "fuente": fuente, "fuente_doc": f"{LEYESBIBLIO}/{reg['archivo']}",
        "ley_padre": reg.get("ley_padre"), "reglamento": reg.get("reglamento"),
    }
    for linea in lineas[:40]:
        if m := RE_ULTIMA_REFORMA.search(linea):
            meta["ultima_reforma"] = iso_dof(m.group(1))
        if meta["publicacion"] is None and (m := RE_PUBLICACION.search(linea)):
            meta["publicacion"] = iso_texto(m)

    unidades: list[dict] = []
    diag = {"sin_nombre": [], "omitidas": [], "linea_zona_trans": None}
    ruta: dict[str, dict] = {}
    actual = None
    bloque = None          # bloque de transitorios/decreto en construcción
    en_trans = False

    def ruta_lista():
        return [ruta[n] for n in sorted(ruta, key=ORDEN_NIVEL.get)]

    def cerrar_articulo():
        nonlocal actual
        if actual is None:
            return
        texto = "\n".join(actual["lineas"]).strip()
        fechas = sorted({iso_dof(f"{d}-{m}-{a}") for ln in actual["lineas"] if RE_ANOTACION.search(ln)
                         for d, m, a in RE_FECHA_DOF.findall(ln)})
        r = actual["ruta"]
        def etiqueta(nivel):
            for x in r:
                if x["nivel"] == nivel:
                    return x["etiqueta"] + (f" — {x['nombre']}" if x["nombre"] else "")
            return None
        unidades.append({
            "id": id_unidad(siglas, actual["numero"]),
            "ley": siglas, "unidad": "articulo", "numero": actual["numero"],
            "titulo": etiqueta("titulo"), "capitulo": etiqueta("capitulo"),
            "seccion": etiqueta("seccion"), "ruta": r,
            "texto": texto, "reformas": fechas,
            "ultima_reforma": fechas[-1] if fechas else None,
            "fuente": fuente, "referencias": [],
            "_linea": actual["linea"],
        })
        actual = None

    def abrir_bloque(titulo: str, linea_idx: int):
        nonlocal bloque
        cerrar_bloque()
        bloque = {"titulo": titulo, "lineas": [], "fecha": None, "linea": linea_idx}

    def cerrar_bloque():
        nonlocal bloque
        if bloque is None:
            return
        texto = "\n".join(bloque["lineas"]).strip()
        if texto:
            n = sum(1 for u in unidades if u["unidad"] == "transitorio") + 1
            unidades.append({
                "id": f"{siglas.lower()}-transitorios-{n}",
                "ley": siglas, "unidad": "transitorio", "numero": f"Transitorios {n}",
                "titulo": None, "capitulo": None, "seccion": None,
                "ruta": [{"nivel": "transitorios", "etiqueta": "Transitorios y decretos de reforma", "nombre": None}],
                "titulo_decreto": bloque["titulo"],
                "fecha_publicacion": bloque["fecha"],
                "texto": texto, "reformas": [], "ultima_reforma": None,
                "fuente": fuente, "referencias": [],
                "_linea": bloque["linea"],
            })
        bloque = None

    i = 0
    while i < len(lineas):
        crudo = lineas[i]
        linea = crudo.replace("\t", " ").rstrip()

        # ---- Zona de transitorios: cada decreto es un bloque completo ----
        if en_trans:
            if RE_DECRETOS.match(linea):
                cerrar_bloque()
            elif RE_DECRETO.match(linea):
                abrir_bloque(linea.strip(), i)
            elif linea:
                if bloque is None:
                    abrir_bloque("Transitorios", i)
                if bloque["fecha"] is None and (m := RE_PUBLICACION.search(linea)):
                    bloque["fecha"] = iso_texto(m)
                bloque["lineas"].append(linea)
            i += 1
            continue

        es_inicio_trans = RE_TRANSITORIOS.match(linea) or RE_DECRETOS.match(linea)
        # Encabezados del decreto de expedición pegados tras el último artículo
        es_decreto_expedicion = (unidades or actual) and RE_ENCABEZADO_DECRETO.match(linea)
        if es_inicio_trans or es_decreto_expedicion:
            cerrar_articulo()
            en_trans = True
            diag["linea_zona_trans"] = i
            if es_decreto_expedicion:
                abrir_bloque("Disposiciones del decreto de expedición", i)
                bloque["fecha"] = meta["publicacion"]
                bloque["lineas"].append(linea)
            elif RE_TRANSITORIOS.match(linea):
                abrir_bloque("Transitorios del decreto de expedición", i)
                bloque["fecha"] = meta["publicacion"]
                bloque["lineas"].append(linea)
            i += 1
            continue

        # ---- Divisiones: Título / Capítulo / Sección / Apartado ----
        if m := RE_DIVISION.match(linea):
            marcador, ordinal, resto = m.groups()
            resto = resto.strip()
            if resto and (len(resto) > 200 or resto[:1].islower()):
                # "Capítulo II de esta Ley…": es texto, no encabezado
                if actual is not None:
                    actual["lineas"].append(linea)
                i += 1
                continue
            cerrar_articulo()
            nivel = NIVELES[sin_acentos(marcador).upper()]
            nombre = resto or None
            if not nombre:
                nombre, i = leer_encabezado(lineas, i)
            if not nombre:
                diag["sin_nombre"].append((i + 1, linea.strip()))
            ruta[nivel] = {
                "nivel": nivel,
                "etiqueta": f"{ETIQUETA_NIVEL[nivel]} {ordinal_bonito(ordinal)}",
                "nombre": oracion(nombre) if nombre else None,
            }
            for n in list(ruta):
                if ORDEN_NIVEL[n] > ORDEN_NIVEL[nivel]:
                    del ruta[n]
            i += 1
            continue

        # ---- Artículos ----
        if m := RE_ARTICULO.match(linea):
            numero, resto = m.groups()
            sig = next((l.strip() for l in lineas[i + 1:i + 4] if l.strip()), "")
            es_celda_tabla = not resto and re.fullmatch(r"[\d.,\s]+", sig or "0")
            if "\t" in crudo or resto.lstrip()[:1] in {",", ";"} or es_celda_tabla:
                diag["omitidas"].append((i + 1, linea[:90], "fila de tabla o referencia"))
                if actual is not None:
                    actual["lineas"].append(linea)
                i += 1
                continue
            cerrar_articulo()
            actual = {"numero": numero.strip(), "ruta": ruta_lista(),
                      "lineas": [resto] if resto else [], "linea": i + 1}
            i += 1
            continue

        if actual is not None and linea:
            actual["lineas"].append(linea)
        i += 1

    cerrar_articulo()
    cerrar_bloque()

    meta["generado"] = date.today().isoformat()
    meta["num_articulos"] = sum(1 for u in unidades if u["unidad"] == "articulo")
    meta["num_transitorios"] = sum(1 for u in unidades if u["unidad"] == "transitorio")
    meta["estructura"] = construir_estructura(unidades)
    return {"ley": meta, "unidades": unidades}, diag


def construir_estructura(unidades: list[dict]) -> list[dict]:
    """Árbol de divisiones para la navegación: [{etiqueta, nombre, hijos, unidades:[ids]}]."""
    raiz: list[dict] = []
    for u in unidades:
        nivel_actual = raiz
        nodo = None
        for paso in u["ruta"]:
            nodo = next((n for n in nivel_actual if n["etiqueta"] == paso["etiqueta"]
                         and n["nombre"] == paso["nombre"]), None)
            if nodo is None:
                nodo = {"nivel": paso["nivel"], "etiqueta": paso["etiqueta"], "nombre": paso["nombre"],
                        "hijos": [], "unidades": []}
                nivel_actual.append(nodo)
            nivel_actual = nodo["hijos"]
        if nodo is None:
            nodo = next((n for n in raiz if n["nivel"] == "sin_division"), None)
            if nodo is None:
                nodo = {"nivel": "sin_division", "etiqueta": "Articulado", "nombre": None,
                        "hijos": [], "unidades": []}
                raiz.append(nodo)
        nodo["unidades"].append(u["id"])
    return raiz


# ---------------------------------------------------------------------------
# Validación
# ---------------------------------------------------------------------------
def validar(datos: dict, diag: dict, lineas: list[str]) -> list[str]:
    arts = [u for u in datos["unidades"] if u["unidad"] == "articulo"]
    trans = [u for u in datos["unidades"] if u["unidad"] == "transitorio"]
    r = [f"{len(arts)} artículos + {len(trans)} bloques de transitorios/decretos"]

    # 1. Conteo independiente: líneas "Artículo <número>" en la zona del articulado
    fin = diag["linea_zona_trans"] or len(lineas)
    inicio = min((u["_linea"] for u in arts), default=1) - 1
    laxas = [k for k in range(inicio, fin) if RE_ARTICULO_LAXO.match(lineas[k].strip())]
    omitidas = {n for n, *_ in diag["omitidas"]}
    capturadas = {u["_linea"] for u in arts}
    sin_explicar = [k + 1 for k in laxas if (k + 1) not in capturadas and (k + 1) not in omitidas]
    if sin_explicar:
        r.append(f"⚠ conteo independiente: {len(laxas)} líneas 'Artículo N' vs {len(arts)} extraídos; "
                 f"sin explicar en líneas {sin_explicar[:15]}")
    else:
        r.append(f"✓ conteo independiente coincide ({len(laxas)} líneas 'Artículo N' = {len(arts)} "
                 f"extraídos + {len(omitidas)} filas de tabla/referencias descartadas)")

    # 2. Numeración: duplicados y huecos
    ids = [u["id"] for u in arts]
    dup = sorted({x for x in ids if ids.count(x) > 1})
    r.append(f"⚠ números duplicados: {dup}" if dup else "✓ sin números duplicados")
    enteros = sorted({int(m.group()) for u in arts if (m := re.match(r"\d+", u["numero"]))})
    if enteros:
        faltan = [n for n in range(enteros[0], enteros[-1] + 1) if n not in enteros]
        r.append(f"⚠ números ausentes en la secuencia: {faltan}" if faltan
                 else f"✓ secuencia completa {enteros[0]}–{enteros[-1]}")
    especiales = [u["numero"] for u in arts if not re.fullmatch(r"\d+o?", u["numero"])]
    if especiales:
        r.append(f"  artículos con letra/Bis ({len(especiales)}): {', '.join(especiales)}")

    # 3. Transitorios mezclados con artículos
    mezclados = [u["numero"] for u in arts
                 if any(RE_ENCABEZADO_DECRETO.match(l) or RE_DECRETO.match(l) or RE_TRANSITORIOS.match(l)
                        for l in u["texto"].split("\n"))]
    r.append(f"⚠ artículos con texto de decretos/transitorios dentro: {mezclados}" if mezclados
             else "✓ ningún artículo contiene transitorios o decretos")
    # Solo los decretos de reforma (zona final); el "DECRETO" del preámbulo no cuenta
    decretos_fuente = sum(1 for l in lineas[fin:] if RE_DECRETO.match(l))
    decretos_bloques = sum(1 for u in trans if u["titulo_decreto"].startswith("DECRETO"))
    r.append(f"{'✓' if decretos_fuente == decretos_bloques else '⚠'} decretos de reforma: "
             f"{decretos_bloques} bloques / {decretos_fuente} encabezados 'DECRETO' en la fuente")

    # 3b. Residuos de códigos internos de Word que no son texto de la ley
    residuos = [u["numero"] for u in datos["unidades"]
                if any(RE_RESIDUO_WORD.search(l) for l in u["texto"].split("\n"))]
    r.append(f"⚠ residuos de códigos de Word en: {residuos}" if residuos
             else "✓ sin residuos de códigos de Word")

    # 4. Vacíos y tamaños anómalos
    vacios = [u["numero"] for u in arts if not u["texto"]]
    if vacios:
        r.append(f"⚠ artículos sin texto: {vacios}")
    if arts:
        mediana = statistics.median(len(u["texto"]) for u in arts)
        grandes = [f"{u['numero']} ({len(u['texto']):,} car.)" for u in arts if len(u["texto"]) > 5 * mediana]
        if grandes:
            r.append(f"  revisar a mano (> 5× la mediana de {int(mediana):,} car.): {', '.join(grandes)}")

    # 5. Divisiones sin nombre (algunas no lo tienen en el texto oficial)
    for linea, etiqueta in diag["sin_nombre"]:
        r.append(f"  división sin nombre en el texto oficial (línea {linea}): {etiqueta}")

    # 6. Fechas
    r.append(f"  publicación: {datos['ley']['publicacion']} · última reforma: {datos['ley']['ultima_reforma']} · "
             f"artículos con fecha de reforma: {sum(1 for u in arts if u['ultima_reforma'])}")
    return r


# ---------------------------------------------------------------------------
# Reformas publicadas en el DOF que la Cámara de Diputados aún no integra al texto
# ---------------------------------------------------------------------------
DECRETOS = FUENTES / "decretos"
RE_HIST_ENTRADA = re.compile(r'href="([^"]+\.pdf)"[^>]*>\s*DOF\s*(\d{2})[-/](\d{2})[-/](\d{4})\s*</a>', re.I)
RE_VIGOR = re.compile(r"entrará en vigor (?:el|a partir del) (\d{1,2})o? de (\w+) de (\d{4})", re.I)
RE_CONTINUA = re.compile(r"^(?:[IVXLC]+\.(?:\s+(?:a|y)\s+[IVXLC]+\.)?|[a-z]\)(?:\s+(?:a|y)\s+[a-z]\))?)?\s*(?:\.\.\.|…)\s*$")


def historial_reformas(siglas: str, descargar_de_nuevo: bool) -> list[dict]:
    """Entradas 'DOF dd-mm-aaaa' de la página de historial de LeyesBiblio (ref/xxx.htm)."""
    pag = NORMAS[siglas].get("historial")
    if not pag:
        return []
    destino = FUENTES / f"historial_{siglas}.htm"
    if descargar_de_nuevo or not destino.exists():
        req = urllib.request.Request(f"{LEYESBIBLIO}/{pag}", headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales)"})
        with urllib.request.urlopen(req, timeout=120) as r:
            destino.write_bytes(r.read())
    h = destino.read_text(encoding="latin-1")
    base = f"{LEYESBIBLIO}/{pag.rsplit('/', 1)[0]}/"
    entradas = []
    for url, d, m, a in RE_HIST_ENTRADA.findall(h):
        nombre = url.rsplit("/", 1)[-1].lower()
        tipo = ("original" if "_orig" in nombre else "cantidades" if "_cant" in nombre else
                "sentencia" if "_sent" in nombre else "fe de erratas" if "_fe" in nombre else "reforma")
        entradas.append({"fecha": f"{a}-{m}-{d}", "tipo": tipo, "pdf": base + url, "doc": base + url[:-4] + ".doc"})
    return entradas


def reformas_pendientes(siglas: str, datos: dict, descargar_de_nuevo: bool) -> list[str]:
    """Decretos posteriores a la última reforma del texto compilado: aviso por artículo con el extracto
    oficial; artículos nuevos completos; disposiciones transitorias del decreto como bloque propio."""
    ley = datos["ley"]
    ultima = ley.get("ultima_reforma") or ley.get("publicacion") or "0000"
    nuevas = [e for e in historial_reformas(siglas, descargar_de_nuevo) if e["fecha"] > ultima and e["tipo"] != "original"]
    ley["pendientes"] = []
    if not nuevas:
        return ["✓ sin reformas publicadas pendientes de integrar" if NORMAS[siglas].get("historial") else
                "  (sin página de historial en LeyesBiblio; no se revisan reformas pendientes)"]
    DECRETOS.mkdir(parents=True, exist_ok=True)
    avisos = []
    por_id = {u["id"]: u for u in datos["unidades"]}
    for e in sorted(nuevas, key=lambda x: x["fecha"]):
        titulo_doc = f"Decreto de reforma DOF {e['fecha'][8:]}-{e['fecha'][5:7]}-{e['fecha'][:4]}"
        ley["pendientes"].append({"titulo": titulo_doc, "fecha": e["fecha"], "url": e["pdf"], "tipo": e["tipo"]})
        if e["tipo"] != "reforma":
            avisos.append(f"⚠ {e['tipo']} DOF {e['fecha']} posterior al texto compilado (revisar a mano): {e['pdf']}")
            continue
        doc = DECRETOS / e["doc"].rsplit("/", 1)[-1]
        if descargar_de_nuevo or not doc.exists():
            req = urllib.request.Request(e["doc"], headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                doc.write_bytes(r.read())
        txt = doc.with_suffix(".txt")
        subprocess.run(["textutil", "-convert", "txt", str(doc), "-output", str(txt)], check=True, capture_output=True)
        lineas = [l.replace("\t", " ").rstrip() for l in txt.read_text(encoding="utf-8").splitlines()]
        # quitar encabezados/pies de página del DOF (residuos de Word)
        lineas = [l for l in lineas if not re.search(r"MERGEFORMAT|EMBED Word|NUMPAGES", l)]
        texto_completo = "\n".join(lineas)
        vigor = RE_VIGOR.search(texto_completo)
        en_vigor = f"{vigor.group(3)}-{MESES.get(vigor.group(2).lower(), 0):02d}-{int(vigor.group(1)):02d}" if vigor else None
        estado = ("publicado en el DOF; la Cámara de Diputados aún no publica el texto actualizado de la ley"
                  + (f"; entra en vigor el {int(vigor.group(1))} de {vigor.group(2)} de {vigor.group(3)}" if vigor else ""))
        ley["pendientes"][-1]["en_vigor"] = en_vigor

        # Zona "para quedar como sigue:" → extractos por artículo
        ini = next((k for k, l in enumerate(lineas) if "para quedar como sigue" in l), None)
        if ini is None:
            avisos.append(f"⚠ {titulo_doc}: no se encontró el texto reformado («para quedar como sigue»)")
            continue
        fin = next((k for k in range(ini + 1, len(lineas))
                    if re.match(r"^(DISPOSICIONES|Artículo (Segundo|Tercero|Cuarto|Quinto)\.-|ARTÍCULO (SEGUNDO|TERCERO)|TRANSITORIOS?$|Transitorios?$)",
                                lineas[k].strip())), len(lineas))
        extractos, actual, encabezado, encab_actual = {}, None, None, None
        k = ini + 1
        while k < fin:
            l = lineas[k].strip()
            if (m := RE_DIVISION.match(l)) and not RE_ARTICULO.match(l):
                nombre, k2 = leer_encabezado(lineas, k)
                nivel = NIVELES[sin_acentos(m.group(1)).upper()]
                encabezado = {"nivel": nivel, "etiqueta": f"{ETIQUETA_NIVEL[nivel]} {ordinal_bonito(m.group(2))}",
                              "nombre": oracion(nombre) if nombre and nombre.lower() != "derogado" else nombre}
                k = k2 + 1
                continue
            if m := RE_ARTICULO.match(l):
                actual = m.group(1).strip()
                extractos[actual] = {"lineas": [m.group(2)] if m.group(2) else [], "encabezado": encabezado}
                encabezado = None
            elif actual and l:
                extractos[actual]["lineas"].append(l)
            k += 1

        n_mod = n_nuevos = n_derog = 0
        for numero, x in extractos.items():
            texto = "\n".join(x["lineas"]).strip()
            derogado = bool(re.fullmatch(r"\(?(?:Se deroga|Derogado)\)?\.?", texto, re.I))
            completo = not any(RE_CONTINUA.match(l) or l.strip() in ("...", "…") for l in x["lineas"])
            uid = id_unidad(siglas, numero)
            aviso = {"documento": titulo_doc, "fecha": e["fecha"], "url": e["pdf"], "estado": estado,
                     "en_vigor": en_vigor, "titulo_regla": "", "texto": "Este artículo se deroga." if derogado else texto,
                     "derogada": derogado}
            if uid in por_id:
                por_id[uid].setdefault("pendientes", []).append(aviso)
                n_derog += derogado
                n_mod += not derogado
            elif completo and not derogado:
                # artículo nuevo: se ubica junto al artículo base (78-A después del 78)
                base = re.match(r"\d+", numero).group()
                vecinos = [i for i, u in enumerate(datos["unidades"])
                           if u["unidad"] == "articulo" and re.match(r"\d+", u["numero"]).group() == base]
                pos = (vecinos[-1] + 1) if vecinos else len([u for u in datos["unidades"] if u["unidad"] == "articulo"])
                ref = datos["unidades"][vecinos[-1]] if vecinos else None
                ruta = list(ref["ruta"]) if ref else []
                if x["encabezado"]:
                    nivel_n = ORDEN_NIVEL[x["encabezado"]["nivel"]]
                    ruta = [r for r in ruta if ORDEN_NIVEL.get(r["nivel"], 9) < nivel_n] + [x["encabezado"]]
                elif extractos and ref is None:
                    ruta = []
                # los artículos siguientes del mismo bloque heredan el capítulo nuevo
                previo = datos["unidades"][pos - 1] if pos > 0 else None
                if not x["encabezado"] and previo and previo.get("nueva_en") and \
                        re.match(r"\d+", previo["numero"]).group() == base:
                    ruta = list(previo["ruta"])
                etiqueta = lambda nivel: next((f"{r['etiqueta']} — {r['nombre']}" for r in ruta if r["nivel"] == nivel and r["nombre"]), None)
                nueva = {"id": uid, "ley": siglas, "unidad": "articulo", "numero": numero,
                         "titulo": etiqueta("titulo"), "capitulo": etiqueta("capitulo"), "seccion": etiqueta("seccion"),
                         "ruta": ruta, "texto": texto, "reformas": [e["fecha"]], "ultima_reforma": e["fecha"],
                         "fuente": e["pdf"], "referencias": [], "nueva_en": aviso}
                datos["unidades"].insert(pos, nueva)
                por_id[uid] = nueva
                n_nuevos += 1
            else:
                avisos.append(f"⚠ {titulo_doc}: artículo {numero} no existe en el texto y el extracto no está completo")

        # Disposiciones transitorias y de vigencia del decreto (todo lo posterior a la zona reformada)
        resto = [l for l in lineas[fin:] if l.strip()]
        if resto:
            n = sum(1 for u in datos["unidades"] if u["unidad"] == "transitorio") + 1
            datos["unidades"].append({
                "id": f"{siglas.lower()}-transitorios-{n}", "ley": siglas, "unidad": "transitorio",
                "numero": f"Transitorios {n}", "titulo": None, "capitulo": None, "seccion": None,
                "ruta": [{"nivel": "transitorios", "etiqueta": "Transitorios y decretos de reforma", "nombre": None}],
                "titulo_decreto": next((l.strip() for l in lineas if l.strip().startswith("DECRETO")), titulo_doc),
                "fecha_publicacion": e["fecha"], "texto": "\n".join(resto), "reformas": [], "ultima_reforma": None,
                "fuente": e["pdf"], "referencias": [],
                "nueva_en": {"documento": titulo_doc, "fecha": e["fecha"], "url": e["pdf"], "estado": estado, "en_vigor": en_vigor},
            })
        avisos.append(f"⚠ {titulo_doc} aún no integrado al texto de la Cámara: {n_mod} artículos con aviso, "
                      f"{n_nuevos} nuevos agregados completos, {n_derog} derogados"
                      + (f"; entra en vigor el {en_vigor}" if en_vigor else ""))
    datos["ley"]["estructura"] = construir_estructura(datos["unidades"])
    return avisos


# ---------------------------------------------------------------------------
# Verificación cruzada contra el PDF oficial (fuente independiente del .doc)
# ---------------------------------------------------------------------------
def _norm_cotejo(s: str) -> str:
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"\[\[imagen:[^\]]*\]\]|\|", " ", s)
    s = re.sub(r"[^\wáéíóúüñÁÉÍÓÚÜÑ%$.,;:()-]+", " ", s)
    s = re.sub(r"\s*-\s+|\s+-", "-", s)      # guiones de corte de línea / "5o. -D" del PDF
    return re.sub(r"\s+", " ", s).strip().lower()


# El lector de PDF separa las etiquetas de listas numeradas ("I. II. Que…"), así que
# el cotejo compara cada párrafo sin su etiqueta de fracción/inciso/numeral.
RE_ETIQUETA_LISTA = re.compile(r"^(?:[IVXLC]+\.|[a-zñ]\)|\d{1,2}\.)\s+")


def verificar_pdf(siglas: str, datos: dict) -> list[str]:
    pdf = FUENTES / f"{siglas}.pdf"
    txt = FUENTES / f"{siglas}.pdf.txt"
    if not pdf.exists():
        url = f"{LEYESBIBLIO}/{NORMAS[siglas]['pdf']}"
        print(f"  ↓ {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales)"})
        with urllib.request.urlopen(req, timeout=180) as r:
            pdf.write_bytes(r.read())
    if not txt.exists() or txt.stat().st_mtime < pdf.stat().st_mtime:
        try:
            with open(txt, "w", encoding="utf-8") as f:
                subprocess.run(["swift", str(RAIZ / "scripts" / "pdf_a_texto.swift"), str(pdf)],
                               stdout=f, check=True, timeout=600)
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return ["⚠ no se pudo leer el PDF oficial (requiere 'swift' de macOS); verificación omitida"]
    lineas = txt.read_text(encoding="utf-8").splitlines()
    # Encabezados y pies de página: renglones que aparecen junto al número de página ("13 de 16")
    # en al menos la mitad de las páginas. (No basta "se repite mucho": las notas
    # "Párrafo reformado DOF…" o "Artículo derogado DOF…" también se repiten.)
    marcas = [k for k, l in enumerate(lineas) if re.fullmatch(r"\s*\d+ de \d+\s*", l)]
    cerca: dict[str, int] = {}
    for k in marcas:
        for l in {lineas[j].strip() for j in range(max(0, k - 7), min(len(lineas), k + 8))}:
            cerca[l] = cerca.get(l, 0) + 1
    encabezados = {l for l, c in cerca.items() if l and len(l) < 120 and c >= max(3, len(marcas) // 2)}
    limpio = [l for l in lineas if l.strip() not in encabezados and not re.fullmatch(r"\s*\d+ de \d+\s*", l)]
    texto_pdf = _norm_cotejo(" ".join(limpio))
    malos = []
    arts = [u for u in datos["unidades"] if u["unidad"] == "articulo"]
    for u in arts:
        for l in u["texto"].split("\n"):
            p = _norm_cotejo(RE_ETIQUETA_LISTA.sub("", l.strip()))
            if len(p) > 20 and not l.startswith(("|", "[[")) and p not in texto_pdf:
                malos.append(f"{u['numero']}: «{l.strip()[:80]}»")
                break
    if malos:
        return [f"⚠ cotejo con PDF oficial: {len(malos)} artículos con párrafos que no aparecen igual en el PDF"] + \
               [f"    {m}" for m in malos[:20]]
    return [f"✓ cotejo con PDF oficial: los {len(arts)} artículos aparecen palabra por palabra en el PDF"]


# ---------------------------------------------------------------------------
# Versiones: una "foto" del texto por versión y, para el sitio, solo lo que cambió
# ---------------------------------------------------------------------------
def guardar_version(siglas: str, clave: str, etiqueta: str, fuente: str, unidades: list[dict]) -> None:
    """Foto completa del texto (artículos/reglas/glosario) de una versión. 'clave' = fecha AAAA-MM-DD."""
    def sin_tablas(u):
        # texto sin las tablas que el PDF desarma (el renglón de referencias no entra en la comparación)
        quitar = set(u.get("tablas_pdf", []))
        texto = "\n".join(p for i, p in enumerate(u["texto"].split("\n")) if i not in quitar)
        return texto
    textos = {u["id"]: sin_tablas(u) for u in unidades
              if u["unidad"] in ("articulo", "regla", "glosario") and not u.get("nueva_en")}
    destino = HISTORICO / siglas / f"{clave}.json"
    destino.parent.mkdir(parents=True, exist_ok=True)
    previo = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    titulos = {u["id"]: u["titulo_regla"] for u in unidades if u.get("titulo_regla") and u["unidad"] == "regla"}
    destino.write_text(json.dumps({"version": clave, "etiqueta": etiqueta, "fuente": fuente,
                                   "capturado": previo.get("capturado", date.today().isoformat()),
                                   "textos": textos, "titulos": titulos}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _comparable(s: str) -> str:
    """Texto para decidir si cambió: sin ningún espacio. Un cambio real siempre toca letras o números;
    así no cuentan los cortes de renglón distintos ("1o. -A" contra "1o.-A", direcciones web partidas)."""
    return re.sub(r"\s+", "", s or "")


def generar_versiones(siglas: str) -> str | None:
    """web/data/versiones/<SIGLAS>.json: lista de versiones y, de cada versión anterior, solo los textos que
    difieren de la versión actual (null = la unidad no existía en esa versión)."""
    carpeta = HISTORICO / siglas
    fotos = sorted(carpeta.glob("*.json")) if carpeta.exists() else []
    if not fotos:
        return None
    versiones = [json.loads(f.read_text(encoding="utf-8")) for f in fotos]
    actual = versiones[-1]
    salida = {"actual": actual["version"], "versiones": [], "cambios": {}}
    for v in versiones:
        salida["versiones"].append({"clave": v["version"], "etiqueta": v["etiqueta"], "fuente": v["fuente"]})
        if v is actual:
            continue
        cambios = {}
        for uid, texto in actual["textos"].items():
            viejo = v["textos"].get(uid)
            if viejo is None:
                cambios[uid] = None
            elif _comparable(viejo) != _comparable(texto):
                cambios[uid] = viejo
        for uid, viejo in v["textos"].items():       # unidades que ya no existen en la versión actual
            if uid not in actual["textos"]:
                cambios[uid] = viejo
        salida["cambios"][v["version"]] = cambios
    VERSIONES.mkdir(parents=True, exist_ok=True)
    (VERSIONES / f"{siglas}.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    resumen = ", ".join(f"{k}: {len(c)} cambiadas" for k, c in salida["cambios"].items())
    return f"{len(versiones)} versión(es) guardada(s)" + (f" · respecto a la actual → {resumen}" if resumen else "")


def generar_versiones_todas() -> None:
    print("\n=== Versiones guardadas ===")
    for s in list(NORMAS) + EXTRAS:
        if (r := generar_versiones(s)):
            print(f"  {s:8} {r}")


# ---------------------------------------------------------------------------
def actualizar_catalogo() -> None:
    catalogo = []
    for siglas in list(NORMAS) + EXTRAS:
        f = SALIDA / f"{siglas}.json"
        if f.exists():
            datos = json.loads(f.read_text(encoding="utf-8"))
            ley = datos["ley"]
            # clave de URL → número oficial, para nombrar correlaciones sin descargar la ley completa
            numeros = {u["id"][len(siglas) + 1:]: (u["numero"] if u["unidad"] != "transitorio"
                                                   else f"Transitorios {u.get('fecha_publicacion') or ''}".strip())
                       for u in datos["unidades"]}
            fotos = sorted((HISTORICO / siglas).glob("*.json")) if (HISTORICO / siglas).exists() else []
            catalogo.append({k: v for k, v in ley.items() if k != "estructura"} |
                            {"archivo": f.name, "numeros": numeros, "num_versiones": len(fotos)})
    (SALIDA / "catalogo.json").write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding="utf-8")


def enlazar_todas() -> None:
    """Hipervínculos entre artículos de TODAS las leyes cargadas (ver scripts/referencias.py)."""
    sys.path.insert(0, str(RAIZ / "scripts"))
    import referencias

    leyes = {s: json.loads((SALIDA / f"{s}.json").read_text(encoding="utf-8"))
             for s in list(NORMAS) + EXTRAS if (SALIDA / f"{s}.json").exists()}
    stats, no_resueltas = referencias.enlazar(leyes)
    for s, datos in leyes.items():
        (SALIDA / f"{s}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    referencias.escribir_reporte(REPORTES / "referencias_no_resueltas.csv", no_resueltas)
    print("\n=== Hipervínculos entre artículos ===")
    motivos: dict[str, int] = {}
    for _, _, motivo, _ in no_resueltas:
        clave = re.sub(r"artículo \S+ no existe", "artículo no existe", motivo)
        motivos[clave] = motivos.get(clave, 0) + 1
    for s, st in stats.items():
        print(f"  {s:8} {st['enlaces']:5} vínculos · {st['no_resueltas']:4} referencias sin resolver")
    print("  Sin resolver, por motivo (detalle en reportes/referencias_no_resueltas.csv):")
    for m, n in sorted(motivos.items(), key=lambda x: -x[1]):
        print(f"    {n:5}  {m}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--descargar", action="store_true", help="re-descargar los .doc oficiales")
    ap.add_argument("--solo", metavar="SIGLAS", action="append", help="procesar solo esta(s) ley(es)")
    ap.add_argument("--pdf", action="store_true",
                    help="cotejar cada artículo contra el PDF oficial (más lento; recomendado al actualizar)")
    args = ap.parse_args()

    claves = args.solo or list(NORMAS)
    for c in claves:
        if c not in NORMAS:
            sys.exit(f"Ordenamiento desconocido: {c}. Opciones: {', '.join(NORMAS)}")

    for d in (FUENTES, SALIDA, REPORTES):
        d.mkdir(parents=True, exist_ok=True)

    hubo_avisos = False
    for siglas in claves:
        print(f"\n=== {siglas}: {NORMAS[siglas]['nombre']} ===")
        if args.descargar or not (FUENTES / f"{siglas}.doc").exists():
            descargar(siglas)
        lineas = convertir(siglas).read_text(encoding="utf-8").splitlines()
        lineas, avisos_tablas = insertar_tablas(lineas, convertir(siglas, "html"))
        lineas, avisos_img = insertar_imagenes(siglas, lineas)
        # Residuos de campos de Word dentro del texto: "artículo HYPERLINK 82" → "artículo 82"
        n_hip = sum(len(RE_HYPERLINK.findall(l)) for l in lineas)
        if n_hip:
            lineas = [RE_HYPERLINK.sub("", l) for l in lineas]
            avisos_img.append(f"  residuos «HYPERLINK» de Word eliminados: {n_hip}")
        # textutil agrega al final el encabezado/pie de página de Word; no es texto de la ley
        for k in range(max(0, len(lineas) - 40), len(lineas)):
            if re.search(r"EMBED Word\.|NUMPAGES|^\s*PAGE\b", lineas[k]):
                avisos_img.append(f"  encabezado/pie de página de Word eliminado ({len(lineas) - k} renglones al final)")
                lineas = lineas[:k]
                break
        datos, diag = parsear(siglas, lineas)
        reporte = validar(datos, diag, lineas)
        reporte[1:1] = avisos_tablas + avisos_img
        # Cada imagen debe haber quedado dentro del artículo esperado
        if IMAGENES_CONFIG.exists():
            por_id = {u["id"]: u for u in datos["unidades"]}
            for c in json.loads(IMAGENES_CONFIG.read_text(encoding="utf-8")).get(siglas, []):
                if c.get("unidad") and not c.get("omitir"):
                    marca = f"img/{siglas}-{c['n']:02d}.png"
                    if marca not in por_id.get(c["unidad"], {}).get("texto", ""):
                        reporte.append(f"⚠ imagen {c['n']} no quedó dentro de {c['unidad']}")
        if args.pdf:
            reporte += verificar_pdf(siglas, datos)
        # Foto de esta versión del texto (para comparar cuando llegue la siguiente)
        version = datos["ley"].get("ultima_reforma") or datos["ley"].get("publicacion")
        guardar_version(siglas, version, f"Texto con reformas hasta el DOF {version[8:]}-{version[5:7]}-{version[:4]}"
                        if datos["ley"].get("ultima_reforma") else f"Texto original (DOF {version})", datos["ley"]["fuente"], datos["unidades"])
        # Después de validar el texto compilado: reformas posteriores aún no integradas
        reporte += reformas_pendientes(siglas, datos, args.descargar)
        for u in datos["unidades"]:
            u.pop("_linea", None)
        (SALIDA / f"{siglas}.json").write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":")),
                                               encoding="utf-8")
        texto_rep = f"Reporte de validación — {siglas} — {date.today().isoformat()}\n\n" + "\n".join(reporte) + "\n"
        (REPORTES / f"validacion_{siglas}.txt").write_text(texto_rep, encoding="utf-8")
        for linea in reporte:
            print(f"  {linea}")
        hubo_avisos |= any(l.startswith("⚠") for l in reporte)

    generar_versiones_todas()
    actualizar_catalogo()
    enlazar_todas()
    print(f"\nListo → {SALIDA.relative_to(RAIZ)}/  (reportes en {REPORTES.relative_to(RAIZ)}/)")
    if hubo_avisos:
        print("⚠ Hay avisos: revísalos contra el documento oficial antes de publicar.")


if __name__ == "__main__":
    main()
