import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';

import { createApiClient, userFacingError } from './api.js';
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
type TabId = 'overview' | 'data' | 'models' | 'predictions' | 'accuracy' | 'accounts';

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'overview', label: 'Overview', hint: 'Today at a glance' },
  { id: 'data', label: 'Data Console', hint: 'API-Football cache' },
  { id: 'models', label: 'Models', hint: 'Tokens and spend' },
  { id: 'predictions', label: 'Predictions', hint: 'Shared pool and pipeline' },
  { id: 'accuracy', label: 'Accuracy', hint: 'Settled results' },
  { id: 'accounts', label: 'Accounts', hint: 'Users and orders' }
];

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
  const rows = Array.isArray(children) ? children.flat() : [children];
  if (!rows.filter(Boolean).length) return <p className="a-empty">{empty || 'No data yet.'}</p>;
  return (
    <div className="a-table-wrap">
      <table className="a-table">
        <thead><tr>{head.map((cell) => <th key={cell}>{cell}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Status({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; children: React.ReactNode }) {
  return <span className={`a-status a-status--${tone}`}>{children}</span>;
}

function UsageTable({ summary }: { summary: UsageSummary }) {
  return (
    <Table head={['Model', 'Provider', 'Calls', 'Input', 'Output', 'Total tokens', 'Spend', 'Cost source', 'Errors']}>
      {summary.models.map((row) => (
        <tr key={`${row.modelName}|${row.provider}`}>
          <td><strong>{row.modelName}</strong></td>
          <td>{row.provider}</td>
          <td>{count(row.requests)}</td>
          <td>{count(row.inputTokens)}</td>
          <td>{count(row.outputTokens)}</td>
          <td>{count(row.totalTokens)}</td>
          <td>{row.costAvailableCalls ? money(row.costUsd) : <Status tone="warn">unpriced</Status>}</td>
          <td>
            {row.costReportedCalls > 0 && <Status tone="ok">{row.costReportedCalls} reported</Status>}
            {row.costEstimatedCalls > 0 && <Status tone="idle">{row.costEstimatedCalls} estimated</Status>}
            {row.costAvailableCalls === 0 && <Status tone="warn">none</Status>}
          </td>
          <td>{row.errors ? <Status tone="bad">{row.errors}</Status> : '0'}</td>
        </tr>
      ))}
    </Table>
  );
}

/* ============ TAB: OVERVIEW ============ */

function OverviewTab({ dashboard }: { dashboard: Dashboard }) {
  const { core, orders, users } = dashboard;
  const quotaUsed = core.apiFootballDailyLimit
    ? core.apiFootballCallsToday / core.apiFootballDailyLimit
    : 0;
  const refreshTone = core.lastRefreshStatus === 'healthy' ? 'ok'
    : core.lastRefreshStatus === 'warning' ? 'warn'
      : core.lastRefreshStatus === 'running' ? 'idle' : 'bad';

  return (
    <>
      <div className="a-metrics">
        <Metric
          label="API-Football calls today"
          value={count(core.apiFootballCallsToday)}
          note={core.apiFootballDailyLimit ? `${ratio(quotaUsed)} of ${count(core.apiFootballDailyLimit)} daily quota` : 'No quota configured'}
          tone={quotaUsed > 0.8 ? 'warn' : ''}
        />
        <Metric label="Model calls today" value={count(core.modelCallsToday)} note={`${count(core.modelUsersToday)} distinct users`} />
        <Metric
          label="Model spend today"
          value={money(core.modelCostTodayUsd)}
          note={`${count(core.modelCostReportedCalls)} reported · ${count(core.modelCostEstimatedCalls)} estimated`}
          tone={core.modelCallsToday > core.modelCostAvailableCalls ? 'warn' : ''}
        />
        <Metric
          label="Prediction requests today"
          value={count(core.predictionRequestsToday)}
          note={`${count(core.predictionRequestsCachedToday)} served from cache · ${count(core.predictionRequestErrorsToday)} failed`}
        />
        <Metric label="Queue in flight" value={count(core.predictionQueueActive)} note="Queued or running right now" />
        <Metric label="Cached matches" value={count(core.cachedMatches)} note="Distinct fixtures in the schedule cache" />
      </div>

      <Module title="Scheduled refresh" eyebrow="Cron" note="The cron writes the API-Football schedule cache every 20 minutes.">
        <div className="a-inline">
          <Status tone={refreshTone}>{core.lastRefreshStatus}</Status>
          <span>Last write {when(core.lastRefreshAt)}</span>
        </div>
      </Module>

      <Module title="Confirmed revenue" eyebrow="Billing">
        <div className="a-metrics a-metrics--tight">
          {(['today', 'week', 'month', 'total'] as const).map((period) => (
            <Metric
              key={period}
              label={period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : period === 'month' ? 'Last 30 days' : 'All time'}
              value={`$${(orders.revenue[period]?.amountUsd ?? 0).toFixed(2)}`}
              note={`${count(orders.revenue[period]?.count ?? 0)} orders`}
            />
          ))}
        </div>
      </Module>

      <Module title="Accounts" eyebrow="Users">
        <div className="a-metrics a-metrics--tight">
          <Metric label="Registered" value={count(users.total)} note={`${count(users.newToday)} new today`} />
          <Metric label="Active today" value={count(users.activeToday)} note={`${count(users.active7d)} in 7d · ${count(users.active30d)} in 30d`} />
          <Metric label="Paid access" value={count(users.paid)} note="Entitlements still valid" />
          <Metric
            label="Orders"
            value={count(orders.statusCounts.completed)}
            note={`${count(orders.statusCounts.pending)} pending · ${count(orders.statusCounts.failed)} failed`}
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
  const [query, setQuery] = useState('');
  const [competition, setCompetition] = useState('all');
  const [status, setStatus] = useState('all');

  const competitions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const schedule of schedules) {
      const id = String(schedule.competitionId || '');
      if (!id || seen.has(id)) continue;
      seen.set(id, schedule.matches?.find((match) => match.competition)?.competition || `Competition ${id}`);
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
        <Metric label="Cached competitions" value={count(schedules.length)} />
        <Metric label="Cached matches" value={count(allMatches.length)} />
        <Metric label="Odds verified" value={count(allMatches.filter((match) => match.hasOdds === true).length)} note="Only these are offered to users" />
        <Metric label="Refresh delays" value={count(delayed)} note="Competitions rate limited on their last check" tone={delayed ? 'warn' : ''} />
        <Metric label="Cache read at" value={when(generatedAt)} />
      </div>

      <Module
        title="Schedule cache"
        eyebrow="API-Football"
        note="Rows come from Supabase, not a live provider call. Open a fixture to spend one API-Football request on its full context."
        action={<button className="a-btn" type="button" onClick={onReload} disabled={loading}>{loading ? 'Loading' : 'Reload'}</button>}
      >
        <div className="a-filters">
          <input
            className="a-input"
            type="search"
            value={query}
            placeholder="Team, competition or fixture ID"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="a-input" value={competition} onChange={(event) => setCompetition(event.target.value)}>
            <option value="all">All competitions</option>
            {competitions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="a-input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Any status</option>
            <option value="odds">Odds verified</option>
            <option value="no-odds">No odds</option>
            <option value="delayed">Rate limited</option>
          </select>
          <span className="a-filters__count">{count(rows.length)} rows</span>
        </div>

        {error && <p className="a-error" role="alert">{error}</p>}

        <Table
          head={['Competition', 'Match', 'Kickoff (Shanghai)', 'Fixture ID', 'Odds', 'Last check', 'Cached at', '']}
          empty={loading ? 'Loading the Supabase cache…' : 'No rows match these filters.'}
        >
          {rows.map(({ schedule, match, provider }) => {
            const fixtureId = fixtureIdOf(match);
            return (
              <tr key={`${schedule.competitionId}-${fixtureId}-${match.date}`}>
                <td>
                  <strong>{match.competition || `Competition ${schedule.competitionId}`}</strong>
                  <small>ID {schedule.competitionId}</small>
                </td>
                <td><strong>{match.home}</strong> <span className="a-dim">vs</span> <strong>{match.away}</strong></td>
                <td>{when(match.kickoff)}</td>
                <td><code>{fixtureId}</code></td>
                <td>{match.hasOdds === true ? <Status tone="ok">verified</Status> : <Status tone="idle">none</Status>}</td>
                <td>
                  {provider?.status === 'rate-limited'
                    ? <Status tone="bad">rate limited</Status>
                    : provider?.status === 'ready'
                      ? <Status tone="ok">ready</Status>
                      : <Status tone="idle">cached</Status>}
                </td>
                <td>{when(schedule.fetchedAt)}</td>
                <td>
                  <button className="a-btn a-btn--ghost" type="button" onClick={() => onOpenFixture(fixtureId)} disabled={!fixtureId}>
                    Inspect
                  </button>
                </td>
              </tr>
            );
          })}
        </Table>
      </Module>

      <Module
        title="Competition usage"
        eyebrow="Cost by league"
        note="Competitions burning tokens on very little cached data are worth reviewing — small leagues carry thin evidence."
      >
        <div className="a-metrics a-metrics--tight">
          <Metric label="Duplicate fixtures" value={count(dashboard.leagueAudit.duplicateFixtures)} />
          <Metric label="Duplicate league writes" value={count(dashboard.leagueAudit.duplicateLeagues)} />
          <Metric
            label="Needs review"
            value={count(dashboard.leagueAudit.reviewCompetitions)}
            tone={dashboard.leagueAudit.reviewCompetitions ? 'warn' : ''}
          />
        </div>
        <Table head={['Competition', 'Cached', 'Imports', 'Predictions', 'Model calls', 'Failed', 'Tokens', '']}>
          {dashboard.leagues.map((league) => (
            <tr key={league.name}>
              <td><strong>{league.name}</strong></td>
              <td>{count(league.cachedMatches)}</td>
              <td>{count(league.imports)}</td>
              <td>{count(league.predictions)}</td>
              <td>{count(league.modelCalls)}</td>
              <td>{league.failedCalls ? <Status tone="bad">{league.failedCalls}</Status> : '0'}</td>
              <td>{count(league.totalTokens)}</td>
              <td>{league.reviewRequired && <Status tone="warn">review</Status>}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ TAB: MODELS ============ */

function ModelsTab({ dashboard, onDate, busy }: { dashboard: Dashboard; onDate: (date: string) => void; busy: boolean }) {
  const { modelUsage } = dashboard;
  const unpriced = modelUsage.total.calls - modelUsage.total.costAvailableCalls;

  return (
    <>
      <div className="a-metrics">
        <Metric label="Calls all time" value={count(modelUsage.total.calls)} note={`${count(modelUsage.total.users)} distinct users`} />
        <Metric label="Tokens all time" value={count(modelUsage.total.tokens)} />
        <Metric label="Spend all time" value={money(modelUsage.total.costUsd)} />
        <Metric
          label="Calls without a price"
          value={count(unpriced)}
          note={unpriced ? 'Provider returned no cost and no rate table matched' : 'Every call is costed'}
          tone={unpriced ? 'warn' : 'ok'}
        />
        <Metric label="Errors all time" value={count(modelUsage.total.errors)} tone={modelUsage.total.errors ? 'warn' : ''} />
      </div>

      <Module
        title="Usage by day"
        eyebrow="Per model"
        action={
          <select className="a-input" value={modelUsage.selectedDate} onChange={(event) => onDate(event.target.value)} disabled={busy}>
            {(modelUsage.availableDates.length ? modelUsage.availableDates : [modelUsage.selectedDate]).map((date) => (
              <option key={date} value={date}>{date}</option>
            ))}
          </select>
        }
      >
        <div className="a-metrics a-metrics--tight">
          <Metric label="Calls" value={count(modelUsage.selected.calls)} />
          <Metric label="Users" value={count(modelUsage.selected.users)} />
          <Metric label="Tokens" value={count(modelUsage.selected.tokens)} />
          <Metric label="Spend" value={money(modelUsage.selected.costUsd)} />
          <Metric label="Errors" value={count(modelUsage.selected.errors)} tone={modelUsage.selected.errors ? 'warn' : ''} />
        </div>
        <UsageTable summary={modelUsage.selected} />
      </Module>

      <Module title="Usage all time" eyebrow="Per model">
        <UsageTable summary={modelUsage.total} />
      </Module>
    </>
  );
}

/* ============ TAB: PREDICTIONS ============ */

function PredictionsTab({ dashboard }: { dashboard: Dashboard }) {
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
        <Metric label="Champion model" value={architecture.championModelKey} note="Runs alone before kickoff" />
        <Metric label="Live models" value={architecture.liveModelKeys.join(', ') || '—'} note="Weighted consensus inside 1h of kickoff" />
        <Metric label="Matches in pool" value={count(sharedPool.totalMatches)} note={`${count(sharedPool.totalResults)} cached results`} />
        <Metric label="Model snapshots" value={count(architecture.snapshotCount)} note={`${count(architecture.currentConsensusCount)} current consensus rows`} />
      </div>

      <Module
        title="Shared prediction pool"
        eyebrow="Cache hits"
        note="Every user asking for the same fixture and phase reuses one of these results, so a filled row costs nothing to serve again."
      >
        <div className="a-filters">
          <input
            className="a-input"
            type="search"
            value={query}
            placeholder="Team, competition or fixture ID"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="a-filters__count">{count(poolRows.length)} rows</span>
        </div>
        <Table head={['Match', 'Fixture ID', 'Kickoff', ...modelKeys, 'Last write']}>
          {poolRows.map((match) => (
            <tr key={match.fixtureId}>
              <td><strong>{match.matchName}</strong><small>{match.competition || 'Unknown competition'}</small></td>
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
        title="Weekly model settlement"
        eyebrow={architecture.latestWeek.weekStart ? `Week of ${architecture.latestWeek.weekStart}` : 'Not settled yet'}
        note="Settled every Monday 00:00 Shanghai time from the previous week's snapshots. The winner becomes the pre-kickoff champion."
      >
        <Table head={['Model', 'Samples', 'Hits', 'Accuracy', 'Eligible', '']} empty="No week has been settled yet.">
          {architecture.latestWeek.rows.map((row) => (
            <tr key={row.modelKey}>
              <td><strong>{row.modelName || row.modelKey}</strong></td>
              <td>{count(row.samples)}</td>
              <td>{count(row.hits)}</td>
              <td>{ratio(row.accuracy)}</td>
              <td>{row.eligible ? <Status tone="ok">yes</Status> : <Status tone="idle">too few samples</Status>}</td>
              <td>{row.isChampion && <Status tone="ok">champion</Status>}</td>
            </tr>
          ))}
        </Table>
      </Module>

      <Module title="Pipeline per fixture" eyebrow="Snapshots">
        <Table head={['Match', 'Phase', 'Published model', 'Raw models', 'Snapshots', 'Consensus rows', 'Generated']}>
          {architecture.matches.slice(0, 60).map((match) => (
            <tr key={match.fixtureId}>
              <td><strong>{match.matchName}</strong><small>{match.fixtureId}</small></td>
              <td><Status tone={match.phase === 'live' ? 'ok' : 'idle'}>{match.phase || 'unknown'}</Status></td>
              <td>{match.publicModel || '—'}</td>
              <td>{match.rawModels.join(', ') || '—'}</td>
              <td>{count(match.snapshotCount)}</td>
              <td>{count(match.consensusCount)} <span className="a-dim">({count(match.sourceSnapshotCount)} sourced)</span></td>
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
          label="Site accuracy"
          value={accuracy.total ? ratio(accuracy.accuracy) : '—'}
          note={`${count(accuracy.hits)} hits of ${count(accuracy.total)} settled picks`}
        />
        <Metric label="Matches settled" value={count(accuracy.matchCount)} note={`${count(accuracy.scoredContextCount)} fixtures carry a final score`} />
        <Metric label="Model predictions" value={count(accuracy.uniqueModelPredictions)} note="Deduplicated per fixture and model" />
        <Metric
          label="Finished without a score"
          value={count(accuracy.finishedWithoutScoreCount)}
          note={accuracy.finishedWithoutScoreCount ? 'Refresh these fixtures to settle them' : 'Nothing pending'}
          tone={accuracy.finishedWithoutScoreCount ? 'warn' : 'ok'}
        />
      </div>

      <Module title="By model" eyebrow="Settled picks only">
        <Table head={['Model', 'Settled', 'Hits', 'Accuracy']}>
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

      <Module title="By market" eyebrow="Settled picks only">
        <Table head={['Market', 'Settled', 'Hits', 'Accuracy']}>
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

      <Module title="Settled picks" eyebrow="Most recent first">
        <div className="a-filters">
          <select className="a-input" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="all">All models</option>
            {accuracy.models.map((row) => <option key={row.key} value={row.key}>{row.key}</option>)}
          </select>
          <select className="a-input" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All markets</option>
            {accuracy.categories.map((row) => <option key={row.key} value={row.key}>{row.key}</option>)}
          </select>
          <span className="a-filters__count">{count(rows.length)} rows</span>
        </div>
        <Table head={['Match', 'Competition', 'Date', 'Model', 'Market', 'Selection', 'Final', 'Result']}>
          {rows.map((row, index) => (
            <tr key={`${row.contextId}-${row.modelName}-${row.category}-${index}`}>
              <td><strong>{row.contextName}</strong></td>
              <td>{row.competition}</td>
              <td>{row.matchDate}</td>
              <td>{row.modelName}</td>
              <td>{row.category}</td>
              <td>{row.selection}</td>
              <td><code>{row.actualScore}</code></td>
              <td>{row.hit ? <Status tone="ok">hit</Status> : <Status tone="bad">miss</Status>}</td>
            </tr>
          ))}
        </Table>
      </Module>
    </>
  );
}

/* ============ TAB: ACCOUNTS ============ */

function AccountsTab({ dashboard }: { dashboard: Dashboard }) {
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
            label={`${planId} passes active`}
            value={count(value)}
            note={`${count(dashboard.users.purchasesToday[planId] || 0)} bought today`}
          />
        ))}
      </div>

      <Module title="Users" eyebrow="Most recently seen first">
        <div className="a-filters">
          <input
            className="a-input"
            type="search"
            value={query}
            placeholder="Email, user ID or provider"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="a-input" value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="all">All accounts</option>
            <option value="paid">Paid only</option>
            <option value="free">Free only</option>
          </select>
          <span className="a-filters__count">{count(users.length)} of {count(dashboard.userRows.length)}</span>
        </div>
        <Table head={['Account', 'Provider', 'Plan', 'Valid until', 'Runs', 'Requests', 'Cached', 'Failed', 'Today', 'Last seen']}>
          {users.map((row) => (
            <tr key={row.id}>
              <td><strong>{row.email || 'No email'}</strong><small>{row.id}</small></td>
              <td>{row.provider}</td>
              <td>{row.planId === 'free' ? <Status tone="idle">free</Status> : <Status tone="ok">{row.planId}</Status>}</td>
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

      <Module title="Orders by plan" eyebrow="Billing">
        <Table head={['Plan', 'Orders', 'Customers', 'Completed', 'Pending', 'Failed', 'Revenue']}>
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

      <Module title="Recent orders" eyebrow="Newest first">
        <Table head={['Account', 'Plan', 'Amount', 'Status', 'Created', 'Confirmed', 'Reason']}>
          {dashboard.recentOrders.map((row: OrderRow) => (
            <tr key={row.id}>
              <td><strong>{row.email || 'No email'}</strong><small>{row.ownerId}</small></td>
              <td>{row.planId}</td>
              <td>${row.amountUsd.toFixed(2)}</td>
              <td>
                {row.status === 20
                  ? <Status tone="ok">confirmed</Status>
                  : row.status < 0
                    ? <Status tone="bad">failed</Status>
                    : <Status tone="idle">pending</Status>}
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sections: [string, string[]][] = context ? [
    ['Formations', context.lineup?.formations || []],
    ['Lineups and players', context.lineup?.players || []],
    ['Injuries', context.lineup?.injuries || []],
    ['Head to head', context.analysis?.h2h || []],
    ['Odds', context.index?.handicapRows || []],
    ['Standings', context.catalog?.standings || []],
    ['Top scorers', context.catalog?.topScorers || []],
    ['Match events', context.live || []]
  ] : [];

  return (
    <div className="a-modal">
      <div className="a-modal__overlay" onClick={onClose} />
      <section className="a-modal__sheet" role="dialog" aria-modal="true" aria-label={`Fixture ${fixtureId}`}>
        <header className="a-modal__head">
          <div>
            <span className="a-module__eyebrow">Fixture {fixtureId}</span>
            <h2>{context?.matchName || 'Loading…'}</h2>
          </div>
          <button className="a-btn a-btn--ghost" type="button" onClick={onClose}>Close</button>
        </header>

        {loading && <p className="a-empty">Fetching the full context from API-Football…</p>}
        {error && <p className="a-error" role="alert">{error}</p>}

        {context && !loading && (
          <>
            <div className="a-metrics a-metrics--tight">
              <Metric label="Competition" value={context.competition || '—'} />
              <Metric label="Kickoff" value={when(context.kickoff)} />
              <Metric label="Status" value={context.status || '—'} />
              <Metric label="Final score" value={context.actualScore || 'Not played'} />
            </div>

            {context.fetchStatus && (
              <Module title="Endpoint coverage" eyebrow="What was actually captured">
                <div className="a-chips">
                  {Object.entries(context.fetchStatus).map(([endpoint, state]) => (
                    <Status key={endpoint} tone={state === 'ok' ? 'ok' : state === 'empty' ? 'idle' : 'bad'}>
                      {endpoint}: {state}
                    </Status>
                  ))}
                </div>
              </Module>
            )}

            {sections.map(([title, lines]) => (
              <Module key={title} title={title} eyebrow={`${lines.length} rows`}>
                {lines.length
                  ? <ul className="a-list">{lines.slice(0, 60).map((line, index) => <li key={`${title}-${index}`}>{line}</li>)}</ul>
                  : <p className="a-empty">Not captured for this fixture.</p>}
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

  const [fixtureId, setFixtureId] = useState('');
  const [fixture, setFixture] = useState<FixtureContext | null>(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);
  const [fixtureError, setFixtureError] = useState('');

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
        if (active) setError(userFacingError(bootError, 'Unable to start the console.'));
      } finally {
        if (active) setBooting(false);
      }
    };
    void boot();
    return () => {
      active = false;
      void authClient?.auth.stopAutoRefresh();
    };
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
      setError(userFacingError(loadError, 'Unable to load the console.'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    setSchedulesError('');
    try {
      const result = await api('/api/backend/schedules');
      setSchedules(result.schedules || []);
      setSchedulesAt(result.generatedAt || '');
    } catch (scheduleError) {
      setSchedulesError(userFacingError(scheduleError, 'Unable to read the schedule cache.'));
    } finally {
      setSchedulesLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (booting || !session) return;
    void loadDashboard();
  }, [booting, loadDashboard, session]);

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
      setFixtureError(userFacingError(openError, 'Unable to load this fixture.'));
    } finally {
      setFixtureLoading(false);
    }
  }, [api]);

  const signOut = async () => {
    await client?.auth.signOut({ scope: 'local' });
    setSession(null);
    setDashboard(null);
    setAuthorized(null);
  };

  if (booting) {
    return <main className="a-shell a-shell--center"><p className="a-empty">Starting the console…</p></main>;
  }

  if (!session || authorized === false) {
    return (
      <main className="a-shell a-shell--center">
        <section className="a-gate">
          <span className="a-module__eyebrow">FutBots</span>
          <h1>{session ? 'Administrator access required' : 'Sign in to continue'}</h1>
          <p>
            {session
              ? 'This account is signed in but is not on the administrator list.'
              : 'The console reuses your FutBots session. Sign in on the main site, then come back.'}
          </p>
          {error && <p className="a-error" role="alert">{error}</p>}
          <div className="a-gate__actions">
            <a className="a-btn" href="/login">Go to sign in</a>
            {session && <button className="a-btn a-btn--ghost" type="button" onClick={signOut}>Sign out</button>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="a-shell">
      <header className="a-head">
        <div>
          <span className="a-module__eyebrow">FutBots</span>
          <h1>Operations console</h1>
        </div>
        <div className="a-head__actions">
          <span className="a-dim">{dashboard ? `Read ${when(dashboard.generatedAt)}` : 'Loading'}</span>
          <button className="a-btn" type="button" onClick={() => void loadDashboard(usageDate)} disabled={loading}>
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <a className="a-btn a-btn--ghost" href="/">Back to site</a>
        </div>
      </header>

      <nav className="a-tabs" role="tablist" aria-label="Console sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`a-tab ${tab === item.id ? 'is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </nav>

      {error && <p className="a-error" role="alert">{error}</p>}

      {!dashboard
        ? <p className="a-empty">Loading console data…</p>
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
              <ModelsTab dashboard={dashboard} busy={loading} onDate={(date) => { setUsageDate(date); void loadDashboard(date); }} />
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
  );
}
