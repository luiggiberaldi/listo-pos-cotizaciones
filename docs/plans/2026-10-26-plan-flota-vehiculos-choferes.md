# Plan Corregido — Control de Flota Propia (Vehículos) y Productividad de Choferes Locales

**Proyecto:** Construacero POS (`listo-pos-cotizaciones`)
**Fecha:** 2026-10-26
**Estado:** plan listo para implementar (versión corregida del plan original del 2026-10-26)
**Alcance:** Transportistas Locales (`es_local = true`), Cotizaciones, Notas de Despacho y Reportes Gerenciales

---

## En resumen

La idea del plan original era correcta: **separar al chofer del camión** y guardar en cada viaje
con qué camión salió, para poder medir la productividad de cada uno de los 4 vehículos y de cada
chofer por separado. Esta versión conserva ese diseño y **corrige los defectos que impedían
ejecutarlo**: nombres de columnas que no existían en la base de datos real, un paso que borraba
cotizaciones de venta, una carga histórica que repetía el error que el plan quería evitar, y una
métrica que contaba el flete dos veces. El proyecto se estima en **aproximadamente una semana**
(2 días base de datos + servidor, 1 día de pantallas, 1 día de reportes y PDFs, más pruebas y la
ventana de revisión antes de tocar producción).

**Para implementar hay que respetar los raíles de la sección 9** — son las reglas que protegen
los datos de la empresa y el historial contable.

---

## 1. Arreglos aplicados respecto del plan original

| # | Problema del plan original | Arreglo aplicado |
| :-- | :--- | :--- |
| 1 | El SQL usaba columnas inexistentes (`created_at`, `placa`, `capacidad_kg`): **no corría**. | Todos los SQL usan los nombres reales: `creado_en`, `actualizado_en`, `placa_chuto`, `placa_batea`, `vehiculo`, `capacidad`. |
| 2 | Al eliminar un vehículo se **borraban cotizaciones de venta** (`DELETE FROM cotizaciones`). | Ahora solo se **desenlazan** (se deja el campo vacío). Nunca se borran documentos de venta. |
| 3 | La carga histórica (backfill) estampaba a TODOS los viajes pasados el camión actual del chofer: repetía el problema que el plan quería resolver. | Carga conservadora: solo se enlazan choferes con placa confiable y cuenta asignada, y cada viaje viejo queda **marcado como estimado** (`vehiculo_origen = 'backfill'`, se muestra con `≈` en reportes). |
| 4 | "Mercancía movilizada" sumaba `total_usd`, que **ya incluye el flete y el corte**: las columnas del reporte no eran sumables. | Mercancía = `total_usd − flete_usd − corte_usd` (la mercancía real que viajó en el camión). |
| 5 | La Tabla 2 prometía comisiones y desglose Carabobo/Fuera, pero el SQL no las traía. | El reporte ahora suma las **copias exactas de comisión guardadas en cada viaje** y el desglose En Carabobo / Fuera de Carabobo. |
| 6 | Faltaba por completo la lógica de borrar/desactivar **choferes** (Caso 3: bloqueo por pagos pendientes). | Se agrega la función `eliminar_o_desactivar_transportista_atomico` con el bloqueo incluido. |
| 7 | Citaba rutas de servidor inexistentes (`/api/despachos/cambiar-transportista`, `/api/cotizaciones/venta-rapida`) y estilo REST que el enrutador no reconoce. | Rutas al estilo real del proyecto (`/api/vehiculos/crear`, `/api/despachos/editar-pago`, `/api/ventas-rapidas/crear`, …). |
| 8 | Las pruebas iban en `tests/…`, carpeta que la configuración de pruebas **nunca ejecuta**. | Pruebas en `api/handlers/__tests__/` y `src/utils/__tests__/` (donde el proyecto sí las corre). |
| 9 | La tabla nueva permitía escribir directamente desde el navegador. | Permisos de la casa: aislamiento estricto por cuenta y **solo el Worker escribe**. |
| 10 | La carpeta de migración (`release/main/25_…/02_migration.sql`) no sigue ninguna convención del proyecto. | Migración numerada `283` en `supabase/migrations/`, espejo en `construacero-staging/supabase/migrations/`, y paquete de promoción con preflight/postflight/rollback para la ventana autorizada. |
| 11 | Los PDFs (guías y notas de despacho) seguirían imprimiendo el camión de la ficha del chofer. | Los PDFs pasan a imprimir **el camión del viaje** (`notas_despacho.vehiculo_id`). |
| 12 | El reporte daba acceso al rol "supervisor", que hoy no ve pagos a choferes. | Roles alineados con el reporte de transportistas actual: jefe, administración, logística, desarrollador. El supervisor queda fuera salvo decisión expresa. |
| 13 | Los borrados no quedaban registrados. | Toda baja o reactivación se registra en la bitácora de auditoría. |
| 14 | No se validaba que el vehículo perteneciera a la cuenta. | El trigger rechaza vehículos de otra cuenta (`VEHICULO_NO_PERTENECE_A_LA_CUENTA`). |

---

## 2. La idea central (sin cambios)

