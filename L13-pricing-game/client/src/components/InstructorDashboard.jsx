import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoundsChart, PriceBars } from '../charts.jsx';
import { money, referencePrices } from '../econ.js';
import { withKey } from '../auth.js';

// The instructor's projector page in the 2026 lab look (2026-11-02; the 2025 page is in git history),
// laid out like the Class 6-11 dashboards: the room's state on top, then the prices, the leaderboard and the pairs.

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

// A saved session (read back after the game) lists one row per player; a live one lists pairs. Make both pairs.
function asPairs(results) {
  if (!results?.length || results[0].playerA) return results || [];
  const used = new Set();
  const out = [];
  results.forEach((r, i) => {
    if (used.has(i)) return;
    used.add(i);
    const j = results.findIndex((o, k) => !used.has(k) && o.playerName === r.opponentName && o.opponentName === r.playerName);
    if (j >= 0) used.add(j);
    const side = x => x && { name: x.playerName, playerId: x.playerId, price: x.price, profit: x.profit };
    out.push({
      pairId: `p${i}`,
      playerA: side(r),
      playerB: j >= 0 ? side(results[j]) : { name: r.opponentName, price: r.opponentPrice, profit: null }
    });
  });
  return out;
}

const STATUS_WORD = { setup: 'Not open yet', lobby: 'Lobby open', running: 'Playing', complete: 'Game over' };

function modelLine(config) {
  if (!config) return '';
  if (config.modelType === 'hotelling') {
    const d = Math.abs(config.x2 - config.x1);
    const level = d >= 100 ? 'full differentiation' : d === 0 ? 'no differentiation' : 'some differentiation';
    return `Linear city, sellers at ${config.x1} and ${config.x2} (${level}) · worth ${money(config.consumerValue)} · walking cost ${money(config.travelCost)} per unit`;
  }
  return `Logit demand · market ${config.marketSize} · price sensitivity ${config.alpha} · differentiation ${config.sigma}`;
}

