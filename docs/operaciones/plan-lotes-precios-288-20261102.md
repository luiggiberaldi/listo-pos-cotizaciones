# Actualización masiva de precios: historial y restauración (migración 288)

**Fecha:** 2026-11-02 · **Estado:** aplicada y verificada en **staging** (2026-11-02). **Aplicada en producción el 2026-11-02** con autorización del dueño: tablas y funciones creadas, permisos verificados (`anon` y `authenticated` sin acceso), 0 lotes y 471 productos sin cambios. Respaldo de precios previo guardado solo en el computador (no en git): `supabase/release/main/backup_pre_288/`.

## En resumen

Cada cambio masivo de precios ahora se guarda como un "lote" con los precios de antes y de después de cada producto. Eso permite:

- **Deshacer** justo después de confirmar (botón en la pantalla de éxito).
- **Restaurar** cualquier cambio reciente desde "Historial de cambios de precios" (se guardan unos 60 días).

Al restaurar, cada producto vuelve a su precio anterior, **salvo los que se hayan modificado después**: esos no se tocan y se informa cuántos fueron. Todo se hace de una sola vez (o cambia todo o no cambia nada).

## Qué cambia en el sistema

| Pieza | Cambio |
|---|---|
| Base de datos (288) | 2 tablas nuevas (`productos_precio_lotes`, `productos_precio_lote_items`) y 2 funciones (`aplicar_lote_precios`, `restaurar_lote_precios`). No toca ningún dato existente. |
| Servidor (Worker) | El cambio masivo ahora usa `aplicar_lote_precios`. Rutas nuevas: `GET /api/productos/batch-price/lotes` y `POST /api/productos/batch-price/restaurar`. |
| Pantalla | Modal más ancho, vista previa en tiempo real, pantalla de éxito con **Deshacer** e historial con **Restaurar**. |

## Reglas de seguridad

- Solo administración, jefe y desarrollador pueden cambiar, ver el historial y restaurar.
- La cuenta siempre es la de quien tiene la sesión iniciada; nunca la que envíe el navegador.
- Si un precio cambió entre la vista previa y la confirmación, **no se cambia nada** y se pide revisar de nuevo.
- Un lote no se puede restaurar dos veces.
- El navegador no puede leer ni escribir estas tablas ni ejecutar las funciones (solo el Worker).

## Ensayo en base local (9 casos, todos correctos)

Aplicar un lote · rechazar si el precio cambió antes (sin dejar rastro) · rechazar producto de otra cuenta · rechazar precio negativo · restaurar saltando el producto editado después · no restaurar dos veces · no restaurar desde otra cuenta · `anon` sin acceso a tablas ni función · el lote queda con quién lo hizo y el resultado.

## Verificación en staging (2026-11-02, productos reales, dentro de una transacción que se deshizo)

Aplicar un lote de +10 % a 3 productos reales · los 3 precios subieron bien · restaurar con uno de ellos editado a mano después: 2 restaurados, 1 omitido y el editado **no se pisó** · segunda restauración rechazada (`LOTE_YA_RESTAURADO`) · `anon` y `authenticated` sin acceso a las tablas ni a las funciones · tras la prueba quedaron 0 lotes y los 458 productos sin cambios.

## Orden para publicar (cuando el dueño autorice)

1. **Staging:** aplicar `construacero-staging/supabase/migrations/288_staging_lotes_precios_restaurar.sql`, probar en pantalla.
2. **Producción, base de datos primero:** aplicar `supabase/release/main/288_lotes_precios_restaurar_apply.sql` (con respaldo previo). Es solo crear cosas nuevas.
3. **Después** publicar el Worker y la web (unir el PR). Si el Worker nuevo sale antes que la 288, "Confirmar actualización" fallará con un error del servidor.
4. Reversa si hiciera falta: `288_lotes_precios_restaurar_rollback_review.sql` (quita tablas y funciones; los precios actuales no cambian).
