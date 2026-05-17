# Propuesta Estratégica: Modelo de Vendedores Externos (+2%)

**Fecha de Creación:** 16 de Mayo de 2026
**Estado:** `BORRADOR / EN ESPERA DE DEFINICIONES`

Este documento detalla la propuesta arquitectónica para integrar un nuevo canal de ventas basado en "Vendedores Externos" que venden los productos con un sobreprecio (markup) del 2% por encima del valor real del inventario.

---

## 1. Identificación en Base de Datos (Gestión de Usuarios)
Actualmente el sistema se basa en roles (`vendedor`, `supervisor`, etc.). Para este nuevo modelo, se recomienda:
* **No crear un rol nuevo**, sino añadir un subtipo o bandera a la tabla `usuarios`. Por ejemplo: `tipo_vendedor: 'interno' | 'externo'`.
* **Razón:** El vendedor externo sigue teniendo permisos básicos de `vendedor` (puede crear cotizaciones, ver inventario), pero operando bajo una "regla de negocio" distinta. Esto evita duplicar rutas de seguridad y permisos en todo el sistema.

## 2. Estrategia del Recargo (+2%) en los Precios
Existen dos caminos, pero se recomienda el **Camino A**:

* **Camino A: Precio Inflado de forma Transparente (RECOMENDADO ⭐)**
  * **Cómo funciona:** Cuando el vendedor externo entra al sistema y ve el módulo de Inventario o arma una cotización, el sistema **automáticamente multiplica** el precio base de la base de datos por `1.02`. 
  * **Ventaja:** El vendedor externo nunca tiene que calcular el 2% a mano. Al imprimir un PDF de la Lista de Precios o una Cotización, los documentos ya salen con el 2% integrado. El cliente final no ve ningún concepto de "recargo", simplemente ve el precio final del producto.
* **Camino B: Recargo Adicional al Subtotal**
  * **Cómo funciona:** El vendedor cotiza al precio real, y al final de la cotización el sistema agrega un concepto: `"Recargo por Gestión Comercial (2%)"`.
  * **Desventaja:** Genera fricción con el cliente final, quien podría cuestionar ese recargo al ver la factura o la cotización.

## 3. Manejo de Cotizaciones y Trazabilidad
Es crucial separar las operaciones de ambos canales desde que nacen:
* **Base de Datos:** Añadir a la tabla `cotizaciones` (y por herencia a `despachos`) un campo llamado `canal_venta` con valores `'interno' | 'externo'`.
* **Lógica Interna:** Cuando un vendedor guarda una cotización, el backend lee su `tipo_vendedor` y estampa la cotización permanentemente con ese canal. Esto asegura que, aunque el vendedor pase de externo a interno en un futuro (o viceversa), la data histórica de esa transacción quede intacta.

## 4. Impacto y Adaptación de los Reportes

El cambio más importante ocurrirá en el módulo de Reportes. Al estampar el `canal_venta`, el departamento de Administración requerirá nuevas métricas:

1. **Dashboard y Reporte General:** Se debe añadir un nuevo gráfico de anillos o barras apiladas: **Ventas Internas vs. Ventas Externas (USD / Toneladas)**.
2. **Utilidad Extra (+2%):** Un reporte financiero especial que calcule exactamente cuánto dinero representó ese 2% adicional en ganancias. 
   * *Fórmula de Utilidad Extra:* `Suma de ((Precio Vendido - Precio Base Real) * Cantidad)`.
3. **Módulo de Comisiones:** Esto es una decisión de negocio clave pendiente de tomar:
   * **[DECISIÓN PENDIENTE]:** ¿El vendedor externo va a comisionar de la misma forma (por tonelada/porcentaje) que el interno? ¿O ese 2% extra es precisamente para pagar su comisión externa sin afectar la rentabilidad original de Construacero?

---

## 🚀 Resumen del Plan de Ejecución Técnico (Checklist para el Futuro)

Cuando se tengan claras las reglas de negocio y se decida implementar, el roadmap de desarrollo es el siguiente:

- [ ] **Migraciones SQL:**
  - [ ] Añadir `tipo_vendedor` (enum o varchar) a la tabla `usuarios`.
  - [ ] Añadir `canal_venta` (enum o varchar) a la tabla `cotizaciones`.
  - [ ] Actualizar funciones RPC relevantes para respetar y propagar el `canal_venta`.
- [ ] **Lógica Frontend (Precios):**
  - [ ] Modificar el store/hooks (`useInventario`, `useLineItems`) para que apliquen `precio * 1.02` dinámicamente en memoria si el `perfil.tipo_vendedor === 'externo'`.
- [ ] **Lógica Backend / API:**
  - [ ] Asegurarse de que al crear la cotización, la API valide los cálculos o aplique el estampe de `canal_venta` seguro desde el servidor o validando el claim del JWT.
- [ ] **PDFs:**
  - [ ] Modificar `CotizacionPDF.js` y `listaPreciosPDF.js` para inyectar y respetar el aumento del 2% en la representación visual e impresa.
- [ ] **Vistas y UI:**
  - [ ] Modificar `UsuariosView.jsx` para poder gestionar y asignar a un usuario como Externo/Interno.
  - [ ] Modificar `ReportesView.jsx` y `DashboardView.jsx` para añadir filtros globales (Todos / Internos / Externos) a las gráficas y KPIs.
  - [ ] Modificar `ComisionesView.jsx` según la regla de negocio que se decida para este esquema externo.
