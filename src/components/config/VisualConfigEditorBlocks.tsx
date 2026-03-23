import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useNotificationStore } from '@/stores';
import styles from './VisualConfigEditor.module.scss';
import { copyToClipboard } from '@/utils/clipboard';
import type {
  VisualApiKeyEntry,
  VisualApiKeyModelPricing,
  PayloadFilterRule,
  PayloadModelEntry,
  PayloadParamEntry,
  PayloadParamValidationErrorCode,
  PayloadParamValueType,
  PayloadRule,
} from '@/types/visualConfig';
import {
  createEmptyApiKeyEntry,
  createEmptyApiKeyModelPricing,
  makeClientId,
} from '@/types/visualConfig';
import {
  getPayloadParamValidationError,
  VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS,
  VISUAL_CONFIG_PROTOCOL_OPTIONS,
} from '@/hooks/useVisualConfig';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';

function getValidationMessage(
  t: ReturnType<typeof useTranslation>['t'],
  errorCode?: PayloadParamValidationErrorCode
) {
  if (!errorCode) return undefined;
  return t(`config_management.visual.validation.${errorCode}`);
}

function cloneApiKeyEntry(entry: VisualApiKeyEntry): VisualApiKeyEntry {
  if (typeof structuredClone === 'function') return structuredClone(entry);
  return JSON.parse(JSON.stringify(entry)) as VisualApiKeyEntry;
}

function trimApiKeyRule(rule: VisualApiKeyModelPricing): VisualApiKeyModelPricing {
  return {
    ...rule,
    match: rule.match.trim(),
    inputUsdPerMillion: rule.inputUsdPerMillion.trim(),
    outputUsdPerMillion: rule.outputUsdPerMillion.trim(),
    cachedUsdPerMillion: rule.cachedUsdPerMillion.trim(),
    reasoningUsdPerMillion: rule.reasoningUsdPerMillion.trim(),
  };
}

function trimApiKeyEntry(entry: VisualApiKeyEntry): VisualApiKeyEntry {
  return {
    ...entry,
    apiKey: entry.apiKey.trim(),
    durationDays: entry.durationDays.trim(),
    activatedAt: entry.activatedAt.trim(),
    quota: {
      maxRequests: entry.quota.maxRequests.trim(),
      maxTokens: entry.quota.maxTokens.trim(),
      maxUsd: entry.quota.maxUsd.trim(),
      pricing: {
        inputUsdPerMillion: entry.quota.pricing.inputUsdPerMillion.trim(),
        outputUsdPerMillion: entry.quota.pricing.outputUsdPerMillion.trim(),
        cachedUsdPerMillion: entry.quota.pricing.cachedUsdPerMillion.trim(),
        reasoningUsdPerMillion: entry.quota.pricing.reasoningUsdPerMillion.trim(),
        models: entry.quota.pricing.models.map(trimApiKeyRule),
      },
    },
  };
}

function isNonNegativeInteger(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^\d+$/.test(trimmed);
}

function isPositiveIntegerOrBlank(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^[1-9]\d*$/.test(trimmed);
}

function isNonNegativeNumber(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
}

function parseApiKeyTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getApiKeyEffectiveExpiry(entry: VisualApiKeyEntry): Date | null {
  const durationDays = entry.durationDays.trim();
  if (!/^[1-9]\d*$/.test(durationDays)) return null;
  const activatedAt = parseApiKeyTimestamp(entry.activatedAt);
  if (!activatedAt) return null;
  return new Date(activatedAt.getTime() + Number(durationDays) * 24 * 60 * 60 * 1000);
}

function formatApiKeyTimestamp(value: string): string | null {
  const parsed = parseApiKeyTimestamp(value);
  return parsed ? parsed.toLocaleString() : null;
}

function formatApiKeyDate(date: Date | null): string | null {
  return date ? date.toLocaleString() : null;
}

function hasModelPricingValue(rule: VisualApiKeyModelPricing): boolean {
  return Boolean(
    rule.match.trim() ||
      rule.inputUsdPerMillion.trim() ||
      rule.outputUsdPerMillion.trim() ||
      rule.cachedUsdPerMillion.trim() ||
      rule.reasoningUsdPerMillion.trim()
  );
}

function hasAnyModelPrice(rule: VisualApiKeyModelPricing): boolean {
  return Boolean(
    rule.inputUsdPerMillion.trim() ||
      rule.outputUsdPerMillion.trim() ||
      rule.cachedUsdPerMillion.trim() ||
      rule.reasoningUsdPerMillion.trim()
  );
}

