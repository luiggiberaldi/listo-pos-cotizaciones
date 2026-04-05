-- =================================================================================
-- SETUP COMPLETO: TABLAS PARA LICENCIAS Y CONTROL DE DISPOSITIVOS
-- Ejecuta esto en el SQL Editor de Supabase (proyecto fgzwmwrugerptfqfrsjd)
-- =================================================================================

-- 1. cloud_backups
CREATE TABLE IF NOT EXISTS public.cloud_backups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    backup_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. cloud_licenses (con max_devices y active usados por el cliente)
CREATE TABLE IF NOT EXISTS public.cloud_licenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    device_id TEXT,
    license_type TEXT NOT NULL DEFAULT 'trial',
    days_remaining INTEGER DEFAULT 7,
    valid_until TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days',
    max_devices INTEGER NOT NULL DEFAULT 2,
    active BOOLEAN NOT NULL DEFAULT true,
    business_name TEXT,
    phone TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrar columnas si la tabla ya existía con nombres distintos
DO $$
BEGIN
    -- Renombrar is_active → active si existe
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'is_active'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'active'
    ) THEN
        ALTER TABLE public.cloud_licenses RENAME COLUMN is_active TO active;
    END IF;

    -- Añadir max_devices si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'max_devices'
    ) THEN
        ALTER TABLE public.cloud_licenses ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 2;
    END IF;

    -- Añadir valid_until si no existe y poblarla matemáticamente
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'valid_until'
    ) THEN
        ALTER TABLE public.cloud_licenses ADD COLUMN valid_until TIMESTAMP WITH TIME ZONE;
        UPDATE public.cloud_licenses 
        SET valid_until = updated_at + (days_remaining * INTERVAL '1 day')
        WHERE valid_until IS NULL;
    END IF;
END $$;

-- 3. account_devices
CREATE TABLE IF NOT EXISTS public.account_devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_alias TEXT DEFAULT 'Dispositivo',
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(email, device_id)
);

-- 4. RLS — políticas con filtro por email del usuario autenticado
ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo a cloud_backups" ON public.cloud_backups;
CREATE POLICY "Acceso por email a cloud_backups"
    ON public.cloud_backups FOR ALL
    USING (auth.jwt() ->> 'email' = email)
    WITH CHECK (auth.jwt() ->> 'email' = email);

DROP POLICY IF EXISTS "Permitir todo a cloud_licenses" ON public.cloud_licenses;
CREATE POLICY "Acceso por email a cloud_licenses"
    ON public.cloud_licenses FOR ALL
    USING (auth.jwt() ->> 'email' = email)
    WITH CHECK (auth.jwt() ->> 'email' = email);

DROP POLICY IF EXISTS "Permitir todo a account_devices" ON public.account_devices;
CREATE POLICY "Acceso por email a account_devices"
    ON public.account_devices FOR ALL
    USING (auth.jwt() ->> 'email' = email)
    WITH CHECK (auth.jwt() ->> 'email' = email);

-- 5. Función RPC: registrar dispositivo y verificar límite atómicamente
-- Devuelve: 'ok', 'limit_reached', o 'license_inactive'
CREATE OR REPLACE FUNCTION public.register_and_check_device(
    p_email TEXT,
    p_device_id TEXT,
    p_device_alias TEXT DEFAULT 'Dispositivo'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_max_devices INTEGER;
    v_active BOOLEAN;
    v_license_type TEXT;
    v_valid_until TIMESTAMP WITH TIME ZONE;
    v_count INTEGER;
    v_already_registered BOOLEAN;
BEGIN
    -- Obtener licencia
    SELECT max_devices, active, license_type, valid_until INTO v_max_devices, v_active, v_license_type, v_valid_until
    FROM public.cloud_licenses
    WHERE email = p_email;

    -- Sin licencia registrada: permitir sin restricciones
    IF NOT FOUND THEN
        RETURN 'ok';
    END IF;

    -- Licencia desactivada manualmente
    IF v_active = false THEN
        RETURN 'license_inactive';
    END IF;

    -- Licencia expirada por tiempo (Ciclo de Vida cerrado)
    IF v_license_type != 'permanent' AND v_valid_until < NOW() THEN
        RETURN 'license_expired';
    END IF;

    -- Ver cuántos dispositivos hay actualmente almacenados
    SELECT COUNT(*) INTO v_count
    FROM public.account_devices
    WHERE email = p_email;

    -- BLOQUEO ESTRICTO: Si el administrador redujo el límite (ej. de 2 a 1)
    -- y aún hay más dispositivos registrados que el límite actual, TODOS los dispositivos
    -- quedarán bloqueados hasta que el Admin expulse manualmente el exceso en la Estación Maestra.
    IF v_count > v_max_devices THEN
        RETURN 'limit_reached';
    END IF;

    -- Ver si este dispositivo PC específico ya está registrado
    SELECT EXISTS(
        SELECT 1 FROM public.account_devices
        WHERE email = p_email AND device_id = p_device_id
    ) INTO v_already_registered;

    IF v_already_registered THEN
        -- Actualizar la última vez visto y permitir su paso
        UPDATE public.account_devices
        SET last_seen = NOW()
        WHERE email = p_email AND device_id = p_device_id;
        RETURN 'ok';
    END IF;

    -- Si no está registrado y ya llegamos al tope numérico: Bloqueo de entrada
    IF v_count >= v_max_devices THEN
        RETURN 'limit_reached';
    END IF;

    -- Registrar un nuevo equipo físico a la base de datos
    INSERT INTO public.account_devices (email, device_id, device_alias, last_seen)
    VALUES (p_email, p_device_id, p_device_alias, NOW())
    ON CONFLICT (email, device_id) DO UPDATE SET last_seen = NOW();

    RETURN 'ok';
END;
$$;
