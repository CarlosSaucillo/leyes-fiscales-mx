#!/usr/bin/env python3
"""Pipeline de datos: leyes fiscales mexicanas (LeyesBiblio → JSON).

Descarga los DOC oficiales de la Cámara de Diputados, los convierte a texto
(textutil, incluido en macOS) y los parsea a JSON con estructura jerárquica
flexible: cada artículo guarda su ruta de divisiones (Título/Capítulo/Sección),
su texto completo y las fechas de reforma DOF encontradas en sus anotaciones.

Uso:
    python scripts/build_data.py               # parsea fuentes/ existentes
    python scripts/build_data.py --descargar   # re-descarga los DOC oficiales
    python scripts/build_data.py --solo LISR   # procesa una sola norma

Al actualizar una ley: correr con --descargar, revisar el reporte de
validación que imprime al final, y hacer commit de data/.
"""
import argparse
import json
import re
import subprocess
import sys
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FUENTES = RAIZ / "fuentes"
DATA = RAIZ / "data"

BASE_URL = "https://www.diputados.gob.mx/LeyesBiblio"

# Registro de normas. Para actualizar una ley basta ajustar aquí su URL
# (p. ej. la LIF cambia de archivo cada año: LIF_2027.doc).
NORMAS = {
    "LISR": {
        "nombre": "Ley del Impuesto sobre la Renta",
        "corto": "LISR",
        "url": f"{BASE_URL}/doc/LISR.doc",
    },
    "RLISR": {
        "nombre": "Reglamento de la Ley del Impuesto sobre la Renta",
        "corto": "Reglamento LISR",
        "url": f"{BASE_URL}/regley/Reg_LISR_060516.doc",
    },
    "CFF": {
        "nombre": "Código Fiscal de la Federación",
        "corto": "CFF",
        "url": f"{BASE_URL}/doc/CFF.doc",
    },
    "RCFF": {
        "nombre": "Reglamento del Código Fiscal de la Federación",
        "corto": "Reglamento CFF",
        "url": f"{BASE_URL}/regley/Reg_CFF.doc",
    },
    "LIVA": {
        "nombre": "Ley del Impuesto al Valor Agregado",
        "corto": "LIVA",
        "url": f"{BASE_URL}/doc/LIVA.doc",
    },
    "RLIVA": {
        "nombre": "Reglamento de la Ley del Impuesto al Valor Agregado",
        "corto": "Reglamento LIVA",
        "url": f"{BASE_URL}/regley/Reg_LIVA_250914.doc",
    },
    "LIF": {
        "nombre": "Ley de Ingresos de la Federación para el Ejercicio Fiscal de 2026",
        "corto": "LIF 2026",
        "url": f"{BASE_URL}/doc/LIF_2026.doc",
    },
}

# ---------------------------------------------------------------------------
# Expresiones regulares del parser
# ---------------------------------------------------------------------------

# Sufijos latinos usados en numeración de artículos (Bis, Ter, ...)
_SUF = r"(?:BIS|Bis|TER|Ter|QU[ÁA]TER|Qu[áa]ter|QUINQUIES|Quinquies|QUINTUS|Quintus|SEXIES|Sexies|SEPTIES|Septies|OCTIES|Octies|NONIES|Nonies|DECIES|Decies)"

# Número de artículo: 1, 1o, 2o.-A, 29-B, 17-H Bis, 111 Bis, 82-Ter, 1o.-A BIS
_NUM = rf"\d+o?(?:\.?-(?:{_SUF}|[A-Z]))?(?:\s{_SUF})?"

RE_ARTICULO = re.compile(rf"^Art[ií]culo\s+({_NUM})[.:]\s*-?\s*(.*)$")

RE_DIVISION = re.compile(
    r"^(T[ÍI]TULO|T[íi]tulo|CAP[ÍI]TULO|Cap[ií]tulo|SECCI[ÓO]N|Secci[óo]n|APARTADO|Apartado)"
    r"\s+([IVXLCDM]+|\d+o?\.?|[ÚU]NICO|[ÚU]nico)\s*\.?\s*(.*)$"
)

