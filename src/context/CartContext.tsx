import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { CartItem } from '../types';
import { useAuth } from './AuthContext';
import { getUserCart, saveUserCart, clearUserCart as deleteUserCartApi } from '../services/api';

interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'qty'>, qty?: number) => void;
  removeItem: (id: string) => void;
  updateQty: (id: string, delta: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalKobo: number;
  totalAmount: number;
  totalFormatted: string;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  syncNow: () => Promise<void>;
}

const CartContext = createContext<CartContextType | null>(null);

const GUEST_STORAGE_KEY = 'aroma_mobile_guest_cart';

export const CartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const activeUserId = user?.id || null;
  const prevUserIdRef = useRef<string | null>(null);
  const lastMutationTimeRef = useRef<number>(0);
  const itemsRef = useRef<CartItem[]>(items);
  itemsRef.current = items;

  // Local storage helper
  const saveToLocalStorage = useCallback(async (cartItems: CartItem[], forUserId: string | null = activeUserId) => {
    try {
      const key = forUserId ? `aroma_cart_${forUserId}` : GUEST_STORAGE_KEY;
      const dataStr = JSON.stringify(cartItems);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        localStorage.setItem(key, dataStr);
      } else {
        await AsyncStorage.setItem(key, dataStr);
      }
    } catch (e) {
      console.warn('Failed to save to local mobile storage', e);
    }
  }, [activeUserId]);

  const loadFromLocalStorage = useCallback(async (forUserId: string | null = activeUserId): Promise<CartItem[]> => {
    try {
      const key = forUserId ? `aroma_cart_${forUserId}` : GUEST_STORAGE_KEY;
      let dataStr: string | null = null;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        dataStr = localStorage.getItem(key);
      } else {
        dataStr = await AsyncStorage.getItem(key);
      }
      if (dataStr) {
        const parsed = JSON.parse(dataStr);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Failed to read from local mobile storage', e);
    }
    return [];
  }, [activeUserId]);

  // Sync to server API
  const pushToServer = useCallback(async (userId: string, cartItems: CartItem[]) => {
    if (!userId) return;
    lastMutationTimeRef.current = Date.now();
    setIsSyncing(true);
    try {
      await saveUserCart(userId, cartItems);
      setLastSyncedAt(new Date());
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Sync from server API
  const pullFromServer = useCallback(async (userId: string) => {
    if (!userId) return;
    // Skip if user recently performed an action locally (debounce race conditions)
    if (Date.now() - lastMutationTimeRef.current < 2500) return;

    try {
      const remoteItems = await getUserCart(userId);
      const current = itemsRef.current;
      const currentKey = JSON.stringify(current.map(i => ({ id: i.id, qty: i.qty })));
      const remoteKey = JSON.stringify(remoteItems.map(i => ({ id: i.id, qty: i.qty })));

      if (currentKey !== remoteKey) {
        setItems(remoteItems);
        saveToLocalStorage(remoteItems, userId);
        setLastSyncedAt(new Date());
      }
    } catch (err) {
      console.warn('Failed pulling cart from server:', err);
    }
  }, [saveToLocalStorage]);

  // Handle auth changes and initialization
  useEffect(() => {
    let mounted = true;
    const prevUserId = prevUserIdRef.current;
    prevUserIdRef.current = activeUserId;

    async function syncCartOnAuthChange() {
      try {
        if (!activeUserId) {
          // GUEST MODE:
          if (prevUserId !== null) {
            // User just logged out — clear current in-memory cart without touching server
            if (mounted) setItems([]);
          } else {
            // App launched as guest — load any existing guest cart
            const guestCart = await loadFromLocalStorage(null);
            if (mounted) setItems(guestCart);
          }
          return;
        }

        // AUTHENTICATED MODE:
        setIsSyncing(true);

        // 1. Check for temporary guest items to merge
        let guestItems: CartItem[] = [];
        const guestCart = await loadFromLocalStorage(null);
        if (guestCart.length > 0) {
          guestItems = guestCart;
        }

        // 2. Load locally cached cart for instant display (no blank screen)
        const cachedUserCart = await loadFromLocalStorage(activeUserId);
        if (cachedUserCart.length > 0 && mounted) {
          setItems(cachedUserCart);
        }

        // 3. Fetch canonical cart from backend (Single Source of Truth)
        const remoteItems = await getUserCart(activeUserId);
        if (!mounted) return;

        let finalItems: CartItem[] = remoteItems.length > 0 ? remoteItems : cachedUserCart;

        if (guestItems.length > 0) {
          // Merge guest cart into customer's account cart
          const map = new Map<string, CartItem>();
          finalItems.forEach(i => map.set(i.id, { ...i }));

          guestItems.forEach(g => {
            if (map.has(g.id)) {
              map.get(g.id)!.qty += g.qty;
            } else {
              map.set(g.id, { ...g });
            }
          });

          finalItems = Array.from(map.values());

          // Clear guest storage after successful merge
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            localStorage.removeItem(GUEST_STORAGE_KEY);
          } else {
            await AsyncStorage.removeItem(GUEST_STORAGE_KEY).catch(() => {});
          }

          // Push merged cart to backend
          await pushToServer(activeUserId, finalItems);
        }

        if (mounted) {
          setItems(finalItems);
          saveToLocalStorage(finalItems, activeUserId);
          setLastSyncedAt(new Date());
        }
      } catch (err) {
        console.warn('Error synchronizing mobile cart on auth change:', err);
      } finally {
        if (mounted) setIsSyncing(false);
      }
    }

    syncCartOnAuthChange();

    return () => {
      mounted = false;
    };
  }, [activeUserId, loadFromLocalStorage, pushToServer, saveToLocalStorage]);

  // Real-time synchronization interval when logged in
  useEffect(() => {
    if (!activeUserId) return;

    const interval = setInterval(() => {
      pullFromServer(activeUserId);
    }, 3000); // Check every 3 seconds for instant bidirectional sync

    return () => clearInterval(interval);
  }, [activeUserId, pullFromServer]);

  // Add Item
  const addItem = useCallback(
    (item: Omit<CartItem, 'qty'>, qty: number = 1) => {
      lastMutationTimeRef.current = Date.now();
      const count = Math.max(1, qty);
      const target: CartItem = {
        id: item.id,
        slug: item.slug || item.id,
        name: item.name,
        price_kobo: item.price_kobo,
        image_url: item.image_url,
        qty: count,
      };

      setItems(prev => {
        const list = Array.isArray(prev) ? prev : [];
        const index = list.findIndex(i => i.id === item.id || (item.slug && i.slug === item.slug));
        let updated: CartItem[];
        if (index > -1) {
          updated = list.map((it, idx) => (idx === index ? { ...it, qty: it.qty + count } : it));
        } else {
          updated = [...list, target];
        }

        saveToLocalStorage(updated, activeUserId);
        if (activeUserId) {
          pushToServer(activeUserId, updated);
        }
        return updated;
      });
    },
    [activeUserId, pushToServer, saveToLocalStorage]
  );

  // Remove Item
  const removeItem = useCallback(
    (id: string) => {
      lastMutationTimeRef.current = Date.now();
      setItems(prev => {
        const list = Array.isArray(prev) ? prev : [];
        const updated = list.filter(i => i.id !== id);
        saveToLocalStorage(updated, activeUserId);
        if (activeUserId) {
          pushToServer(activeUserId, updated);
        }
        return updated;
      });
    },
    [activeUserId, pushToServer, saveToLocalStorage]
  );

  // Update Quantity
  const updateQty = useCallback(
    (id: string, delta: number) => {
      lastMutationTimeRef.current = Date.now();
      setItems(prev => {
        const list = Array.isArray(prev) ? prev : [];
        const updated = list
          .map(i => (i.id === id ? { ...i, qty: i.qty + delta } : i))
          .filter(i => i.qty > 0);

        saveToLocalStorage(updated, activeUserId);
        if (activeUserId) {
          pushToServer(activeUserId, updated);
        }
        return updated;
      });
    },
    [activeUserId, pushToServer, saveToLocalStorage]
  );

  // Clear Cart
  const clearCart = useCallback(async () => {
    lastMutationTimeRef.current = Date.now();
    setItems([]);
    if (activeUserId) {
      deleteUserCartApi(activeUserId).catch(() => {});
      const key = `aroma_cart_${activeUserId}`;
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        localStorage.removeItem(key);
      } else {
        AsyncStorage.removeItem(key).catch(() => {});
      }
    } else {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        localStorage.removeItem(GUEST_STORAGE_KEY);
      } else {
        AsyncStorage.removeItem(GUEST_STORAGE_KEY).catch(() => {});
      }
    }
  }, [activeUserId]);

  const syncNow = useCallback(async () => {
    if (activeUserId) {
      await pullFromServer(activeUserId);
    }
  }, [activeUserId, pullFromServer]);

  const totalItems = items.reduce((sum, i) => sum + (i.qty || 1), 0);
  const totalKobo = items.reduce((sum, i) => sum + (i.price_kobo || 0) * (i.qty || 1), 0);
  const totalFormatted = `₦${(totalKobo / 100).toLocaleString('en-NG')}`;

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQty,
        clearCart,
        totalItems,
        totalKobo,
        totalAmount: totalKobo,
        totalFormatted,
        isSyncing,
        lastSyncedAt,
        syncNow,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
};

