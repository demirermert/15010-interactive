import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoundsChart, PairBars } from '../charts.jsx';
import { money } from '../econ.js';
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
      pairId: [r.playerName, r.opponentName].sort().join(' | '),
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
  const [pairSearch, setPairSearch] = useState('');
  const [selectedPair, setSelectedPair] = useState(null);
  const config = session?.config;
  const status = session?.status;
  const code = session?.code || '';
  const players = (session?.players || []).filter(p => p.role === 'student' || p.role === 'ai');
  const online = players.filter(p => p.connectionStatus === 'online').length;
  const rounds = config?.rounds || 0;
  const current = session?.currentRound || 0;
  const joinHost = typeof window !== 'undefined' ? window.location.host : '';

  const byRound = useMemo(() => {
    const m = new Map();
    (allRounds || []).forEach(r => m.set(r.round, { ...r, results: asPairs(r.results) }));
    return [...m.values()].sort((a, b) => a.round - b.round);
  }, [allRounds]);

  // The 2025 charts: the average price each round with one standard deviation around it, and profits by pair
  const pricesOf = r => (r?.results || []).flatMap(x => [x.playerA?.price, x.playerB?.price]).filter(Number.isFinite);
  const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const sd = a => { if (!a.length) return null; const m = avg(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  const nRounds = Math.max(rounds, byRound.length, 1);
  const roundPrices = Array.from({ length: nRounds }, (_, i) => pricesOf(byRound.find(r => r.round === i + 1)));
  const avgSeries = roundPrices.map(avg);
  const sdSeries = roundPrices.map(sd);
  const lastRound = latestRound ? { ...latestRound, results: asPairs(latestRound.results) } : null;

  const pairTotals = useMemo(() => {
    const m = new Map();
    byRound.forEach(r => r.results.forEach(p => {
      const cur = m.get(p.pairId) || { key: p.pairId, label: `${p.playerA?.name} & ${p.playerB?.name}`, aName: p.playerA?.name, bName: p.playerB?.name, a: 0, b: 0, pricesA: [], pricesB: [], profitsA: [], profitsB: [] };
      cur.a += p.playerA?.profit || 0; cur.b += p.playerB?.profit || 0;
      cur.pricesA[r.round - 1] = p.playerA?.price; cur.pricesB[r.round - 1] = p.playerB?.price;
      cur.profitsA[r.round - 1] = p.playerA?.profit; cur.profitsB[r.round - 1] = p.playerB?.profit;
      m.set(p.pairId, cur);
    }));
    return [...m.values()].sort((x, y) => (y.a + y.b) - (x.a + x.b));
  }, [byRound]);
  const shownPairs = pairTotals.filter(r => !pairSearch || r.label.toLowerCase().includes(pairSearch.toLowerCase()));
  const detail = pairTotals.find(r => r.key === selectedPair) || pairTotals[0] || null;

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
            <div className="section-label">Average price across rounds</div>
            <div className="qtext">The average price the room set in each round; the band is one standard deviation either side.</div>
            {byRound.length === 0 ? <div className="empty-note">The first round's prices appear here when it ends.</div> : (
              <>
                <RoundsChart rounds={nRounds} height={280} series={[
                  { label: 'Average', color: '#1F2E5C', values: avgSeries, band: [avgSeries.map((v, i) => (v == null ? null : Math.max(0, v - sdSeries[i]))), avgSeries.map((v, i) => (v == null ? null : v + sdSeries[i]))] }
                ]} />
                <div className="legend">
                  <span><i style={{ background: '#1F2E5C' }} />Average price</span>
                  <span><i style={{ background: '#1F2E5C', opacity: .25, height: 10 }} />One standard deviation</span>
                </div>
              </>
            )}
          </section>

          <section className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div className="section-label">Total profit by pair</div>
              <input className="search" placeholder="Find a name" value={pairSearch} onChange={e => setPairSearch(e.target.value)} />
            </div>
            <div className="qtext">Both sellers' profit added up over the rounds played so far, best market first. Click a market to see its prices.</div>
            {pairTotals.length === 0 ? <div className="empty-note">Appears after the first round.</div> : (
              <div className="scroll" style={{ maxHeight: 520, maxWidth: 700 }}><PairBars rows={shownPairs} selected={detail?.key} onSelect={setSelectedPair} /></div>
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

          {detail && (
            <section className="panel wide">
              <div className="section-label">One market: {detail.label}</div>
              <div className="qtext">The two sellers' prices round by round; totals {money(detail.a)} and {money(detail.b)}.</div>
              <div style={{ maxWidth: 820 }}>
                <RoundsChart rounds={nRounds} height={220} series={[
                  { label: detail.aName, color: '#1F2E5C', values: Array.from({ length: nRounds }, (_, i) => detail.pricesA[i] ?? null) },
                  { label: detail.bName, color: '#A31F34', values: Array.from({ length: nRounds }, (_, i) => detail.pricesB[i] ?? null), width: 2 }
                ]} />
                <div className="legend"><span><i style={{ background: '#1F2E5C' }} />{detail.aName}</span><span><i style={{ background: '#A31F34' }} />{detail.bName}</span></div>
              </div>
            </section>
          )}

          <section className="panel wide">
            <div className="section-label">Pairs · round {latestRound?.round || '–'}</div>
            <div className="qtext">Each market in the last round played.</div>
            {pairs.length === 0 ? <div className="empty-note">Pairs are made when the game starts; their prices appear after the first round.</div> : (
              <div className="scroll">
                <table className="res">
                  <thead><tr><th>Seller A</th><th className="r">Price</th><th className="r">Profit</th><th>Seller B</th><th className="r">Price</th><th className="r">Profit</th></tr></thead>
                  <tbody>
                    {pairs.map(p => (
                      <tr key={p.pairId} onClick={() => setSelectedPair(p.pairId)} style={{ cursor: 'pointer', background: detail?.key === p.pairId ? '#f3f5fa' : undefined }}>
                        <td>{p.playerA?.name}</td><td className="r">{money(p.playerA?.price, 0)}</td><td className="r">{money(p.playerA?.profit)}</td>
                        <td>{p.playerB?.name}</td><td className="r">{money(p.playerB?.price, 0)}</td><td className="r">{money(p.playerB?.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-label">Individual profits by pair</div>
            <div className="qtext">Each seller's own total within the market, best market first.</div>
            {pairTotals.length === 0 ? <div className="empty-note">Appears after the first round.</div> : (
              <div className="scroll" style={{ maxHeight: 520, maxWidth: 700 }}><PairBars rows={shownPairs} split selected={detail?.key} onSelect={setSelectedPair} /></div>
            )}
          </section>

          <section className="panel">
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
