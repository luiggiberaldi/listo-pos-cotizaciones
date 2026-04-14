-- 001_extensions.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- gen_random_uuid() ya viene incluido en PG14+; uuid-ossp es por compatibilidad
