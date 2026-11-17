import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoundsChart, PairBars, PairDots } from '../charts.jsx';
import { money, priceFmt, hasAnnounce } from '../econ.js';
import { withKey } from '../auth.js';
import { LawText } from './StudentView.jsx';

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
  submissionProgress,
  chatReview,
  announce,
  announceProgress,
  announceLog,
  onRerunReview
}) {
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);
  const [search, setSearch] = useState('');
  const [pairSearch, setPairSearch] = useState('');
  const [selectedPair, setSelectedPair] = useState(null);
  const [hover, setHover] = useState(null); // { key, x, y }: the pair under the mouse, for the floating history box
  const [tab, setTab] = useState('results');
  const [showAvg, setShowAvg] = useState(false); // the average-price chart, closed at first
  // the announcement phase's clock ticks on the dashboard too (2026-11-16)
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => { if (!announce) return undefined; const t = setInterval(() => setNowTick(Date.now()), 250); return () => clearInterval(t); }, [announce]);
  const isAnnounce = hasAnnounce(session?.config);
  // every pair's announcements: live from the server, or after a reload of a finished game from the review's chats
  const annLog = (announceLog || []).length ? announceLog
    : (chatReview?.results || []).flatMap(r => [...new Set((r.messages || []).map(m => m.round))].map(round => ({ round, pairId: r.pairId, nameA: r.nameA, nameB: r.nameB,
      A: (r.messages.find(m => m.round === round && m.station === 'A') || {}).text || '', B: (r.messages.find(m => m.round === round && m.station === 'B') || {}).text || '' })));
  const reviewBadge = chatReview?.status === 'running' ? `reviewing ${chatReview.done} of ${chatReview.total}`
    : chatReview?.status === 'done' ? `${chatReview.results.filter(r => r.verdict === 'Illegal').length} illegal of ${chatReview.results.length}` : '';
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
  } else if (status === 'running' && announce) {
    const left = Math.max(0, Math.ceil((announce.endsAt - nowTick) / 1000));
    const ap = announceProgress && announceProgress.round === announce.round ? announceProgress : null;
    state = (
      <div className="state">
        <div>
          <div className="k">Round</div>
          <div className="n">{announce.round}{rounds ? <small> of {rounds}</small> : null}</div>
        </div>
        <div>
          <div className="k">Announcements revealed in</div>
          <div className={`n${left <= 10 ? ' low' : ''}`} id="announce-clock">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
        </div>
        <div>
          <div className="k">Announcements in</div>
          <div className="n">{ap ? ap.done : '–'}<small>{ap ? ` of ${ap.total}` : ''}</small></div>
          <div className="track"><div className={`fill${ap && ap.done >= ap.total ? ' ok' : ''}`} style={{ width: `${ap && ap.total ? (ap.done / ap.total) * 100 : 0}%` }} /></div>
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
            <p className="eyebrow">15.010 · Class 14 · Collusion game · instructor</p>
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

        <div className={`grid${config?.aiChatReview && tab === 'review' ? ' show-review' : ''}`}>
          <section className="panel wide statep">{state}</section>

          {/* a game with the AI legal review gets two tabs under the header (Mert, 2026-11-16) */}
          {config?.aiChatReview && (
            <div className="tabs wide">
              <button className={tab === 'results' ? 'on' : ''} onClick={() => setTab('results')}>Game results</button>
              <button className={tab === 'review' ? 'on' : ''} id="tab-review" onClick={() => setTab('review')}>
                AI legal review{reviewBadge ? <span className="badge">{reviewBadge}</span> : null}
              </button>
            </div>
          )}

          {config?.aiChatReview && status === 'complete' && chatReview && chatReview.status !== 'none' && (
            <section className="panel wide rsum" id="review-summary">
              <div className="review"><ReviewSummary review={chatReview} pairTotals={pairTotals} status={status} onRerun={onRerunReview} mode={isAnnounce ? 'announce' : 'chat'} /></div>
            </section>
          )}
          {isAnnounce && <AnnouncementsPanel log={annLog} status={status} review={chatReview} byRound={byRound} config={config} />}

          <section className="panel wide">
            {/* collapsible, closed at first (Mert, 2026-11-17) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div className="section-label" style={{ margin: 0 }}>Average price across rounds</div>
              <button className="btn" id="avg-toggle" onClick={() => setShowAvg(v => !v)}>{showAvg ? 'Hide' : 'Show'}</button>
            </div>
            {!showAvg ? null : <>
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
            </>}
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

          {config?.aiChatReview && <ReviewPanel review={chatReview} pairTotals={pairTotals} status={status} onRerun={onRerunReview} mode={isAnnounce ? 'announce' : 'chat'} />}

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

// The AI legal review of the chats (Mert, 2026-11-16): the counts, prices in illegal vs legal markets, and every pair's
// verdict, rule and reason; a row opens the quoted lines and the whole chat.
// every pair's announcements, newest round first (Mert, 2026-11-16: "in the dashboard we'll also show the announcements")
function AnnouncementsPanel({ log, status, review, byRound, config }) {
  const [q, setQ] = useState('');
  // hovering a name: that student's prices round by round, the rival's next to them (Mert, 2026-11-17)
  const priceRows = name => (byRound || []).map(r => {
    const p = (r.results || []).find(x => x.playerA?.name === name || x.playerB?.name === name);
    if (!p) return null;
    const me = p.playerA?.name === name ? p.playerA : p.playerB, them = p.playerA?.name === name ? p.playerB : p.playerA;
    return { round: r.round, mine: me?.price, rival: them?.price, profit: me?.profit };
  }).filter(Boolean);
  const NameCell = ({ name, side, round }) => {
    const rows = priceRows(name);
    return (
      <td className={`nm ${side}`}>
        <span className="an-name">{name}
          {rows.length > 0 && (
            <span className="an-tip">
              <b>{name}</b>
              <table><thead><tr><th>Round</th><th>Price</th><th>Rival</th><th>Profit</th></tr></thead>
                <tbody>{rows.map(x => <tr key={x.round} className={x.round === round ? 'cur' : ''}><td>{x.round}</td><td>{priceFmt(x.mine, config)}</td><td>{priceFmt(x.rival, config)}</td><td>{money(x.profit)}</td></tr>)}</tbody>
              </table>
            </span>
          )}
        </span>
      </td>
    );
  };
  // after the AI review: the announcements it found illegal are highlighted (Mert, 2026-11-16) = the lines it quoted,
  // of the station(s) that crossed the line
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const resultOf = e => (review?.results || []).find(r => r.pairId === e.pairId || (r.nameA === e.nameA && r.nameB === e.nameB));
  const illegal = (e, st) => {
    const r = resultOf(e);
    if (!r || r.verdict !== 'Illegal') return false;
    // the AI's full list of illegal lines; a review saved before that list existed falls back to its quoted lines
    const lines = (r.illegal || []).length ? r.illegal : (r.evidence || []).filter(x => r.crossedBy === 'both' || x.station === r.crossedBy);
    return lines.some(x => x.station === st && Number(x.round) === Number(e.round) && norm(x.text) === norm(e[st]));
  };
  // the tag is the round's: Illegal on a round with an illegal announcement, Legal for a pair found legal
  const pairTag = e => { const r = resultOf(e); if (!r?.verdict) return null; const bad = illegal(e, 'A') || illegal(e, 'B');
    return bad ? <span className="an-tag bad">Illegal</span> : r.verdict === 'Legal' ? <span className="an-tag good">Legal</span> : null; };
  const rounds = [...new Set((log || []).map(e => e.round))].sort((a, b) => b - a);
  const match = e => !q || `${e.nameA} ${e.nameB} ${e.A} ${e.B}`.toLowerCase().includes(q.toLowerCase());
  // the pair's total profit over the game: both stations added up (Mert, 2026-11-17)
  const pairProfit = e => (byRound || []).reduce((sum, r) => {
    const p = (r.results || []).find(x => [x.playerA?.name, x.playerB?.name].includes(e.nameA) && [x.playerA?.name, x.playerB?.name].includes(e.nameB));
    return sum + (Number(p?.playerA?.profit) || 0) + (Number(p?.playerB?.profit) || 0);
  }, 0);
  // views and sorting (Mert, 2026-11-17): by round (sorting inside each round) or by pair; sort by verdict or total profit
  const [view, setView] = useState('round');
  const [sort, setSort] = useState({ key: null, dir: -1 });
  const sortBy = key => setSort(s => (s.key === key ? { key, dir: -s.dir } : { key, dir: -1 }));
  const arrow = key => (sort.key === key ? (sort.dir < 0 ? ' ▼' : ' ▲') : '');
  const verdictRank = e => { const r = resultOf(e); const bad = illegal(e, 'A') || illegal(e, 'B'); return r?.verdict === 'Illegal' ? (bad ? 3 : 2) : r?.verdict === 'Legal' ? 1 : 0; };
  const pairRank = e => { const r = resultOf(e); return r?.verdict === 'Illegal' ? 2 : r?.verdict === 'Legal' ? 1 : 0; };
  const order = (list, rank) => {
    if (!sort.key) return list;
    const val = sort.key === 'profit' ? pairProfit : rank;
    return [...list].sort((x, y) => sort.dir * (val(x) - val(y)) || pairProfit(y) - pairProfit(x));
  };
  const textCell = (e, st) => <td className={`tx${illegal(e, st) ? ' ill' : ''}`}>{e[st] ? `"${e[st]}"` : <i>No announcement</i>}</td>;
  const head = withRound => (
    <thead><tr>
      {withRound && <th className="rd">Round</th>}
      <th className="nm">Station A</th><th className="tx">Announcement</th><th className="nm">Station B</th><th className="tx">Announcement</th>
      <th className="vt srt" onClick={() => sortBy('verdict')}>Verdict{arrow('verdict')}</th>
      <th className="pf srt" onClick={() => sortBy('profit')}>Total profit{arrow('profit')}</th>
    </tr></thead>
  );
  // the pairs, in the order of their first appearance, each with its rounds
  const pairsList = [...new Map((log || []).map(e => [e.pairId, e])).values()];
  const roundsOf = pe => (log || []).filter(e => e.pairId === pe.pairId).sort((a, b) => a.round - b.round);
  const pairVerdict = pe => { const r = resultOf(pe); return r?.verdict ? <span className={`an-tag ${r.verdict === 'Illegal' ? 'bad' : 'good'}`}>{r.verdict}</span> : null; };
  return (
    <section className="panel wide announcements" id="announcements-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div className="section-label">Announcements</div>
          <div className="an-views">
            <button className={view === 'round' ? 'on' : ''} id="an-view-round" onClick={() => setView('round')}>By round</button>
            <button className={view === 'pair' ? 'on' : ''} id="an-view-pair" onClick={() => setView('pair')}>By pair</button>
          </div>
        </div>
        <input className="search" placeholder="Find a name or a word" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {rounds.length === 0 ? <div className="empty-note">{status === 'running' ? 'The first announcements appear here when they are revealed.' : 'Appears when the first announcements are revealed.'}</div>
        : view === 'round' ? rounds.map(r => (
          <div key={r}>
            <div className="an-round">Round {r}</div>
            <table className="res an-table">
              {head(false)}
              <tbody>
                {order((log || []).filter(e => e.round === r && match(e)), verdictRank).map(e => (
                  <tr key={e.pairId}>
                    <NameCell name={e.nameA} side="a" round={e.round} />{textCell(e, 'A')}
                    <NameCell name={e.nameB} side="b" round={e.round} />{textCell(e, 'B')}
                    <td className="vt">{pairTag(e)}</td>
                    <td className="pf">{money(pairProfit(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )) : (
          <table className="res an-table an-pairs">
            {head(true)}
            {order(pairsList.filter(pe => roundsOf(pe).some(match)), pairRank).map(pe => (
              <tbody key={pe.pairId} className="an-pair-block">
                {roundsOf(pe).map((e, k) => (
                  <tr key={e.round}>
                    <td className="rd">{e.round}</td>
                    <NameCell name={e.nameA} side="a" round={e.round} />{textCell(e, 'A')}
                    <NameCell name={e.nameB} side="b" round={e.round} />{textCell(e, 'B')}
                    {k === 0 && <td className="vt" rowSpan={roundsOf(pe).length}>{pairVerdict(pe)}</td>}
                    {k === 0 && <td className="pf" rowSpan={roundsOf(pe).length}>{money(pairProfit(pe))}</td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
    </section>
  );
}

// the review's header, its line and the four boxes, on top of Game results (Mert, 2026-11-17)
function ReviewSummary({ review, pairTotals, status, onRerun, mode = 'chat' }) {
  const results = review?.results || [];
  const running = review?.status === 'running';
  const pairOf = r => pairTotals.find(p => p.key === r.pairId || p.key === [r.nameA, r.nameB].sort().join(' | '));
  const mean = (rows, f) => { const v = rows.flatMap(r => { const p = pairOf(r); return p ? f(p) : []; }).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const ill = results.filter(r => r.verdict === 'Illegal'), leg = results.filter(r => r.verdict === 'Legal'), failed = results.filter(r => !r.verdict);
  const price = rows => mean(rows, p => [...p.pricesA, ...p.pricesB]), profit = rows => mean(rows, p => [p.a, p.b]);
  const fmt = v => (v == null ? '-' : '$' + v.toFixed(2));
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="section-label">AI legal review of the {mode === 'announce' ? 'announcements' : 'chats'}</div>
        {status === 'complete' && !running && <button className="btn" onClick={onRerun}>Review again</button>}
      </div>
      <div className="qtext">Each pair's {mode === 'announce' ? 'announcements' : 'chat'}, judged by the AI against U.S. antitrust law (the Sherman Act and the FTC's rule on invitations to collude). The AI legal review tab has every pair with the AI's reasoning. Students see their own pair's verdict on the phone.</div>
      {running && <div className="fb info">Reviewing: {review.done} of {review.total} pairs done</div>}
      <div className="rv-stats">
        <div className="rv-box bad"><div className="n">{ill.length}</div><div className="l">Illegal</div></div>
        <div className="rv-box good"><div className="n">{leg.length}</div><div className="l">Legal</div></div>
        {failed.length > 0 && <div className="rv-box"><div className="n">{failed.length}</div><div className="l">Not reviewed</div></div>}
        <div className="rv-box"><div className="n">{fmt(price(ill))} <small>vs</small> {fmt(price(leg))}</div><div className="l">Average price, illegal vs legal markets</div></div>
        <div className="rv-box"><div className="n">{profit(ill) == null ? '-' : money(profit(ill))} <small>vs</small> {profit(leg) == null ? '-' : money(profit(leg))}</div><div className="l">Total profit per station, illegal vs legal</div></div>
      </div>
    </>
  );
}

function ReviewPanel({ review, pairTotals, status, onRerun, mode = 'chat' }) {
  const [open, setOpen] = useState(null);
  const results = review?.results || [];
  const running = review?.status === 'running';
  const pairOf = r => pairTotals.find(p => p.key === r.pairId || p.key === [r.nameA, r.nameB].sort().join(' | '));
  const meanPrice = rows => {
    const v = rows.flatMap(r => { const p = pairOf(r); return p ? [...p.pricesA, ...p.pricesB] : []; }).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const meanProfit = rows => {
    const v = rows.flatMap(r => { const p = pairOf(r); return p ? [p.a, p.b] : []; }).filter(Number.isFinite);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const ill = results.filter(r => r.verdict === 'Illegal'), leg = results.filter(r => r.verdict === 'Legal'), failed = results.filter(r => !r.verdict);
  const order = [...ill, ...failed, ...leg];
  const nameOf = (r, st) => (st === 'A' ? r.nameA : r.nameB);
  const crossed = r => (r.crossedBy === 'both' ? 'Both' : r.crossedBy === 'A' ? r.nameA : r.crossedBy === 'B' ? r.nameB : '');
  const fmt = v => (v == null ? '-' : '$' + v.toFixed(2));
  return (
    <section className="panel wide review">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="section-label">AI legal review of the {mode === 'announce' ? 'announcements' : 'chats'}</div>
        {status === 'complete' && !running && review && <button className="btn" onClick={onRerun}>Review again</button>}
      </div>
      <div className="qtext">Each pair's {mode === 'announce' ? 'announcements' : 'chat'}, judged by the AI against U.S. antitrust law (the Sherman Act and the FTC's rule on invitations to collude). Click a pair for the AI's reasoning and the whole {mode === 'announce' ? 'set of announcements' : 'chat'}. Students see their own pair's verdict on the phone.</div>
      {status !== 'complete' ? <div className="empty-note">Runs when the game ends.</div>
      : !review || review.status === 'none' ? <div className="empty-note">Starting the review...</div> : (
        <>
          {running && <div className="fb info" id="review-progress">Reviewing: {review.done} of {review.total} pairs done</div>}
          <div className="rv-stats">
            <div className="rv-box bad"><div className="n">{ill.length}</div><div className="l">Illegal</div></div>
            <div className="rv-box good"><div className="n">{leg.length}</div><div className="l">Legal</div></div>
            {failed.length > 0 && <div className="rv-box"><div className="n">{failed.length}</div><div className="l">Not reviewed</div></div>}
            <div className="rv-box"><div className="n">{fmt(meanPrice(ill))} <small>vs</small> {fmt(meanPrice(leg))}</div><div className="l">Average price, illegal vs legal markets</div></div>
            <div className="rv-box"><div className="n">{meanProfit(ill) == null ? '-' : money(meanProfit(ill))} <small>vs</small> {meanProfit(leg) == null ? '-' : money(meanProfit(leg))}</div><div className="l">Total profit per station, illegal vs legal</div></div>
          </div>
          <div>
            <table className="res rv-table">
              <thead><tr><th>Pair</th><th>Verdict</th><th>Crossed the line</th><th>Why: the sentences that decide it</th></tr></thead>
              <tbody>
                {order.map(r => (
                  <React.Fragment key={r.pairId}>
                    <tr className={`rv-row ${r.verdict === 'Illegal' ? 'bad' : r.verdict === 'Legal' ? 'good' : ''}`} onClick={() => setOpen(open === r.pairId ? null : r.pairId)}>
                      <td>{r.nameA}<br />{r.nameB}</td>
                      <td><div className="v">{r.verdict || 'Not reviewed'}</div><div className="rule">{r.rule || ''}</div></td>
                      <td>{crossed(r)}</td>
                      {/* short: the quoted sentences; the AI's full reason opens with the row */}
                      <td className="why">{(r.evidence || []).length ? r.evidence.map((e, i) => <div key={i} className="said"><span>{nameOf(r, e.station)}:</span> "{e.text}"</div>)
                        : <span className="none">{r.error || ((r.messages || []).length ? 'Nothing about prices' : 'No messages')}</span>}</td>
                    </tr>
                    {open === r.pairId && (
                      <tr className="rv-open"><td colSpan={4}>
                        {/* the AI writes Station A / B (it never sees names); here the names go back in */}
                        {r.reason && <div className="rv-reason"><b>The AI's reasoning</b>{r.reason.replace(/Station A\b/g, r.nameA).replace(/Station B\b/g, r.nameB)}</div>}
                        <div className="rv-chat"><b>{mode === 'announce' ? 'All announcements' : 'The whole chat'}</b>{(r.messages || []).length === 0 ? <div>{mode === 'announce' ? 'No announcements.' : 'No messages.'}</div> : r.messages.map((m, i) => <div key={i} className={m.station === 'A' ? 'a' : 'b'}><span>R{m.round} {nameOf(r, m.station)}</span>{m.text}</div>)}</div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {review.law && <details className="rv-law"><summary>The law the AI applied</summary><LawText text={review.law} /></details>}
        </>
      )}
    </section>
  );
}
