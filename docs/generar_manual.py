import markdown
from weasyprint import HTML
import base64, pathlib

# Load logo as base64
logo_path = pathlib.Path('/home/claude/projects/listo-pos-cotizaciones/public/logo.png')
logo_b64 = base64.b64encode(logo_path.read_bytes()).decode()
logo_data_uri = f"data:image/png;base64,{logo_b64}"

# ── CSS ──────────────────────────────────────────────────────────────────────
CSS = """
@page {
    size: letter;
    margin: 2.2cm 2.5cm 2.5cm 2.5cm;
    @bottom-center {
        content: counter(page);
        font-family: 'Inter', sans-serif;
        font-size: 9px;
        color: #999;
    }
}
@page :first { margin: 0; @bottom-center { content: none; } }
@page cover { margin: 0; @bottom-center { content: none; } }
@page toc { @bottom-center { content: none; } }

body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1a1a1a;
    line-height: 1.55;
    font-size: 12.5px;
}

/* ── Cover ── */
.cover {
    page: cover;
    page-break-after: always;
    width: 100%;
    height: 100vh;
    background: linear-gradient(160deg, #0a1628 0%, #0d1f3c 40%, #162d50 70%, #1B365D 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: white;
    padding: 60px;
    box-sizing: border-box;
}
.cover img {
    width: 220px;
    height: auto;
    margin-bottom: 50px;
    filter: drop-shadow(0 4px 20px rgba(0,0,0,0.4));
}
.cover h1 {
    font-size: 36px;
    font-weight: 900;
    letter-spacing: -0.5px;
    margin: 0 0 12px 0;
    color: white;
    border: none;
    padding: 0;
}
.cover .subtitle {
    font-size: 18px;
    font-weight: 400;
    color: rgba(255,255,255,0.7);
    margin: 0 0 8px 0;
}
.cover .role-badge {
    display: inline-block;
    background: linear-gradient(135deg, #B8860B, #D4A537);
    color: white;
    font-weight: 700;
    font-size: 14px;
    padding: 8px 28px;
    border-radius: 50px;
    margin-top: 24px;
    letter-spacing: 1px;
    text-transform: uppercase;
}
.cover .version {
    font-size: 12px;
    color: rgba(255,255,255,0.4);
    margin-top: 60px;
}

/* ── TOC ── */
.toc {
    page: toc;
    page-break-after: always;
    padding: 50px;
}
.toc h2 {
    font-size: 28px;
    font-weight: 900;
    color: #1B365D;
    margin: 0 0 30px 0;
    border: none;
    padding: 0;
}
.toc-section {
    font-size: 16px;
    font-weight: 800;
    color: #1B365D;
    margin: 22px 0 8px 0;
    padding-bottom: 4px;
    border-bottom: 2px solid #1B365D;
    display: inline-block;
}
.toc-item {
    font-size: 13px;
    color: #444;
    padding: 5px 0 5px 16px;
    border-bottom: 1px dotted #ddd;
    line-height: 1.4;
}
.toc-item b { color: #1a1a1a; }

/* ── Content ── */
h1 {
    font-size: 26px;
    font-weight: 900;
    color: #1B365D;
    margin-top: 0;
    margin-bottom: 6px;
    page-break-after: avoid;
    border-bottom: 3px solid #1B365D;
    padding-bottom: 10px;
}
h2 {
    font-size: 20px;
    font-weight: 900;
    color: #1B365D;
    margin-top: 28px;
    margin-bottom: 10px;
    border-top: 2px solid #e5e7eb;
    padding-top: 14px;
    page-break-after: avoid;
}
h3 {
    font-size: 16px;
    font-weight: 800;
    color: #222;
    margin-top: 20px;
    margin-bottom: 6px;
    page-break-after: avoid;
}
h4 {
    font-size: 14px;
    font-weight: 700;
    color: #333;
    margin-top: 16px;
    margin-bottom: 4px;
    page-break-after: avoid;
}
p { margin: 6px 0; }
strong { font-weight: 700; }
em { font-style: italic; }
ul, ol { margin: 6px 0; padding-left: 22px; }
li { margin: 3px 0; }

table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0;
    font-size: 12px;
    page-break-inside: avoid;
}
th {
    text-align: left;
    padding: 8px 10px;
    background: #f0f4f8;
    border-bottom: 2px solid #1B365D;
    font-weight: 700;
    color: #1B365D;
    font-size: 11.5px;
}
td {
    padding: 7px 10px;
    border-bottom: 1px solid #e5e7eb;
    vertical-align: top;
}
tr:last-child td { border-bottom: 2px solid #e5e7eb; }

code {
    font-family: 'SF Mono', 'Consolas', 'Courier New', monospace;
    background: #f3f4f6;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 11px;
}
pre {
    background: #f3f4f6;
    padding: 14px;
    border-radius: 6px;
    border-left: 4px solid #1B365D;
    font-size: 11px;
    line-height: 1.5;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    page-break-inside: avoid;
}
pre code { background: none; padding: 0; }

blockquote {
    margin: 10px 0;
    padding: 10px 14px;
    background: #fefce8;
    border-left: 4px solid #eab308;
    border-radius: 0 6px 6px 0;
    color: #854d0e;
    font-size: 12px;
    page-break-inside: avoid;
}
blockquote p { margin: 3px 0; }

hr {
    border: none;
    border-top: 2px solid #e5e7eb;
    margin: 24px 0;
}

.chapter-break { page-break-before: always; }

.alert-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-left: 4px solid #3b82f6;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 10px 0;
    font-size: 12px;
    page-break-inside: avoid;
}
.alert-box b { color: #1e40af; }

.tip-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-left: 4px solid #22c55e;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 10px 0;
    font-size: 12px;
    page-break-inside: avoid;
}
.tip-box b { color: #166534; }

.faq-q {
    font-weight: 800;
    color: #1B365D;
    font-size: 13.5px;
    margin-top: 16px;
    margin-bottom: 4px;
}
.faq-a {
    margin: 0 0 12px 0;
    padding-left: 14px;
    border-left: 3px solid #e5e7eb;
    color: #374151;
}
"""

# ── HTML Content ─────────────────────────────────────────────────────────────
HTML_CONTENT = f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<style>{CSS}</style>
</head>
<body>

<!-- ════════════════ PORTADA ════════════════ -->
<div class="cover">
    <img src="{logo_data_uri}" alt="Construacero Carabobo" />
    <h1>Manual del Vendedor</h1>
    <p class="subtitle">Sistema de Gestion Construacero</p>
    <p class="subtitle">Guia completa paso a paso</p>
    <div class="role-badge">Rol Vendedor</div>
    <p class="version">Version 1.0 &mdash; Abril 2026</p>
</div>

