import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";

import { accountIdentity, analysisRequestPlan, createApiClient, hasPlayerInformation, normalizeMatches, predictionActionLabel, predictionHistory, predictionModelRail, rankingForMatch, rankingView, teamCrestUrl, userFacingError } from "./api.js";

type Screen = "splash" | "auth" | "login" | "signup" | "dashboard" | "profile" | "plans" | "details";
type Team = { name: string; flag: string };
type Match = {
  id: string;
  date: string;
  kickoff: string;
  teamA: Team;
  teamB: Team;
  status: "upcoming" | "live" | "complete";
  score?: string;
  round: string;
  playerInfoAvailable?: boolean;
};
type Billing = {
  tier?: string;
  active?: boolean;
  planId?: string;
  validUntil?: string;
  freePredictionUsed?: boolean;
};
type Plan = {
  id: string;
  name: string;
  price: string;
  currency: string;
  durationHours: number;
  recommended?: boolean;
};
type Access = {
  authenticated?: boolean;
  guestPredictionUsed?: boolean;
  billing?: Billing;
  plans?: Plan[];
};
type ScorePick = { score: string; type: string; probability: number; reason: string };
type PredictionPick = {
  label: string;
  type: string;
  probability: number;
  confidence: number;
  reason: string;
  risks: string[];
};
type ModelView = {
  name: string;
  provider: string;
  phase: string;
  scores: ScorePick[];
  btts: PredictionPick | null;
  total: PredictionPick | null;
  handicap: PredictionPick | null;
  moneyline: PredictionPick | null;
  picks: PredictionPick[];
};
type RankingView = {
  contextId: string;
  matchName: string;
  createdAt: string;
  models: ModelView[];
};
type HistoryMatch = Match & {
  countryFlag: string;
  result: "hit" | "miss" | "pending";
  ranking: RankingView;
};
type HistoryGroup = {
  date: string;
  label: string;
  matches: HistoryMatch[];
};
type AuthConfig = {
  enabled: boolean;
  supabaseUrl: string;
  publishableKey: string;
  siteUrl?: string;
  telegramEnabled?: boolean;
  error?: string;
};

function AssetIcon({ src, alt = "", size = 18 }: { src: string; alt?: string; size?: number }) {
  return <img className="asset-icon" src={src} alt={alt} width={size} height={size} />;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "logo logo--compact" : "logo"}>
      <img src="/assets/brand-ball.svg" alt="" />
      <img src="/assets/brand-wordmark.svg" alt="FutBots" />
    </div>
  );
}

