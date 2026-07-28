"""Consulta de leyes fiscales mexicanas.

Lee los JSON generados por scripts/build_data.py (uno por norma) y ofrece
navegación jerárquica por divisiones (Título/Capítulo/Sección, profundidad
variable) y búsqueda de texto libre con SQLite FTS5.
"""
import json
import re
import sqlite3
from pathlib import Path

import streamlit as st

DATA = Path(__file__).parent / "data"

st.set_page_config(
    page_title="Leyes fiscales de México",
    page_icon="⚖️",
    layout="centered",
    menu_items={
        "About": "Textos tomados de las versiones oficiales publicadas por la "
        "Cámara de Diputados (diputados.gob.mx/LeyesBiblio). "
        "Herramienta de consulta sin valor legal; el texto vigente es el del DOF."
    },
)


@st.cache_data
def cargar_indice() -> list[dict]:
    return json.loads((DATA / "index.json").read_text(encoding="utf-8"))


@st.cache_data
def cargar_ley(clave: str) -> dict:
    return json.loads((DATA / f"{clave}.json").read_text(encoding="utf-8"))


@st.cache_resource
def indice_busqueda() -> sqlite3.Connection:
    """Base FTS5 en memoria con todos los artículos de todas las normas."""
    con = sqlite3.connect(":memory:", check_same_thread=False)
    con.execute(
        "CREATE VIRTUAL TABLE arts USING fts5("
        "clave, corto, numero, ruta, texto, art_id UNINDEXED, orden UNINDEXED, "
        "tokenize = 'unicode61 remove_diacritics 2')"
    )
    for ley in cargar_indice():
        datos = cargar_ley(ley["clave"])
        con.executemany(
            "INSERT INTO arts VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    ley["clave"],
                    ley["corto"],
                    a["numero"],
                    " › ".join(a["ruta"]),
                    a["texto"],
                    a["id"],
                    i,
                )
                for i, a in enumerate(datos["articulos"])
            ],
        )
    con.commit()
    return con


def buscar(consulta: str, claves: list[str], limite: int = 50) -> list[dict]:
    terminos = re.findall(r"\w+", consulta, re.UNICODE)
    if not terminos:
        return []
    match = " ".join(f'"{t}"' for t in terminos)
    filtro = f"AND clave IN ({','.join('?' * len(claves))})" if claves else ""
    filas = indice_busqueda().execute(
        f"""
        SELECT clave, corto, numero, ruta, art_id, orden,
               snippet(arts, 4, '**', '**', ' … ', 32)
        FROM arts WHERE arts MATCH ? {filtro}
        ORDER BY rank LIMIT ?
        """,
        [match, *claves, limite],
    ).fetchall()
    columnas = ["clave", "corto", "numero", "ruta", "art_id", "orden", "snippet"]
    return [dict(zip(columnas, f)) for f in filas]


def titulo_articulo(art: dict) -> str:
    if art["transitorio"]:
        fecha = art.get("fecha_publicacion")
        return f"Transitorios — {fecha}" if fecha else art["numero"]
    return f"Artículo {art['numero']}"


def mostrar_articulo(ley_meta: dict, art: dict) -> None:
    st.subheader(titulo_articulo(art))
    migas = [ley_meta["corto"], *art["ruta"]]
    st.caption(" › ".join(migas))
    if art["transitorio"] and art.get("titulo_decreto"):
        st.markdown(f"*{art['titulo_decreto']}*")
    if art["ultima_reforma"]:
        st.markdown(f":material/history: :small[Última reforma de este artículo: "
                    f"**DOF {art['ultima_reforma']}**]")
        if len(art["reformas"]) > 1:
            st.caption("Reformas: DOF " + ", ".join(art["reformas"]))
    elif not art["transitorio"]:
        st.markdown(":material/verified: :small[Sin reformas registradas: conserva "
                    "su texto original]")
    st.divider()
    for parrafo in art["texto"].split("\n"):
        if parrafo.strip():
            st.markdown(parrafo.replace("$", r"\$"))


# ---------------------------------------------------------------------------
# Barra lateral: selector de norma y ficha de vigencia
# ---------------------------------------------------------------------------
indice = cargar_indice()
por_clave = {l["clave"]: l for l in indice}

