// src/utils/smartSearch.js
// Motor de búsqueda inteligente para materiales de construcción — Venezuela
// Fuzzy matching, sinónimos, tolerancia a errores tipográficos, scoring

// ─── Palabras triviales que se ignoran en la búsqueda ─────────────────────────
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'para', 'con', 'por', 'en', 'al', 'y', 'o', 'que', 'se', 'es',
  'saco', 'sacos', 'kilo', 'kilos', 'kg', 'rollo', 'rollos',
  'unidad', 'unidades', 'und', 'pieza', 'piezas', 'pza',
  'metro', 'metros', 'lineal', 'lineales',
])

// ─── Fracciones multi-palabra (se procesan antes de tokenizar) ────────────────
const FRACCIONES_MULTI = [
  // Fracciones escritas
  ['tres octavos', '3/8'],
  ['cinco octavos', '5/8'],
  ['tres cuartos', '3/4'],
  ['siete octavos', '7/8'],
  ['una pulgada', '1"'],
  ['dos pulgadas', '2"'],
  ['tres pulgadas', '3"'],
  ['cuatro pulgadas', '4"'],
  ['seis pulgadas', '6"'],
  // Medidas compuestas coloquiales
  ['uno y medio', '1 1/2'],
  ['1 y medio', '1 1/2'],
  ['1 y media', '1 1/2'],
  ['pulgada y media', '1 1/2"'],
  ['2 y medio', '2 1/2'],
  ['2 y media', '2 1/2'],
  ['3 y medio', '3 1/2'],
  ['3 y media', '3 1/2'],
  // Aguas — jerga venezolana (deben ir antes de tokenizar)
  ['aguas negras', 'A/N'],
  ['agua negra', 'A/N'],
  ['aguas blancas', 'A.F'],
  ['agua blanca', 'A.F'],
  ['aguas frias', 'A.F'],
  ['agua fria', 'A.F'],
  ['agua caliente', 'A.C'],
  ['aguas calientes', 'A.C'],
  ['alta presion', 'alta presion'],
  // Tipos de producto compuestos
  ['hierro negro', 'HN'],
  ['hierro pulido', 'HP'],
  ['hierro galvanizado', 'HG'],
  ['losa acero', 'losacero'],
  ['dry wall', 'drywall'],
  ['mil tejas', 'mil tejas'],
  ['vigueta tipo c', 'vigueta tipo c'],
  ['tipo c', 'tipo c'],
  ['pega prof', 'pega prof'],
  ['cemento pvc', 'cemento pvc'],
  ['keep dry', 'keep dry'],
  ['galv caliente', 'galv caliente'],
  ['malla truckson', 'malla truckson'],
  ['cable electrico', 'cable electrico'],
  ['tubo pulido', 'tubo pulido'],
  ['tubo estruc', 'tubo estruc'],
  ['tubo galv', 'tubo galv'],
  ['tubo pvc', 'tubo pvc'],
  ['tubo elec', 'tubo elec'],
  ['tubo vent', 'tubo vent'],
  ['caja de paso', 'caja de paso'],
  ['caja de medidor', 'caja de medidor'],
  // Medidas con "pulgadas" después del número
  ['pulgadas', '"'],
  ['pulgada', '"'],
  ['pulg', '"'],
]

