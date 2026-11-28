-- ============================================================================
-- 321_auditoria_portero_catalogo_fase2.sql
-- OP-2026-110 (Auditoría 2.0 — Fase 2: Portero del servidor + Catálogo único)
-- ============================================================================

BEGIN;

-- 1. Tabla del Portero (Capa 2): toda mutación y todo rechazo/error del Worker
CREATE TABLE IF NOT EXISTS public.auditoria_peticiones (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  operacion_id    TEXT NOT NULL,
  cuenta_id       UUID,
  metodo          TEXT NOT NULL,
  ruta            TEXT NOT NULL,
  status          INTEGER NOT NULL,
  duracion_ms     INTEGER NOT NULL DEFAULT 0,
  resultado       TEXT NOT NULL CHECK (resultado IN ('ok', 'denegado', 'error')),
  usuario_id      UUID,
  usuario_nombre  TEXT,
  usuario_rol     TEXT,
  ip_origen       TEXT
);

CREATE INDEX IF NOT EXISTS idx_aud_peticiones_ts_brin   ON public.auditoria_peticiones USING BRIN (ts);
CREATE INDEX IF NOT EXISTS idx_aud_peticiones_op_id     ON public.auditoria_peticiones (operacion_id);
CREATE INDEX IF NOT EXISTS idx_aud_peticiones_resultado ON public.auditoria_peticiones (resultado, ts DESC) WHERE resultado <> 'ok';
CREATE INDEX IF NOT EXISTS idx_aud_peticiones_cuenta_ts ON public.auditoria_peticiones (cuenta_id, ts DESC);

ALTER TABLE public.auditoria_peticiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_peticiones FROM anon, authenticated;
GRANT SELECT, INSERT ON public.auditoria_peticiones TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.auditoria_peticiones_id_seq TO service_role;

DROP TRIGGER IF EXISTS trg_auditoria_peticiones_inmutable ON public.auditoria_peticiones;
CREATE TRIGGER trg_auditoria_peticiones_inmutable
  BEFORE UPDATE OR DELETE ON public.auditoria_peticiones
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_auditoria_inmutable();

