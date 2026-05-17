import { Honcho } from "@honcho-ai/sdk";

// Leer configuración de variables de entorno
// Soporta Node (process.env) y Vite (import.meta.env)
const apiKey = typeof process !== 'undefined' ? process.env.HONCHO_API_KEY : (import.meta.env ? import.meta.env.VITE_HONCHO_API_KEY || import.meta.env.HONCHO_API_KEY : null);
const baseUrl = typeof process !== 'undefined' ? process.env.HONCHO_BASE_URL : (import.meta.env ? import.meta.env.VITE_HONCHO_BASE_URL || import.meta.env.HONCHO_BASE_URL : "https://api.honcho.dev");
const workspaceId = typeof process !== 'undefined' ? process.env.HONCHO_WORKSPACE_ID : (import.meta.env ? import.meta.env.VITE_HONCHO_WORKSPACE_ID || import.meta.env.HONCHO_WORKSPACE_ID : "listo-pos-cotizaciones");
const environment = typeof process !== 'undefined' ? process.env.HONCHO_ENVIRONMENT : (import.meta.env ? import.meta.env.VITE_HONCHO_ENVIRONMENT || import.meta.env.HONCHO_ENVIRONMENT : "production");

// Validar variables requeridas
if (!apiKey) {
  console.warn("Honcho: Missing HONCHO_API_KEY. Honcho features will be disabled.");
}

let honcho = null;
if (apiKey) {
  honcho = new Honcho({
    apiKey,
    workspaceId
  });
}

/**
 * Helper para obtener o crear un Peer.
 * El SDK de Honcho usualmente crea el recurso si no existe al llamarlo por ID.
 */
export async function getOrCreatePeer(id, metadata = {}) {
  if (!honcho) throw new Error("Honcho client not initialized");
  const peer = await honcho.peer(id);
  // Si el SDK soporta actualización de metadata, se podría hacer aquí.
  return peer;
}

/**
 * Helper para obtener o crear una Sesión.
 */
export async function getOrCreateSession(id, metadata = {}) {
  if (!honcho) throw new Error("Honcho client not initialized");
  const session = await honcho.session(id);
  return session;
}

/**
 * Asegura que una sesión tenga asociados ciertos peers.
 * Nota: El SDK de Honcho maneja la asociación al agregar mensajes de un peer a una sesión,
 * o mediante métodos específicos si están disponibles.
 */
export async function ensureSessionPeers(sessionId, peerIds) {
  if (!honcho) throw new Error("Honcho client not initialized");
  const session = await getOrCreateSession(sessionId);
  // Aquí podríamos asociar peers si el SDK tiene un método específico.
  return session;
}

/**
 * Agrega una nota de arquitectura.
 */
export async function addArchitectureNote({ sessionId, authorPeerId, text, metadata = {} }) {
  if (!honcho) throw new Error("Honcho client not initialized");
  const session = await getOrCreateSession(sessionId);
  const author = await getOrCreatePeer(authorPeerId);
  
  // Normalizar evento como mensaje
  await session.addMessages([
    author.message(text)
  ]);
}

/**
 * Agrega una nota de negocio.
 */
export async function addBusinessNote({ sessionId, authorPeerId, text, metadata = {} }) {
  if (!honcho) throw new Error("Honcho client not initialized");
  const session = await getOrCreateSession(sessionId);
  const author = await getOrCreatePeer(authorPeerId);
  
  await session.addMessages([
    author.message(text)
  ]);
}

/**
 * Agrega un evento de cotización.
 */
export async function addQuoteEvent({ quoteId, tenantId, sellerId, customerId, summary, metadata = {} }) {
  if (!honcho) throw new Error("Honcho client not initialized");
  const sessionId = `cotizacion-${quoteId}`;
  const session = await getOrCreateSession(sessionId);
  const author = await getOrCreatePeer(sellerId || "sistema");
  
  const text = `Evento de Cotización: ${summary}\nCliente: ${customerId}\nTenant: ${tenantId}`;
  
  await session.addMessages([
    author.message(text)
  ]);
}

export default honcho;
