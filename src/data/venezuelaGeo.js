// Datos geográficos de Venezuela — estados y ciudades principales
// Fuente: división político-territorial oficial

const ESTADOS_CIUDADES = {
  'Amazonas':          ['Puerto Ayacucho', 'San Fernando de Atabapo', 'Maroa', 'La Esmeralda'],
  'Anzoátegui':        ['Barcelona', 'Puerto La Cruz', 'El Tigre', 'Anaco', 'Lechería', 'Cantaura', 'Puerto Píritu', 'Guanta', 'Pariaguán', 'San José de Guanipa'],
  'Apure':             ['San Fernando de Apure', 'Guasdualito', 'Achaguas', 'Biruaca', 'Elorza', 'Bruzual'],
  'Aragua':            ['Maracay', 'Turmero', 'La Victoria', 'Villa de Cura', 'Cagua', 'Santa Rita', 'Palo Negro', 'El Limón', 'San Mateo', 'Colonia Tovar'],
  'Barinas':           ['Barinas', 'Socopó', 'Ciudad Bolivia', 'Barinitas', 'Santa Bárbara de Barinas', 'Sabaneta'],
  'Bolívar':           ['Ciudad Bolívar', 'Ciudad Guayana', 'Upata', 'Caicara del Orinoco', 'Santa Elena de Uairén', 'Tumeremo', 'El Callao', 'Guasipati'],
  'Carabobo':          ['Valencia', 'Puerto Cabello', 'Guacara', 'San Diego', 'Naguanagua', 'Los Guayos', 'Mariara', 'Güigüe', 'Tocuyito', 'Bejuma', 'Morón', 'San Joaquín'],
  'Cojedes':           ['San Carlos', 'Tinaquillo', 'Tinaco', 'El Baúl', 'Las Vegas'],
  'Delta Amacuro':     ['Tucupita', 'Pedernales', 'Sierra Imataca'],
  'Distrito Capital':  ['Caracas'],
  'Falcón':            ['Coro', 'Punto Fijo', 'Tucacas', 'Dabajuro', 'Churuguara', 'La Vela de Coro', 'Judibana', 'Carirubana'],
  'Guárico':           ['San Juan de Los Morros', 'Calabozo', 'Valle de La Pascua', 'Zaraza', 'Altagracia de Orituco', 'Tucupido', 'El Sombrero'],
  'La Guaira':         ['La Guaira', 'Maiquetía', 'Catia La Mar', 'Caraballeda', 'Macuto', 'Naiguatá'],
  'Lara':              ['Barquisimeto', 'Cabudare', 'Carora', 'El Tocuyo', 'Quíbor', 'Duaca', 'Sanare'],
  'Mérida':            ['Mérida', 'El Vigía', 'Ejido', 'Tovar', 'Lagunillas', 'Mucuchíes', 'Tabay', 'Santa Cruz de Mora'],
  'Miranda':           ['Los Teques', 'Guarenas', 'Guatire', 'Petare', 'Baruta', 'Chacao', 'Charallave', 'Cúa', 'Ocumare del Tuy', 'Santa Teresa del Tuy', 'Higuerote', 'Río Chico', 'San Antonio de Los Altos'],
  'Monagas':           ['Maturín', 'Punta de Mata', 'Temblador', 'Caripito', 'Barrancas del Orinoco', 'Caripe'],
  'Nueva Esparta':     ['La Asunción', 'Porlamar', 'Juan Griego', 'Pampatar', 'El Valle del Espíritu Santo', 'Boca de Río'],
  'Portuguesa':        ['Guanare', 'Acarigua', 'Araure', 'Ospino', 'Turén', 'Biscucuy', 'Agua Blanca'],
  'Sucre':             ['Cumaná', 'Carúpano', 'Güiria', 'Cariaco', 'Río Caribe', 'Irapa', 'Araya'],
  'Táchira':           ['San Cristóbal', 'Táriba', 'Rubio', 'La Fría', 'San Antonio del Táchira', 'Colón', 'Capacho', 'Palmira', 'Ureña'],
  'Trujillo':          ['Trujillo', 'Valera', 'Boconó', 'Sabana de Mendoza', 'Pampanito', 'Escuque'],
  'Yaracuy':           ['San Felipe', 'Yaritagua', 'Chivacoa', 'Nirgua', 'Cocorote', 'Independencia'],
  'Zulia':             ['Maracaibo', 'Cabimas', 'Ciudad Ojeda', 'Machiques', 'Santa Bárbara del Zulia', 'Los Puertos de Altagracia', 'Mara', 'San Francisco', 'La Cañada de Urdaneta', 'Villa del Rosario'],
}

export const ESTADOS = Object.keys(ESTADOS_CIUDADES).sort()

export function getCiudades(estado) {
  return ESTADOS_CIUDADES[estado] || []
}
