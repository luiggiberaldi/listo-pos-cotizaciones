// test_honcho.js
// Script de prueba para validar la integración con Honcho
// Ejecutar con: node test_honcho.js

import { getOrCreatePeer, getOrCreateSession, addArchitectureNote, addBusinessNote, addQuoteEvent } from './src/lib/honcho.js';

async function runTest() {
  console.log("Iniciando pruebas de Honcho...");

  try {
    // 1. Registrar una decisión de arquitectura
    console.log("\n1. Registrando decisión de arquitectura...");
    const archSessionId = `arch-diario-${new Date().toISOString().split('T')[0]}`;
    await addArchitectureNote({
      sessionId: archSessionId,
      authorPeerId: 'assistant-arquitectura',
      text: 'Se decidió integrar Honcho para el manejo de memoria viva del proyecto, evitando tocar la lógica de negocio existente.',
      metadata: { priority: 'high' }
    });
    console.log("✔ Nota de arquitectura registrada.");

    // 2. Registrar una objeción comercial (Nota de negocio)
    console.log("\n2. Registrando objeción comercial...");
    await addBusinessNote({
      sessionId: 'negocio-general',
      authorPeerId: 'assistant-negocio',
      text: 'El cliente X reportó que el recargo del 2% le parece excesivo si no se justifica con mejor flete.',
      metadata: { tag: 'objecion' }
    });
    console.log("✔ Objeción comercial registrada.");

    // 3. Registrar una cotización
    console.log("\n3. Registrando evento de cotización...");
    await addQuoteEvent({
      quoteId: '516',
      tenantId: 'construacero',
      sellerId: 'vendedor-1',
      customerId: 'cliente-abc',
      summary: 'Venta rápida de 1000kg de cabilla.',
      metadata: { total: 1500 }
    });
    console.log("✔ Evento de cotización registrado.");

    // 4. Consultar contexto asociado
    console.log("\n4. Consultando contexto...");
    const peer = await getOrCreatePeer('assistant-arquitectura');
    
    // El método chat puede no funcionar si la API key no es válida o si el SDK no está 100% listo,
    // por lo que lo envolvemos en un try/catch específico.
    try {
      const response = await peer.chat("¿Cuál fue la decisión sobre Honcho?");
      console.log("Respuesta de Honcho:", response);
    } catch (chatError) {
      console.log("No se pudo realizar el chat (posiblemente falta API Key real o sesión vacía):", chatError.message);
    }

    console.log("\n✔ Pruebas completadas.");
  } catch (error) {
    console.error("❌ Error en las pruebas:", error.message);
  }
}

runTest();
