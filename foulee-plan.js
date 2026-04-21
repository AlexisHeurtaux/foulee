// foulee-app.jsx — App Foulée fonctionnelle (PWA)

const PROGRAM = window.FOULEE_PROGRAM;
const BADGES = window.FOULEE_BADGES;

// ─────────────────────────────────────────────────────────────
// Persistance localStorage
// ─────────────────────────────────────────────────────────────
const STATE_KEY = 'foulee.state.v1';
const DEFAULT_PROFILE = {
  firstName: '',
  age: null,
  weightKg: null,
  currentPaceKmh: 7.5, // allure actuelle confort
  goalTimeMin: 65,     // 10 km en 1h05
  createdAt: null,
};
const DEFAULT_STATE = {
  profile: DEFAULT_PROFILE,
  currentWeek: 1,
  done: {},            // "w-n-s-i" -> { date, duration, note, rating }
  xp: 0,
  totalSec: 0,
  streak: 0,
  lastDoneDate: null,
  voiceEnabled: true,
  vibrationEnabled: true,
  sessionsDone: 0,
  onboarded: false,
};
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    if (!s) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...s, profile: { ...DEFAULT_PROFILE, ...(s.profile || {}) } };
  } catch { return DEFAULT_STATE; }
}
function saveState(s) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch {}
}

// ─────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────
const typeLabel = { END: 'Endurance', TEM: 'Tempo', INT: 'Fractionné', LNG: 'Sortie longue', TST: 'Test chrono' };

function kmhToPace(kmh) {
  const sec = 3600 / kmh;
  const m = Math.floor(sec / 60), s = Math.round(sec - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function flatBlocks(session) {
  const flat = [];
  session.blocks.forEach((b) => {
    if (b.reps) {
      for (let i = 0; i < b.reps; i++) {
        flat.push({ type: b.type, label: `${b.label} · ${i + 1}/${b.reps}`, min: b.min, kmh: b.kmh, incline: b.incline });
        if (i < b.reps || b.rest) flat.push({ type: 'recovery', label: 'Récupération', min: b.rest.min, kmh: b.rest.kmh, incline: 0 });
      }
    } else flat.push(b);
  });
  return flat;
}
function blockColor(type) {
  switch (type) {
    case 'warmup': return '#3a7c4a';
    case 'run': return '#c5f53d';
    case 'interval': return '#c5f53d';
    case 'recovery': return 'rgba(255,255,255,0.25)';
    case 'cooldown': return '#4a5c38';
    default: return 'rgba(255,255,255,0.1)';
  }
}

// ─────────────────────────────────────────────────────────────
// Voix FR + bips + vibration
// ─────────────────────────────────────────────────────────────
function speak(text, enabled) {
  if (!enabled) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 1.05;
    u.pitch = 1;
    const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith('fr'));
    if (v) u.voice = v;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {}
}
let _audioCtx = null;
function beep(freq = 660, ms = 140) {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audioCtx.createOscillator();
    const g = _audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(_audioCtx.destination);
    g.gain.setValueAtTime(0.0001, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, _audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + ms / 1000);
    o.start(); o.stop(_audioCtx.currentTime + ms / 1000);
  } catch {}
}
function vibrate(pattern, enabled) {
  if (!enabled) return;
  try { navigator.vibrate?.(pattern); } catch {}
}