<!-- ════════════════ INDICE ════════════════ -->
<div class="toc">
    <h2>Indice de contenido</h2>

    <div class="toc-section">1. Primeros pasos</div>
    <div class="toc-item"><b>1.1</b> &mdash; Como ingresar al sistema</div>
    <div class="toc-item"><b>1.2</b> &mdash; Navegacion del sistema</div>
    <div class="toc-item"><b>1.3</b> &mdash; Tu dashboard (pantalla principal)</div>

    <div class="toc-section">2. Clientes</div>
    <div class="toc-item"><b>2.1</b> &mdash; Como crear un cliente nuevo</div>
    <div class="toc-item"><b>2.2</b> &mdash; Editar datos de un cliente</div>
    <div class="toc-item"><b>2.3</b> &mdash; Ficha del cliente</div>

    <div class="toc-section">3. Cotizaciones</div>
    <div class="toc-item"><b>3.1</b> &mdash; Como crear una cotizacion</div>
    <div class="toc-item"><b>3.2</b> &mdash; Como modificar una cotizacion</div>
    <div class="toc-item"><b>3.3</b> &mdash; Compartir por WhatsApp y PDF</div>
    <div class="toc-item"><b>3.4</b> &mdash; Estados de una cotizacion</div>

    <div class="toc-section">4. Venta Rapida</div>
    <div class="toc-item"><b>4.1</b> &mdash; Que es y cuando usarla</div>
    <div class="toc-item"><b>4.2</b> &mdash; Paso 1: Productos</div>
    <div class="toc-item"><b>4.3</b> &mdash; Paso 2: Pago</div>
    <div class="toc-item"><b>4.4</b> &mdash; Paso 3: Confirmar</div>

    <div class="toc-section">5. Despachos</div>
    <div class="toc-item"><b>5.1</b> &mdash; Como crear un despacho desde una cotizacion</div>
    <div class="toc-item"><b>5.2</b> &mdash; Ver tus despachos y sus estados</div>
    <div class="toc-item"><b>5.3</b> &mdash; Documentos: Nota de Entrega y Orden de Despacho</div>

    <div class="toc-section">6. Herramientas utiles</div>
    <div class="toc-item"><b>6.1</b> &mdash; Boton de WhatsApp</div>
    <div class="toc-item"><b>6.2</b> &mdash; Descargar e imprimir PDF</div>
    <div class="toc-item"><b>6.3</b> &mdash; Ver precios en bolivares</div>
    <div class="toc-item"><b>6.4</b> &mdash; Notificaciones</div>

    <div class="toc-section">7. Preguntas frecuentes (FAQ)</div>

    <div class="toc-section">8. Glosario</div>
</div>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 1: PRIMEROS PASOS                                             -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>1. Primeros pasos</h1>

<h2>1.1 &mdash; Como ingresar al sistema</h2>

<h3>Paso 1 &mdash; Abrir la aplicacion</h3>
<p>Abre el navegador en tu celular o computadora y ve a la direccion que te indico el supervisor. Tambien puedes instalar la app desde el navegador (aparece un mensaje &ldquo;Instalar aplicacion&rdquo;).</p>

<h3>Paso 2 &mdash; Iniciar sesion con email y contrasena</h3>
<p>La primera vez que entres, el sistema te pide el <strong>email</strong> y la <strong>contrasena</strong> de la cuenta del negocio. Estos datos los proporciona el supervisor. La sesion se guarda automaticamente, asi que no tendras que escribirlos cada vez.</p>

<h3>Paso 3 &mdash; Seleccionar tu operador</h3>
<p>Veras una lista con los nombres y avatares de todos los operadores registrados. Cada uno muestra su nombre y su rol (vendedor, supervisor, etc.) con un color distintivo. Busca tu nombre y haz clic en el.</p>

<h3>Paso 4 &mdash; Ingresar tu PIN</h3>
<p>Se abre un teclado numerico donde debes escribir tu PIN personal de <strong>4 digitos</strong> (para vendedores). Si el PIN es correcto, entras directamente a tu dashboard.</p>

<div class="alert-box">
<b>Importante:</b> Tu PIN es personal y no lo compartas con nadie. Si lo olvidas, el supervisor puede restablecerlo. Despues de 3 intentos fallidos, el sistema te bloquea por 30 segundos.
</div>

<h2>1.2 &mdash; Navegacion</h2>

<p>Como vendedor tienes acceso a las siguientes secciones:</p>
<ul>
    <li><strong>Inicio</strong> &mdash; Tu pantalla principal con resumen del dia</li>
    <li><strong>Venta rapida</strong> &mdash; Venta directa en tienda (icono de rayo)</li>
    <li><strong>Cotizaciones</strong> &mdash; Todas tus cotizaciones</li>
    <li><strong>Clientes</strong> &mdash; Lista de todos tus clientes</li>
    <li><strong>Despachos</strong> &mdash; Notas de despacho creadas</li>
    <li><strong>Inventario</strong> &mdash; Consultar productos y stock disponible</li>
    <li><strong>Transportistas</strong> &mdash; Lista de transportistas disponibles</li>
    <li><strong>Comisiones</strong> &mdash; Tus comisiones generadas</li>
</ul>

<div class="tip-box">
<b>En movil:</b> La navegacion aparece en la <strong>barra inferior</strong>. Las secciones que no caben se agrupan dentro del boton <strong>&ldquo;Mas&rdquo;</strong>. Tambien tienes un <strong>boton flotante (+)</strong> para crear rapidamente una cotizacion o venta rapida.
</div>

<h2>1.3 &mdash; Tu dashboard</h2>
<p>Al entrar, ves tu pantalla principal con:</p>
<ul>
    <li>Tu nombre y rol en la parte superior</li>
    <li><strong>Cotizaciones del dia</strong> &mdash; cuantas has creado hoy</li>
    <li><strong>Despachos pendientes</strong> &mdash; despachos esperando aprobacion</li>
    <li><strong>Accesos rapidos</strong> &mdash; botones para las acciones mas usadas</li>
</ul>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 2: CLIENTES                                                    -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>2. Clientes</h1>

<h2>2.1 &mdash; Como crear un cliente nuevo</h2>

<h3>PASO 1 &mdash; Ir a la seccion Clientes</h3>
<p>Haz clic en <strong>Clientes</strong> desde el menu.</p>
<p>Veras la lista de todos los clientes registrados con un contador arriba (ej: &ldquo;8 clientes&rdquo;, &ldquo;9 clientes&rdquo;).</p>

<h3>PASO 2 &mdash; Abrir el formulario</h3>
<p>Haz clic en el boton <strong>+ Nuevo cliente</strong> en la parte superior de la pantalla.</p>
<p>Se abrira un formulario con el titulo <strong>&ldquo;Nuevo cliente&rdquo;</strong>.</p>

<h3>PASO 3 &mdash; Llenar el formulario campo por campo</h3>

<h4>1. Nombre * (obligatorio)</h4>
<p>Escribe el nombre completo de la persona o el nombre comercial.</p>
<ul><li>Ejemplo: <code>Carlos Mendoza Ferreteria El Clavo</code></li></ul>

<h4>2. Tipo de cliente * (obligatorio)</h4>
<p>Haz clic en el desplegable y elige:</p>
<ul>
    <li><strong>Natural</strong> &rarr; para personas fisicas (V-xxxxx)</li>
    <li><strong>Juridico</strong> &rarr; para empresas (J-xxxxx)</li>
</ul>
<p>Por defecto viene en <strong>Natural</strong>.</p>

<h4>3. RIF / Cedula * (obligatorio)</h4>
<p>Primero selecciona el <strong>prefijo</strong> haciendo clic en el boton correspondiente:</p>
<table>
<tr><th>Boton</th><th>Significa</th></tr>
<tr><td><strong>V</strong></td><td>Venezolano</td></tr>
<tr><td><strong>J</strong></td><td>Juridico (empresa)</td></tr>
<tr><td><strong>E</strong></td><td>Extranjero</td></tr>
<tr><td><strong>G</strong></td><td>Gubernamental</td></tr>
<tr><td><strong>P</strong></td><td>Pasaporte</td></tr>
</table>
<p>Luego escribe solo el numero sin puntos ni guiones.</p>
<ul><li>Ejemplo: selecciona V y escribe <code>15823490</code></li></ul>

<h4>4. Telefono * (obligatorio)</h4>
<p>El codigo de pais <code>+58</code> ya viene fijo. Escribe el numero desde el operador.</p>
<ul>
    <li>Ejemplo: <code>4124556789</code></li>
    <li>Este numero se usara para el boton de <strong>WhatsApp</strong> al enviar cotizaciones.</li>
</ul>