// ─── Sinónimos y expansiones de jerga venezolana ──────────────────────────────
const SINONIMOS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // ABREVIACIONES DE SISTEMAS (agua, electricidad, gas)
  // ═══════════════════════════════════════════════════════════════════════════
  'an':            ['a.n', 'a/n', 'aguas negras', 'agua negra', 'drenaje', 'cloacal'],
  'af':            ['a.f', 'a.f.', 'agua fria', 'aguas frias', 'agua blanca', 'aguas blancas', 'presion'],
  'ac':            ['a.c', 'a.c.', 'agua caliente', 'aguas calientes', 'cpvc'],
  'a.n':           ['an', 'a/n', 'aguas negras', 'drenaje', 'cloacal'],
  'a.f':           ['af', 'a.f.', 'agua fria', 'agua blanca', 'presion'],
  'a.c':           ['ac', 'a.c.', 'agua caliente', 'cpvc'],
  'a/n':           ['an', 'a.n', 'aguas negras', 'drenaje'],
  'drenaje':       ['a.n', 'an', 'a/n', 'aguas negras', 'cloacal'],
  'cloacal':       ['a.n', 'an', 'drenaje', 'aguas negras'],
  'presion':       ['a.f', 'af', 'agua fria', 'alta presion'],
  'cpvc':          ['a.c', 'ac', 'agua caliente'],

  // ═══════════════════════════════════════════════════════════════════════════
  // ABREVIACIONES COMUNES FERRETERAS VENEZOLANAS
  // ═══════════════════════════════════════════════════════════════════════════
  'red':           ['reduccion', 'reducciones'],
  'rosc':          ['roscado', 'roscada', 'c/rosc'],
  'c/rosc':        ['roscado', 'roscada', 'rosc'],
  'int':           ['interior', 'int.'],
  'ext':           ['exterior', 'ext.'],
  'nac':           ['nacional'],
  'imp':           ['importado', 'importada'],
  'importado':     ['imp', 'importada'],
  'importada':     ['imp', 'importado'],
  'nacional':      ['nac'],
  'interior':      ['int', 'int.'],
  'exterior':      ['ext', 'ext.'],
  'ref':           ['reforzado', 'reforzada'],
  'reforzado':     ['ref', 'reforzada'],
  'reforzada':     ['ref', 'reforzado'],
  '2da':           ['segunda', 'segundo', 'de segunda'],
  'segunda':       ['2da'],
  'psi':           ['presion'],
  'hg':            ['hierro galvanizado', 'galv'],
  'hp':            ['hierro pulido', 'pulido'],
  'est':           ['estriada', 'estriado', 'est.'],
  'est.':          ['estriada', 'estriado', 'est'],
  'prep':          ['prepintado', 'prepintada'],
  'prepintado':    ['prep', 'prepintada'],
  'prepintada':    ['prep', 'prepintado'],
  'pul':           ['pulido', 'pulida'],
  'galv.':         ['galvanizado', 'galvanizada', 'galv'],
  'pr1':           ['prepintado'],
  'lam':           ['lamina', 'laminas', 'lam.'],
  'lam.':          ['lamina', 'laminas', 'lam'],

  // Marcas venezolanas comunes
  'sidetur':       ['sidetur', 'sidor'],
  'sidor':         ['sidor', 'sidetur'],
  'sizuca':        ['sizuca'],
  'tubrica':       ['tubrica'],
  'pavco':         ['pavco'],
  'uniteca':       ['uniteca'],
  'betaplast':     ['betaplast'],
  'gricon':        ['gricon'],
  'phelpsdodge':   ['phelps dodge', 'phelpsdodge'],

  // ═══════════════════════════════════════════════════════════════════════════
  // FRACCIONES Y MEDIDAS
  // ═══════════════════════════════════════════════════════════════════════════
  'media':         ['1/2'],
  'medio':         ['1/2'],
  'cuarto':        ['1/4'],
  'octavo':        ['1/8'],
  'mts':           ['metros', 'm'],
  'mm':            ['milimetros'],
  'cm':            ['centimetros'],
  'awg':           ['calibre'],

  // ═══════════════════════════════════════════════════════════════════════════
  // MATERIALES DE CONSTRUCCIÓN — JERGA VENEZOLANA
  // ═══════════════════════════════════════════════════════════════════════════

  // --- Cabillas y acero ---
  'cabilla':       ['cabillas', 'cabilla estriada', 'varilla'],
  'cabillas':      ['cabilla', 'cabilla estriada', 'varilla'],
  'varilla':       ['cabilla', 'cabillas', 'cabilla estriada'],
  'varillas':      ['cabilla', 'cabillas'],
  'hierro':        ['hn', 'hro', 'hierro negro', 'acero'],
  'hn':            ['hierro', 'hierro negro'],
  'acero':         ['hierro'],
  'flanche':       ['flanches', 'flange', 'brida'],
  'flanches':      ['flanche'],
  'brida':         ['flanche'],

  // --- Perfiles y platinas ---
  'platina':       ['pletina', 'pletinas', 'platinas'],
  'platinas':      ['pletina', 'pletinas', 'platina'],
  'pletina':       ['platina', 'platinas'],
  'pletinas':      ['platina', 'platinas', 'pletina'],
  'perfil':        ['perfiles', 'vigueta'],
  'perfiles':      ['perfil', 'vigueta'],
  'vigueta':       ['perfil', 'perfiles', 'vigueta tipo c'],
  'tipoc':         ['vigueta tipo c', 'vigueta'],
  'cercha':        ['cerchas'],
  'cerchas':       ['cercha'],
  'angulo':        ['angulos', 'angular'],
  'angulos':       ['angulo', 'angular'],
  'angular':       ['angulo', 'angulos'],

  // --- Láminas y techos ---
  'zinc':          ['lamina', 'galv', 'galvanizado', 'galvatecho', 'prepintado', 'techo'],
  'techo':         ['lamina', 'zinc', 'galvatecho', 'termopanel', 'acerolit'],
  'acerolit':      ['lamina acerolit', 'teja'],
  'teja':          ['lamina', 'acerolit', 'galvatecho', 'termopanel', 'techo'],
  'tejas':         ['lamina', 'acerolit', 'galvatecho', 'termopanel', 'techo'],
  'lamina':        ['lam', 'lam.', 'laminas'],
  'laminas':       ['lam', 'lam.', 'lamina'],
  'galvatecho':    ['galva techo', 'zinc', 'techo'],
  'termopanel':    ['termo panel', 'techo', 'translucido'],
  'miltejas':      ['mil tejas', 'pvc'],
  'caballete':     ['cumbrera', 'remate'],
  'cumbrera':      ['caballete', 'remate'],
  'remate':        ['caballete', 'cumbrera', 'fachada'],
  'losacero':      ['losa acero', 'losacero', 'losa', 'entrepiso'],
  'entrepiso':     ['losacero', 'losa acero'],

  // --- Mallas y alambres ---
  'malla':         ['mallas', 'truckson', 'electrosoldada'],
  'mallas':        ['malla', 'truckson', 'electrosoldada'],
  'truckson':      ['malla', 'mallas', 'electrosoldada'],
  'electrosoldada':['malla', 'truckson'],
  'alambre':       ['alambre galvanizado', 'alambron'],
  'alambron':      ['alambre', 'alambrones'],
  'alambrones':    ['alambron', 'alambre'],

  // ═══════════════════════════════════════════════════════════════════════════
  // TUBOS Y TUBERÍAS
  // ═══════════════════════════════════════════════════════════════════════════
  'tubo':          ['tubos', 'tuberia'],
  'tubos':         ['tubo', 'tuberia'],
  'tuberia':       ['tubo', 'tubos'],
  'cano':          ['tubo', 'tubos', 'tuberia'],
  'tubular':       ['tubo estruc'],
  'estructural':   ['estruc', 'estruc.'],
  'estruc':        ['estructural', 'estruc.'],
  'estruc.':       ['estructural', 'estruc'],
  'pulido':        ['pulida'],
  'ventilacion':   ['vent', 'vent.'],
  'vent':          ['ventilacion', 'vent.'],
  'vent.':         ['ventilacion', 'vent'],
  'electrico':     ['elec', 'elec.', 'electrica', 'emt', 'conduit'],
  'electrica':     ['elec', 'electrico'],
  'elec':          ['electrico', 'electrica', 'elec.'],
  'elec.':         ['electrico', 'electrica', 'elec'],
  'conduit':       ['elec', 'electrico', 'emt'],
  'emt':           ['elec', 'electrico', 'conduit'],
  'pvc':           ['plastico'],
  'alcantarillado':['alcant', 'drenaje', 'a.n', 'corrugado'],
  'alcant':        ['alcantarillado', 'drenaje'],
  'corrugado':     ['alcantarillado', 'corrugada'],

  // ═══════════════════════════════════════════════════════════════════════════
  // CONEXIONES DE PLOMERÍA
  // ═══════════════════════════════════════════════════════════════════════════
  'codo':          ['codos'],
  'codos':         ['codo'],
  'tee':           ['te'],
  'te':            ['tee'],
  'reduccion':     ['reducciones', 'red'],
  'reducciones':   ['reduccion', 'red'],
  'anillo':        ['anillos', 'aro'],
  'anillos':       ['anillo', 'aro'],
  'aro':           ['anillo', 'anillos'],
  'sifon':         ['sifones', 'trampa'],
  'sifones':       ['sifon'],
  'trampa':        ['sifon'],
  'union':         ['uniones', 'cupla'],
  'uniones':       ['union', 'cupla'],
  'cupla':         ['union', 'uniones'],
  'tapon':         ['tapones', 'cap'],
  'tapones':       ['tapon'],
  'cap':           ['tapon'],
  'niple':         ['niples', 'nipple', 'nipples'],
  'niples':        ['niple'],
  'yee':           ['ye'],
  'ye':            ['yee'],
  'curva':         ['curvas'],
  'curvas':        ['curva'],
  'adaptador':     ['adaptadores', 'adapt'],
  'adaptadores':   ['adaptador'],
  'adapt':         ['adaptador', 'adaptadores'],
  'junta':         ['juntas', 'dresser'],
  'juntas':        ['junta', 'dresser'],
  'dresser':       ['junta', 'juntas'],
  'rejilla':       ['rejillas'],
  'rejillas':      ['rejilla'],
  'valvula':       ['llave', 'valvulas'],
  'llave':         ['valvula', 'arresto', 'paso'],
  'arresto':       ['llave', 'valvula'],

  // ═══════════════════════════════════════════════════════════════════════════
  // PEGAMENTOS, CEMENTOS Y AGREGADOS
  // ═══════════════════════════════════════════════════════════════════════════
  'pega':          ['pegamento', 'cemento pvc', 'pega prof', 'adhesivo'],
  'pegamento':     ['pega', 'pega prof', 'adhesivo'],
  'adhesivo':      ['pega', 'pegamento'],
  'cemento':       ['cemento gris', 'cementos'],
  'cementos':      ['cemento'],
  'sikaflex':      ['sika', 'sellador'],
  'sika':          ['sikaflex'],
  'silicon':       ['silicona', 'sellador'],
  'silicona':      ['silicon', 'sellador'],
  'sellador':      ['silicon', 'silicona', 'sikaflex'],
  'mortero':       ['mezcla', 'premezclado', 'friso'],
  'mezcla':        ['mortero', 'premezclado'],
  'friso':         ['mortero', 'mezcla'],
  'arena':         ['agregado'],
  'piedra':        ['agregado', 'picada', 'granzón'],
  'picada':        ['piedra'],
  'granzon':       ['piedra', 'granzón'],
  'agregado':      ['arena', 'piedra'],
  'epoxica':       ['epoxi', 'epoxica', 'epoxy'],
  'epoxi':         ['epoxica', 'epoxy'],
  'teflon':        ['cinta teflon', 'teflón'],
  'impermeabilizante': ['impermeabilizante', 'imperm'],
  'imperm':        ['impermeabilizante'],

  // ═══════════════════════════════════════════════════════════════════════════
  // METALES Y ACABADOS
  // ═══════════════════════════════════════════════════════════════════════════
  'galvanizado':   ['galv', 'galv.', 'galvanizada'],
  'galvanizada':   ['galv', 'galv.', 'galvanizado'],
  'galv':          ['galvanizado', 'galvanizada', 'galv.'],
  'inoxidable':    ['inox', 'acero inoxidable'],
  'inox':          ['inoxidable'],
  'estriada':      ['estriado', 'est', 'est.'],
  'estriado':      ['estriada', 'est', 'est.'],
  'negro':         ['negra', 'hn'],
  'negra':         ['negro', 'hn'],
  'blanco':        ['blanca'],
  'blanca':        ['blanco'],
  'rojo':          ['roja'],
  'roja':          ['rojo'],
  'azul':          ['azul'],
  'verde':         ['verde'],
  'amarillo':      ['amarilla'],
  'amarilla':      ['amarillo'],
  'naranja':       ['naranja'],
  'redondo':       ['redonda'],
  'redonda':       ['redondo'],
  'cuadrado':      ['cuadrada', 'cuad', 'cuad.'],
  'cuadrada':      ['cuadrado', 'cuad'],
  'cuad':          ['cuadrado', 'cuadrada', 'cuad.'],
  'cuad.':         ['cuadrado', 'cuadrada', 'cuad'],
  'rectangular':   ['rect', 'rect.'],
  'rect':          ['rectangular', 'rect.'],
  'rect.':         ['rectangular', 'rect'],
  'liso':          ['lisa'],
  'lisa':          ['liso'],
  'roscado':       ['rosc', 'c/rosc', 'roscada'],
  'roscada':       ['rosc', 'c/rosc', 'roscado'],
  'macho':         ['macho'],
  'hembra':        ['hembra'],
  'octagonal':     ['octogonal'],
  'octogonal':     ['octagonal'],

  // ═══════════════════════════════════════════════════════════════════════════
  // ELECTRICIDAD
  // ═══════════════════════════════════════════════════════════════════════════
  'cable':         ['cables'],
  'cables':        ['cable'],
  'thw':           ['cable thw', 'thw'],
  'thwn':          ['cable thwn', 'thwn'],
  'ttu':           ['cable ttu', 'ttu'],
  'mcm':           ['cable mcm', 'mcm'],
  'breaker':       ['breakers', 'breker', 'interruptor termomagnetico'],
  'breakers':      ['breaker'],
  'interruptor':   ['breaker', 'switch'],
  'tablero':       ['panel electrico', 'centro carga'],
  'cajetin':       ['cajetines', 'caja electrica'],
  'cajetines':     ['cajetin'],
  'toma':          ['tomacorriente', 'enchufe'],
  'tomacorriente': ['toma', 'enchufe'],
  'enchufe':       ['toma', 'tomacorriente'],
  'bombillo':      ['bombillos', 'lampara', 'led', 'foco'],
  'bombillos':     ['bombillo'],
  'led':           ['bombillo', 'luz'],
  'arvidal':       ['arvidal'],
  'medidor':       ['caja de medidor'],
  'empotrable':    ['empotrar', 'embutir'],
  'superficial':   ['sobreponer', 'superficie'],
  'amp':           ['amperios', 'a'],
  'amperios':      ['amp'],

  // ═══════════════════════════════════════════════════════════════════════════
  // FERRETERÍA GENERAL
  // ═══════════════════════════════════════════════════════════════════════════
  'disco':         ['discos'],
  'discos':        ['disco'],
  'corte':         ['tronzar'],
  'esmerilar':     ['esmeril', 'desbaste'],
  'esmeril':       ['esmerilar', 'desbaste'],
  'tronzadora':    ['tronzar', 'cortadora'],
  'electrodo':     ['electrodos', 'soldadura'],
  'electrodos':    ['electrodo'],
  'soldadura':     ['electrodo', 'soldar'],
  'clavo':         ['clavos'],
  'clavos':        ['clavo'],
  'tornillo':      ['tornillos', 'tor', 'perno'],
  'tornillos':     ['tornillo', 'tor', 'perno'],
  'tor':           ['tornillo', 'tornillos'],
  'perno':         ['tornillo', 'tornillos', 'tor'],
  'barra':         ['barras'],
  'barras':        ['barra'],
  'drywall':       ['dry wall', 'laminas drywall', 'tabiqueria', 'yeso'],
  'tabiqueria':    ['drywall'],
  'zuncho':        ['zunchos', 'grapa', 'abrazadera'],
  'zunchos':       ['zuncho'],
  'grapa':         ['zuncho', 'zunchos'],
  'abrazadera':    ['zuncho', 'zunchos'],
  'arnes':         ['arnes', 'arneses', 'seguridad'],
  'arneses':       ['arnes'],
  'cerradura':     ['cerrojo', 'chapa', 'embutir'],
  'chapa':         ['cerradura'],
  'manilla':       ['manija', 'pomo'],
  'manija':        ['manilla', 'pomo'],
  'fregadero':     ['lavaplatos', 'fregaderos'],
  'lavaplatos':    ['fregadero'],
  'griferia':      ['grifo', 'llave'],
  'grifo':         ['griferia', 'llave'],
  'porton':        ['portones', 'puerta'],
  'portones':      ['porton'],

  // ═══════════════════════════════════════════════════════════════════════════
  // PINTURA
  // ═══════════════════════════════════════════════════════════════════════════
  'pintura':       ['pinturas'],
  'pinturas':      ['pintura'],
  'caucho':        ['pintura caucho', 'latex'],
  'latex':         ['caucho', 'pintura caucho'],
  'esmalte':       ['pintura esmalte', 'brillante'],
  'rodillo':       ['rodillos', 'felpa'],
  'rodillos':      ['rodillo'],
  'brocha':        ['brochas'],
  'brochas':       ['brocha'],

  // ═══════════════════════════════════════════════════════════════════════════
  // HERRAMIENTAS
  // ═══════════════════════════════════════════════════════════════════════════
  'taladro':       ['taladros', 'percutor'],
  'percutor':      ['taladro'],
  'martillo':      ['martillos'],
  'nivel':         ['niveles', 'burbuja'],
  'destornillador':['destornilladores', 'desarmador'],
  'desarmador':    ['destornillador'],
  'cinta':         ['cinta metrica'],

  // ═══════════════════════════════════════════════════════════════════════════
  // VIGAS ESPECÍFICAS
  // ═══════════════════════════════════════════════════════════════════════════
  'viga':          ['vigas'],
  'vigas':         ['viga'],
  'ipe':           ['ipe', 'i beam'],
  'ipn':           ['ipn'],
  'hea':           ['hea', 'he'],
  'heb':           ['heb', 'he'],
  'he':            ['hea', 'heb'],
  'wf':            ['wf', 'wide flange'],
  'upl':           ['upl'],
  'vp':            ['vp'],

  // ═══════════════════════════════════════════════════════════════════════════
  // ABREVIACIONES DE INVENTARIO
  // ═══════════════════════════════════════════════════════════════════════════
  'diametro':      ['diam', 'diam.'],
  'diam':          ['diametro', 'diam.'],
  'diam.':         ['diametro', 'diam'],
  'espesor':       ['esp', 'esp.'],
  'esp':           ['espesor', 'esp.'],
  'esp.':          ['espesor', 'esp'],
  'calibre':       ['cal', 'cal.', 'awg'],
  'cal':           ['calibre', 'cal.'],
  'cal.':          ['calibre', 'cal'],
  'largo':         ['longitud', 'long'],
  'longitud':      ['largo', 'long'],
  'ancho':         ['anchura'],
  'alto':          ['altura'],
  'peso':          ['grs', 'gramos', 'kg', 'kilos'],
  'grs':           ['gramos', 'peso'],
  'iso':           ['norma', 'iso'],
  'astm':          ['norma', 'astm'],
  'sdr':           ['sdr'],
  'sch':           ['schedule', 'cedula'],
  'schedule':      ['sch', 'cedula'],
  'nc':            ['rosca nacional'],
}