// ─────────────────────────────────────────────────────────────
// Hook état global
// ─────────────────────────────────────────────────────────────
function useFoulee() {
  const [state, setState] = React.useState(loadState);
  React.useEffect(() => { saveState(state); }, [state]);
  const patch = (p) => setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  const sessionKey = (w, i) => `w${w}s${i}`;
  const isDone = (w, i) => !!state.done[sessionKey(w, i)];
  const markDone = (w, i, session) => {
    setState((s) => {
      const k = sessionKey(w, i);
      if (s.done[k]) return s;
      const newDone = { ...s.done, [k]: { date: new Date().toISOString(), duration: session.total * 60 } };
      const newXP = s.xp + session.total * 10 + 50;
      const newSessions = s.sessionsDone + 1;
      // avancer semaine si les 2 séances faites
      const week = PROGRAM.weeks[w - 1];
      const allDone = week.sessions.every((_, si) => newDone[`w${w}s${si}`]);
      const newWeek = allDone && w < PROGRAM.totalWeeks ? w + 1 : s.currentWeek;
      // streak
      const today = new Date().toDateString();
      const last = s.lastDoneDate ? new Date(s.lastDoneDate).toDateString() : null;
      const yesterday = new Date(Date.now() - 86400000 * 4).toDateString(); // tolérance 4j
      const streak = last === today ? s.streak : (s.streak + 1);
      return {
        ...s, done: newDone, xp: newXP, sessionsDone: newSessions,
        currentWeek: newWeek, streak, lastDoneDate: new Date().toISOString(),
        totalSec: s.totalSec + session.total * 60,
      };
    });
  };
  const resetAll = () => { setState(DEFAULT_STATE); };
  const updateProfile = (p) => setState((s) => ({ ...s, profile: { ...s.profile, ...p, createdAt: s.profile.createdAt || new Date().toISOString() } }));
  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    const name = state.profile.firstName ? state.profile.firstName.toLowerCase() : 'moi';
    a.download = `foulee-${name}-${date}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importData = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object') throw new Error('Format invalide');
        setState({ ...DEFAULT_STATE, ...data, profile: { ...DEFAULT_PROFILE, ...(data.profile || {}) } });
        resolve();
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  return { state, patch, isDone, markDone, sessionKey, resetAll, updateProfile, exportData, importData };
}

// ─────────────────────────────────────────────────────────────
// ROOT APP — navigation par état
// ─────────────────────────────────────────────────────────────
function App() {
  const ctx = useFoulee();
  const [route, setRoute] = React.useState({ name: 'home' });

  // Unlock speechSynthesis on first user interaction (iOS)
  React.useEffect(() => {
    const unlock = () => {
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.lang = 'fr-FR'; u.volume = 0;
        speechSynthesis.speak(u);
      } catch {}
      document.removeEventListener('touchend', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchend', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });
  }, []);

  const go = (r) => setRoute(r);

  // Onboarding — si pas encore de profil, aller sur l'écran profil
  React.useEffect(() => {
    if (!ctx.state.onboarded && route.name === 'home') {
      setRoute({ name: 'profile', onboarding: true });
    }
  }, []);

  return (
    <div style={{ minHeight: '100dvh' }}>
      {route.name === 'home' && <Home ctx={ctx} go={go} />}
      {route.name === 'session' && <SessionDetail ctx={ctx} route={route} go={go} />}
      {route.name === 'live' && <LiveSession ctx={ctx} route={route} go={go} />}
      {route.name === 'program' && <Program ctx={ctx} go={go} />}
      {route.name === 'rewards' && <Rewards ctx={ctx} go={go} />}
      {route.name === 'settings' && <Settings ctx={ctx} go={go} />}
      {route.name === 'profile' && <Profile ctx={ctx} route={route} go={go} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HOME
// ─────────────────────────────────────────────────────────────
function Home({ ctx, go }) {
  const { state } = ctx;
  const week = PROGRAM.weeks[state.currentWeek - 1];
  // trouver la prochaine séance non faite de cette semaine
  const nextIdx = week.sessions.findIndex((_, i) => !ctx.isDone(state.currentWeek, i));
  const todayIdx = nextIdx === -1 ? 0 : nextIdx;
  const session = week.sessions[todayIdx];
  const sessionDone = nextIdx === -1;
  const weekProgress = (state.currentWeek - 1) / PROGRAM.totalWeeks + (week.sessions.filter((_,i) => ctx.isDone(state.currentWeek, i)).length / week.sessions.length) / PROGRAM.totalWeeks;
  const xpToNext = 500 + state.sessionsDone * 40;
  const level = Math.floor(state.xp / 500) + 1;
  const xpInLevel = state.xp % 500;

  return (
    <div style={{ padding: '30px 20px 40px' }}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
            {state.profile.firstName ? `Salut ${state.profile.firstName}` : 'Foulée'}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginTop: 2 }}>10 km · {Math.floor(state.profile.goalTimeMin / 60)}h{String(state.profile.goalTimeMin % 60).padStart(2, '0')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => go({ name: 'profile' })} aria-label="Profil" style={{
            width: 40, height: 40, borderRadius: 20, border: '1px solid var(--card-b)', background: 'var(--card)', color: 'var(--text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14,
          }}>
            {state.profile.firstName ? state.profile.firstName[0].toUpperCase() : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M2.5 13.5c.7-2.5 2.9-4 5.5-4s4.8 1.5 5.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            )}
          </button>
          <button onClick={() => go({ name: 'settings' })} aria-label="Réglages" style={{
            width: 40, height: 40, borderRadius: 20, border: '1px solid var(--card-b)', background: 'var(--card)', color: 'var(--text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.3 3.3l1.4 1.4M13.3 13.3l1.4 1.4M3.3 14.7l1.4-1.4M13.3 4.7l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      {/* objectif hero */}
      <div style={{ background: 'var(--hero-bg)', borderRadius: 20, padding: 22, border: '1px solid rgba(197,245,61,0.15)' }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Progression programme</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
          <div className="num" style={{ fontSize: 48, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>Sem {state.currentWeek}</div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>/ {PROGRAM.totalWeeks}</div>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{week.phase} — {week.focus}</div>
        <div style={{ marginTop: 16, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${weekProgress * 100}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
      </div>

      {/* Séance du jour */}
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, margin: '26px 4px 10px' }}>
        {sessionDone ? 'Semaine terminée 🎉' : `Prochaine séance · ${session.day}`}
      </div>
      <button onClick={() => !sessionDone && go({ name: 'session', week: state.currentWeek, idx: todayIdx })}
        disabled={sessionDone}
        style={{
          width: '100%', textAlign: 'left', background: 'var(--card)', borderRadius: 20, padding: 18,
          border: '1px solid var(--card-b)', display: 'block', opacity: sessionDone ? 0.6 : 1,
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'var(--accent)', padding: '3px 8px', borderRadius: 6, background: 'var(--accent-bg)', textTransform: 'uppercase', marginBottom: 8 }}>
              {typeLabel[session.type]}
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.3 }}>{session.title}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1 }}>{session.total}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>minutes</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 3, height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--rail)' }}>
          {session.blocks.map((b, i) => {
            const dur = b.reps ? (b.min + (b.rest?.min || 0)) * b.reps : b.min;
            const total = session.blocks.reduce((s, bb) => s + (bb.reps ? (bb.min + (bb.rest?.min || 0)) * bb.reps : bb.min), 0);
            return <div key={i} style={{ flex: dur / total, background: blockColor(b.type) }} />;
          })}
        </div>
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{sessionDone ? 'Repose-toi ou va plus loin' : 'Voir le détail'}</div>
          {!sessionDone && (
            <div style={{ background: 'var(--accent)', color: 'var(--accent-text)', padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>
              +{session.total * 10 + 50} XP
            </div>
          )}
        </div>
      </button>

      {/* Grid nav */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
        <NavCard label="Niveau" value={level} sub={`${xpInLevel} / 500 XP`} progress={xpInLevel/500} onClick={() => go({ name: 'rewards' })} />
        <NavCard label="Série" value={state.streak} sub="séances consécutives" hot />
      </div>

      <button onClick={() => go({ name: 'program' })} style={{
        marginTop: 10, width: '100%', background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 20,
        padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Plan 12 semaines</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Voir tout le programme</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
      </button>

      {/* stats */}
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, margin: '22px 4px 10px' }}>Depuis le début</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <QuickStat label="Séances" val={state.sessionsDone} />
        <QuickStat label="Heures" val={(state.totalSec / 3600).toFixed(1)} />
        <QuickStat label="XP" val={state.xp} />
      </div>
    </div>
  );
}

function NavCard({ label, value, sub, progress, hot, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 20, padding: 14, textAlign: 'left',
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <div className="num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: -1, lineHeight: 1 }}>{value}</div>
        {hot && <span style={{ fontSize: 16 }}>🔥</span>}
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
      {progress !== undefined && (
        <div style={{ marginTop: 8, height: 3, background: 'var(--rail)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
      )}
    </button>
  );
}
function QuickStat({ label, val }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5, marginTop: 2 }}>{val}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SESSION DETAIL
// ─────────────────────────────────────────────────────────────
function SessionDetail({ ctx, route, go }) {
  const week = PROGRAM.weeks[route.week - 1];
  const session = week.sessions[route.idx];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div style={{ padding: '30px 20px 20px', background: 'var(--hero-bg)' }}>
        <button onClick={() => go({ name: 'home' })} style={{ width: 36, height: 36, borderRadius: 18, border: 'none', background: 'rgba(255,255,255,0.08)', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, padding: '4px 9px', borderRadius: 6, background: 'var(--accent)', color: 'var(--accent-text)', textTransform: 'uppercase' }}>{typeLabel[session.type]}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Sem {week.n} · {session.day}</div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.6, lineHeight: 1.1 }}>{session.title}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{week.focus}</div>
        <div style={{ display: 'flex', gap: 20, marginTop: 20 }}>
          <HS label="Durée" val={session.total} unit="min" />
          <HS label="Blocs" val={session.blocks.length} unit="phases" />
          <HS label="V.max" val={Math.max(...session.blocks.map(b => b.kmh))} unit="km/h" />
        </div>
      </div>

      <div style={{ padding: '20px 20px 16px', flex: 1 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, marginBottom: 12 }}>Plan de la séance</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {session.blocks.map((b, i) => <BlockRow key={i} block={b} />)}
        </div>

        <div style={{ marginTop: 18, padding: 16, background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--accent)', fontWeight: 700, marginBottom: 8 }}>💡 Conseil</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {session.type === 'TEM' && "Effort \"confortablement dur\" — tu peux dire 3-4 mots, pas plus. Pente à 1 %."}
            {session.type === 'INT' && "Sur les rapides : pousse fort mais finis chaque rep avec le même rythme. Récup active, ne t'arrête pas."}
            {session.type === 'END' && "Reste en aisance respiratoire, tu dois pouvoir discuter. Objectif : construire le foncier."}
            {session.type === 'LNG' && "Gère l'allure — c'est la durée qui compte, pas la vitesse. Hydrate-toi en milieu de séance."}
            {session.type === 'TST' && "Warm-up complet, puis effort soutenu. Pars prudemment, accélère progressivement."}
          </div>
        </div>
      </div>

      <div style={{ padding: '0 20px 30px' }}>
        <button onClick={() => go({ name: 'live', week: route.week, idx: route.idx })} style={{
          width: '100%', padding: 18, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 16,
          fontSize: 16, fontWeight: 700, letterSpacing: 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11l9-5.5z"/></svg>
          Démarrer la séance
        </button>
      </div>
    </div>
  );
}
function HS({ label, val, unit }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 3 }}>
        <div className="num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1 }}>{val}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{unit}</div>
      </div>
    </div>
  );
}
function BlockRow({ block }) {
  const isRep = !!block.reps;
  return (
    <div style={{ display: 'flex', gap: 12, padding: 14, background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14 }}>
      <div style={{ width: 4, borderRadius: 2, background: blockColor(block.type), flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: -0.2 }}>{block.label}</div>
          <div className="num" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{isRep ? `${block.reps}×` : ''}{block.min < 1 ? `${Math.round(block.min*60)}s` : `${block.min}min`}</div>
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
          <span><b className="num" style={{ color: 'var(--text)' }}>{block.kmh.toFixed(1)}</b> km/h</span>
          <span>Pente <b className="num" style={{ color: 'var(--text)' }}>{block.incline}%</b></span>
          <span>{kmhToPace(block.kmh)}/km</span>
        </div>
        {isRep && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--rail)', borderRadius: 6, fontSize: 11, color: 'var(--muted)' }}>
            ↻ Récup {block.rest.min < 1 ? `${Math.round(block.rest.min*60)}s` : `${block.rest.min}min`} à {block.rest.kmh} km/h
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LIVE SESSION — le cœur de l'app
// ─────────────────────────────────────────────────────────────
function LiveSession({ ctx, route, go }) {
  const week = PROGRAM.weeks[route.week - 1];
  const session = week.sessions[route.idx];
  const blocks = React.useMemo(() => flatBlocks(session), [session]);

  const [elapsed, setElapsed] = React.useState(0);
  const [running, setRunning] = React.useState(true);
  const [finished, setFinished] = React.useState(false);
  const lastBlockRef = React.useRef(0);
  const countdownRef = React.useRef({ block: -1, seconds: -1 });

  // Wake lock to keep screen on
  React.useEffect(() => {
    let lock = null;
    (async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch {} })();
    return () => { try { lock?.release(); } catch {} };
  }, []);

  // Timer
  React.useEffect(() => {
    if (!running || finished) return;
    const startWall = Date.now() - elapsed * 1000;
    const id = setInterval(() => {
      const e = (Date.now() - startWall) / 1000;
      setElapsed(e);
    }, 250);
    return () => clearInterval(id);
  }, [running, finished]);

  // Block lookup
  let t0 = 0, curIdx = 0, blockStart = 0, blockEnd = 0;
  const totalSec = blocks.reduce((s, b) => s + b.min * 60, 0);
  for (let i = 0; i < blocks.length; i++) {
    const end = t0 + blocks[i].min * 60;
    if (elapsed < end) { curIdx = i; blockStart = t0; blockEnd = end; break; }
    t0 = end;
  }
  if (elapsed >= totalSec && !finished) {
    curIdx = blocks.length - 1;
    blockStart = totalSec - blocks[blocks.length - 1].min * 60;
    blockEnd = totalSec;
  }

  const cur = blocks[curIdx];
  const next = blocks[curIdx + 1];
  const remaining = Math.max(0, blockEnd - elapsed);

  // Audio cues: block change + 3-second countdown + start announce
  React.useEffect(() => {
    if (!running || finished) return;
    if (curIdx !== lastBlockRef.current) {
      const block = blocks[curIdx];
      beep(880, 180);
      setTimeout(() => beep(880, 180), 220);
      vibrate([60, 80, 60], ctx.state.vibrationEnabled);
      const phrase = `${block.label}. ${block.kmh.toFixed(1)} kilomètres heure, pente ${block.incline} pour cent.`;
      speak(phrase, ctx.state.voiceEnabled);
      lastBlockRef.current = curIdx;
    }
    // 3-second countdown before block change
    const secondsLeft = Math.ceil(remaining);
    if (next && secondsLeft > 0 && secondsLeft <= 3 && countdownRef.current.block !== curIdx + 1 * 100 + secondsLeft) {
      // use composite key so we only announce each count once
      const key = curIdx * 10 + secondsLeft;
      if (countdownRef.current.key !== key) {
        countdownRef.current.key = key;
        beep(440, 90);
        if (secondsLeft === 3) {
          speak(`Dans 3. Prochain bloc, ${next.kmh.toFixed(1)}.`, ctx.state.voiceEnabled);
        }
      }
    }
  }, [curIdx, Math.floor(remaining), running, finished]);

  // Finish
  React.useEffect(() => {
    if (elapsed >= totalSec && !finished) {
      setFinished(true);
      setRunning(false);
      beep(660, 180); setTimeout(() => beep(880, 180), 200); setTimeout(() => beep(1100, 240), 400);
      vibrate([100, 80, 100, 80, 200], ctx.state.vibrationEnabled);
      speak('Séance terminée. Bravo !', ctx.state.voiceEnabled);
    }
  }, [elapsed, totalSec, finished]);

  const confirmFinish = () => {
    ctx.markDone(route.week, route.idx, session);
    go({ name: 'rewards' });
  };
  const confirmAbandon = () => {
    if (confirm('Abandonner la séance ? Ta progression ne sera pas sauvegardée.')) go({ name: 'home' });
  };
  const skipBlock = () => {
    setElapsed(blockEnd + 0.1);
  };

  if (finished) return <LiveFinished session={session} elapsed={elapsed} onConfirm={confirmFinish} onCancel={() => { setFinished(false); setRunning(true); }} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', padding: '20px 0 0' }}>
      <div style={{ padding: '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={confirmAbandon} style={{ background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 28, padding: 0 }}>×</button>
        <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{typeLabel[session.type]}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>Bloc {curIdx + 1}/{blocks.length}</div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 28 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700 }}>{cur.label}</div>
      </div>

      {/* Huge speed */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Règle le tapis sur</div>
        <div className="num" style={{ fontSize: 136, fontWeight: 700, letterSpacing: -7, lineHeight: 0.9, marginTop: 8 }}>{cur.kmh.toFixed(1)}</div>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: 1, color: 'var(--muted)' }}>km/h · pente {cur.incline}%</div>

        {/* countdown pulse if within 3s of next */}
        {next && remaining <= 3 && remaining > 0 && (
          <div style={{ marginTop: 22, fontSize: 14, color: 'var(--accent)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
            Prochain : {next.kmh.toFixed(1)} km/h dans {Math.ceil(remaining)}…
          </div>
        )}

        {/* Remaining block */}
        <div style={{ marginTop: 28, padding: '14px 18px', background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Fin du bloc</div>
            <div className="num" style={{ fontSize: 28, fontWeight: 600, letterSpacing: -1 }}>{fmtTime(remaining)}</div>
          </div>
          <div style={{ marginTop: 10, height: 4, background: 'var(--rail)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${((elapsed - blockStart) / (blockEnd - blockStart || 1)) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
          </div>
        </div>

        {next && (
          <div style={{ marginTop: 10, padding: '12px 16px', background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Suivant</div>
              <div style={{ fontSize: 13, marginTop: 2, fontWeight: 500 }}>{next.label}</div>
            </div>
            <div className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5 }}>{next.kmh.toFixed(1)}</div>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ height: 4, background: 'var(--rail)', borderRadius: 2, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ width: `${(elapsed / totalSec) * 100}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, textAlign: 'center' }}>
          <Metric label="Écoulé" val={fmtTime(elapsed)} />
          <Metric label="Restant" val={fmtTime(totalSec - elapsed)} />
        </div>
      </div>

      <div style={{ padding: '20px 20px 30px', display: 'flex', gap: 10 }}>
        <button onClick={skipBlock} style={{
          flex: 1, padding: 16, background: 'var(--card)', border: '1px solid var(--card-b)', color: 'var(--text)', borderRadius: 14,
          fontSize: 14, fontWeight: 600,
        }}>Skip bloc</button>
        <button onClick={() => setRunning(r => !r)} style={{
          flex: 2, padding: 16, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 14,
          fontSize: 15, fontWeight: 700, letterSpacing: 0.3,
        }}>{running ? '⏸  Pause' : '▶  Reprendre'}</button>
      </div>
    </div>
  );
}
function Metric({ label, val }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.5, marginTop: 3 }}>{val}</div>
    </div>
  );
}
function LiveFinished({ session, elapsed, onConfirm, onCancel }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '40px 24px 30px', textAlign: 'center' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ fontSize: 72 }}>🎉</div>
        <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700, marginTop: 12 }}>Séance terminée</div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5, marginTop: 8 }}>{session.title}</div>
        <div className="num" style={{ fontSize: 60, fontWeight: 600, letterSpacing: -2, marginTop: 24 }}>{fmtTime(elapsed)}</div>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>+{session.total * 10 + 50} XP</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: 16, background: 'var(--card)', border: '1px solid var(--card-b)', color: 'var(--text)', borderRadius: 14, fontSize: 14, fontWeight: 600 }}>Annuler</button>
        <button onClick={onConfirm} style={{ flex: 2, padding: 16, background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 700 }}>Valider la séance</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PROGRAM (plan 12 sem)
