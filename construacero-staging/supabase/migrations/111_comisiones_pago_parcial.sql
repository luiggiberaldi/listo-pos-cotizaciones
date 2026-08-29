-- 111_comisiones_pago_parcial.sql
-- Añadir columna para registrar el monto pagado al vendedor
ALTER TABLE public.comisiones 
ADD COLUMN IF NOT EXISTS comision_pagada_monto NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Restablecer a pago_parcial la comisión que se marcó como pagada prematuramente
UPDATE public.comisiones
SET 
  estado = 'pago_parcial',
  comision_pagada_monto = comision_liberada, -- Registrar que se le pagó lo que estaba liberado
  pagada_en = NULL,
  pagada_por = NULL
WHERE estado = 'pagada' AND comision_retenida > 0;
