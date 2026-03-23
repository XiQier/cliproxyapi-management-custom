import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { IconChartLine, IconCheck, IconDollarSign, IconKey, IconTimer } from '@/components/ui/icons';
import { apiKeysApi, type ApiKeyMutationEntry, type ManagedApiKeyEntry } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { formatDateTime, formatNumber, maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

type ApiKeyPricingModelDraft = {
  id: string;
  match: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cachedUsdPerMillion: string;
  reasoningUsdPerMillion: string;
};

type ApiKeyPricingDraft = {
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cachedUsdPerMillion: string;
  reasoningUsdPerMillion: string;
  models: ApiKeyPricingModelDraft[];
};

type ApiKeyQuotaDraft = {
  maxRequests: string;
  maxTokens: string;
  maxUsd: string;
  pricing: ApiKeyPricingDraft;
};

type ApiKeyEditorDraft = {
  apiKey: string;
  durationDays: string;
  activatedAt: string;
  expiresAt: string;
  quota: ApiKeyQuotaDraft;
};

const makeDraftId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

const createEmptyPricingModelDraft = (): ApiKeyPricingModelDraft => ({
  id: makeDraftId(),
  match: '',
  inputUsdPerMillion: '',
  outputUsdPerMillion: '',
  cachedUsdPerMillion: '',
  reasoningUsdPerMillion: '',
});

const createEmptyQuotaDraft = (): ApiKeyQuotaDraft => ({
  maxRequests: '',
  maxTokens: '',
  maxUsd: '',
  pricing: {
    inputUsdPerMillion: '',
    outputUsdPerMillion: '',
    cachedUsdPerMillion: '',
    reasoningUsdPerMillion: '',
    models: [],
  },
});

const createEmptyDraft = (): ApiKeyEditorDraft => ({
  apiKey: '',
  durationDays: '1',
  activatedAt: '',
  expiresAt: '',
  quota: createEmptyQuotaDraft(),
});

const isPositiveIntegerOrBlank = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' || /^[1-9]\d*$/.test(trimmed);
};

const isNonNegativeInteger = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' || /^\d+$/.test(trimmed);
};

const isNonNegativeNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
};

const parseTimestamp = (value: string): Date | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getDraftEffectiveExpiry = (draft: ApiKeyEditorDraft): Date | null => {
  const duration = draft.durationDays.trim();
  if (!/^[1-9]\d*$/.test(duration)) return null;
  const activatedAt = parseTimestamp(draft.activatedAt);
  if (!activatedAt) return null;
  return new Date(activatedAt.getTime() + Number(duration) * 24 * 60 * 60 * 1000);
};

const parsePositiveNumberField = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const parseNonNegativeNumberField = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
};

const hasAnyModelPrice = (rule: ApiKeyPricingModelDraft) =>
  Boolean(
    rule.inputUsdPerMillion.trim() ||
      rule.outputUsdPerMillion.trim() ||
      rule.cachedUsdPerMillion.trim() ||
      rule.reasoningUsdPerMillion.trim()
  );

const hasModelPricingValue = (rule: ApiKeyPricingModelDraft) =>
  Boolean(rule.match.trim() || hasAnyModelPrice(rule));

const hasAnyPricing = (quota: ApiKeyQuotaDraft) =>
  Boolean(
    quota.pricing.inputUsdPerMillion.trim() ||
      quota.pricing.outputUsdPerMillion.trim() ||
      quota.pricing.cachedUsdPerMillion.trim() ||
      quota.pricing.reasoningUsdPerMillion.trim() ||
      quota.pricing.models.some((rule) => hasModelPricingValue(rule))
  );

