/**
 * API key management
 */

import { apiClient } from './client';

type ApiRecord = Record<string, unknown>;

export interface ManagedApiKeyUsage {
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
}

export interface ManagedApiKeyPricingModel {
  match: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cachedUsdPerMillion?: number;
  reasoningUsdPerMillion?: number;
}

export interface ManagedApiKeyPricing {
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  cachedUsdPerMillion?: number;
  reasoningUsdPerMillion?: number;
  models?: ManagedApiKeyPricingModel[];
}

export interface ManagedApiKeyQuota {
  maxRequests?: number;
  maxTokens?: number;
  maxUsd?: number;
  pricing?: ManagedApiKeyPricing;
}

export type ApiKeyExportScope = 'pending' | 'all';

export interface ManagedApiKeyEntry {
  apiKey: string;
  maxConcurrency?: number;
  quota?: ManagedApiKeyQuota;
  durationDays?: number;
  activatedAt?: string;
  expiresAt?: string;
  pendingActivation: boolean;
  expired: boolean;
  usage: ManagedApiKeyUsage;
  quotaExceeded: boolean;
  pricingConfigured: boolean;
  remainingRequests?: number;
  remainingTokens?: number;
  remainingUsd?: number;
}

export interface ApiKeyMutationEntry {
  apiKey: string;
  maxConcurrency?: number;
  quota?: ManagedApiKeyQuota;
  durationDays?: number;
  activatedAt?: string;
  expiresAt?: string;
}

export interface ApiKeyBatchGenerateRequest {
  count: number;
  exportPrefix?: string;
  displayPrefix?: string;
  prefix?: string;
  maxConcurrency?: number;
  durationDays?: number;
  quota?: ManagedApiKeyQuota;
}

export interface ApiKeyBatchGenerateResponse {
  count: number;
  apiKeys: string[];
  apiKeyEntries: ManagedApiKeyEntry[];
  exportTxt: string;
}

export interface ApiKeyBatchCreateResultItem {
  entry: ApiKeyMutationEntry;
  success: boolean;
  error?: string;
}

export interface ApiKeyBatchCreateResult {
  items: ApiKeyBatchCreateResultItem[];
  successCount: number;
  failedCount: number;
}

const EMPTY_USAGE: ManagedApiKeyUsage = {
  totalRequests: 0,
  totalTokens: 0,
  totalCostUsd: 0,
};

const isRecord = (value: unknown): value is ApiRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const pickValue = (record: ApiRecord, keys: string[]): unknown => {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
};

const readString = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
};

const readNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

const getBatchCreateErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
};

const normalizePricingModel = (raw: unknown): ManagedApiKeyPricingModel | null => {
  const record = isRecord(raw) ? raw : null;
  if (!record) return null;

  const match = readString(pickValue(record, ['match']));
  if (!match) return null;

  return {
    match,
    inputUsdPerMillion: readNumber(
      pickValue(record, ['input-usd-per-million', 'inputUsdPerMillion'])
    ),
    outputUsdPerMillion: readNumber(
      pickValue(record, ['output-usd-per-million', 'outputUsdPerMillion'])
    ),
    cachedUsdPerMillion: readNumber(
      pickValue(record, ['cached-usd-per-million', 'cachedUsdPerMillion'])
    ),
    reasoningUsdPerMillion: readNumber(
      pickValue(record, ['reasoning-usd-per-million', 'reasoningUsdPerMillion'])
    ),
  };
};

