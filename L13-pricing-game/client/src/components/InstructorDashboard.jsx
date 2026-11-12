import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoundsChart, PairBars, PairDots } from '../charts.jsx';
import { money, priceFmt } from '../econ.js';
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
    const side = x => x && { name: x.playerName, playerId: x.playerId, price: x.price, profit: x.profit, share: x.marketShare };
    out.push({
      pairId: [r.playerName, r.opponentName].sort().join(' | '),
      playerA: side(r),
      playerB: j >= 0 ? side(results[j]) : { name: r.opponentName, price: r.opponentPrice, profit: null, share: null }
    });
  });
  return out;
}

const STATUS_WORD = { setup: 'Not open yet', lobby: 'Lobby open', running: 'Playing', complete: 'Game over' };

const fmtSmall = v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });

// The settings line under the title: the road, the stations, and the numbers behind the Nash price (cost + 100 t)
function modelLine(config) {
  if (!config) return '';
  const c = Number(config.marginalCost) || 0;
  if (config.modelType === 'hotelling') {
    const t = Number(config.travelCost) || 0;
    const apart = config.x1 !== config.x2;
    const margin = t > 0 && apart ? 100 * t : 0;
    const level = margin === 0 ? 'no differentiation' : margin / Math.max(1e-9, config.consumerValue - c) < 0.08 ? 'very low differentiation' : margin / Math.max(1e-9, config.consumerValue - c) < 0.25 ? 'less differentiation' : 'full differentiation';
    return `Road, stations at ${config.x1} and ${config.x2} (${level}) · wholesale cost ${priceFmt(c, config)} · a gallon is worth ${priceFmt(config.consumerValue, config)} to a driver · driving cost ${fmtSmall(t)} a mile (told to students) · ${Number(config.marketSize || 100).toLocaleString('en-US')} gallons a round · Nash price ${priceFmt(c + margin, config)}`;
  }
  return `Logit demand · market ${config.marketSize} · unit cost ${priceFmt(c, config)} · price sensitivity ${config.alpha} · differentiation ${config.sigma}`;
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
  const [hover, setHover] = useState(null); // { key, x, y }: the pair under the mouse, for the floating history box
  const onHover = (key, e) => setHover(key ? { key, x: e.clientX, y: e.clientY } : null);
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

  const pairTotals = useMemo(() => {
    const m = new Map();
    byRound.forEach(r => r.results.forEach(p => {
      const cur = m.get(p.pairId) || { key: p.pairId, label: `${p.playerA?.name} & ${p.playerB?.name}`, aName: p.playerA?.name, bName: p.playerB?.name, a: 0, b: 0, pricesA: [], pricesB: [], profitsA: [], profitsB: [], sharesA: [], sharesB: [] };
      cur.a += p.playerA?.profit || 0; cur.b += p.playerB?.profit || 0;
      cur.pricesA[r.round - 1] = p.playerA?.price; cur.pricesB[r.round - 1] = p.playerB?.price;
      cur.profitsA[r.round - 1] = p.playerA?.profit; cur.profitsB[r.round - 1] = p.playerB?.profit;
      cur.sharesA[r.round - 1] = p.playerA?.share; cur.sharesB[r.round - 1] = p.playerB?.share;
      m.set(p.pairId, cur);
    }));
    return [...m.values()].sort((x, y) => (y.a + y.b) - (x.a + x.b));
  }, [byRound]);
  const shownPairs = pairTotals.filter(r => !pairSearch || r.label.toLowerCase().includes(pairSearch.toLowerCase()));
  // the market chart shows only a market the instructor picked, by typing a name or clicking a market (Mert, 2026-11-11:
  // it used to show the best market by default)
  const detail = pairTotals.find(r => r.key === selectedPair) || null;
  const [marketQuery, setMarketQuery] = useState('');
  const marketMatches = marketQuery.trim().length < 1 ? [] : pairTotals.filter(r => r.label.toLowerCase().includes(marketQuery.trim().toLowerCase()));
  const studentNames = useMemo(() => [...new Set(pairTotals.flatMap(r => [r.aName, r.bName]).filter(Boolean))].sort(), [pairTotals]);
  const onMarketQuery = v => {
    setMarketQuery(v);
    const q = v.trim().toLowerCase();
    const exact = pairTotals.filter(r => [r.aName, r.bName].some(nm => (nm || '').toLowerCase() === q));
    const some = pairTotals.filter(r => r.label.toLowerCase().includes(q));
    if (q && (exact.length === 1 || some.length === 1)) setSelectedPair((exact[0] || some[0]).key);
  };
  const hoverRow = hover ? pairTotals.find(r => r.key === hover.key) : null;
  const priceLabel = 'Price ($ per gallon)';
  const priceFloor = Number(config?.priceBounds?.min) || 0; // the lowest price a student can set ($3.30): the average-price chart's y axis starts here
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200, vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  // the leaderboard sorts by a click on a heading (Mert, 2026-11-11): total profit high-to-low by default, again for
  // low-to-high, or by name; the # column stays the rank by total profit
  const [boardSort, setBoardSort] = useState({ key: 'profit', dir: -1 });
  const sortBy = key => setBoardSort(s => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'profit' ? -1 : 1 }));
  const filteredBoard = (leaderboard || []).filter(r => r.name.toLowerCase().includes(search.toLowerCase()))
    .slice().sort((x, y) => boardSort.key === 'name' ? boardSort.dir * x.name.localeCompare(y.name, undefined, { numeric: true }) : boardSort.dir * ((x.totalProfit || 0) - (y.totalProfit || 0)));
  const arrow = key => (boardSort.key === key ? (boardSort.dir < 0 ? ' ▼' : ' ▲') : '');

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
                <RoundsChart rounds={nRounds} height={280} yLabel={priceLabel} yMin={priceFloor} series={[
                  { label: 'Average', color: '#1F2E5C', values: avgSeries, band: [avgSeries.map((v, i) => (v == null ? null : Math.max(priceFloor, v - sdSeries[i]))), avgSeries.map((v, i) => (v == null ? null : v + sdSeries[i]))] }
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
            <div className="qtext">Both stations' profit added up over the rounds played so far, best market first. Hover a market for its whole history; click to keep it below.</div>
            {pairTotals.length === 0 ? <div className="empty-note">Appears after the first round.</div> : (
              <div className="scroll" style={{ maxHeight: 520, maxWidth: 700 }}><PairBars rows={shownPairs} selected={detail?.key} onSelect={setSelectedPair} onHover={onHover} /></div>
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
                  <thead><tr><th>#</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => sortBy('name')} title="Sort by name">Name{arrow('name')}</th>
                    <th className="r" style={{ cursor: 'pointer' }} onClick={() => sortBy('profit')} title="Sort by total profit">Total profit{arrow('profit')}</th></tr></thead>
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

          {/* the 2025 shape (Mert, 2026-11-11): markets along the bottom, best total first, one dot per station */}
          <section className="panel wide">
            <div className="section-label">Individual profits by pair</div>
            <div className="qtext">Each market's two stations, highest total profit first: navy is station A, red station B. Hover a market for the names and its whole history; click to show its prices below.</div>
            {pairTotals.length === 0 ? <div className="empty-note">Appears after the first round.</div> : (
              <PairDots rows={pairTotals} selected={detail?.key} onSelect={k => { setSelectedPair(k); setMarketQuery(''); }} onHover={onHover} />
            )}
          </section>

          {/* one market, chosen by name (Mert, 2026-11-11) */}
          <section className="panel wide">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="section-label">{detail ? `One market: ${detail.label}` : 'One market'}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="search" list="market-names" placeholder="Type a student's name" value={marketQuery} onChange={e => onMarketQuery(e.target.value)} />
                <datalist id="market-names">{studentNames.map(nm => <option key={nm} value={nm} />)}</datalist>
                {detail && <button className="btn" onClick={() => { setSelectedPair(null); setMarketQuery(''); }}>Clear</button>}
              </div>
            </div>
            {!detail && marketMatches.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
                {marketMatches.slice(0, 12).map(r => <button key={r.key} className="btn" onClick={() => { setSelectedPair(r.key); setMarketQuery(''); }}>{r.label}</button>)}
              </div>
            )}
            {!detail ? (
              <div className="empty-note">{pairTotals.length === 0 ? 'Appears after the first round.' : marketQuery && marketMatches.length === 0 ? 'No student by that name.' : 'Type a name, or click a market above, to see that market\'s prices round by round.'}</div>
            ) : (
              <>
                <div className="qtext">The two stations' prices round by round; totals {money(detail.a)} and {money(detail.b)}.</div>
                <div style={{ maxWidth: 820 }}>
                  <RoundsChart rounds={nRounds} height={220} yLabel={priceLabel} series={[
                    { label: detail.aName, color: '#1F2E5C', values: Array.from({ length: nRounds }, (_, i) => detail.pricesA[i] ?? null) },
                    { label: detail.bName, color: '#A31F34', values: Array.from({ length: nRounds }, (_, i) => detail.pricesB[i] ?? null), width: 2 }
                  ]} />
                  <div className="legend"><span><i style={{ background: '#1F2E5C' }} />{detail.aName}</span><span><i style={{ background: '#A31F34' }} />{detail.bName}</span></div>
                </div>
              </>
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
        {/* the whole history of the market under the mouse (the 2025 page's hover box, 2026-11-10): the two price paths
            and one line per round with both prices and both profits */}
        {hoverRow && (
          // a large price chart only, no table (Mert, 2026-11-11)
          <div className="hoverbox" style={{ left: Math.max(8, Math.min(hover.x + 18, vw - 700)), top: Math.max(8, Math.min(hover.y + 18, vh - 540)) }}>
            <div className="section-label">{hoverRow.label}</div>
            <RoundsChart rounds={nRounds} height={300} yLabel={priceLabel} series={[
              { label: hoverRow.aName, color: '#1F2E5C', values: Array.from({ length: nRounds }, (_, i) => hoverRow.pricesA[i] ?? null) },
              { label: hoverRow.bName, color: '#A31F34', values: Array.from({ length: nRounds }, (_, i) => hoverRow.pricesB[i] ?? null), width: 2 }
            ]} />
            <div className="legend"><span><i style={{ background: '#1F2E5C' }} />{hoverRow.aName}: total {money(hoverRow.a)}</span><span><i style={{ background: '#A31F34' }} />{hoverRow.bName}: total {money(hoverRow.b)}</span></div>
            {/* each station's market share, round by round (Mert, 2026-11-12) */}
            <table className="res shares">
              <thead><tr><th>Market share</th>{Array.from({ length: nRounds }, (_, i) => <th key={i} className="r">R{i + 1}</th>)}</tr></thead>
              <tbody>
                {[[hoverRow.aName, hoverRow.sharesA, '#1F2E5C'], [hoverRow.bName, hoverRow.sharesB, '#A31F34']].map(([nm, sh, col]) => (
                  <tr key={nm}><td style={{ color: col, fontWeight: 600 }}>{nm}</td>
                    {Array.from({ length: nRounds }, (_, i) => <td key={i} className="r">{Number.isFinite(sh[i]) ? `${Math.round(sh[i] * 100)}%` : ''}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