function TeamFlag({ team, size = 34 }: { team: Team; size?: number }) {
  return team.flag ? (
    <img className="team-flag" src={teamCrestUrl(team.flag)} alt={`${team.name} crest`} width={size} height={size} />
  ) : (
    <span className="team-flag team-flag--fallback" style={{ width: size, height: size }}>
      {team.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function AccountAvatar({ session, size = 32 }: { session: Session | null; size?: number }) {
  const identity = accountIdentity(session?.user || {});
  return identity.avatarUrl ? (
    <img
      className="account-avatar"
      src={identity.avatarUrl}
      alt={`${identity.name} avatar`}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="account-avatar account-avatar--fallback" style={{ width: size, height: size }}>
      {identity.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="circle-button" onClick={onClick} aria-label="Go back">
      <AssetIcon src="/assets/back.svg" size={24} />
    </button>
  );
}

function BrandSplash() {
  return (
    <section className="splash" aria-label="FutBots">
      <div className="splash__background" />
      <div className="splash__brand">
        <div className="splash__ball">
          <img className="splash__ring" src="/assets/brand-ring.svg" alt="" />
          <img className="splash__rotor" src="/assets/brand-rotor.svg" alt="" />
          <img className="splash__core" src="/assets/brand-core.svg" alt="" />
        </div>
        <img className="splash__wordmark" src="/assets/brand-wordmark.svg" alt="FutBots" />
      </div>
    </section>
  );
}

function AuthShell({ title, children, showBall = false }: {
  title?: string;
  children: React.ReactNode;
  showBall?: boolean;
}) {
  return (
    <section className={`auth-shell ${showBall ? "auth-shell--flags" : ""}`}>
      <div className="auth-shell__scrim" />
      <div className="auth-shell__content">
        {showBall && (
          <div className="auth-hero">
            <img src="/assets/brand-ball.svg" alt="" />
            <h1>Not Sure? Bot It</h1>
          </div>
        )}
        {title && <h1 className="auth-title">{title}</h1>}
        {children}
      </div>
      <div className="auth-footer">
        <img className="auth-footer__wordmark" src="/assets/brand-wordmark.svg" alt="FutBots" />
        <p>Predictions are informational and are never used to place bets automatically.</p>
      </div>
    </section>
  );
}

function AuthLanding({ navigate, signInProvider, continueGuest, telegramEnabled, error }: {
  navigate: (screen: Screen) => void;
  signInProvider: (provider: "google" | "custom:telegram") => Promise<void>;
  continueGuest: () => void;
  telegramEnabled: boolean;
  error: string;
}) {
  return (
    <AuthShell showBall>
      <div className="social-actions">
        <button onClick={() => navigate("login")}>
          <AssetIcon src="/assets/brand-ball.svg" size={32} />
          Login with FutBots account
        </button>
        <button onClick={() => void signInProvider("google")}>
          <AssetIcon src="/assets/google.svg" size={32} />
          Continue with Google
        </button>
        <button disabled={!telegramEnabled} onClick={() => void signInProvider("custom:telegram")}>
          <AssetIcon src="/assets/telegram.svg" size={32} />
          {telegramEnabled ? "Continue with Telegram" : "Telegram unavailable"}
        </button>
        <button className="guest-button" onClick={continueGuest}>Browse as guest</button>
        {error && <p className="auth-message error-text" role="alert">{error}</p>}
      </div>
    </AuthShell>
  );
}

function AccountForm({ mode, navigate, submitAuth }: {
  mode: "login" | "signup";
  navigate: (screen: Screen) => void;
  submitAuth: (mode: "login" | "signup", email: string, password: string) => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const signup = mode === "signup";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (password.length < 8) return setMessage("Password must be at least 8 characters.");
    setBusy(true);
    setMessage("");
    try {
      setMessage(await submitAuth(mode, String(data.get("email") || ""), password));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={signup ? "Create account" : "Welcome back"} showBall={!signup}>
      <form className="account-form" onSubmit={(event) => void submit(event)}>
        <label><span>Email</span><input name="email" type="email" autoComplete="email" required /></label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Please wait..." : signup ? "Create" : "Login"}
        </button>
        <button className="text-button" type="button" onClick={() => navigate(signup ? "login" : "signup")}>
          {signup ? "Already have an account? Login" : "Create account"}
        </button>
        {message && <p className="auth-message" role="status">{message}</p>}
      </form>
    </AuthShell>
  );
}

function CalendarStrip({ selectedDate, onDate }: { selectedDate: string; onDate: (date: string) => void }) {
  const dates = useMemo(() => {
    const base = new Date(`${selectedDate}T12:00:00+08:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() + index - 3);
      return {
        value: date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
        weekday: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: "Asia/Shanghai" }),
        day: date.toLocaleDateString("en-US", { day: "2-digit", timeZone: "Asia/Shanghai" })
      };
    });
  }, [selectedDate]);
  const month = new Date(`${selectedDate}T12:00:00+08:00`).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "Asia/Shanghai"
  });
  return (
    <div className="calendar">
      <div className="calendar__month"><span>{month}</span></div>
      <div className="calendar__days">
        {dates.map((date) => (
          <button className={`calendar__day ${date.value === selectedDate ? "is-active" : ""}`} key={date.value} onClick={() => onDate(date.value)}>
            <span>{date.weekday}</span><b>{date.day}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ match }: { match: Match }) {
  const label = match.status === "live" ? "Live" : match.status === "complete" ? "Complete" : "Upcoming";
  return <span className={`status-badge status-badge--${match.status}`}>{label}</span>;
}

function PredictionCard({ match, ranking, onStart, onDetails, onResult }: {
  match: Match;
  ranking: RankingView | null;
  onStart: () => void;
  onDetails: () => void;
  onResult: () => void;
}) {
  return (
    <article className="prediction-card">
      <div className="prediction-card__top"><span>{match.date}</span><StatusBadge match={match} /></div>
      <div className="prediction-card__teams">
        <div><TeamFlag team={match.teamA} /><b>{match.teamA.name}</b></div>
        <strong>{match.score || "VS"}</strong>
        <div><TeamFlag team={match.teamB} /><b>{match.teamB.name}</b></div>
      </div>
      <div className="prediction-card__meta"><span>{match.round}</span></div>
      <div className="prediction-card__actions">
        <button className="card-link" onClick={onDetails}>View details</button>
        <button
          className="primary-button primary-button--card"
          onClick={ranking ? onResult : onStart}
          disabled={match.status === "complete" && !ranking}
        >
          {predictionActionLabel(ranking)}
        </button>
      </div>
    </article>
  );
}

function SideNavigation({ screen, navigate, access, session, onSignOut }: {
  screen: Screen;
  navigate: (screen: Screen) => void;
  access: Access;
  session: Session | null;
  onSignOut: () => Promise<void>;
}) {
  const plan = access.billing?.active ? "AI Pass Active" : access.billing?.freePredictionUsed ? "Trial Used" : "Free Trial";
  const identity = accountIdentity(session?.user || {});
  return (
    <aside className="desktop-nav">
      <Logo />
      <nav>
        <button className={screen === "dashboard" ? "is-active" : ""} onClick={() => navigate("dashboard")}>Predictions</button>
        <button className={screen === "profile" ? "is-active" : ""} onClick={() => navigate("profile")}>My Profile</button>
        <button className={screen === "plans" ? "is-active" : ""} onClick={() => navigate("plans")}>Plans</button>
      </nav>
      <div className="desktop-nav__plan">
        <span>Current access</span><b>{plan}</b>
        {access.billing?.validUntil && <small>Through {new Date(access.billing.validUntil).toLocaleDateString()}</small>}
      </div>
      <button className="desktop-nav__account" onClick={() => session ? void onSignOut() : navigate("login")}>
        <AccountAvatar session={session} />
        <span><b>{session ? identity.name : "Guest mode"}</b><small>{session ? identity.provider : "Sign in to save predictions"}</small></span>
        <strong>{session ? "Log out" : "Log in"}</strong>
      </button>
      <a className="console-link" href="/backend">Data Console</a>
    </aside>
  );
}

function Dashboard({ navigate, matches, rankings, loading, error, access, session, selectedDate, onDate, onOpenMatch, onOpenResult, onSignOut }: {
  navigate: (screen: Screen) => void;
  matches: Match[];
  rankings: RankingView[];
  loading: boolean;
  error: string;
  access: Access;
  session: Session | null;
  selectedDate: string;
  onDate: (date: string) => void;
  onOpenMatch: (match: Match) => void;
  onOpenResult: (match: Match) => void;
  onSignOut: () => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = accountIdentity(session?.user || {});
  return (
    <div className="app-with-nav">
      <SideNavigation screen="dashboard" navigate={navigate} access={access} session={session} onSignOut={onSignOut} />
      <main className="dashboard">
        <div className="dashboard__top">
          <header className="dashboard-header">
            <Logo compact />
            <button className="plan-pill" onClick={() => navigate("profile")}>
              <AccountAvatar session={session} size={24} />
              {session ? identity.name : "Guest"}
            </button>
            <button className="circle-button" onClick={() => setMenuOpen((value) => !value)} aria-label="Open menu">
              <AssetIcon src="/assets/menu.svg" size={22} />
            </button>
          </header>
          {menuOpen && (
            <div className="mobile-menu">
              <button onClick={() => navigate("profile")}>Profile</button>
              <button onClick={() => navigate("plans")}>Plans</button>
              {session
                ? <button onClick={() => void onSignOut()}>Log out</button>
                : <button onClick={() => navigate("login")}>Log in</button>}
            </div>
          )}
          <CalendarStrip selectedDate={selectedDate} onDate={onDate} />
        </div>
        <div className="dashboard__content">
          <div className="dashboard__main">
            <div className="section-heading"><h1>Predictions</h1><span>Verified pre-match odds</span></div>
            {error && <div className="app-notice app-notice--error" role="alert">{error}</div>}
            {loading && <div className="loading-field"><AssetIcon src="/assets/spinner.svg" size={28} />Loading matches…</div>}
            {!loading && !matches.length && <div className="empty-state"><b>No eligible matches on this date.</b><p>Choose another day in the calendar.</p></div>}
            <div className="prediction-grid">
              {matches.map((match) => (
                <PredictionCard
                  key={match.id}
                  match={match}
                  ranking={rankingForMatch(rankings, match.id) as RankingView | null}
                  onStart={() => onOpenMatch(match)}
                  onDetails={() => onOpenMatch(match)}
                  onResult={() => onOpenResult(match)}
                />
              ))}
            </div>
          </div>
          <aside className="desktop-insight">
            <span className="eyebrow">FutBot AI</span>
            <h2>Match intelligence, model by model.</h2>
            <p>Lineups, form, injuries, odds and recent performance are combined into one evidence-backed view.</p>
            <div className="insight-stat"><b>{matches.length}</b><span>eligible matches today</span></div>
            <button onClick={() => navigate("plans")}>Explore plans</button>
          </aside>
        </div>
      </main>
    </div>
  );
}

function PickPanel({ title, pick, rank }: { title: string; pick: PredictionPick | null; rank?: number }) {
  return (
    <section className="detail-panel">
      <header>
        <div><AssetIcon src="/assets/section-ball.svg" size={18} />{title}</div>
        <span className="ai-badge">{rank ? `Top ${rank}` : "By FutBot AI"}</span>
      </header>
      {pick ? (
        <div className="live-pick">
          <strong>{pick.label}</strong>
          <div><span>Probability</span><b>{pick.probability}%</b><span>Confidence</span><b>{pick.confidence}%</b></div>
          <p>{pick.reason || "No model rationale was returned."}</p>
          {pick.risks.length > 0 && <small>Risk: {pick.risks.join(" · ")}</small>}
        </div>
      ) : <p className="empty-copy">No selection returned for this market.</p>}
    </section>
  );
}

function MatchOverview({ match }: { match: Match }) {
  return (
    <section className="match-overview">
      <div className="match-overview__teams">
        <div><TeamFlag team={match.teamA} size={48} /><b>{match.teamA.name}</b></div>
        <span><small>{match.date}</small><strong>{match.score || "VS"}</strong><small>{match.round}</small></span>
        <div><TeamFlag team={match.teamB} size={48} /><b>{match.teamB.name}</b></div>
      </div>
      <div className="match-overview__source">
        <span className="data-ready">Fixture and verified odds ready</span>
        <span className={match.playerInfoAvailable ? "players-ready" : "players-missing"}>
          {match.playerInfoAvailable ? "Player information available" : "Player information unavailable"}
        </span>
        <p>Detailed match context is imported automatically when prediction starts.</p>
      </div>
    </section>
  );
}

function ModelWorkbench({ ranking, access, analyzing, pendingModel, error, onPredict, onSeeResult }: {
  ranking: RankingView | null;
  access: Access;
  analyzing: boolean;
  pendingModel: string;
  error: string;
  onPredict: (modelName: string) => void;
  onSeeResult: (modelName: string) => void;
}) {
  const modelRail = predictionModelRail(ranking?.models || [], analyzing);
  const allModelsUnlocked = Boolean(access.billing?.active);
  return (
    <section className="model-workbench" aria-live="polite">
      <div className="model-workbench__intro">
        <span>Prediction model room</span>
        <h2>{analyzing ? `Running ${pendingModel}` : "Choose a prediction model"}</h2>
        <p>Each model runs independently against the same verified match data.</p>
      </div>
      {error && <div className="app-notice app-notice--error" role="alert">{error}</div>}
      <div className="model-runway">
        {modelRail.map((item, index) => {
          const completed = item.status === "complete";
          const locked = !completed && !allModelsUnlocked && item.name !== "Qwen 3.7 Max";
          const working = analyzing && item.name === pendingModel;
          const status = item.status === "complete" ? "See Result" : working ? "Working" : locked ? "Pass required" : "Predict";
          return (
            <article className={`model-runway__lane ${working ? "model-runway__lane--analyzing" : ""}`} key={item.name}>
              <span className="model-runway__index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <b>{item.name}</b>
                <small>{locked ? "Unlock with an AI Pass" : item.status === "complete" ? "Prediction available" : "Ready for this fixture"}</small>
              </div>
              <button
                className="model-runway__action"
                type="button"
                disabled={analyzing || locked}
                onClick={() => item.status === "complete" ? onSeeResult(item.name) : onPredict(item.name)}
              >
                {working && <i />}
                {status}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Details({ navigate, match, ranking, showResult, access, session, analyzing, pendingModel, error, onPredict, onSeeResult, onSignOut }: {
  navigate: (screen: Screen) => void;
  match: Match | null;
  ranking: RankingView | null;
  showResult: boolean;
  access: Access;
  session: Session | null;
  analyzing: boolean;
  pendingModel: string;
  error: string;
  onPredict: (modelName: string) => void;
  onSeeResult: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [activeModelName, setActiveModelName] = useState("");
  useEffect(() => {
    setActiveModelName(ranking?.models?.[0]?.name || "");
  }, [ranking]);
  const model = ranking?.models.find((item) => item.name === activeModelName) || ranking?.models?.[0] || null;
  return (
    <div className="app-with-nav">
      <SideNavigation screen="details" navigate={navigate} access={access} session={session} onSignOut={onSignOut} />
      <main className="details-page">
        <header className="page-title">
          <BackButton onClick={() => navigate("dashboard")} />
          <div><span>{match?.round || "FutBot analysis"}</span><h1>{match ? `${match.teamA.name} vs. ${match.teamB.name}` : ranking?.matchName || "Select a match"}</h1></div>
          <img className="pitch-graphic" src="/assets/pitch.svg" alt="" />
        </header>
        {match && <MatchOverview match={match} />}
        {match && (!ranking || !showResult) ? (
          <ModelWorkbench
            ranking={ranking}
            access={access}
            analyzing={analyzing}
            pendingModel={pendingModel}
            error={error}
            onPredict={onPredict}
            onSeeResult={(modelName) => {
              setActiveModelName(modelName);
              onSeeResult();
            }}
          />
        ) : !ranking ? (
          <div className="empty-state details-empty">
            <b>No match selected.</b>
            <p>Return to Predictions and choose a fixture.</p>
            <button className="primary-button" onClick={() => navigate("dashboard")}>Browse matches</button>
          </div>
        ) : (
          <>
            <div className="model-tabs" role="tablist" aria-label="Prediction models">
              {ranking.models.map((item) => (
                <button
                  className="model-tab"
                  type="button"
                  role="tab"
                  aria-selected={item === model}
                  key={item.name}
                  onClick={() => setActiveModelName(item.name)}
                >
                  {item.name}
                </button>
              ))}
            </div>
            <div className="result-model-meta">
              <div><span>Model</span><b>{model?.name}</b></div>
              <span>{model?.provider || "AI provider"}</span>
              <span>{model?.phase || "Prediction"}</span>
              <strong>Top {model?.picks.length || 0}</strong>
            </div>
            <div className="details-grid details-grid--complete">
              <section className="detail-panel score-panel">
                <header><div><AssetIcon src="/assets/section-ball.svg" size={18} />Score Predictions</div><span className="ai-badge">By {model?.name}</span></header>
                {model?.scores.length ? model.scores.map((score, index) => (
                  <div className="score-row live-score-row" key={`${score.score}-${index}`}>
                    <span>#{index + 1}</span><b>{score.score}</b><span>{score.probability}%</span>
                    <small>{score.type}</small>
                    <p>{score.reason}</p>
                  </div>
                )) : <p className="empty-copy">No score predictions returned.</p>}
              </section>
              <PickPanel title="Both Teams to Score" pick={model?.btts || null} />
              <section className="top-picks-section">
                <header>
                  <div><span>Ranked markets</span><h2>Top Picks</h2></div>
                  <p>Sorted by model-estimated probability, not implied betting odds.</p>
                </header>
                <div className="top-picks-grid">
                  {model?.picks.length ? model?.picks.map((pick, index) => (
                    <PickPanel title={pick.type} pick={pick} rank={index + 1} key={`${pick.type}-${pick.label}-${index}`} />
                  )) : <p className="empty-copy">No qualifying market picks returned.</p>}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function HistoryMatchCard({ item, onOpenPrediction }: {
  item: HistoryMatch;
  onOpenPrediction: (item: HistoryMatch) => void;
}) {
  const resultLabel = item.result === "hit" ? "Hit" : item.result === "miss" ? "Miss" : "Pending";
  return (
    <button className="history-match-card" type="button" onClick={() => onOpenPrediction(item)}>
      <div className="history-match-card__top">
        <span className="history-country-flag" aria-label="Competition country">{item.countryFlag}</span>
        <span>{item.round}</span>
        <span>{item.date}</span>
      </div>
      <div className="history-match-card__teams">
        <div><TeamFlag team={item.teamA} size={42} /><b>{item.teamA.name}</b></div>
        <strong>{item.score || "VS"}</strong>
        <div><TeamFlag team={item.teamB} size={42} /><b>{item.teamB.name}</b></div>
      </div>
      <div className="history-match-card__footer">
        <span>{item.ranking.models.length} model{item.ranking.models.length === 1 ? "" : "s"}</span>
        <span className={`match-result match-result--${item.result}`}>
          <small>Match Result</small><b>{resultLabel}</b>
        </span>
        <AssetIcon src="/assets/row-arrow.svg" size={10} />
      </div>
    </button>
  );
}

function Profile({ navigate, access, historyGroups, session, onOpenPrediction, onSignOut }: {
  navigate: (screen: Screen) => void;
  access: Access;
  historyGroups: HistoryGroup[];
  session: Session | null;
  onOpenPrediction: (item: HistoryMatch) => void;
  onSignOut: () => Promise<void>;
}) {
  const plan = access.billing?.active ? "AI Pass" : access.billing?.freePredictionUsed ? "Trial Used" : "Free Trial";
  const identity = accountIdentity(session?.user || {});
  const [activeDate, setActiveDate] = useState(historyGroups[0]?.date || "");
  useEffect(() => {
    if (!historyGroups.some((group) => group.date === activeDate)) setActiveDate(historyGroups[0]?.date || "");
  }, [activeDate, historyGroups]);
  const activeGroup = historyGroups.find((group) => group.date === activeDate) || historyGroups[0];
  return (
    <div className="app-with-nav">
      <SideNavigation screen="profile" navigate={navigate} access={access} session={session} onSignOut={onSignOut} />
      <main className="profile-page">
        <header className="simple-header"><BackButton onClick={() => navigate("dashboard")} /><h1>Profile</h1></header>
        <div className="profile-layout">
          <section className="current-plan">
            <AccountAvatar session={session} size={48} />
            <div><span>{session ? `${identity.name} · ${identity.provider}` : "Guest account"}</span><h2>{plan}</h2><p>{access.billing?.active ? "All available AI models are unlocked." : "One Qwen prediction is included before a pass is required."}</p></div>
            <button onClick={() => navigate("plans")} aria-label="Manage plan"><AssetIcon src="/assets/more-middle.svg" size={22} /></button>
          </section>
          <section className="history">
            <div className="history__heading"><div><span>Account archive</span><h2>My Predictions</h2></div><b>{historyGroups.reduce((sum, group) => sum + group.matches.length, 0)}</b></div>
            {historyGroups.length ? (
              <>
                <div className="history-date-tabs" role="tablist" aria-label="Prediction dates">
                  {historyGroups.map((group) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={group.date === activeGroup?.date}
                      onClick={() => setActiveDate(group.date)}
                      key={group.date}
                    >
                      <span>{group.label}</span><b>{group.matches.length}</b>
                    </button>
                  ))}
                </div>
                <div className="history-match-grid">
                  {activeGroup?.matches.map((item) => (
                    <HistoryMatchCard item={item} onOpenPrediction={onOpenPrediction} key={item.id} />
                  ))}
                </div>
              </>
            ) : <div className="empty-state"><b>No saved predictions yet.</b><p>Your account history will appear here.</p></div>}
          </section>
        </div>
      </main>
    </div>
  );
}

function Plans({ navigate, access, session, checkout, onSignOut }: {
  navigate: (screen: Screen) => void;
  access: Access;
  session: Session | null;
  checkout: (planId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const plans = access.plans || [];
  const [selected, setSelected] = useState(plans.find((plan) => plan.recommended)?.id || plans[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const effectiveSelected = selected || plans.find((plan) => plan.recommended)?.id || plans[0]?.id || "";
  const active = plans.find((plan) => plan.id === effectiveSelected);
  const pay = async () => {
    if (!active) return;
    setBusy(true); setMessage("");
    try { await checkout(active.id); } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed.");
      setBusy(false);
    }
  };
  return (
    <div className="app-with-nav">
      <SideNavigation screen="plans" navigate={navigate} access={access} session={session} onSignOut={onSignOut} />
      <main className="plans-page">
        <header className="simple-header"><BackButton onClick={() => navigate("profile")} /><div><span>Choose your access</span><h1>Plans</h1></div></header>
        {!plans.length && <div className="empty-state"><b>Plans are unavailable.</b><p>Try refreshing in a moment.</p></div>}
        <div className="plan-grid">
          {plans.map((plan) => (
            <button className={`plan-card ${effectiveSelected === plan.id ? "is-selected" : ""}`} key={plan.id} onClick={() => setSelected(plan.id)}>
              {plan.recommended && <span className="recommended">Recommended</span>}
              <div className="plan-card__heading">
                <div><span>{plan.name}</span><b>{plan.price} {plan.currency}</b></div>
                <small><AssetIcon src={effectiveSelected === plan.id ? "/assets/time-active.svg" : "/assets/time-muted.svg"} size={13} />{durationLabel(plan.durationHours)}</small>
              </div>
              <p>Unlock AI analysis for eligible matches during this access window.</p>
            </button>
          ))}
        </div>
        <div className="plan-checkout">
          <button className="primary-button" onClick={() => void pay()} disabled={!active || busy}>{busy ? "Opening secure checkout..." : active ? `Pay now (${active.price} ${active.currency})` : "Select a plan"}</button>
          <p>One-time access pass. No automatic renewal.</p>
          {message && <p className="error-text" role="alert">{message}</p>}
        </div>
      </main>
    </div>
  );
}

function durationLabel(hours: number) {
  if (hours < 48) return `${hours} Hour`;
  const days = Math.round(hours / 24);
  return days >= 28 ? "1 Month" : `${days} Days`;
}

function todayShanghai() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

export default function FutBotsApp() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [access, setAccess] = useState<Access>({});
  const [matches, setMatches] = useState<Match[]>([]);
  const [rankings, setRankings] = useState<RankingView[]>([]);
  const [historyContexts, setHistoryContexts] = useState<Record<string, unknown>[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [selectedRanking, setSelectedRanking] = useState<RankingView | null>(null);
  const [showSelectedResult, setShowSelectedResult] = useState(false);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [pendingModel, setPendingModel] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayShanghai);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const finishAuthSession = useCallback(() => {
    sessionStorage.removeItem("futbots.authNext");
    sessionStorage.removeItem("footballFraud.authNext");
    if (location.pathname === "/login" || location.pathname.startsWith("/auth/")) {
      window.history.replaceState({}, "", "/");
    }
    setError("");
    setScreen("dashboard");
  }, []);

  const api = useMemo(() => createApiClient({
    getAccessToken: () => session?.access_token || "",
    onUnauthorized: () => setScreen("auth")
  }), [session]);

  useEffect(() => {
    let active = true;
    let authClient: SupabaseClient | null = null;
    let authSubscription: { unsubscribe: () => void } | null = null;
    let latestSession: Session | null = null;
    const boot = async () => {
      try {
        const response = await fetch("/api/auth/config");
        const nextConfig = await response.json() as AuthConfig;
        if (!response.ok || !nextConfig.enabled) throw new Error(nextConfig.error || "Authentication is not configured.");
        authClient = createClient(nextConfig.supabaseUrl, nextConfig.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" }
        });
        const { data: authListener } = authClient.auth.onAuthStateChange((event, nextSession) => {
          if (!active) return;
          latestSession = nextSession;
          setSession(nextSession);
          if (event === "SIGNED_OUT") {
            setScreen("auth");
          } else if (nextSession && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
            finishAuthSession();
          }
        });
        authSubscription = authListener.subscription;
        const { data, error: authError } = await authClient.auth.getSession();
        if (authError) throw authError;
        if (!active) return;
        if (data.session) latestSession = data.session;
        setConfig(nextConfig);
        setClient(authClient);
        setSession(latestSession);
        window.setTimeout(() => latestSession ? finishAuthSession() : setScreen("auth"), 900);
      } catch (bootError) {
        if (!active) return;
        setError(bootError instanceof Error ? bootError.message : "Unable to start FutBots.");
        window.setTimeout(() => setScreen("auth"), 900);
      }
    };
    void boot();
    return () => {
      active = false;
      authSubscription?.unsubscribe();
      void authClient?.auth.stopAutoRefresh();
    };
  }, [finishAuthSession]);

  const loadAccount = useCallback(async () => {
    try {
      const [status, history, contextHistory] = await Promise.all([
        api("/api/auth/status"),
        api("/api/rankings").catch(() => ({ rankings: [] })),
        api("/api/contexts").catch(() => ({ contexts: [] }))
      ]);
      setAccess(status);
      const views = (history.rankings || []).map(rankingView) as RankingView[];
      setRankings(views);
      setHistoryContexts(contextHistory.contexts || []);
    } catch (accountError) {
      setError(userFacingError(accountError, "Unable to load account."));
    }
  }, [api]);

  const loadMatches = useCallback(async (date: string) => {
    setLoading(true); setError("");
    try {
      const schedule = await api(`/api/football/matches?competitionId=all&date=${encodeURIComponent(date)}`);
      setMatches(normalizeMatches(schedule) as Match[]);
    } catch (matchError) {
      setMatches([]);
      setError(userFacingError(matchError, "Match data is unavailable in this environment."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (screen === "splash") return;
    void loadAccount();
  }, [loadAccount, screen]);

  useEffect(() => {
    if (!["dashboard", "details"].includes(screen)) return;
    void loadMatches(selectedDate);
  }, [loadMatches, selectedDate, screen]);

  useEffect(() => {
    if (screen !== "profile" || !session) return;
    let active = true;
    const refreshHistory = async () => {
      try {
        await api("/api/analytics/refresh", { method: "POST", body: "{}" });
        const contextHistory = await api("/api/contexts");
        if (active) setHistoryContexts(contextHistory.contexts || []);
      } catch (historyError) {
        if (active) setError(userFacingError(historyError, "Unable to refresh match results."));
      }
    };
    void refreshHistory();
    return () => { active = false; };
  }, [api, screen, session]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [screen]);

  const historyGroups = useMemo(
    () => predictionHistory(rankings, historyContexts) as HistoryGroup[],
    [historyContexts, rankings]
  );

  const signInProvider = async (provider: "google" | "custom:telegram") => {
    if (!client || !config) throw new Error("Authentication is still starting.");
    sessionStorage.removeItem("footballFraud.authNext");
    sessionStorage.setItem("futbots.authNext", "/");
    const redirectOrigin = (config.siteUrl || location.origin).replace(/\/$/, "");
    const { error: authError } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${redirectOrigin}/auth/callback` }
    });
    if (authError) throw authError;
  };

  const submitAuth = async (mode: "login" | "signup", email: string, password: string) => {
    if (!client) throw new Error("Authentication is still starting.");
    if (mode === "signup") {
      const { data, error: authError } = await client.auth.signUp({
        email, password, options: { emailRedirectTo: `${location.origin}/auth/callback` }
      });
      if (authError) throw authError;
      if (!data.session) return "Account created. Open your confirmation email to continue.";
    } else {
      const { error: authError } = await client.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
    }
    finishAuthSession();
    return "Signed in.";
  };

  function openMatch(match: Match) {
    const existing = rankingForMatch(rankings, match.id) as RankingView | null;
    setError("");
    setSelectedMatch(match);
    setSelectedRanking(existing);
    setShowSelectedResult(false);
    setAnalysisPending(false);
    setPendingModel("");
    setScreen("details");
  }

  function openResult(match: Match) {
    const existing = rankingForMatch(rankings, match.id) as RankingView | null;
    setError("");
    setSelectedMatch(match);
    setSelectedRanking(existing);
    setShowSelectedResult(Boolean(existing));
    setAnalysisPending(false);
    setPendingModel("");
    setScreen("details");
  }

  function openHistoryPrediction(item: HistoryMatch) {
    setError("");
    setSelectedMatch(item);
    setSelectedRanking(item.ranking);
    setShowSelectedResult(true);
    setAnalysisPending(false);
    setPendingModel("");
    setScreen("details");
  }

  const analyze = async (match: Match | null, modelName: string) => {
    if (!match) return;
    setError("");
    setAnalysisPending(true);
    setPendingModel(modelName);
    try {
      const plan = analysisRequestPlan(Boolean(session), match.id, modelName);
      let contextId = plan.rankingBody.contextId;
      if (plan.importContext) {
        const imported = await api("/api/import/api-football", {
          method: "POST", body: JSON.stringify({ fixtureId: match.id })
        });
        contextId = imported.context?.id || match.id;
        setSelectedMatch((current) => current?.id === match.id
          ? { ...current, playerInfoAvailable: hasPlayerInformation(imported.context || {}) }
          : current);
      }
      const result = await api("/api/rankings", {
        method: "POST",
        body: JSON.stringify({ ...plan.rankingBody, contextId })
      });
      const view = rankingView(result.ranking) as RankingView;
      setSelectedRanking(view);
      setRankings((current) => [view, ...current.filter((item) => item.createdAt !== view.createdAt)]);
      setAccess((current) => ({ ...current, billing: result.billing || current.billing }));
    } catch (analysisError) {
      const message = userFacingError(analysisError, "Analysis failed. Try again shortly.");
      setError(message);
    } finally {
      setAnalysisPending(false);
      setPendingModel("");
    }
  };

  const checkout = async (planId: string) => {
    if (!session) {
      setScreen("login");
      throw new Error("Sign in before purchasing a pass.");
    }
    const result = await api("/api/billing/checkout", {
      method: "POST", body: JSON.stringify({ planId })
    });
    localStorage.setItem("futbots.billingOrder", result.orderId);
    location.assign(result.checkoutUrl);
  };

  const signOut = async () => {
    const { error: authError } = await client?.auth.signOut({ scope: "local" }) || { error: null };
    if (authError) {
      setError(userFacingError(authError, "Unable to log out. Try again."));
      return;
    }
    sessionStorage.removeItem("futbots.authNext");
    sessionStorage.removeItem("footballFraud.authNext");
    if (location.pathname !== "/") window.history.replaceState({}, "", "/");
    setSession(null);
    setAccess({});
    setRankings([]);
    setHistoryContexts([]);
    setSelectedMatch(null);
    setSelectedRanking(null);
    setShowSelectedResult(false);
    setScreen("auth");
  };

  const navigate = (next: Screen) => {
    if (next === "details" && !selectedRanking) setSelectedMatch(null);
    setScreen(next);
  };

  if (screen === "splash") return <BrandSplash />;
  if (screen === "auth") return <AuthLanding navigate={navigate} signInProvider={signInProvider} continueGuest={() => setScreen("dashboard")} telegramEnabled={Boolean(config?.telegramEnabled)} error={error} />;
  if (screen === "login") return <AccountForm mode="login" navigate={navigate} submitAuth={submitAuth} />;
  if (screen === "signup") return <AccountForm mode="signup" navigate={navigate} submitAuth={submitAuth} />;
  if (screen === "dashboard") return <Dashboard navigate={navigate} matches={matches} rankings={rankings} loading={loading} error={error} access={access} session={session} selectedDate={selectedDate} onDate={setSelectedDate} onOpenMatch={openMatch} onOpenResult={openResult} onSignOut={signOut} />;
  if (screen === "details") return <Details navigate={navigate} match={selectedMatch} ranking={selectedRanking} showResult={showSelectedResult} access={access} session={session} analyzing={analysisPending} pendingModel={pendingModel} error={error} onPredict={(modelName) => void analyze(selectedMatch, modelName)} onSeeResult={() => setShowSelectedResult(true)} onSignOut={signOut} />;
  if (screen === "profile") return <Profile navigate={navigate} access={access} historyGroups={historyGroups} session={session} onOpenPrediction={openHistoryPrediction} onSignOut={signOut} />;
  return <Plans navigate={navigate} access={access} session={session} checkout={checkout} onSignOut={signOut} />;
}
