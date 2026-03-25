import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { IconCheck, IconDollarSign, IconKey, IconTimer } from '@/components/ui/icons';
import {
  apiKeysApi,
  type ApiKeyExportScope,
  type ApiKeyMutationEntry,
  type ManagedApiKeyEntry,
  type ManagedApiKeyQuota,
} from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/download';
import { formatDateTime, formatNumber, maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

type ApiKeyDraft = {
  apiKey: string;
  durationDays: string;
  maxConcurrency: string;
  maxRequests: string;
  maxTokens: string;
  maxUsd: string;
};

type BatchDraft = Omit<ApiKeyDraft, 'apiKey'> & {
  count: string;
  exportPrefix: string;
};

type ExportDraft = {
  scope: ApiKeyExportScope;
  exportPrefix: string;
};

const createDraft = (): ApiKeyDraft => ({
  apiKey: '',
  durationDays: '1',
  maxConcurrency: '',
  maxRequests: '',
  maxTokens: '',
  maxUsd: '',
});

const createBatchDraft = (): BatchDraft => ({
  durationDays: '1',
  maxConcurrency: '',
  maxRequests: '',
  maxTokens: '',
  maxUsd: '',
  count: '10',
  exportPrefix: '',
});

const createExportDraft = (): ExportDraft => ({
  scope: 'pending',
  exportPrefix: '',
});

const isPositiveIntegerOrBlank = (value: string) => value.trim() === '' || /^[1-9]\d*$/.test(value.trim());
const isNonNegativeInteger = (value: string) => value.trim() === '' || /^\d+$/.test(value.trim());
const isSingleTokenOrBlank = (value: string) => value.trim() === '' || !/\s/.test(value.trim());
const isNonNegativeNumber = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0;
};

const parsePositiveInteger = (value: string) =>
  isPositiveIntegerOrBlank(value) && value.trim() ? Math.trunc(Number(value.trim())) : undefined;

const parseNonNegativeInteger = (value: string) =>
  isNonNegativeInteger(value) && value.trim() ? Math.trunc(Number(value.trim())) : undefined;

const parseNonNegativeNumber = (value: string) =>
  isNonNegativeNumber(value) && value.trim() ? Number(value.trim()) : undefined;

const buildQuota = (draft: Pick<ApiKeyDraft, 'maxRequests' | 'maxTokens' | 'maxUsd'>): ManagedApiKeyQuota | undefined => {
  const quota: ManagedApiKeyQuota = {
    maxRequests: parseNonNegativeInteger(draft.maxRequests),
    maxTokens: parseNonNegativeInteger(draft.maxTokens),
    maxUsd: parseNonNegativeNumber(draft.maxUsd),
  };
  return quota.maxRequests !== undefined || quota.maxTokens !== undefined || quota.maxUsd !== undefined
    ? quota
    : undefined;
};

const buildDraftFromEntry = (entry: ManagedApiKeyEntry): ApiKeyDraft => ({
  apiKey: entry.apiKey,
  durationDays: entry.durationDays ? String(entry.durationDays) : '',
  maxConcurrency: entry.maxConcurrency ? String(entry.maxConcurrency) : '',
  maxRequests: entry.quota?.maxRequests ? String(entry.quota.maxRequests) : '',
  maxTokens: entry.quota?.maxTokens ? String(entry.quota.maxTokens) : '',
  maxUsd: entry.quota?.maxUsd ? String(entry.quota.maxUsd) : '',
});

const buildPayload = (draft: ApiKeyDraft, current?: ManagedApiKeyEntry): ApiKeyMutationEntry => {
  const apiKey = draft.apiKey.trim();
  const durationDays = parsePositiveInteger(draft.durationDays);
  const keyChanged = current ? current.apiKey !== apiKey : false;
  return {
    apiKey,
    durationDays,
    activatedAt: durationDays && current && !keyChanged ? current.activatedAt : undefined,
    maxConcurrency: parseNonNegativeInteger(draft.maxConcurrency),
    quota: buildQuota(draft),
  };
};

const buildFilename = (suffix: string) => {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
  return `api-keys-${suffix}-${stamp}.txt`;
};

