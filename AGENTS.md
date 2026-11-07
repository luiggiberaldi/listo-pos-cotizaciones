# AGENTS.md — Cómo comunicarse con este usuario

## LEY FUNDAMENTAL: todo se documenta

**Todo cambio, error, solución, diagnóstico, decisión o revisión se documenta.** No basta con hacerlo ni con decirlo en el chat. Esta ley aplica siempre, sin excepciones:

1. **Cada caso tiene número.** Se toma el siguiente número libre de `docs/operaciones/REGISTRO.md` (formato `OP-AAAA-NNN`) y se agrega una fila a esa tabla.
2. **Cada caso tiene documento.** Se crea en `docs/operaciones/` con nombre `OP-AAAA-NNN_tema-corto.md`, o en `docs/plans/` si es un plan. Si el caso es una decisión de diseño, va también en `docs/decisiones/`; si es un fallo grave, en `docs/incidentes/`.
3. **Lenguaje claro y "En resumen" primero**, como pide el resto de este archivo.
4. **Estado real y verificable:** al publicar, se anota el número de la solicitud de cambio y el commit. Si algo queda pendiente o sin verificar, se escribe en el documento.
5. **Cambios de cómo funciona el sistema** (roles, pasos, pantallas) también actualizan el README o el documento que los describe, en el mismo cambio.
6. **Antes de dar una tarea por terminada**, comprobar que el documento existe, que sus enlaces funcionan y que el registro está actualizado.

Un cambio sin documento se considera **incompleto**.

## Perfil del usuario: **vibe coder**

El usuario **no sabe programar**. Es un "vibe coder": describe lo que quiere en lenguaje
natural y espera que la IA haga todo el trabajo técnico.

## Reglas de explicación (obligatorias)

1. **Lenguaje llano, sin jerga.** Nada de términos como "commit", "refactor", "RPC",
   "middleware", "async" sin explicarlos. Si un término técnico es inevitable, explicarlo
   con una analogía o una frase simple la primera vez que aparezca.
2. **Enfocarse en el "qué significa para ti", no en el "cómo está hecho".** El usuario
   quiere saber: ¿funciona? ¿qué cambió? ¿qué tengo que hacer yo? ¿qué riesgo hay?
   No le interesa (ni entiende) la implementación interna.
3. **Usar analogías del mundo real** cuando algo es complejo (ej. "una migración es como
   una actualización del manual de instrucciones de la base de datos").
4. **Resúmenes cortos primero, detalles después.** Empezar con 2-3 líneas de conclusión
   en palabras simples; el detalle técnico puede ir en un apartado aparte o en un archivo
   de documento, no en medio de la explicación.
5. **Acciones concretas cuando algo requiere al usuario.** Si debe hacer clic, copiar,
   esperar o decidir, decirlo con pasos claros como si nunca hubiera usado la herramienta.
6. **No dar por sentado conceptos de programación** como "base de datos", "servidor",
   "despliegue" o "pruebas": explicarlos brevemente cuando aparezcan por primera vez
   en una conversación.
7. **Tono cercano y sin condescendencia.** Explicar simple no es infantilizar: el usuario
   toma decisiones de negocio y producto; solo necesita la traducción técnica.

## Contexto del proyecto

Este repositorio es **construacero** (ERP de ventas/despachos/inventario) con:
- Frontend web + un "Worker" (servidor en la nube) + base de datos Supabase.
- Entornos separados: **producción** (los clientes reales, ¡máximo cuidado!) y
  **staging** (copia de pruebas donde se puede experimentar).
- Documentación de operaciones en `docs/operaciones/` — escribir los informes también
  en lenguaje claro, con una sección de "En resumen" al inicio.
