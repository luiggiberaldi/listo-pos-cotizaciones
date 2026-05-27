// src/utils/codigosHelper.js
// Catálogo y lógica de códigos estructurados según el estándar de la empresa

export const LINEAS = [
  { label: 'ALAMBRE / ALAMBRON', value: 'ALA', fam: 1 },
  { label: 'ALAMBRON ESTRIADO', value: 'ALB', fam: 1 },
  { label: 'BARRA CUADRADA LISA', value: 'BAR', fam: 2 },
  { label: 'BARRA REDONDA LISA', value: 'BAR', fam: 2 },
  { label: 'CABILLAS ESTRIADAS S-60', value: 'CAB', fam: 3 },
  { label: 'CEMENTO', value: 'CEM', fam: 4 },
  { label: 'CERCHAS', value: 'CER', fam: 4 },
  { label: 'CONEXIONES (EMT, GALV, PVC)', value: 'CON', fam: 5 },
  { label: 'ELECTRICIDAD / BREAKER / CABLE', value: 'ELE', fam: 6 },
  { label: 'FERRETERIA / ACCESORIOS / DISCOS', value: 'FER', fam: 7 },
  { label: 'FLANCHE', value: 'FLA', fam: 8 },
  { label: 'LAMINAS (GALV, NEGRA, ARQUITECTONICA)', value: 'LAM', fam: 9 },
  { label: 'MALLA TRUCKSON', value: 'MAL', fam: 10 },
  { label: 'PERFILES / ANGULOS / PLETINA', value: 'PER', fam: 11 },
  { label: 'TUBERIAS (PVC, GALV, ESTR, PULIDA)', value: 'TUB', fam: 12 },
  { label: 'VIGAS (IPE, IPN, HEB, WF, VP)', value: 'VIG', fam: 13 },
  { label: 'ZUNCHOS', value: 'ZUN', fam: 14 }
];

export const MATERIALES = [
  { label: 'NO APLICA', value: '00' },
  { label: 'HIERRO NEGRO', value: '01' },
  { label: 'HIERRO PULIDO', value: '02' },
  { label: 'ESTRUCTURAL', value: '03' },
  { label: 'GALVANIZADO', value: '04' },
  { label: 'PVC', value: '05' },
  { label: 'PVC AF', value: '06' },
  { label: 'PVC AC', value: '07' },
  { label: 'PVC AN', value: '08' },
  { label: 'PVC ELE', value: '09' },
  { label: 'CONSTRUCCION', value: '10' },
  { label: 'DRAYWALL', value: '11' },
  { label: 'TERMOPANEL', value: '12' },
  { label: 'PINTURA', value: '13' },
  { label: 'VENTILACION', value: '14' },
  { label: 'CORRUGADO', value: '15' },
  { label: 'ALUMINIO', value: '16' },
  { label: 'COBRE', value: '17' },
  { label: 'BREAKER', value: '18' },
  { label: 'TECHO', value: '19' },
  { label: 'PEGAMENTO', value: '20' },
  { label: 'BRONCE', value: '21' },
  { label: 'GRIFERIA', value: '22' }
];