// ─── Mapa de correcciones tipográficas comunes ────────────────────────────────
const TYPO_MAP = {
  // ═══ Cabillas y varillas ═══
  'cavilla':     'cabilla',
  'cavillas':    'cabillas',
  'kabilla':     'cabilla',
  'kabillas':    'cabillas',
  'kabiya':      'cabilla',
  'cabiya':      'cabilla',
  'cabiyas':     'cabillas',
  'gavilla':     'cabilla',
  'cabila':      'cabilla',
  'cabilas':     'cabillas',
  'cabyas':      'cabillas',
  'variya':      'varilla',
  'variyas':     'varillas',
  'barilla':     'varilla',

  // ═══ Tubos ═══
  'tuvo':        'tubo',
  'tuvos':       'tubos',
  'tibo':        'tubo',
  'tubp':        'tubo',
  'tubi':        'tubo',
  'tuberia':     'tuberia',
  'tubria':      'tuberia',

  // ═══ Láminas ═══
  'lamima':      'lamina',
  'lanina':      'lamina',
  'lamna':       'lamina',
  'laina':       'lamina',
  'lanima':      'lamina',
  'lamnia':      'lamina',

  // ═══ Conexiones ═══
  'coto':        'codo',
  'codp':        'codo',
  'sifo':        'sifon',
  'cifon':       'sifon',
  'sipho':       'sifon',
  'tei':         'tee',
  'reduccin':    'reduccion',
  'reducion':    'reduccion',
  'reduccion':   'reduccion',
  'redustion':   'reduccion',
  'anilo':       'anillo',
  'aniyo':       'anillo',
  'niple':       'niple',
  'nipel':       'niple',
  'adaptadpr':   'adaptador',
  'adptador':    'adaptador',
  'unio':        'union',
  'junra':       'junta',
  'juna':        'junta',

  // ═══ Ángulos y vigas ═══
  'angilo':      'angulo',
  'amgulo':      'angulo',
  'anguko':      'angulo',
  'abgulo':      'angulo',
  'angulp':      'angulo',
  'vigaa':       'viga',
  'biga':        'viga',
  'bigas':       'vigas',
  'vigs':        'viga',
  'bigueta':     'vigueta',
  'viguets':     'vigueta',

  // ═══ Platinas/Pletinas ═══
  'pletima':     'pletina',
  'platima':     'platina',
  'pletna':      'pletina',
  'pleatina':    'pletina',
  'playtina':    'platina',

  // ═══ Clavos y tornillos ═══
  'clavp':       'clavo',
  'clabp':       'clavo',
  'clabo':       'clavo',
  'clabos':      'clavos',
  'tornilo':     'tornillo',
  'tronillo':    'tornillo',
  'tornllo':     'tornillo',

  // ═══ Alambres y mallas ═══
  'almabre':     'alambre',
  'alhambre':    'alambre',
  'alanbre':     'alambre',
  'alembre':     'alambre',
  'alambr':      'alambre',
  'alambrom':    'alambron',
  'alambrn':     'alambron',
  'mala':        'malla',
  'maalla':      'malla',
  'maya':        'malla',
  'mayas':       'mallas',
  'trukson':     'truckson',
  'trakson':     'truckson',

  // ═══ Cementos y pegamentos ═══
  'cemeto':      'cemento',
  'cemnto':      'cemento',
  'ceemento':    'cemento',
  'semnto':      'cemento',
  'semento':     'cemento',
  'peag':        'pega',
  'peg':         'pega',
  'pgea':        'pega',
  'pegaa':       'pega',
  'motero':      'mortero',
  'moretro':     'mortero',
  'mortro':      'mortero',

  // ═══ Losacero ═══
  'losasero':    'losacero',
  'lozacero':    'losacero',
  'losa':        'losacero',
  'losasero':    'losacero',

  // ═══ Electricidad ═══
  'breiker':     'breaker',
  'breker':      'breaker',
  'braker':      'breaker',
  'briker':      'breaker',
  'electrofo':   'electrodo',
  'electrod':    'electrodo',
  'electrdodo':  'electrodo',
  'cajetn':      'cajetin',
  'cajehin':     'cajetin',
  'cajeti':      'cajetin',
  'tabelro':     'tablero',
  'tabero':      'tablero',
  'arvdal':      'arvidal',
  'arbidal':     'arvidal',
  'arvdial':     'arvidal',
  'arvial':      'arvidal',
  'cabel':       'cable',
  'calbe':       'cable',

  // ═══ Perfiles y estructuras ═══
  'perfl':       'perfil',
  'perfi':       'perfil',
  'cerhca':      'cercha',
  'cerha':       'cercha',
  'flanch':      'flanche',
  'flange':      'flanche',

  // ═══ Ferretería ═══
  'disko':       'disco',
  'dico':        'disco',
  'disoc':       'disco',
  'rejila':      'rejilla',
  'rejiya':      'rejilla',
  'rejiia':      'rejilla',
  'arnes':       'arnes',
  'arnez':       'arnes',
  'cerradra':    'cerradura',
  'serradura':   'cerradura',
  'fregadro':    'fregadero',
  'grifria':     'griferia',
  'grieria':     'griferia',
  'portn':       'porton',
  'portom':      'porton',

  // ═══ Zunchos ═══
  'zunco':       'zuncho',
  'suncho':      'zuncho',
  'sunco':       'zuncho',
  'zumcho':      'zuncho',

  // ═══ Galvanizado y acabados ═══
  'galbanizado': 'galvanizado',
  'galvaniado':  'galvanizado',
  'galvnizado':  'galvanizado',
  'galvanisado': 'galvanizado',
  'estrucrural': 'estructural',
  'estrctural':  'estructural',
  'estructiral': 'estructural',
  'pulifo':      'pulido',
  'pulid':       'pulido',
  'puido':       'pulido',

  // ═══ Techos ═══
  'galvatexo':   'galvatecho',
  'galvatehco':  'galvatecho',
  'galvatexho':  'galvatecho',
  'termopabel':  'termopanel',
  'tremopanel':  'termopanel',
  'termopanle':  'termopanel',
  'acerlit':     'acerolit',
  'acerolith':   'acerolit',

  // ═══ Drywall ═══
  'drywal':      'drywall',
  'draiwall':    'drywall',
  'drywol':      'drywall',
  'draiwol':     'drywall',

  // ═══ Pintura ═══
  'pintra':      'pintura',
  'pnitura':     'pintura',
  'pintrua':     'pintura',
  'esmalte':     'esmalte',
  'rodilo':      'rodillo',
  'rodiyo':      'rodillo',

  // ═══ Abreviaciones mal escritas ═══
  'a,n':         'a.n',
  'a,f':         'a.f',
  'a,c':         'a.c',

  // ═══ Piedra y arena ═══
  'piedrs':      'piedra',
  'pidera':      'piedra',
  'arean':       'arena',
  'arna':        'arena',

  // ═══ Herramientas ═══
  'taladrop':    'taladro',
  'taaldro':     'taladro',
  'martilo':     'martillo',
  'martiyo':     'martillo',
  'nvel':        'nivel',
  'nibel':       'nivel',
}

