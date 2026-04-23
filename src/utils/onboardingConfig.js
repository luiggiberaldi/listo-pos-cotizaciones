// src/utils/onboardingConfig.js
// Tips de primera vez diferenciados por rol
// Se usa con OnboardingSequence para mostrar uno a la vez

export const TIPS = {
  vendedor: [
    { id: 'v_crear', page: '/cotizaciones', text: 'Pulsa + Nueva para crear tu primera cotización. Agrega productos y envíala para aprobación.' },
    { id: 'v_enviar', page: '/cotizaciones', text: 'Cuando tu cotización esté lista, envíala. El supervisor la revisará y te notificará.' },
    { id: 'v_wa', page: '/cotizaciones', text: 'Una vez aprobada, comparte la cotización por WhatsApp directamente con tu cliente.' },
    { id: 'v_estado', page: '/cotizaciones', text: 'La barra de progreso en cada cotización te muestra en qué paso está. Azul = enviada, verde = aprobada.' },
  ],
  supervisor: [
    { id: 's_aprobar', page: '/cotizaciones', text: 'Las cotizaciones enviadas esperan tu aprobación. Usa el filtro "Enviadas" para verlas rápido.' },
    { id: 's_despacho', page: '/cotizaciones', text: 'Después de aprobar una cotización, crea el despacho. El stock se descontará automáticamente del inventario.' },
    { id: 's_reciclar', page: '/cotizaciones', text: 'Puedes reutilizar cotizaciones rechazadas o anuladas para crear una nueva con los mismos datos.' },
    { id: 's_filtro', page: '/cotizaciones', text: 'Filtra por vendedor para revisar las cotizaciones de cada miembro de tu equipo.' },
  ],
}