export const FORMAS = [
  { label: 'NO APLICA', value: '00' },
  { label: 'CUADRADO', value: '01' },
  { label: 'RECTANGULAR', value: '02' },
  { label: 'REDONDO', value: '03' },
  { label: 'EXAGONAL', value: '04' },
  { label: 'HEB', value: '05' },
  { label: 'IPE', value: '06' },
  { label: 'IPN', value: '07' },
  { label: 'UPL', value: '08' },
  { label: 'VP', value: '09' },
  { label: 'WF', value: '10' },
  { label: 'ANGULO', value: '11' },
  { label: 'PLETINA', value: '12' },
  { label: 'LISO', value: '13' },
  { label: 'ESTRIADA', value: '14' },
  { label: 'PLACA', value: '15' },
  { label: 'PREPINTADA', value: '16' },
  { label: 'THINNER', value: '17' },
  { label: 'ESMALTE', value: '18' },
  { label: 'CAUCHO', value: '19' },
  { label: 'ADAPTADO', value: '20' },
  { label: 'ANILLO', value: '21' },
  { label: 'CODO', value: '22' },
  { label: 'CURVA', value: '23' },
  { label: 'JUNTA', value: '24' },
  { label: 'NIPLE', value: '25' },
  { label: 'REDUCCION', value: '26' },
  { label: 'TAPON', value: '27' },
  { label: 'TEE', value: '28' },
  { label: 'UNION', value: '29' },
  { label: 'YEE', value: '30' },
  { label: 'SIFON', value: '31' },
  { label: 'CABLE', value: '32' },
  { label: 'CAJETIN', value: '33' },
  { label: 'TABLERO', value: '34' },
  { label: 'DISCO', value: '35' },
  { label: 'ELECTRODO', value: '36' },
  { label: 'TORNILLO', value: '37' },
  { label: 'ROLLO', value: '38' },
  { label: 'SEGUNDA', value: '39' },
  { label: 'PAQUETE', value: '40' },
  { label: 'ALABRON', value: '41' },
  { label: 'CLAVO', value: '42' },
  { label: 'PUERTAS', value: '43' },
  { label: 'PORTON', value: '44' },
  { label: 'SACO', value: '45' },
  { label: 'GRANEL', value: '46' },
  { label: 'SUPERFICIAL', value: '47' },
  { label: 'EMPOTRAR', value: '48' },
  { label: 'PLOMERIA', value: '49' },
  { label: 'SEGURIDAD', value: '50' },
  { label: 'VARILLA', value: '51' },
  { label: 'LISO (52)', value: '52' },
  { label: 'REJILLA', value: '53' },
  { label: 'ACANALADA', value: '54' },
  { label: 'ONDULADA', value: '55' },
  { label: 'HEA', value: '56' }
];

// Relación estricta de Materiales y Formas permitidos por Línea para evitar combinaciones imposibles
export const RESTRICCIONES = {
  // Alambres
  'ALA': {
    materiales: ['00', '01', '04'],
    formas: ['00', '03', '38', '41']
  },
  'ALB': {
    materiales: ['01'],
    formas: ['38', '41']
  },
  // Barras
  'BAR': {
    materiales: ['00', '01', '02', '03'],
    formas: ['01', '03', '13', '52']
  },
  // Cabillas
  'CAB': {
    materiales: ['01', '03'],
    formas: ['14', '51']
  },
  // Cemento
  'CEM': {
    materiales: ['10'],
    formas: ['45']
  },
  // Cerchas
  'CER': {
    materiales: ['01', '03'],
    formas: ['00', '13']
  },
  // Conexiones
  'CON': {
    materiales: ['04', '05', '06', '07', '08', '09'],
    formas: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31']
  },
  // Electricidad
  'ELE': {
    materiales: ['00', '04', '05', '09', '16', '17', '18'],
    formas: ['00', '03', '32', '33', '34', '38', '47', '48']
  },
  // Ferretería
  'FER': {
    materiales: ['00', '01', '02', '08', '10', '13', '16', '20', '21', '22'],
    formas: ['00', '03', '17', '18', '35', '36', '37', '42', '49', '50', '51', '52']
  },
  // Flanche
  'FLA': {
    materiales: ['01', '04'],
    formas: ['01', '15']
  },
  // Láminas
  'LAM': {
    materiales: ['01', '02', '04', '11', '12', '19'],
    formas: ['00', '13', '14', '15', '16', '54', '55']
  },
  // Mallas
  'MAL': {
    materiales: ['01'],
    formas: ['00', '38']
  },
  // Perfiles
  'PER': {
    materiales: ['01', '04'],
    formas: ['00', '01', '11', '12', '43', '44']
  },
  // Tuberías
  'TUB': {
    materiales: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '14', '15', '18'],
    formas: ['01', '02', '03', '27', '39']
  },
  // Vigas
  'VIG': {
    materiales: ['01', '03'],
    formas: ['05', '06', '07', '08', '09', '10', '56']
  },
  // Zunchos
  'ZUN': {
    materiales: ['01'],
    formas: ['38', '40']
  }
};

