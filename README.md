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
| 2 | Pestañas, historial, notas, copiar con cita, ir directo (LISR 27), correlaciones manuales | ✅ |
| 3 | RLISR, CFF, RCFF, LIVA, RLIVA, LIF 2026 y 2027 + hipervínculos automáticos | ✅ |
| 4 | RMF 2026: compilado del SAT + modificaciones y versiones anticipadas posteriores | ✅ |
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

## Funciones

- **Ir directo:** escribe `LISR 27`, `isr 113e` o `art. 69-B CFF` en el buscador, o usa «Ir a artículo» en el lateral.
- **Pestañas:** «+» abre una consulta nueva; Ctrl/⌘ + clic (o clic con la rueda) abre cualquier enlace en pestaña nueva.
- **Historial** y **Mis notas:** accesos en el lateral. Se guardan solo en tu navegador; usa *Exportar respaldo* para no perderlos.
- **Copiar con cita:** copia el artículo (o solo lo seleccionado) con su cita y fuente. «Copiar cita» copia solo `Art. 27 LISR`.
- **Sugerir correlación:** vincula dos artículos. Para compartirlas con la oficina: *Mis notas → Exportar correlaciones para la oficina*
  y reemplazar `web/data/correlaciones_manuales.json`.

## Resolución Miscelánea Fiscal (RMF)

`scripts/build_rmf.py` arma la RMF 2026 desde el portal del SAT (solo documentos oficiales):

- **Texto vigente = el compilado más reciente del SAT** (la RMF con las modificaciones que el SAT ya integró), separado
  regla por regla, con su título, el renglón oficial de referencias y la fecha de su última modificación.
- **Lo posterior al compilado** (resoluciones ya publicadas en el DOF y versiones anticipadas aún sin publicar) no se
  "aplica" sobre el texto: cada regla afectada muestra un aviso con el extracto oficial tal como se publicó. Las reglas
  nuevas se agregan completas y marcadas.
- Todas las resoluciones, versiones anticipadas y anexos quedan listados en el árbol con su PDF.

Para actualizar (por ejemplo, cada jueves, cuando el SAT suele publicar versiones anticipadas):

```bash
python3 scripts/build_rmf.py --descargar
```

El reporte `web/data/reportes/validacion_RMF2026.txt` coteja las reglas contra la RMF original publicada en el DOF:
toda regla nueva debe estar anotada como «Adicionada» y ninguna original debe desaparecer sin explicación.

## Hipervínculos entre artículos

`scripts/referencias.py` convierte en enlaces las referencias que **nombran el ordenamiento**:
«artículo 27 de esta Ley», «del Código Fiscal de la Federación», «de la Ley» (dentro de un
reglamento → su ley), «de la misma» (→ la ley nombrada antes). Nunca liga por coincidencia de
número, ni referencias a versiones anteriores («…que se abroga», «vigente hasta 2013»).
Lo que no se pudo resolver queda en `web/data/reportes/referencias_no_resueltas.csv` (se abre en Excel).

## Estructura

```
scripts/build_data.py            extractor: .doc oficial → JSON (+ validación)
scripts/imagenes_oficiales.json  ubicación de tarifas/fórmulas que el documento oficial publica como imagen
scripts/pdf_a_texto.swift        lector de PDF (macOS) para cotejar contra el PDF oficial
scripts/referencias.py           detector de referencias entre artículos (hipervínculos)
scripts/build_rmf.py             extractor de la RMF (compilado del SAT + modificaciones posteriores)
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
# o todas:  python3 scripts/build_data.py --descargar --pdf
```

- `--descargar` baja el documento vigente de LeyesBiblio.
- `--pdf` coteja cada artículo, palabra por palabra, contra el PDF oficial.
- El reporte (`web/data/reportes/validacion_LISR.txt`) debe salir sin ⚠. Revisa:
  conteo independiente de artículos, numeración sin huecos ni duplicados, que ningún
  artículo traiga transitorios mezclados, tablas reconstruidas e imágenes colocadas.
- Si una reforma cambia una tarifa o fórmula publicada como imagen, el reporte lo marca
  (huella MD5 distinta) y hay que revisar `scripts/imagenes_oficiales.json`.

Requiere macOS (usa `textutil` y `swift`, que vienen con el sistema).
