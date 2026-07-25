import { predictionModelKey } from './prediction-cache.js';

const TABLES = {
  markets: 'markets',
  reports: 'reports',
  rankings: 'rankings',
  matchContexts: 'match_contexts',
  matchSchedules: 'match_schedules',
  apiFootballCatalogCache: 'api_football_catalog_cache',
  aiUsageEvents: 'ai_usage_events',
  systemEvents: 'system_events',
  billingOrders: 'billing_orders',
  billingEntitlements: 'billing_entitlements',
  sharedPredictionResults: 'shared_prediction_results',
  predictionRequests: 'prediction_requests',
  predictionSnapshots: 'prediction_snapshots',
  predictionConsensus: 'prediction_consensus',
  modelWeeklyPerformance: 'model_weekly_performance',
  predictionSettings: 'prediction_settings'
};

export function createSupabaseStorage(env, fetchImpl = fetch) {
  const baseUrl = String(env.SUPABASE_URL || '').replace(/^\uFEFF/, '').trim().replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '';
  if (!baseUrl || !serviceKey) {
    throw new Error('Cloudflare requires SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY');
  }

  const client = new SupabaseRestClient(baseUrl, serviceKey, fetchImpl);

  return {
    async readDb({ ownerId = 'guest' } = {}) {
      const [markets, reports, rankings, matchContexts] = await Promise.all([
        readPayloads(client, TABLES.markets, 'updated_at.desc', 500, ownerId),
        readPayloads(client, TABLES.reports, 'created_at.desc', 100, ownerId),
        readPayloads(client, TABLES.rankings, 'created_at.desc', 50, ownerId),
        readPayloads(client, TABLES.matchContexts, 'updated_at.desc', 20, ownerId)
      ]);
      return { markets, reports, rankings, matchContexts };
    },

    async upsertMarkets(markets, { ownerId = 'guest' } = {}) {
      if (!markets.length) return [];
      await client.upsert(TABLES.markets, markets.map((market) => ({
        id: market.id,
        owner_id: ownerId,
        payload: market,
        updated_at: new Date().toISOString()
      })), 'owner_id,id');
      return markets;
    },

    async clearMarkets({ ownerId = 'guest' } = {}) {
      await Promise.all([
        client.deleteAll(TABLES.markets, ownerId),
        client.deleteAll(TABLES.reports, ownerId),
        client.deleteAll(TABLES.rankings, ownerId),
        client.deleteAll(TABLES.matchContexts, ownerId)
      ]);
    },

    async saveReport(report, { ownerId = 'guest' } = {}) {
      await client.upsert(TABLES.reports, [{
        id: report.id,
        owner_id: ownerId,
        payload: report,
        created_at: report.createdAt || new Date().toISOString()
      }], 'owner_id,id');
      return report;
    },

    async saveRanking(ranking, { mergeLatest = false, ownerId = 'guest' } = {}) {
      if (mergeLatest) {
        const rankings = await readPayloads(client, TABLES.rankings, 'created_at.desc', 50, ownerId);
        const latest = ranking.contextId
          ? rankings.find((item) => item.contextId === ranking.contextId)
          : rankings[0];
        if (latest) {
          const existingResults = (latest.results || []).map((result) => ({
            ...result,
            generatedAt: result.generatedAt || latest.createdAt
          }));
          const byModel = new Map(existingResults.map((result) => [resultModelKey(result.modelName), result]));
          for (const result of ranking.results || []) byModel.set(resultModelKey(result.modelName), result);
          latest.results = [...byModel.values()];
          latest.marketCount = ranking.marketCount || latest.marketCount;
          latest.createdAt = new Date().toISOString();
          latest.disclaimer = ranking.disclaimer || latest.disclaimer;
          if (ranking.contextId) latest.contextId = ranking.contextId;
          if (ranking.contextName) latest.contextName = ranking.contextName;
          await client.upsert(TABLES.rankings, [{
            id: latest.id,
            owner_id: ownerId,
            payload: latest,
            created_at: latest.createdAt
          }], 'owner_id,id');
          return latest;
        }
      }

      await client.upsert(TABLES.rankings, [{
        id: ranking.id,
        owner_id: ownerId,
        payload: ranking,
        created_at: ranking.createdAt || new Date().toISOString()
      }], 'owner_id,id');
      return ranking;
    },

    async readSharedPredictionResults(fixtureId) {
      const rows = await client.selectRows(TABLES.sharedPredictionResults, 'model_key,payload', {
        fixture_id: `eq.${fixtureId}`,
        order: 'created_at.asc'
      });
      return rows.map((row) => ({ modelKey: row.model_key, result: row.payload }));
    },

    async saveSharedPredictionResults(fixtureId, results = []) {
      if (!results.length) return [];
      await client.upsert(TABLES.sharedPredictionResults, results.map((result) => ({
        fixture_id: String(fixtureId),
        model_key: predictionModelKey(result.modelName || result.modelId),
        model_id: result.modelId || null,
        payload: result,
        created_at: result.generatedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      })), 'fixture_id,model_key');
      return results;
    },

    async readPredictionSettings() {
      const rows = await client.selectRows(TABLES.predictionSettings, '*', {
        key: 'eq.default',
        limit: '1'
      });
      const row = rows[0] || {};
      return {
        championModelKey: row.champion_model_key || 'qwen',
        liveModelKeys: Array.isArray(row.live_model_keys) ? row.live_model_keys : ['gpt', 'claude', 'gemini'],
        modelWeights: row.model_weights && typeof row.model_weights === 'object' ? row.model_weights : {}
      };
    },

    async readCurrentPredictionConsensus(fixtureId) {
      const rows = await client.selectRows(TABLES.predictionConsensus, '*', {
        fixture_id: `eq.${fixtureId}`,
        is_current: 'eq.true',
        limit: '1'
      });
      const row = rows[0];
      return row ? {
        id: row.id,
        fixtureId: row.fixture_id,
        phase: row.phase,
        ranking: row.payload,
        sourceSnapshotIds: row.source_snapshot_ids || [],
        isCurrent: Boolean(row.is_current),
        generatedAt: row.generated_at
      } : null;
    },

    async appendPredictionSnapshots(snapshots = []) {
      if (!snapshots.length) return [];
      await client.insert(TABLES.predictionSnapshots, snapshots.map((snapshot) => ({
        id: snapshot.id || crypto.randomUUID(),
        fixture_id: String(snapshot.fixtureId),
        phase: snapshot.phase,
        model_key: snapshot.modelKey || predictionModelKey(snapshot.result?.modelName || snapshot.modelId),
        model_id: snapshot.modelId || null,
        payload: snapshot.result,
        generated_at: snapshot.generatedAt || new Date().toISOString()
      })));
      return snapshots;
    },

    async publishPredictionConsensus(consensus) {
      const row = await client.rpc('publish_prediction_consensus', {
        p_id: consensus.id || crypto.randomUUID(),
        p_fixture_id: String(consensus.fixtureId),
        p_phase: consensus.phase,
        p_payload: consensus.ranking,
        p_source_snapshot_ids: consensus.sourceSnapshotIds || [],
        p_generated_at: consensus.generatedAt || new Date().toISOString()
      });
      return Array.isArray(row) ? row[0] : row;
    },

    async reservePredictionGeneration({
      fixtureId,
      phase,
      leaseId,
      ttlSeconds = 120
    }) {
      const row = await client.rpc('reserve_prediction_generation', {
        p_fixture_id: String(fixtureId),
        p_phase: phase,
        p_lease_id: leaseId,
        p_ttl_seconds: ttlSeconds
      });
      return Array.isArray(row) ? row[0] : row;
    },

    async releasePredictionGeneration(leaseId) {
      return client.rpc('release_prediction_generation', {
        p_lease_id: leaseId
      });
    },

    async saveWeeklyModelPerformance(settlement) {
      if (!settlement?.rows?.length) return settlement;
      await client.upsert(TABLES.modelWeeklyPerformance, settlement.rows.map((row) => ({
        week_start: settlement.weekStart,
        model_key: row.modelKey,
        model_name: row.modelName,
        samples: row.samples,
        hits: row.hits,
        accuracy: row.accuracy,
        eligible: row.eligible,
        is_champion: row.isChampion,
        metrics: { categories: row.categories, minimumSamples: settlement.minimumSamples },
        updated_at: new Date().toISOString()
      })), 'week_start,model_key');
      if (settlement.championModelKey) {
        await client.updateRows(TABLES.predictionSettings, {
          champion_model_key: settlement.championModelKey,
          updated_at: new Date().toISOString()
        }, { key: 'eq.default' });
      }
      return settlement;
    },

    async readWeeklyModelPerformance(weekStart) {
      return client.selectRows(TABLES.modelWeeklyPerformance, '*', {
        week_start: `eq.${weekStart}`,
        order: 'accuracy.desc'
      });
    },

    async readWeeklySettlementData() {
      const [predictionSnapshots, contexts] = await Promise.all([
        client.selectAllRows(TABLES.predictionSnapshots, '*', { order: 'generated_at.desc' }),
        client.selectAllRows(TABLES.matchContexts, 'payload,updated_at', { order: 'updated_at.desc' })
      ]);
      return { predictionSnapshots, contexts };
    },

    async upsertMatchContext(context, { ownerId = 'guest' } = {}) {
      await client.upsert(TABLES.matchContexts, [{
        id: context.id,
        owner_id: ownerId,
        source_url: context.sourceUrl || context.id,
        payload: context,
        captured_at: context.capturedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }], 'owner_id,id');
      return context;
    },

    async readMatchSchedule(competitionId) {
      const rows = await client.select(TABLES.matchSchedules, 'updated_at.desc', 1, '', `competition_id=eq.${encodeURIComponent(competitionId)}`);
      return rows[0]?.payload || null;
    },

    async listMatchSchedules() {
      return readPayloads(client, TABLES.matchSchedules, 'updated_at.desc', 100);
    },

    async upsertMatchSchedules(schedules) {
      if (!schedules.length) return [];
      const now = new Date().toISOString();
      await client.upsert(TABLES.matchSchedules, schedules.map((schedule) => ({
        id: `competition:${schedule.competitionId}`,
        competition_id: String(schedule.competitionId),
        payload: schedule,
        fetched_at: schedule.fetchedAt || now,
        updated_at: now
      })), 'competition_id');
      return schedules;
    },

    async readApiFootballCatalog(cacheKey, { now = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
      const rows = await client.select(
        TABLES.apiFootballCatalogCache,
        'updated_at.desc',
        1,
        '',
        `cache_key=eq.${cacheKey}`
      );
      const cached = rows[0]?.payload;
      const fetchedAt = Date.parse(cached?.fetchedAt || '');
      if (!cached?.catalog || !Number.isFinite(fetchedAt) || now - fetchedAt > maxAgeMs) return null;
      return cached.catalog;
    },

    async upsertApiFootballCatalog(cacheKey, catalog) {
      const now = new Date().toISOString();
      await client.upsert(TABLES.apiFootballCatalogCache, [{
        cache_key: cacheKey,
        payload: { catalog, fetchedAt: now },
        fetched_at: now,
        updated_at: now
      }], 'cache_key');
      return catalog;
    },

    async recordAiUsageEvents(events = []) {
      if (!events.length) return [];
      await client.upsert(TABLES.aiUsageEvents, events.map((event) => ({
        owner_id: event.ownerId,
        request_kind: event.requestKind,
        model_name: event.modelName,
        model_id: event.modelId || null,
        provider: event.provider || 'unknown',
        input_tokens: Number(event.inputTokens) || 0,
        output_tokens: Number(event.outputTokens) || 0,
        total_tokens: Number(event.totalTokens) || 0,
        cost_usd: Number(event.costUsd) || 0,
        cost_reported: Boolean(event.costReported),
        status: event.status || 'success',
        context_id: event.contextId || null,
        error_message: event.errorMessage || null,
        created_at: event.createdAt || new Date().toISOString()
      })));
      return events;
    },

    async recordSystemEvent(eventType, payload = {}) {
      const event = { event_type: eventType, payload, created_at: new Date().toISOString() };
      await client.upsert(TABLES.systemEvents, [event]);
      return event;
    },

    async reservePredictionRequest({ ownerId, fixtureId, planId, dailyLimit, cooldownSeconds = 90 }) {
      return client.rpc('reserve_prediction_request', {
        p_owner_id: ownerId,
        p_fixture_id: String(fixtureId),
        p_plan_id: planId,
        p_daily_limit: dailyLimit,
        p_cooldown_seconds: cooldownSeconds
      });
    },

    async completePredictionRequest(requestId, { status, cached = false, errorMessage = '' }) {
      await client.updateRows(TABLES.predictionRequests, {
        status,
        cached: Boolean(cached),
        error_message: errorMessage || null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { id: `eq.${requestId}` });
    },

    async readAdminDashboardData() {
      const [users, aiUsage, systemEvents, rankings, contexts, schedules, orders, entitlements, sharedPredictions, predictionRequests, predictionSnapshots, predictionConsensus, weeklyPerformance, predictionSettings] = await Promise.all([
        client.listAuthUsers(),
        client.selectAllRows(TABLES.aiUsageEvents, '*', { order: 'created_at.desc' }),
        client.selectRows(TABLES.systemEvents, '*', { order: 'created_at.desc', limit: '500' }),
        client.selectAllRows(TABLES.rankings, 'owner_id,payload,created_at', { order: 'created_at.desc' }),
        client.selectAllRows(TABLES.matchContexts, 'owner_id,payload,created_at', { order: 'created_at.desc' }),
        client.selectRows(TABLES.matchSchedules, 'payload,updated_at', { order: 'updated_at.desc', limit: '500' }),
        client.selectAllRows(TABLES.billingOrders, '*', { order: 'created_at.desc' }),
        client.selectRows(TABLES.billingEntitlements, '*', { limit: '1000' }),
        client.selectRows(TABLES.sharedPredictionResults, 'fixture_id,model_key,model_id,payload,created_at,updated_at', { order: 'updated_at.desc', limit: '5000' }),
        client.selectAllRows(TABLES.predictionRequests, '*', { order: 'created_at.desc' }),
        client.selectAllRows(TABLES.predictionSnapshots, '*', { order: 'generated_at.desc' }),
        client.selectAllRows(TABLES.predictionConsensus, '*', { order: 'generated_at.desc' }),
        client.selectAllRows(TABLES.modelWeeklyPerformance, '*', { order: 'week_start.desc' }),
        client.selectRows(TABLES.predictionSettings, '*', { limit: '10' })
      ]);
      return {
        users, aiUsage, systemEvents, rankings, contexts, schedules, orders, entitlements,
        sharedPredictions, predictionRequests, predictionSnapshots, predictionConsensus,
        weeklyPerformance, predictionSettings
      };
    },

    async createBillingOrder(order) {
      const now = new Date().toISOString();
      await client.upsert(TABLES.billingOrders, [{
        id: order.id,
        owner_id: order.ownerId,
        plan_id: order.planId,
        amount_cents: order.amountCents,
        allscale_intent_id: order.intentId || null,
        checkout_url: order.checkoutUrl || null,
        status: Number.isFinite(Number(order.status)) ? Number(order.status) : 1,
        request_id: order.requestId || null,
        created_at: order.createdAt || now,
        updated_at: now
      }]);
      return order;
    },

    async updateBillingOrder(orderId, fields = {}) {
      const fieldsToUpdate = {
        ...(fields.intentId ? { allscale_intent_id: fields.intentId } : {}),
        ...(fields.checkoutUrl ? { checkout_url: fields.checkoutUrl } : {}),
        ...(Number.isFinite(Number(fields.status)) ? { status: Number(fields.status) } : {}),
        ...(fields.requestId ? { request_id: fields.requestId } : {}),
        updated_at: new Date().toISOString()
      };
      await client.updateRows(TABLES.billingOrders, fieldsToUpdate, { id: `eq.${orderId}` });
      return fields;
    },

    async readBillingOrder(ownerId, orderId) {
      const rows = await client.selectRows(TABLES.billingOrders, '*', {
        owner_id: `eq.${ownerId}`,
        id: `eq.${orderId}`,
        limit: '1'
      });
      return rows[0] ? mapBillingOrder(rows[0]) : null;
    },

    async countRecentBillingOrders(ownerId, since) {
      const rows = await client.selectRows(TABLES.billingOrders, 'id', {
        owner_id: `eq.${ownerId}`,
        created_at: `gte.${since}`,
        limit: '10'
      });
      return rows.length;
    },

    async listPendingBillingOrders(since) {
      const rows = await client.selectRows(TABLES.billingOrders, '*', {
        status: 'gte.0',
        created_at: `gte.${since}`,
        order: 'updated_at.asc',
        limit: '50'
      });
      return rows.filter((row) => Number(row.status) !== 20).map(mapBillingOrder);
    },

    async readBillingEntitlement(ownerId) {
      const rows = await client.selectRows(TABLES.billingEntitlements, '*', {
        owner_id: `eq.${ownerId}`,
        limit: '1'
      });
      return rows[0] ? mapBillingEntitlement(rows[0]) : {};
    },

    async consumeFreePrediction(ownerId) {
      return Boolean(await client.rpc('consume_free_prediction', { p_owner_id: ownerId }));
    },

    async releaseFreePrediction(ownerId) {
      await client.rpc('release_free_prediction', { p_owner_id: ownerId });
    },

    async confirmAllScalePayment(input) {
      return client.rpc('confirm_allscale_payment', {
        p_intent_id: input.intentId,
        p_webhook_id: input.webhookId,
        p_nonce: input.nonce,
        p_transaction_id: input.transactionId || null,
        p_amount_cents: input.amountCents ?? null,
        p_payload: input.payload || {}
      });
    }
  };
}

function mapBillingOrder(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    planId: row.plan_id,
    amountCents: row.amount_cents,
    intentId: row.allscale_intent_id,
    checkoutUrl: row.checkout_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at
  };
}

function mapBillingEntitlement(row) {
  return {
    ownerId: row.owner_id,
    planId: row.plan_id,
    validUntil: row.valid_until,
    freePredictionUsed: Boolean(row.free_prediction_used),
    updatedAt: row.updated_at
  };
}

function resultModelKey(modelName = '') {
  const text = String(modelName || '').toLowerCase();
  if (text.includes('gpt') || text.includes('openai')) return 'gpt';
  if (text.includes('claude')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('qwen') || text.includes('通义')) return 'qwen';
  return text || 'ai';
}

async function readPayloads(client, table, order, limit, ownerId = '') {
  const rows = await client.select(table, order, limit, ownerId);
  return rows.map((row) => row.payload).filter(Boolean);
}

class SupabaseRestClient {
  constructor(baseUrl, serviceKey, fetchImpl) {
    this.baseUrl = baseUrl;
    this.serviceKey = serviceKey;
    this.fetchImpl = fetchImpl;
  }

  async select(table, order, limit, ownerId = '', filter = '') {
    const query = new URLSearchParams({
      select: 'payload',
      order,
      limit: String(limit)
    });
    if (ownerId) query.set('owner_id', `eq.${ownerId}`);
    if (filter) {
      const [column, value] = filter.split('=', 2);
      if (column && value) query.set(column, value);
    }
    return this.request(`${table}?${query.toString()}`);
  }

  async upsert(table, rows, conflict = 'id') {
    return this.request(`${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
  }

  async insert(table, rows) {
    return this.request(table, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(rows)
    });
  }

  async selectRows(table, columns = '*', filters = {}) {
    const query = new URLSearchParams({ select: columns });
    for (const [key, value] of Object.entries(filters)) {
      if (value !== '' && value !== null && value !== undefined) query.set(key, String(value));
    }
    return this.request(`${table}?${query.toString()}`);
  }

  async selectAllRows(table, columns = '*', filters = {}, pageSize = 1000) {
    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.selectRows(table, columns, { ...filters, limit: pageSize, offset });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  async rpc(name, body) {
    return this.request(`rpc/${name}`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async updateRows(table, fields, filters = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) query.set(key, String(value));
    return this.request(`${table}?${query.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(fields)
    });
  }

  async deleteAll(table, ownerId = '') {
    const query = new URLSearchParams({ id: 'not.is.null' });
    if (ownerId) query.set('owner_id', `eq.${ownerId}`);
    return this.request(`${table}?${query.toString()}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
  }

  async listAuthUsers() {
    const response = await this.fetchImpl(`${this.baseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase Auth ${response.status}: ${body.slice(0, 300)}`);
    }
    const payload = await response.json();
    return Array.isArray(payload) ? payload : (payload.users || []);
  }

  async request(path, options = {}) {
    const response = await this.fetchImpl(`${this.baseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase ${response.status}: ${body.slice(0, 300)}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
