import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import { keyHeaders, withKey } from '../auth.js';

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

// Defaults are the games as played in 2025 (slides, speaker notes and the Nov 20, 2025 Section A transcript; set 2026-11-02):
// 100 consumers on a street from 0 to 100, each worth $200, $1 per unit walked, zero cost; 10 rounds, 60 s in round 1,
// then 50, 40 and 30 s; a 10 s break; prices 0 to 250.
// The games of the class (Mert, 2026-11-07/08), in the order of the 2025 class (both sections, from the recordings):
//  - demo: Mert plus a student volunteer against the ChatGPT seat, on his phone on the projector; 2025 settings read off
//    the screen capture: 3 rounds of 40 s, prices 0 to 250, very low differentiation (t = $0.10: a $50 vs $47.50 round
//    split 37.5/62.5), "average willingness to pay $100" on the slide (V = 100);
//  - three real games: same street, sellers at 0 and 100, walking gets cheaper each game ($1, 30¢, free; Nash prices
//    $100, $30, $0). 2025 moved the sellers instead (0/100, 35/65, 50/50), but with this demand formula 35/65 is identical
//    to 0/100, and a correct straight-line model has no stable price off the ends. 10 rounds, more time in the first rounds;
//  - a bonus game with chat on the second market (2025: 35/65, "you have more time in this game to chat", about 5 rounds
//    of 60 s, names hidden until the end).
// Every game uses per-round times (Mert, 2026-11-08: the demo and the bonus game too). Each entry patches DEFAULT_CONFIG;
// `base` 'default' is numbered default-1, -2, -3 (continuing past existing ones); the others are default-demo, default-chat.
export const DEFAULT_GAMES = [
  { base: 'default-demo', label: 'Demo', cfg: { rounds: 3, differentTimePerRound: true, roundTime: 40, roundTimes: [40, 40, 40], travelCost: 0.1, consumerValue: 100 } },
  { base: 'default', label: 'Game 1', cfg: { travelCost: 1 } },
  { base: 'default', label: 'Game 2', cfg: { travelCost: 0.3 } },
  { base: 'default', label: 'Game 3', cfg: { travelCost: 0 } },
  { base: 'default-chat', label: 'Bonus game with chat', cfg: { travelCost: 0.3, enableChat: true, rounds: 5, differentTimePerRound: true, roundTime: 60, roundTimes: [60, 60, 60, 60, 60] } }
];

const DEFAULT_CONFIG = {
  rounds: 10,
  roundTime: 30,
  breakTime: 10,
  differentTimePerRound: true,
  roundTimes: [60, 50, 40, 30, 30, 30, 30, 30, 30, 30],
  marketSize: 100,
  modelType: 'hotelling', // 'logit' or 'hotelling'
  // Logit model parameters
  alpha: 1,
  sigma: 5,
  // Hotelling model parameters
  travelCost: 1,
  consumerValue: 200,
  x1: 0,
  x2: 100,
  priceMin: 0,
  priceMax: 250,
  defaultPrice: 10,
  enableChat: false,
  hideRoundCount: false,
  showOpponentName: false,
  showModelParameters: false
};

