// src/data/venezuelaGeo.js
// Datos geográficos de Venezuela — Municipios y Ciudades Principales
// Fuente: División Político-Territorial de Venezuela

const ESTADOS_CIUDADES = {
  'Amazonas': [
    'Alto Orinoco (La Esmeralda)', 'Atabapo (San Fernando de Atabapo)', 'Atures (Puerto Ayacucho)', 
    'Autana (Isla de Ratón)', 'Manapiare (San Juan de Manapiare)', 'Maroa', 'Río Negro (San Carlos de Río Negro)'
  ],
  'Anzoátegui': [
    'Anaco', 'Aragua de Barcelona', 'Barcelona', 'Boca de Uchire', 'Cantaura', 'Clarines', 'El Tigre', 
    'Guanta', 'Lechería (Urbaneja)', 'Libertad', 'Onoto', 'Pariaguán', 'Píritu', 'Puerto La Cruz', 
    'Puerto Píritu', 'San José de Guanipa', 'San Mateo', 'Santa Ana', 'Soledad', 'Valle de Guanape'
  ],
  'Apure': [
    'Achaguas', 'Biruaca', 'Elorza', 'Guasdualito (Páez)', 'San Fernando de Apure', 'San Juan de Payara', 'San Vicente'
  ],
  'Aragua': [
    'Cagua (Sucre)', 'Camatagua', 'Colonia Tovar', 'El Consejo (Revenga)', 'El Limón (MBI)', 
    'La Victoria (José Félix Ribas)', 'Las Tejerías', 'Maracay (Girardot)', 'Ocumare de la Costa', 
    'Palo Negro (Libertador)', 'San Casimiro', 'San Mateo', 'San Sebastián de los Reyes', 
    'Santa Cruz (Lamas)', 'Santa Rita (FLA)', 'Turmero (Santiago Mariño)', 'Villa de Cura (Zamora)'
  ],
  'Barinas': [
    'Arismendi', 'Barinas', 'Barinitas', 'Barrancas', 'Ciudad Bolivia', 'Libertad', 'Obispos', 
    'Sabaneta', 'Santa Bárbara de Barinas', 'Socopó'
  ],
  'Bolívar': [
    'Caicara del Orinoco', 'Ciudad Bolívar (Angostura)', 'Ciudad Guayana (Caroní)', 'El Callao', 
    'El Dorado', 'Guasipati', 'Santa Elena de Uairén', 'Tumeremo', 'Upata (Piar)'
  ],
  'Carabobo': [
    'Bejuma', 'Carlos Arvelo (Güigüe)', 'Diego Ibarra (Mariara)', 'Guacara', 'Juan José Mora (Morón)', 
    'Libertador (Tocuyito)', 'Los Guayos', 'Miranda', 'Montalbán', 'Naguanagua', 'Puerto Cabello', 
    'San Diego', 'San Joaquín', 'Valencia'
  ],
  'Cojedes': [
    'El Baúl', 'El Pao', 'Libertad', 'San Carlos', 'Tinaco', 'Tinaquillo'
  ],
  'Delta Amacuro': [
    'Casacoima', 'Pedernales', 'Tucupita'
  ],
  'Distrito Capital': [
    'Caracas (Libertador)'
  ],
  'Falcón': [
    'Churuguara', 'Coro (Miranda)', 'Dabajuro', 'La Vela de Coro', 'Pueblo Nuevo', 'Punto Fijo (Carirubana)', 
    'San Luis', 'Santa Cruz de Bucaral', 'Tucacas (Silva)', 'Urumaco'
  ],
  'Guárico': [
    'Altagracia de Orituco', 'Calabozo', 'Chaguaramas', 'El Socorro', 'El Sombrero', 'Las Mercedes', 
    'Ortiz', 'San Juan de los Morros', 'Valle de la Pascua', 'Zaraza'
  ],
  'La Guaira': [
    'Caraballeda', 'Catia La Mar', 'La Guaira', 'Macuto', 'Maiquetía', 'Naiguatá'
  ],
  'Lara': [
    'Barquisimeto (Iribarren)', 'Cabudare (Palavecino)', 'Carora (Torres)', 'Duaca', 'El Tocuyo', 
    'Quíbor (Jiménez)', 'Sanare', 'Siquisique'
  ],
  'Mérida': [
    'Canaguá', 'Ejido', 'El Vigía (Alberto Adriani)', 'Lagunillas', 'Mérida (Libertador)', 
    'Mucuchíes', 'Nueva Bolivia', 'Santa Cruz de Mora', 'Tabay', 'Tovar'
  ],
  'Miranda': [
    'Baruta', 'Caucagua', 'Chacao', 'Charallave', 'Cúa (Urdaneta)', 'El Hatillo', 'Guarenas', 
    'Guatire', 'Higuerote', 'Los Teques (Guaicaipuro)', 'Ocumare del Tuy', 'Petare (Sucre)', 
    'Río Chico', 'San Antonio de los Altos', 'Santa Lucia', 'Santa Teresa del Tuy'
  ],
  'Monagas': [
    'Aragua de Maturín', 'Caripe', 'Caripito', 'Caicara de Maturín', 'Maturín', 'Punta de Mata', 'Temblador'
  ],
  'Nueva Esparta': [
    'Boca de Río', 'Juan Griego', 'La Asunción', 'Pampatar', 'Porlamar', 'San Juan Bautista', 'Santa Ana'
  ],
  'Portuguesa': [
    'Acarigua (Páez)', 'Araure', 'Biscucuy', 'Guanare', 'Ospino', 'Píritu', 'Turén'
  ],
  'Sucre': [
    'Araya', 'Cariaco', 'Carúpano', 'Cumaná', 'Cumanacoa', 'Güiria', 'Irapa', 'Río Caribe'
  ],
  'Táchira': [
    'Colón', 'La Fría', 'La Grita', 'Rubio', 'San Antonio del Táchira', 'San Cristóbal', 'Táriba', 'Ureña'
  ],
  'Trujillo': [
    'Boconó', 'Carache', 'Escuque', 'La Quebrada', 'Sabana de Mendoza', 'Trujillo', 'Valera'
  ],
  'Yaracuy': [
    'Chivacoa (Bruzual)', 'Cocorote', 'Nirgua', 'San Felipe', 'Yaritagua (Peña)'
  ],
  'Zulia': [
    'Bachaquero', 'Cabimas', 'Casigua El Cubo', 'Ciudad Ojeda', 'La Cañada de Urdaneta', 
    'La Villa del Rosario', 'Machiques', 'Maracaibo', 'Mene Grande', 'Puertos de Altagracia', 
    'San Carlos del Zulia', 'San Francisco', 'Santa Rita'
  ],
}

export const ESTADOS = Object.keys(ESTADOS_CIUDADES).sort()

export function getCiudades(estado) {
  // Retornamos las ciudades/municipios ordenados alfabéticamente
  return (ESTADOS_CIUDADES[estado] || []).sort()
}
