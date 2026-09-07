-- 271 (staging): título editable para la observación / nota de entrega.
-- Fábrica: 'nota'. El título se muestra como etiqueta del bloque en la guía PDF.
ALTER TABLE public.notas_despacho
  ADD COLUMN IF NOT EXISTS notas_titulo text DEFAULT 'nota';

NOTIFY pgrst, 'reload schema';
