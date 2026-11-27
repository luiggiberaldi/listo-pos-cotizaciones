# OP-2026-028 — Respaldo semanal también en Google Drive (datos + código)

**Fecha:** 2026-11-15 · **Estado:** funcionando y probado (prueba real 2026-11-15) · **Entorno:** lee producción (solo lectura), guarda en la PC y en Google Drive

## En resumen

- Antes, el respaldo de cada sábado se guardaba **solo en la PC**. Si la PC se dañaba, se perdían también las copias.
- Ahora, cuando la copia de la PC sale bien, **se copia también a Google Drive** (cuenta `construacerotutoriales@gmail.com`, carpeta **Mi unidad → construacero-respaldos**). Se guardan las **4 últimas semanas**, igual que en la PC.
- Además de los datos, ahora se guarda el **código del sistema**, incluidos los programas de respaldo, que **no estaban en GitHub**. **No** se guardan contraseñas ni llaves (archivos `.env`).
- La carpeta de Drive es **privada**. No compartirla nunca: tiene datos de clientes.

## Qué se guarda cada semana en Drive

Una carpeta `semanal-AAAA-MM-DD-HH-MM` con:

| Archivo | Qué es | Tamaño (prueba) |
|---|---|---|
| `datos.zip` | La base de datos completa y los 1.263 archivos (documentos y fotos) | 76,6 MB |
| `codigo.zip` | El código tal como está hoy en la PC (1.861 archivos), incluidos los cambios aún sin publicar y la carpeta `scripts/` | 17,4 MB |
| `historial-git.bundle` | El historial completo del código (todas las versiones y ramas). Sirve para recrear el proyecto aunque no exista GitHub | 49,7 MB |
| `resumen.json` | La hoja que confirma que la copia coincide con producción | — |

Son unos 145 MB por semana, menos de 600 MB en total con 4 semanas.

## Cómo funciona

1. Google Drive para escritorio (instalado el 2026-11-15) crea en la PC la unidad **G:\Mi unidad**, que se sube sola a la nube.
2. `scripts/backup-semanal.mjs` (paso 5 nuevo) arma los archivos en una carpeta temporal, los copia a `G:\Mi unidad\construacero-respaldos\`, comprueba que los tamaños coincidan y borra la semana más vieja. Lo borrado va a la papelera de Drive, donde se puede recuperar durante 30 días.
3. La tarea programada **"Respaldo semanal de producción"** (sábados 7 pm) ya avisa si falla la parte de Drive.
4. Si Drive falla, la copia de la PC **sigue siendo válida**, pero el resultado sale como **"REVISAR"** para que te enteres. Lo más común es que Google Drive para escritorio esté cerrado o haya cerrado sesión.

## Prueba realizada (2026-11-15)

- **Primer intento: falló la parte de Drive.** Un archivo con "ñ" y tildes en el nombre (`construacero-staging/public/Diseño sin título (57).png`) no se podía leer con el método de lista. Se cambió el método: ahora el código se copia a una carpeta temporal y se comprime entera. Además, el script ahora cuenta los archivos del zip y avisa si falta alguno.
- **Segundo intento: todo OK.** 90 tablas, 68.599 filas, 1.263 de 1.263 archivos, conteos iguales a producción. Comprobado:
  - `codigo.zip` se abre y tiene los 1.861 archivos, incluido el de la "ñ". No contiene `.env` ni llaves; solo los `.env.example`, que son plantillas sin datos reales.
  - `historial-git.bundle` pasó la verificación de git (está completo).
  - Con el conector de Google Drive se confirmó que la carpeta y los archivos están **en la nube** y que su visibilidad es **privada**.
- Efecto secundario normal: las pruebas crearon 2 copias extra en la PC y la rotación borró las 2 copias más viejas (`semanal-2026-11-07-*`).

## Qué NO cubre (pendiente o a tener en cuenta)

- **Verificado en la nube (2026-11-15, con el conector de Drive):** los 4 archivos están en Drive. `datos.zip` tiene el mismo tamaño que en la PC (80.286.844 bytes) y los 4 son privados. El más pesado tardó unos 3 minutos en terminar de subir.
- **El primer sábado automático (2026-11-21) todavía no ha ocurrido.** Conviene confirmar ese día que la tarea informe "Drive OK".
- Los programas de respaldo (`scripts/`) siguen **fuera de GitHub**, por la regla `scripts/*` de `.gitignore`. Desde hoy quedan protegidos en `codigo.zip` cada semana. Por eso este cambio no tiene solicitud de cambio ni commit.
- No hay contraseña en los zip (se decidió así por simplicidad). La protección es que la carpeta de Drive es privada.
- Si un sábado la PC está apagada, ese respaldo no se hace (no cambió respecto a antes).

## Cómo recuperar algo desde Drive

1. Entrar a drive.google.com con `construacerotutoriales@gmail.com` → **Mi unidad → construacero-respaldos**.
2. Abrir la semana que interese y descargar `datos.zip` o `codigo.zip`.
3. Para restaurar la base de datos, pedir ayuda: es una operación delicada de producción y debe hacerse con un plan propio.
