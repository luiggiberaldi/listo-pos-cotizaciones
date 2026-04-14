-- 018: Credenciales de acceso compartidas (gate) del negocio
-- El gate es la primera pantalla de login: correo + contraseña compartida
-- Todos los dispositivos usan las mismas credenciales para entrar al sistema
-- Luego cada usuario se identifica con su PIN individual

ALTER TABLE configuracion_negocio
  ADD COLUMN IF NOT EXISTS gate_email TEXT,
  ADD COLUMN IF NOT EXISTS gate_password_hash TEXT;

COMMENT ON COLUMN configuracion_negocio.gate_email IS 'Correo compartido del negocio para acceso inicial';
COMMENT ON COLUMN configuracion_negocio.gate_password_hash IS 'Hash SHA-256 de la contraseña compartida de acceso';
