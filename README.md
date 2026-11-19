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
| 5 | Reformas por fecha, novedades, reformas publicadas aún no integradas y comparación de versiones | ✅ |

## Usarlo en tu computadora

Doble clic en **`abrir-buscador.command`**. Se abre el navegador; deja abierta la ventana
negra mientras lo usas.

(Abrir `web/index.html` con doble clic no funciona: los navegadores no dejan que una
página lea archivos de datos así; por eso se usa un pequeño servidor local.)

Equivalente en Terminal:

```bash
python3 scripts/servidor.py
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

## Reformas, novedades y versiones

- **Reformas publicadas que la Cámara aún no integra:** el extractor revisa la página de historial de cada ley en
  LeyesBiblio. Si hay un decreto posterior al texto vigente (p. ej. el Paquete Económico 2027, DOF 13-11-2026), cada
  artículo afectado muestra un aviso con el extracto oficial del decreto y su fecha de entrada en vigor; los artículos
  nuevos se agregan completos y las disposiciones transitorias del decreto quedan como bloque propio.
- **Reformas por fecha** (`#/reformas/LISR`) y **Novedades** de todas las leyes (`#/reformas`).
- **Versiones:** cada corrida guarda una foto completa del texto en `historico/<SIGLAS>/<fecha>.json` (se queda en el
  repositorio; no se publica). Al sitio solo va lo que cambió (`web/data/versiones/`). Cada artículo tiene un panel
  «Versiones» para comparar palabra por palabra. La RMF ya trae 4 versiones oficiales (original del DOF y los tres
  compilados del SAT); las leyes empezarán a mostrar cambios cuando la Cámara publique su siguiente texto actualizado.

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
scripts/servidor.py              servidor local para probar (sin caché)
historico/                       fotos completas de cada versión (base de la comparación)
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
