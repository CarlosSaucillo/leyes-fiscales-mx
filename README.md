# Legislación fiscal federal — buscador de consulta

Herramienta web para consultar legislación fiscal federal mexicana por ley, título,
capítulo y artículo, con búsqueda de texto libre. Página estática (HTML + CSS +
JavaScript), sin servidor: se puede publicar en cualquier hosting de archivos.

Textos tomados **solo de fuentes oficiales**: los documentos de la Cámara de Diputados
([LeyesBiblio](https://www.diputados.gob.mx/LeyesBiblio/)). Herramienta de consulta;
el texto con validez oficial es el publicado en el DOF.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Extractor corregido + interfaz web con la LISR | ✅ |
| 2 | Pestañas, historial, notas, copiar con cita, ir directo (LISR 27) | pendiente |
| 3 | RLISR, CFF, RCFF, LIVA, RLIVA, LIF 2026 y 2027 + hipervínculos automáticos | pendiente |
| 4 | RMF 2026 y versiones anticipadas | pendiente |
| 5 | Fechas de reforma por artículo y comparación de versiones | pendiente |

## Usarlo en tu computadora

Doble clic en **`abrir-buscador.command`**. Se abre el navegador; deja abierta la ventana
negra mientras lo usas.

(Abrir `web/index.html` con doble clic no funciona: los navegadores no dejan que una
página lea archivos de datos así; por eso se usa un pequeño servidor local.)

Equivalente en Terminal:

```bash
python3 -m http.server 8000 -d web
```

## Estructura

```
scripts/build_data.py            extractor: .doc oficial → JSON (+ validación)
scripts/imagenes_oficiales.json  ubicación de tarifas/fórmulas que el documento oficial publica como imagen
scripts/pdf_a_texto.swift        lector de PDF (macOS) para cotejar contra el PDF oficial
web/                             la página (lo que se publica)
web/data/catalogo.json           metadatos de cada ley
web/data/<SIGLAS>.json           una ley por archivo: metadatos, estructura y artículos
web/data/img/                    imágenes oficiales (tarifas y fórmulas)
web/data/reportes/               reporte de validación de cada ley
fuentes/                         documentos descargados (no se suben a git)
streamlit_app.py, data/          versión anterior (Streamlit); se retira al aprobar la versión web
```

## Actualizar una ley cuando hay reformas

```bash
python3 scripts/build_data.py --solo LISR --descargar --pdf
```

- `--descargar` baja el documento vigente de LeyesBiblio.
- `--pdf` coteja cada artículo, palabra por palabra, contra el PDF oficial.
- El reporte (`web/data/reportes/validacion_LISR.txt`) debe salir sin ⚠. Revisa:
  conteo independiente de artículos, numeración sin huecos ni duplicados, que ningún
  artículo traiga transitorios mezclados, tablas reconstruidas e imágenes colocadas.
- Si una reforma cambia una tarifa o fórmula publicada como imagen, el reporte lo marca
  (huella MD5 distinta) y hay que revisar `scripts/imagenes_oficiales.json`.

Requiere macOS (usa `textutil` y `swift`, que vienen con el sistema).
