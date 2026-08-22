# Deploy Worker + frontend — guardrails de inventario

## Alcance

Publicar el Worker `listo-pos-cotizaciones` junto con los assets del frontend generados por Vite, incluyendo la migración de los writes de `productos.imagen_url` y `productos.activo` a `PATCH /api/productos/metadatos`.

## Pre-flight

- Endpoint presente en `worker.js` y `api/handlers/inventario.js`.
- `useDesactivarProducto` usa `authFetch('/api/productos/metadatos')`.
- `ProductoForm` usa `authFetch('/api/productos/metadatos')` para guardar la imagen.
- `npm test`: **251/251 PASS** (25 archivos).
- ESLint focalizado: **0 errores**; 38 warnings heredados/no funcionales.
- `node --check worker.js` y `node --check api/handlers/inventario.js`: PASS.
- `git diff --check`: PASS.

## Aplicación ejecutada

Comando autorizado:

```bash
npm run build && npx wrangler deploy
```

Resultado:

- Build Vite: **PASS**.
- Assets leídos: 87.
- Assets nuevos/modificados subidos: 38.
- Tamaño del Worker: 441.06 KiB sin comprimir / 78.53 KiB gzip.
- Worker publicado: `listo-pos-cotizaciones`.
- URL: https://listo-pos-cotizaciones.luigistorelogistics.workers.dev
- Version ID: `3332f285-068c-426d-a0d6-30738564a460`
- Binding `ASSETS`: frontend incluido en la misma publicación.
- Bindings de Supabase y AI presentes según la salida de Wrangler.

## Verificación post-deploy

- `wrangler deployments list`: la versión `3332f285-068c-426d-a0d6-30738564a460` quedó al 100%.
- Smoke test HTTP de la URL publicada: **200 OK**.
- Título recibido: `Construacero Carabobo`.
- El endpoint autenticado no se invocó con un PATCH de prueba para evitar mutar un producto real durante la verificación automática.

## Estado

✅ Deploy completado. El frontend publicado ya contiene las llamadas al endpoint de metadatos y el Worker las enruta al handler con `service_role`, validación de operador/tenant y auditoría best-effort.

## Siguiente control operativo

Probar manualmente, con un usuario autorizado y un producto de prueba controlado, activar/desactivar y guardar/quitar una imagen; luego confirmar en auditoría que se registró el cambio. No aplicar todavía el `06` completo hasta migrar el cleanup de `TesterFlowView` y las RPC legacy de producto, y volver a auditar los writes directos.