<h4>5. Correo electronico (opcional)</h4>
<p>Escribe el email del cliente.</p>
<ul><li>Ejemplo: <code>cmendoza@ferreteria.com</code></li></ul>

<h4>6. Estado * (obligatorio)</h4>
<p>Haz clic en el desplegable <strong>&ldquo;Seleccionar...&rdquo;</strong> bajo Estado.</p>
<ul>
    <li>Aparece un buscador: escribe las primeras letras del estado.</li>
    <li>Ejemplo: escribe <code>Cara</code> y selecciona <strong>Carabobo</strong>.</li>
</ul>

<h4>7. Ciudad * (obligatorio)</h4>
<p>Despues de elegir el estado, haz clic en el desplegable de <strong>Ciudad</strong>.</p>
<ul>
    <li>Las ciudades se cargan segun el estado elegido.</li>
    <li>Ejemplo: selecciona <strong>Valencia</strong>.</li>
</ul>

<h4>8. Direccion * (obligatorio)</h4>
<p>Escribe la direccion fisica completa del cliente.</p>
<ul><li>Ejemplo: <code>Av. Michelena, Local 45, Galpon Industrial</code></li></ul>

<h4>9. Notas (opcional)</h4>
<p>Escribe observaciones internas sobre el cliente que solo vera el equipo.</p>
<ul><li>Ejemplo: <code>Cliente compra material estructural al por mayor</code></li></ul>

<h3>PASO 4 &mdash; Crear el cliente</h3>
<p>Una vez llenados todos los campos obligatorios (*), haz clic en el boton <strong>&ldquo;Crear cliente&rdquo;</strong> (verde).</p>
<p>Si quieres cancelar sin guardar, haz clic en <strong>&ldquo;Cancelar&rdquo;</strong>.</p>

<h3>PASO 5 &mdash; Verificar que se creo</h3>
<p>El sistema cierra el modal automaticamente y regresa a la lista de clientes. Verifica que:</p>
<ul>
    <li>El contador de clientes aumento (de 8 a <strong>9 clientes</strong>).</li>
    <li>La nueva tarjeta aparece en la lista con las iniciales, nombre, cedula, telefono, email, direccion y el vendedor asignado (tu automaticamente).</li>
    <li>Aparecen los botones <strong>Cotizar</strong>, <strong>Ficha</strong> y <strong>Editar</strong> en tu nueva tarjeta.</li>
</ul>

<h3>Resumen visual del proceso</h3>
<pre>
Menu &rarr; Clientes
  &rarr; Boton &ldquo;+ Nuevo cliente&rdquo;
    &rarr; Llenar: Nombre / Tipo / Cedula / Telefono / Email / Estado / Ciudad / Direccion / Notas
      &rarr; Boton &ldquo;Crear cliente&rdquo;
        &rarr; Cliente aparece en la lista &#10003;
</pre>

<h3>Errores comunes a evitar</h3>
<table>
<tr><th>Error</th><th>Solucion</th></tr>
<tr><td>No seleccionar Estado primero</td><td>Las ciudades no cargan si no eliges el estado antes</td></tr>
<tr><td>Dejar campos obligatorios vacios</td><td>El boton <strong>Crear cliente</strong> no funcionara hasta completarlos</td></tr>
<tr><td>Escribir el telefono con el +58</td><td>El sistema ya lo agrega, solo escribe desde el operador (04xx &rarr; 4xx)</td></tr>
<tr><td>Cedula con puntos o guiones</td><td>Escribe solo los numeros, sin caracteres especiales</td></tr>
</table>

<div class="tip-box">
<b>Dato:</b> El cliente queda asignado automaticamente al vendedor que lo registro. Solo el supervisor puede reasignarlo a otro vendedor.
</div>

<h2>2.2 &mdash; Editar datos de un cliente</h2>
<p>Si necesitas corregir el telefono, direccion u otro dato de un cliente:</p>
<ol>
    <li>Ve a <strong>Clientes</strong> y busca la tarjeta del cliente.</li>
    <li>Haz clic en el boton <strong>Editar</strong>.</li>
    <li>Se abre el mismo formulario con los datos precargados.</li>
    <li>Modifica lo que necesites y haz clic en <strong>Guardar cambios</strong>.</li>
</ol>

<h2>2.3 &mdash; Ficha del cliente</h2>
<p>El boton <strong>Ficha</strong> en la tarjeta del cliente abre un resumen completo con:</p>
<ul>
    <li>Todos los datos de contacto</li>
    <li>Historial de cotizaciones creadas para ese cliente</li>
    <li>Despachos asociados</li>
    <li>Total facturado</li>
</ul>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 3: COTIZACIONES                                                -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>3. Cotizaciones</h1>

<h2>3.1 &mdash; Como crear una cotizacion</h2>

<p>El sistema te guia a traves de un asistente de <strong>4 pasos numerados</strong> que aparecen en la barra superior:</p>

<pre>1. Cliente  &rarr;  2. Productos  &rarr;  3. Resumen  &rarr;  4. Enviada</pre>

<h3>Como llegar al asistente &mdash; 2 formas</h3>

<h4>Opcion A: Desde la tarjeta del cliente (recomendado)</h4>
<ol>
    <li>Ve a <strong>Clientes</strong> desde el menu.</li>
    <li>Ubica la tarjeta de tu cliente (ej. Carlos Mendoza).</li>
    <li>Haz clic en el boton <strong>Cotizar</strong> que aparece en su tarjeta.</li>
    <li>El sistema abre el asistente con el cliente ya preseleccionado.</li>
</ol>

<h4>Opcion B: Desde Cotizaciones</h4>
<ol>
    <li>Ve a <strong>Cotizaciones</strong> desde el menu.</li>
    <li>Haz clic en el boton <strong>+ Nueva</strong>.</li>
    <li>Busca y selecciona el cliente manualmente.</li>
</ol>

<h3>PASO 1 &mdash; Seleccionar cliente</h3>
<p>Si entraste desde la tarjeta del cliente, lo veras ya cargado automaticamente con todos sus datos: cedula, telefono y direccion.</p>
<p>Si no, usa el buscador para encontrar el cliente por nombre o cedula.</p>
<p>Cuando el cliente este seleccionado, haz clic en <strong>Siguiente: Productos &rarr;</strong></p>

<h3>PASO 2 &mdash; Agregar productos</h3>
<p>Veras el catalogo de productos con el buscador y las pestanas de categorias.</p>

<div class="tip-box">
<b>En movil:</b> La cesta se muestra como un boton flotante en la parte inferior con el total. Tocalo para ver los productos agregados. En PC, la cesta aparece fija a la derecha.
</div>

<h4>Buscar un producto</h4>
<ul>
    <li>Usa el <strong>buscador</strong> escribiendo el nombre o codigo del producto.
        <ul><li>Ejemplo: escribe <code>cabilla</code> y aparecen todas las cabillas disponibles.</li></ul>
    </li>
    <li>O navega por las <strong>pestanas de categorias</strong>: CONEXIONES, ELECTRICIDAD, LAMINAS, PERFILES, TUBOS, VIGAS, etc.</li>
</ul>

<h4>Informacion de cada producto en el catalogo</h4>
<p>Cada tarjeta muestra:</p>
<ul>
    <li>Nombre y codigo del producto</li>
    <li>Precio en <strong>$</strong> y en <strong>Bs</strong></li>
    <li><strong>Stock disponible</strong> (ej. &ldquo;434 disp.&rdquo;)</li>
    <li>Si dice <strong>AGOTADO</strong> &mdash; no se puede agregar</li>
</ul>

<h4>Agregar un producto</h4>
<p>Haz clic sobre la tarjeta del producto. El sistema lo agrega inmediatamente a la cesta con cantidad 1.</p>

