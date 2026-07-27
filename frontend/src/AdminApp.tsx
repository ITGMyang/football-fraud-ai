import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';

import { createApiClient, userFacingError } from './api.js';
import {
  createTranslator,
  initialLanguage,
  LANGUAGE_STORAGE_KEY,
  type CopyKey,
  type Language,
  type Translate
} from './adminCopy';
import type {
  Accuracy,
  AccuracyEvaluation,
  Dashboard,
  FixtureContext,
  OrderRow,
  Schedule,
  ScheduleMatch,
  UsageSummary,
  UserRow
} from './adminTypes';
import './admin.css';

type AuthConfig = { enabled?: boolean; supabaseUrl?: string; publishableKey?: string; error?: string };
type ModelCheckRow = { label: string; model: string; provider: string; ok: boolean; status: number; ms: number; message: string };
type ModelCheck = { checkedAt: string; reachable: number; total: number; checks: ModelCheckRow[] };
type TabId = 'overview' | 'data' | 'models' | 'predictions' | 'accuracy' | 'accounts';

const TABS: { id: TabId; label: CopyKey; hint: CopyKey }[] = [
  { id: 'overview', label: 'tabOverview', hint: 'tabOverviewHint' },
  { id: 'data', label: 'tabData', hint: 'tabDataHint' },
  { id: 'models', label: 'tabModels', hint: 'tabModelsHint' },
  { id: 'predictions', label: 'tabPredictions', hint: 'tabPredictionsHint' },
  { id: 'accuracy', label: 'tabAccuracy', hint: 'tabAccuracyHint' },
  { id: 'accounts', label: 'tabAccounts', hint: 'tabAccountsHint' }
];

const CopyContext = createContext<Translate>(createTranslator('en'));
const useT = () => useContext(CopyContext);

const DATE_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
});

function when(value?: string) {
  if (!value) return '—';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? DATE_TIME.format(parsed) : '—';
}

function count(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(value || 0));
}

