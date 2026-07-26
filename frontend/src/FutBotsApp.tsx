import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";

import { accountIdentity, analysisRequestPlan, createApiClient, hasPlayerInformation, normalizeMatches, predictionHistory, predictionModelRail, rankingForMatch, rankingView, teamCrestUrl, userFacingError } from "./api.js";

type Screen = "auth" | "login" | "signup" | "dashboard" | "profile" | "plans" | "details";
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

const FREE_MODEL_NAME = "Qwen 3.7 Max";

function TeamFlag({ team, size = 34, className = "", style }: {
  team: Team;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return team.flag ? (
    <img
      className={`team-flag ${className}`.trim()}
      src={teamCrestUrl(team.flag)}
      alt={`${team.name} crest`}
      width={size}
      height={size}
      style={style}
    />
  ) : (
    <span className={`team-flag team-flag--fallback ${className}`.trim()} style={{ width: size, height: size, ...style }}>
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

/* ============ AUTH SCREENS (Figma 1:664 / 1:849 / 1:549) ============ */

function AuthDialog({ plain = false, brandFooter = false, onClose, children }: {
  plain?: boolean;
  brandFooter?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section
      className={`screen ${plain ? "screen--plain" : "screen--flags"}`}
      onClick={(event) => {
        if (event.target === event.currentTarget && window.innerWidth >= 1024) onClose();
      }}
    >
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-label="Sign in">
        <aside className="auth-side" aria-hidden="true">
          <img className="auth-side__ball" src="/assets/figma-logo-ball.svg" alt="" />
          <img className="auth-side__wordmark" src="/assets/figma-wordmark.svg" alt="" />
        </aside>
        <div className="auth-main">
          {children}
          <footer className="auth-footer">
            {brandFooter ? (
              <div className="auth-footer__brand">
                <img className="auth-footer__ball" src="/assets/figma-icon-futbot.png" alt="" />
                <img className="auth-footer__wordmark" src="/assets/figma-wordmark.svg" alt="FutBots" />
              </div>
            ) : (
              <img className="auth-footer__wordmark" src="/assets/figma-wordmark.svg" alt="FutBots" />
            )}
            <p className="auth-footer__disclaimer">
              By continuing, you acknowledge that the predictions are provided for
              informational purposes only and will not be used to place bets
              automatically.
            </p>
          </footer>
        </div>
      </div>
    </section>
  );
}

function AuthLanding({ navigate, signInProvider, continueGuest, telegramEnabled, error, onClose }: {
  navigate: (screen: Screen) => void;
  signInProvider: (provider: "google" | "custom:telegram") => Promise<void>;
  continueGuest: () => void;
  telegramEnabled: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <AuthDialog onClose={onClose}>
      <div className="auth-content">
        <div className="auth-hero">
          <img className="auth-hero__ball" src="/assets/figma-logo-ball.svg" alt="" />
          <h1>Not Sure? Bot It</h1>
        </div>
        <div className="auth-actions">
          <button className="social-button" onClick={() => navigate("login")}>
            <span className="social-button__icon social-button__icon--futbot">
              <img src="/assets/figma-icon-futbot.png" alt="" />
            </span>
            Login with FutBot account
          </button>
          <button className="social-button" onClick={() => void signInProvider("google")}>
            <span className="social-button__icon">
              <img src="/assets/figma-icon-google.svg" alt="" />
            </span>
            Continue with Google
          </button>
          <button className="social-button" disabled={!telegramEnabled} onClick={() => void signInProvider("custom:telegram")}>
            <span className="social-button__icon">
              <img src="/assets/figma-icon-telegram.svg" alt="" />
            </span>
            {telegramEnabled ? "Continue with Telegram" : "Telegram unavailable"}
          </button>
          <button className="text-link" type="button" onClick={continueGuest}>Browse as guest</button>
          {error && <p className="auth-message error-text" role="alert">{error}</p>}
        </div>
      </div>
    </AuthDialog>
  );
}

function AccountForm({ mode, navigate, submitAuth, onClose }: {
  mode: "login" | "signup";
  navigate: (screen: Screen) => void;
  submitAuth: (mode: "login" | "signup", email: string, password: string) => Promise<string>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const signup = mode === "signup";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || "");
    if (password.length < 8) return setMessage("Password must be at least 8 characters.");
    if (signup && String(data.get("confirmPassword") || "") !== password) {
      return setMessage("Passwords do not match.");
    }
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
    <AuthDialog plain={signup} brandFooter={signup} onClose={onClose}>
      <form className="auth-content" onSubmit={(event) => void submit(event)}>
        <div className="auth-hero">
          {signup ? (
            <h1 className="auth-title">Create account</h1>
          ) : (
            <>
              <img className="auth-hero__ball" src="/assets/figma-logo-ball.svg" alt="" />
              <h1>Not Sure? Bot It</h1>
            </>
          )}
        </div>
        <div className="auth-actions">
          <input className="field" name="email" type="email" placeholder="Email" aria-label="Email" autoComplete="email" required />
          <input
            className="field"
            name="password"
            type="password"
            placeholder="Password"
            aria-label="Password"
            autoComplete={signup ? "new-password" : "current-password"}
            required
          />
          {signup && (
            <input
              className="field"
              name="confirmPassword"
              type="password"
              placeholder="Confirm Password"
              aria-label="Confirm Password"
              autoComplete="new-password"
              required
            />
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Please wait..." : signup ? "Create" : "Login"}
          </button>
          <button className="text-link" type="button" onClick={() => navigate(signup ? "login" : "signup")}>
            {signup ? "Login" : "Create account"}
          </button>
          {message && <p className="auth-message" role="status">{message}</p>}
        </div>
      </form>
    </AuthDialog>
  );
}

/* ============ HOME (Figma 1:171 / 1:273) ============ */

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

function isoInShanghai(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function shanghaiNoon(iso: string) {
  return new Date(`${iso}T12:00:00+08:00`);
}

function shortDateLabel(iso: string) {
  return shanghaiNoon(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Shanghai"
  });
}

function monthLabel(iso: string) {
  return shanghaiNoon(iso).toLocaleDateString("en-US", {
    month: "long", year: "numeric", timeZone: "Asia/Shanghai"
  });
}

type CalendarDay = { iso: string; letter: string; num: number };

function calendarWindow(): CalendarDay[] {
  const today = shanghaiNoon(todayShanghai());
  return Array.from({ length: 61 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index - 30);
    return {
      iso: isoInShanghai(date),
      letter: DAY_LETTERS[shanghaiWeekday(date)],
      num: Number(date.toLocaleDateString("en-US", { day: "numeric", timeZone: "Asia/Shanghai" }))
    };
  });
}

function shanghaiWeekday(date: Date) {
  const name = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Shanghai" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

function HomeHeader({ session, access, navigate }: {
  session: Session | null;
  access: Access;
  navigate: (screen: Screen) => void;
}) {
  const planLabel = access.billing?.active ? "AI Pass" : access.billing?.freePredictionUsed ? "Trial Used" : "Free Trial";
  return (
    <header className="home-header">
      <div className="home-brand" aria-hidden="true">
        <img className="home-brand__ball" src="/assets/figma-icon-futbot.png" alt="" />
        <img className="home-brand__wordmark" src="/assets/figma-wordmark.svg" alt="FutBots" />
      </div>
      <button className="pill" onClick={() => session ? navigate("profile") : navigate("auth")}>
        {session ? <AccountAvatar session={session} size={21.5} /> : <img src="/assets/figma-icon-user.svg" alt="" />}
        <span>{session ? planLabel : "Login"}</span>
      </button>
    </header>
  );
}

function CalendarSection({ selectedDate, onDate, matchDays }: {
  selectedDate: string;
  onDate: (date: string) => void;
  matchDays: Set<string>;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const firstCenter = useRef(true);
  const drag = useRef({ down: false, startX: 0, startScroll: 0, dragged: false });
  const days = useMemo(() => calendarWindow(), []);

  useEffect(() => {
    if (!firstCenter.current) return;
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>(`[data-iso="${selectedDate}"]`);
    if (!active) return;
    const left = active.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollTo({
      left: left - strip.clientWidth / 2 + active.offsetWidth / 2,
      behavior: "auto"
    });
    firstCenter.current = false;
  }, [selectedDate]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onMove = (event: PointerEvent) => {
      if (!drag.current.down) return;
      const dx = event.clientX - drag.current.startX;
      if (Math.abs(dx) > 5) {
        drag.current.dragged = true;
        strip.classList.add("is-dragging");
        strip.scrollLeft = drag.current.startScroll - dx;
      }
    };
    const onUp = () => {
      drag.current.down = false;
      strip.classList.remove("is-dragging");
      window.setTimeout(() => { drag.current.dragged = false; }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const scrollByPage = (direction: number) => {
    const strip = stripRef.current;
    if (strip) strip.scrollBy({ left: direction * strip.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="calendar">
      <div className="calendar__month">
        <button className="cal-nav cal-nav--prev" onClick={() => scrollByPage(-1)} aria-label="Previous week">
          <img src="/assets/figma-chevron-a.svg" alt="" />
        </button>
        <span key={monthLabel(selectedDate)}>{monthLabel(selectedDate)}</span>
        <button className="cal-nav" onClick={() => scrollByPage(1)} aria-label="Next week">
          <img src="/assets/figma-chevron-b.svg" alt="" />
        </button>
      </div>
      <div
        className="calendar__days"
        ref={stripRef}
        onPointerDown={(event) => {
          const strip = stripRef.current;
          if (!strip) return;
          drag.current = { down: true, startX: event.clientX, startScroll: strip.scrollLeft, dragged: false };
        }}
      >
        {days.map((day) => (
          <button
            className={`day ${day.iso === selectedDate ? "day--active" : ""}`}
            key={day.iso}
            data-iso={day.iso}
            onClick={() => {
              if (drag.current.dragged) return;
              onDate(day.iso);
            }}
          >
            <span>{day.letter}</span><b>{day.num}</b>
            {matchDays.has(day.iso) && <i className="day__dot" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Filters({ selectedDate, onDate, competitions, competition, onCompetition, matchDays }: {
  selectedDate: string;
  onDate: (date: string) => void;
  competitions: string[];
  competition: string;
  onCompetition: (value: string) => void;
  matchDays: Set<string>;
}) {
  const [openPanel, setOpenPanel] = useState<"" | "date" | "type">("");
  const [pickerMonth, setPickerMonth] = useState(() => {
    const selected = shanghaiNoon(selectedDate);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const windowDays = useMemo(() => calendarWindow(), []);
  const windowStart = windowDays[0].iso;
  const windowEnd = windowDays[windowDays.length - 1].iso;

  useEffect(() => {
    const selected = shanghaiNoon(selectedDate);
    setPickerMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selectedDate]);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".filter")) setOpenPanel("");
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  const pickerLabel = pickerMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 0).getDate();
  const padding = new Date(pickerMonth.getFullYear(), pickerMonth.getMonth(), 1).getDay();
  const monthIso = (day: number) =>
    `${pickerMonth.getFullYear()}-${String(pickerMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const prevDisabled = pickerMonth.getFullYear() === Number(windowStart.slice(0, 4)) && pickerMonth.getMonth() <= Number(windowStart.slice(5, 7)) - 1;
  const nextDisabled = pickerMonth.getFullYear() === Number(windowEnd.slice(0, 4)) && pickerMonth.getMonth() >= Number(windowEnd.slice(5, 7)) - 1;

  return (
    <div className="filters">
      <div className={`filter ${openPanel === "date" ? "is-open" : ""}`}>
        <span>Data</span>
        <button
          className="filter__control g-stroke"
          onClick={() => setOpenPanel(openPanel === "date" ? "" : "date")}
        >
          <span>{shortDateLabel(selectedDate)}</span>
          <img src="/assets/figma-chevron-down.svg" alt="" />
        </button>
        <div className="dd-panel dp-panel g-stroke">
          <div className="dp-head">
            <button
              className="cal-nav cal-nav--prev"
              disabled={prevDisabled}
              onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() - 1, 1))}
              aria-label="Previous month"
            >
              <img src="/assets/figma-chevron-a.svg" alt="" />
            </button>
            <span>{pickerLabel}</span>
            <button
              className="cal-nav"
              disabled={nextDisabled}
              onClick={() => setPickerMonth(new Date(pickerMonth.getFullYear(), pickerMonth.getMonth() + 1, 1))}
              aria-label="Next month"
            >
              <img src="/assets/figma-chevron-b.svg" alt="" />
            </button>
          </div>
          <div className="dp-grid">
            {DAY_LETTERS.map((letter, index) => <span className="dp-dow" key={`${letter}-${index}`}>{letter}</span>)}
            {Array.from({ length: padding }, (_, index) => <span key={`pad-${index}`} />)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const iso = monthIso(index + 1);
              const outside = iso < windowStart || iso > windowEnd;
              return (
                <button
                  className={`dp-day ${iso === selectedDate ? "is-selected" : ""}`}
                  key={iso}
                  disabled={outside}
                  onClick={() => {
                    onDate(iso);
                    setOpenPanel("");
                  }}
                >
                  {index + 1}
                  {matchDays.has(iso) && <i className="dp-day__dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className={`filter ${openPanel === "type" ? "is-open" : ""}`}>
        <span>Match type</span>
        <button
          className="filter__control g-stroke"
          onClick={() => setOpenPanel(openPanel === "type" ? "" : "type")}
        >
          <span>{competition}</span>
          <img src="/assets/figma-chevron-down.svg" alt="" />
        </button>
        <div className="dd-panel g-stroke">
          {["All Competitions", ...competitions].map((item) => (
            <button
              className="dd-item"
              key={item}
              onClick={() => {
                onCompetition(item);
                setOpenPanel("");
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FreeScoreDay({ match, onTry }: { match: Match; onTry: () => void }) {
  return (
    <article className="fsd">
      <div className="fsd__bg" aria-hidden="true">
        <img src="/assets/figma-stadium.jpg" alt="" />
      </div>
      <div className="fsd__title">
        <img src="/assets/figma-sparkle-white.svg" alt="" />
        <h2>Free Score Day</h2>
        <span className="fsd__free">FREE</span>
      </div>
      <div className="teams teams--light">
        <div className="team"><TeamFlag team={match.teamA} /><span>{match.teamA.name}</span></div>
        <b>vs.</b>
        <div className="team"><TeamFlag team={match.teamB} /><span>{match.teamB.name}</span></div>
      </div>
      <button className="glow-btn" onClick={onTry}>
        <img src="/assets/figma-sparkle-black.svg" alt="" />
        Try it for free
      </button>
    </article>
  );
}

function startingIn(kickoff: string) {
  const time = new Date(kickoff || "").getTime();
  if (!Number.isFinite(time)) return "";
  const diff = time - Date.now();
  if (diff <= 0) return "";
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

function MatchCard({ match, ranking, analyzing, onStart, onSee }: {
  match: Match;
  ranking: RankingView | null;
  analyzing: boolean;
  onStart: () => void;
  onSee: () => void;
}) {
  const soon = startingIn(match.kickoff);
  const head = (
    <div className="pcard__head">
      <span className="pcard__date">{match.date}</span>
      {match.status === "live" ? (
        <span className="badge badge--live"><img src="/assets/figma-dot-live.svg" alt="" />Live</span>
      ) : match.score ? (
        <span className="badge badge--score">{match.score}</span>
      ) : soon ? (
        <span className="badge badge--soon"><img src="/assets/figma-icon-clock.svg" alt="" />Starting in: {soon}</span>
      ) : null}
    </div>
  );

  if (analyzing) {
    return (
      <article className="pcard state-swap">
        {head}
        <div className="teams">
          <div className="team"><TeamFlag team={match.teamA} /><span>{match.teamA.name}</span></div>
          <b>vs.</b>
          <div className="team"><TeamFlag team={match.teamB} /><span>{match.teamB.name}</span></div>
        </div>
        <div className="analyzing">
          <img src="/assets/figma-spinner.svg" alt="" />
          <span>Analyzing...</span>
        </div>
      </article>
    );
  }

  if (ranking) {
    return (
      <article className="pcard pcard--done">
        <div className="pcard__head">
          <span className="pcard__date">{match.date}</span>
          {match.status === "live" ? (
            <span className="badge badge--live"><img src="/assets/figma-dot-live.svg" alt="" />Live</span>
          ) : match.score ? (
            <span className="badge badge--score">{match.score}</span>
          ) : null}
        </div>
        <div className="pcard__result">
          <div className="stacked-teams">
            <div><TeamFlag team={match.teamA} /><span>{match.teamA.name}</span></div>
            <div><TeamFlag team={match.teamB} /><span>{match.teamB.name}</span></div>
          </div>
          <button className="see-link" onClick={onSee}>
            See Result
            <img src="/assets/figma-arrow-sm.svg" alt="" />
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="pcard">
      {head}
      <div className="teams">
        <div className="team"><TeamFlag team={match.teamA} /><span>{match.teamA.name}</span></div>
        <b>vs.</b>
        <div className="team"><TeamFlag team={match.teamB} /><span>{match.teamB.name}</span></div>
      </div>
      {match.status === "complete" ? (
        <span className="see-link" role="presentation">Predictions closed</span>
      ) : (
        <button className="glow-btn" onClick={onStart}>
          <img src="/assets/figma-sparkle-black.svg" alt="" />
          Start Predicting
        </button>
      )}
    </article>
  );
}

function Dashboard({ navigate, matches, rankings, loading, error, access, session, selectedDate, onDate, matchDays, pendingMatchId, onOpenMatch, onOpenResult }: {
  navigate: (screen: Screen) => void;
  matches: Match[];
  rankings: RankingView[];
  loading: boolean;
  error: string;
  access: Access;
  session: Session | null;
  selectedDate: string;
  onDate: (date: string) => void;
  matchDays: Set<string>;
  pendingMatchId: string;
  onOpenMatch: (match: Match) => void;
  onOpenResult: (match: Match) => void;
}) {
  const [competition, setCompetition] = useState("All Competitions");
  const competitions = useMemo(() => [...new Set(matches.map((match) => match.round))], [matches]);
  const visible = competition === "All Competitions"
    ? matches
    : matches.filter((match) => match.round === competition);
  const featured = visible.find((match) => match.status !== "complete" && !rankingForMatch(rankings, match.id)) || null;

  return (
    <section className="screen screen--home">
      <div className="home-wrap">
        <div className="home-top">
          <HomeHeader session={session} access={access} navigate={navigate} />
          <CalendarSection selectedDate={selectedDate} onDate={onDate} matchDays={matchDays} />
          <Filters
            selectedDate={selectedDate}
            onDate={onDate}
            competitions={competitions}
            competition={competition}
            onCompetition={setCompetition}
            matchDays={matchDays}
          />
        </div>
        <div className="home-body">
          {error && <p className="app-note app-note--error" role="alert">{error}</p>}
          {featured && <FreeScoreDay key={featured.id} match={featured} onTry={() => onOpenMatch(featured)} />}
          <div className="predictions">
            <h2>Predictions</h2>
            {loading ? (
              <div className="analyzing">
                <img src="/assets/figma-spinner.svg" alt="" />
                <span>Loading matches...</span>
              </div>
            ) : visible.length ? (
              <div className="pcards" key={`${selectedDate}-${competition}`}>
                {visible.map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    ranking={rankingForMatch(rankings, match.id) as RankingView | null}
                    analyzing={pendingMatchId === match.id}
                    onStart={() => onOpenMatch(match)}
                    onSee={() => onOpenResult(match)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-note">
                <b>No eligible matches on this date.</b>
                <p>Choose another day in the calendar.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============ DETAILS (Figma 1:477) ============ */

const SCORE_ROW_FLAG_Y = [77, 140, 204, 271];
const SCORE_ROW_SCORE_Y = [79, 147, 207, 272];
const SCORE_ROW_LABEL_Y = [101, 164, 228, 295];
const SCORE_CARD_HEIGHTS = [140, 204, 271, 348];

function CardChrome({ title, badge }: { title: string; badge: string }) {
  return (
    <>
      <img className="d-ball" style={{ left: 25, top: 21 }} src="/assets/figma-ball-section.svg" alt="" />
      <p className="d-section" style={{ left: 55, top: 22 }}>{title}</p>
      <div className="ai-badge" style={{ left: 313.5, top: 19 }}>
        <img src="/assets/figma-sparkle-badge.svg" alt="" />
        <span>{badge}</span>
      </div>
      <div className="d-line-h" style={{ left: 19, top: 55 }} />
    </>
  );
}

function TeamColumn({ match }: { match: Match }) {
  return (
    <>
      <div className="d-line-v" style={{ left: 256, top: 90 }} />
      <TeamFlag team={match.teamB} size={22} className="d-flag" style={{ left: 303, top: 90 }} />
      <p className="d-label d-label--c" style={{ left: 314, top: 114 }}>{match.teamB.name}</p>
      <TeamFlag team={match.teamA} size={22} className="d-flag" style={{ left: 303, top: 160 }} />
      <p className="d-label d-label--c" style={{ left: 314, top: 184 }}>{match.teamA.name}</p>
    </>
  );
}

function ScoreCard({ match, scores, badge }: { match: Match; scores: ScorePick[]; badge: string }) {
  const rows = scores.slice(0, 4);
  if (!rows.length) return null;
  return (
    <div className="d-card d-card--score g-stroke" style={{ height: SCORE_CARD_HEIGHTS[rows.length - 1] }}>
      <CardChrome title="Score Predictions" badge={badge} />
      {rows.map((pick, index) => (
        <Fragment key={`${pick.score}-${index}`}>
          <TeamFlag team={match.teamA} size={22} className="d-flag" style={{ left: 39, top: SCORE_ROW_FLAG_Y[index] }} />
          <TeamFlag team={match.teamB} size={22} className="d-flag" style={{ left: 303, top: SCORE_ROW_FLAG_Y[index] }} />
          <p className="d-score" style={{ left: 184, top: SCORE_ROW_SCORE_Y[index] }}>{pick.score}</p>
          <p className="d-label d-label--c" style={{ left: 50, top: SCORE_ROW_LABEL_Y[index] }}>{match.teamA.name}</p>
          <p className="d-label d-label--c" style={{ left: 314, top: SCORE_ROW_LABEL_Y[index] }}>{match.teamB.name}</p>
        </Fragment>
      ))}
    </div>
  );
}

function PicksCard({ match, title, picks, badge, handicap = false }: {
  match: Match;
  title: string;
  picks: PredictionPick[];
  badge: string;
  handicap?: boolean;
}) {
  const rows = picks.slice(0, 2);
  if (!rows.length) return null;
  return (
    <div className={`d-card ${handicap ? "d-card--handicap" : "d-card--total"} g-stroke`}>
      <CardChrome title={title} badge={badge} />
      {rows.length === 1 ? (
        <p className="d-pick" style={{ left: 25, top: 127 }}>{rows[0].label}</p>
      ) : (
        <>
          <p className="d-num" style={{ left: 25, top: 90 }}>#1</p>
          <p className="d-pick" style={{ left: 25, top: 106 }}>{rows[0].label}</p>
          <p className="d-num" style={{ left: 25, top: 153 }}>#2</p>
          <p className="d-pick" style={{ left: 25, top: 169 }}>{rows[1].label}</p>
        </>
      )}
      <TeamColumn match={match} />
    </div>
  );
}

function AllPicksCard({ picks, badge }: { picks: PredictionPick[]; badge: string }) {
  if (!picks.length) return null;
  return (
    <div className="d-card d-card--top-picks g-stroke">
      <CardChrome title="Top Picks" badge={badge} />
      <div className="top-picks-list">
        {picks.map((pick, index) => (
          <article className="top-pick" key={`${pick.type}-${pick.label}-${index}`}>
            <div className="top-pick__head">
              <span>#{index + 1} · {pick.type || "Prediction"}</span>
              <strong>{pick.probability}%</strong>
            </div>
            <p className="top-pick__label">{pick.label}</p>
            {pick.reason && <p className="top-pick__reason">{pick.reason}</p>}
            <div className="top-pick__meta">
              <span>AI Probability {pick.probability}%</span>
              <span>Confidence {pick.confidence}%</span>
            </div>
            {pick.risks?.length > 0 && (
              <p className="top-pick__risks">Risks: {pick.risks.join(" · ")}</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function PredictModal({ open, match, modelName, freeUser, onClose, onConfirm }: {
  open: boolean;
  match: Match;
  modelName: string;
  freeUser: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 550);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!mounted || !open) return;
    const timer = window.setTimeout(() => setVisible(true), 20);
    return () => window.clearTimeout(timer);
  }, [mounted, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className={`modal ${visible ? "is-open" : ""}`}>
      <div className="modal__overlay" onClick={onClose} />
      <section className="modal__sheet" role="dialog" aria-modal="true" aria-label="Free prediction">
        <div className="modal__head">
          <h2>{freeUser ? "You Have 1 Free Prediction Left" : "Confirm Your Prediction"}</h2>
          <div className="ai-badge">
            <img src="/assets/figma-sparkle-badge.svg" alt="" />
            <span>By FutBot AI</span>
          </div>
        </div>
        <div className="teams modal__teams">
          <div className="team"><TeamFlag team={match.teamA} /><span>{match.teamA.name}</span></div>
          <b>vs.</b>
          <div className="team"><TeamFlag team={match.teamB} /><span>{match.teamB.name}</span></div>
        </div>
        <div className="modal__note">
          <p>By clicking &ldquo;Confirm,&rdquo; you&rsquo;ll receive predictions for:</p>
          <ul>
            <li>Score Predictions</li>
            <li>Over/Under</li>
            <li>Asian handicap</li>
          </ul>
          <p>{freeUser ? "Your free prediction will reset tomorrow." : `Powered by ${modelName}.`}</p>
        </div>
        <button className="glow-btn modal__cta" onClick={onConfirm}>Start Now</button>
      </section>
    </div>
  );
}

function ModelRoom({ match, ranking, access, analyzing, pendingModel, error, onRun, onSee }: {
  match: Match;
  ranking: RankingView | null;
  access: Access;
  analyzing: boolean;
  pendingModel: string;
  error: string;
  onRun: (modelName: string) => void;
  onSee: (modelName: string) => void;
}) {
  const rail = predictionModelRail(ranking?.models || [], analyzing) as { name: string; status: string }[];
  const allUnlocked = Boolean(access.billing?.active);
  return (
    <div className="d-cards">
      <div className="m-card g-stroke">
        <div className="m-card__head">
          <img className="d-ball" src="/assets/figma-ball-section.svg" alt="" />
          <p className="d-section">Choose a prediction model</p>
          <div className="ai-badge">
            <img src="/assets/figma-sparkle-badge.svg" alt="" />
            <span>By FutBot AI</span>
          </div>
        </div>
        <p className="m-card__meta">
          {match.date}{match.playerInfoAvailable
            ? " · Player information available"
            : " · Player information unavailable · Detailed match context is imported automatically when prediction starts"}
        </p>
        {rail.map((item, index) => {
          const completed = item.status === "complete";
          const locked = !completed && !allUnlocked && item.name !== FREE_MODEL_NAME;
          const working = analyzing && item.name === pendingModel;
          return (
            <div className="m-row" key={item.name}>
              <span className="m-row__index">{String(index + 1).padStart(2, "0")}</span>
              <div className="m-row__name">
                <b>{item.name}</b>
                <small>{locked ? "Unlock with an AI Pass" : completed ? "Prediction available" : "Ready for this fixture"}</small>
              </div>
              <button
                className={`m-run ${completed ? "m-run--done" : ""}`}
                type="button"
                disabled={analyzing || locked}
                onClick={() => completed ? onSee(item.name) : onRun(item.name)}
              >
                {working && <img src="/assets/figma-spinner.svg" alt="" />}
                {completed ? "See Result" : working ? "Analyzing" : locked ? "Pass required" : "Predict"}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="app-note app-note--error" role="alert">{error}</p>}
    </div>
  );
}

function Details({ navigate, match, ranking, showResult, access, analyzing, pendingModel, error, onPredict, onSeeResult }: {
  navigate: (screen: Screen) => void;
  match: Match | null;
  ranking: RankingView | null;
  showResult: boolean;
  access: Access;
  analyzing: boolean;
  pendingModel: string;
  error: string;
  onPredict: (modelName: string) => void;
  onSeeResult: () => void;
}) {
  const [activeModelName, setActiveModelName] = useState("");
  const [confirmModel, setConfirmModel] = useState("");
  useEffect(() => {
    setActiveModelName(ranking?.models?.[0]?.name || "");
  }, [ranking]);
  const model = ranking?.models.find((item) => item.name === activeModelName) || ranking?.models?.[0] || null;
  const badge = model ? `By ${model.name}` : "By FutBot AI";
  const totalPicks = model ? model.picks.filter((pick) => /total|over|under/i.test(pick.type)) : [];
  const totals = totalPicks.length ? totalPicks : model?.total ? [model.total] : [];

  return (
    <section className="screen screen--details">
      <div className="details-wrap">
        <header className="details-head">
          <button className="icon-btn back-btn" onClick={() => navigate("dashboard")} aria-label="Go back">
            <img src="/assets/figma-icon-back.svg" alt="" />
          </button>
          <h1 className="details-title">
            {match ? `${match.teamA.name} vs.\n${match.teamB.name}` : ranking?.matchName || "Select a match"}
          </h1>
          <img className="details-pitch" src="/assets/figma-pitch.svg" alt="" />
        </header>

        {match && (!ranking || !showResult) ? (
          <ModelRoom
            match={match}
            ranking={ranking}
            access={access}
            analyzing={analyzing}
            pendingModel={pendingModel}
            error={error}
            onRun={setConfirmModel}
            onSee={(modelName) => {
              setActiveModelName(modelName);
              onSeeResult();
            }}
          />
        ) : !ranking || !match ? (
          <div className="d-cards">
            <div className="empty-note">
              <b>No match selected.</b>
              <p>Return to Predictions and choose a fixture.</p>
            </div>
            <button className="glow-btn" style={{ maxWidth: 368 }} onClick={() => navigate("dashboard")}>
              Browse matches
            </button>
          </div>
        ) : (
          <>
            {ranking.models.length > 1 && (
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
            )}
            <div className="d-cards">
              <ScoreCard match={match} scores={model?.scores || []} badge={badge} />
              <PicksCard match={match} title="Total" picks={totals} badge={badge} />
              {model?.handicap && <PicksCard match={match} title="Asian handicap" picks={[model.handicap]} badge={badge} handicap />}
              {model?.btts && <PicksCard match={match} title="Both Teams to Score" picks={[model.btts]} badge={badge} />}
              {model?.moneyline && <PicksCard match={match} title="Moneyline" picks={[model.moneyline]} badge={badge} />}
              <AllPicksCard picks={model?.picks || []} badge={badge} />
            </div>
          </>
        )}
      </div>
      {match && (
        <PredictModal
          open={Boolean(confirmModel)}
          match={match}
          modelName={confirmModel}
          freeUser={!access.billing?.active}
          onClose={() => setConfirmModel("")}
          onConfirm={() => {
            const modelName = confirmModel;
            setConfirmModel("");
            onPredict(modelName);
          }}
        />
      )}
    </section>
  );
}

/* ============ PROFILE (Figma 1:393) ============ */

function HistoryCard({ item, onOpen }: { item: HistoryMatch; onOpen: () => void }) {
  const resultBadge = item.result === "hit"
    ? <span className="badge badge--hit">Hit</span>
    : item.result === "miss"
      ? <span className="badge badge--miss">Miss</span>
      : <span className="badge badge--soon">Pending</span>;
  return (
    <article className="pcard pcard--done">
      <div className="pcard__head">
        <span className="pcard__date">{item.countryFlag} {item.date}{item.score ? ` · FT ${item.score}` : ""}</span>
        <span className="history-result"><span>Match Result:</span>{resultBadge}</span>
      </div>
      <div className="pcard__result">
        <div className="stacked-teams">
          <div><TeamFlag team={item.teamA} /><span>{item.teamA.name}</span></div>
          <div><TeamFlag team={item.teamB} /><span>{item.teamB.name}</span></div>
        </div>
        <button className="see-link" onClick={onOpen}>
          See Predictions
          <img src="/assets/figma-arrow-sm.svg" alt="" />
        </button>
      </div>
    </article>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = accountIdentity(session?.user || {});
  const activePlan = Boolean(access.billing?.active);
  const planName = activePlan
    ? access.plans?.find((plan) => plan.id === access.billing?.planId)?.name || "AI Pass"
    : "Free Trial";
  const planDesc = activePlan
    ? "All available AI models are unlocked for eligible matches."
    : "One Qwen prediction is included before a pass is required.";
  const validUntil = access.billing?.validUntil
    ? ` Access through ${new Date(access.billing.validUntil).toLocaleDateString()}.`
    : "";
  const [activeHistoryDate, setActiveHistoryDate] = useState("");
  const activeHistoryGroup = historyGroups.find((group) => group.date === activeHistoryDate)
    || historyGroups[0]
    || null;
  const historyItems = activeHistoryGroup?.matches || [];

  useEffect(() => {
    if (!menuOpen) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".plan-menu")) setMenuOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, [menuOpen]);

  return (
    <section className="screen screen--profile">
      <div className="profile-wrap">
        <header className="profile-head">
          <button className="icon-btn back-btn" onClick={() => navigate("dashboard")} aria-label="Go back">
            <img src="/assets/figma-icon-back.svg" alt="" />
          </button>
          <h1 className="profile-title">Profile</h1>
        </header>

        <article className="plan-card">
          <div className="plan-card__head">
            <div className="plan-card__titles">
              <p className="plan-card__eyebrow">Current Plan</p>
              <p className="plan-card__name">{planName}</p>
            </div>
            {activePlan && (
              <div className={`plan-menu ${menuOpen ? "is-open" : ""}`}>
                <button className="plan-card__menu" aria-label="Plan options" onClick={() => setMenuOpen((value) => !value)}>
                  <span className="menu-dots">
                    <img src="/assets/more-left.svg" alt="" />
                    <img src="/assets/more-middle.svg" alt="" />
                    <img src="/assets/more-right.svg" alt="" />
                  </span>
                </button>
                <div className="dd-panel plan-menu-panel">
                  <button className="dd-item" onClick={() => { setMenuOpen(false); navigate("plans"); }}>Update Your Plan</button>
                </div>
              </div>
            )}
          </div>
          <p className="plan-card__desc">{planDesc}{validUntil}</p>
          {!activePlan && (
            <button className="glow-btn plan-card__cta" onClick={() => navigate("plans")}>
              <img src="/assets/figma-sparkle-black.svg" alt="" />
              Choose Your Plan
            </button>
          )}
        </article>

        <div className="account-card">
          <div className="account-card__id">
            {session ? <AccountAvatar session={session} size={21.5} /> : <img src="/assets/figma-icon-user.svg" alt="" />}
            <span>{session ? `${identity.name} · ${identity.provider}` : "Guest account"}</span>
          </div>
          {session ? (
            <button className="logout-btn" onClick={() => void onSignOut()}>Log Out</button>
          ) : (
            <button className="login-btn" onClick={() => navigate("login")}>Log In</button>
          )}
        </div>

        <div className="predictions profile-predictions">
          <h2>My Predictions</h2>
          {historyGroups.length ? (
            <>
              <div className="history-date-tabs" role="tablist" aria-label="Prediction dates">
                {historyGroups.map((group) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={group.date === activeHistoryGroup?.date}
                    key={group.date}
                    onClick={() => setActiveHistoryDate(group.date)}
                  >
                    <span>{group.label}</span>
                    <small>{group.matches.length} {group.matches.length === 1 ? "match" : "matches"}</small>
                  </button>
                ))}
              </div>
              <div className="pcards pcards--profile">
                {historyItems.map((item) => (
                  <HistoryCard item={item} key={`${item.id}-${item.ranking.createdAt}`} onOpen={() => onOpenPrediction(item)} />
                ))}
              </div>
            </>
          ) : (
            <div className="empty-note">
              <b>No saved predictions yet.</b>
              <p>Your prediction history will appear here.</p>
            </div>
          )}
        </div>

        <a className="console-link" href="/backend">Data Console</a>
      </div>
    </section>
  );
}

/* ============ PLANS (Figma 1:617) ============ */

function durationText(hours: number) {
  if (hours < 48) return `${hours} hours`;
  const days = Math.round(hours / 24);
  return `${days} days`;
}

function Plans({ access, checkout, onClose }: {
  access: Access;
  checkout: (planId: string) => Promise<void>;
  onClose: () => void;
}) {
  const plans = access.plans || [];
  const currentId = access.billing?.active ? access.billing?.planId || "" : "free";
  const selectable = plans.filter((plan) => plan.id !== currentId);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const effectiveSelected = selected
    || selectable.find((plan) => plan.recommended)?.id
    || selectable[0]?.id
    || "";
  const active = plans.find((plan) => plan.id === effectiveSelected);
  const pay = async () => {
    if (!active) return;
    setBusy(true); setMessage("");
    try { await checkout(active.id); } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout failed.");
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section
      className="screen screen--plans"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="plans-wrap" role="dialog" aria-modal="true" aria-label="Choose your plan">
        <button className="icon-btn plans-close" onClick={onClose} aria-label="Close">
          <span>✕</span>
        </button>
        <header className="plans-head">
          <button className="icon-btn back-btn" onClick={onClose} aria-label="Go back">
            <img src="/assets/figma-icon-back.svg" alt="" />
          </button>
        </header>

        <div className="plan-options">
          <div className="plan-option" data-plan="free">
            <div className="plan-option__head">
              <div className="plan-option__titles">
                <p className="plan-option__label">Free Trail</p>
                <p className="plan-option__price">Free</p>
              </div>
              {currentId === "free" && <span className="current-pill">Current Plan</span>}
            </div>
            <p className="plan-option__desc">
              One free AI prediction with the Qwen model before a pass is required.
            </p>
          </div>

          {plans.map((plan) => {
            const isCurrent = plan.id === currentId;
            return (
              <button
                className={`plan-option ${plan.recommended ? "plan-option--tall" : ""} ${effectiveSelected === plan.id && !isCurrent ? "is-selected" : ""}`}
                key={plan.id}
                disabled={isCurrent}
                onClick={() => setSelected(plan.id)}
              >
                <div className="plan-option__head">
                  <div className="plan-option__titles">
                    {plan.recommended && <p className="plan-option__flag">Recommended</p>}
                    <p className="plan-option__label">{plan.name}</p>
                    <p className="plan-option__price">{plan.price} {plan.currency}</p>
                  </div>
                  {isCurrent && <span className="current-pill">Current Plan</span>}
                  <span className={`duration-pill ${plan.recommended ? "duration-pill--light" : ""}`}>
                    <img src={plan.recommended ? "/assets/time-active.svg" : "/assets/time-muted.svg"} alt="" />
                    {durationLabel(plan.durationHours)}
                  </span>
                </div>
                <p className="plan-option__desc">
                  AI expert analysis for all matches in the next {durationText(plan.durationHours)}
                </p>
              </button>
            );
          })}
          {!plans.length && (
            <div className="empty-note">
              <b>Plans are unavailable.</b>
              <p>Try refreshing in a moment.</p>
            </div>
          )}
        </div>

        <div className="plans-footer">
          <button className="pay-btn" onClick={() => void pay()} disabled={!active || busy}>
            {busy ? "Opening secure checkout..." : active ? `Pay now (${active.price} ${active.currency})` : "Select a plan"}
          </button>
          <p className="pay-note">One-time access pass. No automatic renewal.</p>
          {message && <p className="pay-note error-text" role="alert">{message}</p>}
        </div>
      </div>
    </section>
  );
}

/* ============ TOAST ============ */

function PredictionToast({ visible, onOpen }: { visible: boolean; onOpen: () => void }) {
  return (
    <button className={`toast ${visible ? "is-visible" : ""}`} onClick={onOpen}>
      <img src="/assets/figma-sparkle-white.svg" alt="" />
      <span>Prediction ready</span>
    </button>
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
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [authScreen, setAuthScreen] = useState<"" | "auth" | "login" | "signup">(() =>
    location.pathname === "/login" || location.pathname.startsWith("/auth/") ? "auth" : "");
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
  const [toastVisible, setToastVisible] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [matchDays, setMatchDays] = useState<Set<string>>(() => new Set());

  const finishAuthSession = useCallback(() => {
    sessionStorage.removeItem("futbots.authNext");
    sessionStorage.removeItem("footballFraud.authNext");
    if (location.pathname === "/login" || location.pathname.startsWith("/auth/")) {
      window.history.replaceState({}, "", "/");
    }
    setError("");
    setAuthScreen("");
    setScreen("dashboard");
  }, []);

  const api = useMemo(() => createApiClient({
    getAccessToken: () => session?.access_token || "",
    onUnauthorized: () => setAuthScreen("auth")
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
            setScreen("dashboard");
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
        if (latestSession) finishAuthSession();
      } catch (bootError) {
        if (!active) return;
        setError(bootError instanceof Error ? bootError.message : "Unable to start FutBots.");
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
      const nextMatches = normalizeMatches(schedule) as Match[];
      setMatches(nextMatches);
      setMatchDays((current) => {
        const next = new Set(current);
        if (nextMatches.length) next.add(date); else next.delete(date);
        return next;
      });
    } catch (matchError) {
      setMatches([]);
      setError(userFacingError(matchError, "Match data is unavailable in this environment."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  /* Probe the schedule-cache window (today -7 … +3) so the calendar can dot
     dates that have matches. Uses the same read-only matches endpoint. */
  useEffect(() => {
    let active = true;
    const probe = async () => {
      const base = shanghaiNoon(todayShanghai());
      const dates = Array.from({ length: 11 }, (_, index) => {
        const date = new Date(base);
        date.setDate(base.getDate() + index - 7);
        return isoInShanghai(date);
      });
      const results = await Promise.all(dates.map(async (date) => {
        try {
          const schedule = await api(`/api/football/matches?competitionId=all&date=${encodeURIComponent(date)}`);
          return [date, (normalizeMatches(schedule) as Match[]).length > 0] as const;
        } catch {
          return [date, false] as const;
        }
      }));
      if (!active) return;
      setMatchDays((current) => {
        const next = new Set(current);
        for (const [date, hasMatches] of results) {
          if (hasMatches) next.add(date); else next.delete(date);
        }
        return next;
      });
    };
    void probe();
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

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

  useEffect(() => {
    if (!toastVisible) return;
    const timer = window.setTimeout(() => setToastVisible(false), 6000);
    return () => window.clearTimeout(timer);
  }, [toastVisible]);

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
      setToastVisible(true);
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
      setPlansOpen(false);
      setAuthScreen("login");
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
    setAuthScreen("");
    setScreen("dashboard");
  };

  const navigate = (next: Screen) => {
    if (next === "auth" || next === "login" || next === "signup") {
      setAuthScreen(next);
      return;
    }
    if (next === "plans") {
      setPlansOpen(true);
      return;
    }
    if (next === "details" && !selectedRanking) setSelectedMatch(null);
    setScreen(next);
  };

  const openToastResult = () => {
    setToastVisible(false);
    setShowSelectedResult(true);
    setScreen("details");
  };

  const closeAuth = () => setAuthScreen("");

  const screenNode = screen === "dashboard" ? (
    <Dashboard navigate={navigate} matches={matches} rankings={rankings} loading={loading} error={error} access={access} session={session} selectedDate={selectedDate} onDate={setSelectedDate} matchDays={matchDays} pendingMatchId={analysisPending ? selectedMatch?.id || "" : ""} onOpenMatch={openMatch} onOpenResult={openResult} />
  ) : screen === "details" ? (
    <Details navigate={navigate} match={selectedMatch} ranking={selectedRanking} showResult={showSelectedResult} access={access} analyzing={analysisPending} pendingModel={pendingModel} error={error} onPredict={(modelName) => void analyze(selectedMatch, modelName)} onSeeResult={() => setShowSelectedResult(true)} />
  ) : (
    <Profile navigate={navigate} access={access} historyGroups={historyGroups} session={session} onOpenPrediction={openHistoryPrediction} onSignOut={signOut} />
  );

  return (
    <>
      {screenNode}
      {authScreen === "auth" && (
        <AuthLanding navigate={navigate} signInProvider={signInProvider} continueGuest={closeAuth} telegramEnabled={Boolean(config?.telegramEnabled)} error={error} onClose={closeAuth} />
      )}
      {authScreen === "login" && <AccountForm mode="login" navigate={navigate} submitAuth={submitAuth} onClose={closeAuth} />}
      {authScreen === "signup" && <AccountForm mode="signup" navigate={navigate} submitAuth={submitAuth} onClose={closeAuth} />}
      {plansOpen && <Plans access={access} checkout={checkout} onClose={() => setPlansOpen(false)} />}
      <PredictionToast visible={toastVisible} onOpen={openToastResult} />
    </>
  );
}