// ─── Distancia de Levenshtein ─────────────────────────────────────────────────
function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  // Optimización: si la diferencia de longitud es muy grande, no vale la pena
  if (Math.abs(a.length - b.length) > 3) return Math.abs(a.length - b.length)
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let curr = new Array(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

// Umbral de distancia según longitud del token
function fuzzyThreshold(token) {
  if (token.length <= 3) return 0   // No fuzzy para tokens muy cortos
  if (token.length <= 5) return 1
  if (token.length <= 8) return 2
  return 3
}

// ─── Normalización de texto ───────────────────────────────────────────────────
export function normalizeText(text) {
  return (text || '').toLowerCase()
    .replace(/[áàä]/g, 'a')
    .replace(/[éèë]/g, 'e')
    .replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o')
    .replace(/[úùü]/g, 'u')
    .replace(/ñ/g, 'n')
}

// ─── Pre-procesar query: fracciones, medidas, limpieza ────────────────────────
function preprocessQuery(query) {
  let q = normalizeText(query)

  // Fracciones multi-palabra y sustituciones contextuales
  for (const [frase, reemplazo] of FRACCIONES_MULTI) {
    q = q.replace(new RegExp(frase, 'gi'), reemplazo)
  }

  // Números + " como pulgadas: "4"" → "4\""
  // Already handled by FRACCIONES_MULTI pulgadas→"

  // Detectar medidas compuestas: "1 1/2", "2 1/2" — no separar
  // Se manejan en tokenización

  return q
}

// ─── Tokenización inteligente ─────────────────────────────────────────────────
function tokenize(q) {
  // Primero detectar medidas compuestas como "1 1/2", "2 1/4" etc
  const compoundPattern = /(\d+)\s+(\d+\/\d+)/g
  const compounds = []
  q = q.replace(compoundPattern, (match, whole, frac) => {
    const compound = `${whole} ${frac}`
    compounds.push(compound)
    return `__COMPOUND${compounds.length - 1}__`
  })

  // Tokenizar
  const rawTokens = q.split(/[\s,;]+/).filter(Boolean)

  // Restaurar compounds y filtrar stopwords
  return rawTokens.map(t => {
    const compoundMatch = t.match(/^__COMPOUND(\d+)__$/)
    if (compoundMatch) return compounds[parseInt(compoundMatch[1])]
    return t
  }).filter(t => !STOPWORDS.has(t) && t.length > 0)
}

// ─── Expandir un token en variantes ───────────────────────────────────────────
function expandToken(token) {
  const variantes = new Set([token])

  // 1. Corrección de typos conocidos
  const corrected = TYPO_MAP[token]
  if (corrected) {
    variantes.add(corrected)
    // También expandir sinónimos del corregido
    const sins = SINONIMOS[corrected]
    if (sins) sins.forEach(s => variantes.add(s))
  }

  // 2. Sinónimos directos
  const sins = SINONIMOS[token]
  if (sins) sins.forEach(s => variantes.add(s))

  // 3. Deplural: "cabillas" → "cabilla"
  if (token.length > 3 && token.endsWith('s')) {
    const singular = token.slice(0, -1)
    variantes.add(singular)
    const sinsSingular = SINONIMOS[singular]
    if (sinsSingular) sinsSingular.forEach(s => variantes.add(s))
    const typoSingular = TYPO_MAP[singular]
    if (typoSingular) variantes.add(typoSingular)
  }

  // 4. Deplural "es": "conexiones" → "conexion"
  if (token.length > 4 && token.endsWith('es')) {
    const base = token.slice(0, -2)
    variantes.add(base)
    const sinsBase = SINONIMOS[base]
    if (sinsBase) sinsBase.forEach(s => variantes.add(s))
  }

  return [...variantes]
}

// ─── Parser de términos de búsqueda ───────────────────────────────────────────
export function parseSearchTerms(query) {
  if (!query || !query.trim()) return []

  const q = preprocessQuery(query)
  const tokens = tokenize(q)

  return tokens.map(token => expandToken(token))
}

// ─── Búsqueda con match exacto (includes) ────────────────────────────────────
export function smartMatch(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return true
  const normalized = normalizeText(text)
  return searchTerms.every(variantes =>
    variantes.some(v => normalized.includes(v))
  )
}

// ─── Búsqueda con scoring (para ranking) ──────────────────────────────────────
export function smartMatchScore(text, searchTerms) {
  if (!searchTerms || searchTerms.length === 0) return { match: true, score: 0 }
  const normalized = normalizeText(text)
  let totalScore = 0
  let matchedTerms = 0

  for (const variantes of searchTerms) {
    let bestScore = 0
    let found = false

    for (const v of variantes) {
      if (normalized.includes(v)) {
        found = true
        // Bonus por match exacto de palabra vs substring
        const wordBoundary = new RegExp(`(^|[\\s.,;/\\-"])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s.,;/\\-"])`)
        if (wordBoundary.test(normalized)) {
          bestScore = Math.max(bestScore, 10 + v.length) // match exacto de palabra
        } else {
          bestScore = Math.max(bestScore, 5 + v.length) // match como substring
        }
        break
      }
    }

    if (found) {
      matchedTerms++
      totalScore += bestScore
    } else {
      // No encontrado exacto — intentar fuzzy
      const words = normalized.split(/[\s.,;/\-"]+/).filter(Boolean)
      let bestFuzzy = Infinity
      let fuzzyFound = false

      for (const v of variantes) {
        const threshold = fuzzyThreshold(v)
        if (threshold === 0) continue // No fuzzy para tokens cortos

        for (const word of words) {
          const dist = levenshtein(v, word)
          if (dist <= threshold && dist < bestFuzzy) {
            bestFuzzy = dist
            fuzzyFound = true
          }
        }
      }

      if (fuzzyFound) {
        matchedTerms++
        totalScore += Math.max(1, 5 - bestFuzzy) // Menor score por fuzzy
      }
    }
  }

  if (matchedTerms === 0) return { match: false, score: 0 }

  // Score final: % de términos que matchearon * score acumulado
  const coverage = matchedTerms / searchTerms.length
  return {
    match: coverage >= 0.5, // Al menos 50% de los términos deben matchear
    score: totalScore * coverage,
    coverage,
    matchedTerms,
    totalTerms: searchTerms.length,
  }
}

// ─── Búsqueda directa por código (sin tokenizar, máxima prioridad) ───────────
// Compara la query cruda contra el código del producto: exacto, prefijo y substring.
// Esto garantiza que escribir el código siempre encuentre el producto.
export function matchByCode(producto, rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return false
  const codigo = normalizeText(producto.codigo || '')
  if (!codigo) return false
  const q = normalizeText(rawQuery.trim())
  // Exacto
  if (codigo === q) return true
  // La query es prefijo del código (ej. "CA-0" encuentra "CA-001")
  if (codigo.startsWith(q) && q.length >= 2) return true
  // El código contiene la query como substring
  if (q.length >= 2 && codigo.includes(q)) return true
  // Comparar sin separadores (guiones, puntos, barras)
  const codLimpio = codigo.replace(/[^a-z0-9]/g, '')
  const qLimpio = q.replace(/[^a-z0-9]/g, '')
  if (qLimpio.length >= 2 && codLimpio.includes(qLimpio)) return true
  return false
}

// ─── Búsqueda de producto con fuzzy fallback ─────────────────────────────────
export function smartMatchProducto(producto, searchTerms, rawQuery = '') {
  if (!searchTerms || searchTerms.length === 0) return true

  // ── Prioridad máxima: match directo por código ────────────────────────────
  // Si la query parece un código (contiene dígitos o es corta con guiones)
  // se intenta primero de forma directa sin pasar por el motor de tokens.
  if (rawQuery && matchByCode(producto, rawQuery)) return true

  const texto = normalizeText(`${producto.nombre || ''} ${producto.codigo || ''} ${producto.categoria || ''} ${producto.descripcion || ''}`)

  // Primero intentar match exacto (rápido)
  const exactMatch = searchTerms.every(variantes =>
    variantes.some(v => texto.includes(v))
  )
  if (exactMatch) return true

  // Fallback: fuzzy match — al menos 60% de los términos deben matchear
  const words = texto.split(/[\s.,;/\-"]+/).filter(Boolean)
  let matched = 0
  for (const variantes of searchTerms) {
    let found = false
    for (const v of variantes) {
      if (texto.includes(v)) { found = true; break }
      // Fuzzy solo para tokens >= 4 chars
      const threshold = fuzzyThreshold(v)
      if (threshold > 0) {
        for (const word of words) {
          if (levenshtein(v, word) <= threshold) { found = true; break }
        }
        if (found) break
      }
    }
    if (found) matched++
  }
  return matched >= Math.ceil(searchTerms.length * 0.6)
}

// ─── Búsqueda con ranking para listas de productos ───────────────────────────
export function smartSearchProductos(productos, query) {
  const searchTerms = parseSearchTerms(query)
  if (searchTerms.length === 0) return productos

  return productos
    .map(p => {
      const texto = `${p.nombre || ''} ${p.codigo || ''} ${p.categoria || ''} ${p.descripcion || ''}`
      const result = smartMatchScore(texto, searchTerms)
      return { ...p, _score: result.score, _match: result.match, _coverage: result.coverage }
    })
    .filter(p => p._match)
    .sort((a, b) => {
      // Primero por coverage (todos los términos encontrados primero)
      if (b._coverage !== a._coverage) return b._coverage - a._coverage
      // Luego por score
      if (b._score !== a._score) return b._score - a._score
      // Finalmente por stock
      return (b.stock_actual || 0) - (a.stock_actual || 0)
    })
}

// ─── Filtro PostgREST para Supabase ───────────────────────────────────────────
export function buildSmartFilter(query) {
  const terms = parseSearchTerms(query)
  if (terms.length === 0) return null

  return terms.map(variantes => {
    const conditions = variantes.flatMap(v => {
      // Limpiar caracteres especiales de PostgREST pero mantener fracciones y pulgadas
      const safe = v.replace(/[\\%_]/g, '').replace(/\./g, '*')
      if (!safe || safe.length < 1) return []
      return [
        `nombre.ilike.*${safe}*`,
        `codigo.ilike.*${safe}*`,
      ]
    })
    return conditions.join(',')
  }).filter(Boolean)
}