const normalizePricing = (raw: unknown): ManagedApiKeyPricing | undefined => {
  const record = isRecord(raw) ? raw : null;
  if (!record) return undefined;

  const modelsRaw = pickValue(record, ['models']);
  const models = Array.isArray(modelsRaw)
    ? modelsRaw
        .map((item) => normalizePricingModel(item))
        .filter((item): item is ManagedApiKeyPricingModel => item !== null)
    : [];

  const pricing: ManagedApiKeyPricing = {
    inputUsdPerMillion: readNumber(
      pickValue(record, ['input-usd-per-million', 'inputUsdPerMillion'])
    ),
    outputUsdPerMillion: readNumber(
      pickValue(record, ['output-usd-per-million', 'outputUsdPerMillion'])
    ),
    cachedUsdPerMillion: readNumber(
      pickValue(record, ['cached-usd-per-million', 'cachedUsdPerMillion'])
    ),
    reasoningUsdPerMillion: readNumber(
      pickValue(record, ['reasoning-usd-per-million', 'reasoningUsdPerMillion'])
    ),
    models: models.length ? models : undefined,
  };

  return pricing.inputUsdPerMillion !== undefined ||
    pricing.outputUsdPerMillion !== undefined ||
    pricing.cachedUsdPerMillion !== undefined ||
    pricing.reasoningUsdPerMillion !== undefined ||
    pricing.models?.length
    ? pricing
    : undefined;
};

const normalizeQuota = (raw: unknown): ManagedApiKeyQuota | undefined => {
  const record = isRecord(raw) ? raw : null;
  if (!record) return undefined;

  const quota: ManagedApiKeyQuota = {
    maxRequests: readNumber(pickValue(record, ['max-requests', 'maxRequests'])),
    maxTokens: readNumber(pickValue(record, ['max-tokens', 'maxTokens'])),
    maxUsd: readNumber(pickValue(record, ['max-usd', 'maxUsd'])),
    pricing: normalizePricing(pickValue(record, ['pricing'])),
  };

  return quota.maxRequests !== undefined ||
    quota.maxTokens !== undefined ||
    quota.maxUsd !== undefined ||
    quota.pricing
    ? quota
    : undefined;
};

const normalizeUsage = (raw: unknown): ManagedApiKeyUsage => {
  const record = isRecord(raw) ? raw : null;
  if (!record) return EMPTY_USAGE;

  return {
    totalRequests: readNumber(pickValue(record, ['total-requests', 'totalRequests'])) ?? 0,
    totalTokens: readNumber(pickValue(record, ['total-tokens', 'totalTokens'])) ?? 0,
    totalCostUsd: readNumber(pickValue(record, ['total-cost-usd', 'totalCostUsd'])) ?? 0,
  };
};

const normalizeEntry = (raw: unknown): ManagedApiKeyEntry | null => {
  if (typeof raw === 'string') {
    const apiKey = raw.trim();
    if (!apiKey) return null;
    return {
      apiKey,
      pendingActivation: false,
      expired: false,
      usage: EMPTY_USAGE,
      quotaExceeded: false,
      pricingConfigured: false,
    };
  }

  const record = isRecord(raw) ? raw : null;
  if (!record) return null;

  const apiKey = readString(pickValue(record, ['api-key', 'apiKey', 'key', 'Key']));
  if (!apiKey) return null;

  const durationDays = readNumber(pickValue(record, ['duration-days', 'durationDays']));

  return {
    apiKey,
    maxConcurrency: (() => {
      const value = readNumber(pickValue(record, ['max-concurrency', 'maxConcurrency']));
      return value !== undefined && value > 0 ? Math.trunc(value) : undefined;
    })(),
    quota: normalizeQuota(pickValue(record, ['quota'])),
    durationDays:
      durationDays !== undefined && durationDays > 0 ? Math.trunc(durationDays) : undefined,
    activatedAt: readString(pickValue(record, ['activated-at', 'activatedAt'])) || undefined,
    expiresAt: readString(pickValue(record, ['expires-at', 'expiresAt', 'expiry'])) || undefined,
    pendingActivation: readBoolean(
      pickValue(record, ['pending-activation', 'pendingActivation']),
      false
    ),
    expired: readBoolean(pickValue(record, ['expired']), false),
    usage: normalizeUsage(pickValue(record, ['usage'])),
    quotaExceeded: readBoolean(pickValue(record, ['quota-exceeded', 'quotaExceeded']), false),
    pricingConfigured: readBoolean(
      pickValue(record, ['pricing-configured', 'pricingConfigured']),
      false
    ),
    remainingRequests: readNumber(pickValue(record, ['remaining-requests', 'remainingRequests'])),
    remainingTokens: readNumber(pickValue(record, ['remaining-tokens', 'remainingTokens'])),
    remainingUsd: readNumber(pickValue(record, ['remaining-usd', 'remainingUsd'])),
  };
};