<h4>Ajustar cantidades</h4>
<p>En la cesta usa los botones:</p>
<ul>
    <li><strong>+</strong> &rarr; aumenta 1 unidad</li>
    <li><strong>&minus;</strong> &rarr; reduce 1 unidad</li>
    <li>Icono de <strong>papelera</strong> &rarr; elimina el producto de la cesta</li>
</ul>
<p><em>En movil:</em> toca el numero de cantidad para escribir la cantidad exacta con el teclado.</p>

<h4>Ejemplo de cesta</h4>
<table>
<tr><th>Producto</th><th>Cant.</th><th>Precio unit.</th><th>Subtotal</th></tr>
<tr><td>Cabilla 1/2&rdquo; x 6m SIDETUR</td><td>10</td><td>$6.00</td><td>$60.00</td></tr>
<tr><td>Cemento Gris Ensacado</td><td>5</td><td>$11.00</td><td>$55.00</td></tr>
<tr><td><strong>TOTAL</strong></td><td></td><td></td><td><strong>$115.00</strong></td></tr>
</table>

<p>Cuando termines, haz clic en &rarr; <strong>Continuar al resumen</strong></p>

<h3>PASO 3 &mdash; Resumen y opciones</h3>
<p>Esta pantalla muestra las opciones de la cotizacion y el resumen final.</p>

<h4>Opciones</h4>
<p><strong>Moneda del PDF:</strong> Elige como quieres que aparezcan los precios en el documento que vera el cliente:</p>
<table>
<tr><th>Opcion</th><th>Que muestra el PDF</th></tr>
<tr><td><strong>USDT ($)</strong></td><td>Solo precios en dolares</td></tr>
<tr><td><strong>Dolar BCV</strong></td><td>Precios en $ con tasa BCV oficial</td></tr>
<tr><td><strong>Bolivares (Bs)</strong></td><td>Solo precios en Bs</td></tr>
<tr><td><strong>Mixto USDT</strong></td><td>Precios en $ y Bs (tasa USDT)</td></tr>
<tr><td><strong>Mixto BCV</strong></td><td>Precios en $ y Bs (tasa BCV)</td></tr>
</table>

<p><strong>Notas para el cliente</strong> (aparece en el PDF):</p>
<ul>
    <li>Escribe condiciones de la oferta que el cliente vera.</li>
    <li>Ejemplo: <code>Precios validos por 5 dias habiles. Sujeto a disponibilidad de stock.</code></li>
</ul>

<p><strong>Notas internas</strong> (NO aparece en el PDF):</p>
<ul>
    <li>Solo el equipo interno puede verlas.</li>
    <li>Ejemplo: <code>Cliente nuevo, hacer seguimiento en 48 horas.</code></li>
</ul>

<h4>Resumen de la cotizacion</h4>
<ul>
    <li>Nombre del cliente</li>
    <li>Lista de todos los productos con cantidades y precios</li>
    <li>Subtotal y <strong>TOTAL en $</strong></li>
    <li>Equivalencia en Bs y USDT segun tasa activa</li>
    <li>Boton <strong>Editar</strong> para volver al catalogo y modificar productos</li>
</ul>

<h4>Botones de accion</h4>
<table>
<tr><th>Boton</th><th>Que hace</th></tr>
<tr><td><strong>Enviar cotizacion</strong></td><td>Cambia estado a &ldquo;Enviada&rdquo; y queda lista para compartir con el cliente</td></tr>
<tr><td><strong>Guardar borrador</strong></td><td>Guarda sin enviar, puedes editarla despues</td></tr>
<tr><td><strong>&larr; Volver a productos</strong></td><td>Regresa al catalogo para agregar o quitar productos</td></tr>
</table>

<h3>PASO 4 &mdash; Resultado final</h3>

<h4>Si guardaste como Borrador</h4>
<p>La cotizacion aparece en la lista como <strong>COT-00XXX &mdash; Borrador</strong> con:</p>
<ul>
    <li>Boton <strong>Ver</strong> para revisar el detalle</li>
    <li>Boton <strong>Editar</strong> para modificarla antes de enviar</li>
</ul>

<h4>Si enviaste directamente</h4>
<p>La cotizacion aparece como <strong>Enviada</strong> y tendras disponible:</p>
<ul>
    <li><strong>Ver</strong> &mdash; revisar el detalle</li>
    <li><strong>Nueva version</strong> &mdash; crear una Rev.2 con cambios</li>
    <li><strong>Bolivares</strong> &mdash; ver totales en Bs</li>
    <li><strong>PDF</strong> &mdash; descargar el documento</li>
    <li><strong>Imprimir</strong> &mdash; imprimir directamente</li>
    <li><strong>WhatsApp</strong> &mdash; enviar al cliente con un clic</li>
    <li><strong>Despachar</strong> &mdash; iniciar entrega cuando el cliente acepte</li>
</ul>

<h3>Resumen visual del proceso</h3>
<pre>
Clientes &rarr; Cotizar (boton en tarjeta del cliente)
  &rarr; PASO 1: Cliente preseleccionado &rarr; Siguiente
    &rarr; PASO 2: Buscar producto &rarr; Clic para agregar &rarr; Ajustar cantidad
      &rarr; Continuar al resumen
        &rarr; PASO 3: Elegir moneda PDF &rarr; Escribir notas
          &rarr; Guardar borrador / Enviar cotizacion
            &rarr; COT-00XXX aparece en la lista &#10003;
</pre>

<h3>Consejos practicos</h3>
<ul>
    <li><strong>Siempre revisa el stock</strong> antes de cotizar &mdash; los productos agotados aparecen marcados en rojo.</li>
    <li>Usa <strong>&ldquo;Guardar borrador&rdquo;</strong> cuando quieras consultar precios o disponibilidad antes de enviar.</li>
    <li><strong>Las notas internas</strong> son perfectas para recordatorios como &ldquo;cliente pidio descuento&rdquo; o &ldquo;llamar manana&rdquo;.</li>
    <li><strong>La moneda del PDF mas usada</strong> para Venezuela es <strong>Mixto BCV</strong> o <strong>Mixto USDT</strong>, porque el cliente ve el precio en $ y en Bs al mismo tiempo.</li>
    <li>Despues de enviar, usa <strong>WhatsApp</strong> para compartir el PDF directamente desde el sistema sin descargar nada.</li>
</ul>

<!-- ── 3.2 Modificar cotizacion ── -->

<h2>3.2 &mdash; Como modificar una cotizacion</h2>

<div class="alert-box">
<b>Regla clave:</b> El camino depende del estado actual de la cotizacion.
</div>

<table>
<tr><th>Estado de la cotizacion</th><th>Como se modifica</th></tr>
<tr><td><strong>Borrador</strong></td><td>Boton <strong>Editar</strong> &mdash; modificacion directa</td></tr>
<tr><td><strong>Enviada</strong></td><td>Boton <strong>Nueva version</strong> &mdash; crea una copia editable</td></tr>
<tr><td>Aprobada / Anulada / No aceptada</td><td>No se puede modificar</td></tr>
</table>

<h3>CASO 1 &mdash; Cotizacion en BORRADOR</h3>
<ol>
    <li>Ve a <strong>Cotizaciones</strong> desde el menu.</li>
    <li>Localiza la tarjeta con etiqueta <strong>Borrador</strong> (gris).</li>
    <li>Haz clic en el boton <strong>Editar</strong>.</li>
    <li>El editor abre el catalogo con <strong>los productos originales precargados</strong> en la cesta.</li>
    <li>Modifica lo que necesites: quitar productos, cambiar cantidades, agregar nuevos.</li>
    <li>Haz clic en &rarr; <strong>Continuar al resumen</strong>.</li>
    <li>Revisa el nuevo total y haz clic en <strong>Guardar borrador</strong> o <strong>Enviar cotizacion</strong>.</li>