NIVEL_DIVISION = {"TITULO": 1, "CAPITULO": 2, "SECCION": 3, "APARTADO": 4}

# Anotaciones de reforma al pie de artículos/párrafos/fracciones
RE_ANOTACION = re.compile(
    r"(?:reformad|adicionad|derogad|recorrid|modificad)\w*[^\n]*?DOF\s+\d{2}-\d{2}-\d{4}",
    re.IGNORECASE,
)
RE_FECHA_DOF = re.compile(r"\d{2}-\d{2}-\d{4}")

RE_TRANSITORIOS = re.compile(r"^(TRANSITORIOS?|Transitorios?)\s*$")
RE_DECRETOS = re.compile(r"^ART[ÍI]CULOS TRANSITORIOS DE DECRETOS DE REFORMA")

RE_ULTIMA_REFORMA = re.compile(r"[ÚU]ltima reforma publicada\s+DOF\s+(\d{2}-\d{2}-\d{4})")
RE_PUBLICACION = re.compile(
    r"publicad[oa] en el Diario Oficial de la Federaci[óo]n el (.+?)\s*$", re.IGNORECASE
)


def normalizar_nivel(marcador: str) -> int:
    plano = unicodedata.normalize("NFD", marcador.upper())
    plano = "".join(c for c in plano if unicodedata.category(c) != "Mn")
    return NIVEL_DIVISION[plano]


def fecha_clave(f: str):
    """dd-mm-aaaa → tupla ordenable (aaaa, mm, dd)."""
    d, m, a = f.split("-")
    return (a, m, d)