const normalizeEntriesFromResponse = (raw: unknown): ManagedApiKeyEntry[] => {
  const record = isRecord(raw) ? raw : null;
  const detailedRaw = record
    ? pickValue(record, ['api-key-entries', 'apiKeyEntries', 'items'])
    : undefined;

  if (Array.isArray(detailedRaw) && detailedRaw.length > 0) {
    return detailedRaw
      .map((item) => normalizeEntry(item))
      .filter((item): item is ManagedApiKeyEntry => item !== null);
  }

  const legacyRaw = record ? pickValue(record, ['api-keys', 'apiKeys']) : raw;
  if (!Array.isArray(legacyRaw)) return [];

  return legacyRaw
    .map((item) => normalizeEntry(item))
    .filter((item): item is ManagedApiKeyEntry => item !== null);
};

const serializeQuota = (quota?: ManagedApiKeyQuota): ApiRecord | undefined => {
  if (!quota) return undefined;

  const serialized: ApiRecord = {};
  if ((quota.maxRequests ?? 0) > 0) {
    serialized['max-requests'] = Math.trunc(quota.maxRequests ?? 0);
  }
  if ((quota.maxTokens ?? 0) > 0) {
    serialized['max-tokens'] = Math.trunc(quota.maxTokens ?? 0);
  }
  if ((quota.maxUsd ?? 0) > 0) {
    serialized['max-usd'] = quota.maxUsd;
  }

  return Object.keys(serialized).length ? serialized : undefined;
};

const serializeApiKeyEntry = (entry: ApiKeyMutationEntry): ApiRecord => {
  const apiKey = entry.apiKey.trim();
  const serialized: ApiRecord = {
    'api-key': apiKey,
  };

  if ((entry.maxConcurrency ?? 0) > 0) {
    serialized['max-concurrency'] = Math.trunc(entry.maxConcurrency ?? 0);
  }

  if ((entry.durationDays ?? 0) > 0) {
    serialized['duration-days'] = Math.trunc(entry.durationDays ?? 0);
    if (entry.activatedAt?.trim()) {
      serialized['activated-at'] = entry.activatedAt.trim();
    }
  } else if (entry.expiresAt?.trim()) {
    serialized['expires-at'] = entry.expiresAt.trim();
  }

  const quota = serializeQuota(entry.quota);
  if (quota) {
    serialized.quota = quota;
  }

  return serialized;
};

const normalizeBatchGenerateResponse = (raw: unknown): ApiKeyBatchGenerateResponse => {
  const record = isRecord(raw) ? raw : {};
  const apiKeysRaw = pickValue(record, ['api-keys', 'apiKeys']);
  const apiKeys = Array.isArray(apiKeysRaw)
    ? apiKeysRaw.map((item) => readString(item)).filter(Boolean)
    : [];
  const apiKeyEntries = normalizeEntriesFromResponse(record);

  const normalizedCount = readNumber(pickValue(record, ['count']));

  return {
    count: normalizedCount ?? (apiKeyEntries.length || apiKeys.length),
    apiKeys: apiKeys.length ? apiKeys : apiKeyEntries.map((entry) => entry.apiKey),
    apiKeyEntries,
    exportTxt: readString(pickValue(record, ['export-txt', 'exportTxt'])),
  };
};