function money(value: number) {
  return `$${(Number(value) || 0).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function ratio(value: number) {
  return `${Math.round((Number(value) || 0) * 1000) / 10}%`;
}

function fixtureIdOf(match: ScheduleMatch) {
  return String(match.matchId || match.id || '');
}

/* ============ SHARED PIECES ============ */

function Metric({ label, value, note, tone = '' }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className={`a-metric ${tone ? `a-metric--${tone}` : ''}`}>
      <span className="a-metric__label">{label}</span>
      <strong className="a-metric__value">{value}</strong>
      {note && <span className="a-metric__note">{note}</span>}
    </div>
  );
}

function Module({ title, eyebrow, note, action, children }: {
  title: string;
  eyebrow?: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="a-module">
      <header className="a-module__head">
        <div>
          {eyebrow && <span className="a-module__eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
          {note && <p className="a-module__note">{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  const t = useT();
  const rows = Array.isArray(children) ? children.flat() : [children];
  if (!rows.filter(Boolean).length) return <p className="a-empty">{empty || t('noData')}</p>;
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead><tr>{head.map((cell, index) => <th key={`${cell}-${index}`}>{cell}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Status({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; children: React.ReactNode }) {
  return <span className={`a-status a-status--${tone}`}>{children}</span>;
}

function UsageTable({ summary }: { summary: UsageSummary }) {
  const t = useT();
  return (
    <Table head={[t('colModel'), t('colProvider'), t('calls'), t('colInput'), t('colOutput'), t('colTotalTokens'), t('colSpend'), t('colCostSource'), t('errors')]}>
      {summary.models.map((row) => (
        <tr key={`${row.modelName}|${row.provider}`}>
          <td><strong>{row.modelName}</strong></td>
          <td>{row.provider}</td>
          <td>{count(row.requests)}</td>
          <td>{count(row.inputTokens)}</td>
          <td>{count(row.outputTokens)}</td>
          <td>{count(row.totalTokens)}</td>
          <td>{row.costAvailableCalls ? money(row.costUsd) : <Status tone="warn">{t('unpriced')}</Status>}</td>
          <td>
            {row.costReportedCalls > 0 && <Status tone="ok">{t('reported', { n: row.costReportedCalls })}</Status>}
            {row.costEstimatedCalls > 0 && <Status tone="idle">{t('estimated', { n: row.costEstimatedCalls })}</Status>}
            {row.costAvailableCalls === 0 && <Status tone="warn">{t('none')}</Status>}
          </td>
          <td>{row.errors ? <Status tone="bad">{row.errors}</Status> : '0'}</td>
        </tr>
      ))}
    </Table>
  );
}

/* ============ TAB: OVERVIEW ============ */

function OverviewTab({ dashboard }: { dashboard: Dashboard }) {
  const t = useT();
  const { core, orders, users } = dashboard;
  const quotaUsed = core.apiFootballDailyLimit ? core.apiFootballCallsToday / core.apiFootballDailyLimit : 0;
  const refreshTone = core.lastRefreshStatus === 'healthy' ? 'ok'
    : core.lastRefreshStatus === 'warning' ? 'warn'
      : core.lastRefreshStatus === 'running' ? 'idle' : 'bad';
  const periods: ['today' | 'week' | 'month' | 'total', CopyKey][] = [
    ['today', 'today'], ['week', 'last7'], ['month', 'last30'], ['total', 'allTime']
  ];

  return (
    <>
      <div className="a-metrics">
        <Metric
          label={t('apiCallsToday')}
          value={count(core.apiFootballCallsToday)}
          note={core.apiFootballDailyLimit
            ? t('quotaNote', { used: ratio(quotaUsed), limit: count(core.apiFootballDailyLimit) })
            : t('noQuota')}
          tone={quotaUsed > 0.8 ? 'warn' : ''}
        />
        <Metric label={t('modelCallsToday')} value={count(core.modelCallsToday)} note={t('distinctUsers', { n: count(core.modelUsersToday) })} />
        <Metric
          label={t('modelSpendToday')}
          value={money(core.modelCostTodayUsd)}
          note={t('costSplit', { reported: count(core.modelCostReportedCalls), estimated: count(core.modelCostEstimatedCalls) })}
          tone={core.modelCallsToday > core.modelCostAvailableCalls ? 'warn' : ''}
        />
        <Metric
          label={t('requestsToday')}
          value={count(core.predictionRequestsToday)}
          note={t('requestsNote', { cached: count(core.predictionRequestsCachedToday), failed: count(core.predictionRequestErrorsToday) })}
        />
        <Metric label={t('queueActive')} value={count(core.predictionQueueActive)} note={t('queueNote')} />
        <Metric label={t('cachedMatches')} value={count(core.cachedMatches)} note={t('cachedMatchesNote')} />
      </div>

      <Module title={t('cronTitle')} eyebrow={t('cronEyebrow')} note={t('cronNote')}>
        <div className="a-inline">
          <Status tone={refreshTone}>{core.lastRefreshStatus}</Status>
          <span>{t('lastWrite')} {when(core.lastRefreshAt)}</span>
        </div>
      </Module>

      <Module title={t('revenueTitle')} eyebrow={t('billing')}>
        <div className="a-metrics a-metrics--tight">
          {periods.map(([period, key]) => (
            <Metric
              key={period}
              label={t(key)}
              value={`$${(orders.revenue[period]?.amountUsd ?? 0).toFixed(2)}`}
              note={t('orders', { n: count(orders.revenue[period]?.count ?? 0) })}
            />
          ))}
        </div>
      </Module>

      <Module title={t('accountsTitle')} eyebrow={t('users')}>
        <div className="a-metrics a-metrics--tight">
          <Metric label={t('registered')} value={count(users.total)} note={t('newToday', { n: count(users.newToday) })} />
          <Metric label={t('activeToday')} value={count(users.activeToday)} note={t('activeNote', { d7: count(users.active7d), d30: count(users.active30d) })} />
          <Metric label={t('paidAccess')} value={count(users.paid)} note={t('paidNote')} />
          <Metric
            label={t('ordersLabel')}
            value={count(orders.statusCounts.completed)}
            note={t('ordersNote', { pending: count(orders.statusCounts.pending), failed: count(orders.statusCounts.failed) })}
            tone={orders.statusCounts.failed > 0 ? 'warn' : ''}
          />
        </div>
      </Module>
    </>
  );
}

/* ============ TAB: DATA CONSOLE ============ */

function DataConsoleTab({ dashboard, schedules, generatedAt, loading, error, onReload, onOpenFixture }: {
  dashboard: Dashboard;
  schedules: Schedule[];
  generatedAt: string;
  loading: boolean;
  error: string;
  onReload: () => void;
  onOpenFixture: (fixtureId: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [competition, setCompetition] = useState('all');
  const [status, setStatus] = useState('all');

  const competitions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const schedule of schedules) {
      const id = String(schedule.competitionId || '');
      if (!id || seen.has(id)) continue;
      seen.set(id, schedule.matches?.find((match) => match.competition)?.competition || `#${id}`);
    }
    return [...seen.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [schedules]);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return schedules
      .flatMap((schedule) => (schedule.matches || []).map((match) => ({
        schedule,
        match,
        provider: schedule.providerChecks?.[String(match.date || '')] || null
      })))
      .filter(({ schedule, match, provider }) => {
        if (competition !== 'all' && String(schedule.competitionId) !== competition) return false;
        if (status === 'odds' && match.hasOdds !== true) return false;
        if (status === 'no-odds' && match.hasOdds === true) return false;
        if (status === 'delayed' && provider?.status !== 'rate-limited') return false;
        if (!text) return true;
        return [match.home, match.away, fixtureIdOf(match), match.competition]
          .some((value) => String(value || '').toLowerCase().includes(text));
      })
      .sort((left, right) => Date.parse(right.match.kickoff || '') - Date.parse(left.match.kickoff || ''));
  }, [competition, query, schedules, status]);

  const allMatches = schedules.flatMap((schedule) => schedule.matches || []);
  const delayed = schedules.filter((schedule) => Object.values(schedule.providerChecks || {})
    .some((check) => check?.status === 'rate-limited')).length;

  return (
    <>
      <div className="a-metrics">
        <Metric label={t('cachedCompetitions')} value={count(schedules.length)} />
        <Metric label={t('cachedMatches')} value={count(allMatches.length)} />
        <Metric label={t('oddsVerified')} value={count(allMatches.filter((match) => match.hasOdds === true).length)} note={t('oddsVerifiedNote')} />
        <Metric label={t('refreshDelays')} value={count(delayed)} note={t('refreshDelaysNote')} tone={delayed ? 'warn' : ''} />
        <Metric label={t('cacheReadAt')} value={when(generatedAt)} />
      </div>

      <Module
        title={t('scheduleCache')}
        eyebrow="API-Football"
        note={t('scheduleCacheNote')}
        action={<button className="a-btn" type="button" onClick={onReload} disabled={loading}>{loading ? t('loading') : t('reload')}</button>}
      >
        <div className="a-filters">
          <input className="a-input" type="search" value={query} placeholder={t('searchMatch')} onChange={(event) => setQuery(event.target.value)} />
          <select className="a-input" value={competition} onChange={(event) => setCompetition(event.target.value)}>
            <option value="all">{t('allCompetitions')}</option>
            {competitions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="a-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">{t('anyStatus')}</option>
            <option value="odds">{t('statusOdds')}</option>
            <option value="no-odds">{t('statusNoOdds')}</option>
            <option value="delayed">{t('statusDelayed')}</option>
          </select>
          <span className="a-filters__count">{count(rows.length)} {t('rows')}</span>
        </div>

        {error && <p className="a-error" role="alert">{error}</p>}

        <Table
          head={[t('colCompetition'), t('colMatch'), t('colKickoff'), t('colFixtureId'), t('colOdds'), t('colLastCheck'), t('colCachedAt'), '']}
          empty={loading ? t('loadingCache') : t('noRows')}
        >
          {rows.map(({ schedule, match, provider }) => {
            const fixtureId = fixtureIdOf(match);
            return (
              <tr key={`${schedule.competitionId}-${fixtureId}-${match.date}`}>
                <td>
                  <strong>{match.competition || `#${schedule.competitionId}`}</strong>
                  <small>ID {schedule.competitionId}</small>
                </td>
                <td><strong>{match.home}</strong> <span className="a-dim">vs</span> <strong>{match.away}</strong></td>
                <td>{when(match.kickoff)}</td>
                <td><code>{fixtureId}</code></td>
                <td>{match.hasOdds === true ? <Status tone="ok">{t('statusOdds')}</Status> : <Status tone="idle">{t('none')}</Status>}</td>
                <td>
                  {provider?.status === 'rate-limited'
                    ? <Status tone="bad">{t('statusDelayed')}</Status>
                    : provider?.status === 'ready'
                      ? <Status tone="ok">ready</Status>
                      : <Status tone="idle">cached</Status>}
                </td>
                <td>{when(schedule.fetchedAt)}</td>
                <td>
                  <button className="a-btn a-btn--ghost" type="button" onClick={() => onOpenFixture(fixtureId)} disabled={!fixtureId}>
                    {t('inspect')}
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      </Module>

      <Module title={t('competitionUsage')} eyebrow={t('costByLeague')} note={t('competitionUsageNote')}>
        <div className="a-metrics a-metrics--tight">
          <Metric label={t('duplicateFixtures')} value={count(dashboard.leagueAudit.duplicateFixtures)} />
          <Metric label={t('duplicateLeagues')} value={count(dashboard.leagueAudit.duplicateLeagues)} />
          <Metric label={t('needsReview')} value={count(dashboard.leagueAudit.reviewCompetitions)} tone={dashboard.leagueAudit.reviewCompetitions ? 'warn' : ''} />
        </div>
        <Table head={[t('colCompetition'), t('colCached'), t('colImports'), t('colPredictions'), t('colModelCalls'), t('colFailed'), t('colTokens'), '']}>
          {dashboard.leagues.map((league) => (
            <tr key={league.name}>
              <td><strong>{league.name}</strong></td>
              <td>{count(league.cachedMatches)}</td>
              <td>{count(league.imports)}</td>
              <td>{count(league.predictions)}</td>
              <td>{count(league.modelCalls)}</td>
              <td>{league.failedCalls ? <Status tone="bad">{league.failedCalls}</Status> : '0'}</td>
              <td>{count(league.totalTokens)}</td>
              <td>{league.reviewRequired && <Status tone="warn">{t('review')}</Status>}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ TAB: MODELS ============ */

function ModelsTab({ dashboard, onDate, busy, check, checking, checkError, onCheck }: {
  dashboard: Dashboard;
  onDate: (date: string) => void;
  busy: boolean;
  check: ModelCheck | null;
  checking: boolean;
  checkError: string;
  onCheck: () => void;
}) {
  const t = useT();
  const { modelUsage } = dashboard;
  const unpriced = modelUsage.total.calls - modelUsage.total.costAvailableCalls;

  return (
    <>
      <div className="a-metrics">
        <Metric label={t('callsAllTime')} value={count(modelUsage.total.calls)} note={t('distinctUsers', { n: count(modelUsage.total.users) })} />
        <Metric label={t('tokensAllTime')} value={count(modelUsage.total.tokens)} />
        <Metric label={t('spendAllTime')} value={money(modelUsage.total.costUsd)} />
        <Metric
          label={t('unpricedCalls')}
          value={count(unpriced)}
          note={unpriced ? t('unpricedNote') : t('allPriced')}
          tone={unpriced ? 'warn' : 'ok'}
        />
        <Metric label={t('errorsAllTime')} value={count(modelUsage.total.errors)} tone={modelUsage.total.errors ? 'warn' : ''} />
      </div>

      <Module
        title={t('usageByDay')}
        eyebrow={t('perModel')}
        action={
          <select className="a-input" value={modelUsage.selectedDate} onChange={(event) => onDate(event.target.value)} disabled={busy}>
            {(modelUsage.availableDates.length ? modelUsage.availableDates : [modelUsage.selectedDate]).map((date) => (
              <option key={date} value={date}>{date}</option>
            ))}
          </select>
        }
      >
        <div className="a-metrics a-metrics--tight">
          <Metric label={t('calls')} value={count(modelUsage.selected.calls)} />
          <Metric label={t('users')} value={count(modelUsage.selected.users)} />
          <Metric label={t('tokens')} value={count(modelUsage.selected.tokens)} />
          <Metric label={t('spend')} value={money(modelUsage.selected.costUsd)} />
          <Metric label={t('errors')} value={count(modelUsage.selected.errors)} tone={modelUsage.selected.errors ? 'warn' : ''} />
        </div>
        <UsageTable summary={modelUsage.selected} />
      </Module>

      <Module title={t('usageAllTime')} eyebrow={t('perModel')}>
        <UsageTable summary={modelUsage.total} />
      </Module>

      <Module
        title={t('modelCheckTitle')}
        eyebrow={t('modelCheck')}
        note={t('modelCheckNote')}
        action={<button className="a-btn" type="button" onClick={onCheck} disabled={checking}>{checking ? t('checking') : t('runCheck')}</button>}
      >
        {checkError && <p className="a-error" role="alert">{checkError}</p>}
        {check && (
          <div className="a-inline">
            <Status tone={check.reachable === check.total ? 'ok' : check.reachable ? 'warn' : 'bad'}>
              {t('reachableCount', { ok: check.reachable, total: check.total })}
            </Status>
            <span>{when(check.checkedAt)}</span>
          </div>
        )}
        <Table
          head={[t('colModel'), t('colProvider'), t('colStatus'), t('colLatency'), t('colDetail')]}
          empty={checking ? t('checking') : t('notCheckedYet')}
        >
          {(check?.checks || []).map((row) => (
            <tr key={`${row.label}-${row.model}`}>
              <td><strong>{row.label}</strong><small>{row.model}</small></td>
              <td>{row.provider}</td>
              <td>
                {row.ok
                  ? <Status tone="ok">{t('reachable')}</Status>
                  : <Status tone="bad">{t('unreachable')}{row.status ? ` ${row.status}` : ''}</Status>}
              </td>
              <td>{row.ms} ms</td>
              <td className="a-dim a-wrap">{row.message}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ TAB: PREDICTIONS ============ */

function PredictionsTab({ dashboard }: { dashboard: Dashboard }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const { sharedPool, predictionArchitecture: architecture } = dashboard;

  const poolRows = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return sharedPool.matches;
    return sharedPool.matches.filter((match) => [match.matchName, match.competition, match.fixtureId]
      .some((value) => String(value || '').toLowerCase().includes(text)));
  }, [query, sharedPool.matches]);

  const modelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const match of sharedPool.matches) for (const key of Object.keys(match.models)) keys.add(key);
    return [...keys];
  }, [sharedPool.matches]);

  return (
    <>
      <div className="a-metrics">
        <Metric label={t('championModel')} value={architecture.championModelKey} note={t('championNote')} />
        <Metric label={t('liveModels')} value={architecture.liveModelKeys.join(', ') || '—'} note={t('liveNote')} />
        <Metric label={t('matchesInPool')} value={count(sharedPool.totalMatches)} note={t('poolNote', { n: count(sharedPool.totalResults) })} />
        <Metric label={t('snapshots')} value={count(architecture.snapshotCount)} note={t('snapshotsNote', { n: count(architecture.currentConsensusCount) })} />
      </div>

      <Module title={t('sharedPool')} eyebrow={t('cacheHits')} note={t('sharedPoolNote')}>
        <div className="a-filters">
          <input className="a-input" type="search" value={query} placeholder={t('searchMatch')} onChange={(event) => setQuery(event.target.value)} />
          <span className="a-filters__count">{count(poolRows.length)} {t('rows')}</span>
        </div>
        <Table head={[t('colMatch'), t('colFixtureId'), t('kickoff'), ...modelKeys, t('colLastWrite')]}>
          {poolRows.map((match) => (
            <tr key={match.fixtureId}>
              <td><strong>{match.matchName}</strong><small>{match.competition || '—'}</small></td>
              <td><code>{match.fixtureId}</code></td>
              <td>{when(match.kickoff)}</td>
              {modelKeys.map((key) => {
                const state = match.models[key] || 'not_requested';
                return (
                  <td key={key}>
                    {state === 'not_requested'
                      ? <span className="a-dim">—</span>
                      : <Status tone={state === 'failed' ? 'bad' : state === 'live' ? 'ok' : 'idle'}>{state}</Status>}
                  </td>
                );
              })}
              <td>{when(match.latestUpdatedAt)}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module
        title={t('weeklySettlement')}
        eyebrow={architecture.latestWeek.weekStart ? t('weekOf', { date: architecture.latestWeek.weekStart }) : t('notSettled')}
        note={t('weeklyNote')}
      >
        <Table head={[t('colModel'), t('colSamples'), t('colHits'), t('colAccuracy'), t('colEligible'), '']} empty={t('noWeek')}>
          {architecture.latestWeek.rows.map((row) => (
            <tr key={row.modelKey}>
              <td><strong>{row.modelName || row.modelKey}</strong></td>
              <td>{count(row.samples)}</td>
              <td>{count(row.hits)}</td>
              <td>{ratio(row.accuracy)}</td>
              <td>{row.eligible ? <Status tone="ok">{t('yes')}</Status> : <Status tone="idle">{t('tooFew')}</Status>}</td>
              <td>{row.isChampion && <Status tone="ok">{t('champion')}</Status>}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module title={t('pipeline')} eyebrow={t('colSnapshots')}>
        <Table head={[t('colMatch'), t('colPhase'), t('colPublished'), t('colRawModels'), t('colSnapshots'), t('colConsensus'), t('colGenerated')]}>
          {architecture.matches.slice(0, 60).map((match) => (
            <tr key={match.fixtureId}>
              <td><strong>{match.matchName}</strong><small>{match.fixtureId}</small></td>
              <td><Status tone={match.phase === 'live' ? 'ok' : 'idle'}>{match.phase || '—'}</Status></td>
              <td>{match.publicModel || '—'}</td>
              <td>{match.rawModels.join(', ') || '—'}</td>
              <td>{count(match.snapshotCount)}</td>
              <td>{count(match.consensusCount)} <span className="a-dim">({t('sourced', { n: count(match.sourceSnapshotCount) })})</span></td>
              <td>{when(match.generatedAt)}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ TAB: ACCURACY ============ */

function AccuracyTab({ accuracy }: { accuracy: Accuracy }) {
  const t = useT();
  const [category, setCategory] = useState('all');
  const [model, setModel] = useState('all');

  const rows = useMemo(() => accuracy.evaluations.filter((row: AccuracyEvaluation) => {
    if (!row.counted) return false;
    if (category !== 'all' && row.category !== category) return false;
    if (model !== 'all' && row.modelName !== model) return false;
    return true;
  }).slice(0, 300), [accuracy.evaluations, category, model]);

  return (
    <>
      <div className="a-metrics">
        <Metric
          label={t('siteAccuracy')}
          value={accuracy.total ? ratio(accuracy.accuracy) : '—'}
          note={t('siteAccuracyNote', { hits: count(accuracy.hits), total: count(accuracy.total) })}
        />
        <Metric label={t('matchesSettled')} value={count(accuracy.matchCount)} note={t('matchesSettledNote', { n: count(accuracy.scoredContextCount) })} />
        <Metric label={t('modelPredictions')} value={count(accuracy.uniqueModelPredictions)} note={t('modelPredictionsNote')} />
        <Metric
          label={t('finishedNoScore')}
          value={count(accuracy.finishedWithoutScoreCount)}
          note={accuracy.finishedWithoutScoreCount ? t('refreshThese') : t('nothingPending')}
          tone={accuracy.finishedWithoutScoreCount ? 'warn' : 'ok'}
        />
      </div>

      <Module title={t('byModel')} eyebrow={t('settledOnly')}>
        <Table head={[t('colModel'), t('colSettled'), t('colHits'), t('colAccuracy')]}>
          {accuracy.models.map((row) => (
            <tr key={row.key}>
              <td><strong>{row.key}</strong></td>
              <td>{count(row.total)}</td>
              <td>{count(row.hits)}</td>
              <td>{ratio(row.accuracy)}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module title={t('byMarket')} eyebrow={t('settledOnly')}>
        <Table head={[t('colMarket'), t('colSettled'), t('colHits'), t('colAccuracy')]}>
          {accuracy.categories.map((row) => (
            <tr key={row.key}>
              <td><strong>{row.key}</strong></td>
              <td>{count(row.total)}</td>
              <td>{count(row.hits)}</td>
              <td>{ratio(row.accuracy)}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module title={t('settledPicks')} eyebrow={t('newestFirst')}>
        <div className="a-filters">
          <select className="a-input" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="all">{t('allModels')}</option>
            {accuracy.models.map((row) => <option key={row.key} value={row.key}>{row.key}</option>)}
          </select>
          <select className="a-input" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">{t('allMarkets')}</option>
            {accuracy.categories.map((row) => <option key={row.key} value={row.key}>{row.key}</option>)}
          </select>
          <span className="a-filters__count">{count(rows.length)} {t('rows')}</span>
        </div>
        <Table head={[t('colMatch'), t('colCompetition'), t('colDate'), t('colModel'), t('colMarket'), t('colSelection'), t('colFinal'), t('colResult')]}>
          {rows.map((row, index) => (
            <tr key={`${row.contextId}-${row.modelName}-${row.category}-${index}`}>
              <td><strong>{row.contextName}</strong></td>
              <td>{row.competition}</td>
              <td>{row.matchDate}</td>
              <td>{row.modelName}</td>
              <td>{row.category}</td>
              <td>{row.selection}</td>
              <td><code>{row.actualScore}</code></td>
              <td>{row.hit ? <Status tone="ok">{t('hit')}</Status> : <Status tone="bad">{t('miss')}</Status>}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ TAB: ACCOUNTS ============ */

function AccountsTab({ dashboard }: { dashboard: Dashboard }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState('all');

  const users = useMemo(() => {
    const text = query.trim().toLowerCase();
    return dashboard.userRows.filter((row: UserRow) => {
      if (plan === 'paid' && row.planId === 'free') return false;
      if (plan === 'free' && row.planId !== 'free') return false;
      if (!text) return true;
      return [row.email, row.id, row.provider].some((value) => String(value || '').toLowerCase().includes(text));
    }).slice(0, 300);
  }, [dashboard.userRows, plan, query]);

  return (
    <>
      <div className="a-metrics">
        {Object.entries(dashboard.users.activePlans).map(([planId, value]) => (
          <Metric
            key={planId}
            label={t('passesActive', { plan: planId })}
            value={count(value)}
            note={t('boughtToday', { n: count(dashboard.users.purchasesToday[planId] || 0) })}
          />
        ))}
      </div>

      <Module title={t('users')} eyebrow={t('usersRecent')}>
        <div className="a-filters">
          <input className="a-input" type="search" value={query} placeholder={t('searchUser')} onChange={(event) => setQuery(event.target.value)} />
          <select className="a-input" value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="all">{t('allAccounts')}</option>
            <option value="paid">{t('paidOnly')}</option>
            <option value="free">{t('freeOnly')}</option>
          </select>
          <span className="a-filters__count">{count(users.length)} {t('of')} {count(dashboard.userRows.length)}</span>
        </div>
        <Table head={[t('colAccount'), t('colProvider'), t('colPlan'), t('colValidUntil'), t('colRuns'), t('colRequests'), t('colCachedResp'), t('colFailed'), t('colToday'), t('colLastSeen')]}>
          {users.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.email || t('noEmail')}</strong><small>{row.id}</small></td>
              <td>{row.provider}</td>
              <td>{row.planId === 'free' ? <Status tone="idle">{t('free')}</Status> : <Status tone="ok">{row.planId}</Status>}</td>
              <td>{row.validUntil ? when(row.validUntil) : '—'}</td>
              <td>{count(row.predictionRuns)}</td>
              <td>{count(row.predictionRequests)}</td>
              <td>{count(row.cachedResponses)}</td>
              <td>{row.failedRequests ? <Status tone="bad">{row.failedRequests}</Status> : '0'}</td>
              <td>{count(row.callsToday)}</td>
              <td>{when(row.lastSeenAt)}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module title={t('ordersByPlan')} eyebrow={t('billing')}>
        <Table head={[t('colPlan'), t('ordersLabel'), t('colCustomers'), t('colCompleted'), t('colPending'), t('colFailed'), t('colRevenue')]}>
          {Object.entries(dashboard.orders.byPlan).map(([planId, row]) => (
            <tr key={planId}>
              <td><strong>{planId}</strong></td>
              <td>{count(row.total)}</td>
              <td>{count(row.customers)}</td>
              <td>{count(row.completed)}</td>
              <td>{count(row.pending)}</td>
              <td>{row.failed ? <Status tone="bad">{row.failed}</Status> : '0'}</td>
              <td>${row.revenueUsd.toFixed(2)}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module title={t('recentOrders')} eyebrow={t('newestFirst')}>
        <Table head={[t('colAccount'), t('colPlan'), t('colAmount'), t('colStatus'), t('colCreated'), t('colConfirmed'), t('colReason')]}>
          {dashboard.recentOrders.map((row: OrderRow) => (
            <tr key={row.id}>
              <td><strong>{row.email || t('noEmail')}</strong><small>{row.ownerId}</small></td>
              <td>{row.planId}</td>
              <td>${row.amountUsd.toFixed(2)}</td>
              <td>
                {row.status === 20
                  ? <Status tone="ok">{t('confirmed')}</Status>
                  : row.status < 0
                    ? <Status tone="bad">{t('failed')}</Status>
                    : <Status tone="idle">{t('pending')}</Status>}
              </td>
              <td>{when(row.createdAt)}</td>
              <td>{row.confirmedAt ? when(row.confirmedAt) : '—'}</td>
              <td className="a-dim">{row.failureReason || '—'}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ FIXTURE INSPECTOR ============ */

function FixtureModal({ fixtureId, context, loading, error, onClose }: {
  fixtureId: string;
  context: FixtureContext | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections: [CopyKey, string[]][] = context ? [
    ['formations', context.lineup?.formations || []],
    ['lineups', context.lineup?.players || []],
    ['injuries', context.lineup?.injuries || []],
    ['h2h', context.analysis?.h2h || []],
    ['odds', context.index?.handicapRows || []],
    ['standings', context.catalog?.standings || []],
    ['topScorers', context.catalog?.topScorers || []],
    ['events', context.live || []]
  ] : [];

  return (
    <div className="a-modal">
      <div className="a-modal__overlay" onClick={onClose} />
      <section className="a-modal__sheet" role="dialog" aria-modal="true" aria-label={t('fixture', { id: fixtureId })}>
        <header className="a-modal__head">
          <div>
            <span className="a-module__eyebrow">{t('fixture', { id: fixtureId })}</span>
            <h2>{context?.matchName || t('loading')}</h2>
          </div>
          <button className="a-btn a-btn--ghost" type="button" onClick={onClose}>{t('close')}</button>
        </header>

        {loading && <p className="a-empty">{t('fetchingContext')}</p>}
        {error && <p className="a-error" role="alert">{error}</p>}

        {context && !loading && (
          <>
            <div className="a-metrics a-metrics--tight">
              <Metric label={t('competition')} value={context.competition || '—'} />
              <Metric label={t('kickoff')} value={when(context.kickoff)} />
              <Metric label={t('status')} value={context.status || '—'} />
              <Metric label={t('finalScore')} value={context.actualScore || t('notPlayed')} />
            </div>

            {context.fetchStatus && (
              <Module title={t('endpointCoverage')} eyebrow={t('endpointNote')}>
                <div className="a-chips">
                  {Object.entries(context.fetchStatus).map(([endpoint, state]) => (
                    <Status key={endpoint} tone={state === 'ok' ? 'ok' : state === 'empty' ? 'idle' : 'bad'}>
                      {endpoint}: {state}
                    </Status>
                  ))}
                </div>
              </Module>
            )}

            {sections.map(([key, lines]) => (
              <Module key={key} title={t(key)} eyebrow={t('rowsCount', { n: lines.length })}>
                {lines.length
                  ? <ul className="a-list">{lines.slice(0, 60).map((line, index) => <li key={`${key}-${index}`}>{line}</li>)}</ul>
                  : <p className="a-empty">{t('notCaptured')}</p>}
              </Module>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

/* ============ SHELL ============ */

export default function AdminApp() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [usageDate, setUsageDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [schedulesAt, setSchedulesAt] = useState('');
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [schedulesError, setSchedulesError] = useState('');

  const [check, setCheck] = useState<ModelCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');

  const [fixtureId, setFixtureId] = useState('');
  const [fixture, setFixture] = useState<FixtureContext | null>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);
  const [fixtureError, setFixtureError] = useState('');

  const t = useMemo(() => createTranslator(language), [language]);

  useEffect(() => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const api = useMemo(() => createApiClient({
    getAccessToken: () => session?.access_token || ''
  }), [session]);

  useEffect(() => {
    let active = true;
    let authClient: SupabaseClient | null = null;
    const boot = async () => {
      try {
        const response = await fetch('/api/auth/config');
        const config = await response.json() as AuthConfig;
        if (!response.ok || !config.enabled) throw new Error(config.error || 'Authentication is not configured.');
        authClient = createClient(config.supabaseUrl!, config.publishableKey!, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
        });
        const { data } = await authClient.auth.getSession();
        if (!active) return;
        setClient(authClient);
        setSession(data.session);
      } catch (bootError) {
        if (active) setError(userFacingError(bootError, t('errorStart')));
      } finally {
        if (active) setBooting(false);
      }
    };
    void boot();
    return () => {
      active = false;
      void authClient?.auth.stopAutoRefresh();
    };
    // Booting once is deliberate: a language switch must not re-authenticate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDashboard = useCallback(async (date = '') => {
    setLoading(true);
    setError('');
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : '';
      const result = await api(`/api/admin/dashboard${query}`);
      setDashboard(result.dashboard);
      setUsageDate(result.dashboard?.modelUsage?.selectedDate || '');
      setAuthorized(true);
    } catch (loadError) {
      const status = (loadError as { status?: number }).status;
      if (status === 401 || status === 403) setAuthorized(false);
      setError(userFacingError(loadError, t('errorLoad')));
    } finally {
      setLoading(false);
    }
  }, [api, t]);

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    setSchedulesError('');
    try {
      const result = await api('/api/backend/schedules');
      setSchedules(result.schedules || []);
      setSchedulesAt(result.generatedAt || '');
    } catch (scheduleError) {
      setSchedulesError(userFacingError(scheduleError, t('errorSchedules')));
    } finally {
      setSchedulesLoading(false);
    }
  }, [api, t]);

  useEffect(() => {
    if (booting || !session || dashboard) return;
    void loadDashboard();
  }, [booting, dashboard, loadDashboard, session]);

  useEffect(() => {
    if (tab !== 'data' || !session || schedules.length || schedulesLoading || schedulesError) return;
    void loadSchedules();
  }, [loadSchedules, schedules.length, schedulesError, schedulesLoading, session, tab]);

  const openFixture = useCallback(async (id: string) => {
    setFixtureId(id);
    setFixture(null);
    setFixtureError('');
    setFixtureLoading(true);
    try {
      const result = await api(`/api/backend/fixtures/${encodeURIComponent(id)}`);
      setFixture(result.context || null);
    } catch (openError) {
      setFixtureError(userFacingError(openError, t('errorFixture')));
    } finally {
      setFixtureLoading(false);
    }
  }, [api, t]);

  const runModelCheck = useCallback(async () => {
    setChecking(true);
    setCheckError('');
    try {
      setCheck(await api('/api/admin/models/check', { method: 'POST' }) as ModelCheck);
    } catch (error) {
      setCheckError(userFacingError(error, t('errorModelCheck')));
    } finally {
      setChecking(false);
    }
  }, [api, t]);

  const signOut = async () => {
    await client?.auth.signOut({ scope: 'local' });
    setSession(null);
    setDashboard(null);
    setAuthorized(null);
  };

  const languageToggle = (
    <div className="a-lang" role="group" aria-label="Language">
      {(['en', 'zh'] as const).map((code) => (
        <button
          key={code}
          className={`a-lang__btn ${language === code ? 'is-active' : ''}`}
          type="button"
          aria-pressed={language === code}
          onClick={() => setLanguage(code)}
        >
          {code === 'en' ? 'EN' : '中文'}
        </button>
      ))}
    </div>
  );

  if (booting) {
    return (
      <CopyContext.Provider value={t}>
        <main className="a-shell a-shell--center"><p className="a-empty">{t('starting')}</p></main>
      </CopyContext.Provider>
    );
  }

  if (!session || authorized === false) {
    return (
      <CopyContext.Provider value={t}>
        <main className="a-shell a-shell--center">
          <section className="a-gate">
            <div className="a-gate__top">
              <span className="a-module__eyebrow">FutBots</span>
              {languageToggle}
            </div>
            <h1>{session ? t('adminOnlyTitle') : t('signInTitle')}</h1>
            <p>{session ? t('adminOnlyBody') : t('signInBody')}</p>
            {error && <p className="a-error" role="alert">{error}</p>}
            <div className="a-gate__actions">
              <a className="a-btn" href="/login">{t('goSignIn')}</a>
              {session && <button className="a-btn a-btn--ghost" type="button" onClick={signOut}>{t('signOut')}</button>}
            </div>
          </section>
        </main>
      </CopyContext.Provider>
    );
  }

  return (
    <CopyContext.Provider value={t}>
      <main className="a-shell">
        <header className="a-head">
          <div>
            <span className="a-module__eyebrow">FutBots</span>
            <h1>{t('consoleTitle')}</h1>
          </div>
          <div className="a-head__actions">
            <span className="a-dim">{dashboard ? `${t('readAt')} ${when(dashboard.generatedAt)}` : t('loading')}</span>
            {languageToggle}
            <button className="a-btn" type="button" onClick={() => void loadDashboard(usageDate)} disabled={loading}>
              {loading ? t('refreshing') : t('refresh')}
            </button>
            <a className="a-btn a-btn--ghost" href="/">{t('backToSite')}</a>
          </div>
        </header>

        <nav className="a-tabs" role="tablist" aria-label={t('consoleTitle')}>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`a-tab ${tab === item.id ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              <strong>{t(item.label)}</strong>
              <small>{t(item.hint)}</small>
            </button>
          ))}
        </nav>

        {error && <p className="a-error" role="alert">{error}</p>}

        {!dashboard
          ? <p className="a-empty">{t('loadingData')}</p>
          : (
            <div className="a-panel" role="tabpanel">
              {tab === 'overview' && <OverviewTab dashboard={dashboard} />}
              {tab === 'data' && (
                <DataConsoleTab
                  dashboard={dashboard}
                  schedules={schedules}
                  generatedAt={schedulesAt}
                  loading={schedulesLoading}
                  error={schedulesError}
                  onReload={() => void loadSchedules()}
                  onOpenFixture={(id) => void openFixture(id)}
                />
              )}
              {tab === 'models' && (
                <ModelsTab
                  dashboard={dashboard}
                  busy={loading}
                  onDate={(date) => { setUsageDate(date); void loadDashboard(date); }}
                  check={check}
                  checking={checking}
                  checkError={checkError}
                  onCheck={() => void runModelCheck()}
                />
              )}
              {tab === 'predictions' && <PredictionsTab dashboard={dashboard} />}
              {tab === 'accuracy' && <AccuracyTab accuracy={dashboard.accuracy} />}
              {tab === 'accounts' && <AccountsTab dashboard={dashboard} />}
            </div>
          )}

        {fixtureId && (
          <FixtureModal
            fixtureId={fixtureId}
            context={fixture}
            loading={fixtureLoading}
            error={fixtureError}
            onClose={() => { setFixtureId(''); setFixture(null); setFixtureError(''); }}
          />
        )}
      </main>
    </CopyContext.Provider>
  );
}
