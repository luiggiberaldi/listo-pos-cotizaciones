-- supabase/migrations/016_seed_usuarios_fabrica.sql
-- Usuarios de fábrica con PIN 000000
-- Ejecutar en SQL Editor de Supabase

DO $$
DECLARE
  sup_id UUID;
  ven_id UUID;
  inst_id UUID;
BEGIN
  -- Obtener el instance_id del proyecto
  SELECT instance_id INTO inst_id FROM auth.users LIMIT 1;
  IF inst_id IS NULL THEN
    inst_id := '00000000-0000-0000-0000-000000000000';
  END IF;

  -- ── Supervisor de fábrica ──────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'supervisor@listo.sys') THEN
    sup_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id,
      email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      aud, role, is_sso_user
    ) VALUES (
      sup_id, inst_id,
      'supervisor@listo.sys',
      crypt('000000', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      'authenticated', 'authenticated', false
    );
  END IF;

  SELECT id INTO sup_id FROM auth.users WHERE email = 'supervisor@listo.sys';

  IF sup_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = sup_id) THEN
    INSERT INTO public.usuarios (id, nombre, rol, activo)
    VALUES (sup_id, 'Supervisor', 'supervisor', true);
  END IF;

  -- ── Vendedor de fábrica ────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'vendedor@listo.sys') THEN
    ven_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, instance_id,
      email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      aud, role, is_sso_user
    ) VALUES (
      ven_id, inst_id,
      'vendedor@listo.sys',
      crypt('000000', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      'authenticated', 'authenticated', false
    );
  END IF;

  SELECT id INTO ven_id FROM auth.users WHERE email = 'vendedor@listo.sys';

  IF ven_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = ven_id) THEN
    INSERT INTO public.usuarios (id, nombre, rol, activo)
    VALUES (ven_id, 'Vendedor', 'vendedor', true);
  END IF;

END $$;
