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

export function isCommissionExcludedProduct(product = {}) {
  if (product?.es_prestamo || product?.esPrestamo) return true
  const name = String(product?.nombre_snap || product?.nombre || '').trim().toLowerCase()
  return name.startsWith('corte')
}

export function isCabillaCommissionProduct(product = {}, perfil = null, config = {}) {
  const configuredCategory = String(config?.comision_categoria_cabilla || 'cabilla').trim().toLowerCase()
  const category = String(product?.producto?.categoria || product?.categoria || '').trim().toLowerCase()
  const name = String(product?.nombre_snap || product?.nombre || '').trim().toLowerCase()
  const matchesCategory = category.length > 0 && (
    category === configuredCategory
    || category.includes(configuredCategory)
    || configuredCategory.includes(category)
  )
  const matchesName = name.includes(configuredCategory)
  const externalCement = !!perfil?.es_externo && (category === 'cemento' || name.includes('cemento'))
  return matchesCategory || matchesName || externalCement
}

function commissionProductValue(product = {}) {
  return Math.max(0, Number(
    product?.total_linea_usd
      ?? product?.total_linea_neto
      ?? product?.total
      ?? (Number(product?.cantidad || 0) * Number(product?.precio_unit_usd || product?.precioUnitUsd || 0)),
  ) || 0)
}

/**
 * Removes the commission share of loan/corte products from a legacy stored
 * commission without reallocating it to the remaining products.
 */
export function adjustLegacyCommissionForExcludedProducts({
  products = [],
  comisioncabilla = 0,
  comisionotros = 0,
  perfil = null,
  config = {},
} = {}) {
  const normalizedProducts = Array.isArray(products) ? products : []
  const baseCabilla = round2(comisioncabilla)
  const baseOtros = round2(comisionotros)
  const baseTotal = round2(baseCabilla + baseOtros)
  const excludedProducts = normalizedProducts.filter(isCommissionExcludedProduct)
  if (normalizedProducts.length === 0 || excludedProducts.length === 0) {
    return { cabilla: baseCabilla, otros: baseOtros, total: baseTotal, applied: false }
  }

  const eligibleExpected = { cabilla: 0, otros: 0 }
  const allExpected = { cabilla: 0, otros: 0 }
  const categoryPresent = { cabilla: false, otros: false }

  normalizedProducts.forEach(product => {
    const value = commissionProductValue(product)
    if (value <= 0) return
    const key = isCabillaCommissionProduct(product, perfil, config) ? 'cabilla' : 'otros'
    categoryPresent[key] = true
    const pct = Number(getComisionPctForItem(product, config, perfil)) || 0
    const expected = value * pct / 100
    allExpected[key] += expected
    if (!isCommissionExcludedProduct(product)) eligibleExpected[key] += expected
  })

  const adjusted = { cabilla: baseCabilla, otros: baseOtros }
  for (const key of ['cabilla', 'otros']) {
    if (!categoryPresent[key]) continue
    adjusted[key] = allExpected[key] > 0
      ? round2((key === 'cabilla' ? baseCabilla : baseOtros) * eligibleExpected[key] / allExpected[key])
      : 0
  }

  adjusted.cabilla = round2(adjusted.cabilla)
  adjusted.otros = round2(adjusted.otros)
  adjusted.total = round2(adjusted.cabilla + adjusted.otros)
  adjusted.applied = true
  return adjusted
}

const PAYMENT_NESTED_KEYS = ['metodos_pagados', 'metodo_propuesto', 'formas_pago', 'pagos', 'payments']

function stripAccents(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Convierte formas de pago JSON/string legacy en una lista plana.
 * Si un método contenedor trae métodos definitivos, solo se consideran estos.
 */
export function parsePaymentMethods(value) {
  if (value == null || value === '') return []

  if (Array.isArray(value)) {
    return value.flatMap(parsePaymentMethods)
  }

  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    if (text.startsWith('[') || text.startsWith('{')) {
      try {
        return parsePaymentMethods(JSON.parse(text))
      } catch {
        // Texto legacy no JSON: se conserva como método simple.
      }
    }
    return [{ metodo: text, monto: null }]
  }

  if (typeof value !== 'object') return []

  for (const key of PAYMENT_NESTED_KEYS) {
    if (value[key] != null) {
      const nested = parsePaymentMethods(value[key])
      if (nested.length > 0) return nested
    }
  }

  return [{
    ...value,
    metodo: value.metodo || value.metodo_pago || value.method || value.formaPago || '',
    monto: value.monto ?? value.amount ?? value.valor ?? null,
  }]
}