const buildDraftFromEntry = (entry: ManagedApiKeyEntry): ApiKeyEditorDraft => ({
  apiKey: entry.apiKey,
  durationDays: entry.durationDays ? String(entry.durationDays) : '',
  activatedAt: entry.activatedAt ?? '',
  expiresAt: entry.expiresAt ?? '',
  quota: {
    maxRequests: entry.quota?.maxRequests !== undefined ? String(entry.quota.maxRequests) : '',
    maxTokens: entry.quota?.maxTokens !== undefined ? String(entry.quota.maxTokens) : '',
    maxUsd: entry.quota?.maxUsd !== undefined ? String(entry.quota.maxUsd) : '',
    pricing: {
      inputUsdPerMillion:
        entry.quota?.pricing?.inputUsdPerMillion !== undefined
          ? String(entry.quota.pricing.inputUsdPerMillion)
          : '',
      outputUsdPerMillion:
        entry.quota?.pricing?.outputUsdPerMillion !== undefined
          ? String(entry.quota.pricing.outputUsdPerMillion)
          : '',
      cachedUsdPerMillion:
        entry.quota?.pricing?.cachedUsdPerMillion !== undefined
          ? String(entry.quota.pricing.cachedUsdPerMillion)
          : '',
      reasoningUsdPerMillion:
        entry.quota?.pricing?.reasoningUsdPerMillion !== undefined
          ? String(entry.quota.pricing.reasoningUsdPerMillion)
          : '',
      models:
        entry.quota?.pricing?.models?.map((rule) => ({
          id: makeDraftId(),
          match: rule.match,
          inputUsdPerMillion:
            rule.inputUsdPerMillion !== undefined ? String(rule.inputUsdPerMillion) : '',
          outputUsdPerMillion:
            rule.outputUsdPerMillion !== undefined ? String(rule.outputUsdPerMillion) : '',
          cachedUsdPerMillion:
            rule.cachedUsdPerMillion !== undefined ? String(rule.cachedUsdPerMillion) : '',
          reasoningUsdPerMillion:
            rule.reasoningUsdPerMillion !== undefined ? String(rule.reasoningUsdPerMillion) : '',
        })) ?? [],
    },
  },
});

const generateSecureApiKey = (): string => {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(17);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(array);
    return 'sk-' + Array.from(array, (value) => charset[value % charset.length]).join('');
  }
  return 'sk-' + Array.from({ length: 17 }, () => charset[Math.floor(Math.random() * charset.length)]).join('');
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
};

const hasQuotaConfig = (entry: ManagedApiKeyEntry): boolean =>
  (entry.quota?.maxRequests ?? 0) > 0 ||
  (entry.quota?.maxTokens ?? 0) > 0 ||
  (entry.quota?.maxUsd ?? 0) > 0 ||
  Boolean(entry.pricingConfigured);

