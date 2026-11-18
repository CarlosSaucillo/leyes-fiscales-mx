"""Hipervínculos automáticos entre artículos (correlaciones por referencia explícita).

Detecta en el texto referencias como:
    "artículo 27 de esta Ley"
    "artículos 74, 74-A y 74-B de esta Ley"
    "artículos 25 al 28 de este Código"
    "artículo 69-B del Código Fiscal de la Federación"
    "artículo 5o. de la Ley"              (dentro de un reglamento → su ley)
    "artículo 113-E de la misma"          (→ la ley mencionada justo antes)

Regla de oro: SOLO se liga cuando el texto nombra el ordenamiento. Un "artículo 27"
sin calificador no se liga (va al reporte). Nunca se liga ley↔reglamento por
coincidencia de número.

Guarda en cada unidad:
    "enlaces":     [[renglón, inicio, fin, "SIGLAS/clave"], ...]  posiciones dentro del renglón
    "referencias": ["cff-69-b", ...]   a qué artículos remite
    "citado_por":  ["lisr-27", ...]    qué artículos remiten a él
"""
import csv
import re
import unicodedata

_SUF = r"(?:Bis|BIS|bis|Ter|TER|ter|Qu[aá]ter|QU[AÁ]TER|Quinquies|QUINQUIES|Quintus|Sexies|SEXIES)"
NUM = rf"\d+o?(?:\.?-\s?(?:{_SUF}|[A-Z])\b)?(?:\s{_SUF}\b)?"
SEP = r"(?:\s*,\s*|\s+y\s+|\s+e\s+|\s+o\s+|\s+al\s+|\s+a\s+)"
RE_ARTICULOS = re.compile(rf"\b[Aa]rt[íi]culos?\s+({NUM}(?:{SEP}{NUM})*)")
RE_NUM = re.compile(NUM)
RE_CORTE = re.compile(r"\b[Aa]rt[íi]culos?\b|;|\.\s+[A-ZÁÉÍÓÚ]")

# Calificadores, del más específico al más general. Grupo = tipo de destino.
CALIFICADORES = [
    (r"del Reglamento del Código Fiscal de la Federación", "RCFF"),
    (r"del Reglamento de la Ley del Impuesto sobre la Renta", "RLISR"),
    (r"del Reglamento de la Ley del Impuesto al Valor Agregado", "RLIVA"),
    (r"del Reglamento de (?:esta|la presente) Ley|del Reglamento de la Ley\b(?! del| de| Federal| General)", "@reglamento"),
    (r"del (?:presente|este) Reglamento|de (?:este|el presente) Reglamento", "@mismo"),
    (r"del Código Fiscal de la Federación", "CFF"),
    (r"de(?:l)? (?:este|presente) Código", "@codigo"),
    (r"del Código\b(?!\s+(?:Civil|Penal|Nacional|de Comercio|Federal|Fiscal de la Federación))", "CFF"),
    (r"de la Ley del Impuesto sobre la Renta", "LISR"),
    (r"de la Ley del Impuesto al Valor Agregado", "LIVA"),
    (r"de la Ley de Ingresos de la Federación", "!lif"),
    (r"de (?:esta|la presente) Ley|de(?:l)? (?:este|presente) ordenamiento", "@esta_ley"),
    (r"del mismo Código", "CFF"),
    (r"de la misma(?! fracción| Ley)|del mismo(?! párrafo| Código)", "@anterior"),
    (r"de la Ley\b(?!\s+(?:del|de|Federal|General|Aduanera|Orgánica|para|sobre|Agraria|Minera|Nacional|que|en|a la))", "@ley_padre"),
    (r"de la Ley [A-ZÁÉÍÓÚ]|de la Ley de |de la Ley del |del Código (?:Civil|Penal|Nacional|de Comercio|Federal)|de la Constitución", "!externa"),
]
RE_CALIF = re.compile("|".join(f"(?P<c{i}>{p})" for i, (p, _) in enumerate(CALIFICADORES)))
VENTANA = 180
# Referencias a una VERSIÓN ANTERIOR de la ley ("…de la Ley del ISR que se abroga", "vigente hasta 2013"):
# el número puede coincidir con un artículo actual que dice otra cosa, así que nunca se ligan.
RE_HISTORICA = re.compile(
    r"^[\s,]*(?:que se abroga|abrogad[oa]s?|que se deroga|derogad[oa]s?|vigentes? (?:hasta|en|al|a partir|durante|con anterioridad)|"
    r"en vigor (?:hasta|en|al)|anterior|citada vigente|antes citada)", re.I)