- **Hoy:** la tabla `transportistas` mezcla a la persona (nombre, teléfono) con el camión
  (`vehiculo`, `placa_chuto`, `placa_batea`, `capacidad`, `color_batea`), y cada nota de despacho
  guarda solo `transportista_id`. Editar la ficha reescribe el pasado.
- **Propuesta:** separar en dos piezas — **el Chofer Local** (`transportista_id`) y **el Vehículo
  Propio** (`vehiculo_id`, nuevo catálogo `vehiculos`) — y grabar **ambos** en cada cotización y
  nota de despacho. Cada chofer local tiene un **vehículo habitual** que se autocompleta, pero el
  viaje guarda el camión real con el que salió.
- **Aplica solo a locales (`es_local = true`):** los transportistas externos siguen funcionando
  exactamente igual (sin vehículo).

---

## 3. Flujo funcional

### 3.1 Pantallas

Todo vive dentro de la pantalla actual de **Transportistas** (sin menús nuevos):

- **Franja superior — "Vehículos de la Empresa":** 4 tarjetas (una por camión) con nombre/apodo,
  placa, capacidad en kg, color/tipo de batea, estado (Activo / En Taller) y chofer asignado hoy.
  Botón `+ Nuevo Vehículo` por si entra un quinto camión.
- **Lista de transportistas:** igual que hoy, pero cada chofer local muestra su etiqueta
  `Vehículo fijo: CAM-01 NPR (A12BC3D)`.

### 3.2 Formularios

- **Nuevo vehículo:** código/nombre corto (obligatorio), placa (obligatoria, única por cuenta),
  capacidad en kg (opcional), color/tipo de batea (opcional).