export function ApiKeysPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [entries, setEntries] = useState<ManagedApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ApiKeyEditorDraft>(createEmptyDraft);
  const [formError, setFormError] = useState('');

  const loadEntries = async () => {
    if (connectionStatus !== 'connected') {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const nextEntries = await apiKeysApi.listDetailed();
      setEntries(nextEntries);
    } catch (loadError: unknown) {
      setError(
        getErrorMessage(loadError) ||
          t('api_keys.load_failed', { defaultValue: 'Failed to load API keys' })
      );
    } finally {
      setLoading(false);
    }
  };

  useHeaderRefresh(loadEntries);

  useEffect(() => {
    void loadEntries();
  }, [connectionStatus]);

  const summary = useMemo(
    () => ({
      total: entries.length,
      pending: entries.filter((entry) => entry.pendingActivation).length,
      active: entries.filter((entry) => !entry.pendingActivation && !entry.expired).length,
      expired: entries.filter((entry) => entry.expired).length,
    }),
    [entries]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('api_keys.title')}</span>
      <span className={styles.countBadge}>{entries.length}</span>
    </div>
  );

  const statusLabel = (entry: ManagedApiKeyEntry) => {
    if (entry.expired) {
      return { tone: styles.stateExpired, text: t('api_keys.status_expired', { defaultValue: 'Expired' }) };
    }
    if (entry.pendingActivation) {
      return {
        tone: styles.statePending,
        text: t('api_keys.status_pending', { defaultValue: 'Pending Activation' }),
      };
    }
    return { tone: styles.stateActive, text: t('api_keys.status_active', { defaultValue: 'Activated' }) };
  };

  const formatStatusDate = (value?: string) =>
    value ? formatDateTime(value, i18n.language) : t('common.not_set');

  const formatUsd = (value?: number) =>
    `$ ${(value ?? 0).toLocaleString(i18n.language, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}`;

  const draftEffectiveExpiry = getDraftEffectiveExpiry(draft);

  const resetEditor = () => {
    setEditingIndex(null);
    setDraft(createEmptyDraft());
    setFormError('');
    setModalOpen(false);
  };

  const openCreateModal = () => {
    setEditingIndex(null);
    setDraft(createEmptyDraft());
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    setEditingIndex(index);
    setDraft(buildDraftFromEntry(entry));
    setFormError('');
    setModalOpen(true);
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(t(copied ? 'notification.link_copied' : 'notification.copy_failed'), copied ? 'success' : 'error');
  };

  const handleDelete = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    showConfirmation({
      title: t('api_keys.title'),
      message: t('api_keys.delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await apiKeysApi.delete(index);
          showNotification(t('notification.api_key_deleted'), 'success');
          await loadEntries();
        } catch (deleteError: unknown) {
          const message = getErrorMessage(deleteError);
          showNotification(`${t('notification.delete_failed')}${message ? `: ${message}` : ''}`, 'error');
        }
      },
    });
  };

  const updateDraft = (patch: Partial<ApiKeyEditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFormError('');
  };

  const updateDraftQuota = (patch: Partial<ApiKeyQuotaDraft>) => {
    setDraft((current) => ({ ...current, quota: { ...current.quota, ...patch } }));
    setFormError('');
  };

  const updateDraftPricing = (patch: Partial<ApiKeyPricingDraft>) => {
    setDraft((current) => ({
      ...current,
      quota: { ...current.quota, pricing: { ...current.quota.pricing, ...patch } },
    }));
    setFormError('');
  };

  const updateModelRule = (ruleId: string, patch: Partial<ApiKeyPricingModelDraft>) => {
    setDraft((current) => ({
      ...current,
      quota: {
        ...current.quota,
        pricing: {
          ...current.quota.pricing,
          models: current.quota.pricing.models.map((rule) =>
            rule.id === ruleId ? { ...rule, ...patch } : rule
          ),
        },
      },
    }));
    setFormError('');
  };

  const addModelRule = () => {
    updateDraftPricing({ models: [...draft.quota.pricing.models, createEmptyPricingModelDraft()] });
  };

  const removeModelRule = (ruleId: string) => {
    updateDraftPricing({ models: draft.quota.pricing.models.filter((rule) => rule.id !== ruleId) });
  };

  const handleSave = async () => {
    const trimmedKey = draft.apiKey.trim();
    const trimmedDuration = draft.durationDays.trim();

    if (!trimmedKey) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(trimmedKey)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }
    if (!isPositiveIntegerOrBlank(trimmedDuration)) {
      setFormError(
        t('config_management.visual.api_keys.error_duration', {
          defaultValue: 'Validity days must be a positive whole number',
        })
      );
      return;
    }
    if (!isNonNegativeInteger(draft.quota.maxRequests) || !isNonNegativeInteger(draft.quota.maxTokens)) {
      setFormError(
        t('config_management.visual.api_keys.error_integer', {
          defaultValue: 'Request, token, and count fields must be non-negative whole numbers',
        })
      );
      return;
    }
    if (
      !isNonNegativeNumber(draft.quota.maxUsd) ||
      !isNonNegativeNumber(draft.quota.pricing.inputUsdPerMillion) ||
      !isNonNegativeNumber(draft.quota.pricing.outputUsdPerMillion) ||
      !isNonNegativeNumber(draft.quota.pricing.cachedUsdPerMillion) ||
      !isNonNegativeNumber(draft.quota.pricing.reasoningUsdPerMillion) ||
      draft.quota.pricing.models.some(
        (rule) =>
          !isNonNegativeNumber(rule.inputUsdPerMillion) ||
          !isNonNegativeNumber(rule.outputUsdPerMillion) ||
          !isNonNegativeNumber(rule.cachedUsdPerMillion) ||
          !isNonNegativeNumber(rule.reasoningUsdPerMillion)
      )
    ) {
      setFormError(
        t('config_management.visual.api_keys.error_number', {
          defaultValue: 'Budget and pricing fields must be non-negative numbers',
        })
      );
      return;
    }

    const filteredRules = draft.quota.pricing.models.filter((rule) => hasModelPricingValue(rule));
    for (const rule of filteredRules) {
      if (!rule.match.trim()) {
        setFormError(
          t('config_management.visual.api_keys.model_price_model_required', {
            defaultValue: 'Please enter a model match pattern for each pricing rule',
          })
        );
        return;
      }
      if (!hasAnyModelPrice(rule)) {
        setFormError(
          t('config_management.visual.api_keys.model_price_value_required', {
            defaultValue: 'Each model pricing rule needs at least one price',
          })
        );
        return;
      }
    }

    if (draft.quota.maxUsd.trim() && !hasAnyPricing(draft.quota)) {
      setFormError(
        t('config_management.visual.api_keys.usd_budget_pricing_required', {
          defaultValue: 'Set at least one default price or model price when USD budget is enabled',
        })
      );
      return;
    }

    const pricingModels = filteredRules.reduce<
      NonNullable<NonNullable<NonNullable<ApiKeyMutationEntry['quota']>['pricing']>['models']>
    >((acc, rule) => {
        const match = rule.match.trim();
        const inputUsdPerMillion = parseNonNegativeNumberField(rule.inputUsdPerMillion);
        const outputUsdPerMillion = parseNonNegativeNumberField(rule.outputUsdPerMillion);
        const cachedUsdPerMillion = parseNonNegativeNumberField(rule.cachedUsdPerMillion);
        const reasoningUsdPerMillion = parseNonNegativeNumberField(rule.reasoningUsdPerMillion);
        if (
          !match ||
          (inputUsdPerMillion === undefined &&
            outputUsdPerMillion === undefined &&
            cachedUsdPerMillion === undefined &&
            reasoningUsdPerMillion === undefined)
        ) {
          return acc;
        }
        acc.push({
          match,
          inputUsdPerMillion,
          outputUsdPerMillion,
          cachedUsdPerMillion,
          reasoningUsdPerMillion,
        });
        return acc;
      }, []);

    const defaultPricing = {
      inputUsdPerMillion: parseNonNegativeNumberField(draft.quota.pricing.inputUsdPerMillion),
      outputUsdPerMillion: parseNonNegativeNumberField(draft.quota.pricing.outputUsdPerMillion),
      cachedUsdPerMillion: parseNonNegativeNumberField(draft.quota.pricing.cachedUsdPerMillion),
      reasoningUsdPerMillion: parseNonNegativeNumberField(draft.quota.pricing.reasoningUsdPerMillion),
      models: pricingModels.length ? pricingModels : undefined,
    };

    const quota: ApiKeyMutationEntry['quota'] =
      parsePositiveNumberField(draft.quota.maxRequests) !== undefined ||
      parsePositiveNumberField(draft.quota.maxTokens) !== undefined ||
      parsePositiveNumberField(draft.quota.maxUsd) !== undefined ||
      defaultPricing.inputUsdPerMillion !== undefined ||
      defaultPricing.outputUsdPerMillion !== undefined ||
      defaultPricing.cachedUsdPerMillion !== undefined ||
      defaultPricing.reasoningUsdPerMillion !== undefined ||
      defaultPricing.models?.length
        ? {
            maxRequests: parsePositiveNumberField(draft.quota.maxRequests),
            maxTokens: parsePositiveNumberField(draft.quota.maxTokens),
            maxUsd: parsePositiveNumberField(draft.quota.maxUsd),
            pricing:
              defaultPricing.inputUsdPerMillion !== undefined ||
              defaultPricing.outputUsdPerMillion !== undefined ||
              defaultPricing.cachedUsdPerMillion !== undefined ||
              defaultPricing.reasoningUsdPerMillion !== undefined ||
              defaultPricing.models?.length
                ? defaultPricing
                : undefined,
          }
        : undefined;

    const currentEntry = editingIndex !== null ? entries[editingIndex] : null;
    const durationDays = trimmedDuration ? Number(trimmedDuration) : undefined;
    const payload: ApiKeyMutationEntry = {
      apiKey: trimmedKey,
      durationDays,
      activatedAt: durationDays && currentEntry && currentEntry.apiKey === trimmedKey ? draft.activatedAt.trim() || undefined : undefined,
      expiresAt: durationDays && durationDays > 0 ? undefined : draft.expiresAt.trim() || undefined,
      quota,
    };

    setSaving(true);
    setFormError('');

    try {
      if (editingIndex === null) {
        await apiKeysApi.create(payload);
        showNotification(t('notification.api_key_added'), 'success');
      } else {
        await apiKeysApi.update(editingIndex, payload);
        showNotification(t('notification.api_key_updated'), 'success');
      }
      await loadEntries();
      resetEditor();
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError);
      setFormError(message || t('common.unknown_error'));
      showNotification(`${editingIndex === null ? t('common.add') : t('common.update')}${message ? `: ${message}` : ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const summaryCards = [
    { key: 'total', label: t('api_keys.stats_total', { defaultValue: 'Total Keys' }), value: summary.total, icon: <IconKey size={18} />, tone: styles.summaryCardTotal },
    { key: 'pending', label: t('api_keys.stats_pending', { defaultValue: 'Pending Activation' }), value: summary.pending, icon: <IconTimer size={18} />, tone: styles.summaryCardPending },
    { key: 'active', label: t('api_keys.stats_active', { defaultValue: 'Activated' }), value: summary.active, icon: <IconCheck size={18} />, tone: styles.summaryCardActive },
    { key: 'expired', label: t('api_keys.stats_expired', { defaultValue: 'Expired' }), value: summary.expired, icon: <IconChartLine size={18} />, tone: styles.summaryCardExpired },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('api_keys.title')}</h1>
        <p className={styles.description}>
          {t('api_keys.description', {
            defaultValue:
              'Directly manage /api-keys entries. Validity starts from the first successful request.',
          })}
        </p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadEntries()}
              loading={loading}
            >
              {t('common.refresh')}
            </Button>
            <Button
              size="sm"
              onClick={openCreateModal}
              disabled={connectionStatus !== 'connected'}
            >
              {t('api_keys.add_button')}
            </Button>
          </div>
        }
      >
        <div className={styles.summaryGrid}>
          {summaryCards.map((item) => (
            <div key={item.key} className={`${styles.summaryCard} ${item.tone}`}>
              <div className={styles.summaryIcon}>{item.icon}</div>
              <div className={styles.summaryContent}>
                <div className={styles.summaryLabel}>{item.label}</div>
                <div className={styles.summaryValue}>
                  {formatNumber(item.value, i18n.language)}
                </div>
              </div>
            </div>
          ))}
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}

        {loading && entries.length === 0 ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : entries.length === 0 ? (
          <EmptyState
            title={t('api_keys.empty_title')}
            description={t('api_keys.empty_desc')}
            action={
              <Button onClick={openCreateModal} disabled={connectionStatus !== 'connected'}>
                {t('api_keys.add_button')}
              </Button>
            }
          />
        ) : (
          <div className={styles.cardGrid}>
            {entries.map((entry, index) => {
              const status = statusLabel(entry);
              const validityLabel = entry.durationDays
                ? t('config_management.visual.api_keys.summary_duration', {
                    defaultValue: '{{count}} day validity',
                    count: entry.durationDays,
                  })
                : t('common.not_set');
              const activatedAtLabel = entry.pendingActivation
                ? t('config_management.visual.api_keys.summary_starts_on_first_request', {
                    defaultValue: 'Starts on first request',
                  })
                : formatStatusDate(entry.activatedAt);

              const limitChips: string[] = [];
              if ((entry.quota?.maxRequests ?? 0) > 0) {
                limitChips.push(
                  t('api_keys.card_limit_requests', {
                    defaultValue: 'Limit {{count}} requests',
                    count: entry.quota?.maxRequests ?? 0,
                  })
                );
              }
              if ((entry.quota?.maxTokens ?? 0) > 0) {
                limitChips.push(
                  t('api_keys.card_limit_tokens', {
                    defaultValue: 'Limit {{count}} tokens',
                    count: entry.quota?.maxTokens ?? 0,
                  })
                );
              }
              if ((entry.quota?.maxUsd ?? 0) > 0) {
                limitChips.push(
                  t('api_keys.card_limit_budget', {
                    defaultValue: 'Limit $ {{amount}}',
                    amount:
                      entry.quota?.maxUsd?.toLocaleString(i18n.language, {
                        maximumFractionDigits: 6,
                      }) ?? '0',
                  })
                );
              }
              if (entry.remainingRequests !== undefined) {
                limitChips.push(
                  t('api_keys.card_requests_remaining', {
                    defaultValue: '{{count}} requests left',
                    count: entry.remainingRequests,
                  })
                );
              }
              if (entry.remainingTokens !== undefined) {
                limitChips.push(
                  t('api_keys.card_tokens_remaining', {
                    defaultValue: '{{count}} tokens left',
                    count: entry.remainingTokens,
                  })
                );
              }
              if (entry.remainingUsd !== undefined) {
                limitChips.push(
                  t('api_keys.card_usd_remaining', {
                    defaultValue: '$ {{amount}} left',
                    amount: entry.remainingUsd.toLocaleString(i18n.language, {
                      maximumFractionDigits: 6,
                    }),
                  })
                );
              }
              if (entry.quota?.pricing?.models?.length) {
                limitChips.push(
                  t('config_management.visual.api_keys.summary_model_prices', {
                    defaultValue: '{{count}} model prices',
                    count: entry.quota.pricing.models.length,
                  })
                );
              } else if (entry.pricingConfigured) {
                limitChips.push(
                  t('config_management.visual.api_keys.summary_default_price', {
                    defaultValue: 'Default pricing',
                  })
                );
              }
              if (limitChips.length === 0) {
                limitChips.push(
                  t('api_keys.card_no_limits', {
                    defaultValue: 'No quota limits',
                  })
                );
              }

              return (
                <article
                  key={`${entry.apiKey}-${index}`}
                  className={`${styles.apiKeyCard} ${status.tone}`}
                >
                  <div className={styles.cardTop}>
                    <div className={styles.cardLead}>
                      <div className={styles.cardIcon}>
                        <IconKey size={18} />
                      </div>
                      <div>
                        <div className={styles.cardEyebrow}>API Key #{index + 1}</div>
                        <div className={styles.cardTitle}>{maskApiKey(entry.apiKey)}</div>
                      </div>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={`${styles.statePill} ${status.tone}`}>{status.text}</span>
                      {entry.quotaExceeded && (
                        <span className={`${styles.statePill} ${styles.stateQuota}`}>
                          {t('api_keys.status_quota_exceeded', {
                            defaultValue: 'Quota Exhausted',
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.detailsGrid}>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>
                        {t('api_keys.card_validity', { defaultValue: 'Validity' })}
                      </div>
                      <div className={styles.detailValue}>{validityLabel}</div>
                    </div>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>
                        {t('api_keys.card_activated_at', { defaultValue: 'Activated At' })}
                      </div>
                      <div className={styles.detailValue}>{activatedAtLabel}</div>
                    </div>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>
                        {t('api_keys.card_expires_at', { defaultValue: 'Expires At' })}
                      </div>
                      <div className={styles.detailValue}>
                        {formatStatusDate(entry.expiresAt)}
                      </div>
                    </div>
                  </div>

                  <div className={styles.metricsGrid}>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>
                        {t('api_keys.card_requests_used', { defaultValue: 'Requests Used' })}
                      </div>
                      <div className={styles.metricValue}>
                        {formatNumber(entry.usage.totalRequests, i18n.language)}
                      </div>
                    </div>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>
                        {t('api_keys.card_tokens_used', { defaultValue: 'Tokens Used' })}
                      </div>
                      <div className={styles.metricValue}>
                        {formatNumber(entry.usage.totalTokens, i18n.language)}
                      </div>
                    </div>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>
                        {t('api_keys.card_usd_used', { defaultValue: 'USD Used' })}
                      </div>
                      <div className={styles.metricValue}>
                        <IconDollarSign size={14} />
                        <span>{formatUsd(entry.usage.totalCostUsd)}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.chipRow}>
                    {limitChips.map((chip) => (
                      <span
                        key={`${entry.apiKey}-${chip}`}
                        className={`${styles.infoChip} ${
                          hasQuotaConfig(entry) ? styles.infoChipAccent : styles.infoChipMuted
                        }`}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>

                  <div className={styles.cardActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCopy(entry.apiKey)}
                    >
                      {t('common.copy')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEditModal(index)}
                      disabled={connectionStatus !== 'connected'}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(index)}
                      disabled={connectionStatus !== 'connected'}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={resetEditor}
        closeDisabled={saving}
        title={
          editingIndex === null ? t('api_keys.add_modal_title') : t('api_keys.edit_modal_title')
        }
        width={900}
        footer={
          <>
            <Button variant="secondary" onClick={resetEditor} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              {editingIndex === null ? t('common.add') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.apiKeyInputGroup}>
            <Input
              label={t('api_keys.add_modal_key_label')}
              value={draft.apiKey}
              onChange={(event) => updateDraft({ apiKey: event.currentTarget.value })}
              placeholder={t('api_keys.add_modal_key_placeholder')}
              disabled={saving}
            />
            <div className={styles.generateBox}>
              <div className={styles.generateLabel}>
                {t('config_management.visual.api_keys.generate')}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => updateDraft({ apiKey: generateSecureApiKey() })}
                disabled={saving}
              >
                {t('config_management.visual.api_keys.generate')}
              </Button>
            </div>
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  {t('config_management.visual.api_keys.validity_days', {
                    defaultValue: 'Validity Days',
                  })}
                </div>
                <div className={styles.sectionHint}>
                  {t('config_management.visual.api_keys.validity_days_hint', {
                    defaultValue:
                      'Default is 1 day. Countdown starts on the first successful request.',
                  })}
                </div>
              </div>
            </div>

            <div className={styles.validityGrid}>
              <Input
                label={t('config_management.visual.api_keys.validity_days', {
                  defaultValue: 'Validity Days',
                })}
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="1"
                value={draft.durationDays}
                onChange={(event) => updateDraft({ durationDays: event.currentTarget.value })}
                disabled={saving}
              />

              <div className={styles.quickActionGroup}>
                <div className={styles.generateLabel}>
                  {t('api_keys.card_validity', { defaultValue: 'Validity' })}
                </div>
                <div className={styles.quickButtons}>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => updateDraft({ durationDays: '1' })}
                    disabled={saving}
                  >
                    {t('config_management.visual.api_keys.quick_1', { defaultValue: '1 Day' })}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => updateDraft({ durationDays: '7' })}
                    disabled={saving}
                  >
                    {t('config_management.visual.api_keys.quick_7', { defaultValue: '7 Days' })}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => updateDraft({ durationDays: '30' })}
                    disabled={saving}
                  >
                    {t('config_management.visual.api_keys.quick_30', { defaultValue: '30 Days' })}
                  </Button>
                </div>
              </div>
            </div>

            <div className={styles.modalStatusGrid}>
              <div className={styles.modalStatusItem}>
                <div className={styles.detailLabel}>
                  {t('api_keys.card_activated_at', { defaultValue: 'Activated At' })}
                </div>
                <div className={styles.detailValue}>
                  {draft.activatedAt
                    ? formatDateTime(draft.activatedAt, i18n.language)
                    : t('config_management.visual.api_keys.summary_starts_on_first_request', {
                        defaultValue: 'Starts on first request',
                      })}
                </div>
              </div>
              <div className={styles.modalStatusItem}>
                <div className={styles.detailLabel}>
                  {t('api_keys.card_expires_at', { defaultValue: 'Expires At' })}
                </div>
                <div className={styles.detailValue}>
                  {draft.durationDays.trim()
                    ? draftEffectiveExpiry
                      ? formatDateTime(draftEffectiveExpiry, i18n.language)
                      : t('config_management.visual.api_keys.summary_starts_on_first_request', {
                          defaultValue: 'Starts on first request',
                        })
                    : draft.expiresAt
                      ? formatDateTime(draft.expiresAt, i18n.language)
                      : t('common.not_set')}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  {t('api_keys.quota_section_title', { defaultValue: 'Quota Limits' })}
                </div>
                <div className={styles.sectionHint}>
                  {t('api_keys.quota_preserved_hint', {
                    defaultValue:
                      'Quota and pricing can be edited here directly. If you enable USD budget, also configure default pricing or model pricing.',
                  })}
                </div>
              </div>
            </div>

            <div className={styles.fieldsGrid}>
              <Input
                label={t('config_management.visual.api_keys.max_requests', {
                  defaultValue: 'Max Requests',
                })}
                type="number"
                inputMode="numeric"
                placeholder="1000"
                value={draft.quota.maxRequests}
                onChange={(event) =>
                  updateDraftQuota({ maxRequests: event.currentTarget.value })
                }
                disabled={saving}
                hint={t('config_management.visual.api_keys.max_requests_hint', {
                  defaultValue: 'Leave empty for unlimited requests',
                })}
              />
              <Input
                label={t('config_management.visual.api_keys.max_tokens', {
                  defaultValue: 'Max Tokens',
                })}
                type="number"
                inputMode="numeric"
                placeholder="500000"
                value={draft.quota.maxTokens}
                onChange={(event) => updateDraftQuota({ maxTokens: event.currentTarget.value })}
                disabled={saving}
                hint={t('config_management.visual.api_keys.max_tokens_hint', {
                  defaultValue: 'Leave empty for unlimited tokens',
                })}
              />
              <Input
                label={t('config_management.visual.api_keys.max_usd', {
                  defaultValue: 'USD Budget Limit',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="5"
                value={draft.quota.maxUsd}
                onChange={(event) => updateDraftQuota({ maxUsd: event.currentTarget.value })}
                disabled={saving}
                hint={t('config_management.visual.api_keys.max_usd_hint', {
                  defaultValue: 'Leave empty for no dollar budget limit',
                })}
              />
            </div>
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  {t('config_management.visual.api_keys.default_pricing', {
                    defaultValue: 'Default Pricing',
                  })}
                </div>
                <div className={styles.sectionHint}>
                  {t('config_management.visual.api_keys.default_pricing_hint', {
                    defaultValue:
                      'Fallback prices in USD per 1M tokens when no model rule matches',
                  })}
                </div>
              </div>
            </div>

            <div className={styles.fieldsGrid}>
              <Input
                label={t('config_management.visual.api_keys.price_input', {
                  defaultValue: 'Input Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="1.25"
                value={draft.quota.pricing.inputUsdPerMillion}
                onChange={(event) =>
                  updateDraftPricing({ inputUsdPerMillion: event.currentTarget.value })
                }
                disabled={saving}
              />
              <Input
                label={t('config_management.visual.api_keys.price_output', {
                  defaultValue: 'Output Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="10"
                value={draft.quota.pricing.outputUsdPerMillion}
                onChange={(event) =>
                  updateDraftPricing({ outputUsdPerMillion: event.currentTarget.value })
                }
                disabled={saving}
              />
              <Input
                label={t('config_management.visual.api_keys.price_cached', {
                  defaultValue: 'Cached Input Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="0.125"
                value={draft.quota.pricing.cachedUsdPerMillion}
                onChange={(event) =>
                  updateDraftPricing({ cachedUsdPerMillion: event.currentTarget.value })
                }
                disabled={saving}
              />
              <Input
                label={t('config_management.visual.api_keys.price_reasoning', {
                  defaultValue: 'Reasoning Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="0"
                value={draft.quota.pricing.reasoningUsdPerMillion}
                onChange={(event) =>
                  updateDraftPricing({ reasoningUsdPerMillion: event.currentTarget.value })
                }
                disabled={saving}
              />
            </div>
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>
                  {t('config_management.visual.api_keys.model_pricing', {
                    defaultValue: 'Model Pricing Rules',
                  })}
                </div>
                <div className={styles.sectionHint}>
                  {t('config_management.visual.api_keys.model_pricing_hint', {
                    defaultValue:
                      'First matching rule wins. Supports * wildcards, for example gpt-5*',
                  })}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={addModelRule}
                disabled={saving}
              >
                {t('config_management.visual.api_keys.add_model_price', {
                  defaultValue: 'Add Model Price',
                })}
              </Button>
            </div>

            {draft.quota.pricing.models.length === 0 ? (
              <div className={styles.emptyRuleState}>
                {t('config_management.visual.api_keys.model_pricing_empty', {
                  defaultValue: 'No model pricing rules',
                })}
              </div>
            ) : (
              <div className={styles.ruleList}>
                {draft.quota.pricing.models.map((rule, index) => (
                  <div key={rule.id} className={styles.ruleCard}>
                    <div className={styles.ruleHeader}>
                      <strong>
                        {t('config_management.visual.api_keys.model_rule_title', {
                          defaultValue: 'Rule {{index}}',
                          index: index + 1,
                        })}
                      </strong>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeModelRule(rule.id)}
                        disabled={saving}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>

                    <Input
                      label={t('config_management.visual.api_keys.match_pattern', {
                        defaultValue: 'Model Match Pattern',
                      })}
                      placeholder="gpt-5*"
                      value={rule.match}
                      onChange={(event) =>
                        updateModelRule(rule.id, { match: event.currentTarget.value })
                      }
                      disabled={saving}
                      hint={t('config_management.visual.api_keys.match_pattern_hint', {
                        defaultValue: 'Examples: gpt-5, gpt-5*, claude-sonnet-4-5*',
                      })}
                    />

                    <div className={styles.fieldsGrid}>
                      <Input
                        label={t('config_management.visual.api_keys.price_input', {
                          defaultValue: 'Input Price',
                        })}
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        placeholder="2.5"
                        value={rule.inputUsdPerMillion}
                        onChange={(event) =>
                          updateModelRule(rule.id, {
                            inputUsdPerMillion: event.currentTarget.value,
                          })
                        }
                        disabled={saving}
                      />
                      <Input
                        label={t('config_management.visual.api_keys.price_output', {
                          defaultValue: 'Output Price',
                        })}
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        placeholder="20"
                        value={rule.outputUsdPerMillion}
                        onChange={(event) =>
                          updateModelRule(rule.id, {
                            outputUsdPerMillion: event.currentTarget.value,
                          })
                        }
                        disabled={saving}
                      />
                      <Input
                        label={t('config_management.visual.api_keys.price_cached', {
                          defaultValue: 'Cached Input Price',
                        })}
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        placeholder="0.125"
                        value={rule.cachedUsdPerMillion}
                        onChange={(event) =>
                          updateModelRule(rule.id, {
                            cachedUsdPerMillion: event.currentTarget.value,
                          })
                        }
                        disabled={saving}
                      />
                      <Input
                        label={t('config_management.visual.api_keys.price_reasoning', {
                          defaultValue: 'Reasoning Price',
                        })}
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        placeholder="0"
                        value={rule.reasoningUsdPerMillion}
                        onChange={(event) =>
                          updateModelRule(rule.id, {
                            reasoningUsdPerMillion: event.currentTarget.value,
                          })
                        }
                        disabled={saving}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editingIndex !== null && (
            <div className={styles.modalNote}>
              {t('api_keys.edit_resets_activation', {
                defaultValue:
                  'Changing the key value resets activation time. Changing only the validity days keeps the current activation time.',
              })}
            </div>
          )}

          {formError && <div className={styles.errorBox}>{formError}</div>}
        </div>
      </Modal>
    </div>
  );
}