// The settings of one game: every field of the form. `cfg` is a form state shaped like DEFAULT_CONFIG and `setCfg` takes an
// updater (cfg => cfg). The "New Game" form shows it once in two columns; the default games show it three times side by side
// (`compact`: one column, smaller round-time boxes), each game with its own settings (Mert, 2026-11-07).
function GameFields({ cfg, setCfg, compact = false }) {
  // value/onChange/onBlur for a number field: '' while being typed, `fallback` if left empty
  const numField = (key, fallback) => ({
    value: cfg[key],
    onChange: event => {
      const value = event.target.value === '' ? '' : Number(event.target.value);
      setCfg(c => ({ ...c, [key]: value }));
    },
    onBlur: event => {
      if (event.target.value === '') setCfg(c => ({ ...c, [key]: fallback }));
    }
  });
  const setRoundTime = (i, value) => setCfg(c => {
    const roundTimes = [...(c.roundTimes || [])];
    while (roundTimes.length <= i) roundTimes.push(c.roundTime);
    roundTimes[i] = value;
    return { ...c, roundTimes };
  });
  const pair = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: compact ? '0 10px' : '1rem' };

  return (
    <>
      <div className="input-row">
        <label>Rounds</label>
        <input
          type="number"
          min="1"
          step="1"
          value={cfg.rounds}
          onChange={event => {
            const newRounds = event.target.value === '' ? '' : Number(event.target.value);
            setCfg(c => {
              // If different time per round is enabled, adjust the array
              if (c.differentTimePerRound) {
                const numRounds = newRounds === '' ? 1 : newRounds;
                const roundTimes = Array(numRounds).fill(0).map((_, i) => c.roundTimes[i] || c.roundTime);
                return { ...c, rounds: newRounds, roundTimes };
              }
              return { ...c, rounds: newRounds };
            });
          }}
          onBlur={event => {
            if (event.target.value === '') setCfg(c => ({ ...c, rounds: 1 }));
          }}
        />
      </div>

      <div className="input-row">
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={cfg.differentTimePerRound}
            onChange={event => {
              const checked = event.target.checked;
              setCfg(c => ({ ...c, differentTimePerRound: checked, roundTimes: checked ? Array(Number(c.rounds)).fill(c.roundTime) : [] }));
            }}
            style={{ width: 'auto', cursor: 'pointer' }}
          />
          <span>Set different time for each round</span>
        </label>
      </div>

      {!cfg.differentTimePerRound && (
        <div className="input-row">
          <label>Seconds per round</label>
          <input type="number" min="10" step="1" {...numField('roundTime', 10)} />
        </div>
      )}

      {cfg.differentTimePerRound && (
        <div className="input-row">
          <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(5, minmax(0, 1fr))' : 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
            {Array.from({ length: Number(cfg.rounds) }).map((_, i) => {
              const currentValue = cfg.roundTimes[i] !== undefined ? cfg.roundTimes[i] : cfg.roundTime;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>{compact ? `R${i + 1}` : `Round ${i + 1}`}</label>
                  <input
                    type="number"
                    min="10"
                    step="1"
                    value={currentValue}
                    onChange={event => setRoundTime(i, event.target.value === '' ? '' : Number(event.target.value))}
                    onBlur={event => { if (event.target.value === '') setRoundTime(i, 10); }}
                    style={compact ? { padding: '0.4rem 0.3rem', fontSize: '0.8rem', textAlign: 'center' } : { padding: '0.5rem', fontSize: '0.875rem' }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="input-row">
        <label>Break between rounds (seconds)</label>
        <input type="number" min="0" step="1" {...numField('breakTime', 0)} />
      </div>
      <div className="input-row">
        <label>Market size</label>
        <input type="number" min="1" step="1" {...numField('marketSize', 1)} />
      </div>

      <div className="input-row">
        <label>Competition Model</label>
        <select
          value={cfg.modelType}
          onChange={event => setCfg(c => ({ ...c, modelType: event.target.value }))}
          style={{ padding: '0.5rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
        >
          <option value="logit">Logit Model</option>
          <option value="hotelling">Hotelling Model</option>
        </select>
      </div>

      {cfg.modelType === 'logit' && (
        <>
          <div className="input-row">
            <label>Price sensitivity (alpha)</label>
            <input type="number" step="any" {...numField('alpha', 1)} />
          </div>
          <div className="input-row">
            <label>Differentiation (sigma)</label>
            <input type="number" step="any" {...numField('sigma', 1)} />
          </div>
        </>
      )}

      {cfg.modelType === 'hotelling' && (
        <>
          <div className="input-row">
            <label>Travel cost (t)</label>
            <input type="number" step="any" min="0" {...numField('travelCost', 0)} />
          </div>
          <div className="input-row">
            <label>Consumer valuation (V)</label>
            <input type="number" step="any" min="0" {...numField('consumerValue', 0)} />
          </div>
          <div style={pair}>
            <div className="input-row">
              <label>Firm 1 location (x₁)</label>
              <input type="number" step="any" min="0" max="100" {...numField('x1', 0)} />
            </div>
            <div className="input-row">
              <label>Firm 2 location (x₂)</label>
              <input type="number" step="any" min="0" max="100" {...numField('x2', 0)} />
            </div>
          </div>
        </>
      )}

      <div style={pair}>
        <div className="input-row">
          <label>Min price</label>
          <input type="number" step="any" {...numField('priceMin', 0)} />
        </div>
        <div className="input-row">
          <label>Max price</label>
          <input type="number" step="any" {...numField('priceMax', 100)} />
        </div>
      </div>

      {/* the four on/off settings in one place (Mert, 2026-11-07) */}
      <fieldset className="options">
        <legend className="bgk">Options</legend>
        {[
          ['enableChat', 'Enable chat between paired students', 'Students matched together can chat during the game'],
          ['hideRoundCount', 'Hide the total number of rounds', 'Students see "Round 3" instead of "Round 3 of 10"'],
          ['showOpponentName', 'Show opponent names', 'Students see who they are paired with'],
          ['showModelParameters', 'Show model parameters', 'Students see the walking cost and the customer value']
        ].map(([key, title, help]) => (
          <label key={key} className="opt">
            <input type="checkbox" checked={Boolean(cfg[key])}
              onChange={event => setCfg(c => ({ ...c, [key]: event.target.checked }))} />
            <span><b>{title}</b><small>{help}</small></span>
          </label>
        ))}
      </fieldset>
    </>
  );
}

export default function InstructorPage() {
  const navigate = useNavigate();
  const [instructorSessions, setInstructorSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [instructorConfig, setInstructorConfig] = useState(DEFAULT_CONFIG);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [locked, setLocked] = useState(false);

  const instructorName = 'Instructor'; // Default single instructor name

  useEffect(() => {
    fetchInstructorSessions();
  }, []);

  const fetchInstructorSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch(buildApiUrl('/sessions'), { headers: keyHeaders() });
      if (response.status === 403) {
        setLocked(true); // no instructor key in this browser (2026-11-02): say so instead of showing an empty portal
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const allSessions = await response.json();
      setInstructorSessions(allSessions);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  // The settings the server gets, from a form state (the form, or DEFAULT_CONFIG for the default games)
  const configPayload = cfg => ({
    rounds: Number(cfg.rounds),
    roundTime: cfg.differentTimePerRound ? cfg.roundTimes.map(t => Number(t)) : Number(cfg.roundTime),
    breakTime: Number(cfg.breakTime),
    marketSize: Number(cfg.marketSize),
    modelType: cfg.modelType,
    // Logit parameters
    alpha: Number(cfg.alpha),
    sigma: Number(cfg.sigma),
    // Hotelling parameters
    travelCost: Number(cfg.travelCost),
    consumerValue: Number(cfg.consumerValue),
    x1: Number(cfg.x1),
    x2: Number(cfg.x2),
    priceBounds: { min: Number(cfg.priceMin), max: Number(cfg.priceMax) },
    enableChat: Boolean(cfg.enableChat),
    hideRoundCount: Boolean(cfg.hideRoundCount),
    showOpponentName: Boolean(cfg.showOpponentName),
    showModelParameters: Boolean(cfg.showModelParameters)
  });

  const postSession = async (name, cfg) => {
    const response = await fetch(buildApiUrl('/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...keyHeaders() },
      body: JSON.stringify({ instructorName, sessionName: name, config: configPayload(cfg) })
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || 'Failed to create session');
    }
    return response.json();
  };

  // "New Game": one session from the form, as in 2025
  const handleCreateSession = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    try {
      const data = await postSession(sessionName.trim() || `${instructorName}'s Game`, instructorConfig);
      // Redirect to the management page (instructor view)
      navigate(`/manage/${data.code}`, { 
        state: { instructorName: instructorName } 
      });
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  // Two ways to create games (Mert, 2026-11-07):
  //  - "New Game": the form, one session, as in 2025.
  //  - "Add the default games": one copy of the same form per game of DEFAULT_GAMES side by side (demo, three games, bonus
  //    game with chat), each prefilled and edited on its own (times, rounds, anything); any can be removed before Confirm,
  //    which creates them named default-demo, default-1, default-2, default-3, default-chat (numbering continues if
  //    pressed again). They
  //    appear in the list below; open each when its turn comes. A game's settings cannot be changed once created.
  const [formMode, setFormMode] = useState('custom');            // 'custom' | 'defaults'
  const [defaultGames, setDefaultGames] = useState([]);          // [{ name, cfg }] x 3 while the defaults form is open
  const [addingDefaults, setAddingDefaults] = useState(false);
  const openForm = mode => {
    setErrorMessage('');
    setFormMode(mode);
    if (mode === 'defaults') {
      const names = instructorSessions.map(s => s.sessionName || s.session_name || '');
      let n = names.reduce((m, name) => Math.max(m, Number((/^default-(\d+)$/.exec(name) || [])[1] || 0)), 0);
      setDefaultGames(DEFAULT_GAMES.map(g => {
        let name = g.base;
        if (g.base === 'default') {
          n += 1;
          name = `default-${n}`;
        } else {
          for (let k = 2; names.includes(name); k += 1) name = `${g.base}-${k}`; // default-demo-2 if one already exists
        }
        return {
          name,
          label: g.label,
          cfg: { ...DEFAULT_CONFIG, roundTimes: [...DEFAULT_CONFIG.roundTimes], modelType: 'hotelling', x1: 0, x2: 100, ...g.cfg }
        };
      }));
    }
    setShowCreateForm(true);
  };
  const setDefaultGame = (i, patch) => setDefaultGames(games => games.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const removeDefaultGame = i => setDefaultGames(games => games.filter((_, j) => j !== i));
  const setDefaultCfg = i => updater => setDefaultGames(games => games.map((g, j) => (j === i ? { ...g, cfg: typeof updater === 'function' ? updater(g.cfg) : updater } : g)));
  const handleAddDefaults = async () => {
    setErrorMessage('');
    setAddingDefaults(true);
    try {
      for (const [i, g] of defaultGames.entries()) {
        await postSession(g.name.trim() || `default-${i + 1}`, g.cfg);
      }
      await fetchInstructorSessions();
      setShowCreateForm(false);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setAddingDefaults(false);
    }
  };
  // What the instructor sees at the top of each default game's column: how differentiated the sellers are and the
  // one-shot Nash price of the game as set (t x 100 with sellers apart; $0 when walking is free or they share a spot)
  const describe = cfg => {
    if (cfg.modelType !== 'hotelling') return 'logit model';
    const t = Number(cfg.travelCost) || 0;
    const apart = Number(cfg.x1) !== Number(cfg.x2);
    const nash = t > 0 && apart ? t * 100 : 0;
    const what = !apart || t === 0 ? 'no differentiation' : t < 0.2 ? 'very low differentiation' : t < 1 ? 'less differentiation' : 'full differentiation';
    return `${what} · Nash price $${Math.round(nash * 100) / 100}${cfg.enableChat ? ' · chat on' : ''}`;
  };

  const handleDownload = (code, event) => {
    event.stopPropagation(); // Prevent row click
    const url = buildApiUrl(`/session/${code}/export`);
    window.open(withKey(url), '_blank');
  };

  const fetchSessionDetails = async (code) => {
    if (selectedSession === code) {
      // If clicking the same session, close it
      setSelectedSession(null);
      setSessionDetails(null);
      return;
    }

    try {
      setLoadingDetails(true);
      setSelectedSession(code);
      const response = await fetch(buildApiUrl(`/session/${code}`), { headers: keyHeaders() });
      if (!response.ok) {
        throw new Error('Failed to fetch session details');
      }
      const data = await response.json();
      setSessionDetails(data);
    } catch (err) {
      setErrorMessage(err.message);
      setSelectedSession(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDeleteClick = (code, sessionName, event) => {
    event.stopPropagation();
    setDeleteConfirm({ code, sessionName });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    
    try {
      const response = await fetch(buildApiUrl(`/session/${deleteConfirm.code}`), {
        method: 'DELETE',
        headers: keyHeaders()
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete session');
      }
      
      // Remove from local state
      setInstructorSessions(prev => prev.filter(s => s.code !== deleteConfirm.code));
      
      // Close details if this session was selected
      if (selectedSession === deleteConfirm.code) {
        setSelectedSession(null);
        setSessionDetails(null);
      }
      
      setDeleteConfirm(null);
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleDeleteAllConfirm = async () => {
    try {
      // Delete all sessions for this instructor
      const deletePromises = instructorSessions.map(session =>
        fetch(buildApiUrl(`/session/${session.code}`), { method: 'DELETE', headers: keyHeaders() })
      );
      
      await Promise.all(deletePromises);
      
      // Clear local state
      setInstructorSessions([]);
      setSelectedSession(null);
      setSessionDetails(null);
      setDeleteAllConfirm(false);
    } catch (err) {
      setErrorMessage('Failed to delete all sessions');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} @ ${hours}:${minutes}`;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete':
        return '#10b981';
      case 'running':
        return '#3b82f6';
      case 'lobby':
        return '#f59e0b';
      case 'setup':
        return '#8b5cf6';  // Purple for setup
      default:
        return '#6b7280';
    }
  };

  if (locked) {
    return (
      <div className="lab">
        <div className="join">
          <div className="card">
            <div className="case">Instructor page</div>
            <div className="qt">This page runs the game and needs the instructor's address.</div>
            <div className="hint">Students join at <b>{window.location.host}</b> with the code on the screen.</div>
            <button className="go" type="button" onClick={() => navigate('/')}>Go to the student page</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell portal${showCreateForm && formMode === 'defaults' ? ' wide' : ''}`}>
      <div className="card">
        <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p className="eyebrow">15.010 · Class 13 · Pricing game · instructor</p>
            <h1>Game sessions</h1>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/history" style={{ textDecoration: 'none' }}>
              <button style={{ fontSize: '0.875rem' }}>All History</button>
            </Link>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <button style={{ fontSize: '0.875rem' }}>Student View</button>
            </Link>
          </div>
        </header>

        {/* Create New Session Section */}
        <section style={{ marginBottom: '2rem', padding: '1.5rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Create New Session</h2>
            <div style={{ display: 'flex', gap: '8px' }}>
              {showCreateForm ? (
                <button type="button" onClick={() => setShowCreateForm(false)}>Hide Form</button>
              ) : (
                <>
                  <button className="primary" type="button" onClick={() => openForm('defaults')}
                    title="Opens the games of the class as played in 2025 (demo, three games, bonus game with chat), each with its own settings, to look over and confirm">
                    Add the default games
                  </button>
                  <button type="button" onClick={() => openForm('custom')}>New Game</button>
                </>
              )}
            </div>
          </div>
          {!showCreateForm && errorMessage && <p style={{ color: '#dc2626' }}>{errorMessage}</p>}

          {showCreateForm && formMode === 'custom' && (
            <form onSubmit={handleCreateSession} className="setup-form">
              <div className="input-row">
                <label htmlFor="session-name">Session Name</label>
                <input
                  id="session-name"
                  type="text"
                  value={sessionName}
                  onChange={event => setSessionName(event.target.value)}
                  placeholder={`e.g., "MBA Section A" or "Spring 2025"`}
                />
              </div>
              <GameFields cfg={instructorConfig} setCfg={setInstructorConfig} />
              <button type="submit" className="primary">Create Session</button>
              {errorMessage && <p style={{ color: '#dc2626' }}>{errorMessage}</p>}
            </form>
          )}

          {showCreateForm && formMode === 'defaults' && (
            <form onSubmit={e => { e.preventDefault(); handleAddDefaults(); }} className="setup-form three">
              <p className="small">The games of the class as played in 2025, side by side, each with its own settings: the demo (you and a volunteer against ChatGPT, 3 rounds of 40 s), the three games, and the bonus game with chat. Remove any you do not want, change what you like, then confirm; they appear in the list below, ready to open one at a time.</p>
              {defaultGames.map((g, i) => (
                <div key={`${g.label}-${g.name}`} className="gcol">
                  <div className="ghead">
                    <b>{g.label}<button type="button" className="rm" onClick={() => removeDefaultGame(i)} title="Leave this game out">✕ remove</button></b>
                    <span>{describe(g.cfg)}</span>
                  </div>
                  <div className="input-row">
                    <label htmlFor={`default-name-${i}`}>Session Name</label>
                    <input id={`default-name-${i}`} type="text" value={g.name} onChange={event => setDefaultGame(i, { name: event.target.value })} />
                  </div>
                  <GameFields cfg={g.cfg} setCfg={setDefaultCfg(i)} compact />
                </div>
              ))}
              <button type="submit" className="primary" disabled={addingDefaults || defaultGames.length === 0}>
                {addingDefaults ? 'Creating…' : defaultGames.length === 1 ? 'Confirm: create this game' : `Confirm: create the ${['', '', 'two', 'three', 'four', 'five'][defaultGames.length] || defaultGames.length} games`}
              </button>
              {errorMessage && <p style={{ color: '#dc2626' }}>{errorMessage}</p>}
            </form>
          )}
        </section>

        {/* Session History Section */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Session History ({instructorSessions.length})</h2>
            {instructorSessions.length > 0 && (
              <button
                onClick={() => setDeleteAllConfirm(true)}
                style={{
                  backgroundColor: '#dc2626',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                🗑️ Delete All Sessions
              </button>
            )}
          </div>
          
          {loading ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>Loading sessions...</p>
          ) : instructorSessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
              <p>No sessions found. Create your first game!</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Session Name</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Students</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Rounds</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {instructorSessions.map((session) => (
                  <React.Fragment key={session.code}>
                    <tr 
                      onClick={() => fetchSessionDetails(session.code)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: selectedSession === session.code ? '#f3f4f6' : 'transparent'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedSession !== session.code) {
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedSession !== session.code) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ marginRight: '0.5rem' }}>
                          {selectedSession === session.code ? '▼' : '▶'}
                        </span>
                        <Link 
                          to={`/manage/${session.code}`}
                          state={{ instructorName: instructorName }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ 
                            color: '#3b82f6', 
                            textDecoration: 'none',
                            fontWeight: 600
                          }}
                          title="Open session management"
                        >
                          {session.sessionName || session.code}
                        </Link>
                      </td>
                      <td>
                        <span style={{ fontWeight: 'bold' }}>
                          {session.code}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            color: 'white',
                            backgroundColor: getStatusColor(session.status)
                          }}
                        >
                          {session.status.toUpperCase()}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>
                          {session.studentCount || 0}
                        </span>
                      </td>
                      <td>{formatDate(session.createdAt)}</td>
                      <td>
                        {session.status === 'complete' ? formatDate(session.completedAt) : '-'}
                      </td>
                      <td>{session.config?.rounds || 'N/A'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={(e) => handleDownload(session.code, e)}
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
                          >
                            CSV
                          </button>
                          <button
                            onClick={(e) => handleDeleteClick(session.code, session.sessionName || session.code, e)}
                            style={{ 
                              padding: '0.25rem 0.75rem', 
                              fontSize: '0.875rem',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    {selectedSession === session.code && sessionDetails && (
                      <tr>
                        <td colSpan="8" style={{ padding: '1.5rem', backgroundColor: '#f9fafb' }}>
                          <div>
                            <h3 style={{ marginTop: 0 }}>Session Statistics</h3>
                            
                            {/* Configuration */}
                            <div style={{ marginBottom: '1.5rem' }}>
                              <h4 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                Configuration
                              </h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                                <div>
                                  <strong>Market Size:</strong> {sessionDetails.config?.marketSize}
                                </div>
                                <div>
                                  <strong>Price Sensitivity (α):</strong> {sessionDetails.config?.alpha}
                                </div>
                                <div>
                                  <strong>Differentiation (σ):</strong> {sessionDetails.config?.sigma}
                                </div>
                                <div>
                                  <strong>Round Time:</strong> {sessionDetails.config?.roundTime}s
                                </div>
                                <div>
                                  <strong>Price Range:</strong> ${sessionDetails.config?.priceBounds?.min} - ${sessionDetails.config?.priceBounds?.max}
                                </div>
                                <div>
                                  <strong>Total Rounds:</strong> {sessionDetails.config?.rounds}
                                </div>
                              </div>
                            </div>

                            {/* Players */}
                            {sessionDetails.players && sessionDetails.players.length > 0 && (
                              <div style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  Players ({sessionDetails.players.filter(p => p.role === 'student').length} students)
                                </h4>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  {sessionDetails.players.filter(p => p.role === 'student').map((player, idx) => (
                                    <span 
                                      key={idx}
                                      style={{ 
                                        padding: '0.25rem 0.75rem', 
                                        backgroundColor: '#e5e7eb', 
                                        borderRadius: '12px',
                                        fontSize: '0.875rem'
                                      }}
                                    >
                                      {player.name} {player.pairId && `(${player.pairId})`}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Round-by-Round Summary */}
                            {sessionDetails.rounds && sessionDetails.rounds.length > 0 && (
                              <div>
                                <h4 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  Round-by-Round Results
                                </h4>
                                <table className="table" style={{ fontSize: '0.875rem' }}>
                                  <thead>
                                    <tr>
                                      <th>Round</th>
                                      <th>Player</th>
                                      <th>Price</th>
                                      <th>Opponent</th>
                                      <th>Opp. Price</th>
                                      <th>Profit</th>
                                      <th>Market Share</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sessionDetails.rounds.flatMap((round) =>
                                      round.results.map((result, idx) => (
                                        <tr key={`${round.round}-${idx}`}>
                                          <td>{round.round}</td>
                                          <td>{result.playerName}</td>
                                          <td>${result.price.toFixed(2)}</td>
                                          <td>{result.opponentName}</td>
                                          <td>${result.opponentPrice.toFixed(2)}</td>
                                          <td style={{ 
                                            color: result.profit > result.opponentPrice * (sessionDetails.config.marketSize / 2) ? '#10b981' : '#6b7280',
                                            fontWeight: 600
                                          }}>
                                            ${result.profit.toFixed(2)}
                                          </td>
                                          <td>{(result.marketShare * 100).toFixed(1)}%</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>

                                {/* Summary Statistics */}
                                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'white', borderRadius: '8px' }}>
                                  <h4 style={{ marginTop: 0 }}>Summary Statistics</h4>
                                  {(() => {
                                    const allResults = sessionDetails.rounds.flatMap(r => r.results);
                                    const playerStats = {};
                                    
                                    allResults.forEach(result => {
                                      if (!playerStats[result.playerName]) {
                                        playerStats[result.playerName] = {
                                          totalProfit: 0,
                                          avgPrice: 0,
                                          avgShare: 0,
                                          rounds: 0
                                        };
                                      }
                                      playerStats[result.playerName].totalProfit += result.profit;
                                      playerStats[result.playerName].avgPrice += result.price;
                                      playerStats[result.playerName].avgShare += result.marketShare;
                                      playerStats[result.playerName].rounds += 1;
                                    });

                                    // Calculate averages
                                    Object.keys(playerStats).forEach(name => {
                                      const stats = playerStats[name];
                                      stats.avgPrice = stats.avgPrice / stats.rounds;
                                      stats.avgShare = stats.avgShare / stats.rounds;
                                    });

                                    // Sort by total profit
                                    const sortedPlayers = Object.entries(playerStats).sort((a, b) => b[1].totalProfit - a[1].totalProfit);

                                    return (
                                      <table className="table" style={{ fontSize: '0.875rem' }}>
                                        <thead>
                                          <tr>
                                            <th>Rank</th>
                                            <th>Player</th>
                                            <th>Total Profit</th>
                                            <th>Avg Price</th>
                                            <th>Avg Market Share</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sortedPlayers.map(([name, stats], idx) => (
                                            <tr key={name}>
                                              <td>
                                                <strong>
                                                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                                </strong>
                                              </td>
                                              <td style={{ fontWeight: 600 }}>{name}</td>
                                              <td style={{ color: '#10b981', fontWeight: 600 }}>
                                                ${stats.totalProfit.toFixed(2)}
                                              </td>
                                              <td>${stats.avgPrice.toFixed(2)}</td>
                                              <td>{(stats.avgShare * 100).toFixed(1)}%</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {selectedSession === session.code && loadingDetails && (
                      <tr>
                        <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f9fafb' }}>
                          Loading session details...
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => setDeleteConfirm(null)}
          >
            <div 
              style={{
                backgroundColor: 'white',
                padding: '2rem',
                borderRadius: '8px',
                maxWidth: '500px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0, color: '#dc2626' }}>⚠️ Delete Session?</h2>
              <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>
                Are you sure you want to permanently delete:
              </p>
              <p style={{ 
                fontWeight: 'bold', 
                fontSize: '1.1rem', 
                padding: '0.75rem', 
                backgroundColor: '#fee2e2',
                borderRadius: '4px',
                marginBottom: '1rem'
              }}>
                "{deleteConfirm.sessionName}" ({deleteConfirm.code})
              </p>
              <div style={{
                padding: '1rem',
                backgroundColor: '#fef3c7',
                borderLeft: '4px solid #f59e0b',
                marginBottom: '1.5rem',
                borderRadius: '4px'
              }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
                  ⚠️ WARNING: This action cannot be undone!
                </p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                  All data including players, rounds, and results will be permanently deleted from the database.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#e5e7eb',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete All Confirmation Modal */}
        {deleteAllConfirm && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '90%'
            }}>
              <h3 style={{ marginTop: 0 }}>Delete All Sessions?</h3>
              <p>
                Are you sure you want to delete <strong>all {instructorSessions.length} session(s)</strong>?
              </p>
              <div style={{
                padding: '1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fca5a5',
                color: '#991b1b',
                marginBottom: '1.5rem',
                borderRadius: '4px'
              }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
                  ⚠️ WARNING: This action cannot be undone!
                </p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                  All sessions including players, rounds, and results will be permanently deleted from the database.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteAllConfirm(false)}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#e5e7eb',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAllConfirm}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Delete All Permanently
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