</ol>

<h3>CASO 2 &mdash; Cotizacion ya ENVIADA</h3>
<p>Este es el flujo mas importante. Una cotizacion enviada <strong>no se puede editar directamente</strong> &mdash; el sistema protege el historial comercial.</p>
<ol>
    <li>Ve a <strong>Cotizaciones</strong> desde el menu.</li>
    <li>Localiza la tarjeta con etiqueta <strong>Enviada</strong> (azul).</li>
    <li>Haz clic en el boton <strong>Nueva version</strong>.</li>
    <li>El sistema muestra un aviso: <em>&ldquo;COT-00209 ya fue enviada y no se puede modificar. Se creara una copia editable (Rev.3) con los mismos datos, y la cotizacion original quedara anulada automaticamente.&rdquo;</em></li>
    <li>Haz clic en <strong>&ldquo;Crear copia editable&rdquo;</strong> para confirmar.</li>
    <li>El editor se abre con la cesta precargada. Aplica los cambios del cliente.</li>
    <li>Haz clic en &rarr; <strong>Continuar al resumen</strong> &rarr; <strong>Enviar cotizacion</strong>.</li>
    <li>Desde la tarjeta de la nueva version usa <strong>WhatsApp</strong> para enviar el PDF actualizado.</li>
</ol>

<div class="tip-box">
<b>Que pasa con las versiones:</b> La nueva version hereda todos los productos, cantidades y notas de la original. El numero de revision sube automaticamente (Rev.2 &rarr; Rev.3 &rarr; Rev.4...). La version anterior pasa a estado <strong>Anulada</strong> en el historial.
</div>

<h3>Errores que debes evitar</h3>
<table>
<tr><th>Situacion</th><th>No hacer</th><th>Si hacer</th></tr>
<tr><td>Cliente pide bajar precio</td><td>Crear cotizacion nueva</td><td>Editar (borrador) o Nueva version (enviada)</td></tr>
<tr><td>Olvidaste agregar un producto</td><td>Anular manualmente</td><td>Editar o Nueva version segun el estado</td></tr>
<tr><td>Cliente rechazo y quiere otra propuesta</td><td>Editar la anulada</td><td>Crear cotizacion <strong>nueva</strong> desde cero</td></tr>
<tr><td>Cotizacion enviada tiene error de precio</td><td>Modificarla directamente</td><td>Hacer <strong>Nueva version</strong> &mdash; el sistema anula la anterior solo</td></tr>
</table>

<!-- ── 3.3 Compartir ── -->

<h2>3.3 &mdash; Compartir por WhatsApp y PDF</h2>

<p>Una vez que la cotizacion esta en estado <strong>Enviada</strong>, tienes varias opciones para compartirla:</p>

<h4>WhatsApp (recomendado)</h4>
<ol>
    <li>En la tarjeta de la cotizacion, haz clic en <strong>WhatsApp</strong>.</li>
    <li>El sistema genera el PDF automaticamente y abre WhatsApp con el numero del cliente precargado.</li>
    <li>Solo presiona <strong>Enviar</strong> en WhatsApp.</li>
</ol>

<h4>Descargar PDF</h4>
<ol>
    <li>Haz clic en el boton <strong>PDF</strong>.</li>
    <li>El archivo se descarga a tu dispositivo.</li>
    <li>Puedes enviarlo por email, Telegram, o cualquier otra via.</li>
</ol>

<h4>Imprimir</h4>
<ol>
    <li>Haz clic en el boton <strong>Imprimir</strong>.</li>
    <li>Se abre el dialogo de impresion o se descarga el PDF dependiendo de tu dispositivo.</li>
</ol>

<!-- ── 3.4 Estados ── -->

<h2>3.4 &mdash; Estados de una cotizacion</h2>

<table>
<tr><th>Estado</th><th>Color</th><th>Significado</th></tr>
<tr><td><strong>Borrador</strong></td><td>Gris</td><td>Guardada pero no enviada. Puedes editarla libremente.</td></tr>
<tr><td><strong>Enviada</strong></td><td>Azul</td><td>Lista para compartir. No se edita, se versiona.</td></tr>
<tr><td><strong>Aprobada</strong></td><td>Verde</td><td>El cliente la acepto.</td></tr>
<tr><td><strong>Anulada</strong></td><td>Rojo/Gris</td><td>Cancelada (manual o por nueva version).</td></tr>
<tr><td><strong>No aceptada</strong></td><td>Naranja</td><td>El cliente la rechazo.</td></tr>
</table>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 4: VENTA RAPIDA                                                -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>4. Venta Rapida</h1>

<h2>4.1 &mdash; Que es y cuando usarla</h2>

<p>La Venta Rapida te permite crear una <strong>cotizacion y un despacho al mismo tiempo</strong>, en una sola operacion. Es ideal para cuando el cliente esta en tienda, ya eligio lo que quiere y va a pagar de una vez.</p>

<table>
<tr><th></th><th>Cotizacion normal</th><th>Venta Rapida</th></tr>
<tr><td><strong>Pasos</strong></td><td>Crear cotizacion &rarr; Enviar &rarr; Despachar (por separado)</td><td>Todo en un solo proceso</td></tr>
<tr><td><strong>Stock</strong></td><td>Se descuenta al crear el despacho</td><td>Se descuenta inmediatamente al confirmar</td></tr>
<tr><td><strong>Uso ideal</strong></td><td>Cliente pide presupuesto para evaluar</td><td>Cliente esta en tienda listo para comprar</td></tr>
</table>

<p>El asistente tiene <strong>3 pasos</strong>:</p>
<pre>1. Productos  &rarr;  2. Pago  &rarr;  3. Confirmar</pre>

<h3>Como llegar a Venta Rapida &mdash; 3 formas</h3>
<ul>
    <li>Haz clic en <strong>Venta rapida</strong> (icono de rayo) desde el menu.</li>
    <li><em>En movil:</em> toca <strong>Rapida</strong> en la barra inferior.</li>
    <li><em>En movil:</em> Toca el boton flotante redondo (icono +) y selecciona <strong>Venta Rapida</strong> o <strong>Cotizacion</strong>.</li>
</ul>

<h2>4.2 &mdash; Paso 1: Productos</h2>
<p>Selecciona el <strong>cliente</strong> y agrega los <strong>productos</strong> que quiere comprar.</p>

<h3>Seleccionar cliente (obligatorio)</h3>
<p>En la seccion <strong>CLIENTE</strong>, escribe el nombre o la cedula en el buscador.</p>
<ul>
    <li>Aparece una lista con los clientes que coinciden (maximo 8 resultados).</li>
    <li>Haz clic en el cliente correcto para seleccionarlo.</li>
    <li>Aparece una caja verde con el nombre y la cedula confirmados.</li>
</ul>

<p><strong>Si el cliente no existe:</strong> Haz clic en el boton <strong>+</strong> junto al buscador para crearlo ahi mismo. Al crearlo, queda seleccionado automaticamente.</p>

<p><strong>Para cambiar de cliente:</strong> Haz clic en la <strong>X</strong> de la caja verde para deseleccionar y buscar otro.</p>

<h3>Agregar productos</h3>
<p>Funciona igual que en las cotizaciones:</p>
<ul>
    <li>Usa el <strong>buscador</strong> o navega por <strong>categorias</strong> (CONEXIONES, LAMINAS, PERFILES, TUBOS, VIGAS, etc.).</li>
    <li>Haz clic en un producto para agregarlo a la cesta con cantidad 1.</li>
    <li>Ajusta cantidades con <strong>+</strong> / <strong>&minus;</strong> o toca el numero para escribir la cantidad exacta (movil).</li>
    <li>Elimina con el icono de <strong>papelera</strong> (rojo).</li>
    <li>Los productos <strong>agotados</strong> aparecen atenuados y no se pueden agregar.</li>
