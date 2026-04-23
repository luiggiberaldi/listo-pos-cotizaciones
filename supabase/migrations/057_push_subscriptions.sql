-- 057: Tabla para suscripciones push notifications
-- Almacena las claves de suscripción del navegador por operador

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT now(),
  UNIQUE(usuario_id, endpoint)
);

CREATE INDEX idx_push_subs_usuario ON push_subscriptions(usuario_id);

-- RLS: solo el service key puede leer/escribir (el worker usa service key)
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Permitir al service role acceso completo (el worker usa service key)
-- No se necesitan políticas para usuarios normales — todo pasa por el worker