function hasAnyPricing(entry: VisualApiKeyEntry): boolean {
  return Boolean(
    entry.quota.pricing.inputUsdPerMillion.trim() ||
      entry.quota.pricing.outputUsdPerMillion.trim() ||
      entry.quota.pricing.cachedUsdPerMillion.trim() ||
      entry.quota.pricing.reasoningUsdPerMillion.trim() ||
      entry.quota.pricing.models.some((rule) => hasModelPricingValue(rule))
  );
}

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor({
  value,
  disabled,
  onChange,
}: {
  value: VisualApiKeyEntry[];
  disabled?: boolean;
  onChange: (nextValue: VisualApiKeyEntry[]) => void;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const entries = useMemo(() => value ?? [], [value]);

  const apiKeyInputId = useId();
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [draftEntry, setDraftEntry] = useState<VisualApiKeyEntry>(() => createEmptyApiKeyEntry());
  const [formError, setFormError] = useState('');

  function generateSecureApiKey(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const array = new Uint8Array(17);
    crypto.getRandomValues(array);
    return 'sk-' + Array.from(array, (b) => charset[b % charset.length]).join('');
  }

  const openAddModal = () => {
    setEditingApiKeyId(null);
    setDraftEntry(createEmptyApiKeyEntry());
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (apiKeyId: string) => {
    const editingEntry = entries.find((entry) => entry.id === apiKeyId);
    if (!editingEntry) return;
    setEditingApiKeyId(apiKeyId);
    setDraftEntry(cloneApiKeyEntry(editingEntry));
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingApiKeyId(null);
    setDraftEntry(createEmptyApiKeyEntry());
    setFormError('');
  };

  const handleDelete = (apiKeyId: string) => {
    onChange(entries.filter((entry) => entry.id !== apiKeyId));
  };

  const handleSave = () => {
    const nextEntry = trimApiKeyEntry(draftEntry);
    const existingEntry =
      editingApiKeyId === null ? null : entries.find((entry) => entry.id === editingApiKeyId) ?? null;

    if (existingEntry && existingEntry.apiKey.trim() !== nextEntry.apiKey) {
      nextEntry.activatedAt = '';
    }

    if (!nextEntry.apiKey) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(nextEntry.apiKey)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }
    if (!isPositiveIntegerOrBlank(nextEntry.durationDays)) {
      setFormError(
        t('config_management.visual.api_keys.error_duration', {
          defaultValue: 'Validity days must be a positive whole number',
        })
      );
      return;
    }
    if (!isNonNegativeInteger(nextEntry.quota.maxRequests) || !isNonNegativeInteger(nextEntry.quota.maxTokens)) {
      setFormError(
        t('config_management.visual.api_keys.error_integer', {
          defaultValue: 'Request, token, and count fields must be non-negative whole numbers',
        })
      );
      return;
    }
    if (
      !isNonNegativeNumber(nextEntry.quota.maxUsd) ||
      !isNonNegativeNumber(nextEntry.quota.pricing.inputUsdPerMillion) ||
      !isNonNegativeNumber(nextEntry.quota.pricing.outputUsdPerMillion) ||
      !isNonNegativeNumber(nextEntry.quota.pricing.cachedUsdPerMillion) ||
      !isNonNegativeNumber(nextEntry.quota.pricing.reasoningUsdPerMillion) ||
      nextEntry.quota.pricing.models.some(
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

    const filteredRules = nextEntry.quota.pricing.models.filter((rule) => hasModelPricingValue(rule));
    for (const rule of filteredRules) {
      if (!rule.match) {
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
    nextEntry.quota.pricing.models = filteredRules;

    if (nextEntry.quota.maxUsd && !hasAnyPricing(nextEntry)) {
      setFormError(
        t('config_management.visual.api_keys.usd_budget_pricing_required', {
          defaultValue: 'Set at least one default price or model price when USD budget is enabled',
        })
      );
      return;
    }

    const nextEntries =
      editingApiKeyId === null
        ? [...entries, nextEntry]
        : entries.map((entry) => (entry.id === editingApiKeyId ? nextEntry : entry));
    onChange(nextEntries);
    closeModal();
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const handleGenerate = () => {
    setDraftEntry((prev) => ({ ...prev, apiKey: generateSecureApiKey() }));
    setFormError('');
  };

  const updateDraftEntry = (patch: Partial<VisualApiKeyEntry>) => {
    setDraftEntry((prev) => ({
      ...prev,
      ...patch,
      quota: patch.quota ? { ...prev.quota, ...patch.quota } : prev.quota,
    }));
  };

  const updateDraftPricing = (patch: Partial<VisualApiKeyEntry['quota']['pricing']>) => {
    setDraftEntry((prev) => ({
      ...prev,
      quota: {
        ...prev.quota,
        pricing: {
          ...prev.quota.pricing,
          ...patch,
        },
      },
    }));
  };

  const updateModelRule = (ruleId: string, patch: Partial<VisualApiKeyModelPricing>) => {
    setDraftEntry((prev) => ({
      ...prev,
      quota: {
        ...prev.quota,
        pricing: {
          ...prev.quota.pricing,
          models: prev.quota.pricing.models.map((rule) =>
            rule.id === ruleId ? { ...rule, ...patch } : rule
          ),
        },
      },
    }));
  };

  const addModelRule = () => {
    updateDraftPricing({
      models: [...draftEntry.quota.pricing.models, createEmptyApiKeyModelPricing()],
    });
  };

  const removeModelRule = (ruleId: string) => {
    updateDraftPricing({
      models: draftEntry.quota.pricing.models.filter((rule) => rule.id !== ruleId),
    });
  };

  const describeEntry = (entry: VisualApiKeyEntry): string[] => {
    const tags: string[] = [];
    if (entry.durationDays.trim()) {
      tags.push(
        t('config_management.visual.api_keys.summary_duration', {
          defaultValue: '{{count}} day validity',
          count: Number(entry.durationDays.trim()),
        })
      );
      const activatedAt = formatApiKeyTimestamp(entry.activatedAt);
      const expiresAt = formatApiKeyDate(getApiKeyEffectiveExpiry(entry));
      if (activatedAt) {
        tags.push(
          t('config_management.visual.api_keys.summary_activated_at', {
            defaultValue: 'Activated {{value}}',
            value: activatedAt,
          })
        );
      } else {
        tags.push(
          t('config_management.visual.api_keys.summary_starts_on_first_request', {
            defaultValue: 'Starts on first request',
          })
        );
      }
      if (expiresAt) {
        tags.push(
          t('config_management.visual.api_keys.summary_expires_at', {
            defaultValue: 'Expires {{value}}',
            value: expiresAt,
          })
        );
      }
    }
    if (entry.quota.maxRequests.trim()) {
      tags.push(
        t(
          'config_management.visual.api_keys.summary_requests',
          '{{count}} requests',
          { count: Number(entry.quota.maxRequests.trim()) }
        )
      );
    }
    if (entry.quota.maxTokens.trim()) {
      tags.push(
        t(
          'config_management.visual.api_keys.summary_tokens',
          '{{count}} tokens',
          { count: Number(entry.quota.maxTokens.trim()) }
        )
      );
    }
    if (entry.quota.maxUsd.trim()) {
      tags.push(
        t(
          'config_management.visual.api_keys.summary_budget',
          '$ {{amount}} budget',
          { amount: entry.quota.maxUsd.trim() }
        )
      );
    }
    if (entry.quota.pricing.models.length > 0) {
      tags.push(
        t(
          'config_management.visual.api_keys.summary_model_prices',
          '{{count}} model prices',
          { count: entry.quota.pricing.models.length }
        )
      );
    } else if (hasAnyPricing(entry)) {
      tags.push(
        t('config_management.visual.api_keys.summary_default_price', {
          defaultValue: 'Default pricing',
        })
      );
    }
    if (tags.length === 0) {
      tags.push(
        t('config_management.visual.api_keys.summary_no_limits', {
          defaultValue: 'No limits configured',
        })
      );
    }
    return tags;
  };

  const draftActivatedAtLabel = formatApiKeyTimestamp(draftEntry.activatedAt);
  const draftExpiresAtLabel = formatApiKeyDate(getApiKeyEffectiveExpiry(draftEntry));

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ margin: 0 }}>{t('config_management.visual.api_keys.label')}</label>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          {t('config_management.visual.api_keys.add')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: 16,
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          {t('config_management.visual.api_keys.empty')}
        </div>
      ) : (
        <div className="item-list" style={{ marginTop: 4 }}>
          {entries.map((entry, index) => (
            <div key={entry.id ?? `${entry.apiKey}-${index}`} className="item-row">
              <div className="item-meta">
                <div className="pill">#{index + 1}</div>
                <div className="item-title">{t('config_management.visual.api_keys.input_label')}</div>
                <div className="item-subtitle">{maskApiKey(String(entry.apiKey || ''))}</div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 6,
                    marginTop: 8,
                  }}
                >
                  {describeEntry(entry).map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 999,
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="item-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopy(entry.apiKey)}
                  disabled={disabled}
                >
                  {t('common.copy')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openEditModal(entry.id)}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.edit')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(entry.id)}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hint">{t('config_management.visual.api_keys.hint')}</div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingApiKeyId !== null ? t('config_management.visual.api_keys.edit_title') : t('config_management.visual.api_keys.add_title')}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled}>
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={disabled}>
              {editingApiKeyId !== null ? t('config_management.visual.common.update') : t('config_management.visual.common.add')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label htmlFor={apiKeyInputId}>{t('config_management.visual.api_keys.input_label')}</label>
            <div className={styles.apiKeyModalInputRow}>
              <input
                id={apiKeyInputId}
                className="input"
                placeholder={t('config_management.visual.api_keys.input_placeholder')}
                value={draftEntry.apiKey}
                onChange={(e) => updateDraftEntry({ apiKey: e.target.value })}
                disabled={disabled}
                aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
                aria-invalid={Boolean(formError)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleGenerate}
                disabled={disabled}
              >
                {t('config_management.visual.api_keys.generate')}
              </Button>
            </div>
            <div id={apiKeyHintId} className="hint">{t('config_management.visual.api_keys.input_hint')}</div>
            {formError && <div id={apiKeyErrorId} className="error-box">{formError}</div>}
          </div>

          <div
            style={{
              padding: 12,
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <Input
              label={t('config_management.visual.api_keys.validity_days', {
                defaultValue: 'Validity Days',
              })}
              type="number"
              inputMode="numeric"
              min="1"
              placeholder="1"
              value={draftEntry.durationDays}
              onChange={(e) => updateDraftEntry({ durationDays: e.target.value })}
              disabled={disabled}
              hint={t('config_management.visual.api_keys.validity_days_hint', {
                defaultValue: 'Default is 1 day. Countdown starts on the first successful request.',
              })}
            />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => updateDraftEntry({ durationDays: '1' })}
                disabled={disabled}
              >
                {t('config_management.visual.api_keys.quick_1', { defaultValue: '1 Day' })}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => updateDraftEntry({ durationDays: '7' })}
                disabled={disabled}
              >
                {t('config_management.visual.api_keys.quick_7', { defaultValue: '7 Days' })}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => updateDraftEntry({ durationDays: '30' })}
                disabled={disabled}
              >
                {t('config_management.visual.api_keys.quick_30', { defaultValue: '30 Days' })}
              </Button>
            </div>

            {draftEntry.durationDays.trim() &&
              (draftActivatedAtLabel ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div className="hint">
                    {t('config_management.visual.api_keys.summary_activated_at', {
                      defaultValue: 'Activated {{value}}',
                      value: draftActivatedAtLabel,
                    })}
                  </div>
                  {draftExpiresAtLabel && (
                    <div className="hint">
                      {t('config_management.visual.api_keys.summary_expires_at', {
                        defaultValue: 'Expires {{value}}',
                        value: draftExpiresAtLabel,
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <div className="hint">
                  {t('config_management.visual.api_keys.summary_starts_on_first_request', {
                    defaultValue: 'Starts on first request',
                  })}
                </div>
              ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            <Input
              label={t('config_management.visual.api_keys.max_requests', { defaultValue: 'Max Requests' })}
              type="number"
              inputMode="numeric"
              placeholder="1000"
              value={draftEntry.quota.maxRequests}
              onChange={(e) =>
                updateDraftEntry({
                  quota: { ...draftEntry.quota, maxRequests: e.target.value },
                })
              }
              disabled={disabled}
              hint={t('config_management.visual.api_keys.max_requests_hint', {
                defaultValue: 'Leave empty for unlimited requests',
              })}
            />
            <Input
              label={t('config_management.visual.api_keys.max_tokens', { defaultValue: 'Max Tokens' })}
              type="number"
              inputMode="numeric"
              placeholder="500000"
              value={draftEntry.quota.maxTokens}
              onChange={(e) =>
                updateDraftEntry({
                  quota: { ...draftEntry.quota, maxTokens: e.target.value },
                })
              }
              disabled={disabled}
              hint={t('config_management.visual.api_keys.max_tokens_hint', {
                defaultValue: 'Leave empty for unlimited tokens',
              })}
            />
            <Input
              label={t('config_management.visual.api_keys.max_usd', { defaultValue: 'USD Budget Limit' })}
              type="number"
              inputMode="decimal"
              step="0.000001"
              placeholder="5"
              value={draftEntry.quota.maxUsd}
              onChange={(e) =>
                updateDraftEntry({
                  quota: { ...draftEntry.quota, maxUsd: e.target.value },
                })
              }
              disabled={disabled}
              hint={t('config_management.visual.api_keys.max_usd_hint', {
                defaultValue: 'Leave empty for no dollar budget limit',
              })}
            />
          </div>

          <div
            style={{
              padding: 12,
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('config_management.visual.api_keys.default_pricing', {
                  defaultValue: 'Default Pricing',
                })}
              </div>
              <div className="hint">
                {t('config_management.visual.api_keys.default_pricing_hint', {
                  defaultValue: 'Fallback prices in USD per 1M tokens when no model rule matches',
                })}
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
              }}
            >
              <Input
                label={t('config_management.visual.api_keys.price_input', {
                  defaultValue: 'Input Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="1.25"
                value={draftEntry.quota.pricing.inputUsdPerMillion}
                onChange={(e) =>
                  updateDraftPricing({ inputUsdPerMillion: e.target.value })
                }
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.api_keys.price_output', {
                  defaultValue: 'Output Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="10"
                value={draftEntry.quota.pricing.outputUsdPerMillion}
                onChange={(e) =>
                  updateDraftPricing({ outputUsdPerMillion: e.target.value })
                }
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.api_keys.price_cached', {
                  defaultValue: 'Cached Input Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="0.125"
                value={draftEntry.quota.pricing.cachedUsdPerMillion}
                onChange={(e) =>
                  updateDraftPricing({ cachedUsdPerMillion: e.target.value })
                }
                disabled={disabled}
              />
              <Input
                label={t('config_management.visual.api_keys.price_reasoning', {
                  defaultValue: 'Reasoning Price',
                })}
                type="number"
                inputMode="decimal"
                step="0.000001"
                placeholder="0"
                value={draftEntry.quota.pricing.reasoningUsdPerMillion}
                onChange={(e) =>
                  updateDraftPricing({ reasoningUsdPerMillion: e.target.value })
                }
                disabled={disabled}
              />
            </div>
          </div>

          <div
            style={{
              padding: 12,
              border: '1px solid var(--border-color)',
              borderRadius: 12,
              background: 'var(--bg-secondary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t('config_management.visual.api_keys.model_pricing', {
                    defaultValue: 'Model Pricing Rules',
                  })}
                </div>
                <div className="hint">
                  {t('config_management.visual.api_keys.model_pricing_hint', {
                    defaultValue: 'First matching rule wins. Supports * wildcards, for example gpt-5*',
                  })}
                </div>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={addModelRule} disabled={disabled}>
                {t('config_management.visual.api_keys.add_model_price', {
                  defaultValue: 'Add Model Price',
                })}
              </Button>
            </div>

            {draftEntry.quota.pricing.models.length === 0 ? (
              <div
                style={{
                  border: '1px dashed var(--border-color)',
                  borderRadius: 10,
                  padding: 12,
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                }}
              >
                {t('config_management.visual.api_keys.model_pricing_empty', {
                  defaultValue: 'No model pricing rules',
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {draftEntry.quota.pricing.models.map((rule, index) => (
                  <div
                    key={rule.id}
                    style={{
                      padding: 12,
                      border: '1px solid var(--border-color)',
                      borderRadius: 10,
                      background: 'var(--bg-tertiary)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong>
                        {t(
                          'config_management.visual.api_keys.model_rule_title',
                          'Rule {{index}}',
                          { index: index + 1 }
                        )}
                      </strong>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeModelRule(rule.id)}
                        disabled={disabled}
                      >
                        {t('config_management.visual.common.delete')}
                      </Button>
                    </div>

                    <Input
                      label={t('config_management.visual.api_keys.match_pattern', {
                        defaultValue: 'Model Match Pattern',
                      })}
                      placeholder="gpt-5*"
                      value={rule.match}
                      onChange={(e) => updateModelRule(rule.id, { match: e.target.value })}
                      disabled={disabled}
                      hint={t('config_management.visual.api_keys.match_pattern_hint', {
                        defaultValue: 'Examples: gpt-5, gpt-5*, claude-sonnet-4-5*',
                      })}
                    />

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 12,
                      }}
                    >
                      <Input
                        label={t('config_management.visual.api_keys.price_input', {
                          defaultValue: 'Input Price',
                        })}
                        type="number"
                        inputMode="decimal"
                        step="0.000001"
                        placeholder="2.5"
                        value={rule.inputUsdPerMillion}
                        onChange={(e) =>
                          updateModelRule(rule.id, { inputUsdPerMillion: e.target.value })
                        }
                        disabled={disabled}
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
                        onChange={(e) =>
                          updateModelRule(rule.id, { outputUsdPerMillion: e.target.value })
                        }
                        disabled={disabled}
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
                        onChange={(e) =>
                          updateModelRule(rule.id, { cachedUsdPerMillion: e.target.value })
                        }
                        disabled={disabled}
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
                        onChange={(e) =>
                          updateModelRule(rule.id, { reasoningUsdPerMillion: e.target.value })
                        }
                        disabled={disabled}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
});

const StringListEditor = memo(function StringListEditor({
  value,
  disabled,
  placeholder,
  inputAriaLabel,
  onChange,
}: {
  value: string[];
  disabled?: boolean;
  placeholder?: string;
  inputAriaLabel?: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const items = value.length ? value : [];
  const [itemIds, setItemIds] = useState(() => items.map(() => makeClientId()));
  const renderItemIds = useMemo(() => {
    if (itemIds.length === items.length) return itemIds;
    if (itemIds.length > items.length) return itemIds.slice(0, items.length);
    return [...itemIds, ...Array.from({ length: items.length - itemIds.length }, () => makeClientId())];
  }, [itemIds, items.length]);

  const updateItem = (index: number, nextValue: string) =>
    onChange(items.map((item, i) => (i === index ? nextValue : item)));
  const addItem = () => {
    setItemIds([...renderItemIds, makeClientId()]);
    onChange([...items, '']);
  };
  const removeItem = (index: number) => {
    setItemIds(renderItemIds.filter((_, i) => i !== index));
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, index) => (
        <div key={renderItemIds[index] ?? `item-${index}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder={placeholder}
            aria-label={inputAriaLabel ?? placeholder}
            value={item}
            onChange={(e) => updateItem(index, e.target.value)}
            disabled={disabled}
            style={{ flex: 1 }}
          />
          <Button variant="ghost" size="sm" onClick={() => removeItem(index)} disabled={disabled}>
            {t('config_management.visual.common.delete')}
          </Button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={addItem} disabled={disabled}>
          {t('config_management.visual.common.add')}
        </Button>
      </div>
    </div>
  );
});

export const PayloadRulesEditor = memo(function PayloadRulesEditor({
  value,
  disabled,
  protocolFirst = false,
  onChange,
}: {
  value: PayloadRule[];
  disabled?: boolean;
  protocolFirst?: boolean;
  onChange: (next: PayloadRule[]) => void;
}) {
  const { t } = useTranslation();
  const rules = value.length ? value : [];
  const protocolOptions = useMemo(
    () =>
      VISUAL_CONFIG_PROTOCOL_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, { defaultValue: option.defaultLabel }),
      })),
    [t]
  );
  const payloadValueTypeOptions = useMemo(
    () =>
      VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, { defaultValue: option.defaultLabel }),
      })),
    [t]
  );
  const booleanValueOptions = useMemo(
    () => [
      { value: 'true', label: t('config_management.visual.payload_rules.boolean_true') },
      { value: 'false', label: t('config_management.visual.payload_rules.boolean_false') },
    ],
    [t]
  );

  const addRule = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }]);
  const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex));

  const updateRule = (ruleIndex: number, patch: Partial<PayloadRule>) =>
    onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)));

  const addModel = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined };
    updateRule(ruleIndex, { models: [...rule.models, nextModel] });
  };

  const removeModel = (ruleIndex: number, modelIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) });
  };

  const updateModel = (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
    });
  };

  const addParam = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextParam: PayloadParamEntry = {
      id: makeClientId(),
      path: '',
      valueType: 'string',
      value: '',
    };
    updateRule(ruleIndex, { params: [...rule.params, nextParam] });
  };

  const removeParam = (ruleIndex: number, paramIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { params: rule.params.filter((_, i) => i !== paramIndex) });
  };

  const updateParam = (ruleIndex: number, paramIndex: number, patch: Partial<PayloadParamEntry>) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      params: rule.params.map((p, i) => (i === paramIndex ? { ...p, ...patch } : p)),
    });
  };

  const getValuePlaceholder = (valueType: PayloadParamValueType) => {
    switch (valueType) {
      case 'string':
        return t('config_management.visual.payload_rules.value_string');
      case 'number':
        return t('config_management.visual.payload_rules.value_number');
      case 'boolean':
        return t('config_management.visual.payload_rules.value_boolean');
      case 'json':
        return t('config_management.visual.payload_rules.value_json');
      default:
        return t('config_management.visual.payload_rules.value_default');
    }
  };

  const getParamErrorMessage = (param: PayloadParamEntry) => {
    const errorCode = getPayloadParamValidationError(param);
    return getValidationMessage(t, errorCode);
  };

  const renderParamValueEditor = (
    ruleIndex: number,
    paramIndex: number,
    param: PayloadParamEntry
  ) => {
    if (param.valueType === 'boolean') {
      return (
        <Select
          value={param.value.toLowerCase() === 'true' || param.value.toLowerCase() === 'false' ? param.value.toLowerCase() : ''}
          options={booleanValueOptions}
          placeholder={t('config_management.visual.payload_rules.value_boolean')}
          disabled={disabled}
          ariaLabel={t('config_management.visual.payload_rules.param_value')}
          onChange={(nextValue) => updateParam(ruleIndex, paramIndex, { value: nextValue })}
        />
      );
    }

    if (param.valueType === 'json') {
      return (
        <textarea
          className={`input ${styles.payloadJsonInput}`}
          placeholder={getValuePlaceholder(param.valueType)}
          aria-label={t('config_management.visual.payload_rules.param_value')}
          value={param.value}
          onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
          disabled={disabled}
        />
      );
    }

    return (
      <input
        className="input"
        placeholder={getValuePlaceholder(param.valueType)}
        aria-label={t('config_management.visual.payload_rules.param_value')}
        value={param.value}
        onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
        disabled={disabled}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rules.map((rule, ruleIndex) => (
        <div
          key={rule.id}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}</div>
            <Button variant="ghost" size="sm" onClick={() => removeRule(ruleIndex)} disabled={disabled}>
              {t('config_management.visual.common.delete')}
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('config_management.visual.payload_rules.models')}</div>
            {(rule.models.length ? rule.models : []).map((model, modelIndex) => (
              <div
                key={model.id}
                className={[styles.payloadRuleModelRow, protocolFirst ? styles.payloadRuleModelRowProtocolFirst : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {protocolFirst ? (
                  <>
                    <Select
                      value={model.protocol ?? ''}
                      options={protocolOptions}
                      disabled={disabled}
                      ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                      onChange={(nextValue) =>
                        updateModel(ruleIndex, modelIndex, {
                          protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                        })
                      }
                    />
                    <input
                      className="input"
                      placeholder={t('config_management.visual.payload_rules.model_name')}
                      aria-label={t('config_management.visual.payload_rules.model_name')}
                      value={model.name}
                      onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                      disabled={disabled}
                    />
                  </>
                ) : (
                  <>
                    <input
                      className="input"
                      placeholder={t('config_management.visual.payload_rules.model_name')}
                      aria-label={t('config_management.visual.payload_rules.model_name')}
                      value={model.name}
                      onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                      disabled={disabled}
                    />
                    <Select
                      value={model.protocol ?? ''}
                      options={protocolOptions}
                      disabled={disabled}
                      ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                      onChange={(nextValue) =>
                        updateModel(ruleIndex, modelIndex, {
                          protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                        })
                      }
                    />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.payloadRowActionButton}
                  onClick={() => removeModel(ruleIndex, modelIndex)}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => addModel(ruleIndex)} disabled={disabled}>
                {t('config_management.visual.payload_rules.add_model')}
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('config_management.visual.payload_rules.params')}</div>
            {(rule.params.length ? rule.params : []).map((param, paramIndex) => {
              const paramError = getParamErrorMessage(param);

              return (
                <div key={param.id} className={styles.payloadRuleParamGroup}>
                  <div className={styles.payloadRuleParamRow}>
                    <input
                      className="input"
                      placeholder={t('config_management.visual.payload_rules.json_path')}
                      aria-label={t('config_management.visual.payload_rules.json_path')}
                      value={param.path}
                      onChange={(e) => updateParam(ruleIndex, paramIndex, { path: e.target.value })}
                      disabled={disabled}
                    />
                    <Select
                      value={param.valueType}
                      options={payloadValueTypeOptions}
                      disabled={disabled}
                      ariaLabel={t('config_management.visual.payload_rules.param_type')}
                      onChange={(nextValue) =>
                        updateParam(ruleIndex, paramIndex, {
                          valueType: nextValue as PayloadParamValueType,
                          value:
                            nextValue === 'boolean'
                              ? 'true'
                              : nextValue === 'json' && param.value.trim() === ''
                                ? '{}'
                                : param.value,
                        })
                      }
                    />
                    {renderParamValueEditor(ruleIndex, paramIndex, param)}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.payloadRowActionButton}
                      onClick={() => removeParam(ruleIndex, paramIndex)}
                      disabled={disabled}
                    >
                      {t('config_management.visual.common.delete')}
                    </Button>
                  </div>
                  {paramError && <div className={`error-box ${styles.payloadParamError}`}>{paramError}</div>}
                </div>
              );
            })}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => addParam(ruleIndex)} disabled={disabled}>
                {t('config_management.visual.payload_rules.add_param')}
              </Button>
            </div>
          </div>
        </div>
      ))}

      {rules.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: 16,
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          {t('config_management.visual.payload_rules.no_rules')}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          {t('config_management.visual.payload_rules.add_rule')}
        </Button>
      </div>
    </div>
  );
});

export const PayloadFilterRulesEditor = memo(function PayloadFilterRulesEditor({
  value,
  disabled,
  onChange,
}: {
  value: PayloadFilterRule[];
  disabled?: boolean;
  onChange: (next: PayloadFilterRule[]) => void;
}) {
  const { t } = useTranslation();
  const rules = value.length ? value : [];
  const protocolOptions = useMemo(
    () =>
      VISUAL_CONFIG_PROTOCOL_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey, { defaultValue: option.defaultLabel }),
      })),
    [t]
  );

  const addRule = () => onChange([...rules, { id: makeClientId(), models: [], params: [] }]);
  const removeRule = (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex));

  const updateRule = (ruleIndex: number, patch: Partial<PayloadFilterRule>) =>
    onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)));

  const addModel = (ruleIndex: number) => {
    const rule = rules[ruleIndex];
    const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined };
    updateRule(ruleIndex, { models: [...rule.models, nextModel] });
  };

  const removeModel = (ruleIndex: number, modelIndex: number) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, { models: rule.models.filter((_, i) => i !== modelIndex) });
  };

  const updateModel = (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) => {
    const rule = rules[ruleIndex];
    updateRule(ruleIndex, {
      models: rule.models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rules.map((rule, ruleIndex) => (
        <div
          key={rule.id}
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}</div>
            <Button variant="ghost" size="sm" onClick={() => removeRule(ruleIndex)} disabled={disabled}>
              {t('config_management.visual.common.delete')}
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('config_management.visual.payload_rules.models')}</div>
            {rule.models.map((model, modelIndex) => (
              <div key={model.id} className={styles.payloadFilterModelRow}>
                <input
                  className="input"
                  placeholder={t('config_management.visual.payload_rules.model_name')}
                  aria-label={t('config_management.visual.payload_rules.model_name')}
                  value={model.name}
                  onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                  disabled={disabled}
                />
                <Select
                  value={model.protocol ?? ''}
                  options={protocolOptions}
                  disabled={disabled}
                  ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                  onChange={(nextValue) =>
                    updateModel(ruleIndex, modelIndex, {
                      protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                    })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.payloadRowActionButton}
                  onClick={() => removeModel(ruleIndex, modelIndex)}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => addModel(ruleIndex)} disabled={disabled}>
                {t('config_management.visual.payload_rules.add_model')}
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('config_management.visual.payload_rules.remove_params')}</div>
            <StringListEditor
              value={rule.params}
              disabled={disabled}
              placeholder={t('config_management.visual.payload_rules.json_path_filter')}
              inputAriaLabel={t('config_management.visual.payload_rules.json_path_filter')}
              onChange={(params) => updateRule(ruleIndex, { params })}
            />
          </div>
        </div>
      ))}

      {rules.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--border-color)',
            borderRadius: 12,
            padding: 16,
            color: 'var(--text-secondary)',
            textAlign: 'center',
          }}
        >
          {t('config_management.visual.payload_rules.no_rules')}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          {t('config_management.visual.payload_rules.add_rule')}
        </Button>
      </div>
    </div>
  );
});
