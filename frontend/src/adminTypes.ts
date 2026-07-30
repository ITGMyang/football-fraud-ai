// Shape of GET /api/admin/dashboard, mirroring buildAdminDashboard in src/admin-dashboard.js.

export type UsageModelRow = {
  modelName: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costReportedCalls: number;
  costEstimatedCalls: number;
  costAvailableCalls: number;
  errors: number;
};

export type UsageSummary = {
  calls: number;
  users: number;
  tokens: number;
  costUsd: number;
  costReportedCalls: number;
  costEstimatedCalls: number;
  costAvailableCalls: number;
  errors: number;
  models: UsageModelRow[];
};

export type CoreMetrics = {
  apiFootballCallsToday: number;
  apiFootballDailyLimit: number;
  modelCallsToday: number;
  modelUsersToday: number;
  predictionRequestsToday: number;
  predictionRequestErrorsToday: number;
  predictionRequestsCachedToday: number;
  predictionQueueActive: number;
  modelCostTodayUsd: number;
  modelCostReportedCalls: number;
  modelCostEstimatedCalls: number;
  modelCostAvailableCalls: number;
  lastRefreshAt: string;
  lastRefreshStatus: string;
  cachedMatches: number;
};

export type SharedPoolMatch = {
  fixtureId: string;
  matchName: string;
  competition: string;
  kickoff: string;
  phase: string;
  publishedModel: string;
  cachedCount: number;
  latestUpdatedAt: string;
  models: Record<string, string>;
};

export type WeeklyModelRow = {
  modelKey: string;
  modelName: string;
  samples: number;
  hits: number;
  accuracy: number;
  eligible: boolean;
  isChampion: boolean;
};

export type AccuracyEvaluation = {
  contextId: string;
  contextName: string;
  kickoff: string;
  matchDate: string;
  predictedAt: string;
  modelName: string;
  category: string;
  selection: string;
  estimatedProbability: number | null;
  actualScore: string;
  competition: string;
  counted: boolean;
  hit: boolean;
  outcome: string;
};

export type AccuracyBucket = { key: string; total: number; hits: number; accuracy: number };

export type Accuracy = {
  contextCount: number;
  scoredContextCount: number;
  finishedWithoutScoreCount: number;
  evaluatedCount: number;
  matchCount: number;
  uniqueModelPredictions: number;
  hits: number;
  total: number;
  accuracy: number;
  models: AccuracyBucket[];
  categories: AccuracyBucket[];
  evaluations: AccuracyEvaluation[];
};

export type LeagueRow = {
  name: string;
  cachedMatches: number;
  imports: number;
  predictions: number;
  modelCalls: number;
  failedCalls: number;
  totalTokens: number;
  reviewRequired: boolean;
};

export type UserRow = {
  id: string;
  email: string;
  provider: string;
  planId: string;
  validUntil: string;
  predictionRuns: number;
  predictionRequests: number;
  cachedResponses: number;
  failedRequests: number;
  callsToday: number;
  createdAt: string;
  lastSeenAt: string;
};

export type OrderRow = {
  id: string;
  ownerId: string;
  email: string;
  planId: string;
  amountUsd: number;
  status: number;
  failureReason: string;
  requestId: string;
  createdAt: string;
  confirmedAt: string;
  expiresAt: string;
};

export type RevenuePeriod = { count: number; amountUsd: number };
export type OrderStatusCounts = { pending: number; completed: number; failed: number };

export type Dashboard = {
  generatedAt: string;
  core: CoreMetrics;
  models: UsageModelRow[];
  modelUsage: {
    selectedDate: string;
    availableDates: string[];
    selected: UsageSummary;
    total: UsageSummary;
  };
  accuracy: Accuracy;
  sharedPool: { totalMatches: number; totalResults: number; matches: SharedPoolMatch[] };
  predictionArchitecture: {
    championModelKey: string;
    liveModelKeys: string[];
    modelWeights: Record<string, number>;
    snapshotCount: number;
    consensusCount: number;
    currentConsensusCount: number;
    latestWeek: { weekStart: string; rows: WeeklyModelRow[] };
  };
  leagues: LeagueRow[];
  leagueAudit: { duplicateFixtures: number; duplicateLeagues: number; reviewCompetitions: number };
  users: {
    total: number;
    newToday: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    paid: number;
    activePlans: Record<string, number>;
    purchasesToday: Record<string, number>;
  };
  userRows: UserRow[];
  orders: {
    confirmedRevenueUsd: number;
    confirmedCount: number;
    pendingCount: number;
    failedCount: number;
    revenue: Record<string, RevenuePeriod>;
    statusCounts: OrderStatusCounts;
    byPlan: Record<string, OrderStatusCounts & { total: number; customers: number; revenueUsd: number }>;
  };
  recentOrders: OrderRow[];
};

// Shape of GET /api/admin/traffic — Cloudflare zone analytics.

export type TrafficDay = {
  date: string;
  uniques: number;
  requests: number;
  pageViews: number;
  bytes: number;
  threats: number;
};

export type TrafficCountry = {
  country: string;
  requests: number;
  threats: number;
  share: number;
};

export type Traffic = {
  configured: boolean;
  ok?: boolean;
  reason?: string;
  error?: string;
  since: string;
  until: string;
  days: number;
  totals?: {
    peakDailyUniques: number;
    dailyUniqueSum: number;
    requests: number;
    pageViews: number;
    bytes: number;
    threats: number;
    countries: number;
  };
  daily?: TrafficDay[];
  countries?: TrafficCountry[];
};

// Shape of GET /api/backend/schedules — the API-Football cache written by the cron.

export type ScheduleMatch = {
  matchId?: string;
  id?: string;
  home?: string;
  away?: string;
  competition?: string;
  kickoff?: string;
  date?: string;
  status?: string;
  hasOdds?: boolean;
};

export type ProviderCheck = {
  status?: string;
  stage?: string;
  fixtureCount?: number;
  oddsCount?: number;
  checkedAt?: string;
};

export type Schedule = {
  source?: string;
  competitionId?: string;
  date?: string;
  fetchedAt?: string;
  matches?: ScheduleMatch[];
  providerChecks?: Record<string, ProviderCheck>;
};

export type FixtureContext = {
  matchName?: string;
  competition?: string;
  kickoff?: string;
  status?: string;
  actualScore?: string;
  fixture?: Record<string, unknown>;
  catalog?: { teamStatistics?: Record<string, unknown>[]; standings?: string[]; topScorers?: string[] };
  analysis?: { h2h?: string[]; teamStatistics?: { team: string; values: Record<string, unknown> }[] };
  lineup?: { formation?: string; players?: string[]; notes?: string[] };
  index?: { handicapRows?: string[] };
  live?: string[];
  // Each endpoint reports an object, not a status string.
  fetchStatus?: Record<string, { state?: string; count?: number; error?: string }>;
};
