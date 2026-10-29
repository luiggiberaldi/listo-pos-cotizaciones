# Auditoría de responsividad — sección Reportes (staging) — 2026-10-29

## En resumen

- **En computadora todo se ve bien. En tableta casi todo está bien. En celular hay 5 problemas que
  conviene arreglar ya**: el más grave es que en **Comisiones los botones de Imprimir/Descargar quedan
  fuera de la pantalla** y hay que deslizar la página de lado para encontrarlos.
- Las tablas grandes (Crédito, Transportistas, Artículos externos) en celular **esconden el monto**
  (el dato más importante) a la derecha; hay que deslizar cada tabla.
- Las 5 pestañas usan **4 diseños distintos** para fechas y botones de PDF; ya existe el componente común
  (`BarraPeriodoReporte`, usado en Transportistas) para unificarlas.
- No se cambió nada: esto es solo diagnóstico y plan.

## Cómo se revisó

En la web de staging (`localhost:5174`), con el usuario de prueba, cada pestaña en **celular (375 px)**,
**tableta (768 px)** y **computadora**. En cada una se midió con el navegador: si la página se desliza de
lado, qué elementos se salen de la pantalla, qué tablas hay que deslizar y cuántos botones son muy chicos
para el dedo (menos de 32 px). Además se revisó el código (`ReportesView.jsx`, 2.696 líneas, y
`components/reportes/`).

| Pestaña | Celular: ¿la página se sale de lado? | Tablas que hay que deslizar (celular) | Botones chicos |
| :--- | :--- | :--- | :--- |
| Comisiones | 🔴 **Sí** (482 px en pantalla de 375) | — | 16 |
| Crédito | No | 2 (8 y 6 columnas; 682 y 737 px) | 17 |
| Ventas | No | — (sin datos ese día, ver límites) | 14 |
| Transportistas | No | 3 (5, 7 y 8 columnas) | 16 |
| Artículos externos | No | 1 (9 columnas; 671 px) | 14 |

En tableta ninguna página se sale; solo algunas tablas se pasan 20–100 px.

## Problemas encontrados

### 🔴 Arreglar ya (impiden o dificultan usar el reporte en el celular)

1. **Comisiones: Imprimir/Descargar fuera de la pantalla.** La fila con las tasas (Euro BCV / USDT) no
   puede encogerse (`shrink-0`, `ReportesView.jsx` ≈ línea 1359) y empuja los botones fuera.
2. **El botón flotante "+" tapa montos.** En todas las pestañas queda encima de la última fila o columna
   de las tablas (se vio tapando "$0,00" y "100%").
3. **Fechas escondidas.** En el celular "Mes pasado" y "Personalizado" quedan fuera, a la derecha de la
   fila de fechas, sin ninguna señal de que se puede deslizar.
4. **Tablas que esconden el monto.** En Crédito, Transportistas y Artículos externos el monto queda en
   las últimas columnas; el nombre del chofer o cliente ocupa 3 líneas.
5. **Letras de 8–9 px** en 28 lugares de Reportes: en un celular son casi ilegibles.

### 🟠 Unificar (cada pestaña se usa distinto)

6. **Cuatro diseños de barra de período y PDF:**
   - Comisiones: fechas + vendedor + "Detallado/Resumido" + tasas + íconos de PDF.
   - Crédito: **sin botones arriba**; los PDF están dentro de cada tabla.
   - Ventas y Artículos externos: barra con "Imprimir PDF / Descargar PDF".
   - Transportistas: ya usa la barra común.
7. **Botones de PDF:** en un lado se muestran solo como ícono (Transportistas) y en otro con el texto
   partido en dos líneas (Ventas).
8. **Tarjetas de totales:** títulos cortados ("Balance Neto (CxC -…") y una tarjeta suelta ocupando media
   fila (la 5.ª en Crédito).

### 🟡 Mejoras

9. **Barra superior en tableta:** la fecha y hora salen en 4 líneas y las tasas se ven apretadas.
10. **Pestañas de Reportes en celular:** la última queda cortada ("Ex…") sin señal de que hay más.
11. **Botones táctiles chicos** (8–17 por pestaña, menos de 32 px): lo recomendado en celular son 40 px.
12. **Cuadro por camión (flota)** en celular: la fila que se abre con el detalle viaje por viaje queda
    muy ancha; conviene mostrar cada viaje como tarjeta.

## Plan de arreglos y mejoras

| Fase | Qué se hace | Puntos | Riesgo | Tiempo estimado |
| :--- | :--- | :--- | :--- | :--- |
| **1. Arreglos urgentes** | Botones de Comisiones visibles (tasas en su propia fila); espacio inferior para que el "+" no tape nada (u ocultarlo en Reportes); fechas en dos filas o menú "Más fechas" en celular; letra mínima de 10–11 px. | 1, 2, 3, 5 | Bajo (solo diseño) | ½ día |
| **2. Tablas → tarjetas en celular** | Un componente común "tabla que en celular se vuelve tarjetas": nombre arriba, **monto grande a la derecha**, el resto en líneas chicas. Se aplica a Crédito (2 tablas), Transportistas (3) y Artículos externos (1). En tableta y computadora la tabla sigue igual. | 4, 12 | Medio (toca cómo se muestran los datos, no los cálculos) | 1 día |
| **3. Unificar las pestañas** | Pasar Comisiones, Crédito, Ventas y Artículos externos a `BarraPeriodoReporte` (filtros propios, como vendedor o tasa, quedan como "extras" dentro de la barra). Mismo criterio de botones de PDF en todas. Tarjetas de totales con títulos que se ajustan y sin tarjetas sueltas. | 6, 7, 8 | Medio (hay que comprobar que cada PDF siga saliendo igual) | 1–1½ días |
| **4. Pulido** | Barra superior compacta en tableta, señal de "desliza" en pestañas y fechas, botones de 40 px en celular. | 9, 10, 11 | Bajo | ½ día |

**Orden recomendado:** 1 → 2 → 3 → 4. La fase 1 resuelve lo que hoy impide trabajar en el celular; la 3
es la que más se nota en el día a día, pero conviene hacerla después de tener la base (fases 1–2) para no
mover dos veces las mismas pantallas.

**Cómo se verificará cada fase:** las mismas medidas de esta auditoría en 375 / 768 / 1280 px (que la
página no se deslice de lado, que ningún botón quede fuera), capturas antes/después, y generar cada PDF
para confirmar que su contenido no cambió.

## Límites de esta revisión

- **Ventas** no tenía ventas en el período, así que sus gráficos y tablas con datos no se vieron en el
  celular; se revisarán con datos en la fase 3.
- Se usó el navegador de la app imitando un celular; conviene una prueba final en un teléfono real.