export function isCxcPaymentMethod(method) {
  const normalized = stripAccents(method).toLowerCase().trim()
  return normalized === 'cxc'
    || normalized.includes('cta por cobrar')
    || normalized.includes('cuenta por cobrar')
    || normalized.includes('credito')
    || normalized.includes('credit')
}

export function isDonationPayment(value) {
  return parsePaymentMethods(value).some(payment =>
    stripAccents(payment.metodo).toLowerCase().includes('donacion')
  )
}

export function isLoanPayment(value) {
  return parsePaymentMethods(value).some(payment =>
    stripAccents(payment.metodo).toLowerCase().includes('prestamo')
  )
}

export function getCommissionablePaymentSplit({ totalUsd = 0, formaPagoCliente, formaPago } = {}) {
  const total = Math.max(0, Number(totalUsd) || 0)
  const source = formaPagoCliente != null && formaPagoCliente !== '' ? formaPagoCliente : formaPago
  const methods = parsePaymentMethods(source)
  const cxcMethods = methods.filter(payment => isCxcPaymentMethod(payment.metodo))
  const explicitCxc = cxcMethods.reduce((sum, payment) => {
    const amount = Number(payment.monto)
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0)
  }, 0)

  // Un método de crédito sin monto representa el total en el formato legacy.
  const nonCxcMethods = methods.filter(payment => !isCxcPaymentMethod(payment.metodo))
  const explicitNonCxc = nonCxcMethods.reduce((sum, payment) => {
    const amount = Number(payment.monto)
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0)
  }, 0)
  const inferredCxc = Math.max(0, total - explicitNonCxc)
  const hasAmbiguousMixedPayment = cxcMethods.length > 0
    && nonCxcMethods.length > 0
    && explicitCxc <= 0
    && explicitNonCxc <= 0
  const cxcAmount = cxcMethods.length === 0
    ? 0
    : explicitCxc > 0
      ? Math.min(total, explicitCxc)
      : (nonCxcMethods.length === 0 ? total : inferredCxc)
  const nonCxcAmount = Math.max(0, total - cxcAmount)

  return {
    methods,
    cxcAmount,
    nonCxcAmount,
    fraction: hasAmbiguousMixedPayment ? 0 : (total > 0 ? nonCxcAmount / total : 1),
    requiresManualReview: hasAmbiguousMixedPayment,
  }
}

export function getNonCxcFraction(despacho = {}) {
  return getCommissionablePaymentSplit({
    totalUsd: despacho.total_usd ?? despacho.totalUsd ?? despacho.totalusd,
    formaPagoCliente: despacho.forma_pago_cliente,
    formaPago: despacho.forma_pago,
  })
}

/**
 * Returns the stable identity used to count dispatches in commission reports.
 * Product-expanded PDF rows must not inflate this count.
 */
export function getCommissionDispatchKey(row = {}) {
  const despacho = row?.despacho || row?.comisiones?.despacho || {}
  return row?.despachoid
    || despacho?.id
    || row?.despacho_id
    || despacho?.numero
    || row?.despachonumero
    || row?.despacho_numero
    || row?.id
    || null
}

export function countUniqueDispatches(rows = []) {
  return new Set(
    rows
      .map(getCommissionDispatchKey)
      .filter(value => value !== null && value !== undefined && value !== ''),
  ).size
}

export function calcularTotalCorte(generadaUsd, cxcManualUsd = 0, descuentoCarroUsd = 0) {
  return round2((Number(generadaUsd) || 0) + (Number(cxcManualUsd) || 0) - (Number(descuentoCarroUsd) || 0))
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
