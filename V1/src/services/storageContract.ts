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

export function getStorageConfig(): StorageConfig {
  const provider = import.meta.env.VITE_STORAGE_PROVIDER === 'organization-api'
    ? 'organization-api'
    : 'local';

  return {
    provider,
    apiBaseUrl: import.meta.env.VITE_STORAGE_API_BASE_URL || '/api',
    organizationId: import.meta.env.VITE_ORGANIZATION_ID || 'local-development'
  };
}

export function getSharedStateEndpoint(config = getStorageConfig()): string {
  return `${config.apiBaseUrl.replace(/\/$/, '')}/shared-state`;
}
