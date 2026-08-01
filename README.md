# SubGestor — versión de escritorio

App de control de inventario, pedidos y caducidad para un restaurante con
varias sucursales, ya conectada a una base de datos compartida (Supabase)
para que todas las computadoras vean los mismos datos.

## Credenciales de prueba

- Administrador General → usuario `1` / contraseña `1971`
- Administrador de Sucursal → usuario `100` / contraseña `1234`

## Cómo instalarla (método recomendado — sin instaladores, sin antivirus)

Si en alguna computadora hay un antivirus corporativo (como SentinelOne)
instalado y controlado por el departamento de sistemas de tu empresa,
generar un programa nuevo (como hace Electron) casi siempre se bloquea, y
tú no tienes forma de autorizarlo por tu cuenta. Este método evita ese
problema por completo: la app se "instala" directamente desde Chrome, sin
generar ningún programa nuevo — para el antivirus, sigue siendo solo una
página web, así que no la bloquea.

### Paso 1 — Publicar la app en internet (se hace una sola vez)

1. Sube esta carpeta a un repositorio de GitHub (puedes arrastrar los
   archivos directamente en github.com → "Create new repository" →
   "uploading an existing file").
2. Entra a vercel.com, inicia sesión con tu cuenta de GitHub, y haz clic en
   **"Add New… → Project"**.
3. Selecciona el repositorio que subiste y dale **"Deploy"**.
4. En **Project Settings → Environment Variables**, agrega las mismas dos
   variables que están en el archivo `.env` de esta carpeta:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

   (Cópialas del archivo `.env` que ya viene en este proyecto.)
5. Vuelve a desplegar (Vercel lo hace automático al guardar las variables,
   o puedes forzarlo desde "Deployments → Redeploy").
6. Al final te da una URL pública (algo como `subgestor.vercel.app`).

### Paso 2 — Instalar la app en cada computadora

En **cada** computadora donde la vayan a usar (con Google Chrome o Microsoft
Edge):

1. Abre la URL que te dio Vercel.
2. En la barra de direcciones, del lado derecho, busca un ícono de
   **instalar** (una pantalla con una flechita hacia abajo, o similar).
   También puedes ir al menú de tres puntos (⋮) de Chrome → **"Instalar
   SubGestor..."** (o "Enviar, guardar y compartir" → "Instalar página como
   aplicación", según la versión de Chrome).
3. Confirma. Se crea un ícono de SubGestor en el escritorio/menú de inicio,
   y a partir de ahí abre en su propia ventana — sin la barra de
   navegador — igual que cualquier otro programa instalado.

Listo. Todas las computadoras que instalen esta misma URL comparten los
mismos datos en tiempo real (vía Supabase), sin importar el antivirus que
tengan.

## Alternativa: programa de escritorio con Electron

También dejé preparado un empaquetado con Electron (carpeta `electron/`)
que genera un instalador tradicional (.exe, .dmg). Es una buena opción
**solo si** la computadora no tiene un antivirus corporativo restrictivo
(por ejemplo, en una computadora personal con Windows Defender normal). Si
quieres intentarlo:

```bash
npm install
npm approve-scripts electron
npm approve-scripts esbuild
npm run electron        # prueba la app en una ventana
npm run dist:win        # genera el instalador .exe (en Windows)
npm run dist:mac        # genera el instalador .dmg (en Mac)
```

Si tu computadora tiene un antivirus como SentinelOne, CrowdStrike, o
similar administrado por tu empresa, es muy probable que este método falle
sin que tú puedas solucionarlo (requiere que el departamento de sistemas
autorice el programa) — en ese caso, usa el método de instalación desde
Chrome de arriba.

## Cómo conectamos la base de datos compartida

Ya está todo configurado — el archivo `src/App.jsx` usa
`src/storage.supabase.js`, que se conecta a tu proyecto de Supabase usando
las credenciales del archivo `.env`. Si alguna vez necesitas volver a usar
solo almacenamiento local (sin compartir entre computadoras), cambia en
`src/App.jsx` la línea:

```js
import { loadState, saveState, deleteState, subscribeToChanges } from "./storage.supabase.js";
```

por:

```js
import { loadState, saveState, deleteState, subscribeToChanges } from "./storage.js";
```

## Estructura del proyecto

```
subgestor-desktop/
├── public/
│   ├── manifest.webmanifest   # Hace la app instalable desde Chrome
│   ├── sw.js                    # Service worker mínimo (requisito de instalación)
│   └── icon-*.png                # Íconos de la app
├── electron/
│   └── main.cjs                  # Alternativa: ventana de escritorio (Electron)
├── src/
│   ├── main.jsx                   # Punto de entrada de React
│   ├── App.jsx                     # Toda la aplicación (SubGestor)
│   ├── storage.js                  # Almacenamiento LOCAL (por computadora)
│   └── storage.supabase.js         # Almacenamiento COMPARTIDO (activo por defecto)
├── .env                              # Credenciales de Supabase (ya configuradas)
├── package.json
└── vite.config.js
```
