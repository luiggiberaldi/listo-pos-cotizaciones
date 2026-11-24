# OP-2026-040 — Copia de los clientes de los casos de Cuentas por Cobrar a staging

**Fecha:** 23 de noviembre de 2026
**Tipo:** operación de datos en **staging** (la copia de pruebas). Producción **solo se leyó**.
**Sigue de:** [OP-2026-037](OP-2026-037_auditoria-reporte-carteras-abonos-cod.md), [OP-2026-038](OP-2026-038_auditoria-codigo-cxc.md) y [OP-2026-039](OP-2026-039_clientes-reportados-como-pagados.md).
**Autorización:** el usuario autorizó en el chat usar la llave de staging guardada en la PC y la llave de producción, esta última **solo para leer**.

## En resumen

- **Staging ya tiene los 41 clientes de los casos de CxC, idénticos a producción:** su deuda, sus pagos, sus despachos, sus devoluciones y sus cotizaciones.
- **Se verificó al centavo:** los 41 clientes tienen el mismo saldo, la misma cantidad de movimientos y el mismo detalle que en producción. Suman **$73.688,22**, igual que la cartera de producción. Los 147 despachos son idénticos. No quedó ninguna referencia rota.
- **En producción no se cambió nada.** Cada consulta a producción se hizo en modo de solo lectura.
- **Ya se puede estudiar caso por caso en staging** (REYKAR, Decoraciones Encendo, Albert, KIA 241, etc.) y probar ahí los arreglos de OP-2026-038 sin riesgo.

## Qué se copió

| Qué | Cantidad | Cómo |
|---|---|---|
| Clientes | 41 | Se reemplazaron con los datos de producción (35 ya existían en staging con datos de agosto) |
| Movimientos de cuentas por cobrar | 487 | Los de esos 41 clientes quedaron exactamente como en producción. Se borraron los movimientos viejos de staging de esos clientes que ya no existen en producción |
| Despachos (notas de despacho) | 147 | Todos los despachos enlazados a esos movimientos (71 eran nuevos en staging) |
| Cotizaciones y sus líneas | 147 y 439 | Cada despacho necesita su cotización |
| Líneas de despacho | 451 | |
| Devoluciones e intercambios | 22 y 8 | Sirven para estudiar los casos de Decoraciones Encendo y KIA 241 |
| Transportistas y vehículos | 36 (solo los que faltaban) y 3 | Los despachos los necesitan |
| Usuarios | 1 (Wendy Lozano) | Copiada **sin PIN y desactivada**, para no llevar credenciales a staging |

**Qué clientes son:** los 22 con deuda en producción, los que tienen pagos de más escondidos (Decoraciones Encendo, Adalberto Rojas, A_40, Carlos Escalona, Ferrechuros y otros) y los nombrados en los casos (Angel Pineda, Punto Amarillo, Ali Rafael Vargas, Carlos Pacheco). La regla exacta está en [`OP-2026-040_scripts/set.sql`](OP-2026-040_scripts/set.sql).

## Cómo se comprobó

- **Clientes:** por cada uno de los 41 se comparó entre producción y staging el saldo, el saldo a favor, la cantidad de movimientos, la suma de montos y una "huella" de cada movimiento (identificador, tipo, monto, despacho, forma de pago y referencia). **0 diferencias.**
- **Saldos recalculados:** en staging se recalculó cada saldo con la misma fórmula de la base de datos (cargos − abonos, sin bajar de 0). Coincide con el saldo guardado en los 41.
- **Despachos:** la huella de los 147 (número, estado, total y forma de pago) es idéntica en las dos bases.
- **Referencias rotas:** 0 antes y 0 después (por ejemplo, ningún pago apunta a un despacho que no exista).

## Detalles a tener en cuenta

- **Copia "congelada" al 23-nov-2026 (tarde).** Si administración registra pagos nuevos en producción, staging no se entera. Para refrescarla se vuelven a ejecutar los programas de [`OP-2026-040_scripts/`](OP-2026-040_scripts/).
- **27 líneas de productos** apuntan a productos que no existen en staging. Esas líneas quedaron sin enlace al producto, como pasa cuando un producto se borra. No afecta los montos ni la deuda.
- **El número de despacho 3184 está repetido en staging:** uno es una prueba vieja ("TEST R17 CLIENTE") y otro es el despacho real de KIA 241. Ese número no tiene que ser único, así que no rompe nada, pero conviene saberlo al buscar por número.
- **Contadores de numeración:** se subieron para que los próximos despachos y cotizaciones de prueba no repitan números de los copiados.
- **La "cuenta" (empresa) tiene otro identificador en staging.** Se tradujo al copiar. Los clientes, vendedores y despachos conservan el mismo identificador que en producción.
- **Se cargó sin disparar las reglas automáticas de la base.** Así los datos quedan idénticos a producción. Por ejemplo, la regla de comisión de flete no recalculó nada.

## Respaldo y vuelta atrás

- Antes de copiar se guardó un respaldo de staging de **clientes (801), cuentas por cobrar (505) y despachos (1.357)** en la PC, en `.tmp-op040/respaldo-staging-2026-11-23/`. Esa carpeta **no se sube a GitHub** porque tiene datos de clientes.
- **Ojo:** las cotizaciones, líneas, devoluciones y vehículos de staging que ya existían se sobrescribieron con la versión de producción, y **esas tablas no están en el respaldo**. Como eran versiones viejas de esos mismos registros, no se perdió trabajo de pruebas conocido.
- La copia se hizo como **una sola operación**: si algo fallaba, no entraba nada. Hubo dos intentos que fallaron por los números de despacho y cotización, y no dejaron ningún cambio a medias.

## Detalle técnico

- Acceso: API de administración de Supabase con la llave de cada entorno, guardada en `.env` (producción) y `construacero-staging/.env` (staging). Las consultas a producción iban con `read_only: true` y un filtro que rechaza cualquier orden de escritura.
- Programas: [`lib.py`](OP-2026-040_scripts/lib.py) (acceso), [`copiar.py`](OP-2026-040_scripts/copiar.py) (prepara y ejecuta la copia; sin `--ejecutar` solo muestra conteos) y [`verificar.py`](OP-2026-040_scripts/verificar.py) (comparación). Necesitan los archivos `ids.json` y `miss.json` de `.tmp-op040/`, que se generan con las consultas de la regla de selección.
- Carga dentro de una transacción con `session_replication_role = replica`, `overriding system value` para conservar los números y una comprobación de integridad de 32 relaciones antes del `commit`.

## Pendiente / sin verificar

- No se revisaron todavía las pantallas de staging con estos clientes (ficha y reporte de CxC); solo se verificaron los datos.
- El estudio caso por caso (REYKAR, Decoraciones Encendo, los pagos de más) y los arreglos de OP-2026-038 siguen pendientes.
- Seguridad: la llave de producción que se pegó en el chat de la sesión anterior todavía hay que borrarla (supabase.com → foto → Access Tokens). Si se borra, esta copia no se puede refrescar hasta crear una llave nueva.
- Guardado en GitHub: pendiente.