def clave(numero: str) -> str:
    n = "".join(c for c in unicodedata.normalize("NFD", numero) if unicodedata.category(c) != "Mn").lower()
    n = re.sub(r"^(\d+)o\b", r"\1", n)
    n = re.sub(r"(\d)([a-z])", r"\1-\2", n)
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-")


def _destino(tipo: str, ley: dict, anterior: str | None) -> tuple[str | None, str | None]:
    """Devuelve (siglas, motivo_si_no_se_resuelve)."""
    s = ley["siglas"]
    if not tipo.startswith(("@", "!")):
        return tipo, None
    if tipo == "@esta_ley":
        return (s, None) if ley["tipo"] == "ley" else (None, "«esta Ley» dentro de un reglamento")
    if tipo == "@codigo":
        return ("CFF", None) if s == "CFF" else (None, "«este Código» fuera del CFF")
    if tipo == "@mismo":
        return (s, None) if ley["tipo"] == "reglamento" else (None, "«este Reglamento» dentro de una ley")
    if tipo == "@reglamento":
        if ley["tipo"] == "reglamento":
            return s, None
        return (ley.get("reglamento"), None) if ley.get("reglamento") else (None, "reglamento no identificado")
    if tipo == "@ley_padre":
        return (ley["ley_padre"], None) if ley.get("ley_padre") else (None, "«de la Ley» sin nombre (dentro de una ley)")
    if tipo == "@anterior":
        return (anterior, None) if anterior else (None, "«de la misma» sin ley previa")
    if tipo == "!lif":
        return None, "Ley de Ingresos sin año (no se puede saber cuál)"
    return None, "ley no cargada en el buscador"


def _numeros(lista: str):
    """'25 al 28, 30 y 31-A' → [('25', ini, fin, es_rango_inicio), …] con posiciones relativas."""
    nums = [(m.group(), m.start(), m.end()) for m in RE_NUM.finditer(lista)]
    res = []
    for k, (n, a, b) in enumerate(nums):
        siguiente_sep = lista[b:nums[k + 1][1]] if k + 1 < len(nums) else ""
        res.append((n, a, b, bool(re.fullmatch(r"\s+(?:al|a)\s+", siguiente_sep))))
    return res