def descargar(clave: str) -> None:
    NORMAS[clave]
    destino = FUENTES / f"{clave}.doc"
    print(f"  ↓ {NORMAS[clave]['url']}")
    req = urllib.request.Request(
        NORMAS[clave]["url"], headers={"User-Agent": "Mozilla/5.0 (compatible; leyes-fiscales-mx)"}
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        destino.write_bytes(r.read())


def convertir(clave: str) -> Path:
    doc = FUENTES / f"{clave}.doc"
    txt = FUENTES / f"{clave}.txt"
    if txt.exists() and doc.exists() and txt.stat().st_mtime >= doc.stat().st_mtime:
        return txt
    if not doc.exists():
        sys.exit(f"No existe {doc}; corre con --descargar")
    try:
        subprocess.run(
            ["textutil", "-convert", "txt", str(doc), "-output", str(txt)],
            check=True, capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        sys.exit(
            f"No pude convertir {doc.name}. 'textutil' viene con macOS; en otro "
            f"sistema convierte el .doc a .txt (UTF-8) manualmente y reintenta."
        )
    return txt


def parsear(clave: str, lineas: list[str]) -> dict:
    meta = {"clave": clave, **{k: NORMAS[clave][k] for k in ("nombre", "corto", "url")}}
    meta["ultima_reforma"] = None
    meta["publicacion"] = None
    for linea in lineas[:40]:
        if m := RE_ULTIMA_REFORMA.search(linea):
            meta["ultima_reforma"] = m.group(1)
        if meta["publicacion"] is None and (m := RE_PUBLICACION.search(linea)):
            meta["publicacion"] = m.group(1).strip()

    articulos = []
    ruta = {}            # nivel -> etiqueta de división vigente
    actual = None        # artículo en construcción
    en_transitorios = False
    bloque_trans = None  # bloque de transitorios en construcción
    decreto_pendiente = None
    n_trans = 0

    def cerrar_articulo():
        nonlocal actual
        if actual is None:
            return
        texto = "\n".join(actual["lineas"]).strip()
        fechas = sorted(
            {f for ln in actual["lineas"] if RE_ANOTACION.search(ln)
             for f in RE_FECHA_DOF.findall(ln)},
            key=fecha_clave,
        )
        articulos.append({
            "id": f"{clave}-{actual['numero'].replace(' ', '_')}",
            "numero": actual["numero"],
            "ruta": actual["ruta"],
            "texto": texto,
            "reformas": fechas,
            "ultima_reforma": fechas[-1] if fechas else None,
            "transitorio": False,
        })
        actual = None

    def cerrar_bloque_trans():
        nonlocal bloque_trans, n_trans
        if bloque_trans is None:
            return
        texto = "\n".join(bloque_trans["lineas"]).strip()
        if not texto:
            bloque_trans = None
            return
        n_trans += 1
        fecha = None
        if m := RE_PUBLICACION.search(texto):
            fecha = m.group(1).strip().rstrip(".")
        titulo = bloque_trans["decreto"] or "Decreto de expedición de la ley"
        articulos.append({
            "id": f"{clave}-trans-{n_trans}",
            "numero": f"Transitorios {n_trans}",
            "ruta": ["Transitorios y decretos de reforma"],
            "titulo_decreto": titulo,
            "fecha_publicacion": fecha,
            "texto": texto,
            "reformas": [],
            "ultima_reforma": None,
            "transitorio": True,
        })
        bloque_trans = None

    i = 0
    while i < len(lineas):
        linea = lineas[i].replace("\t", " ").rstrip()

        if en_transitorios:
            if RE_DECRETOS.match(linea):
                cerrar_bloque_trans()
            elif RE_TRANSITORIOS.match(linea):
                cerrar_bloque_trans()
                bloque_trans = {"decreto": decreto_pendiente, "lineas": []}
                decreto_pendiente = None
            elif linea.startswith("DECRETO"):
                # Encabezado del siguiente decreto; cierra el bloque anterior.
                cerrar_bloque_trans()
                decreto_pendiente = linea.strip()
            elif bloque_trans is not None and linea:
                bloque_trans["lineas"].append(linea)
            i += 1
            continue

        if RE_TRANSITORIOS.match(linea) or RE_DECRETOS.match(linea):
            cerrar_articulo()
            en_transitorios = True
            if RE_TRANSITORIOS.match(linea):
                bloque_trans = {"decreto": None, "lineas": []}
            i += 1
            continue

        if m := RE_DIVISION.match(linea):
            marcador, ordinal, resto = m.groups()
            resto = resto.strip()
            # Guardas contra falsos positivos (referencias dentro de un párrafo)
            if resto and (len(resto) > 120 or resto[:1].islower()):
                if actual is not None:
                    actual["lineas"].append(linea)
                i += 1
                continue
            cerrar_articulo()
            nivel = normalizar_nivel(marcador)
            encabezado = resto
            if not encabezado:
                j = i + 1
                while j < len(lineas) and not lineas[j].strip():
                    j += 1
                if j < len(lineas):
                    cand = lineas[j].replace("\t", " ").strip()
                    if (cand and len(cand) < 150
                            and not RE_DIVISION.match(cand)
                            and not RE_ARTICULO.match(cand)
                            and not RE_ANOTACION.search(cand)):
                        encabezado = cand
                        i = j
            etiqueta = f"{marcador.capitalize()} {ordinal.rstrip('.')}"
            if encabezado:
                etiqueta += f" — {encabezado.title() if encabezado.isupper() else encabezado}"
            ruta[nivel] = etiqueta
            for nv in list(ruta):
                if nv > nivel:
                    del ruta[nv]
            i += 1
            continue

        if m := RE_ARTICULO.match(linea):
            numero, resto = m.groups()
            # Filas de tabla (llevan tabuladores) y referencias tipo
            # "Artículo 2o., fracción I..." no son inicios de artículo.
            sig = next((l.strip() for l in lineas[i + 1:i + 4] if l.strip()), "")
            es_celda_tabla = not resto and re.fullmatch(r"[\d.,\s]+", sig or "0")
            if "\t" in lineas[i] or resto.lstrip()[:1] in {",", ";"} or es_celda_tabla:
                if actual is not None:
                    actual["lineas"].append(linea)
                i += 1
                continue
            cerrar_articulo()
            actual = {
                "numero": numero.replace(".", "").strip(),
                "ruta": [ruta[nv] for nv in sorted(ruta)],
                "lineas": [resto] if resto else [],
            }
            i += 1
            continue

        if actual is not None and linea:
            actual["lineas"].append(linea)
        i += 1

    cerrar_articulo()
    cerrar_bloque_trans()
    meta["articulos"] = articulos
    meta["generado"] = date.today().isoformat()
    return meta


def validar(ley: dict) -> list[str]:
    avisos = []
    arts = [a for a in ley["articulos"] if not a["transitorio"]]
    trans = [a for a in ley["articulos"] if a["transitorio"]]
    avisos.append(f"{len(arts)} artículos + {len(trans)} bloques de transitorios")

    numeros = [a["numero"] for a in arts]
    vistos = set()
    duplicados = {n for n in numeros if n in vistos or vistos.add(n)}
    if duplicados:
        avisos.append(f"⚠ números duplicados: {sorted(duplicados)}")

    enteros = sorted({int(m.group()) for n in numeros if (m := re.match(r"\d+", n))})
    if enteros:
        faltan = [n for n in range(enteros[0], enteros[-1] + 1) if n not in enteros]
        if faltan:
            avisos.append(f"⚠ enteros ausentes en la secuencia: {faltan}")

    vacios = [a["numero"] for a in arts if not a["texto"]]
    if vacios:
        avisos.append(f"⚠ artículos sin texto: {vacios}")

    sin_ruta = sum(1 for a in arts if not a["ruta"])
    if sin_ruta:
        avisos.append(f"nota: {sin_ruta} artículos sin división (leyes sin títulos/capítulos)")
    return avisos


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--descargar", action="store_true", help="re-descargar los DOC oficiales")
    ap.add_argument("--solo", metavar="CLAVE", help="procesar una sola norma (p. ej. LISR)")
    args = ap.parse_args()

    claves = [args.solo] if args.solo else list(NORMAS)
    for c in claves:
        if c not in NORMAS:
            sys.exit(f"Norma desconocida: {c}. Opciones: {', '.join(NORMAS)}")

    FUENTES.mkdir(exist_ok=True)
    DATA.mkdir(exist_ok=True)

    indice = []
    reporte = []
    for clave in claves:
        print(f"\n=== {clave}: {NORMAS[clave]['nombre']} ===")
        if args.descargar:
            descargar(clave)
        txt = convertir(clave)
        lineas = txt.read_text(encoding="utf-8").splitlines()
        ley = parsear(clave, lineas)
        (DATA / f"{clave}.json").write_text(
            json.dumps(ley, ensure_ascii=False, indent=1), encoding="utf-8"
        )
        avisos = validar(ley)
        reporte.append((clave, avisos))
        for a in avisos:
            print(f"  {a}")
        indice.append({
            "clave": clave,
            "nombre": ley["nombre"],
            "corto": ley["corto"],
            "url": ley["url"],
            "publicacion": ley["publicacion"],
            "ultima_reforma": ley["ultima_reforma"],
            "num_articulos": sum(1 for a in ley["articulos"] if not a["transitorio"]),
            "generado": ley["generado"],
        })

    if not args.solo:
        (DATA / "index.json").write_text(
            json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    lineas_rep = [f"Reporte de validación — {date.today().isoformat()}", ""]
    for clave, avisos in reporte:
        lineas_rep.append(f"[{clave}]")
        lineas_rep.extend(f"  {a}" for a in avisos)
        lineas_rep.append("")
    (DATA / "reporte_validacion.txt").write_text("\n".join(lineas_rep), encoding="utf-8")
    print(f"\nListo. JSON en {DATA}/ y reporte en {DATA}/reporte_validacion.txt")


if __name__ == "__main__":
    main()
