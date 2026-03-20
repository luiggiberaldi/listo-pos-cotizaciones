import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { BODEGA_CATEGORIES } from '../config/categories';

const ProductContext = createContext();

export function ProductProvider({ children, rates }) {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState(BODEGA_CATEGORIES);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);

    // Guard ref: prevents infinite loop when auto-save fires app_storage_update
    const savingRef = useRef(false);

    // MARKET LOGIC - Street Rate
    const [streetRate, setStreetRate] = useState(() => {
        const saved = localStorage.getItem('street_rate_bs');
        return saved ? parseFloat(saved) : 0;
    });

    // GLOBAL RATE LOGIC (Sync with SalesView)
    const [useAutoRate, setUseAutoRate] = useState(() => {
        const saved = localStorage.getItem('bodega_use_auto_rate');
        return saved !== null ? JSON.parse(saved) : true;
    });
    const [customRate, setCustomRate] = useState(() => {
        const saved = localStorage.getItem('bodega_custom_rate');
        return saved && parseFloat(saved) > 0 ? saved : '';
    });

    const effectiveRate = useAutoRate ? rates.bcv?.price : (parseFloat(customRate) > 0 ? parseFloat(customRate) : rates.bcv?.price);

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            const savedProducts = await storageService.getItem('bodega_products_v1', []);
            const savedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
            if (isMounted) {
                setProducts(savedProducts);
                setCategories(savedCategories);
                setIsLoadingProducts(false);
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, []);

    // Set Initial Street Rate (from BCV)
    useEffect(() => {
        if (!streetRate && rates.bcv?.price > 0 && !localStorage.getItem('street_rate_bs')) {
            setStreetRate(rates.bcv.price);
        }
    }, [rates.bcv?.price, streetRate]);

    // Auto-save products and categories
    useEffect(() => {
        if (!isLoadingProducts) {
            savingRef.current = true;
            const savePromises = [];
            if (products.length > 0) {
                savePromises.push(storageService.setItem('bodega_products_v1', products));
            } else {
                savePromises.push(storageService.removeItem('bodega_products_v1'));
            }
            savePromises.push(storageService.setItem('my_categories_v1', categories));
            Promise.all(savePromises).finally(() => {
                // Reset guard after microtask queue flushes
                setTimeout(() => { savingRef.current = false; }, 50);
            });
        }
    }, [products, categories, isLoadingProducts]);

    useEffect(() => {
        if (streetRate > 0) localStorage.setItem('street_rate_bs', streetRate.toString());
    }, [streetRate]);

    useEffect(() => {
        localStorage.setItem('bodega_use_auto_rate', JSON.stringify(useAutoRate));
        if (customRate) localStorage.setItem('bodega_custom_rate', customRate.toString());
    }, [useAutoRate, customRate]);

    // Listener para actualizar si cambia en otra pestaña/componente
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_custom_rate') {
                setCustomRate(e.newValue);
            }
            if (e.key === 'bodega_use_auto_rate') {
                setUseAutoRate(!!JSON.parse(e.newValue));
            }
            if (e.key === 'bodega_products_v1') {
                // If modified in another tab, fetch it
                storageService.getItem('bodega_products_v1', []).then(updatedProducts => setProducts(updatedProducts));
            }
            if (e.key === 'my_categories_v1') {
                storageService.getItem('my_categories_v1', BODEGA_CATEGORIES).then(updatedCategories => setCategories(updatedCategories));
            }
        };

        // Mantener app_storage_update por si algún componente viejo sigue usándolo para sincronizar
        // aunque ahora ProductContext centraliza todo.
        const handleAppStorageUpdate = async (e) => {
            if (savingRef.current) return;

            if (e.detail?.key === 'bodega_products_v1') {
                const updatedProducts = await storageService.getItem('bodega_products_v1', []);
                setProducts(updatedProducts);
            }
            if (e.detail?.key === 'my_categories_v1') {
                const updatedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
                setCategories(updatedCategories);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
        };
    }, []);

    const adjustStock = (productId, delta) => {
        setProducts(prevProducts => prevProducts.map(p => {
            if (p.id === productId) {
                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
                const newStock = (p.stock ?? 0) + delta;
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            }
            return p;
        }));
    };

    return (
        <ProductContext.Provider value={{
            products,
            setProducts,
            categories,
            setCategories,
            isLoadingProducts,
            streetRate,
            setStreetRate,
            useAutoRate,
            setUseAutoRate,
            customRate,
            setCustomRate,
            effectiveRate,
            adjustStock
        }}>
            {children}
        </ProductContext.Provider>
    );
}

export const useProductContext = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error("useProductContext must be used within a ProductProvider");
    }
    return context;
};