const downloadTxt = (text: string, suffix: string) => {
  const normalized = text.replace(/\r?\n/g, '\r\n').trim();
  if (!normalized) return;
  downloadBlob({
    filename: buildFilename(suffix),
    blob: new Blob([`${normalized}\r\n`], { type: 'text/plain;charset=utf-8' }),
  });
};

const randomKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(17);
  globalThis.crypto?.getRandomValues?.(bytes);
  const body =
    bytes.length === 17
      ? Array.from(bytes, (value) => chars[value % chars.length]).join('')
      : Array.from({ length: 17 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `sk-${body}`;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

const formatUsd = (value: number, locale?: string) =>
  new Intl.NumberFormat(locale || undefined, { maximumFractionDigits: value >= 100 ? 2 : 4 }).format(value);

const hasQuotaConfig = (entry: ManagedApiKeyEntry) =>
  Boolean(
    entry.durationDays ||
      (entry.maxConcurrency ?? 0) > 0 ||
      entry.quota?.maxRequests ||
      entry.quota?.maxTokens ||
      entry.quota?.maxUsd
  );

export function ApiKeysPage() {
  const { i18n } = useTranslation();
  const { showConfirmation, showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const isZh = i18n.resolvedLanguage === 'zh-CN' || i18n.language.startsWith('zh');
  const tx = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);

  const [entries, setEntries] = useState<ManagedApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ApiKeyDraft>(createDraft);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [batchDraft, setBatchDraft] = useState<BatchDraft>(createBatchDraft);
  const [batchError, setBatchError] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [exportDraft, setExportDraft] = useState<ExportDraft>(createExportDraft);
  const [exportError, setExportError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSaving, setExportSaving] = useState(false);

  const loadEntries = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setError(tx('请先建立连接', 'Connect to the server first'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setEntries(await apiKeysApi.listDetailed());
    } catch (loadError) {
      setError(errorMessage(loadError) || tx('加载客户端 key 失败', 'Failed to load client keys'));
    } finally {
      setLoading(false);
    }
  }, [connectionStatus, tx]);

  useHeaderRefresh(loadEntries);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const summary = useMemo(
    () => ({
      total: entries.length,
      pending: entries.filter((entry) => entry.pendingActivation).length,
      active: entries.filter((entry) => !entry.pendingActivation && !entry.expired).length,
      quota: entries.filter((entry) => hasQuotaConfig(entry)).length,
    }),
    [entries]
  );

  const currentEntry = editingIndex !== null && editingIndex >= 0 ? entries[editingIndex] : undefined;

  const resetEditor = () => {
    setEditingIndex(null);
    setDraft(createDraft());
    setFormError('');
  };

  const resetBatch = () => {
    setBatchDraft(createBatchDraft());
    setBatchError('');
    setBatchOpen(false);
  };

  const resetExport = () => {
    setExportDraft(createExportDraft());
    setExportError('');
    setExportOpen(false);
  };

  const validateDraft = (value: ApiKeyDraft) => {
    if (!value.apiKey.trim()) return tx('请输入客户端 key', 'Please enter the client key');
    if (!isValidApiKeyCharset(value.apiKey.trim())) {
      return tx('客户端 key 包含无效字符', 'The client key contains invalid characters');
    }
    if (!isPositiveIntegerOrBlank(value.durationDays)) {
      return tx('有效天数必须是正整数', 'Validity days must be a positive whole number');
    }
    if (!isNonNegativeInteger(value.maxConcurrency)) {
      return tx('并发上限必须是非负整数', 'Concurrency limit must be a non-negative whole number');
    }
    if (!isNonNegativeInteger(value.maxRequests) || !isNonNegativeInteger(value.maxTokens)) {
      return tx(
        '请求数和 Token 上限必须是非负整数',
        'Request and token limits must be non-negative whole numbers'
      );
    }
    if (!isNonNegativeNumber(value.maxUsd)) {
      return tx('美元额度必须是非负数字', 'USD quota must be a non-negative number');
    }
    return '';
  };

  const saveEntry = async () => {
    const nextError = validateDraft(draft);
    if (nextError) {
      setFormError(nextError);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const payload = buildPayload(draft, currentEntry);
      if (editingIndex === null || editingIndex < 0) {
        await apiKeysApi.create(payload);
        showNotification(tx('客户端 key 已添加', 'Client key added'), 'success');
      } else {
        await apiKeysApi.update(editingIndex, payload);
        showNotification(tx('客户端 key 已更新', 'Client key updated'), 'success');
      }
      await loadEntries();
      resetEditor();
    } catch (saveError) {
      const message = errorMessage(saveError) || tx('保存客户端 key 失败', 'Failed to save the client key');
      setFormError(message);
      showNotification(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveBatch = async () => {
    const count = Number(batchDraft.count.trim());
    if (!Number.isFinite(count) || count <= 0 || !isPositiveIntegerOrBlank(batchDraft.count)) {
      setBatchError(tx('生成数量必须是正整数', 'Count must be a positive whole number'));
      return;
    }
    if (count > 500) {
      setBatchError(tx('单次最多生成 500 个 key', 'You can create up to 500 keys per batch'));
      return;
    }
    if (!isPositiveIntegerOrBlank(batchDraft.durationDays)) {
      setBatchError(tx('有效天数必须是正整数', 'Validity days must be a positive whole number'));
      return;
    }
    if (!isNonNegativeInteger(batchDraft.maxConcurrency)) {
      setBatchError(tx('并发上限必须是非负整数', 'Concurrency limit must be a non-negative whole number'));
      return;
    }
    if (!isNonNegativeInteger(batchDraft.maxRequests) || !isNonNegativeInteger(batchDraft.maxTokens)) {
      setBatchError(
        tx(
          '请求数和 Token 上限必须是非负整数',
          'Request and token limits must be non-negative whole numbers'
        )
      );
      return;
    }
    if (!isNonNegativeNumber(batchDraft.maxUsd)) {
      setBatchError(tx('美元额度必须是非负数字', 'USD quota must be a non-negative number'));
      return;
    }
    if (!isSingleTokenOrBlank(batchDraft.exportPrefix)) {
      setBatchError(tx('展示前缀不能包含空格', 'Display prefix must not contain spaces'));
      return;
    }

    setBatchSaving(true);
    setBatchError('');
    try {
      const result = await apiKeysApi.batchGenerate({
        count,
        exportPrefix: batchDraft.exportPrefix.trim() || undefined,
        durationDays: parsePositiveInteger(batchDraft.durationDays),
        maxConcurrency: parseNonNegativeInteger(batchDraft.maxConcurrency),
        quota: buildQuota(batchDraft),
      });
      const exportText =
        result.exportTxt ||
        result.apiKeys
          .map((apiKey) =>
            batchDraft.exportPrefix.trim() ? `${batchDraft.exportPrefix.trim()} ${apiKey}` : apiKey
          )
          .join('\n');
      downloadTxt(exportText, 'pending');
      showNotification(
        tx(
          `已创建 ${result.count} 个客户端 key，并下载了 TXT`,
          `${result.count} client keys created and TXT downloaded`
        ),
        'success'
      );
      await loadEntries();
      resetBatch();
    } catch (saveError) {
      const message = errorMessage(saveError) || tx('批量创建失败', 'Bulk creation failed');
      setBatchError(message);
      showNotification(message, 'error');
    } finally {
      setBatchSaving(false);
    }
  };

  const exportKeys = async () => {
    if (!isSingleTokenOrBlank(exportDraft.exportPrefix)) {
      setExportError(tx('展示前缀不能包含空格', 'Display prefix must not contain spaces'));
      return;
    }
    setExportSaving(true);
    setExportError('');
    try {
      const text = await apiKeysApi.exportTXT({
        exportPrefix: exportDraft.exportPrefix.trim() || undefined,
        scope: exportDraft.scope,
      });
      if (!text.trim()) {
        showNotification(
          exportDraft.scope === 'pending'
            ? tx('当前没有可导出的未激活 key', 'There are no pending keys to export')
            : tx('当前没有可导出的客户端 key', 'There are no client keys to export'),
          'warning'
        );
        return;
      }
      downloadTxt(text, exportDraft.scope);
      showNotification(tx('客户端 key TXT 已导出', 'Client key TXT exported'), 'success');
      resetExport();
    } catch (saveError) {
      const message = errorMessage(saveError) || tx('导出失败', 'Export failed');
      setExportError(message);
      showNotification(message, 'error');
    } finally {
      setExportSaving(false);
    }
  };

  const handleDelete = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    showConfirmation({
      title: tx('删除客户端 key', 'Delete client key'),
      message: tx('确定要删除这个客户端 key 吗？', 'Are you sure you want to delete this client key?'),
      variant: 'danger',
      confirmText: tx('确认', 'Confirm'),
      onConfirm: async () => {
        try {
          await apiKeysApi.delete(index);
          showNotification(tx('客户端 key 已删除', 'Client key deleted'), 'success');
          await loadEntries();
        } catch (deleteError) {
          showNotification(
            errorMessage(deleteError) || tx('删除客户端 key 失败', 'Failed to delete the client key'),
            'error'
          );
        }
      },
    });
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      copied ? tx('已复制到剪贴板', 'Copied to clipboard') : tx('复制失败', 'Copy failed'),
      copied ? 'success' : 'error'
    );
  };

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{tx('客户端 Key', 'Client Keys')}</span>
      <span className={styles.countBadge}>{entries.length}</span>
    </div>
  );

  const exportOptions = [
    { value: 'pending', label: tx('仅未激活 Key', 'Pending keys only') },
    { value: 'all', label: tx('全部 Key', 'All keys') },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{tx('客户端 Key 管理', 'Client Key Management')}</h1>
        <p className={styles.description}>
          {tx(
            '在上一版配额能力基础上管理客户端 key，支持有效期、额度、批量创建，以及按未激活状态导出 TXT。',
            'Manage client keys with quota and validity fields preserved, plus bulk creation and TXT export for pending keys.'
          )}
        </p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            <Button variant="secondary" size="sm" onClick={() => void loadEntries()} loading={loading}>
              {tx('刷新', 'Refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setExportOpen(true);
                setExportError('');
              }}
              disabled={entries.length === 0 || connectionStatus !== 'connected'}
            >
              {tx('导出 TXT', 'Export TXT')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setBatchOpen(true);
                setBatchError('');
              }}
              disabled={connectionStatus !== 'connected'}
            >
              {tx('批量添加', 'Bulk Create')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                resetEditor();
                setDraft(createDraft());
                setEditingIndex(-1);
              }}
              disabled={connectionStatus !== 'connected'}
            >
              {tx('添加 Key', 'Add Key')}
            </Button>
          </div>
        }
      >
        <div className={styles.summaryGrid}>
          {[
            { key: 'total', label: tx('总 Key 数', 'Total keys'), value: summary.total, icon: <IconKey size={18} />, tone: styles.summaryCardTotal },
            { key: 'pending', label: tx('未激活', 'Pending'), value: summary.pending, icon: <IconTimer size={18} />, tone: styles.summaryCardPending },
            { key: 'active', label: tx('已激活', 'Active'), value: summary.active, icon: <IconCheck size={18} />, tone: styles.summaryCardActive },
            { key: 'quota', label: tx('已配置额度', 'Quota configured'), value: summary.quota, icon: <IconDollarSign size={18} />, tone: styles.summaryCardQuota },
          ].map((item) => (
            <div key={item.key} className={`${styles.summaryCard} ${item.tone}`}>
              <div className={styles.summaryIcon}>{item.icon}</div>
              <div className={styles.summaryContent}>
                <div className={styles.summaryLabel}>{item.label}</div>
                <div className={styles.summaryValue}>{formatNumber(item.value, i18n.language)}</div>
              </div>
            </div>
          ))}
        </div>

        {error && <div className={styles.errorBox}>{error}</div>}

        {loading && entries.length === 0 ? (
          <div className={styles.hint}>{tx('加载中...', 'Loading...')}</div>
        ) : entries.length === 0 ? (
          <EmptyState
            title={tx('还没有客户端 Key', 'No client keys yet')}
            description={tx('你可以手动添加，也可以一次批量生成并立即导出。', 'Add one manually or create a batch and export it immediately.')}
            action={
              <div className={styles.emptyActions}>
                <Button
                  onClick={() => {
                    resetEditor();
                    setDraft(createDraft());
                    setEditingIndex(-1);
                  }}
                  disabled={connectionStatus !== 'connected'}
                >
                  {tx('添加 Key', 'Add Key')}
                </Button>
                <Button variant="secondary" onClick={() => setBatchOpen(true)} disabled={connectionStatus !== 'connected'}>
                  {tx('批量添加', 'Bulk Create')}
                </Button>
              </div>
            }
          />
        ) : (
          <div className={styles.cardGrid}>
            {entries.map((entry, index) => {
              const tone =
                entry.expired || entry.quotaExceeded
                  ? styles.stateExpired
                  : entry.pendingActivation
                    ? styles.statePending
                    : styles.stateActive;
              const chips = [
                entry.durationDays ? tx(`${entry.durationDays} 天有效期`, `${entry.durationDays}-day validity`) : '',
                (entry.maxConcurrency ?? 0) > 0
                  ? tx(`并发上限 ${entry.maxConcurrency}`, `Concurrency ${entry.maxConcurrency}`)
                  : tx('不限并发', 'Unlimited concurrency'),
                entry.quota?.maxRequests ? tx(`请求上限 ${entry.quota.maxRequests}`, `Max requests ${entry.quota.maxRequests}`) : '',
                entry.quota?.maxTokens ? tx(`Token 上限 ${entry.quota.maxTokens}`, `Max tokens ${entry.quota.maxTokens}`) : '',
                entry.quota?.maxUsd ? tx(`额度上限 $ ${formatUsd(entry.quota.maxUsd, i18n.language)}`, `Max budget $ ${formatUsd(entry.quota.maxUsd, i18n.language)}`) : '',
                entry.remainingRequests !== undefined ? tx(`剩余请求 ${entry.remainingRequests}`, `${entry.remainingRequests} requests left`) : '',
                entry.remainingTokens !== undefined ? tx(`剩余 Tokens ${entry.remainingTokens}`, `${entry.remainingTokens} tokens left`) : '',
                entry.remainingUsd !== undefined ? tx(`剩余额度 $ ${formatUsd(entry.remainingUsd, i18n.language)}`, `$ ${formatUsd(entry.remainingUsd, i18n.language)} left`) : '',
                entry.pendingActivation ? tx('首次成功请求后开始计时', 'Starts on first successful request') : '',
                entry.pricingConfigured ? tx('已启用全局定价', 'Global pricing enabled') : '',
              ].filter(Boolean);

              return (
                <article key={`${entry.apiKey}-${index}`} className={`${styles.apiKeyCard} ${tone}`}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardLead}>
                      <div className={styles.cardIcon}>
                        <IconKey size={18} />
                      </div>
                      <div>
                        <div className={styles.cardEyebrow}>
                          {tx(`客户端 Key #${index + 1}`, `Client Key #${index + 1}`)}
                        </div>
                        <div className={styles.cardTitle}>{maskApiKey(entry.apiKey)}</div>
                      </div>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={`${styles.statePill} ${tone}`}>
                        {entry.pendingActivation
                          ? tx('未激活', 'Pending Activation')
                          : entry.expired
                            ? tx('已过期', 'Expired')
                            : tx('已激活', 'Activated')}
                      </span>
                      {entry.quotaExceeded && (
                        <span className={`${styles.statePill} ${styles.stateQuota}`}>
                          {tx('额度已耗尽', 'Quota Exhausted')}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.detailsGrid}>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>{tx('有效期', 'Validity')}</div>
                      <div className={styles.detailValue}>
                        {entry.durationDays ? tx(`${entry.durationDays} 天`, `${entry.durationDays} days`) : tx('未设置', 'Not set')}
                      </div>
                    </div>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>{tx('并发', 'Concurrency')}</div>
                      <div className={styles.detailValue}>
                        {(entry.maxConcurrency ?? 0) > 0 ? entry.maxConcurrency : tx('不限', 'Unlimited')}
                      </div>
                    </div>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>{tx('激活时间', 'Activated at')}</div>
                      <div className={styles.detailValue}>
                        {entry.activatedAt ? formatDateTime(entry.activatedAt, i18n.language) : tx('未设置', 'Not set')}
                      </div>
                    </div>
                    <div className={styles.detailItem}>
                      <div className={styles.detailLabel}>{tx('到期时间', 'Expires at')}</div>
                      <div className={styles.detailValue}>
                        {entry.expiresAt ? formatDateTime(entry.expiresAt, i18n.language) : tx('未设置', 'Not set')}
                      </div>
                    </div>
                  </div>

                  <div className={styles.metricsGrid}>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>{tx('已用请求数', 'Requests used')}</div>
                      <div className={styles.metricValue}>{formatNumber(entry.usage.totalRequests, i18n.language)}</div>
                    </div>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>{tx('已用 Tokens', 'Tokens used')}</div>
                      <div className={styles.metricValue}>{formatNumber(entry.usage.totalTokens, i18n.language)}</div>
                    </div>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>{tx('已用美元额度', 'USD used')}</div>
                      <div className={styles.metricValue}>${formatUsd(entry.usage.totalCostUsd, i18n.language)}</div>
                    </div>
                  </div>

                  <div className={styles.chipRow}>
                    {(chips.length ? chips : [tx('未设置额度限制', 'No quota limits configured')]).map((chip) => (
                      <span key={`${entry.apiKey}-${chip}`} className={`${styles.infoChip} ${styles.infoChipAccent}`}>
                        {chip}
                      </span>
                    ))}
                  </div>

                  <div className={styles.cardActions}>
                    <Button variant="secondary" size="sm" onClick={() => void handleCopy(entry.apiKey)}>
                      {tx('复制', 'Copy')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditingIndex(index);
                        setDraft(buildDraftFromEntry(entry));
                        setFormError('');
                      }}
                      disabled={connectionStatus !== 'connected'}
                    >
                      {tx('编辑', 'Edit')}
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(index)} disabled={connectionStatus !== 'connected'}>
                      {tx('删除', 'Delete')}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={editingIndex !== null}
        onClose={resetEditor}
        closeDisabled={saving}
        title={editingIndex !== null && editingIndex >= 0 ? tx('编辑客户端 Key', 'Edit Client Key') : tx('添加客户端 Key', 'Add Client Key')}
        width={840}
        footer={
          <>
            <Button variant="secondary" onClick={resetEditor} disabled={saving}>
              {tx('取消', 'Cancel')}
            </Button>
            <Button onClick={() => void saveEntry()} loading={saving}>
              {editingIndex !== null && editingIndex >= 0 ? tx('保存', 'Save') : tx('添加', 'Add')}
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.apiKeyInputGroup}>
            <Input
              label={tx('客户端 Key', 'Client key')}
              value={draft.apiKey}
              onChange={(event) => {
                setDraft((current) => ({ ...current, apiKey: event.currentTarget.value }));
                setFormError('');
              }}
              placeholder="sk-..."
              disabled={saving}
            />
            <div className={styles.generateBox}>
              <div className={styles.generateLabel}>{tx('快速生成', 'Quick generate')}</div>
              <Button variant="secondary" size="sm" onClick={() => setDraft((current) => ({ ...current, apiKey: randomKey() }))} disabled={saving}>
                {tx('生成安全 Key', 'Generate secure key')}
              </Button>
            </div>
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>{tx('有效期与并发', 'Validity and concurrency')}</div>
                <div className={styles.sectionHint}>
                  {tx('有效期从首次成功请求开始计算；修改 key 本身时，激活时间会在后端重置。', 'Validity starts on the first successful request. If the key value changes, activation time should reset on the backend.')}
                </div>
              </div>
            </div>
            <div className={styles.fieldsGrid}>
              <Input label={tx('有效天数', 'Validity days')} type="number" min="1" value={draft.durationDays} onChange={(event) => setDraft((current) => ({ ...current, durationDays: event.currentTarget.value }))} disabled={saving} />
              <Input label={tx('并发上限', 'Concurrency limit')} type="number" min="0" value={draft.maxConcurrency} onChange={(event) => setDraft((current) => ({ ...current, maxConcurrency: event.currentTarget.value }))} disabled={saving} />
            </div>
            <div className={styles.quickButtons}>
                {['1', '7', '30'].map((day) => (
                <Button key={day} type="button" variant="secondary" size="sm" onClick={() => setDraft((current) => ({ ...current, durationDays: day }))} disabled={saving}>
                  {tx(`${day} 天`, `${day} Day${day === '1' ? '' : 's'}`)}
                </Button>
              ))}
            </div>
            {currentEntry && (
              <div className={styles.modalStatusGrid}>
                <div className={styles.modalStatusItem}>
                  <div className={styles.detailLabel}>{tx('当前激活时间', 'Current activated at')}</div>
                  <div className={styles.detailValue}>
                    {currentEntry.activatedAt ? formatDateTime(currentEntry.activatedAt, i18n.language) : tx('未设置', 'Not set')}
                  </div>
                </div>
                <div className={styles.modalStatusItem}>
                  <div className={styles.detailLabel}>{tx('当前到期时间', 'Current expires at')}</div>
                  <div className={styles.detailValue}>
                    {currentEntry.expiresAt ? formatDateTime(currentEntry.expiresAt, i18n.language) : tx('未设置', 'Not set')}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionTitle}>{tx('额度配置', 'Quota settings')}</div>
                <div className={styles.sectionHint}>
                  {tx('这里保留请求数、Token 和美元额度字段；模型单价仍由全局配额配置统一维护。', 'Request, token, and USD quota fields stay here. Model pricing remains globally managed elsewhere.')}
                </div>
              </div>
            </div>
            <div className={styles.quotaGrid}>
              <Input label={tx('请求数上限', 'Max requests')} type="number" min="0" value={draft.maxRequests} onChange={(event) => setDraft((current) => ({ ...current, maxRequests: event.currentTarget.value }))} disabled={saving} />
              <Input label={tx('Token 上限', 'Max tokens')} type="number" min="0" value={draft.maxTokens} onChange={(event) => setDraft((current) => ({ ...current, maxTokens: event.currentTarget.value }))} disabled={saving} />
              <Input label={tx('美元额度上限', 'Max USD budget')} type="number" min="0" step="0.01" value={draft.maxUsd} onChange={(event) => setDraft((current) => ({ ...current, maxUsd: event.currentTarget.value }))} disabled={saving} />
            </div>
          </div>

          {formError && <div className={styles.errorBox}>{formError}</div>}
        </div>
      </Modal>

      <Modal
        open={batchOpen}
        onClose={resetBatch}
        closeDisabled={batchSaving}
        title={tx('批量添加客户端 Key', 'Bulk Create Client Keys')}
        width={860}
        footer={
          <>
            <Button variant="secondary" onClick={resetBatch} disabled={batchSaving}>
              {tx('取消', 'Cancel')}
            </Button>
            <Button onClick={() => void saveBatch()} loading={batchSaving}>
              {tx('创建并下载 TXT', 'Create and Download TXT')}
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.modalNote}>
            {tx('批量创建会直接在服务器端生成新的客户端 key，并立即导出本次结果。新 key 默认保持未激活状态，直到首次成功请求后开始计时。', 'Bulk creation generates new client keys on the server and immediately exports the result. New keys stay pending until the first successful request activates them.')}
          </div>
          <div className={styles.sectionCard}>
            <div className={styles.validityGrid}>
              <Input label={tx('生成数量', 'Count')} type="number" min="1" max="500" value={batchDraft.count} onChange={(event) => setBatchDraft((current) => ({ ...current, count: event.currentTarget.value }))} disabled={batchSaving} />
              <div className={styles.quickActionGroup}>
                <div className={styles.generateLabel}>{tx('快捷数量', 'Quick count')}</div>
                <div className={styles.quickButtons}>
                  {['10', '50', '100'].map((count) => (
                    <Button key={count} type="button" variant="secondary" size="sm" onClick={() => setBatchDraft((current) => ({ ...current, count }))} disabled={batchSaving}>
                      {count}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className={styles.sectionCard}>
            <div className={styles.fieldsGrid}>
              <Input label={tx('有效天数', 'Validity days')} type="number" min="1" value={batchDraft.durationDays} onChange={(event) => setBatchDraft((current) => ({ ...current, durationDays: event.currentTarget.value }))} disabled={batchSaving} />
              <Input label={tx('并发上限', 'Concurrency limit')} type="number" min="0" value={batchDraft.maxConcurrency} onChange={(event) => setBatchDraft((current) => ({ ...current, maxConcurrency: event.currentTarget.value }))} disabled={batchSaving} />
            </div>
            <div className={styles.quickButtons}>
              {['1', '3', '7'].map((day) => (
                <Button key={day} type="button" variant="secondary" size="sm" onClick={() => setBatchDraft((current) => ({ ...current, durationDays: day }))} disabled={batchSaving}>
                  {tx(`${day} 天`, `${day} Day${day === '1' ? '' : 's'}`)}
                </Button>
              ))}
            </div>
          </div>
          <div className={styles.sectionCard}>
            <div className={styles.quotaGrid}>
              <Input label={tx('请求数上限', 'Max requests')} type="number" min="0" value={batchDraft.maxRequests} onChange={(event) => setBatchDraft((current) => ({ ...current, maxRequests: event.currentTarget.value }))} disabled={batchSaving} />
              <Input label={tx('Token 上限', 'Max tokens')} type="number" min="0" value={batchDraft.maxTokens} onChange={(event) => setBatchDraft((current) => ({ ...current, maxTokens: event.currentTarget.value }))} disabled={batchSaving} />
              <Input label={tx('美元额度上限', 'Max USD budget')} type="number" min="0" step="0.01" value={batchDraft.maxUsd} onChange={(event) => setBatchDraft((current) => ({ ...current, maxUsd: event.currentTarget.value }))} disabled={batchSaving} />
            </div>
          </div>
          <div className={styles.sectionCard}>
            <Input label={tx('导出展示前缀', 'Export display prefix')} value={batchDraft.exportPrefix} onChange={(event) => setBatchDraft((current) => ({ ...current, exportPrefix: event.currentTarget.value }))} disabled={batchSaving} hint={tx('可选，不能包含空格。填写后导出格式为“前缀 空格 key”。', 'Optional. Must not contain spaces. When set, each line becomes "prefix key".')} />
          </div>
          {batchError && <div className={styles.errorBox}>{batchError}</div>}
        </div>
      </Modal>

      <Modal
        open={exportOpen}
        onClose={resetExport}
        closeDisabled={exportSaving}
        title={tx('导出客户端 Key', 'Export Client Keys')}
        width={720}
        footer={
          <>
            <Button variant="secondary" onClick={resetExport} disabled={exportSaving}>
              {tx('取消', 'Cancel')}
            </Button>
            <Button onClick={() => void exportKeys()} loading={exportSaving}>
              {tx('下载 TXT', 'Download TXT')}
            </Button>
          </>
        }
      >
        <div className={styles.modalBody}>
          <div className={styles.modalNote}>
            {tx('默认导出未激活 key，适合发卡。也可以切换为导出全部 key。填写展示前缀后，每一行会导出为“前缀 空格 key”。', 'Export pending keys by default for distribution. You can also export all keys. When a display prefix is set, each line becomes "prefix key".')}
          </div>
          <div className={styles.sectionCard}>
            <div className="form-group">
              <label>{tx('导出范围', 'Export scope')}</label>
              <Select value={exportDraft.scope} options={exportOptions} onChange={(value) => setExportDraft((current) => ({ ...current, scope: value as ApiKeyExportScope }))} />
            </div>
            <Input label={tx('导出展示前缀', 'Export display prefix')} value={exportDraft.exportPrefix} onChange={(event) => setExportDraft((current) => ({ ...current, exportPrefix: event.currentTarget.value }))} disabled={exportSaving} hint={tx('可选，不能包含空格。', 'Optional. Must not contain spaces.')} />
          </div>
          {exportError && <div className={styles.errorBox}>{exportError}</div>}
        </div>
      </Modal>
    </div>
  );
}