// Determina el subgrupo/categoría correcto a partir de los códigos elegidos en el asistente
export function obtenerCategoriaDesdeEstructura(linea, material, forma, nombre = '') {
  if (!linea) return '';

  const name = nombre.toLowerCase().trim();

  if (linea === 'VIG') {
    return 'VIGAS';
  } else if (linea === 'TUB') {
    if (['05', '06', '07', '08', '09', '15'].includes(material)) {
      if (name.includes('agua') && name.includes('fria')) return 'TUBOS PVC AGUAS FRIAS';
      if (name.includes('elec') || name.includes('electric')) return 'TUBOS PVC ELECTRICIDAD';
      if (name.includes('negra') || name.includes('an') || name.includes('a/n')) return 'TUBOS PVC AGUAS NEGRAS';
      return 'TUBOS PVC';
    } else if (material === '14') {
      return 'TUBOS DE VENTILACION';
    } else if (material === '04') {
      return 'TUBOS GALVANIZADO';
    } else if (material === '02') {
      if (forma === '01') return 'TUBOS PULIDO CUADRADO';
      if (forma === '02') return 'TUBOS PULIDO RECTANGULAR';
      return 'TUBOS REDONDOS';
    } else if (['01', '03'].includes(material)) {
      if (forma === '01') return 'TUBOS ESTRUCTURALES CUADRADO';
      if (forma === '02') return 'TUBOS ESTRUCTURALES RECTANGULAR';
      if (forma === '03') return 'TUBOS REDONDOS';
      return 'TUBOS ESTRUCTURALES';
    }
    return 'TUBOS';
  } else if (linea === 'PER') {
    if (forma === '11') return 'PERFILES ANGULOS';
    if (forma === '12') return 'PERFILES PLETINA';
    return 'PERFILES';
  } else if (linea === 'BAR') {
    if (forma === '01') return 'BARRAS CUADRADA LISA';
    if (forma === '03') return 'BARRAS REDONDA LISA';
    return 'BARRAS';
  } else if (linea === 'CAB') {
    return 'CABILLAS';
  } else if (linea === 'LAM') {
    return 'LAMINAS';
  } else if (linea === 'MAL') {
    return 'MALLAS';
  } else if (linea === 'CON') {
    if (material === '04') {
      if (name.includes('galv') || name.includes('hg')) return 'CONEXIONES GALVANIZADAS';
      return 'CONEXIONES EMT';
    }
    if (material === '08') return 'CONEXIONES PVC AGUAS NEGRAS';
    if (['05', '06', '07'].includes(material)) return 'CONEXIONES PVC AGUA FRIA';
    return 'CONEXIONES';
  } else if (linea === 'ELE') {
    if (forma === '32') return 'CABLES';
    if (forma === '33' || forma === '34' || material === '18') return 'CAJAS Y TABLEROS';
    return 'ELECTRICIDAD';
  } else if (linea === 'FER') {
    return 'FERRETERIA';
  } else if (linea === 'FLA') {
    return 'FLANCHES';
  } else if (linea === 'CEM') {
    return 'CEMENTO';
  } else if (linea === 'CER') {
    return 'CERCHAS';
  } else if (linea === 'ALA') {
    return 'ALAMBRES';
  } else if (linea === 'ALB') {
    return 'ALAMBRONES';
  } else if (linea === 'ZUN') {
    return 'ZUNCHOS';
  }
  return '';
}

