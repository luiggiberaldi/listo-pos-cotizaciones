-- Add color column to usuarios table for vendor-specific colors
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;