def enlazar(leyes: dict[str, dict]) -> tuple[dict, list[list[str]]]:
    """leyes: siglas → datos JSON (con 'ley' y 'unidades'). Modifica las unidades en su lugar."""
    ids = {s: {u["id"]: i for i, u in enumerate(d["unidades"]) if u["unidad"] != "transitorio"} for s, d in leyes.items()}
    orden = {s: [u["id"] for u in d["unidades"] if u["unidad"] != "transitorio"] for s, d in leyes.items()}
    no_resueltas: list[list[str]] = []
    stats = {s: {"enlaces": 0, "no_resueltas": 0} for s in leyes}
    citado_por: dict[str, set] = {}

    for s, datos in leyes.items():
        ley = datos["ley"]
        for u in datos["unidades"]:
            enlaces, refs = [], set()
            renglones = [l.strip() for l in u["texto"].split("\n") if l.strip()]
            for r, linea in enumerate(renglones):
                if linea.startswith(("|", "[[")):
                    continue
                anterior = None
                for m in RE_ARTICULOS.finditer(linea):
                    lista, ini_lista = m.group(1), m.start(1)
                    resto = linea[m.end():m.end() + VENTANA]
                    corte = RE_CORTE.search(resto)
                    ventana = resto[:corte.start()] if corte else resto
                    c = RE_CALIF.search(ventana)
                    if not c:
                        stats[s]["no_resueltas"] += 1
                        no_resueltas.append([s, u["numero"], "sin calificador (no dice de qué ley)", linea[max(0, m.start() - 40):m.end() + 60]])
                        continue
                    tipo = CALIFICADORES[int(c.lastgroup[1:])][1]
                    despues = ventana[c.end():c.end() + 60]
                    if RE_HISTORICA.search(despues):
                        stats[s]["no_resueltas"] += 1
                        no_resueltas.append([s, u["numero"], "versión anterior o abrogada de la ley (no se liga)",
                                             linea[max(0, m.start() - 20):m.end() + len(c.group()) + 60]])
                        continue
                    if tipo == "@anterior" and not anterior:
                        # "de la misma": la última ley nombrada antes en el párrafo ("…de esta Ley… artículo 99 de la misma")
                        previas = [x for x in RE_CALIF.finditer(linea[:m.start()])
                                   if not CALIFICADORES[int(x.lastgroup[1:])][1].startswith(("@anterior", "!"))]
                        if previas:
                            anterior, _ = _destino(CALIFICADORES[int(previas[-1].lastgroup[1:])][1], ley, None)
                    destino, motivo = _destino(tipo, ley, anterior)
                    if not destino or destino not in leyes:
                        motivo = motivo or f"{destino} no está cargada"
                        stats[s]["no_resueltas"] += 1
                        no_resueltas.append([s, u["numero"], motivo, linea[max(0, m.start() - 20):m.end() + len(c.group()) + 40]])
                        continue
                    anterior = destino
                    nums = _numeros(lista)
                    for k, (n, a, b, es_rango) in enumerate(nums):
                        id_dest = f"{destino.lower()}-{clave(n)}"
                        if id_dest not in ids[destino]:
                            stats[s]["no_resueltas"] += 1
                            no_resueltas.append([s, u["numero"], f"artículo {n} no existe en {destino}", linea[max(0, m.start() - 20):m.end() + 60]])
                            continue
                        enlaces.append([r, ini_lista + a, ini_lista + b, f"{destino}/{clave(n)}"])
                        stats[s]["enlaces"] += 1
                        refs.add(id_dest)
                        # Rango "25 al 28": también remite a los intermedios que existan
                        if es_rango and k + 1 < len(nums):
                            fin_id = f"{destino.lower()}-{clave(nums[k + 1][0])}"
                            if fin_id in ids[destino]:
                                i0, i1 = ids_pos(orden[destino], id_dest), ids_pos(orden[destino], fin_id)
                                if 0 <= i0 < i1:
                                    refs.update(orden[destino][i0 + 1:i1])
            refs.discard(u["id"])
            u["enlaces"] = enlaces
            u["referencias"] = sorted(refs)
            for x in refs:
                citado_por.setdefault(x, set()).add(u["id"])

    for d in leyes.values():
        for u in d["unidades"]:
            u["citado_por"] = sorted(citado_por.get(u["id"], ()))
    return stats, no_resueltas


def ids_pos(lista: list[str], x: str) -> int:
    try:
        return lista.index(x)
    except ValueError:
        return -1


def escribir_reporte(ruta_csv, no_resueltas: list[list[str]]) -> None:
    with open(ruta_csv, "w", encoding="utf-8-sig", newline="") as f:   # utf-8-sig: Excel lo abre con acentos
        w = csv.writer(f)
        w.writerow(["ley", "artículo", "motivo", "texto"])
        w.writerows(no_resueltas)
