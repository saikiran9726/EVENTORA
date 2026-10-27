/**
 * YouPI-PG Gateway Client Script Loader & Interface
 * Only loaded on demand when mounting checkout.
 */

export interface YouPiPaymentOptions {
  order_id: string;
  amount: number | string; // in rupees (or paise depending on adapter)
  currency: string;
  name?: string;
  description?: string;
  handler?: (response: {
    order_id: string;
    payment_id?: string;
    utr?: string;
    status?: string;
  }) => void;
  onClose?: () => void;
  theme?: {
    color?: string;
  };
}

export interface YouPiGlobal {
  pay: (options: YouPiPaymentOptions) => void;
}

declare global {
  interface Window {
    Youpi?: YouPiGlobal;
  }
}

let scriptLoadPromise: Promise<boolean> | null = null;

/**
 * Loads the youpi.js script dynamically only when checkout needs it.
 * Defaults to the configured YouPI domain or origin from checkoutUrl.
 */
export async function loadYouPiScript(baseUrl?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (window.Youpi) return true;

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  const host =
    baseUrl ||
    import.meta.env.VITE_YOUPI_CHECKOUT_URL ||
    'http://127.0.0.1:7000';

  const scriptUrl = `${host.replace(/\/+$/, '')}/youpi.js`;

  scriptLoadPromise = new Promise((resolve) => {
    // Check if script already in document
    const existing = document.querySelector(`script[src="${scriptUrl}"]`);
    if (existing) {
      if (window.Youpi) return resolve(true);
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.crossOrigin = 'anonymous';

    script.onload = () => {
      resolve(Boolean(window.Youpi));
    };

    script.onerror = () => {
      console.warn('[YouPI Loader] Failed to load external youpi.js script. Falling back to checkout portal.');
      resolve(false);
    };

    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}