</ul>

<h3>La cesta</h3>
<p>Muestra los productos agregados con cantidades, subtotales y el total.</p>
<div class="tip-box">
<b>En movil:</b> Toca el boton flotante <strong>&ldquo;Ver Carrito&rdquo;</strong> en la parte inferior para ver y editar los productos agregados. En PC, la cesta aparece fija a la derecha.
</div>

<p>Cuando tengas cliente seleccionado y al menos un producto, haz clic en &rarr; <strong>Siguiente</strong>.</p>

<div class="alert-box">
<b>Importante:</b> El boton <strong>Siguiente</strong> esta desactivado hasta que selecciones un cliente Y agregues al menos un producto.
</div>

<h2>4.3 &mdash; Paso 2: Pago</h2>
<p>Aqui configuras como paga el cliente y los datos del envio.</p>

<h4>1. Forma de pago * (obligatorio)</h4>
<p>Haz clic en uno de los botones:</p>
<table>
<tr><th>Opcion</th><th>Cuando usarla</th></tr>
<tr><td><strong>Efectivo</strong></td><td>El cliente paga en fisico al recibir</td></tr>
<tr><td><strong>Zelle</strong></td><td>Transferencia desde EE.UU.</td></tr>
<tr><td><strong>Pago Movil</strong></td><td>Transferencia bancaria movil Venezuela</td></tr>
<tr><td><strong>USDT</strong></td><td>Pago en criptomoneda</td></tr>
<tr><td><strong>Transferencia</strong></td><td>Transferencia bancaria directa</td></tr>
<tr><td><strong>Cta por cobrar</strong></td><td>El cliente queda con deuda (fiado)</td></tr>
</table>

<h4>2. Referencia / comprobante (opcional)</h4>
<p>Escribe el numero de confirmacion del pago si ya lo tienes.</p>
<ul><li>Ejemplo: <code>PM-20260426-0892</code></li></ul>

<h4>3. Transportista (opcional)</h4>
<p>Selecciona quien llevara el pedido del dropdown, o dejalo en <strong>&ldquo;Sin transportista&rdquo;</strong> si el cliente recoge en tienda.</p>

<h4>4. Monto del flete en USD (solo si seleccionaste transportista)</h4>
<p>Escribe el costo del envio en dolares. Ejemplo: <code>15.00</code></p>

<h4>5. Notas (opcional)</h4>
<p>Observaciones internas que solo ve el equipo.</p>
<ul><li>Ejemplo: <code>Cliente paga al recibir, llamar antes de despachar</code></li></ul>

<p>Haz clic en &rarr; <strong>Siguiente</strong>. Si necesitas volver, usa <strong>Atras</strong>.</p>

<h2>4.4 &mdash; Paso 3: Confirmar</h2>

<div class="alert-box">
<b>Aviso importante:</b> Al confirmar se creara la cotizacion y el despacho. El stock se descontara inmediatamente.
</div>

<p>El sistema muestra un resumen completo para que lo revises:</p>
<ul>
    <li><strong>Cliente:</strong> Nombre y direccion</li>
    <li><strong>Productos:</strong> Lista con cantidad, precio y subtotal de cada uno</li>
    <li><strong>Totales:</strong> Subtotal + IVA (si aplica) + Flete (si hay) = <strong>TOTAL</strong> en $ y Bs</li>
    <li><strong>Pago:</strong> Forma de pago y referencia</li>
    <li><strong>Transporte:</strong> Transportista seleccionado (si hay)</li>
    <li><strong>Notas:</strong> Lo que escribiste (si hay)</li>
</ul>

<p>Si todo esta correcto, haz clic en el boton verde <strong>&ldquo;Crear venta rapida&rdquo;</strong>.</p>

<p>El sistema:</p>
<ul>
    <li>Crea una cotizacion con numero <strong>COT-XXXXX</strong></li>
    <li>Crea un despacho con numero <strong>DES-XXXXX</strong> vinculado a esa cotizacion</li>
    <li><strong>Descuenta el stock</strong> del inventario automaticamente</li>
    <li>Envia una <strong>notificacion al supervisor</strong> para su aprobacion</li>
    <li>Te redirige al modulo <strong>Despachos</strong> donde ves tu venta recien creada</li>
</ul>

<p>Aparece un mensaje verde: <strong>&ldquo;Venta rapida #XXX creada&rdquo;</strong></p>

<h3>Resumen visual</h3>
<pre>
Menu &rarr; Venta rapida (icono de rayo)
  &rarr; PASO 1: Buscar cliente &rarr; Seleccionar
    &rarr; Buscar producto &rarr; Clic para agregar &rarr; Ajustar cantidad
      &rarr; &ldquo;Siguiente&rdquo;
        &rarr; PASO 2: Elegir forma de pago
          &rarr; (Opcional) Referencia, Transportista, Flete, Notas
            &rarr; &ldquo;Siguiente&rdquo;
              &rarr; PASO 3: Revisar resumen completo
                &rarr; &ldquo;Crear venta rapida&rdquo;
                  &rarr; Cotizacion + Despacho creados &#10003;
                  &rarr; Stock descontado &#10003;
                  &rarr; DES-XXXXX en Despachos &#10003;
</pre>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 5: DESPACHOS                                                   -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>5. Despachos</h1>

<h2>5.1 &mdash; Como crear un despacho desde una cotizacion</h2>

<h3>Paso 1 &mdash; Ir a Cotizaciones</h3>
<p>Ve a <strong>Cotizaciones</strong> desde el menu. Localiza la cotizacion que el cliente acepto. Debe estar en estado <strong>Enviada</strong> (etiqueta azul).</p>

<div class="alert-box">
<b>Recuerda:</b> Solo las cotizaciones en estado <strong>Enviada</strong> muestran el boton Despachar. Los borradores no lo tienen.
</div>

<h3>Paso 2 &mdash; Hacer clic en &ldquo;Despachar&rdquo;</h3>
<p>En la tarjeta de la cotizacion, haz clic en <strong>Despachar</strong>.</p>
<p><em>En movil:</em> puede estar dentro del menu <strong>&ldquo;Mas&rdquo;</strong> en la tarjeta.</p>
<p>Se abre el formulario <strong>&ldquo;Crear orden de despacho&rdquo;</strong>.</p>

<h3>Paso 3 &mdash; Revisar el resumen del despacho</h3>
<p>El formulario muestra:</p>
<table>
<tr><th>Campo</th><th>Contenido</th></tr>
<tr><td><strong>Numero</strong></td><td>Numero de la cotizacion (ej. COT-00212)</td></tr>
<tr><td><strong>Cliente</strong></td><td>Nombre del cliente</td></tr>
<tr><td><strong>Productos</strong></td><td>Lista con codigo, nombre, cantidad y precio unitario</td></tr>
<tr><td><strong>Total</strong></td><td>Monto en $ y Bs</td></tr>
</table>

<p>Lee el aviso amarillo: <em>&ldquo;Al crear la orden de despacho, el stock se descontara automaticamente del inventario.&rdquo;</em></p>

<h3>Paso 4 &mdash; Seleccionar la forma de pago (obligatorio)</h3>
<p>Haz clic en uno de los botones de pago:</p>
<table>
<tr><th>Opcion</th><th>Cuando usarla</th></tr>
<tr><td><strong>Efectivo</strong></td><td>El cliente paga en fisico al recibir</td></tr>
<tr><td><strong>Zelle</strong></td><td>Transferencia desde EE.UU.</td></tr>
<tr><td><strong>Pago Movil</strong></td><td>Transferencia bancaria movil Venezuela</td></tr>
<tr><td><strong>USDT</strong></td><td>Pago en criptomoneda</td></tr>
<tr><td><strong>Transferencia</strong></td><td>Transferencia bancaria directa</td></tr>
<tr><td><strong>Cta por cobrar</strong></td><td>El cliente queda con deuda (fiado)</td></tr>
</table>

