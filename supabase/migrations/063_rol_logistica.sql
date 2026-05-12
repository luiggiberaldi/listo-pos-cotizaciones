-- 063: Agregar rol 'logistica' a la tabla usuarios
-- Actualizar el CHECK constraint para incluir el nuevo rol
ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY['supervisor', 'vendedor', 'administracion', 'logistica']));