-- 2. Catálogo único de acciones (Capa 3)
CREATE TABLE IF NOT EXISTS public.auditoria_catalogo (
  accion            TEXT PRIMARY KEY,
  categoria         TEXT NOT NULL,
  titulo_es         TEXT NOT NULL,
  importancia       TEXT NOT NULL DEFAULT 'normal' CHECK (importancia IN ('normal', 'sensible', 'critica')),
  oculta_supervisor BOOLEAN NOT NULL DEFAULT false,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auditoria_catalogo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auditoria_catalogo FROM anon, authenticated;
GRANT SELECT ON public.auditoria_catalogo TO service_role;

INSERT INTO public.auditoria_catalogo (accion, categoria, titulo_es, importancia, oculta_supervisor) VALUES
  ('LOGIN_EXITOSO',                     'AUTH',          'Inicio de sesión exitoso',                    'normal',   false),
  ('LOGIN_FALLIDO',                     'AUTH',          'Intento de inicio de sesión fallido',         'sensible', false),
  ('CREAR_COTIZACION',                  'COTIZACION',    'Creó una cotización',                         'normal',   false),
  ('EDITAR_COTIZACION',                 'COTIZACION',    'Editó una cotización',                        'normal',   false),
  ('ENVIAR_COTIZACION',                 'COTIZACION',    'Envió una cotización',                        'normal',   false),
  ('CREAR_VERSION',                     'COTIZACION',    'Creó nueva versión de cotización',            'normal',   false),
  ('RECICLAR_COTIZACION',               'COTIZACION',    'Recicló una cotización',                      'normal',   false),
  ('VENTA_RAPIDA',                      'COTIZACION',    'Registró una venta rápida',                   'normal',   false),
  ('CREAR_DESPACHO',                    'DESPACHO',      'Creó una nota de despacho',                   'normal',   false),
  ('ACTUALIZAR_DESPACHO',               'DESPACHO',      'Actualizó estado de despacho',                'normal',   false),
  ('RECICLAR_DESPACHO',                 'DESPACHO',      'Recicló un despacho',                         'sensible', false),
  ('EDITAR_PAGO_DESPACHO',              'FINANZAS',      'Editó datos de pago de despacho',             'sensible', true),
  ('APLICAR_DESCUENTO',                 'DESPACHO',      'Aplicó descuento a despacho',                 'sensible', true),
  ('DEVOLUCION_PARCIAL',                'DESPACHO',      'Registró devolución parcial',                 'sensible', true),
  ('EDICION_PROFUNDA_CXC',              'FINANZAS',      'Edición profunda de despacho y CxC',          'critica',  true),
  ('EDICION_PROFUNDA_RETIRA_DEVOLUCIONES','DESPACHO',    'Edición profunda retiró devoluciones',        'critica',  true),
  ('ANULAR_DESPACHO',                   'DESPACHO',      'Anuló un despacho',                           'critica',  false),
  ('ANULAR_ABONO_POR_DEVOLUCION',       'FINANZAS',      'Anuló abono por devolución',                  'critica',  true),
  ('REGISTRAR_ABONO',                   'FINANZAS',      'Registró un abono de cliente',                'sensible', true),
  ('ABONO_RECHAZADO',                   'FINANZAS',      'Intento de abono rechazado',                  'sensible', true),
  ('REVERTIR_ABONO',                    'FINANZAS',      'Revirtió un abono',                           'critica',  true),
  ('REVERTIR_CARGO_CXC',                'FINANZAS',      'Revirtió cargo en cuenta por cobrar',         'critica',  true),
  ('RECALCULO_SALDO_FALLIDO',           'SISTEMA',       'Fallo en recálculo de saldo CxC',             'critica',  true),
  ('COD_CONCILIADO_CON_EVIDENCIA',      'FINANZAS',      'Concilió cobro a destino (COD)',              'sensible', true),
  ('FACTURAR_PRESTAMO',                 'CLIENTE',       'Facturó préstamo de cliente',                 'sensible', true),
  ('DEVOLVER_PRESTAMO',                 'CLIENTE',       'Registró devolución de préstamo',             'normal',   false),
  ('REASIGNAR_CLIENTE',                 'REASIGNACION',  'Reasignó un cliente',                         'sensible', false),
  ('REASIGNAR_CLIENTES_BULK',           'REASIGNACION',  'Reasignación masiva de clientes',             'critica',  false),
  ('CREAR_USUARIO',                     'USUARIO',       'Creó un usuario',                             'sensible', false),
  ('ELIMINAR_USUARIO',                  'USUARIO',       'Eliminó o desactivó un usuario',              'critica',  false),
  ('DESIGNAR_VENDEDOR_DIA',             'COMISIONES',    'Designó vendedor del día (sábado)',           'sensible', true),
  ('QUITAR_DESIGNACION_DIA',            'COMISIONES',    'Quitó designación de vendedor del día',       'sensible', true),
  ('GUARDAR_CONFIG',                    'CONFIG',        'Modificó configuración del negocio',          'critica',  true),
  ('BATCH_PRICE_UPDATE',                'INVENTARIO',    'Actualización masiva de precios',             'critica',  true),
  ('BATCH_PRICE_RESTORE',               'INVENTARIO',    'Restauración masiva de precios',              'critica',  true),
  ('BATCH_INGEST_PRODUCTOS',            'INVENTARIO',    'Ingreso masivo de productos',                 'sensible', false),
  ('CONTEO_FISICO_INVENTARIO',          'INVENTARIO',    'Aplicó conteo físico de inventario',          'sensible', false),
  ('REVERSION_INVENTARIO',              'INVENTARIO',    'Revirtió movimiento de inventario',           'critica',  false),
  ('TRANSFORMACION_INVENTARIO',         'INVENTARIO',    'Registró transformación de inventario',       'normal',   false),
  ('LIMPIAR_INVENTARIO',                'INVENTARIO',    'Limpió el inventario',                        'critica',  false),
  ('ACTUALIZAR_PRODUCTO_METADATOS',     'INVENTARIO',    'Actualizó metadatos de producto',             'normal',   false),
  ('CORREGIR_CODIGO_EXTERNO',           'DESPACHO',      'Corrigió código externo en despacho',         'normal',   false),
  ('CREAR_TRANSPORTISTA',               'TRANSPORTISTA', 'Creó un transportista',                       'normal',   false),
  ('ACTUALIZAR_TRANSPORTISTA',          'TRANSPORTISTA', 'Actualizó un transportista',                  'normal',   false),
  ('ELIMINAR_O_DESACTIVAR_TRANSPORTISTA','TRANSPORTISTA','Eliminó o desactivó transportista',           'sensible', false),
  ('PAGAR_TRANSPORTISTA',               'TRANSPORTISTA', 'Registró pago a transportista',               'sensible', true),
  ('REVERTIR_PAGO_TRANSPORTISTA',       'TRANSPORTISTA', 'Revirtió pago a transportista',               'critica',  true),
  ('CREAR_VEHICULO',                    'VEHICULO',      'Creó un vehículo',                            'normal',   false),
  ('ACTUALIZAR_VEHICULO',               'VEHICULO',      'Actualizó un vehículo',                       'normal',   false),
  ('ELIMINAR_O_DESACTIVAR_VEHICULO',    'VEHICULO',      'Eliminó o desactivó vehículo',                'sensible', false),
  ('CREAR_PROVEEDOR',                   'PROVEEDOR',     'Creó un proveedor',                           'normal',   true),
  ('ACTUALIZAR_PROVEEDOR',              'PROVEEDOR',     'Actualizó un proveedor',                      'normal',   true),
  ('DESACTIVAR_PROVEEDOR',              'PROVEEDOR',     'Desactivó un proveedor',                      'sensible', true),
  ('ELIMINAR_PROVEEDOR',                'PROVEEDOR',     'Eliminó un proveedor',                        'critica',  true),
  ('ACTUALIZAR_TRANSACCION_CXP',        'FINANZAS',      'Actualizó cuenta por pagar (CxP)',            'sensible', true),
  ('CREAR_SEGUIMIENTO',                 'SISTEMA',       'Creó seguimiento operativo',                  'normal',   false),
  ('ACTUALIZAR_SEGUIMIENTO',            'SISTEMA',       'Actualizó seguimiento operativo',             'normal',   false),
  ('BORRAR_SEGUIMIENTO',                'SISTEMA',       'Borró seguimiento operativo',                 'normal',   false),
  ('RESPALDO_RESTAURADO',               'SISTEMA',       'Restauró respaldo completo de la base',       'critica',  true)
ON CONFLICT (accion) DO UPDATE SET
  categoria = EXCLUDED.categoria,
  titulo_es = EXCLUDED.titulo_es,
  importancia = EXCLUDED.importancia,
  oculta_supervisor = EXCLUDED.oculta_supervisor;

NOTIFY pgrst, 'reload schema';

COMMIT;
