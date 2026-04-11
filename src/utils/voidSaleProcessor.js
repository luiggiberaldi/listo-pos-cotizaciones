import { storageService } from './storageService';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { round2 } from './dinero';
import { createNotification, NOTIF_TYPES } from '../services/notificationService';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

/**
 * Handles the logic of voiding a transaction, reverting stock, and reverting customer balances.
 */
export async function processVoidSale(sale, currentSales, currentProducts) {
    if (!sale) throw new Error("Sale object is required to void.");

    // 1. Marcar venta como ANULADA
    const updatedSales = currentSales.map(s => {
        if (s.id === sale.id) return { ...s, status: 'ANULADA' };
        return s;
    });

    // 2. Revertir Stock
    let updatedProducts = [...currentProducts];
    if (sale.items && sale.items.length > 0) {
        updatedProducts = currentProducts.map(p => {
            // Un producto puede estar múltiples veces (como unidad y paquete)
            const itemsInSale = sale.items.filter(i => (i._originalId || i.id) === p.id);
            if (itemsInSale.length > 0) {
                const totalToRestore = itemsInSale.reduce((sum, item) => {
                    if (item.isWeight) return sum + item.qty;
                    if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                    return sum + item.qty;
                }, 0);
                return { ...p, stock: (p.stock || 0) + totalToRestore };
            }
            return p;
        });
    }

    // 3. Revertir Deuda/Saldo a Favor del Cliente
    const savedCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
    let updatedCustomers = savedCustomers;
    
    const fiadoAmountUsd = sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0;
    const favorUsed = sale.payments?.filter(p => p.methodId === 'saldo_favor').reduce((sum, p) => sum + p.amountUsd, 0) || 0;

    if (sale.customerId && (fiadoAmountUsd > 0 || favorUsed > 0)) {
        updatedCustomers = savedCustomers.map(c => {
            if (c.id === sale.customerId) {
                const newDeuda = round2(Math.max(0, (c.deuda || 0) - fiadoAmountUsd));
                const newFavor = round2((c.saldo_favor || 0) + favorUsed);
                console.log(`[Anular] Cliente ${c.name}: deuda ${c.deuda} -> ${newDeuda} (revertido fiado $${fiadoAmountUsd}), favor ${c.saldo_favor || 0} -> ${newFavor} (revertido favor $${favorUsed})`);
                return { ...c, deuda: newDeuda, saldo_favor: newFavor };
            }
            return c;
        });
    }

    // 4. Guardar todo
    await storageService.setItem(SALES_KEY, updatedSales);
    await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);

    const user = useAuthStore.getState().usuarioActivo;
    logEvent('VENTA', 'VENTA_ANULADA', `Venta #${sale.saleNumber || '?'} anulada - $${sale.totalUsd?.toFixed(2)}`, user, { saleId: sale.id });
    createNotification(
        NOTIF_TYPES.VENTA_ANULADA,
        'Venta anulada',
        `Venta #${sale.saleNumber || '?'} — $${sale.totalUsd?.toFixed(2)} anulada por ${user?.nombre || 'Usuario'}`,
        { saleId: sale.id, totalUsd: sale.totalUsd, userId: user?.id }
    );

    return { updatedSales, updatedProducts, updatedCustomers };
}