- **Nuevo/editar transportista:** igual que hoy, y si marca `¿Es local?` aparece el selector
  **"Vehículo habitual asignado"** (lista de vehículos activos + opción *"Sin vehículo fijo /
  Rotativo"*).

### 3.3 Baja y reactivación (protección contable)

| Caso | Condición | Acción | Mensaje al usuario |
| :--- | :--- | :--- | :--- |
| 1. Creado por error | 0 viajes en su historial | **Borrado definitivo** | *"Se eliminó por completo porque no tenía viajes asociados."* |
| 2. Ya trabajó | ≥ 1 viaje en el historial | **Desactivación** (queda inactivo, no se borra) | *"Se marcó como Inactivo: sus viajes pasados siguen intactos en los reportes."* |
| 3. Chofer con fletes pendientes | Hay viajes sin liquidar al chofer | **Bloquea** la baja | *"No puedes desactivarlo todavía: tiene fletes pendientes por liquidar."* |

Efectos automáticos: al desactivar un **vehículo** se libera de los choferes que lo tenían como
habitual (quedan "Rotativo" y el sistema avisa); al desactivar un **chofer** se libera su camión.
Botón "Ver inactivos" para reactivar con un clic.

### 3.4 Día a día (cero fricción)

- **Vendedor (cotización y venta rápida):** elige al chofer como siempre; el camión habitual se
  autocompleta. Si hoy anda en otro camión, botón `[Cambiar vehículo]` para este viaje.
- **Logística (modal de despacho):** antes de marcar *Despachada/Entregada* ve chofer y camión;
  puede cambiar el camión para ese viaje, con casilla opcional
  `[ ] Dejar este vehículo como el nuevo camión fijo de este chofer`. Sin la casilla, el cambio
  aplica solo a ese viaje.

### 3.5 Reportes gerenciales (pestaña Transportistas)

Con el filtro de fechas habitual (Hoy / Semana / Mes / Rango):

**Cuadro 1 — Productividad por Vehículo:** vehículo y placa, viajes, fletes producidos ($),
mercancía movilizada ($) = `total − flete − corte`, ticket promedio de flete por viaje, y
desglose de choferes que lo condujeron (*Juan: 14 viajes / Pedro: 3 viajes*).

**Cuadro 2 — Productividad y Liquidación por Chofer Local:** viajes (En Carabobo vs. Fuera de
Carabobo), fletes generados ($), mercancía movilizada ($), **comisión generada / pagada /
pendiente por liquidar ($)** y desglose de vehículos usados
(*Camión 1: 14 viajes ($700) | Camión 3: 4 viajes ($220)*).

Los viajes cuyo camión viene del backfill se muestran con el símbolo `≈` ("estimado").
Exportación a PDF / Excel reutilizando los generadores que ya existen.

---

## 4. Diseño técnico corregido (PostgreSQL / Supabase)

### 4.1 Relaciones

- `vehiculos` (1) ⟶ (0..N) `transportistas.vehiculo_habitual_id` *(asignación por defecto)*
- `vehiculos` (1) ⟶ (0..N) `cotizaciones.vehiculo_id` *(vehículo presupuestado)*
- `vehiculos` (1) ⟶ (0..N) `notas_despacho.vehiculo_id` *(vehículo real del viaje — inmutable)*

### 4.2 Migración `283_flota_vehiculos_locales.sql`

> Nota de nombres: este sistema usa `creado_en` / `actualizado_en` (no `created_at`), las placas
> viven en `placa_chuto` / `placa_batea`, y la capacidad actual es texto (`capacidad`). Todo el
> SQL de abajo ya usa los nombres reales.

```sql
BEGIN;

-- ============================================================================
-- 1. CATÁLOGO DE VEHÍCULOS DE LA EMPRESA (FLOTA PROPIA)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vehiculos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id      UUID NOT NULL,
  codigo         TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  placa          TEXT NOT NULL,
  capacidad_kg   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (capacidad_kg >= 0),
  color_batea    TEXT,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculos_cuenta_placa
  ON public.vehiculos(cuenta_id, placa);
CREATE INDEX IF NOT EXISTS idx_vehiculos_cuenta_activo
  ON public.vehiculos(cuenta_id, activo);

CREATE TRIGGER trg_vehiculos_updated
  BEFORE UPDATE ON public.vehiculos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Permisos de la casa: aislamiento estricto por cuenta + lectura autenticada.
-- Sin INSERT/UPDATE/DELETE directos: solo el Worker (service_role) escribe.
ALTER TABLE public.vehiculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS isolation_vehiculos ON public.vehiculos;
CREATE POLICY isolation_vehiculos ON public.vehiculos
  AS RESTRICTIVE FOR ALL
  USING (cuenta_id = auth.uid());

DROP POLICY IF EXISTS vehiculos_lectura ON public.vehiculos;
CREATE POLICY vehiculos_lectura ON public.vehiculos
  FOR SELECT TO authenticated
  USING (cuenta_id = auth.uid());

-- ============================================================================
-- 2. VINCULACIONES (columnas nuevas, sin tocar datos existentes)
-- ============================================================================
ALTER TABLE public.transportistas
  ADD COLUMN IF NOT EXISTS vehiculo_habitual_id UUID
    REFERENCES public.vehiculos(id) ON DELETE SET NULL;

ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS vehiculo_id UUID
    REFERENCES public.vehiculos(id) ON DELETE SET NULL;

ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS vehiculo_id UUID
    REFERENCES public.vehiculos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vehiculo_origen TEXT
    CHECK (vehiculo_origen IN ('manual', 'auto_habitual', 'backfill'));

COMMENT ON COLUMN public.notas_despacho.vehiculo_origen IS
  'Cómo se asignó el vehículo: manual (operador), auto_habitual (trigger) o backfill (estimado histórico).';

CREATE INDEX IF NOT EXISTS idx_despachos_vehiculo_fecha
  ON public.notas_despacho(cuenta_id, vehiculo_id, creado_en)
  WHERE vehiculo_id IS NOT NULL;

-- ============================================================================
-- 3. BACKFILL CONSERVADOR (marcado como ESTIMADO, nunca como dato real)
--    - Solo choferes locales con cuenta asignada.
--    - Solo si tienen una placa confiable (chuto o batea); si no, se omite y se avisa.
--    - Los viajes históricos quedan con vehiculo_origen = 'backfill' (se muestra con ≈).
-- ============================================================================
DO $$
DECLARE
  r RECORD;
  v_vehiculo_id UUID;
  v_placa TEXT;
  v_despachos_marcados INT := 0;
  v_filas INT;
  v_sin_placa INT := 0;
  v_sin_cuenta INT := 0;
BEGIN
  SELECT COUNT(*) INTO v_sin_cuenta
  FROM public.transportistas
  WHERE es_local = true AND cuenta_id IS NULL;

  FOR r IN
    SELECT id, cuenta_id, nombre,
           COALESCE(NULLIF(btrim(COALESCE(placa_chuto, '')), ''),
                    NULLIF(btrim(COALESCE(placa_batea, '')), '')) AS placa_limpia,
           color_batea,
           vehiculo
    FROM public.transportistas
    WHERE es_local = true
      AND cuenta_id IS NOT NULL
      AND vehiculo_habitual_id IS NULL
  LOOP
    v_placa := upper(r.placa_limpia);
    IF v_placa IS NULL THEN
      v_sin_placa := v_sin_placa + 1;
      CONTINUE;  -- sin placa confiable no se inventa vehículo: revisión manual
    END IF;

    INSERT INTO public.vehiculos (cuenta_id, codigo, nombre, placa, color_batea)
    VALUES (
      r.cuenta_id,
      'VEH-' || substr(replace(v_placa, '-', ''), 1, 6),
      COALESCE(NULLIF(btrim(COALESCE(r.vehiculo, '')), ''), 'Vehículo ' || v_placa),
      v_placa,
      r.color_batea
    )
    ON CONFLICT (cuenta_id, placa) DO UPDATE SET actualizado_en = now()
    RETURNING id INTO v_vehiculo_id;

    UPDATE public.transportistas
    SET vehiculo_habitual_id = v_vehiculo_id
    WHERE id = r.id AND cuenta_id = r.cuenta_id;

    UPDATE public.notas_despacho
    SET vehiculo_id = v_vehiculo_id,
        vehiculo_origen = 'backfill'
    WHERE transportista_id = r.id
      AND cuenta_id = r.cuenta_id
      AND vehiculo_id IS NULL;
    GET DIAGNOSTICS v_filas = ROW_COUNT;
    v_despachos_marcados := v_despachos_marcados + v_filas;
  END LOOP;

  RAISE NOTICE 'Backfill flota: % despachos marcados como estimados; % choferes sin placa (revisar a mano); % choferes sin cuenta (omitidos)',
    v_despachos_marcados, v_sin_placa, v_sin_cuenta;
END $$;

-- ============================================================================
-- 4. TRIGGER: AUTOCOMPLETAR VEHÍCULO EN DESPACHOS LOCALES
--    - Externos: nunca llevan vehículo propio.
--    - Local sin vehículo explícito: hereda su vehículo habitual.
--    - Vehículo explícito de otra cuenta: rechaza el guardado.
--    - El origen solo se rellena si venía vacío (respeta el backfill).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_autocompletar_vehiculo_despacho()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_es_local BOOLEAN;
  v_habitual_id UUID;
  v_cuenta_vehiculo UUID;
BEGIN
  IF NEW.transportista_id IS NULL THEN
    NEW.vehiculo_id := NULL;
    NEW.vehiculo_origen := NULL;
    RETURN NEW;
  END IF;

  SELECT es_local, vehiculo_habitual_id
  INTO v_es_local, v_habitual_id
  FROM public.transportistas
  WHERE id = NEW.transportista_id AND cuenta_id = NEW.cuenta_id;

  IF COALESCE(v_es_local, false) = false THEN
    NEW.vehiculo_id := NULL;
    NEW.vehiculo_origen := NULL;
    RETURN NEW;
  END IF;

  IF NEW.vehiculo_id IS NOT NULL THEN
    SELECT cuenta_id INTO v_cuenta_vehiculo
    FROM public.vehiculos WHERE id = NEW.vehiculo_id;

    IF v_cuenta_vehiculo IS NULL OR v_cuenta_vehiculo <> NEW.cuenta_id THEN
      RAISE EXCEPTION 'VEHICULO_NO_PERTENECE_A_LA_CUENTA';
    END IF;

    IF NEW.vehiculo_origen IS NULL THEN
      NEW.vehiculo_origen := 'manual';
    END IF;
  ELSIF v_habitual_id IS NOT NULL THEN
    NEW.vehiculo_id := v_habitual_id;
    IF NEW.vehiculo_origen IS NULL THEN
      NEW.vehiculo_origen := 'auto_habitual';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autocompletar_vehiculo_despacho ON public.notas_despacho;
CREATE TRIGGER trg_autocompletar_vehiculo_despacho
  BEFORE INSERT OR UPDATE OF transportista_id, vehiculo_id
  ON public.notas_despacho
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_autocompletar_vehiculo_despacho();

-- ============================================================================
-- 5. RPC: ELIMINAR O DESACTIVAR VEHÍCULO (protección de historial)
--    REGLA: NUNCA se borran cotizaciones ni notas. Si hay viajes, solo se
--    desactiva; si no hay viajes, se desenlazan las cotizaciones y se borra.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.eliminar_o_desactivar_vehiculo_atomico(
  p_cuenta_id UUID,
  p_vehiculo_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viajes_count BIGINT;
  v_choferes_desvinculados INT;
  v_cotizaciones_desvinculadas INT;
BEGIN
  PERFORM 1 FROM public.vehiculos
  WHERE id = p_vehiculo_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VEHICULO_NO_ENCONTRADO';
  END IF;

  SELECT COUNT(*) INTO v_viajes_count
  FROM public.notas_despacho
  WHERE cuenta_id = p_cuenta_id AND vehiculo_id = p_vehiculo_id;

  UPDATE public.transportistas
  SET vehiculo_habitual_id = NULL
  WHERE cuenta_id = p_cuenta_id AND vehiculo_habitual_id = p_vehiculo_id;
  GET DIAGNOSTICS v_choferes_desvinculados = ROW_COUNT;

  IF v_viajes_count = 0 THEN
    -- Solo desenlazar: las cotizaciones son documentos de venta y NO se borran.
    UPDATE public.cotizaciones
    SET vehiculo_id = NULL
    WHERE cuenta_id = p_cuenta_id AND vehiculo_id = p_vehiculo_id;
    GET DIAGNOSTICS v_cotizaciones_desvinculadas = ROW_COUNT;

    DELETE FROM public.vehiculos
    WHERE id = p_vehiculo_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true,
      'accion', 'eliminado_fisico',
      'viajes_historicos', 0,
      'choferes_desvinculados', v_choferes_desvinculados,
      'cotizaciones_desvinculadas', v_cotizaciones_desvinculadas
    );
  ELSE
    UPDATE public.vehiculos
    SET activo = false, actualizado_en = now()
    WHERE id = p_vehiculo_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true,
      'accion', 'desactivado_logico',
      'viajes_historicos', v_viajes_count,
      'choferes_desvinculados', v_choferes_desvinculados
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_o_desactivar_vehiculo_atomico(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_o_desactivar_vehiculo_atomico(UUID, UUID) TO service_role;

-- ============================================================================
-- 6. RPC: ELIMINAR O DESACTIVAR CHOFER/TRANSPORTISTA
--    - Fletes pendientes de liquidar → BLOQUEA la baja (Caso 3).
--    - Historial (viajes, cotizaciones o pagos) → solo desactiva.
--    - Sin historial → borrado definitivo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.eliminar_o_desactivar_transportista_atomico(
  p_cuenta_id UUID,
  p_transportista_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viajes BIGINT;
  v_cotizaciones BIGINT;
  v_pagos BIGINT;
  v_pendientes BIGINT;
BEGIN
  PERFORM 1 FROM public.transportistas
  WHERE id = p_transportista_id AND cuenta_id = p_cuenta_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRANSPORTISTA_NO_ENCONTRADO';
  END IF;

  SELECT COUNT(*) INTO v_pendientes
  FROM public.notas_despacho
  WHERE cuenta_id = p_cuenta_id
    AND transportista_id = p_transportista_id
    AND estado IN ('despachada', 'entregada')
    AND flete_pagado = false
    AND COALESCE(flete_neto_transportista_usd, 0) > 0;

  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'TIENE_FLETES_PENDIENTES: % viaje(s) sin liquidar al chofer', v_pendientes;
  END IF;

  SELECT COUNT(*) INTO v_viajes
  FROM public.notas_despacho
  WHERE cuenta_id = p_cuenta_id AND transportista_id = p_transportista_id;

  SELECT COUNT(*) INTO v_cotizaciones
  FROM public.cotizaciones
  WHERE cuenta_id = p_cuenta_id AND transportista_id = p_transportista_id;

  SELECT COUNT(*) INTO v_pagos
  FROM public.pagos_transportistas
  WHERE cuenta_id = p_cuenta_id
    AND transportista_id = p_transportista_id
    AND revertido = false;

  IF v_viajes = 0 AND v_cotizaciones = 0 AND v_pagos = 0 THEN
    DELETE FROM public.transportistas
    WHERE id = p_transportista_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true, 'accion', 'eliminado_fisico',
      'viajes_historicos', 0
    );
  ELSE
    UPDATE public.transportistas
    SET activo = false, vehiculo_habitual_id = NULL, actualizado_en = now()
    WHERE id = p_transportista_id AND cuenta_id = p_cuenta_id;

    RETURN jsonb_build_object(
      'ok', true, 'accion', 'desactivado_logico',
      'viajes_historicos', v_viajes,
      'cotizaciones_historicas', v_cotizaciones,
      'pagos_historicos', v_pagos
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_o_desactivar_transportista_atomico(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_o_desactivar_transportista_atomico(UUID, UUID) TO service_role;

-- ============================================================================
-- 7. RPC DE REPORTE GERENCIAL (fechas en creado_en, métricas corregidas)
--    Definiciones congeladas:
--      Viajes     = notas en estado despachada/entregada (no anuladas ni pendientes)
--      Fletes     = suma de flete_usd
--      Mercancía  = total_usd − flete_usd − corte_usd  (la mercancía que viajó)
--      Comisión   = suma del neto GUARDADO en cada viaje (nunca recalculado)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.obtener_reporte_flota_y_choferes(
  p_cuenta_id UUID,
  p_fecha_inicio TIMESTAMPTZ,
  p_fecha_fin TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_por_vehiculo JSONB;
  v_por_chofer JSONB;
BEGIN
  -- 1. Productividad por vehículo propio
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_por_vehiculo
  FROM (
    SELECT
      v.id AS vehiculo_id,
      v.codigo,
      v.nombre,
      v.placa,
      v.capacidad_kg,
      v.color_batea,
      v.activo,
      COUNT(nd.id)::INT AS total_viajes,
      ROUND(COALESCE(SUM(nd.flete_usd), 0), 2) AS total_flete_usd,
      ROUND(COALESCE(SUM(nd.total_usd - nd.flete_usd - nd.corte_usd), 0), 2) AS total_mercancia_usd,
      ROUND(
        CASE WHEN COUNT(nd.id) > 0
             THEN COALESCE(SUM(nd.flete_usd), 0) / COUNT(nd.id)
             ELSE 0
        END, 2
      ) AS promedio_flete_viaje_usd,
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'transportista_id', sub.transportista_id,
          'chofer_nombre', sub.chofer_nombre,
          'viajes', sub.viajes,
          'flete_usd', sub.flete_usd
        ))
        FROM (
          SELECT
            nd2.transportista_id,
            COALESCE(tr.nombre, 'Sin chofer') AS chofer_nombre,
            COUNT(nd2.id)::INT AS viajes,
            ROUND(COALESCE(SUM(nd2.flete_usd), 0), 2) AS flete_usd
          FROM public.notas_despacho nd2
          LEFT JOIN public.transportistas tr ON tr.id = nd2.transportista_id
          WHERE nd2.cuenta_id = p_cuenta_id
            AND nd2.vehiculo_id = v.id
            AND nd2.estado IN ('despachada', 'entregada')
            AND nd2.creado_en >= p_fecha_inicio
            AND nd2.creado_en <= p_fecha_fin
          GROUP BY nd2.transportista_id, tr.nombre
          ORDER BY viajes DESC
        ) sub
      ), '[]'::jsonb) AS desglose_choferes
    FROM public.vehiculos v
    LEFT JOIN public.notas_despacho nd
      ON nd.vehiculo_id = v.id
     AND nd.cuenta_id = v.cuenta_id
     AND nd.estado IN ('despachada', 'entregada')
     AND nd.creado_en >= p_fecha_inicio
     AND nd.creado_en <= p_fecha_fin
    WHERE v.cuenta_id = p_cuenta_id
    GROUP BY v.id
    ORDER BY total_flete_usd DESC, v.codigo ASC
  ) t;

  -- 2. Productividad y liquidación por chofer local
  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  INTO v_por_chofer
  FROM (
    SELECT
      tr.id AS transportista_id,
      tr.nombre AS chofer_nombre,
      tr.telefono,
      tr.activo,
      vh.nombre AS vehiculo_habitual_nombre,
      vh.placa AS vehiculo_habitual_placa,
      COUNT(nd.id)::INT AS total_viajes,
      COUNT(nd.id) FILTER (
        WHERE lower(COALESCE(nd.flete_estado_destino_snapshot, '')) = 'carabobo'
      )::INT AS viajes_en_carabobo,
      COUNT(nd.id) FILTER (
        WHERE nd.flete_estado_destino_snapshot IS NOT NULL
          AND lower(nd.flete_estado_destino_snapshot) <> 'carabobo'
      )::INT AS viajes_fuera_carabobo,
      ROUND(COALESCE(SUM(nd.flete_usd), 0), 2) AS total_flete_usd,
      ROUND(COALESCE(SUM(nd.total_usd - nd.flete_usd - nd.corte_usd), 0), 2) AS total_mercancia_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd), 0), 2) AS comision_generada_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd) FILTER (WHERE nd.flete_pagado), 0), 2) AS comision_pagada_usd,
      ROUND(COALESCE(SUM(nd.flete_neto_transportista_usd) FILTER (WHERE NOT nd.flete_pagado), 0), 2) AS comision_pendiente_usd,
      COUNT(nd.id) FILTER (WHERE nd.vehiculo_origen = 'backfill')::INT AS viajes_estimados,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'vehiculo_id', sub2.vehiculo_id,
          'vehiculo_nombre', sub2.vehiculo_nombre,
          'placa', sub2.placa,
          'viajes', sub2.viajes,
          'flete_usd', sub2.flete_usd,
          'comision_usd', sub2.comision_usd
        ))
        FROM (
          SELECT
            nd3.vehiculo_id,
            COALESCE(v2.nombre, 'Vehículo no especificado') AS vehiculo_nombre,
            COALESCE(v2.placa, 'S/P') AS placa,
            COUNT(nd3.id)::INT AS viajes,
            ROUND(COALESCE(SUM(nd3.flete_usd), 0), 2) AS flete_usd,
            ROUND(COALESCE(SUM(nd3.flete_neto_transportista_usd), 0), 2) AS comision_usd
          FROM public.notas_despacho nd3
          LEFT JOIN public.vehiculos v2 ON v2.id = nd3.vehiculo_id
          WHERE nd3.cuenta_id = p_cuenta_id
            AND nd3.transportista_id = tr.id
            AND nd3.estado IN ('despachada', 'entregada')
            AND nd3.creado_en >= p_fecha_inicio
            AND nd3.creado_en <= p_fecha_fin
          GROUP BY nd3.vehiculo_id, v2.nombre, v2.placa
          ORDER BY viajes DESC
        ) sub2
      ), '[]'::jsonb) AS desglose_vehiculos
    FROM public.transportistas tr
    LEFT JOIN public.vehiculos vh ON vh.id = tr.vehiculo_habitual_id
    LEFT JOIN public.notas_despacho nd
      ON nd.transportista_id = tr.id
     AND nd.cuenta_id = tr.cuenta_id
     AND nd.estado IN ('despachada', 'entregada')
     AND nd.creado_en >= p_fecha_inicio
     AND nd.creado_en <= p_fecha_fin
    WHERE tr.cuenta_id = p_cuenta_id
      AND tr.es_local = true
    GROUP BY tr.id, vh.nombre, vh.placa
    ORDER BY total_flete_usd DESC, tr.nombre ASC
  ) c;

  RETURN jsonb_build_object(
    'ok', true,
    'por_vehiculo', v_por_vehiculo,
    'por_chofer_local', v_por_chofer
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_reporte_flota_y_choferes(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

COMMIT;
```

> **Definición de "Mercancía movilizada":** `total_usd` de una nota ya incluye el flete y el
> servicio de corte. Por eso la mercancía se calcula restando ambos (`total − flete − corte`):
> es la mercancía real que viajó en el camión, y las dos columnas del reporte (Fletes +
> Mercancía) quedan sumables sin inflar cifras. Si se prefiere el valor neto después de
> descuentos, restar también `descuento_total_usd` — decisión de gerencia, pero elegida una vez
> no se cambia (raíl R7).

### 4.3 Orden de aplicación y archivos

1. `construacero-staging/supabase/migrations/283_flota_vehiculos_locales.sql` — **primero en
   staging** (numeración propia de staging, siguiente libre: 283).
2. `construacero-staging/supabase/migrations/283_flota_vehiculos_locales_rollback.sql` —
   rollback probado antes de promover.
3. Paquete de promoción al proyecto principal en `supabase/release/main/`:
   `283_flota_preflight_readonly.sql` (solo SELECT: cuenta transportistas locales, placas,
   choferes sin cuenta, viajes a marcar), `283_flota_vehiculos_locales_apply.sql`,
   `283_flota_postflight_readonly.sql` (verifica tabla, columnas, backfill y RPCs),
   `283_flota_vehiculos_locales_rollback_review.sql`.
4. **Prohibido** `supabase db push` / `db reset` / `migration repair`: la historia de migraciones
   remotas está congelada. Todo aplica en ventana autorizada, con respaldo verificable, como
   indica `supabase/release/main/README.md`.

---

## 5. Contratos de API (Cloudflare Worker)

Rutas al estilo real del proyecto (rutas de acción, no REST con parámetros en la URL):

| Método y Ruta | Roles | Descripción |
| :--- | :--- | :--- |
| `GET /api/vehiculos/listar` | Todos los operadores autenticados | Lista vehículos (`?incluir_inactivos=true` opcional). |
| `POST /api/vehiculos/crear` | `jefe`, `administracion`, `logistica`, `desarrollador` | Crea vehículo validando placa única por cuenta. |
| `POST /api/vehiculos/actualizar` | `jefe`, `administracion`, `logistica`, `desarrollador` | Edita datos o reactiva (`activo: true`). |
| `POST /api/vehiculos/eliminar` | `jefe`, `administracion`, `desarrollador` | Invoca `eliminar_o_desactivar_vehiculo_atomico` y registra en auditoría. |
| `GET /api/reportes/flota-choferes?desde=…&hasta=…` | `jefe`, `administracion`, `logistica`, `desarrollador` | Invoca `obtener_reporte_flota_y_choferes`. |

Endpoints existentes que se **extienden** (sin romper contratos actuales):

- `POST /api/transportistas/crear` y `POST /api/transportistas/actualizar`: aceptan
  `vehiculoHabitualId` opcional cuando `es_local === true` (se valida que el vehículo exista,
  pertenezca a la cuenta y esté activo).
- `POST /api/despachos/crear`, `POST /api/ventas-rapidas/crear` y
  `POST /api/despachos/editar-pago` (este es el que usa hoy el modal de cambiar transportista):
  aceptan `vehiculoId` opcional y `actualizarVehiculoHabitual` booleano
  (`true` actualiza también `transportistas.vehiculo_habitual_id`).
- `POST /api/transportistas/desactivar`: pasa a invocar
  `eliminar_o_desactivar_transportista_atomico` (bloqueo por fletes pendientes incluido).

Toda mutación nueva queda registrada en la tabla de auditoría (quién, cuándo, qué cambió), como
el resto del sistema.

---

## 6. Interfaz (archivos a tocar)

- `src/views/TransportistasView.jsx` — franja "Vehículos de la Empresa" con tarjetas, alta,
  baja con confirmación inteligente y filtro "Ver inactivos".
- `src/components/transportistas/TransportistaFormCompact.jsx` — selector "Vehículo habitual"
  cuando `es_local` está activo.
- `src/components/despachos/CambiarTransportistaModal.jsx` y formularios de
  `src/views/VentaRapidaView.jsx` / `src/components/cotizaciones/CotizacionBuilder.jsx` /
  `src/components/despachos/EditDespachoModal.jsx` — "Vehículo para este viaje" (autocompletado)
  + casilla "Dejar como su vehículo fijo".
- `src/components/reportes/TabTransportistas.jsx` — Cuadro 1 (por vehículo) y Cuadro 2 (por
  chofer local), tarjetas de resumen, marca `≈` en viajes estimados, exportación PDF/Excel.
- **Documentos impresos** (obligatorio, si no el papel contradice al sistema):
  `src/services/pdf/guiaDespachoPDF.js`, `ordenDespachoPDF.js`, `despachoPDF.js` pasan a
  mostrar el **vehículo del viaje** (`notas_despacho.vehiculo_id → vehiculos`) en lugar de los
  datos de la ficha del transportista.

---

## 7. Pruebas (en las carpetas que el proyecto ejecuta)

- `api/handlers/__tests__/flotaVehiculos.test.js` — contratos: crear vehículo con placa
  repetida (rechaza), eliminar con 0 viajes (borra y desenlaza cotizaciones sin borrarlas),
  eliminar con viajes (desactiva y libera choferes), desactivar chofer con fletes pendientes
  (bloquea).
- `src/utils/__tests__/flotaVehiculoContract.test.js` — contrato de frontend: el modal rellena
  el vehículo habitual, el cambio por viaje no toca la ficha, la casilla "fijo" sí la actualiza.
- `src/utils/__tests__/rpcFlotaReporteContract.test.js` — la migración usa `creado_en`, define
  `vehiculo_origen` y la mercancía se calcula como `total − flete − corte`.
- Prueba manual en staging con dos choferes rotando camiones y verificación del reporte.

---

## 8. Plan de implementación (calendario realista)

| Fase | Contenido | Tiempo |
| :--- | :--- | :--- |
| 1. Base de datos (staging) | Preflight, migración 283, rollback probado, carga de los 4 vehículos reales (CAM-01…CAM-04), revisión del backfill marcado. | 1 día |
| 2. Servidor (Worker) | Handlers de vehículos, extensiones de transportistas/despachos/venta rápida, RPCs, auditoría, pruebas de contrato. | 1 día |
| 3. Pantallas | Franja de vehículos, formularios, selector por viaje, modal de despacho. | 1 día |
| 4. Reportes y PDFs | Cuadros 1 y 2, marca `≈`, exportación, PDFs con vehículo del viaje. | 1 día |
| 5. Promoción a producción | Paquete release/main con preflight/postflight/rollback, ventana autorizada con respaldo, verificación post-despliegue. | + ventana |

Total: **~4 días de trabajo + la ventana de revisión** para producción.

---

## 9. Raíles (guardrails de implementación)

Estas reglas son obligatorias y no se negocian durante la implementación:

- **R1. Nunca borrar documentos de venta.** Cotizaciones, notas de despacho y pagos jamás se
  eliminan por efectos secundarios. Solo se desenlazan o se desactivan registros auxiliares.
- **R2. Solo el Worker escribe.** Las tablas no aceptan escrituras directas del navegador;
  toda función de la base de datos es `SECURITY DEFINER` con `search_path = public`, con
  ejecución reservada a `service_role`.
- **R3. Toda base de datos pasa por staging primero**, con preflight de solo lectura, rollback
  probado y postflight de verificación. Producción solo en ventana autorizada con respaldo
  verificable. Prohibido `supabase db push` (historial de migraciones congelado).
- **R4. El historial nunca se reescribe.** Un viaje guardado conserva su vehículo y su comisión
  para siempre; las correcciones aplican hacia adelante.
- **R5. Lo estimado se avisa.** Todo dato proveniente del backfill se marca
  (`vehiculo_origen = 'backfill'`) y se muestra con `≈`; nunca se mezcla en silencio con datos
  reales.
- **R6. Las comisiones se leen, no se recalculan.** El reporte usa las copias guardadas en cada
  viaje (`flete_neto_transportista_usd`, `flete_pagado`); la regla de cálculo actual (global,
  `configuracion_negocio`) no se toca.
- **R7. Métricas congeladas:** Viajes = notas `despachada`/`entregada`; Fletes = suma de
  `flete_usd`; Mercancía = `total_usd − flete_usd − corte_usd`; Comisión = suma del neto
  guardado. Una vez publicadas, las definiciones no cambian sin acta.
- **R8. Cada consulta filtra por cuenta.** Un vehículo o chofer de otra cuenta nunca se enlaza;
  el trigger rechaza intentos (`VEHICULO_NO_PERTENECE_A_LA_CUENTA`).
- **R9. Toda baja o reactivación queda en la bitácora** de auditoría: quién, cuándo y qué cambió.
- **R10. Cero fricción para el vendedor.** Ningún flujo de venta exige clics nuevos; el camión se
  autocompleta y solo cambia si el operador lo decide.
- **R11. Compatibilidad hacia atrás.** Si el formulario aún no envía `vehiculo_id`, el trigger lo
  completa; el despliegue gradual no rompe nada.
- **R12. Pruebas antes de promover**, en las carpetas que el proyecto ejecuta
  (`api/handlers/__tests__/`, `src/utils/__tests__/`): placa repetida, backfill marcado, bloqueo
  por fletes pendientes y reporte con dos choferes rotando camiones son obligatorias.
- **R13. Roles mínimos:** vehículos (crear/editar): jefe, administración, logística,
  desarrollador; vehículos (eliminar) y pagos: jefe, administración, desarrollador; reporte de
  flota: jefe, administración, logística, desarrollador. **El supervisor no ve comisiones**
  salvo decisión expresa de la gerencia.

---

## 10. Decisiones adoptadas y pendientes

| Decisión | Estado | Detalle |
| :--- | :--- | :--- |
| Histórico de viajes viejos | **Adoptado:** estimado marcado (`≈`) | Alternativa posible: dejarlos como "camión no registrado" (más honesta pero el reporte histórico queda rengu el primer mes). |
| Visibilidad de comisiones para el supervisor | **Pendiente (por defecto: NO)** | Hoy los pagos a choferes solo los ven administración y desarrollador. |
| Capacidad en kg de los 4 camiones | **Pendiente (captura manual)** | El backfill no inventa kilos: alguien debe capturar la capacidad real de cada camión en la nueva ficha. |
| Métrica de mercancía con o sin descuentos | **Adoptada: sin descontar** (`total − flete − corte`) | Si gerencia prefiere el neto, se ajusta una sola vez y se congela (R7). |
