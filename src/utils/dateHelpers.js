export function getLocalISODate(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Rango de un solo día
 * @param {number} offset 0 = hoy, -1 = ayer, etc.
 */
export function getDayRange(offset = 0) {
    const now = new Date();
    const d = new Date(now);
    d.setDate(now.getDate() + offset);
    // Si offset es mayor a 0, y la fecha es futura, limitamos a 'now'? 
    // Para días no suele ser necesario si es solo para rangos "pasados" o "presente".
    // Siguiendo el patrón, no pasamos de 'hoy' si el fin del día es en el futuro.
    // Como es de un solo día, from y to son iguales.
    const dStr = getLocalISODate(d);
    return { from: dStr, to: dStr };
}

/**
 * Rango de semana lunes-domingo
 * @param {number} offset 0 = esta semana, -1 = semana pasada, etc.
 */
export function getWeekRange(offset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0=dom, 1=lun...
    const diffToMon = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMon + offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    // Si sunday es futuro, usar hoy
    const end = sunday > now ? now : sunday;
    return { from: getLocalISODate(monday), to: getLocalISODate(end) };
}

/**
 * Rango de un solo día: el sábado más reciente (hoy si es sábado).
 * Alineado con la regla de comisión por cliente ajeno (aplica los sábados).
 * @param {number} offset 0 = último sábado, -1 = sábado anterior, etc.
 */
export function getUltimoSabadoRange(offset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0=dom ... 6=sab
    const daysBackToSaturday = day === 6 ? 0 : (day - 6 + 7) % 7;
    const d = new Date(now);
    d.setDate(now.getDate() - daysBackToSaturday + offset * 7);
    const dStr = getLocalISODate(d);
    return { from: dStr, to: dStr };
}

/**
 * Corte semanal de comisiones: viernes a jueves.
 * En viernes toma el último período completo (viernes anterior → jueves).
 * @param {number} offset 0 = último corte completo, -1 = corte anterior
 */
export function getCorteSemanalRange(offset = 0) {
    const now = new Date();
    const day = now.getDay(); // 0=dom, 1=lun... 4=jue, 5=vie
    const daysBackToThursday = day === 4 ? 7 : (day - 4 + 7) % 7;
    const end = new Date(now);
    end.setDate(now.getDate() - daysBackToThursday + offset * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);

    const previousEnd = new Date(start);
    previousEnd.setDate(start.getDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setDate(previousEnd.getDate() - 6);

    return {
        from: getLocalISODate(start),
        to: getLocalISODate(end),
        prevFrom: getLocalISODate(previousStart),
        prevTo: getLocalISODate(previousEnd),
    };
}

/**
 * Rango de mes completo
 * @param {number} offset 0 = este mes, -1 = mes pasado, etc.
 */
export function getMonthRange(offset = 0) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
    const end = last > now ? now : last;
    return { from: getLocalISODate(first), to: getLocalISODate(end) };
}

export function getDateRange(rangeId) {
    const now = new Date();
    const todayStr = getLocalISODate(now);

    switch (rangeId) {
        case 'today': {
            return { from: todayStr, to: todayStr };
        }
        case 'week': {
            const d = new Date(now);
            d.setDate(d.getDate() - d.getDay()); // domingo
            return { from: getLocalISODate(d), to: todayStr };
        }
        case 'month': {
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            return { from: getLocalISODate(d), to: todayStr };
        }
        case 'lastMonth': {
            const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: getLocalISODate(d), to: getLocalISODate(end) };
        }
        default:
            return { from: todayStr, to: todayStr };
    }
}
