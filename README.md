# Leyes fiscales de México

App de consulta de las principales normas fiscales federales mexicanas, con
navegación por Título/Capítulo/Sección/Artículo y búsqueda de texto libre.

**Normas incluidas:** LISR y su Reglamento, CFF y su Reglamento, LIVA y su
Reglamento, y Ley de Ingresos de la Federación 2026.

Los textos provienen de las versiones oficiales publicadas por la Cámara de
Diputados ([LeyesBiblio](https://www.diputados.gob.mx/LeyesBiblio/)), incluyendo
la fecha de última reforma DOF de cada ley y de cada artículo (extraída de las
anotaciones oficiales al pie de cada precepto). Esta herramienta es solo de
consulta y no sustituye al Diario Oficial de la Federación.

## Correr localmente

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

## Actualizar los textos cuando haya reformas

```bash
python3 scripts/build_data.py --descargar
```

El script descarga los DOC oficiales, los reparsea a `data/*.json` e imprime un
reporte de validación (conteo de artículos, numeración faltante). Revisa el
reporte, haz commit de `data/` y Streamlit Cloud redespliega solo. Si cambia la
URL de algún documento (p. ej. la LIF de cada año), ajústala en el diccionario
`NORMAS` al inicio del script.

Pendiente (fase 2): Resolución Miscelánea Fiscal y sus modificaciones.