// ─────────────────────────────────────────────────────────────
function Program({ ctx, go }) {
  return (
    <div style={{ padding: '30px 0 40px' }}>
      <div style={{ padding: '0 20px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => go({ name: 'home' })} style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid var(--card-b)', background: 'var(--card)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Programme</div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.4 }}>10 km · 12 semaines</div>
        </div>
      </div>

      <div style={{ padding: '6px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PROGRAM.weeks.map((w) => {
          const sessionsDone = w.sessions.filter((_, i) => ctx.isDone(w.n, i)).length;
          const isCurrent = w.n === ctx.state.currentWeek;
          const isPast = w.n < ctx.state.currentWeek;
          return (
            <div key={w.n} style={{
              background: isCurrent ? 'var(--accent-bg)' : 'var(--card)', border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--card-b)'}`,
              borderRadius: 14, padding: 14, opacity: isPast ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="num" style={{ width: 26, height: 26, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isPast || isCurrent ? 'var(--accent)' : 'var(--rail)', color: isPast || isCurrent ? 'var(--accent-text)' : 'var(--muted)', fontSize: 11, fontWeight: 700 }}>
                    {isPast ? '✓' : w.n}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>Semaine {w.n}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{w.phase} · {w.focus}</div>
                  </div>
                </div>
                {isCurrent && <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>En cours</div>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {w.sessions.map((s, i) => {
                  const done = ctx.isDone(w.n, i);
                  const clickable = isCurrent && !done;
                  return (
                    <button key={i} disabled={!clickable} onClick={() => clickable && go({ name: 'session', week: w.n, idx: i })} style={{
                      flex: 1, padding: '10px 12px', background: done ? 'var(--accent)' : (isCurrent ? 'var(--card)' : 'var(--rail)'),
                      color: done ? 'var(--accent-text)' : 'var(--text)', border: 'none', borderRadius: 8, textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600 }}>{s.day.slice(0, 3)}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>{typeLabel[s.type]}</div>
                        <div className="num" style={{ fontSize: 10, fontWeight: 700 }}>{s.total}′</div>
                        {done && <span style={{ fontSize: 10 }}>✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// REWARDS
// ─────────────────────────────────────────────────────────────
function Rewards({ ctx, go }) {
  const { state } = ctx;
  const level = Math.floor(state.xp / 500) + 1;
  const xpInLevel = state.xp % 500;
  const stateForBadge = { ...state, sessionsDone: state.sessionsDone, streak: state.streak, currentWeek: state.currentWeek };
  const earned = BADGES.filter(b => b.req(stateForBadge));
  const locked = BADGES.filter(b => !b.req(stateForBadge));
  return (
    <div style={{ padding: '30px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => go({ name: 'home' })} style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid var(--card-b)', background: 'var(--card)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Récompenses</div>
      </div>

      <div style={{ background: 'var(--hero-bg)', border: '1px solid rgba(197,245,61,0.15)', borderRadius: 20, padding: 22, marginBottom: 20 }}>
        <div style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700 }}>Niveau</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <div className="num" style={{ fontSize: 56, fontWeight: 600, letterSpacing: -2, lineHeight: 1 }}>{level}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {level < 3 ? 'Apprenti' : level < 6 ? 'Régulier' : level < 10 ? 'Aguerri' : 'Machine'}
          </div>
        </div>
        <div style={{ marginTop: 14, height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${(xpInLevel / 500) * 100}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
        <div className="num" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          {xpInLevel} / 500 XP · {500 - xpInLevel} pour niveau {level + 1}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        <QuickStat label="Séances" val={state.sessionsDone} />
        <QuickStat label="Heures" val={(state.totalSec / 3600).toFixed(1)} />
        <QuickStat label="Série" val={`${state.streak}🔥`} />
      </div>

      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, margin: '0 4px 10px' }}>Obtenus · {earned.length}/{BADGES.length}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {earned.map(b => (
          <div key={b.id} style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>{b.emoji}</div>
            <div style={{ fontSize: 11, fontWeight: 600 }}>{b.name}</div>
          </div>
        ))}
        {earned.length === 0 && <div style={{ gridColumn: '1 / -1', padding: 14, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>Fais ta première séance pour débloquer !</div>}
      </div>

      {locked.length > 0 && (
        <>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, margin: '22px 4px 10px' }}>À débloquer</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {locked.map(b => (
              <div key={b.id} style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 14, textAlign: 'center', opacity: 0.45 }}>
                <div style={{ fontSize: 30, marginBottom: 6, filter: 'grayscale(1)' }}>{b.emoji}</div>
                <div style={{ fontSize: 11, fontWeight: 600 }}>{b.name}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────
function Settings({ ctx, go }) {
  const { state, patch, resetAll } = ctx;
  return (
    <div style={{ padding: '30px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={() => go({ name: 'home' })} style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid var(--card-b)', background: 'var(--card)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Réglages</div>
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, overflow: 'hidden' }}>
        <button onClick={() => go({ name: 'profile' })} style={{ width: '100%', padding: '14px 16px', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>Mon profil</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{state.profile.firstName || 'Non renseigné'} · modifier, exporter</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
        </button>
        <ToggleRow label="Guidage vocal" sub="Annonce les changements de blocs" on={state.voiceEnabled} onChange={(v) => patch({ voiceEnabled: v })} border />
        <ToggleRow label="Vibrations" sub="Vibre au changement de bloc" on={state.vibrationEnabled} onChange={(v) => patch({ vibrationEnabled: v })} border />
      </div>

      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, margin: '20px 4px 10px' }}>Semaine en cours</div>
      <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14 }}>Tu es en semaine</div>
          <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>{state.currentWeek}</div>
        </div>
        <input type="range" min="1" max="12" value={state.currentWeek} onChange={(e) => patch({ currentWeek: parseInt(e.target.value) })} style={{ width: '100%', marginTop: 10, accentColor: 'var(--accent)' }} />
        <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
          <span>1</span><span>6</span><span>12</span>
        </div>
      </div>

      <button onClick={() => { if (confirm('Réinitialiser toute ta progression ?')) resetAll(); }} style={{
        width: '100%', marginTop: 20, padding: 14, background: 'transparent', border: '1px solid rgba(255,100,100,0.3)', color: '#ff6b6b',
        borderRadius: 14, fontSize: 14, fontWeight: 600,
      }}>Réinitialiser la progression</button>

      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
        Foulée v1.0 · Programme 10 km tapis<br/>
        Tes données restent sur ton téléphone.
      </div>
    </div>
  );
}
function ToggleRow({ label, sub, on, onChange, border }) {
  return (
    <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: border ? '1px solid var(--card-b)' : 'none' }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>
      </div>
      <button onClick={() => onChange(!on)} style={{
        width: 48, height: 28, borderRadius: 14, border: 'none', padding: 2,
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.12)', position: 'relative', cursor: 'pointer',
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 12, background: '#fff',
          transform: on ? 'translateX(20px)' : 'translateX(0)', transition: 'transform .18s ease',
        }} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PROFIL
// ─────────────────────────────────────────────────────────────
function Profile({ ctx, route, go }) {
  const { state, updateProfile, patch, exportData, importData } = ctx;
  const isOnboarding = route?.onboarding || !state.onboarded;
  const [form, setForm] = React.useState(state.profile);
  const fileRef = React.useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    updateProfile(form);
    if (isOnboarding) patch({ onboarded: true });
    go({ name: 'home' });
  };

  // calcul allure cible vs actuelle
  const currentPace = form.currentPaceKmh || 7.5;
  const goalKmh = 10 / (form.goalTimeMin / 60);
  const delta = goalKmh - currentPace;
  const level = Math.floor(state.xp / 500) + 1;

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importData(file);
      alert('Profil importé avec succès !');
      go({ name: 'home' });
    } catch (err) {
      alert('Erreur : fichier invalide.\n' + err.message);
    }
  };

  return (
    <div style={{ padding: '30px 20px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        {!isOnboarding && (
          <button onClick={() => go({ name: 'home' })} style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid var(--card-b)', background: 'var(--card)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        )}
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>{isOnboarding ? 'Bienvenue' : 'Mon profil'}</div>
      </div>
      {isOnboarding && <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20 }}>On personnalise ton plan en 30 secondes.</div>}

      {!isOnboarding && (
        <div style={{ background: 'var(--hero-bg)', border: '1px solid rgba(197,245,61,0.15)', borderRadius: 20, padding: 20, marginBottom: 18, display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 28, background: 'var(--accent)', color: 'var(--accent-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700 }}>
            {form.firstName ? form.firstName[0].toUpperCase() : '?'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>{form.firstName || 'Sans nom'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Niveau {level} · {state.sessionsDone} séances · {state.xp} XP</div>
          </div>
        </div>
      )}

      <SectionLabel>Toi</SectionLabel>
      <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, overflow: 'hidden' }}>
        <FieldRow label="Prénom" placeholder="Ton prénom" value={form.firstName} onChange={(v) => set('firstName', v)} />
        <FieldRow label="Âge" type="number" suffix="ans" placeholder="—" value={form.age ?? ''} onChange={(v) => set('age', v === '' ? null : parseInt(v))} border />
        <FieldRow label="Poids" type="number" suffix="kg" placeholder="—" value={form.weightKg ?? ''} onChange={(v) => set('weightKg', v === '' ? null : parseFloat(v))} border />
      </div>

      <SectionLabel>Allure actuelle</SectionLabel>
      <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>Ta vitesse de confort sur tapis (où tu peux tenir une conversation) :</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="num" style={{ fontSize: 38, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1 }}>{(form.currentPaceKmh || 7.5).toFixed(1)}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>km/h · {kmhToPace(form.currentPaceKmh || 7.5)}/km</div>
        </div>
        <input type="range" min="5" max="12" step="0.1" value={form.currentPaceKmh || 7.5} onChange={(e) => set('currentPaceKmh', parseFloat(e.target.value))} style={{ width: '100%', marginTop: 12, accentColor: 'var(--accent)' }} />
        <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          <span>5</span><span>8</span><span>12 km/h</span>
        </div>
      </div>

      <SectionLabel>Objectif 10 km</SectionLabel>
      <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="num" style={{ fontSize: 38, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1 }}>
            {Math.floor(form.goalTimeMin / 60)}h{String(form.goalTimeMin % 60).padStart(2, '0')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>soit {goalKmh.toFixed(1)} km/h</div>
        </div>
        <input type="range" min="40" max="90" step="1" value={form.goalTimeMin} onChange={(e) => set('goalTimeMin', parseInt(e.target.value))} style={{ width: '100%', marginTop: 12, accentColor: 'var(--accent)' }} />
        <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
          <span>40min</span><span>1h05</span><span>1h30</span>
        </div>
        {delta > 0 && (
          <div style={{ marginTop: 12, padding: 10, background: 'var(--accent-bg)', borderRadius: 8, fontSize: 12, color: 'var(--text)' }}>
            Tu dois gagner <b>+{delta.toFixed(1)} km/h</b> en 12 semaines. {delta < 1 ? 'Très accessible.' : delta < 2 ? 'Ambitieux mais faisable.' : 'Très ambitieux — le plan va t\'aider.'}
          </div>
        )}
      </div>

      {!isOnboarding && (
        <>
          <SectionLabel>Statistiques</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <StatMini label="Séances" val={state.sessionsDone} />
            <StatMini label="Heures" val={(state.totalSec / 3600).toFixed(1)} />
            <StatMini label="XP total" val={state.xp} />
            <StatMini label="Série" val={`${state.streak}🔥`} />
          </div>

          <SectionLabel>Sauvegarde</SectionLabel>
          <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, overflow: 'hidden' }}>
            <button onClick={exportData} style={{ width: '100%', padding: '14px 16px', textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>Exporter mon profil</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Télécharger un fichier .json de secours</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M4 7l4 4 4-4M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button onClick={() => fileRef.current?.click()} style={{ width: '100%', padding: '14px 16px', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid var(--card-b)', color: 'var(--text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>Importer un profil</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Recharger depuis un .json</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V4M4 8l4-4 4 4M2 2h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} style={{ display: 'none' }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5, padding: '0 4px' }}>
            💡 Pense à exporter ton profil de temps en temps — c'est ta seule vraie sauvegarde si tu changes d'iPhone.
          </div>
        </>
      )}

      <button onClick={save} disabled={!form.firstName.trim()} style={{
        width: '100%', marginTop: 24, padding: 18, background: form.firstName.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
        color: form.firstName.trim() ? 'var(--accent-text)' : 'var(--muted)', border: 'none', borderRadius: 16,
        fontSize: 16, fontWeight: 700, letterSpacing: 0.3,
      }}>{isOnboarding ? 'Commencer le programme' : 'Enregistrer'}</button>
    </div>
  );
}
function SectionLabel({ children }) {
  return <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 700, margin: '22px 4px 10px' }}>{children}</div>;
}
function FieldRow({ label, value, onChange, placeholder, type = 'text', suffix, border }) {
  return (
    <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTop: border ? '1px solid var(--card-b)' : 'none' }}>
      <div style={{ fontSize: 15, fontWeight: 500, flexShrink: 0 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' }}>
        <input type={type} inputMode={type === 'number' ? 'numeric' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 15, textAlign: 'right', width: type === 'number' ? 80 : 160, outline: 'none', fontFamily: 'inherit' }} />
        {suffix && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{suffix}</span>}
      </div>
    </div>
  );
}
function StatMini({ label, val }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--card-b)', borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', fontWeight: 700 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.5, marginTop: 3 }}>{val}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
