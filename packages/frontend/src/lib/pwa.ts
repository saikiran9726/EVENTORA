/**
 * Eventora PWA Service Worker Registration & Lifecycle Manager
 */

export interface PWAState {
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  isOffline: boolean;
  registration: ServiceWorkerRegistration | null;
}

type PWAUpdateCallback = (registration: ServiceWorkerRegistration) => void;

let updateCallbacks: PWAUpdateCallback[] = [];

export function onPWAUpdate(callback: PWAUpdateCallback): () => void {
  updateCallbacks.push(callback);
  return () => {
    updateCallbacks = updateCallbacks.filter((cb) => cb !== callback);
  };
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Register only in production or when explicitly enabled
  if (import.meta.env.PROD || process.env.NODE_ENV === 'production') {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Check if an update is already waiting
          if (registration.waiting) {
            updateCallbacks.forEach((cb) => cb(registration));
          }

          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              if (
                installingWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                // New update available
                updateCallbacks.forEach((cb) => cb(registration));
              }
            });
          });
        })
        .catch(() => {
          // Service worker registration ignored in restricted or non-HTTPS dev environments
        });
    });
  }
}

export function activatePWAUpdate(registration: ServiceWorkerRegistration): void {
  if (registration && registration.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
}
