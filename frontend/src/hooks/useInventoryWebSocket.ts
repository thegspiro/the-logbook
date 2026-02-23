/**
 * useInventoryWebSocket
 *
 * Connects to the inventory WebSocket endpoint and triggers a callback
 * whenever an inventory change event is received.  Handles auto-reconnect
 * with exponential backoff, JWT auth via query param, and graceful cleanup.
 */

import { useEffect, useRef, useCallback } from 'react';

export interface InventoryEvent {
  type: 'inventory_changed';
  action: string;
  data: Record<string, unknown>;
}

interface UseInventoryWebSocketOptions {
  /** Called when an inventory change event arrives */
  onEvent: (event: InventoryEvent) => void;
  /** Set to false to disable the connection (e.g. when the tab is hidden) */
  enabled?: boolean;
}

export function useInventoryWebSocket({ onEvent, enabled = true }: UseInventoryWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const retriesRef = useRef(0);
  const enabledRef = useRef(enabled);
  const onEventRef = useRef(onEvent);

  // Keep refs in sync without re-triggering the effect
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const connect = useCallback(() => {
    if (!enabledRef.current) return;

    // Get JWT token for auth
    const token = localStorage.getItem('access_token');
    if (!token) return;

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/api/v1/inventory/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0; // Reset backoff on successful connection
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as InventoryEvent;
          if (data.type === 'inventory_changed') {
            onEventRef.current(data);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = (event) => {
        wsRef.current = null;
        // Don't reconnect if intentionally closed (code 1000) or auth failed
        if (event.code === 1000 || event.code === 4001 || event.code === 4003) return;
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after this — reconnect is handled there
      };
    } catch {
      scheduleReconnect();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!enabledRef.current) return;
    const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
    retriesRef.current += 1;
    reconnectTimer.current = setTimeout(() => connect(), delay);
  }, [connect]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.close(1000);
        wsRef.current = null;
      }
    };
  }, [enabled, connect]);
}