// Intenta predecir Línea, Material y Forma basándose en el nombre del producto de forma inteligente
export function sugerirEstructuraDesdeNombre(nombre) {
  if (!nombre) return null;
  const n = nombre.toLowerCase();

  let sugerencia = {
    linea: null,
    material: null,
    forma: null
  };

  // 1. Detección de Línea
  if (n.includes('alambre')) sugerencia.linea = 'ALA';
  else if (n.includes('alambron') && n.includes('estriado')) sugerencia.linea = 'ALB';
  else if (n.includes('alambron')) sugerencia.linea = 'ALA';
  else if (n.includes('barra') && n.includes('cuadra')) sugerencia.linea = 'BAR';
  else if (n.includes('barra') && n.includes('redond')) sugerencia.linea = 'BAR';
  else if (n.includes('cabilla')) sugerencia.linea = 'CAB';
  else if (n.includes('cemento')) sugerencia.linea = 'CEM';
  else if (n.includes('cercha')) sugerencia.linea = 'CER';
  else if (n.includes('codo') || n.includes('union') || n.includes('tee') || n.includes('niple') || n.includes('reduccion') || n.includes('acoplamiento') || n.includes('curva conduit')) sugerencia.linea = 'CON';
  else if (n.includes('cable') || n.includes('breaker') || n.includes('cajetin') || n.includes('medidor') || n.includes('arvidal') || n.includes('electric')) sugerencia.linea = 'ELE';
  else if (n.includes('lamina') || n.includes('losacero') || n.includes('acerolit')) sugerencia.linea = 'LAM';
  else if (n.includes('malla')) sugerencia.linea = 'MAL';
  else if (n.includes('perfil') || n.includes('angulo') || n.includes('pletina') || n.includes('vigueta')) sugerencia.linea = 'PER';
  else if (n.includes('tubo') || n.includes('tuberia')) sugerencia.linea = 'TUB';
  else if (n.includes('viga')) sugerencia.linea = 'VIG';
  else if (n.includes('zuncho')) sugerencia.linea = 'ZUN';
  else if (n.includes('cerradura') || n.includes('fregadero') || n.includes('electrodo') || n.includes('tornillo') || n.includes('disco') || n.includes('llave')) sugerencia.linea = 'FER';

  // Si no logramos detectar la línea, no podemos continuar con sugerencias precisas
  if (!sugerencia.linea) return sugerencia;

  const restrict = RESTRICCIONES[sugerencia.linea];

  // 2. Detección de Material
  if (n.includes('galv') || n.includes('galvanizado')) sugerencia.material = '04';
  else if (n.includes('pvc ele')) sugerencia.material = '09';
  else if (n.includes('pvc af') || n.includes('agua fria')) sugerencia.material = '06';
  else if (n.includes('pvc ac')) sugerencia.material = '07';
  else if (n.includes('pvc an') || n.includes('aguas negras') || n.includes('a/n')) sugerencia.material = '08';
  else if (n.includes('pvc')) sugerencia.material = '05';
  else if (n.includes('pulido') || n.includes(' hp') || n.includes('hp ') || n.startsWith('hp')) sugerencia.material = '02';
  else if (n.includes('hierro negro') || n.includes('negro') || n.includes(' hn') || n.includes('hn ') || n.startsWith('hn')) sugerencia.material = '01';
  else if (n.includes('estruc') || n.includes('estructural')) sugerencia.material = '03';
  else if (n.includes('drywall') || n.includes('draywall')) sugerencia.material = '11';
  else if (n.includes('termopanel')) sugerencia.material = '12';
  else if (n.includes('pintura') || n.includes('fondo') || n.includes('esmalte')) sugerencia.material = '13';
  else if (n.includes('ventilacion') || n.includes('vent')) sugerencia.material = '14';
  else if (n.includes('corrugado')) sugerencia.material = '15';
  else if (n.includes('aluminio')) sugerencia.material = '16';
  else if (n.includes('cobre')) sugerencia.material = '17';
  else if (n.includes('breaker')) sugerencia.material = '18';
  else if (n.includes('techo') || n.includes('acerolit') || n.includes('losacero') || n.includes('galvatecho') || n.includes('prepintado')) sugerencia.material = '19';
  else if (n.includes('pega') || n.includes('pegamento')) sugerencia.material = '20';
  else if (n.includes('bronce')) sugerencia.material = '21';
  else if (n.includes('griferia') || n.includes('fregadero')) sugerencia.material = '22';

  // Si el material detectado no es válido para esta línea, lo descartamos
  if (sugerencia.material && restrict && !restrict.materiales.includes(sugerencia.material)) {
    sugerencia.material = null;
  }

  // Si no se detectó material pero solo hay uno disponible en las restricciones, lo auto-seleccionamos
  if (!sugerencia.material && restrict && restrict.materiales.length === 1) {
    sugerencia.material = restrict.materiales[0];
  }

  // 3. Detección de Forma
  if (n.includes('cuadrad')) sugerencia.forma = '01';
  else if (n.includes('rectan') || n.includes('rect.')) sugerencia.forma = '02';
  else if (n.includes('redond') || n.includes('red ')) sugerencia.forma = '03';
  else if (n.includes('heb')) sugerencia.forma = '05';
  else if (n.includes('ipe')) sugerencia.forma = '06';
  else if (n.includes('ipn')) sugerencia.forma = '07';
  else if (n.includes('upl')) sugerencia.forma = '08';
  else if (n.includes('vp')) sugerencia.forma = '09';
  else if (n.includes('wf')) sugerencia.forma = '10';
  else if (n.includes('angulo') || n.includes('ang ')) sugerencia.forma = '11';
  else if (n.includes('pletina') || n.includes('ple ')) sugerencia.forma = '12';
  else if (n.includes('liso')) sugerencia.forma = '13';
  else if (n.includes('estriad')) sugerencia.forma = '14';
  else if (n.includes('placa')) sugerencia.forma = '15';
  else if (n.includes('prepintad')) sugerencia.forma = '16';
  else if (n.includes('thinner') || n.includes('thiner')) sugerencia.forma = '17';
  else if (n.includes('esmalte')) sugerencia.forma = '18';
  else if (n.includes('codo')) sugerencia.forma = '22';
  else if (n.includes('curva')) sugerencia.forma = '23';
  else if (n.includes('junta')) sugerencia.forma = '24';
  else if (n.includes('niple')) sugerencia.forma = '25';
  else if (n.includes('reduccion') || n.includes('red.')) sugerencia.forma = '26';
  else if (n.includes('tapon')) sugerencia.forma = '27';
  else if (n.includes('tee')) sugerencia.forma = '28';
  else if (n.includes('union')) sugerencia.forma = '29';
  else if (n.includes('yee')) sugerencia.forma = '30';
  else if (n.includes('sifon')) sugerencia.forma = '31';
  else if (n.includes('cable')) sugerencia.forma = '32';
  else if (n.includes('cajetin')) sugerencia.forma = '33';
  else if (n.includes('tablero')) sugerencia.forma = '34';
  else if (n.includes('disco')) sugerencia.forma = '35';
  else if (n.includes('electrodo')) sugerencia.forma = '36';
  else if (n.includes('tornillo')) sugerencia.forma = '37';
  else if (n.includes('rollo')) sugerencia.forma = '38';
  else if (n.includes('clavo')) sugerencia.forma = '42';
  else if (n.includes('puerta')) sugerencia.forma = '43';
  else if (n.includes('porton')) sugerencia.forma = '44';
  else if (n.includes('saco')) sugerencia.forma = '45';
  else if (n.includes('hea')) sugerencia.forma = '56';

  // Si la forma detectada no es válida para esta línea, la descartamos
  if (sugerencia.forma && restrict && !restrict.formas.includes(sugerencia.forma)) {
    sugerencia.forma = null;
  }

  // Si no se detectó forma pero solo hay una disponible en las restricciones, la auto-seleccionamos
  if (!sugerencia.forma && restrict && restrict.formas.length === 1) {
    sugerencia.forma = restrict.formas[0];
  }

  return sugerencia;
}

// Consulta a Supabase los códigos que empiezan con el prefijo y calcula el siguiente correlativo libre
export async function calcularSiguienteCodigo(supabase, linea, material, forma) {
  if (!linea || !material || !forma) return '';
  const prefix = `${linea}${material}${forma}`;

  try {
    const { data, error } = await supabase
      .from('productos')
      .select('codigo')
      .like('codigo', `${prefix}%`);

    if (error) throw error;

    let maxCorrelative = 0;
    if (data && data.length > 0) {
      data.forEach(p => {
        const cod = p.codigo ? p.codigo.trim().toUpperCase() : '';
        if (cod.startsWith(prefix)) {
          const corrStr = cod.substring(prefix.length);
          const corrNum = parseInt(corrStr, 10);
          if (!isNaN(corrNum) && corrNum > maxCorrelative) {
            maxCorrelative = corrNum;
          }
        }
      });
    }

    const nextCorr = String(maxCorrelative + 1).padStart(3, '0');
    return `${prefix}${nextCorr}`;
  } catch (err) {
    console.error('Error calculando siguiente código:', err);
    return '';
  }
}