export function InstructorDashboard({
  session,
  canStart,
  canOpenLobby,
  startDisabledReason,
  onStart,
  onOpenLobby,
  onEndSession,
  leaderboard,
  latestRound,
  allRounds,
  errorMessage,
  onDismissError,
  timer,
  roundActive,
  nextRoundCountdown,
  submissionProgress
}) {
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);
  const [search, setSearch] = useState('');
  const config = session?.config;
  const status = session?.status;
  const code = session?.code || '';
  const players = (session?.players || []).filter(p => p.role === 'student' || p.role === 'ai');
  const online = players.filter(p => p.connectionStatus === 'online').length;
  const rounds = config?.rounds || 0;
  const current = session?.currentRound || 0;
  const joinHost = typeof window !== 'undefined' ? window.location.host : '';
  const ref = useMemo(() => referencePrices(config), [config]);

  const byRound = useMemo(() => {
    const m = new Map();
    (allRounds || []).forEach(r => m.set(r.round, { ...r, results: asPairs(r.results) }));
    return [...m.values()].sort((a, b) => a.round - b.round);
  }, [allRounds]);

  const pricesOf = r => (r?.results || []).flatMap(x => [x.playerA?.price, x.playerB?.price]).filter(Number.isFinite);
  const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const med = a => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), k = Math.floor(s.length / 2);
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  };
  const nRounds = Math.max(rounds, byRound.length, 1);
  const avgSeries = Array.from({ length: nRounds }, (_, i) => avg(pricesOf(byRound.find(r => r.round === i + 1))));
  const medSeries = Array.from({ length: nRounds }, (_, i) => med(pricesOf(byRound.find(r => r.round === i + 1))));
  const lastRound = latestRound ? { ...latestRound, results: asPairs(latestRound.results) } : null;
  const lastPrices = pricesOf(lastRound);

  const lines = ref ? [
    { label: `Collusion ${money(ref.collusion)}`, color: '#1E7B34', y: ref.collusion },
    { label: `Nash ${money(ref.nash)}`, color: '#A31F34', y: ref.nash }
  ] : [];

  const filteredBoard = (leaderboard || []).filter(r => r.name.toLowerCase().includes(search.toLowerCase()));

  const download = () => { if (code) window.open(withKey(buildApiUrl(`/session/${code}/export`)), '_blank'); };

  // the state panel: what the room should be doing right now
  let state;
  if (status === 'setup' || status === 'lobby') {
    state = (
      <div className="joinbox">
        <div>
          <div className="k" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Session code</div>
          <div className="code">{code}</div>
        </div>
        <div className="addr">
          {status === 'setup'
            ? <>Students can't join yet. <b>Open the lobby</b> when you are ready.</>
            : <>Go to <b>{joinHost}</b> and type the code.<br /><span style={{ fontSize: 15 }}>Or open <b>{joinHost}/session/{code}</b></span></>}
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="k" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>Students in</div>
          <div style={{ font: '700 56px/1 ui-monospace,Menlo,monospace', color: 'var(--navy)' }}>{players.length}</div>
        </div>
      </div>
    );
  } else if (status === 'running') {
    const sub = submissionProgress && submissionProgress.round === current ? submissionProgress : null;
    const share = sub && sub.total ? sub.submitted / sub.total : 0;
    state = (
      <div className="state">
        <div>
          <div className="k">Round</div>
          <div className="n">{current}{rounds ? <small> of {rounds}{config?.hideRoundCount ? ' (hidden from students)' : ''}</small> : null}</div>
        </div>
        <div>
          <div className="k">{roundActive ? 'Time left' : 'Next round in'}</div>
          <div className={`n${roundActive && timer <= 5 ? ' low' : ''}`}>
            {roundActive ? `${Math.max(0, timer)}s` : nextRoundCountdown != null ? `${nextRoundCountdown}s` : '–'}
          </div>
        </div>
        <div>
          <div className="k">Prices in</div>
          <div className="n">{sub ? sub.submitted : '–'}<small>{sub ? ` of ${sub.total}` : ''}</small></div>
          <div className="track"><div className={`fill${share >= 1 ? ' ok' : ''}`} style={{ width: `${share * 100}%` }} /></div>
        </div>
      </div>
    );
  } else if (status === 'complete') {
    const top = (leaderboard || [])[0];
    state = (
      <div className="state">
        <div><div className="k">Game over</div><div className="n">{byRound.length}<small> rounds played</small></div></div>
        <div><div className="k">Top profit</div><div className="n" style={{ color: 'var(--ok)' }}>{top ? money(top.totalProfit) : '–'}</div></div>
        <div><div className="k">Winner</div><div className="n" style={{ fontSize: 30 }}>{top ? top.name : '–'}</div></div>
      </div>
    );
  } else {
    state = <div className="empty-note">Loading the session…</div>;
  }

  const pairs = lastRound?.results || [];

  return (
    <div className="dash">
      <div className="page">
        <header className="dash-top">
          <div>
            <p className="eyebrow">15.010 · Class 13 · Pricing game · instructor</p>
            <h1>{session?.sessionName || 'Pricing game'}<span className={`badge${status === 'running' ? ' live' : ''}`}>{STATUS_WORD[status] || '…'}</span></h1>
            <div className="params">{modelLine(config)}</div>
          </div>
          <div className="tools">
            <button className="btn" onClick={() => navigate('/instructor')}>All sessions</button>
            {status !== 'setup' && status !== 'lobby' && <button className="btn" onClick={download}>Download CSV</button>}
            {canOpenLobby && <button className="btn primary big" onClick={onOpenLobby}>Open the lobby</button>}
            {status === 'lobby' && (
              <button className="btn primary big" onClick={onStart} disabled={!canStart} title={startDisabledReason || ''}>Start the game</button>
            )}
            {status !== 'complete' && (
              <button className={`btn danger${armed ? ' armed' : ''}`}
                onClick={() => { if (armed) { setArmed(false); onEndSession(); } else { setArmed(true); setTimeout(() => setArmed(false), 4000); } }}>
                {armed ? 'Click again to end' : 'End game'}
              </button>
            )}
          </div>
        </header>
        {errorMessage && (
          <div className="err"><span>{errorMessage}</span><button className="btn" onClick={onDismissError}>Dismiss</button></div>
        )}

        <div className="grid">
          <section className="panel wide">{state}</section>

          <section className="panel wide">
            <div className="section-label">Prices by round</div>
            <div className="qtext">The average and median price the room set in each round. Dashed lines: the one-shot Nash price
              (each firm's best reply to the other) and the collusion price, which maximizes the two firms' joint profit.</div>
            {byRound.length === 0 ? <div className="empty-note">The first round's prices appear here when it ends.</div> : (
              <>
                <RoundsChart rounds={nRounds} height={280} lines={lines} series={[
                  { label: 'Average', color: '#1F2E5C', values: avgSeries },
                  { label: 'Median', color: '#7d8fb8', values: medSeries, width: 2 }
                ]} />
                <div className="legend">
                  <span><i style={{ background: '#1F2E5C' }} />Average price</span>
                  <span><i style={{ background: '#7d8fb8' }} />Median price</span>
                  {ref && <span><i className="dash1" />Collusion price {money(ref.collusion)} (each earns {money(ref.collusionProfit)})</span>}
                  {ref && <span><i className="dash2" />Nash price {money(ref.nash)} (each earns {money(ref.nashProfit)})</span>}
                </div>
              </>
            )}
          </section>

          <section className="panel">
            <div className="section-label">Round {latestRound?.round || '–'} · the prices</div>
            <div className="qtext">How many students chose each price in the last round played.</div>
            {lastPrices.length === 0 ? <div className="empty-note">No round has ended yet.</div> : (
              <PriceBars values={lastPrices} lo={config?.priceBounds?.min ?? 0} hi={config?.priceBounds?.max ?? 100}
                bins={10} marks={ref ? [{ label: 'Nash', color: '#A31F34', x: ref.nash }, { label: 'Collusion', color: '#1E7B34', x: ref.collusion }] : []} />
            )}
          </section>

          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div className="section-label">Leaderboard</div>
              <input className="search" placeholder="Search names" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="qtext">Total profit so far.</div>
            {filteredBoard.length === 0 ? <div className="empty-note">No profits yet.</div> : (
              <div className="scroll">
                <table className="res">
                  <thead><tr><th>#</th><th>Name</th><th className="r">Total profit</th></tr></thead>
                  <tbody>
                    {filteredBoard.map(r => {
                      const k = (leaderboard || []).indexOf(r) + 1;
                      return <tr key={r.playerId || r.name} className={k <= 3 ? 'top' : ''}><td>{k}</td><td>{r.name}</td><td className="r">{money(r.totalProfit)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel wide">
            <div className="section-label">Pairs · round {latestRound?.round || '–'}</div>
            <div className="qtext">Each market in the last round played.</div>
            {pairs.length === 0 ? <div className="empty-note">Pairs are made when the game starts; their prices appear after the first round.</div> : (
              <div className="scroll">
                <table className="res">
                  <thead><tr><th>Seller A</th><th className="r">Price</th><th className="r">Profit</th><th>Seller B</th><th className="r">Price</th><th className="r">Profit</th></tr></thead>
                  <tbody>
                    {pairs.map(p => (
                      <tr key={p.pairId}>
                        <td>{p.playerA?.name}</td><td className="r">{money(p.playerA?.price, 0)}</td><td className="r">{money(p.playerA?.profit)}</td>
                        <td>{p.playerB?.name}</td><td className="r">{money(p.playerB?.price, 0)}</td><td className="r">{money(p.playerB?.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel wide">
            <div className="section-label">Students ({players.length}{players.length ? `, ${online} online` : ''})</div>
            {players.length === 0 ? <div className="empty-note">No one has joined yet.</div> : (
              <div className="scroll" style={{ maxHeight: 260 }}>
                <table className="res">
                  <thead><tr><th>Name</th><th>Status</th><th>Pair</th></tr></thead>
                  <tbody>
                    {players.map(p => (
                      <tr key={p.socketId}>
                        <td>{p.name}{p.role === 'ai' ? ' (AI)' : ''}</td>
                        <td><span className={`dot ${p.connectionStatus || ''}`} />{p.connectionStatus || 'offline'}</td>
                        <td>{p.pairId || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