with st.sidebar:
    st.title("⚖️ Leyes fiscales de México")
    st.caption("Consulta las principales normas fiscales federales vigentes.")
    clave_sel = st.selectbox(
        "Norma",
        options=[l["clave"] for l in indice],
        format_func=lambda c: por_clave[c]["nombre"],
    )
    meta = por_clave[clave_sel]
    with st.container(border=True):
        st.markdown(f"**{meta['corto']}**")
        if meta["publicacion"]:
            st.caption(f":material/calendar_today: Publicada: {meta['publicacion']}")
        if meta["ultima_reforma"]:
            st.caption(f":material/history: Última reforma: DOF {meta['ultima_reforma']}")
        else:
            st.caption(":material/history: Sin reformas desde su publicación")
        st.caption(f":material/article: {meta['num_articulos']} artículos")
        st.caption(f"[Texto oficial (Cámara de Diputados)]({meta['url']})")
    st.caption(
        f"Datos generados el {meta['generado']} a partir de los documentos "
        "oficiales de LeyesBiblio. Esta herramienta no sustituye al DOF."
    )

ley = cargar_ley(clave_sel)
articulos = ley["articulos"]

modo = st.segmented_control(
    "Modo",
    ["Explorar", "Buscar"],
    default="Explorar",
    label_visibility="collapsed",
)

# ---------------------------------------------------------------------------
# Explorar: navegación jerárquica de profundidad variable
# ---------------------------------------------------------------------------
if modo == "Explorar":
    filtrados = articulos
    nivel = 0
    while True:
        opciones = []
        for a in filtrados:
            if len(a["ruta"]) > nivel and a["ruta"][nivel] not in opciones:
                opciones.append(a["ruta"][nivel])
        if not opciones:
            break
        etiquetas = ["Todo" if nivel == 0 else "Todos"] + opciones
        seleccion = st.selectbox(
            f"Nivel {nivel + 1}" if nivel else "División",
            etiquetas,
            key=f"nivel_{clave_sel}_{nivel}",
        )
        if seleccion in ("Todo", "Todos"):
            break
        filtrados = [
            a for a in filtrados if len(a["ruta"]) > nivel and a["ruta"][nivel] == seleccion
        ]
        nivel += 1

    art_sel = st.selectbox(
        "Artículo",
        filtrados,
        format_func=lambda a: f"{titulo_articulo(a)} — "
        f"{a['texto'][:80].split(chr(10))[0]}…",
        key=f"art_{clave_sel}",
    )
    st.divider()
    if art_sel:
        with st.container(border=True):
            mostrar_articulo(meta, art_sel)

# ---------------------------------------------------------------------------
# Buscar: texto libre sobre todas las normas (SQLite FTS5)
# ---------------------------------------------------------------------------
else:
    with st.form("busqueda", border=False):
        consulta = st.text_input(
            "Buscar en el texto de las leyes",
            placeholder="p. ej. deducciones personales, sello digital, tasa 0%…",
        )
        todas = st.checkbox("Buscar en todas las normas", value=True)
        enviado = st.form_submit_button("Buscar", icon=":material/search:")

    if enviado and consulta.strip():
        claves = [] if todas else [clave_sel]
        resultados = buscar(consulta, claves)
        if not resultados:
            st.info(
                "Sin coincidencias. Intenta con menos palabras o sin abreviaturas.",
                icon=":material/search_off:",
            )
        else:
            st.caption(
                f"{len(resultados)} artículo(s) con coincidencias"
                + (" (máximo 50; afina tu búsqueda)" if len(resultados) == 50 else "")
            )
            arts_por_ley = {}
            for r in resultados:
                datos = arts_por_ley.setdefault(r["clave"], cargar_ley(r["clave"]))
                art = datos["articulos"][r["orden"]]
                encabezado = f"**{r['corto']} · {titulo_articulo(art)}**"
                if r["ruta"]:
                    encabezado += f" — {r['ruta']}"
                exp = st.expander(encabezado, on_change="rerun")
                with exp:
                    st.markdown(f":small[{r['snippet']}]")
                if exp.open:
                    with exp:
                        st.divider()
                        mostrar_articulo(por_clave[r["clave"]], art)
    elif modo == "Buscar":
        st.caption(
            "Escribe una o varias palabras; se buscan artículos que las "
            "contengan todas (sin distinguir acentos)."
        )