<h3>Paso 5 &mdash; Referencia del pago (opcional)</h3>
<p>En el campo <strong>&ldquo;Referencia / comprobante&rdquo;</strong> escribe el numero de confirmacion.</p>
<ul><li>Ejemplo: <code>PM-20260426-0892</code></li></ul>

<h3>Paso 6 &mdash; Seleccionar el transportista (opcional)</h3>
<p>Haz clic en el dropdown <strong>&ldquo;Transportista&rdquo;</strong>. Selecciona el que llevara el pedido, o dejalo en <strong>&ldquo;Sin transportista&rdquo;</strong> si el cliente recoge en tienda.</p>

<h3>Paso 7 &mdash; Confirmar el despacho</h3>
<p>Haz clic en el boton <strong>&ldquo;Confirmar despacho&rdquo;</strong>.</p>
<p>El sistema:</p>
<ul>
    <li>Crea el despacho con numero <strong>DES-XXXXX</strong></li>
    <li>Descuenta el stock del inventario automaticamente</li>
    <li>Envia una notificacion al supervisor para su aprobacion</li>
    <li>Te redirige al modulo <strong>Despachos</strong></li>
</ul>

<h2>5.2 &mdash; Ver tus despachos y sus estados</h2>

<p>Despues de confirmar, el sistema te lleva a <strong>Despachos</strong> donde ves la tarjeta del despacho recien creado:</p>

<table>
<tr><th>Elemento</th><th>Descripcion</th></tr>
<tr><td><strong>DES-00XXX</strong></td><td>Numero unico del despacho</td></tr>
<tr><td><strong>COT-00XXX</strong></td><td>Cotizacion de origen</td></tr>
<tr><td><strong>&ldquo;Esperando aprobacion&rdquo;</strong></td><td>Estado inicial &mdash; el supervisor debe revisarlo</td></tr>
<tr><td><strong>Cliente</strong></td><td>Nombre del cliente</td></tr>
<tr><td><strong>Total</strong></td><td>Monto en $ y Bs</td></tr>
</table>

<h3>Botones disponibles en tu despacho</h3>
<table>
<tr><th>Boton</th><th>Funcion</th></tr>
<tr><td><strong>Ver</strong></td><td>Abre el detalle completo del despacho</td></tr>
<tr><td><strong>N. Entrega</strong></td><td>Descarga la nota de entrega en PDF (siempre en Bs)</td></tr>
<tr><td><strong>O. Despacho</strong></td><td>Descarga la orden de despacho &mdash; puedes elegir la moneda (USDT, BCV, Bs, Mixto)</td></tr>
<tr><td><strong>Imprimir</strong></td><td>Imprime la Nota de Entrega o la Orden de Despacho</td></tr>
</table>

<div class="tip-box">
<b>En movil:</b> Los botones aparecen de forma compacta. Toca <strong>&ldquo;Mas&rdquo;</strong> para ver todas las acciones disponibles.
</div>

<h3>Estados del despacho</h3>
<table>
<tr><th>Estado</th><th>Color</th><th>Significado</th><th>Quien actua</th></tr>
<tr><td><strong>Esperando aprobacion</strong></td><td>Amarillo</td><td>Creado por vendedor, pendiente</td><td>Supervisor</td></tr>
<tr><td><strong>Despachada</strong></td><td>Indigo</td><td>Autorizado y en camino</td><td>Almacen / Transportista</td></tr>
<tr><td><strong>Entregada</strong></td><td>Verde azulado</td><td>Producto llego al cliente</td><td>Sistema genera comision</td></tr>
<tr><td><strong>Anulada</strong></td><td>Naranja</td><td>Despacho cancelado</td><td>Supervisor</td></tr>
</table>

<h2>5.3 &mdash; Documentos: Nota de Entrega y Orden de Despacho</h2>

<p>Desde la tarjeta de cualquier despacho puedes generar dos documentos PDF:</p>

<h4>Nota de Entrega</h4>
<p>Documento que se le entrega al cliente junto con la mercancia. Incluye: datos del cliente, lista de productos, cantidades, precios y total.</p>

<h4>Orden de Despacho</h4>
<p>Documento interno para el almacen/transportista. Incluye: datos de envio, productos a despachar, y espacio para firmas de recepcion.</p>

<div class="tip-box">
<b>Tip:</b> Tambien puedes descargar plantillas vacias de estos documentos desde la seccion Despachos, usando el boton <strong>&ldquo;Plantilla vacia&rdquo;</strong> en la parte superior.
</div>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 6: HERRAMIENTAS UTILES                                         -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>6. Herramientas utiles</h1>

<h2>6.1 &mdash; Boton de WhatsApp</h2>
<p>Al crear una cotizacion en estado <strong>Enviada</strong>, aparece el boton <strong>WhatsApp</strong> en la tarjeta.</p>
<ol>
    <li>Haz clic en <strong>WhatsApp</strong>.</li>
    <li>El sistema genera el PDF y abre WhatsApp con el numero del cliente precargado.</li>
    <li>El numero del cliente ya viene precargado.</li>
    <li>Solo presiona <strong>Enviar</strong>.</li>
</ol>
<div class="tip-box">
<b>Tip:</b> Para que funcione correctamente, asegurate de que el telefono del cliente este bien registrado (sin el +58, solo el numero desde el operador).
</div>

<h2>6.2 &mdash; Descargar e imprimir PDF</h2>
<p>Los botones <strong>PDF</strong> e <strong>Imprimir</strong> estan disponibles en cotizaciones enviadas y en despachos.</p>
<ul>
    <li><strong>PDF:</strong> Descarga el archivo al dispositivo.</li>
    <li><strong>Imprimir:</strong> Abre el dialogo de impresion o descarga el PDF.</li>
</ul>

<h2>6.3 &mdash; Ver precios en bolivares</h2>
<p>El boton <strong>Bs</strong> (o <strong>Bolivares</strong>) convierte los montos de la tarjeta a bolivares usando la tasa de cambio activa. Haz clic de nuevo para volver a dolares.</p>

<h2>6.4 &mdash; Notificaciones</h2>
<p>El sistema envia notificaciones push automaticas. Para recibirlas:</p>
<ol>
    <li>Cuando el sistema te pregunte si quieres recibir notificaciones, acepta.</li>
    <li>Recibiras alertas cuando el supervisor apruebe tus despachos o cuando haya cambios importantes.</li>
</ol>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 7: PREGUNTAS FRECUENTES                                        -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>7. Preguntas frecuentes (FAQ)</h1>

<p class="faq-q">Puedo editar una cotizacion que ya envie al cliente?</p>
<p class="faq-a">No directamente. Debes hacer clic en <strong>Nueva version</strong>, lo cual crea una copia editable (Rev.2, Rev.3, etc.) y la version anterior queda automaticamente anulada. Esto protege el historial comercial.</p>

<p class="faq-q">Cual es la diferencia entre Venta Rapida y una cotizacion normal?</p>
<p class="faq-a">La <strong>Venta Rapida</strong> crea la cotizacion y el despacho en un solo paso. El stock se descuenta inmediatamente. La cotizacion normal requiere crear la cotizacion, enviarla al cliente, y luego crear el despacho por separado. Usa Venta Rapida cuando el cliente esta en tienda listo para comprar.</p>

<p class="faq-q">Puedo usar un cliente que pertenece a otro vendedor?</p>
<p class="faq-a">El sistema te avisa con un mensaje: <em>&ldquo;Este cliente pertenece a otro vendedor.&rdquo;</em> Puedes continuar si lo necesitas, pero lo ideal es coordinar con tu companero o pedirle al supervisor que te lo reasigne.</p>

