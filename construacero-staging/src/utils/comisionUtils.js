import { round2 } from './dinero'

/**
 * Calcula la comisión estimada sobre un array de items de cotización.
 * Respeta: categoría cabilla/cemento, extras por categoría y otros.
 * Soporta override de tasas por usuario (vendedor externo).
 *
 * @param {Array}  items  - [{categoria, total_linea_usd}]
 * @param {Object} config - Objeto de configuracion_negocio
 * @param {Object} [perfil] - Perfil del operador (puede tener comision_pct / comision_pct_cabilla)
 */
export function getComisionPctForItem(item, config = {}, perfil = null) {
  const es_externo = !!perfil?.es_externo;

  let pctCabilla, pctOtros, pctExternos, extras;

  if (es_externo) {
    pctCabilla = Number(config.comision_ext_pct_cabilla ?? 2.00);
    pctOtros = Number(config.comision_ext_pct_otros ?? 3.00);
    pctExternos = Number(config.comision_ext_pct_externos ?? 3.00);
    try {
      extras = typeof config._comision_ext_extras === 'string'
        ? JSON.parse(config._comision_ext_extras)
        : (config._comision_ext_extras || []);
      if (!Array.isArray(extras)) extras = [];
    } catch {
      extras = [];
    }
  } else {
    // Para vendedores internos, se permiten overrides antiguos si existen en el perfil, por si acaso.
    pctCabilla = perfil?.comision_pct_cabilla != null
      ? Number(perfil.comision_pct_cabilla)
      : Number(config.comision_pct_cabilla ?? 2.00);
    pctOtros = perfil?.comision_pct != null
      ? Number(perfil.comision_pct)
      : Number(config.comision_pct_otros ?? 3.00);
    pctExternos = Number(config.comision_pct_externos ?? 3.00);
    try {
      extras = typeof config._comision_extras === 'string'
        ? JSON.parse(config._comision_extras)
        : (config._comision_extras || []);
      if (!Array.isArray(extras)) extras = [];
    } catch {
      extras = [];
    }
  }

  const catCabilla = (config.comision_categoria_cabilla || 'Cabilla').toLowerCase().trim();

  const nombre = (item.nombreSnap || item.nombre_snap || item.nombre || '').toLowerCase();
  const prodId = item.producto_id || item.productoId || item.producto?.id || '';
  const codSnap = item.codigo_snap || item.codigoSnap || item.codigo || '';
  const origen = item.origen || item.producto?.origen || 'inventario';

  const esProductoExterno = origen === 'externo' || 
                            String(prodId).startsWith('manual-') || 
                            String(prodId).startsWith('ext-') || 
                            String(codSnap).startsWith('EXT');

  if (esProductoExterno) {
    if (nombre.includes('corte')) return 0;
    return pctExternos;
  }

  let cat = (item.categoria || item.producto?.categoria || 'otros').toLowerCase().trim();
  
  // Si es cabilla o contiene cabilla
  const esCabilla = cat === catCabilla || nombre.includes(catCabilla);

  // Si es cemento y es vendedor externo
  const esCementoVendedorExterno = es_externo && (cat === 'cemento' || nombre.includes('cemento'));
  
  if (esCabilla || esCementoVendedorExterno) return pctCabilla;

  if ((cat === 'otros' || !cat) && nombre.includes(catCabilla)) {
    return pctCabilla;
  }

  const extra = extras.find(e => (e.cat || '').toLowerCase().trim() === cat);
  return extra ? Number(extra.pct) : pctOtros;
}

/**
 * Calcula la estimación de comisión de un conjunto de ítems.
 * @param {Array} items 
 * @param {Object} config 
 * @returns {{
 *   monto:   number,        // Total comisión estimada
 *   pct:     number|null,   // % único si todos iguales, null si mixto
 *   mixto:   boolean,       // true si hay más de un % en los items
 *   detalle: Array          // [{cat, pct, monto, comision}] — 1 línea por categoría
 * }}
 */
