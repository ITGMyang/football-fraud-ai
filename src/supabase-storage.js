const TABLES = {
  markets: 'markets',
  reports: 'reports',
  rankings: 'rankings',
  matchContexts: 'match_contexts'
};

export function createSupabaseStorage(env, fetchImpl = fetch) {
  const baseUrl = String(env.SUPABASE_URL || '').replace(/^\uFEFF/, '').trim().replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY || '';
  if (!baseUrl || !serviceKey) {
    throw new Error('Cloudflare 部署需要配置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 或 SUPABASE_SECRET_KEY');
  }

  const client = new SupabaseRestClient(baseUrl, serviceKey, fetchImpl);

  return {
    async readDb() {
      const [markets, reports, rankings, matchContexts] = await Promise.all([
        readPayloads(client, TABLES.markets, 'updated_at.desc', 500),
        readPayloads(client, TABLES.reports, 'created_at.desc', 100),
        readPayloads(client, TABLES.rankings, 'created_at.desc', 50),
        readPayloads(client, TABLES.matchContexts, 'updated_at.desc', 20)
      ]);
      return { markets, reports, rankings, matchContexts };
    },

    async upsertMarkets(markets) {
      if (!markets.length) return [];
      await client.upsert(TABLES.markets, markets.map((market) => ({
        id: market.id,
        payload: market,
        updated_at: new Date().toISOString()
      })));
      return markets;
    },

    async clearMarkets() {
      await Promise.all([
        client.deleteAll(TABLES.markets),
        client.deleteAll(TABLES.reports),
        client.deleteAll(TABLES.rankings)
      ]);
    },

    async saveReport(report) {
      await client.upsert(TABLES.reports, [{
        id: report.id,
        payload: report,
        created_at: report.createdAt || new Date().toISOString()
      }]);
      return report;
    },

    async saveRanking(ranking, { mergeLatest = false } = {}) {
      if (mergeLatest) {
        const rankings = await readPayloads(client, TABLES.rankings, 'created_at.desc', 50);
        const latest = ranking.contextId
          ? rankings.find((item) => item.contextId === ranking.contextId)
          : rankings[0];
        if (latest) {
          const byModel = new Map((latest.results || []).map((result) => [result.modelName, result]));
          for (const result of ranking.results || []) byModel.set(result.modelName, result);
          latest.results = [...byModel.values()];
          latest.marketCount = ranking.marketCount || latest.marketCount;
          latest.createdAt = new Date().toISOString();
          latest.disclaimer = ranking.disclaimer || latest.disclaimer;
          if (ranking.contextId) latest.contextId = ranking.contextId;
          if (ranking.contextName) latest.contextName = ranking.contextName;
          await client.upsert(TABLES.rankings, [{
            id: latest.id,
            payload: latest,
            created_at: latest.createdAt
          }]);
          return latest;
        }
      }

      await client.upsert(TABLES.rankings, [{
        id: ranking.id,
        payload: ranking,
        created_at: ranking.createdAt || new Date().toISOString()
      }]);
      return ranking;
    },

    async upsertMatchContext(context) {
      await client.upsert(TABLES.matchContexts, [{
        id: context.id,
        source_url: context.sourceUrl || context.id,
        payload: context,
        captured_at: context.capturedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);
      return context;
    }
  };
}

async function readPayloads(client, table, order, limit) {
  const rows = await client.select(table, order, limit);
  return rows.map((row) => row.payload).filter(Boolean);
}

class SupabaseRestClient {
  constructor(baseUrl, serviceKey, fetchImpl) {
    this.baseUrl = baseUrl;
    this.serviceKey = serviceKey;
    this.fetchImpl = fetchImpl;
  }

  async select(table, order, limit) {
    const query = new URLSearchParams({
      select: 'payload',
      order,
      limit: String(limit)
    });
    return this.request(`${table}?${query.toString()}`);
  }

  async upsert(table, rows) {
    return this.request(`${table}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
  }

  async deleteAll(table) {
    return this.request(`${table}?id=not.is.null`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' }
    });
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
