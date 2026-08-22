# Operación de backup del proyecto principal

**Fecha:** 2026-08-22  
**Entorno:** principal (`oyfyuszgjwcepjpngclv`)  
**Alcance:** respaldo lógico local y respaldo administrado nativo de Supabase.

## Cambio aplicado al runner local

`scripts/backup-kardex-main.mjs` ahora permite hasta **30 minutos** para `pg_dump`:

```js
const PG_DUMP_TIMEOUT_MS = 30 * 60 * 1000
```

Uso:

```bash
npm run backup:kardex:main
```

El runner:

1. Lee la conexión protegida desde `.env`.
2. Verifica que el host corresponda al proyecto principal.
3. Ejecuta `pg_dump` en formato custom.
4. Escribe el archivo en `tmp/backups/`.
5. Calcula y muestra el SHA-256.

El límite de 30 minutos evita que el proceso local aborte mientras el endpoint PostgreSQL de Supabase reduce temporalmente el throughput de descargas grandes. No cambia el comportamiento de la base ni ejecuta escrituras.

## Backup nativo del dashboard de Supabase

Usar el backup nativo cuando se necesite un punto de recuperación administrado por Supabase o cuando la descarga directa con `pg_dump` sea demasiado lenta.

### Captura manual

1. Abrir el **Supabase Dashboard** y seleccionar el proyecto principal correcto.
2. Entrar a **Database → Backups**. Según la versión del dashboard, la opción puede aparecer dentro de **Project Settings → Database → Backups**.
3. Verificar el proyecto/ref antes de continuar.
4. Usar **Create backup** o la acción equivalente de respaldo manual, si está disponible para el plan.
5. Esperar hasta que el estado sea **Completed/Ready**; no considerar suficiente un backup `In progress` o `Failed`.
6. Registrar fuera del repositorio:
   - project ref;
   - fecha y hora UTC;
   - identificador o timestamp del backup;
   - estado final;
   - tamaño o información de retención mostrada por el dashboard;
   - alcance indicado por Supabase.
7. Si el plan ofrece descarga, descargar el archivo desde la acción **Download** y conservarlo en almacenamiento seguro separado del checkout.
8. Calcular un checksum local del archivo descargado:

```powershell
Get-FileHash .\backup-descargado.dump -Algorithm SHA256
```

En Bash:

```bash
sha256sum backup-descargado.dump
```

### Uso para recuperación

- No restaurar sobre el principal para hacer una prueba.
- Probar cualquier recuperación primero en una base **disposable** y validar conteos, tablas clave y funciones esperadas.
- Antes de una migración o cambio de grants, capturar el backup nativo inmediatamente antes y registrar su identificador.
- La restauración administrada puede ser destructiva o reemplazar el estado del proyecto; requiere una ventana aprobada y un plan de rollback independiente.

## Cobertura y limitaciones

- El backup nativo es el mecanismo preferido para recuperación operativa administrada por Supabase.
- `pg_dump` sigue siendo útil como exportación lógica portable y para validar localmente con `pg_restore --list`.
- No asumir que un backup de base de datos incluye automáticamente archivos de Storage, secretos, configuración del dashboard, dominios o recursos externos; verificar el alcance que muestra el propio dashboard.
- Para un backup operativo, conservar al menos una copia nativa y, cuando sea necesario, una copia lógica local con checksum.
- Los archivos de backup y las credenciales nunca deben subirse a Git ni incorporarse a la documentación.

## Criterio ante lentitud

| Situación | Acción |
|---|---|
| `pg_dump` termina antes de 30 min | Validar archivo y SHA-256; ejecutar `pg_restore --list`. |
| `pg_dump` tarda más de lo habitual pero sigue avanzando | Esperar hasta el límite de 30 min; no lanzar copias duplicadas simultáneas. |
| `pg_dump` alcanza 30 min o falla por red | Usar el backup nativo del dashboard y registrar el incidente. |
| Se requiere recuperación urgente | Usar el snapshot nativo más reciente y seguir el procedimiento de restauración en disposable primero, si el tiempo lo permite. |