<p class="faq-q">Que pasa si me equivoque en un despacho ya creado?</p>
<p class="faq-a">El vendedor no puede modificar ni anular un despacho. Debes avisar al <strong>supervisor</strong> para que lo anule. Al anularse, el stock se devuelve automaticamente al inventario.</p>

<p class="faq-q">Que significa &ldquo;Cta por cobrar&rdquo; como forma de pago?</p>
<p class="faq-a">Significa que el cliente <strong>no ha pagado todavia</strong> (fiado). El despacho se crea normalmente y queda registrada la deuda. Puedes agregar la referencia del pago despues cuando el cliente pague.</p>

<p class="faq-q">Por que no puedo despachar una cotizacion en borrador?</p>
<p class="faq-a">Solo se pueden despachar cotizaciones en estado <strong>Enviada</strong>. Primero debes enviar la cotizacion al cliente (boton <strong>Enviar cotizacion</strong> en el resumen), y luego aparecera el boton <strong>Despachar</strong>.</p>

<p class="faq-q">Que moneda debo elegir para el PDF de la cotizacion?</p>
<p class="faq-a">Lo mas usado en Venezuela es <strong>Mixto BCV</strong> o <strong>Mixto USDT</strong> porque el cliente ve el precio en dolares y en bolivares al mismo tiempo. Si el cliente solo maneja dolares, usa <strong>USDT ($)</strong>. Si solo maneja bolivares, usa <strong>Bolivares (Bs)</strong>.</p>

<p class="faq-q">Puedo crear un cliente desde la Venta Rapida sin ir a la seccion Clientes?</p>
<p class="faq-a">Si. En el Paso 1 de Venta Rapida, junto al buscador de clientes hay un boton <strong>+</strong> que abre el formulario de nuevo cliente. Al crearlo, queda seleccionado automaticamente.</p>

<p class="faq-q">Que pasa con mi comision despues de crear un despacho?</p>
<p class="faq-a">La comision del vendedor se genera <strong>automaticamente</strong> cuando el despacho cambia a estado <strong>&ldquo;Entregado&rdquo;</strong>. No necesitas hacer nada adicional. Puedes ver tus comisiones en tu dashboard.</p>

<p class="faq-q">Puedo anular un despacho yo mismo?</p>
<p class="faq-a"><strong>No.</strong> Solo el supervisor puede anular despachos. Si necesitas anular uno, contacta al supervisor.</p>

<p class="faq-q">Se puede cotizar un producto que esta agotado?</p>
<p class="faq-a">No. Los productos sin stock aparecen atenuados (gris) con la etiqueta <strong>&ldquo;AGOTADO&rdquo;</strong> y no se pueden agregar a la cesta. Debes esperar a que se reponga el inventario.</p>

<p class="faq-q">Que pasa si el cliente quiere cambiar la cantidad despues de que ya envie la cotizacion?</p>
<p class="faq-a">Haz clic en <strong>Nueva version</strong> en la tarjeta de la cotizacion enviada. Se crea una copia editable donde puedes cambiar cantidades, agregar o quitar productos. Al enviarla, la version anterior se anula automaticamente.</p>

<p class="faq-q">Puedo ver las cotizaciones de otros vendedores?</p>
<p class="faq-a"><strong>No.</strong> Cada vendedor solo ve sus propias cotizaciones y despachos. El supervisor es quien puede ver las de todos los vendedores.</p>

<p class="faq-q">La app funciona sin internet?</p>
<p class="faq-a">La app necesita conexion a internet para funcionar correctamente (cargar productos, precios, clientes, crear cotizaciones, etc.). Sin internet, no podras realizar operaciones.</p>

<p class="faq-q">Como cambio mi PIN?</p>
<p class="faq-a">El vendedor no puede cambiar su propio PIN. Debes pedirle al <strong>supervisor</strong> que te lo cambie desde su panel de administracion.</p>

<p class="faq-q">Puedo cerrar sesion y entrar con otro vendedor en el mismo dispositivo?</p>
<p class="faq-a">Si. Haz clic en tu nombre o avatar en la parte superior y selecciona <strong>Cambiar operador</strong>. Esto te lleva a la pantalla de seleccion de operadores sin cerrar la sesion del negocio. Selecciona el nuevo operador e ingresa su PIN.</p>

<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- CAPITULO 8: GLOSARIO                                                    -->
<!-- ════════════════════════════════════════════════════════════════════════ -->
<div class="chapter-break"></div>

<h1>8. Glosario</h1>

<table>
<tr><th>Termino</th><th>Significado</th></tr>
<tr><td><strong>Borrador</strong></td><td>Cotizacion guardada pero no enviada al cliente. Se puede editar libremente.</td></tr>
<tr><td><strong>Cotizacion</strong></td><td>Documento con la lista de productos, cantidades y precios que se le ofrece al cliente.</td></tr>
<tr><td><strong>Cta por cobrar</strong></td><td>Cuenta por cobrar. El cliente recibe la mercancia pero aun no ha pagado.</td></tr>
<tr><td><strong>Dashboard</strong></td><td>Pantalla principal con el resumen de tu actividad del dia.</td></tr>
<tr><td><strong>Despacho</strong></td><td>Orden de entrega de productos. Se crea a partir de una cotizacion enviada.</td></tr>
<tr><td><strong>Enviada</strong></td><td>Cotizacion que ya fue compartida con el cliente. No se edita directamente, se versiona.</td></tr>
<tr><td><strong>Flete</strong></td><td>Costo del transporte/envio de la mercancia.</td></tr>
<tr><td><strong>Modal</strong></td><td>Ventana emergente que aparece sobre la pantalla actual (ej. formulario de nuevo cliente).</td></tr>
<tr><td><strong>Nota de Entrega</strong></td><td>Documento PDF que se entrega al cliente junto con la mercancia.</td></tr>
<tr><td><strong>Orden de Despacho</strong></td><td>Documento PDF interno para el almacen y transportista.</td></tr>
<tr><td><strong>Operador</strong></td><td>Cada persona que usa el sistema (vendedor, supervisor, etc.).</td></tr>
<tr><td><strong>PIN</strong></td><td>Codigo personal de 4 digitos (vendedores) o 6 digitos (supervisores) para ingresar al sistema.</td></tr>
<tr><td><strong>Rev. (Revision)</strong></td><td>Numero de version de una cotizacion (Rev.1, Rev.2, Rev.3...).</td></tr>
<tr><td><strong>Stock</strong></td><td>Cantidad disponible de un producto en inventario.</td></tr>
<tr><td><strong>Tasa BCV</strong></td><td>Tipo de cambio oficial del Banco Central de Venezuela (Bs por $).</td></tr>
<tr><td><strong>Tasa USDT</strong></td><td>Tipo de cambio del dolar paralelo/cripto (Bs por USDT).</td></tr>
<tr><td><strong>Venta Rapida</strong></td><td>Proceso que crea cotizacion + despacho en un solo paso. Ideal para ventas en tienda.</td></tr>
<tr><td><strong>Versionar</strong></td><td>Crear una nueva version de una cotizacion enviada en lugar de editarla directamente.</td></tr>
</table>

<br><br>
<hr>
<p style="text-align: center; color: #999; font-size: 11px;">
Manual del Vendedor &mdash; Sistema de Gestion Construacero Carabobo<br>
Version 1.0 &mdash; Abril 2026
</p>

</body>
</html>
"""

# Generate PDF
HTML(string=HTML_CONTENT).write_pdf('/mnt/user-outputs/Manual_Vendedor_Construacero.pdf')
print("PDF generated successfully!")
