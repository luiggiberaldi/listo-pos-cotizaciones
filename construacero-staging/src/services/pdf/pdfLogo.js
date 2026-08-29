// src/services/pdf/pdfLogo.js
// Logo embebido de Construacero para PDFs
// Siempre usa el logo embebido (con RIF incluido)
import { LOGO_CONSTRUACERO } from './logoBase64'

export async function cargarLogo() {
  return LOGO_CONSTRUACERO
}
