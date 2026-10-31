/**
 * Host half of the GLM Coding Plan quota monitor bundle.
 *
 * - Serves the normalized quota snapshot to the composer widget at
 *   GET /glm-quota (same-origin, loopback listener only).
 * - Exposes the same snapshot to the agent as the `glm_quota_check` tool.
 * - The upstream API key resolves per request from the harness credential
 *   store (`ZAI_CODING_CN_API_KEY`); it is never written to configuration and
 *   never included in any response.
 */

const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';
const DEFAULT_CREDENTIAL_REF = 'ZAI_CODING_CN_API_KEY';
const UPSTREAM_TIMEOUT_MS = 15000;
const VERSION = '1.0.5';
const ROUTE_PATH = '/glm-quota-v' + VERSION.replace(/\W/g, '');

/** Optional services: the plugin stays inactive when any is missing. */
export const inject = ['credentials', 'webServer', 'tools'];

function clampPercent(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

/**
 * Normalize the upstream monitor payload. Two TOKENS_LIMIT rows exist and are
 * told apart by `unit`: unit=3 is the 5-hour rolling window, unit=6 the
 * weekly window. `percentage` is the USED share, not the remaining share.
 */
function normalizeQuota(data, fetchedAt) {
  const limits = Array.isArray(data && data.limits) ? data.limits : [];
  const find = (type, unit) =>
    limits.find((l) => l && l.type === type && (unit === undefined || l.unit === unit)) || null;

  const tokens5h = find('TOKENS_LIMIT', 3);
  const tokensWeek = find('TOKENS_LIMIT', 6);
  const tools = find('TIME_LIMIT');

  return {
    ok: true,
    plan: (data && data.level) || null,
    fetchedAt,
    windows: {
      tokens5h: tokens5h
        ? { percentUsed: clampPercent(tokens5h.percentage), resetAt: tokens5h.nextResetTime ?? null }
        : null,
      tokensWeek: tokensWeek
        ? { percentUsed: clampPercent(tokensWeek.percentage), resetAt: tokensWeek.nextResetTime ?? null }
        : null,
      tools: tools
        ? {
            percentUsed: clampPercent(tools.percentage),
            used: typeof tools.currentValue === 'number' ? tools.currentValue : null,
            remaining: typeof tools.remaining === 'number' ? tools.remaining : null,
            details: Array.isArray(tools.usageDetails)
              ? tools.usageDetails
                  .filter((d) => d && d.modelCode)
                  .map((d) => ({ name: String(d.modelCode), usage: typeof d.usage === 'number' ? d.usage : null }))
              : [],
          }
        : null,
    },
  };
}

/** Human-readable one-line summary used as the agent tool result. */
function describeQuota(snapshot) {
  if (!snapshot || snapshot.ok !== true) {
    return 'GLM Coding Plan 额度查询失败：' + ((snapshot && snapshot.message) || '未知错误');
  }
  const w = snapshot.windows || {};
  const parts = [];
  const pct = (v) => (v == null ? '未知' : Math.round(v) + '%');
  const resetSuffix = (ms) => {
    if (typeof ms !== 'number' || !ms) return '';
    const diff = ms - Date.now();
    if (diff <= 0) return '';
    const m = Math.max(1, Math.round(diff / 60000));
    if (m >= 1440) return '，约' + Math.round(m / 1440) + '天后重置';
    if (m >= 60) return '，约' + Math.floor(m / 60) + '小时' + (m % 60 ? (m % 60) + '分' : '') + '后重置';
    return '，约' + m + '分钟后重置';
  };
  if (w.tokens5h) parts.push('5小时窗口已用 ' + pct(w.tokens5h.percentUsed) + resetSuffix(w.tokens5h.resetAt));
  if (w.tokensWeek) parts.push('本周窗口已用 ' + pct(w.tokensWeek.percentUsed) + resetSuffix(w.tokensWeek.resetAt));
  if (w.tools) {
    const details = w.tools.details.length
      ? '（' + w.tools.details.map((d) => d.name + ':' + (d.usage ?? '?')).join('、') + '）'
      : '';
    parts.push(
      '内置工具30天：已用 ' + (w.tools.used ?? '?') + ' 次，剩余 ' + (w.tools.remaining ?? '?') + ' 次' + details,
    );
  }
  const plan = snapshot.plan ? '（套餐 ' + String(snapshot.plan).toUpperCase() + '）' : '';
  return 'GLM Coding Plan 额度' + plan + '：' + (parts.join('；') || '上游未返回窗口数据');
}

export function apply(ctx, config) {
  const row = config && typeof config === 'object' ? config : {};
  const endpoint =
    typeof row.endpoint === 'string' && row.endpoint.startsWith('https://') ? row.endpoint : DEFAULT_ENDPOINT;
  const credentialRef =
    typeof row.credentialRef === 'string' && row.credentialRef.trim() !== ''
      ? row.credentialRef.trim()
      : DEFAULT_CREDENTIAL_REF;
  const apiKeyOverride =
    typeof row.apiKey === 'string' && row.apiKey.trim() !== '' ? row.apiKey.trim() : undefined;

  /** Resolve per call so a rotated key applies on the next request. */
  async function resolveApiKey() {
    if (apiKeyOverride) return apiKeyOverride;
    try {
      const hit = await ctx.credentials.resolve(credentialRef);
      const value = hit && typeof hit.value === 'string' ? hit.value.trim() : '';
      if (value !== '') return value;
    } catch (error) {
      ctx.logger?.warn?.(
        'glm-quota-monitor: credential resolve failed: ' + (error instanceof Error ? error.message : String(error)),
      );
    }
    const env = process.env?.[credentialRef];
    return typeof env === 'string' && env.trim() !== '' ? env.trim() : undefined;
  }

  /** Never throws: every failure becomes { ok: false, message }. */
  async function fetchQuotaSnapshot() {
    let key;
    try {
      key = await resolveApiKey();
    } catch (error) {
      return { ok: false, error: 'key_resolve_failed', message: String(error?.message ?? error) };
    }
    if (!key) {
      return {
        ok: false,
        error: 'no_api_key',
        message: '未找到智谱 API Key：请在凭据 ' + credentialRef + ' 中配置，或在插件配置里提供 apiKey',
      };
    }
    try {
      const signal =
        typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
          : undefined;
      const res = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + key }, signal });
      if (res.status === 401) {
        return { ok: false, error: 'unauthorized', message: 'API Key 无效或已过期（套餐续期后 Key 会变化）' };
      }
      if (!res.ok) {
        return { ok: false, error: 'upstream_' + res.status, message: '上游接口返回 HTTP ' + res.status };
      }
      const body = await res.json();
      if (!body || body.success !== true) {
        return { ok: false, error: 'upstream_rejected', message: '上游接口返回 success=false' };
      }
      return normalizeQuota(body.data ?? {}, Date.now());
    } catch (error) {
      return { ok: false, error: 'fetch_failed', message: String(error?.message ?? error) };
    }
  }

  const safeOrigin = () => {
    try {
      return ctx.webServer.getOrigin();
    } catch {
      return undefined;
    }
  };

  const disposeRoute = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET' });
        res.end();
        return;
      }
      // Same-origin fence: refuse cross-site browser requests (DNS-rebinding /
      // foreign-page reads). Non-browser local callers send no Origin.
      const expected = safeOrigin();
      const origin = req.headers?.origin;
      if (expected && typeof origin === 'string' && origin !== expected) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden', message: 'cross-origin request refused' }));
        return;
      }
      const snapshot = await fetchQuotaSnapshot();
      const body = { ...snapshot, v: VERSION };
      if (diagnostics.toolError) body.diag = diagnostics;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    },
  });

  // Same snapshot as an agent tool. Registration is guarded: a failure is
  // recorded and surfaced through the route's diagnostic field instead of
  // failing the whole plugin activation.
  let disposeTool;
  const diagnostics = {};
  try {
    disposeTool = ctx.tools.register({
      name: 'glm_quota_check',
      description:
        '查询 GLM Coding Plan 剩余额度：5 小时窗口与本周窗口的已用百分比、重置时间，以及内置工具 30 天剩余次数。',
      parameters: {},
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: describeQuota(value) }],
      },
      async execute() {
        return await fetchQuotaSnapshot();
      },
    });
  } catch (error) {
    diagnostics.toolError =
      'glm_quota_check registration failed: ' + (error instanceof Error ? error.message : String(error));
    ctx.logger?.warn?.(diagnostics.toolError);
  }

  return () => {
    try {
      disposeRoute();
    } catch {}
    try {
      disposeTool?.();
    } catch {}
  };
}