export const apiKeysApi = {
  async listDetailed(): Promise<ManagedApiKeyEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    return normalizeEntriesFromResponse(data);
  },

  async list(): Promise<string[]> {
    const entries = await apiKeysApi.listDetailed();
    return entries.map((entry) => entry.apiKey);
  },

  replace: (entries: string[] | ApiKeyMutationEntry[]) => {
    const hasObjectEntry = entries.some((entry) => typeof entry !== 'string');
    if (!hasObjectEntry) {
      return apiClient.put('/api-keys', entries as string[]);
    }

    return apiClient.put('/api-keys', {
      'api-key-entries': (entries as ApiKeyMutationEntry[]).map((entry) =>
        serializeApiKeyEntry(entry)
      ),
    });
  },

  create: (entry: ApiKeyMutationEntry) =>
    apiClient.patch('/api-keys', { value: serializeApiKeyEntry(entry) }),

  async batchGenerate(request: ApiKeyBatchGenerateRequest): Promise<ApiKeyBatchGenerateResponse> {
    const payload: ApiRecord = {
      count: Math.trunc(request.count),
    };

    const exportPrefix = request.exportPrefix?.trim();
    const displayPrefix = request.displayPrefix?.trim();
    const prefix = request.prefix?.trim();
    if (exportPrefix) {
      payload['export-prefix'] = exportPrefix;
    }
    if (displayPrefix) {
      payload['display-prefix'] = displayPrefix;
    }
    if (prefix) {
      payload.prefix = prefix;
    }
    if (request.maxConcurrency !== undefined && request.maxConcurrency >= 0) {
      payload['max-concurrency'] = Math.trunc(request.maxConcurrency);
    }
    if (request.durationDays !== undefined && request.durationDays > 0) {
      payload['duration-days'] = Math.trunc(request.durationDays);
    }

    const quota = serializeQuota(request.quota);
    if (quota) {
      payload.quota = quota;
    }

    const data = await apiClient.post<Record<string, unknown>>('/api-keys/batch-generate', payload);
    return normalizeBatchGenerateResponse(data);
  },

  async createBatch(
    entries: ApiKeyMutationEntry[],
    concurrency = 5
  ): Promise<ApiKeyBatchCreateResult> {
    if (entries.length === 0) {
      return {
        items: [],
        successCount: 0,
        failedCount: 0,
      };
    }

    const normalizedConcurrency = Math.min(
      Math.max(1, Math.trunc(concurrency) || 1),
      entries.length
    );
    const results: ApiKeyBatchCreateResultItem[] = new Array(entries.length);
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= entries.length) return;

        const entry = entries[currentIndex];
        try {
          await apiKeysApi.create(entry);
          results[currentIndex] = {
            entry,
            success: true,
          };
        } catch (error) {
          results[currentIndex] = {
            entry,
            success: false,
            error: getBatchCreateErrorMessage(error),
          };
        }
      }
    };

    await Promise.all(Array.from({ length: normalizedConcurrency }, () => worker()));

    const successCount = results.filter((result) => result?.success).length;
    return {
      items: results,
      successCount,
      failedCount: results.length - successCount,
    };
  },

  update: (index: number, value: string | ApiKeyMutationEntry) =>
    typeof value === 'string'
      ? apiClient.patch('/api-keys', { index, value })
      : apiClient.patch('/api-keys', { index, value: serializeApiKeyEntry(value) }),

  async exportTXT(options?: { exportPrefix?: string; scope?: ApiKeyExportScope }): Promise<string> {
    const params: Record<string, string | boolean> = {};
    if (options?.exportPrefix?.trim()) {
      params['export-prefix'] = options.exportPrefix.trim();
    }
    if (options?.scope) {
      params.scope = options.scope;
      if (options.scope === 'pending') {
        params['only-pending'] = true;
      }
    }

    const response = await apiClient.getRaw('/api-keys/export', {
      params: Object.keys(params).length > 0 ? params : undefined,
      responseType: 'blob',
      headers: {
        Accept: 'text/plain;charset=utf-8, text/plain',
      },
    });

    const data: unknown = response.data;
    if (data instanceof Blob) {
      return data.text();
    }
    if (typeof data === 'string') {
      return data;
    }
    if (data === undefined || data === null) {
      return '';
    }
    return String(data);
  },

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),

  deleteByValue: (apiKey: string) =>
    apiClient.delete(`/api-keys?value=${encodeURIComponent(apiKey.trim())}`),
};
