-- 085: Fix usuarios cuenta_id nulos
-- Asigna el cuenta_id a los usuarios que hayan sido creados y quedaron nulos
UPDATE public.usuarios 
SET cuenta_id = (SELECT id FROM auth.users LIMIT 1) 
WHERE cuenta_id IS NULL;
