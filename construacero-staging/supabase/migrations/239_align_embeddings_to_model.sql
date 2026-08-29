-- 239_align_embeddings_to_model.sql
-- El modelo Cloudflare @cf/baai/bge-base-en-v1.5 devuelve 768 dimensiones.
-- La columna estaba en 1536, pero aún no contenía embeddings.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.productos') IS NULL THEN
    RAISE EXCEPTION 'PRECONDICION_PRODUCTOS_FALTANTE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.productos
    WHERE vector_embedding IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'NO_CAMBIAR_DIMENSION_CON_EMBEDDINGS_EXISTENTES';
  END IF;
END
$$;

DROP INDEX IF EXISTS public.productos_vector_idx;

ALTER TABLE public.productos
  ALTER COLUMN vector_embedding TYPE public.vector(768)
  USING NULL::public.vector(768);

CREATE INDEX IF NOT EXISTS productos_vector_idx
  ON public.productos
  USING hnsw (vector_embedding public.vector_cosine_ops);

NOTIFY pgrst, 'reload schema';

COMMIT;
