# Migración 283 (flota) en STAGING — resumen — 2026-10-28

## En resumen

- **La 283 ya estaba aplicada en staging** desde el 26/10 (alrededor de las 23:13 UTC, según la fecha de
  los vehículos), sin registro en esta carpeta. El script nuevo lo detectó y **se detuvo sin tocar nada**.
- **Lo instalado coincide con el archivo:** las 4 funciones tienen la misma lógica (solo cambian los
  comentarios), permisos correctos (el navegador no puede escribir ni llamar las funciones) y el reporte responde.
- **El "botón de deshacer" (reversa) funciona:** se probó en modo simulacro (se ejecuta y se cancela solo).
  Quita todo lo de flota sin tocar notas ni cotizaciones, y staging quedó idéntico (misma huella del dinero).
- **No se escribió nada en staging** en esta sesión.

## Evidencias (salida literal del script)

| Archivo | Qué es |
| :--- | :--- |
| `apply-283-flota-staging-2026-10-29-03-04-04.md` | Intento de aplicación: detenido por el candado ("ya está aplicada"). |
| `apply-283-flota-staging-2026-10-29-03-04-31.md` | Verificación de solo lectura: estructura, funciones vs archivo, permisos, datos, reporte. |
| `apply-283-flota-staging-2026-10-29-03-05-27.md` | Simulacro de reversa con huella antes y después. |

(Los nombres llevan la hora UTC, que ya es 29/10.)

Script: `construacero-staging/scripts/apply-283-flota-staging.mjs`, con tres modos:
- normal: aplica, prueba la reversa y vuelve a aplicar (se niega si ya está);
- `STAGING_283_MODO=verificar`: solo lectura;
- `STAGING_283_MODO=probar-reversa`: simulacro que no deja cambios.

Todos exigen `STAGING_283_CONFIRM=APLICAR_283_STAGING` y solo apuntan a `spupqgkdsgohxxfoxydl`.

## Estado de los datos de flota en staging

| Dato | Valor |
| :--- | :--- |
| Vehículos | 5 (CAM-01 a CAM-04 con placas `TST-00x` + "Camión Test" `TEST-00`), todos de prueba |
| Choferes locales con camión fijo | 55, **todos con el mismo camión** |
| Viajes de choferes locales | **0**, así que el reporte de flota sale en cero |
| Viajes marcados como estimados (≈) | 0 |
| Último despacho en staging | 2026-10-22 |

**Qué significa:** la base de datos está lista, pero staging no tiene viajes de choferes locales. Para la
prueba a mano hay que crear algunos despachos con dos choferes locales en camiones distintos.

## Lo que falta para probar en staging

1. Publicar en staging el servidor (Worker) y la web de la rama `feat/flota-vehiculos-choferes`.
2. Prueba a mano: dos choferes turnándose los camiones; editar el pago de un despacho (el camión no debe
   cambiar); despachar una cotización con camión elegido; revisar el reporte y los PDF.

## Publicación en staging (2026-10-28, noche)

Staging no vive en internet: corre en esta computadora (web en `localhost:5174`, servidor en `localhost:8789`,
base de datos de pruebas `spupqgkdsgohxxfoxydl`). Se levantaron ambos desde la rama `feat/flota-vehiculos-choferes`
con `.claude/launch.json` (configuraciones `staging-api` y `staging-web`).

| Comprobación | Resultado |
| :--- | :--- |
| Servidor staging responde y apunta a `spup…` | ✅ (control del tester: HTTP 200 → `spupqgkdsgohxxfoxydl`) |
| Rutas nuevas `/api/vehiculos/listar` y `/api/reportes/flota-choferes` | ✅ existen (piden inicio de sesión: 401, no 404) |
| Web staging usa la base de pruebas y trae la pantalla de flota | ✅ |
| Prueba completa E2E (123 pasos) | ❌ **no corrió**: el inicio de sesión de prueba de `.env` es rechazado ("Invalid login credentials"). |

**Incidente menor corregido:** el primer arranque de la web tomó por error la configuración del proyecto
principal (carpeta raíz). Se detectó porque el tester de staging se frenó en su primer control; nadie inició
sesión ni se hizo ninguna operación. Se apagó y se levantó desde `construacero-staging/`.

**Pendiente:** el usuario de prueba del E2E debe regenerarse con `npm run provision:e2e:staging` (crea o
restablece la cuenta de prueba en staging y guarda la clave en `.env.e2e.local`), como hace el aviso nocturno.
Nota: según `seguimiento-avisos-nocturnos-20261026.md`, el tester E2E ya estaba a medio actualizar antes de
flota, así que puede fallar en pasos que no tienen que ver con camiones.

## Prueba completa E2E con el usuario de prueba regenerado

- `npm run provision:e2e:staging` → OK (cuenta de prueba `staging-e2e@listo.sys` restablecida; clave en `.env.e2e.local`).
- E2E: **42/123 pasos, se detiene en el paso 34** ("Liberar CxC y pagar comisión":
  `Comision no encontrada o ya pagada en su totalidad`). Log: `tmp/e2e-staging/tester-2026-10-29T03-10-16-388Z.log`.
- **Es exactamente el mismo resultado que antes de flota** (corrida del 26/10: 42/123, mismo paso y mismo mensaje,
  ver `seguimiento-avisos-nocturnos-20261026.md`). Es un problema pendiente del tester de comisiones, no de flota.
- Lo que sí demuestra: los 42 pasos que pasan incluyen crear, editar, aprobar, entregar y devolver despachos. Con el
  código de flota esos flujos siguen funcionando igual (sin regresiones). Los pasos 35–123 no llegaron a correr.
- El E2E no tiene pasos de flota: la prueba de camiones sigue siendo manual.
