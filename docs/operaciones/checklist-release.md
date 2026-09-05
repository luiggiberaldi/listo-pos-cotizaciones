# Checklist de release

> Condensado accionable. El detalle de cada paso vive en los runbooks enlazados. Copiar esta lista en la sesión de `BITACORA.md` correspondiente e ir marcando.

## 0. Clasificación del cambio

- [ ] ¿Toca BD? → paquete SQL con preflight/rollback/postflight (seguir `../runbooks/promocion-release.md`).
- [ ] ¿Toca Worker? → `worker.js` / `api/handlers/*` con rutas y guards revisados.
- [ ] ¿Toca Frontend? → hooks/vistas/PDFs; build limpio.
- [ ] ¿Es financiero o de comisiones? → aplicar la regla ×2 de E2E y backup de cuerpos vivos (obligatorio).

## 1. En staging (siempre primero)

- [ ] Migración/paquete aplicado con verificación post-apply (objetos + cuerpo vivo).
- [ ] E2E completo **123/123**; **×2 pasadas** si es financiero/comisiones (`../runbooks/deploy-staging.md`).
- [ ] Sin residuos de fixtures (los usuarios/despachos tester se limpian solos; verificar).
- [ ] Cadena de redefiniciones auditada si un `CREATE OR REPLACE` toca funciones existentes (lección 262→263).

## 2. Build y tests del principal

- [ ] Vitest en verde (referencia actual: 319/319).
- [ ] `npm run build` OK (warning conocido de chunks > 500 kB permitido).
- [ ] Los cambios del árbol staging están portados o son compatibles con el principal (verificar firmas de RPC).

## 3. Aplicación en producción

- [ ] Backup de cuerpos vivos con SHA registrado en `BITACORA.md`.
- [ ] Preflight read-only → apply → smoke → postflight, en ese orden (`../runbooks/rollback-base-de-datos.md` tiene el plan B).
- [ ] Toggles de comportamiento nuevo arrancan **OFF**; encendido como paso operacional separado.
- [ ] Smoke por rama de negocio: comisiones (evidencia `calculo_evidencia`), devoluciones cuadradas, reportes coherentes, 401 en rutas nuevas sin sesión.

## 4. Deploy de aplicación (si aplica)

- [ ] Worker: solo vía GitHub Actions (`deploy-worker.yml`); job en verde.
- [ ] Frontend: deployment de Vercel "Ready"; smoke app 200 + `/api/ping` 200 + ruta auth 401 (`../runbooks/deploy-produccion.md`).
- [ ] Anotar versión/commit desplegado en la bitácora.

## 5. Cierre documental

- [ ] `CHANGELOG.md`: entrada de versión con Added/Changed/Fixed/Security/Validation/Migration notes.
- [ ] `BITACORA.md`: sesión con objetivo, ejecución, validación y lecciones.
- [ ] `matriz-migraciones.md`: estado ✅ con evidencia (o ⚠️/❓ según corresponda).
- [ ] `ROADMAP.md`: cerrar pendientes completados; abrir los nuevos.
- [ ] `git diff --check` limpio y working tree sin archivos ajenos al release.
