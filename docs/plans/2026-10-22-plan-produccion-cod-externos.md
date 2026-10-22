# Plan de producción — Códigos externos en despachos (2026-10-22)

## En resumen

- El arreglo de **códigos externos** está listo para producción: **687/687 pruebas en verde**, build sin errores y **sin cambios en la base de datos**.
- El arreglo del **"Verificando…" (el PIN)** **NO** va a producción: se queda solo en staging, como pediste. Verificado: el archivo del PIN en el árbol de producción tiene **cero cambios**.
- La promoción es solo código: se guarda el trabajo y se sube a la rama principal (`main`); el sistema publica solo lo que está en la carpeta raíz (producción), nunca la carpeta `construacero-staging/`.
- Riesgo bajo y reversible: si algo sale mal, se vuelve atrás con dos clics (frontend) y un comando (Worker).

---

## 1. Qué va a producción

Solo el arreglo de **códigos externos** (corregir los códigos de productos externos de un
despacho **antes de aprobarlo**):

| Archivo | Qué hace |
|---|---|
| `api/handlers/despachos.js` | Nueva función que guarda la corrección de códigos (permisos + validaciones) |
| `worker.js` | Registra la nueva ruta `/api/despachos/editar-codigos-externos` |
| `src/components/despachos/CodigosExternosEditor.jsx` | Nuevo: el editor de códigos en la tarjeta del despacho |
| `src/components/despachos/DespachoCard.jsx` | Muestra el botón y el flujo para editar códigos |
| `src/hooks/useDespachos.js` | Conecta la pantalla con la nueva ruta |
| `src/components/despachos/__tests__/CodigosExternosEditor.test.js` | 6 pruebas de la pantalla |
| `api/handlers/__tests__/codigosExternos.test.js` | 8 pruebas del endpoint |
| `vitest.config.js` y `.gitignore` | Registran las pruebas nuevas |
| `BITACORA.md` | Notas de la sesión |

## 2. Qué NO va a producción (regla del usuario)

- El arreglo del **"Verificando…" (PIN)**: `construacero-staging/src/components/auth/LoginPinModal.jsx`
  y sus pruebas → **solo staging**.
- Verificación hecha: `src/components/auth/LoginPinModal.jsx` (árbol de producción) tiene
  **0 cambios** según git. Producción conserva su PIN tal cual.
- También se quedan en staging: la herramienta de puertos de desarrollo (`free-dev-ports.mjs`)
  y los cambios de configuración de desarrollo.

## 3. Evidencia (2026-10-22)

- Pruebas unitarias: **687/687 en verde** (incluye las 14 pruebas nuevas del arreglo:
  6 de pantalla + 8 del endpoint).
- Build de producción: **OK** (solo el warning conocido de bundles grandes, no bloquea).
- Base de datos: **sin cambios** → nada que aplicar, nada que respaldar por este release.

## 4. Pasos de promoción (cuando se diga "vamos")

1. **Guardar el trabajo en dos bolsas separadas** (dos commits):
   - (a) **producción**: el arreglo de códigos externos + pruebas + notas.
   - (b) **staging**: el arreglo del PIN + espejo del arreglo de códigos + herramientas de desarrollo.
   - Así producción **jamás** recibe el arreglo del PIN.
   - La captura suelta del escritorio (`2026-08-31 ...png`) **no** se sube.
2. **Subir a `main`** → se publica solo: Worker vía GitHub Actions y frontend vía Vercel.
3. **Verificar**: GitHub Actions en verde y Vercel en "Ready".
4. **Humo en producción**:
   - La app abre (200) y `/api/ping` responde (200).
   - Una ruta protegida sin sesión devuelve **401** (el candado está activo).
   - Corregir un código externo en un despacho pendiente y confirmar que el cambio se guarda
     y se ve. *(Este paso toca datos reales: lo hace el usuario sobre un despacho de prueba,
     o indica cuál despacho se puede tocar.)*
5. **Anotar** el commit publicado en la bitácora.

## 5. Si algo sale mal (rollback)

- **Frontend**: Vercel → "Instant Rollback" al deployment anterior (dos clics).
- **Worker**: `npx wrangler rollback` (o re-desplegar el commit anterior).
- Después del rollback se repite el humo.

## 6. Nota honesta sobre la prueba E2E de 123 pasos

- Esa prueba grande tiene un problema **viejo desde septiembre**: el cambio de login por
  dispositivos (sesiones de operador) la dejó desactualizada y hoy se detiene en el primer
  paso de acceso. **No es por este arreglo** — lleva semanas así.
- Opciones: promover con la evidencia actual (pruebas + humo + rollback fácil), o primero
  reparar el E2E (trabajo aparte) y promover con la red de seguridad completa.
