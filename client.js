/**
 * Client half of the GLM Coding Plan quota monitor.
 *
 * - Settings page (left settings column, "GLM 额度查询"): the detailed view —
 *   plan level, per-window used/remaining with bars, absolute reset times
 *   with countdowns, built-in tool breakdown, a refresh button, and a button
 *   to manually set the auto-refresh frequency (persisted in localStorage).
 * - Composer dock: a minimal line showing only remaining quota and the
 *   time until reset.
 *
 * A single page-level store performs the polling so the dock and the settings
 * page share one source of truth and never double-fetch. Data comes from the
 * same-origin route served by the Host half; styles use only --dsw-alias-*
 * theme tokens so light/dark follows the host.
 */
window.__ModuleLoader__.load({
  id: '@local/glm-quota-monitor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const ROUTE_PATH = '/glm-quota-usage';

    const FREQ_KEY = 'glm-quota-monitor.refreshMs';
    const DEFAULT_FREQ = 5 * 60 * 1000;
    const REFRESH_OPTIONS = [
      { ms: 60 * 1000, zh: '1 分钟', en: '1 min' },
      { ms: 5 * 60 * 1000, zh: '5 分钟', en: '5 min' },
      { ms: 15 * 60 * 1000, zh: '15 分钟', en: '15 min' },
      { ms: 30 * 60 * 1000, zh: '30 分钟', en: '30 min' },
      { ms: 60 * 60 * 1000, zh: '1 小时', en: '1 hour' },
      { ms: 3 * 60 * 60 * 1000, zh: '3 小时', en: '3 hours' },
      { ms: 0, zh: '关闭（仅手动）', en: 'Off (manual)' },
    ];

    const T = {
      zh: {
        label: 'GLM 额度查询',
        dock5h: '5h',
        dockWeek: '周',
        w5h: '5 小时窗口',
        week: '本周窗口',
        tools: '内置工具 · 30 天',
        remaining: '剩',
        resetIn: '后重置',
        used: '已用',
        left: '剩余',
        resetTime: '重置时间',
        lastUpdated: '更新于',
        refresh: '刷新',
        freq: '更新频率',
        retry: '重试',
        error: '获取失败',
        total: '共',
        times: '次',
        details: '明细',
        noData: '上游未返回数据',
        plan: '套餐',
      },
      en: {
        label: 'GLM Quota Query',
        dock5h: '5h',
        dockWeek: 'Week',
        w5h: '5-hour window',
        week: 'Weekly window',
        tools: 'Built-in tools · 30d',
        remaining: 'left',
        resetIn: 'until reset',
        used: 'Used',
        left: 'Remaining',
        resetTime: 'Resets at',
        lastUpdated: 'Updated',
        refresh: 'Refresh',
        freq: 'Refresh',
        retry: 'Retry',
        error: 'Failed to load',
        total: 'of',
        times: '',
        details: 'Breakdown',
        noData: 'No data returned',
        plan: 'Plan',
      },
    };

    const CSS = [
      // dock (minimal line)
      '.gqm-root{display:flex;align-items:center;gap:10px;font-size:12px;line-height:1.4;',
      'color:var(--dsw-alias-label-secondary);padding:2px 4px;min-width:0;flex-wrap:wrap}',
      '.gqm-cell{white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.gqm-cell b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.gqm-sep{opacity:.4}',
      // settings detail page
      '.gqmd-page{display:flex;flex-direction:column;gap:16px;padding:4px 2px 24px}',
      '.gqmd-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.gqmd-plan{font-size:12px;font-weight:700;letter-spacing:.06em;padding:2px 8px;border-radius:6px;',
      'color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.gqmd-updated{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.gqmd-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;',
      'color:var(--dsw-alias-brand-primary);padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1)}',
      '.gqmd-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.gqmd-btn:disabled{opacity:.4;cursor:default}',
      '.gqmd-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:10px;',
      'background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
      '.gqmd-card h3{margin:0;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.gqmd-row{display:flex;align-items:baseline;gap:8px;font-size:13px;flex-wrap:wrap}',
      '.gqmd-num{font-variant-numeric:tabular-nums;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.gqmd-sub{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.gqmd-bar{position:relative;width:100%;height:8px;border-radius:4px;overflow:hidden;',
      'background:var(--dsw-alias-bg-layer-2)}',
      '.gqmd-fill{position:absolute;top:0;bottom:0;left:0;border-radius:4px}',
      '.gqmd-list{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.gqmd-chip{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2)}',
      '.gqmd-err{color:var(--dsw-alias-state-error-primary);font-size:13px}',
      '.gqmd-icon-spin{animation:gqmd-rot 1s linear infinite;transform-origin:center}',
      '@keyframes gqmd-rot{to{transform:rotate(360deg)}}',
      // frequency dropdown
      '.gqmd-freq-wrap{position:relative;display:inline-flex}',
      '.gqmd-caret{transition:transform .15s ease}',
      '.gqmd-caret-open{transform:rotate(180deg)}',
      '.gqmd-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:50;min-width:150px;padding:4px;',
      'background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;',
      'box-shadow:0 6px 20px rgba(0,0,0,.18)}',
      '.gqmd-menu-item{all:unset;cursor:pointer;display:block;width:100%;box-sizing:border-box;padding:6px 10px;',
      'border-radius:6px;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.gqmd-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.gqmd-menu-item-on{color:var(--dsw-alias-brand-primary);font-weight:600}',
    ].join('');

    /* ---------------- page-level quota store (single poller) ---------------- */

    function readFreq() {
      try {
        const raw = window.localStorage.getItem(FREQ_KEY);
        if (raw == null) return DEFAULT_FREQ;
        const n = Number(raw);
        return REFRESH_OPTIONS.some((o) => o.ms === n) ? n : DEFAULT_FREQ;
      } catch {
        return DEFAULT_FREQ;
      }
    }

    const store = {
      started: false,
      phase: 'loading',
      data: null,
      message: null,
      freq: readFreq(),
      inFlight: false,
      timer: null,
      listeners: new Set(),
    };

    function emit() {
      store.listeners.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    }

    function fetchNow() {
      if (store.inFlight) return;
      store.inFlight = true;
      store.phase = store.data ? 'refreshing' : 'loading';
      emit();
      load()
        .then((r) => {
          if (r.ok) {
            store.data = r.data;
            store.message = null;
            store.phase = 'ready';
          } else {
            store.data = null;
            store.message = r.message;
            store.phase = 'error';
          }
          store.inFlight = false;
          emit();
        })
        .catch(() => {
          store.data = null;
          store.message = null;
          store.phase = 'error';
          store.inFlight = false;
          emit();
        });
    }

    function scheduleTimer() {
      if (store.timer) {
        clearInterval(store.timer);
        store.timer = null;
      }
      if (store.freq > 0) store.timer = setInterval(fetchNow, store.freq);
    }

    function startStore() {
      if (store.started) return;
      store.started = true;
      fetchNow();
      scheduleTimer();
    }

    function setFreq(ms) {
      if (!REFRESH_OPTIONS.some((o) => o.ms === ms)) return;
      store.freq = ms;
      try {
        window.localStorage.setItem(FREQ_KEY, String(ms));
      } catch {}
      scheduleTimer();
      emit();
    }

    function subscribeStore(fn) {
      store.listeners.add(fn);
      return () => store.listeners.delete(fn);
    }

    async function load() {
      const res = await fetch(ROUTE_PATH, { cache: 'no-store' });
      const body = await res.json();
      return body && body.ok === true
        ? { ok: true, data: body }
        : { ok: false, message: (body && (body.message || body.error)) || null };
    }

    function useQuota() {
      const [, force] = React.useReducer((x) => x + 1, 0);
      React.useEffect(() => {
        startStore();
        const un = subscribeStore(force);
        return un;
      }, []);
      // Re-render every 30s so reset countdowns stay fresh between polls.
      React.useEffect(() => {
        const timer = setInterval(force, 30000);
        return () => clearInterval(timer);
      }, []);
      return {
        phase: store.phase,
        data: store.data,
        message: store.message,
        refresh: fetchNow,
        freq: store.freq,
        setFreq,
      };
    }

    /* ---------------- shared helpers ---------------- */

    function tone(used) {
      if (used >= 85) return 'var(--dsw-alias-state-error-primary)';
      if (used >= 60) return 'var(--dsw-alias-state-warn-primary)';
      return 'var(--dsw-alias-state-success-primary)';
    }

    function remaining(used) {
      return typeof used === 'number' ? Math.max(0, 100 - Math.round(used)) : null;
    }

    function langOf(ctx) {
      try {
        const snap = ctx.locale && ctx.locale.getSnapshot ? ctx.locale.getSnapshot() : null;
        const id = (snap && (snap.locale || snap.id || snap.current)) || '';
        return typeof id === 'string' && id.toLowerCase().startsWith('en') ? 'en' : 'zh';
      } catch {
        return 'zh';
      }
    }

    function useLang(ctx) {
      const [lang, setLang] = React.useState(() => langOf(ctx));
      React.useEffect(() => {
        try {
          if (!ctx.locale || !ctx.locale.subscribe) return undefined;
          return ctx.locale.subscribe(() => setLang(langOf(ctx)));
        } catch {
          return undefined;
        }
      }, [ctx]);
      return lang;
    }

    function fmtCountdown(ms, lang) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
      const totalMin = Math.max(1, Math.round(ms / 60000));
      const d = Math.floor(totalMin / 1440);
      const hh = Math.floor((totalMin % 1440) / 60);
      const mm = totalMin % 60;
      if (lang === 'en') {
        if (d > 0) return d + 'd' + (hh ? hh + 'h' : '');
        if (hh > 0) return hh + 'h' + (mm ? mm + 'm' : '');
        return mm + 'm';
      }
      if (d > 0) return d + '天' + (hh ? hh + '小时' : '');
      if (hh > 0) return hh + '小时' + (mm ? mm + '分' : '');
      return mm + '分钟';
    }

    function fmtAbsolute(ms, lang) {
      if (typeof ms !== 'number' || !ms) return '';
      try {
        return new Date(ms).toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        return '';
      }
    }

    function RefreshIcon(spin) {
      return h(
        'svg',
        {
          className: spin ? 'gqmd-icon-spin' : undefined,
          width: 12,
          height: 12,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M21 12a9 9 0 1 1-2.64-6.36' }),
        h('path', { d: 'M21 3v6h-6' }),
      );
    }

    function CaretIcon(open) {
      return h(
        'svg',
        {
          className: 'gqmd-caret' + (open ? ' gqmd-caret-open' : ''),
          width: 10,
          height: 10,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('path', { d: 'M6 9l6 6 6-6' }),
      );
    }

    /* ---------------- Composer dock: remaining quota + reset time only ---------------- */

    function Dock(props) {
      const ctx = props.ctx;
      const lang = useLang(ctx);
      const t = T[lang] || T.zh;
      const { phase, data } = useQuota();
      const w = data && data.windows ? data.windows : null;
      const now = Date.now();

      const cells = [];
      const push = (text, sub) => {
        if (text == null) return;
        cells.push(
          h('span', { className: 'gqm-cell', key: cells.length },
            h('b', null, text),
            sub ? h('span', null, ' ' + sub) : null,
          ),
        );
      };
      if (phase === 'error') {
        push(t.error);
      } else if (w) {
        // Token windows only: remaining quota + time until reset. Tool usage
        // lives in the settings page.
        const cell = (label, used, resetAt) => {
          const r = remaining(used);
          const cd = fmtCountdown(resetAt ? resetAt - now : NaN, lang);
          if (r == null) return;
          push((label ? label + ' ' : '') + t.remaining + ' ' + r + '%', cd ? cd + ' ' + t.resetIn : null);
        };
        if (w.tokens5h) cell(t.dock5h, w.tokens5h.percentUsed, w.tokens5h.resetAt);
        if (w.tokensWeek) cell(t.dockWeek, w.tokensWeek.percentUsed, w.tokensWeek.resetAt);
      }
      const children = [h('style', null, CSS)];
      if (cells.length === 0) {
        children.push(h('span', { className: 'gqm-cell' }, '…'));
      } else {
        cells.forEach((c, i) => {
          children.push(c);
          if (i < cells.length - 1) children.push(h('span', { className: 'gqm-sep', key: 's' + i }, '·'));
        });
      }
      return h('div', { className: 'gqm-root' }, children);
    }

    /* ---------------- frequency selector ---------------- */

    function FreqButton(props) {
      const { freq, setFreq, lang, t } = props;
      const [open, setOpen] = React.useState(false);
      const current = REFRESH_OPTIONS.find((o) => o.ms === freq) || REFRESH_OPTIONS[1];
      const label = lang === 'en' ? current.en : current.zh;
      const close = () => setOpen(false);
      return h('span', { className: 'gqmd-freq-wrap' },
        h('button', {
          className: 'gqmd-btn',
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: () => setOpen(!open),
        }, t.freq, ': ', label, CaretIcon(open)),
        open
          ? h(React.Fragment, null,
              // transparent backdrop to close on outside click
              h('div', {
                style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 49 },
                onClick: close,
              }),
              h('div', { className: 'gqmd-menu', role: 'menu' },
                REFRESH_OPTIONS.map((o) =>
                  h('button', {
                    key: o.ms,
                    role: 'menuitemradio',
                    'aria-checked': o.ms === freq,
                    className: 'gqmd-menu-item' + (o.ms === freq ? ' gqmd-menu-item-on' : ''),
                    onClick: () => {
                      setFreq(o.ms);
                      close();
                    },
                  }, (o.ms === freq ? '✓ ' : '') + (lang === 'en' ? o.en : o.zh)),
                )),
            )
          : null,
      );
    }

    /* ---------------- Settings page: full details ---------------- */

    function WindowCard(props) {
      const { title, win, lang, t } = props;
      const used = typeof win.percentUsed === 'number' ? Math.round(win.percentUsed) : null;
      const left = remaining(win.percentUsed);
      const cd = fmtCountdown(win.resetAt ? win.resetAt - Date.now() : NaN, lang);
      return h(
        'section',
        { className: 'gqmd-card' },
        h('h3', null, title),
        h('div', { className: 'gqmd-bar', role: 'img', 'aria-label': title + ' ' + (used ?? '') + '%' },
          h('span', {
            className: 'gqmd-fill',
            style: { width: (used ?? 0) + '%', background: used == null ? 'var(--dsw-alias-label-secondary)' : tone(used) },
          })),
        h('div', { className: 'gqmd-row' },
          h('span', { className: 'gqmd-num' }, t.left + ' ' + (left == null ? '—' : left + '%')),
          h('span', { className: 'gqmd-sub' }, t.used + ' ' + (used == null ? '—' : used + '%')),
        ),
        h('div', { className: 'gqmd-row' },
          h('span', { className: 'gqmd-sub' }, t.resetTime + ' ' + fmtAbsolute(win.resetAt, lang)),
          cd ? h('span', { className: 'gqmd-sub' }, '（' + cd + ' ' + t.resetIn + '）') : null,
        ),
      );
    }

    function Detail(props) {
      const ctx = props.ctx;
      const lang = useLang(ctx);
      const t = T[lang] || T.zh;
      const { phase, data, message, refresh, freq, setFreq } = useQuota();
      const d = data;
      const w = d && d.windows ? d.windows : null;

      return h('div', { className: 'gqmd-page' },
        h('style', null, CSS),
        h('div', { className: 'gqmd-head' },
          d && d.plan ? h('span', { className: 'gqmd-plan' }, String(d.plan).toUpperCase()) : null,
          d && d.fetchedAt ? h('span', { className: 'gqmd-updated' }, t.lastUpdated + ' ' + fmtAbsolute(d.fetchedAt, lang)) : null,
          h(FreqButton, { freq, setFreq, lang, t }),
          h('button', { className: 'gqmd-btn', onClick: refresh, disabled: phase === 'loading' },
            RefreshIcon(phase === 'loading'), t.refresh),
        ),
        phase === 'error'
          ? h('div', { className: 'gqmd-card' },
              h('div', { className: 'gqmd-err' }, message || t.error),
              h('button', { className: 'gqmd-btn', onClick: refresh }, t.retry))
          : !w
            ? h('div', { className: 'gqmd-sub' }, '…')
            : null,
        w && w.tokens5h ? h(WindowCard, { title: t.w5h, win: w.tokens5h, lang, t }) : null,
        w && w.tokensWeek ? h(WindowCard, { title: t.week, win: w.tokensWeek, lang, t }) : null,
        w && w.tools
          ? h('section', { className: 'gqmd-card' },
              h('h3', null, t.tools),
              h('div', { className: 'gqmd-row' },
                h('span', { className: 'gqmd-num' },
                  t.left + ' ' + (w.tools.remaining != null ? w.tools.remaining : '—') + (t.times ? ' ' + t.times : '')),
                h('span', { className: 'gqmd-sub' },
                  t.used + ' ' + (w.tools.used != null ? w.tools.used : '—') + ' ' + t.total + ' ' +
                    (w.tools.used != null && w.tools.remaining != null ? w.tools.used + w.tools.remaining : '—')),
              ),
              w.tools.details.length
                ? h('div', { className: 'gqmd-list' },
                    h('span', null, t.details + ':'),
                    h('span', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                      w.tools.details.map((x) =>
                        h('span', { className: 'gqmd-chip', key: x.name }, x.name + ': ' + (x.usage ?? 0)),
                      )))
                : null)
          : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // Detailed page in the settings left column.
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'glm-quota-monitor', order: 30, label: () => (langOf(ctx) === 'en' ? T.en.label : T.zh.label) },
            function SettingsPage(props) {
              return h(Detail, { ...props, ctx });
            },
          ),
        );
        // Minimal composer dock: remaining quota + reset time only.
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'glm-quota-monitor', order: 5 }, function DockEntry(props) {
            return h(Dock, { ...props, ctx });
          }),
        );
      },
    };
  },
});
