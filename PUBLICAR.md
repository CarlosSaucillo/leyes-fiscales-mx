# Publicar el buscador (Cloudflare Pages + Cloudflare Access)

**Cómo funciona.** El sitio vive en tu repositorio de GitHub. **Cloudflare Pages** toma la carpeta `web/` y la publica en una dirección `https://<nombre>.pages.dev`. **Cloudflare Access** pone una "puerta" delante: solo entran los correos que autorices. Cada persona recibe un código de 6 dígitos en su correo, sin contraseñas que administrar.

Cada vez que subas cambios a GitHub, el sitio se actualiza solo en 1 o 2 minutos.

---

## Paso 1 · Subir el código a GitHub

1. Doble clic en `subir-leyes-a-github.command`.
2. Pega tu token de GitHub (`ghp_…`) cuando pida *Password* y presiona Enter. Solo se pide la primera vez: la Mac lo guarda en el Llavero.
   - Si el token ya caducó, crea uno nuevo en GitHub → Settings → Developer settings → Personal access tokens → *Tokens (classic)* → *Generate new token*, con el permiso **repo**.

**Opcional (recomendado): hacer el repositorio privado.** Hoy el repositorio es público, así que cualquiera puede ver el código y los datos en GitHub, aunque el sitio tenga puerta. El texto legal es público, pero si quieren que la herramienta sea solo de la oficina:
- GitHub → repositorio `leyes-fiscales-mx` → Settings → *Danger Zone* → **Change visibility → Private**.
- Cloudflare puede leer repositorios privados sin problema.

## Paso 2 · Crear el sitio en Cloudflare Pages

1. Crea una cuenta gratuita en <https://dash.cloudflare.com/sign-up>, o entra si ya tienes una.
2. En el menú izquierdo: **Workers & Pages** → **Create** (o *Create application*).
3. Elige la pestaña o enlace **Pages** (puede decir *"Looking to deploy Pages? Get started"*). Luego elige **Import an existing Git repository** (o *Connect to Git*).
4. Conecta tu cuenta de GitHub, autoriza a Cloudflare y elige el repositorio `leyes-fiscales-mx`.
5. Configuración:

   | Campo | Valor |
   |---|---|
   | Project name | `leyes-fiscales` (será parte de la dirección) |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | *(vacío)*; si no lo acepta vacío, escribe `exit 0` |
   | Build output directory | `web` |

6. **Save and Deploy**. En 1 o 2 minutos tendrás la dirección, por ejemplo `https://leyes-fiscales.pages.dev`.

⚠️ **Desde este momento el sitio es público** hasta que hagas el Paso 3. Hazlo enseguida.

## Paso 3 · Restringir el acceso (Cloudflare Access)

1. En el menú izquierdo: **Zero Trust**.
   - La primera vez te pide un *team name* (cualquiera, ej. `kreston-bsg`) y un plan: elige **Free** (hasta 50 usuarios).
   - Puede pedir una tarjeta aunque el plan sea gratuito. Eso lo decides tú.
2. **Access** → **Applications** → **Add an application** → **Self-hosted**.
3. Datos de la aplicación:
   - **Application name:** Buscador de leyes fiscales.
   - **Domain:** `leyes-fiscales.pages.dev`, la dirección del Paso 2.
4. **Policy** (quién entra):
   - **Action:** Allow.
   - **Include → Emails ending in:** `@<dominio de la oficina>` (por ejemplo `@krestonbsg.com.mx`). Así entra todo el que tenga correo de la oficina.
   - O bien **Include → Emails:** una lista de correos específicos.
5. **Login method:** *One-time PIN* (código al correo), que viene activado por defecto.
6. Guarda.
7. **Proteger también las versiones de prueba:**
   - Ve a Workers & Pages → `leyes-fiscales` → **Settings** → **General** → *Access policy* → **Enable**.
   - Cloudflare crea una dirección distinta por cada subida (`abc123.leyes-fiscales.pages.dev`), y este paso las protege también.

**Comprobar:** abre la dirección en una ventana de incógnito. Debe pedirte tu correo y luego el código. Prueba también con un correo que no esté autorizado: no debe dejarlo pasar.

---

## Mantenimiento

- **Actualizar leyes:** corre el extractor (ver `README.md`) y luego doble clic en `subir-leyes-a-github.command`.
- **Agregar o quitar personas:** Zero Trust → Access → Applications → la app → Policies.
- **Notas personales:** cada quien guarda las suyas en su navegador; nunca se suben al sitio. Para respaldarlas, usen *Mis notas → Exportar*.
- **Correlaciones sugeridas:**
  1. Quien las sugiera las exporta y te pasa el archivo.
  2. Tú lo copias como `web/data/correlaciones_manuales.json`.
  3. Subes los cambios y todos las ven.
