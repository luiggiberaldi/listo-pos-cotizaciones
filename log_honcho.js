// log_honcho.js
// CLI rápido para que el asistente o el desarrollador registren notas en Honcho
// Uso: node log_honcho.js [arch|biz|bug] "Mensaje de la nota"

import { addArchitectureNote, addBusinessNote } from './src/lib/honcho.js';

const [type, message] = process.argv.slice(2);

if (!type || !message) {
  console.log('Uso: node log_honcho.js [arch|biz|bug] "Mensaje de la nota"');
  process.exit(1);
}

async function run() {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    if (type === 'arch' || type === 'bug') {
      const sessionId = `arch-diario-${today}`;
      await addArchitectureNote({
        sessionId,
        authorPeerId: 'assistant-arquitectura',
        text: message,
        metadata: { category: type }
      });
      console.log(`✔ Nota de ${type} registrada en sesión ${sessionId}`);
    } else if (type === 'biz') {
      const sessionId = `negocio-general`;
      await addBusinessNote({
        sessionId,
        authorPeerId: 'assistant-negocio',
        text: message,
        metadata: { category: 'negocio' }
      });
      console.log(`✔ Nota de negocio registrada en sesión ${sessionId}`);
    } else {
      console.log('Tipo no válido. Usa: arch, biz o bug');
    }
  } catch (error) {
    console.error('❌ Error al registrar en Honcho:', error.message);
  }
}

run();