export function calcComisionEstimada(items = [], config = {}, perfil = null) {
  const es_externo = !!perfil?.es_externo;

  let pctCabilla, pctOtros, pctExternos, extras;

  if (es_externo) {
    pctCabilla = Number(config.comision_ext_pct_cabilla ?? 2.00);
    pctOtros = Number(config.comision_ext_pct_otros ?? 3.00);
    pctExternos = Number(config.comision_ext_pct_externos ?? 3.00);
    try {
      extras = typeof config._comision_ext_extras === 'string'
        ? JSON.parse(config._comision_ext_extras)
        : (config._comision_ext_extras || []);
      if (!Array.isArray(extras)) extras = [];
    } catch {
      extras = [];
    }
  } else {
    pctCabilla = perfil?.comision_pct_cabilla != null
      ? Number(perfil.comision_pct_cabilla)
      : Number(config.comision_pct_cabilla ?? 2.00);
    pctOtros = perfil?.comision_pct != null
      ? Number(perfil.comision_pct)
      : Number(config.comision_pct_otros ?? 3.00);
    pctExternos = Number(config.comision_pct_externos ?? 3.00);
    try {
      extras = typeof config._comision_extras === 'string'
        ? JSON.parse(config._comision_extras)
        : (config._comision_extras || []);
      if (!Array.isArray(extras)) extras = [];
    } catch {
      extras = [];
    }
  }

  const catCabilla = (config.comision_categoria_cabilla || 'Cabilla').toLowerCase().trim();

  // Acumulador por categoría → evita 50 líneas para 50 productos de "Otros"
  const acum = {};

  for (const item of items) {
    let cat = (item.categoria || 'otros').toLowerCase().trim();
    const nombre = (item.nombreSnap || item.nombre_snap || item.nombre || '').toLowerCase();
    
    const prodId = item.producto_id || item.productoId || item.producto?.id || '';
    const codSnap = item.codigo_snap || item.codigoSnap || item.codigo || '';
    const origen = item.origen || item.producto?.origen || 'inventario';

    const esProductoExterno = origen === 'externo' || 
                              String(prodId).startsWith('manual-') || 
                              String(prodId).startsWith('ext-') || 
                              String(codSnap).startsWith('EXT');
    
    if (item.esPrestamo || item.es_prestamo) continue;
    const monto = Number(item.total_linea_usd) || Number(item.total) || (Number(item.cantidad) * Number(item.precioUnitUsd || item.precio_unit_usd)) || 0;
    if (monto <= 0) continue;

    let pct;
    if (esProductoExterno) {
      if (nombre.includes('corte')) {
        pct = 0;
        cat = 'externo_corte';
      } else {
        pct = pctExternos;
        cat = 'externo';
      }
    } else {
      // Cabilla Y Cemento comparten la tasa especial
      const esCementoVendedorExterno = es_externo && (cat === 'cemento' || nombre.includes('cemento'));
      const esCabilla = cat === catCabilla
        || nombre.includes(catCabilla)
        || ((cat === 'otros' || !cat) && nombre.includes(catCabilla));

      if (esCementoVendedorExterno) {
        cat = 'cemento';
        pct = pctCabilla;
      } else if (esCabilla) {
        cat = catCabilla;
        pct = pctCabilla;
      } else {
        const extra = extras.find(e => (e.cat || '').toLowerCase().trim() === cat);
        if (extra) {
          pct = Number(extra.pct);
        } else {
          pct = pctOtros;
          cat = 'otros';
        }
      }
    }

    if (!acum[cat]) acum[cat] = { cat, pct, monto: 0, comision: 0 };
    acum[cat].monto    += monto;
    acum[cat].comision += monto * pct / 100;
  }

  // Redondear al final (no por ítem → evita error de centavo acumulado)
  const detalle = Object.values(acum)
    .filter(d => d.pct > 0)
    .map(d => ({
      ...d,
      monto:    round2(d.monto),
      comision: round2(d.comision),
    }));

  const totalComision = round2(detalle.reduce((s, d) => s + d.comision, 0));
  const pctsUnicos    = [...new Set(detalle.map(d => d.pct))];

  return {
    monto:  totalComision,
    pct:    pctsUnicos.length === 1 ? pctsUnicos[0] : (pctsUnicos.length === 0 ? 0 : null),
    mixto:  pctsUnicos.length > 1,
    detalle, // máx N líneas donde N = número de categorías distintas con comisión > 0
  };
}
