export function getLocalISODate(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
