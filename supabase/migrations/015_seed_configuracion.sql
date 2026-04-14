-- 015_seed_configuracion.sql
INSERT INTO public.configuracion_negocio (
  id, nombre_negocio, moneda_principal, validez_cotizacion_dias, pie_pagina_pdf
) VALUES (
  1, 'Mi Ferretería', 'USD', 15, 'Gracias por su preferencia. Precios sujetos a cambio sin previo aviso.'
)
ON CONFLICT (id) DO NOTHING;
