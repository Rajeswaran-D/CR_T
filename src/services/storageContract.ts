export type StorageProvider = 'local' | 'organization-api';

export interface StorageConfig {
  provider: StorageProvider;
  apiBaseUrl: string;
  organizationId: string;
}

export const STORAGE_KEYS = [
  'cft_pos',
  'cft_products',
  'cft_templates',
  'cft_rectifications',
  'cft_audit',
  'cft_config',
  'cft_subdivisions',
  'cft_slot_assignments'
] as const;

export type StorageKey = (typeof STORAGE_KEYS)[number];

/**
 * Validates a backend base URL override.
 * Allowed: relative paths starting with '/' (e.g. '/api') or approved
 * development/corporate domains. Arbitrary third-party domains are rejected
 * to prevent phishing / data exfiltration via crafted URL parameters.
 */
export function isValidBackendBaseUrl(value: string): boolean {
  const v = (value || '').trim();
  if (!v) return false;
  // Relative paths are always safe (same origin)
  if (v.startsWith('/') && !v.startsWith('//')) return true;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

    const host = u.hostname.toLowerCase();
    // Local development loopback
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

    // Same host as current window
    if (typeof window !== 'undefined' && window.location && window.location.hostname.toLowerCase() === host) {
      return true;
    }

    // Approved deployment hosts
    if (
      host === 'circor-tracker-api.onrender.com' ||
      host.endsWith('.onrender.com') ||
      host === 'circor-tracker.vercel.app' ||
      host.endsWith('.vercel.app')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function getStorageConfig(): StorageConfig {
  let apiBaseUrl = '';

  if (typeof window !== 'undefined') {
    // 1. Explicit backend override via URL parameter (documented runtime-switch
    //    workflow, surfaced in the Header's "Backend API" modal). The value is
    //    validated before it is accepted or persisted.
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const queryBackend = searchParams.get('backend') || searchParams.get('api') || searchParams.get('apiUrl');
      if (queryBackend && queryBackend.trim()) {
        const cleanUrl = queryBackend.trim().replace(/\/$/, '');
        if (isValidBackendBaseUrl(cleanUrl)) {
          localStorage.setItem('cft_backend_api_url', cleanUrl);
          apiBaseUrl = cleanUrl;
        } else {
          console.warn(`[storageContract] Ignoring invalid ?backend= override (must be /path or http(s) URL).`);
        }
      }
    } catch {}

    // 2. localStorage override (persists the Header modal's "Apply & Reload").
    if (!apiBaseUrl) {
      try {
        const savedUrl = localStorage.getItem('cft_backend_api_url');
        if (savedUrl && savedUrl.trim()) {
          const clean = savedUrl.trim().replace(/\/$/, '');
          if (isValidBackendBaseUrl(clean)) {
            apiBaseUrl = clean;
          } else {
            console.warn(`[storageContract] Ignoring invalid stored backend URL in localStorage (cft_backend_api_url).`);
          }
        }
      } catch {}
    }

    // 3. Window-level injected config (deployment integration hook).
    if (!apiBaseUrl) {
      const win = window as any;
      const windowEnv = win.__CFT_BACKEND_URL__ || win.ENV?.VITE_STORAGE_API_BASE_URL;
      if (typeof windowEnv === 'string' && windowEnv.trim()) {
        const clean = windowEnv.trim().replace(/\/$/, '');
        if (isValidBackendBaseUrl(clean)) {
          apiBaseUrl = clean;
        }
      }
    }
  }

  // 4. Vite build-time environment variable (VITE_* values are public — never
  //    put server credentials in them).
  if (!apiBaseUrl && import.meta.env.VITE_STORAGE_API_BASE_URL) {
    const clean = String(import.meta.env.VITE_STORAGE_API_BASE_URL).trim().replace(/\/$/, '');
    if (isValidBackendBaseUrl(clean)) {
      apiBaseUrl = clean;
    }
  }

  // 5. Default to relative /api: in dev the Vite proxy forwards it to the
  //    local Express backend (localhost:5000); on Vercel the vercel.json
  //    rewrite forwards it to the Render API.
  if (!apiBaseUrl) {
    apiBaseUrl = '/api';
  }

  // Provider label: 'local' = local development (.env), 'organization-api' =
  // deployed frontend (.env.production). Both send the same /api requests —
  // routing is decided by apiBaseUrl (Vite proxy vs Vercel rewrite), not by
  // browser storage. localStorage is only an offline cache; it never fakes a
  // successful server write.
  const provider: StorageProvider = import.meta.env.VITE_STORAGE_PROVIDER === 'organization-api'
    ? 'organization-api'
    : 'local';

  const organizationId = import.meta.env.VITE_ORGANIZATION_ID || 'circor-flow-technologies';

  return {
    provider,
    apiBaseUrl,
    organizationId
  };
}

export function setCustomBackendUrl(url: string): void {
  if (typeof window !== 'undefined') {
    const clean = (url || '').trim().replace(/\/$/, '');
    if (clean) {
      localStorage.setItem('cft_backend_api_url', clean);
    } else {
      localStorage.removeItem('cft_backend_api_url');
    }
  }
}

export function getSharedStateEndpoint(config = getStorageConfig()): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/shared-state`;
}
