-- 233_unificar_rpc_productos.sql
--
-- Las migraciones 049/052/072 y 073 fueron creando firmas nuevas de las RPC
-- de productos con CREATE OR REPLACE, pero al cambiar la cantidad de
-- parámetros PostgreSQL las dejó como overloads distintos. PostgREST no puede
-- resolver una llamada parcial cuando existen ambas firmas.
--
-- Se conserva la firma vigente con porcentajes de precios:
--   crear_producto_con_kardex: 15 parámetros
--   actualizar_producto_con_kardex: 16 parámetros
-- y se eliminan únicamente las firmas históricas que ya no consume el código.

-- crear_producto_con_kardex legado de 049 (10 parámetros)
DROP FUNCTION IF EXISTS public.crear_producto_con_kardex(
  TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT
);

-- crear_producto_con_kardex legado de 052/072 (12 parámetros)
DROP FUNCTION IF EXISTS public.crear_producto_con_kardex(
  TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC
);

-- actualizar_producto_con_kardex legado de 049 (11 parámetros)
DROP FUNCTION IF EXISTS public.actualizar_producto_con_kardex(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT
);

-- actualizar_producto_con_kardex legado de 052/072 (13 parámetros)
DROP FUNCTION IF EXISTS public.actualizar_producto_con_kardex(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC
);

-- Reafirmar permisos de las firmas canónicas vigentes.
GRANT EXECUTE ON FUNCTION public.crear_producto_con_kardex(
  TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.actualizar_producto_con_kardex(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC
) TO authenticated;

-- Solicitar a PostgREST que recargue el catálogo de funciones después del DDL.
NOTIFY pgrst, 'reload schema';
