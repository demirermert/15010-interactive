import React, { useState, useEffect, useRef } from 'react';
import { RoundsChart, Street } from '../charts.jsx';
import { money, pct, roundTimeFor, parsePrice, priceFmt, qty, kfmt, moneyK } from '../econ.js';

// true on a phone-width screen (the rounds table then uses short figures and short headings so it needs no sideways scroll)
function useNarrow(px = 560) {
  const query = `(max-width:${px}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const onChange = e => setNarrow(e.matches);
    m.addEventListener('change', onChange);
    return () => m.removeEventListener('change', onChange);
  }, [query]);
  return narrow;
}

// The student page in the 2026 lab look (2026-11-02; the 2025 page is in git history). Since 2026-11-10 the two
// players run gas stations on a road and pay a wholesale cost per gallon (Mert).
// Left: this round (the price box, then the round's result). Right: the market and every round so far.

const fmtSmall = v => '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });

function Rules({ config }) {
  const hot = config?.modelType === 'hotelling';
  const rounds = config?.hideRoundCount
    ? 'The game runs for several rounds, and you do not know how many.'
    : `You'll play for ${config?.rounds || 'several'} rounds.`;
  const t = config?.roundTime;
  const secs = Array.isArray(t) ? null : t;
  const cost = Number(config?.marginalCost) || 0;
  return (
    <div className="story">
      <p>You and another student each run a gas station on the same road. {rounds}</p>
      <p>Each round, you and your rival <b>set your price per gallon at the same time</b>{secs ? <>, within <b>{secs} seconds</b></> : null}.
        Drivers along the road fill up where it is cheapest for them, counting the price at the pump and the drive to get
        there: a lower price wins more drivers, but you earn less on each gallon.</p>
      <p><b>Your wholesale cost is {priceFmt(cost, config)} per gallon</b>, the same for your rival: every gallon you sell costs
        you that much, so profit = (your price − {priceFmt(cost, config)}) × gallons sold.</p>
      <p><b>Your goal:</b> the most total profit over all rounds, not the most gallons.</p>
      <p>After each round you see your rival's price, both market shares and both profits.</p>
      {hot && config?.showModelParameters && (
        <p>Drivers live along a road from 0 to 100. A gallon is worth <b>{priceFmt(config.consumerValue, config)}</b> to each of them,
          and driving costs <b>{fmtSmall(config.travelCost)}</b> per unit of road.</p>
      )}
      <p style={{ color: '#8a1c2c' }}><b>No communication with your rival.</b></p>
    </div>
  );
}

export function StudentView({
  sessionCode,
  sessionStatus,
  currentRound,
  roundActive,
  timer,
  priceBounds,
  onSubmitPrice,
  latestResult,
  history,
  hasSubmitted,
  nextRoundCountdown,
  session,
  leaderboard,
  chatMessages,
  onSendChatMessage,
  currentSocketId,
  opponentName,
  playerName,
  playerId,
  side,
  roundTime,
  spectator,
  acceptedPrice,
  errorMessage,
  onDismissError
}) {
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const inputRef = useRef(null);
  const config = session?.config;

  useEffect(() => {
    setPrice('');
    setError('');
    setSent(null);
  }, [currentRound]);

  useEffect(() => {
    if (roundActive && !hasSubmitted && inputRef.current) inputRef.current.focus();
  }, [roundActive, hasSubmitted]);

  const handleSubmit = event => {
    event.preventDefault();
    const numeric = parsePrice(price); // the box is a text box: a number box swallowed commas (2026-11-08)
    if (!Number.isFinite(numeric)) {
      setError(String(price).trim() === '' ? 'Enter a price.' : 'That is not a number. Type digits only, with a point or a comma for cents (for example 35.50).');
      return;
    }
    if (numeric < priceBounds.min || numeric > priceBounds.max) {
      setError(`The price must be between ${priceFmt(priceBounds.min, config)} and ${priceFmt(priceBounds.max, config)}.`);
      return;
    }
    setError('');
    setSent(numeric);
    onSubmitPrice(numeric);
  };

  const rounds = config?.rounds || 0;
  const hide = config?.hideRoundCount;
  const fullTime = roundTime || roundTimeFor(config, currentRound);
  const low = timer <= 5;
  const narrow = useNarrow();
  const played = history || [];
  const total = played.reduce((s, h) => s + (h.profit || 0), 0);
  const rivalTotal = played.reduce((s, h) => s + (h.opponentProfit || 0), 0);
  // the game-over figures (Mert, 2026-11-10): gallons over the game, the average share of the road, average prices, rounds won
  const avg = arr => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : NaN);
  const myGallons = played.reduce((s, h) => s + (h.demand || 0), 0), rivalGallons = played.reduce((s, h) => s + (h.opponentDemand || 0), 0);
  const myAvgShare = avg(played.map(h => h.share || 0)), rivalAvgShare = avg(played.map(h => h.opponentShare || 0));
  const myAvgPrice = avg(played.map(h => h.price)), rivalAvgPrice = avg(played.map(h => h.opponentPrice));
  const roundsWon = played.filter(h => h.profit > h.opponentProfit).length, roundsLost = played.filter(h => h.profit < h.opponentProfit).length;
  const me = playerName || history?.[0]?.name;
  const rank = leaderboard?.length ? leaderboard.findIndex(r => (playerId ? r.playerId === playerId : r.name === me)) + 1 : 0;
  const rivalLabel = config?.showOpponentName && opponentName ? opponentName : 'Rival';
  // Seller A stands at x1 and seller B at x2; the server says which seat I have
  const iAmB = side === 'B';
  const myX = config?.modelType === 'hotelling' ? (iAmB ? config.x2 : config.x1) : 0;
  const rivalX = config?.modelType === 'hotelling' ? (iAmB ? config.x1 : config.x2) : 100;
  const between = sessionStatus === 'running' && !roundActive && latestResult;

  const steps = !hide && rounds > 0 && rounds <= 20 ? (
    <div className="steps">
      {Array.from({ length: rounds }, (_, i) => {
        const r = i + 1;
        const cls = r < currentRound || (r === currentRound && !roundActive && latestResult?.round === r)
          ? 'done' : r === currentRound ? 'cur' : '';
        return <span key={r} className={cls}>{r}</span>;
      })}
    </div>
  ) : null;

  // compact header (Mert, 2026-11-10): the title and the class on the left, the logo top right, the round dots on
  // their own line on a phone; the name and the session code sit in the subtitle
  const header = (
    <header className="lab-head">
      <div className="hin compact">
        <div className="ttl">
          <h1>Pricing Game</h1>
          <div className="sub">15.010 &middot; Class 13 &middot; session <b>{sessionCode}</b> &middot; {me || 'Student'}</div>
        </div>
        {steps}
        <img className="logo" src="/course-logo.png" alt="15.010" />
      </div>
    </header>
  );

  // the left card
  let left;
  if (!sessionStatus || sessionStatus === 'setup' || sessionStatus === 'lobby') {
    left = (
      <div className="card">
        <div className="case">Waiting to start</div>
        <div className="qt">You're in. The game starts when your instructor starts it.</div>
        <Rules config={config} />
      </div>
    );
  } else if (sessionStatus === 'complete') {
    // the game-over card in the shape of the round-result card (Mert, 2026-11-10): both totals large, the average
    // market shares as a bar, then one table for both stations
    const s1 = Math.max(0, Math.min(1, myAvgShare || 0)), s2 = Math.max(0, Math.min(1, rivalAvgShare || 0));
    left = (
      <div className="card">
        <div className="case">Game over</div>
        <div className="qt">{total > rivalTotal ? 'You out-earned your rival over the game' : total < rivalTotal ? 'Your rival earned more over the game' : 'You and your rival earned the same'}</div>
        <div className="res2">
          <div className="box you"><div className="lbl">Your total profit</div><div className="num" style={total < 0 ? { color: 'var(--rival)' } : undefined}>{money(total)}</div></div>
          <div className="box rival"><div className="lbl">{rivalLabel}'s total profit</div><div className="num">{money(rivalTotal)}</div></div>
        </div>
        {played.length > 0 && (
          <>
            <div className="sharebar" role="img" aria-label={`average market shares: you ${pct(myAvgShare)}, rival ${pct(rivalAvgShare)}`}>
              <i className="you" style={{ width: `${s1 * 100}%` }} /><i className="rival" style={{ width: `${s2 * 100}%` }} />
            </div>
            <div className="sharelbl"><span className="you">You {pct(myAvgShare)}</span><span className="rival">{rivalLabel} {pct(rivalAvgShare)}</span></div>
            <table className="hist res" style={{ marginTop: 10 }}>
              <thead><tr><th /><th className="you">You</th><th className="rival">{rivalLabel}</th></tr></thead>
              <tbody>
                <tr><td>Total profit</td><td className="you">{money(total)}</td><td className="rival">{money(rivalTotal)}</td></tr>
                <tr><td>Average price</td><td>{priceFmt(myAvgPrice, config)}</td><td>{priceFmt(rivalAvgPrice, config)}</td></tr>
                <tr><td>Gallons sold</td><td>{qty(myGallons)}</td><td>{qty(rivalGallons)}</td></tr>
                <tr><td>Market share, average</td><td>{pct(myAvgShare)}</td><td>{pct(rivalAvgShare)}</td></tr>
                <tr><td>Rounds won</td><td>{roundsWon} of {played.length}</td><td>{roundsLost} of {played.length}</td></tr>
              </tbody>
            </table>
          </>
        )}
        {rank > 0 && <div className="fb info">You placed <b>{rank}</b> of {leaderboard.length} in the class by total profit.</div>}
      </div>
    );
  } else if (spectator) {
    left = (
      <div className="card">
        <div className="case">Sitting this one out</div>
        <div className="qt">Your phone was offline when the game started, so you have no rival this game.</div>
        <div className="hint">Stay on this page: you can watch, and you will be in the next game.</div>
        {errorMessage && <div className="fb no" onClick={onDismissError}>{errorMessage}</div>}
      </div>
    );
  } else if (roundActive) {
    const done = hasSubmitted;
    left = (
      <div className="card">
        <div className="case">Round {currentRound}{!hide && rounds ? ` of ${rounds}` : ''}</div>
        <div className="qt">{done ? 'Your price is in' : 'Set your price'}</div>
        <div className="clock"><span className={`s${low ? ' low' : ''}`}>{Math.max(0, timer)}s</span><span className="l">left in this round</span></div>
        <div className={`bar${low ? ' low' : ''}`}><i style={{ width: `${Math.max(0, Math.min(100, (timer / (fullTime || 1)) * 100))}%` }} /></div>
        <form onSubmit={handleSubmit}>
          <div className="pin">
            <span>$</span>
            <input ref={inputRef} type="text" inputMode="decimal" autoComplete="off" value={done && price === '' && (acceptedPrice ?? sent) != null ? (acceptedPrice ?? sent) : price}
              onChange={e => setPrice(e.target.value)} disabled={done} placeholder="0" aria-label="Your price" />
          </div>
          <div className="hint">Price per gallon, between {priceFmt(priceBounds.min, config)} and {priceFmt(priceBounds.max, config)}.
 If you don't submit in time, the game picks a random price for you.</div>
          <div className="fb info">Your wholesale cost is <b>{priceFmt(Number(config?.marginalCost) || 0, config)}</b> per gallon.
 Profit = (price − {priceFmt(Number(config?.marginalCost) || 0, config)}) × gallons sold.</div>
          {!done && <button className="go" type="submit">Submit price</button>}
        </form>
        {error && <div className="fb no">{error}</div>}
        {errorMessage && <div className="fb no" onClick={onDismissError}>{errorMessage}</div>}
        {/* the server's figure (kept to the cent) once it has answered, the typed one until then */}
        {done && !errorMessage && <div className="fb ok">Submitted{(acceptedPrice ?? sent) != null ? <> at <b>{priceFmt(acceptedPrice ?? sent, config)}</b> per gallon</> : null}. Results appear when the clock runs out.</div>}
      </div>
    );
  } else if (between) {
    // the round's result (Mert, 2026-11-10: "more organized and visible"): the two profits large, a market-share bar,
    // then one table with both stations side by side and the totals so far
    const r = latestResult;
    const win = r.profit > r.opponentProfit, lose = r.profit < r.opponentProfit;
    const myShare = Math.max(0, Math.min(1, r.share || 0)), rivalShare = Math.max(0, Math.min(1, r.opponentShare || 0));
    left = (
      <div className="card">
        <div className="case">Round {r.round} result</div>
        <div className="qt">{win ? 'You out-earned your rival this round' : lose ? 'Your rival earned more this round' : 'You and your rival earned the same'}</div>
        <div className="res2">
          <div className="box you"><div className="lbl">Your profit</div><div className="num" style={r.profit < 0 ? { color: 'var(--rival)' } : undefined}>{money(r.profit)}</div></div>
          <div className="box rival"><div className="lbl">{rivalLabel}'s profit</div><div className="num">{money(r.opponentProfit)}</div></div>
        </div>
        <div className="sharebar" role="img" aria-label={`market shares: you ${pct(r.share)}, rival ${pct(r.opponentShare)}`}>
          <i className="you" style={{ width: `${myShare * 100}%` }} /><i className="rival" style={{ width: `${rivalShare * 100}%` }} />
        </div>
        <div className="sharelbl"><span className="you">You {pct(r.share)}</span><span className="rival">{rivalLabel} {pct(r.opponentShare)}</span></div>
        <table className="hist res" style={{ marginTop: 10 }}>
          <thead><tr><th /><th className="you">You</th><th className="rival">{rivalLabel}</th></tr></thead>
          <tbody>
            <tr><td>Price per gallon</td><td className="you">{priceFmt(r.price, config)}</td><td className="rival">{priceFmt(r.opponentPrice, config)}</td></tr>
            <tr><td>Gallons sold</td><td>{qty(r.demand)}</td><td>{qty(r.opponentDemand)}</td></tr>
            <tr><td>Market share</td><td>{pct(r.share)}</td><td>{pct(r.opponentShare)}</td></tr>
            <tr><td>Profit this round</td><td className="you">{money(r.profit)}</td><td className="rival">{money(r.opponentProfit)}</td></tr>
            <tr className="tot"><td>Total so far</td><td>{money(total)}</td><td>{money(rivalTotal)}</td></tr>
          </tbody>
        </table>
        {nextRoundCountdown != null && nextRoundCountdown > 0 && (
          <div className="fb info">Next round in <b>{nextRoundCountdown}s</b>.</div>
        )}
      </div>
    );
  } else {
    left = (
      <div className="card">
        <div className="case">Round {currentRound || 1}</div>
        <div className="qt">Get ready</div>
        {nextRoundCountdown != null && <div className="fb info">Next round in <b>{nextRoundCountdown}s</b>.</div>}
      </div>
    );
  }

  // the right panel
  const hist = history || [];
  const nShown = Math.max(hist.length, hide ? hist.length : rounds, 1);
  const right = (
    <div className="stack">
      {config?.modelType === 'hotelling' && (
        <div className="card">
          <div className="gname">Your market</div>
          <Street x1={myX} x2={rivalX} />
          <div className="hint">Drivers live along the road and fill up at the station that leaves them the most: what a
            gallon is worth to them, minus its price, minus the drive. If both are too costly, they don't buy.</div>
        </div>
      )}
      <div className="card">
        <div className="gname">Your rounds</div>
        {hist.length === 0 ? (
          <div className="hint">Your results appear here after the first round.</div>
        ) : (
          <>
            <RoundsChart rounds={nShown} height={220} yLabel="Price ($ per gallon)" series={[
              { label: 'You', color: '#1F2E5C', values: Array.from({ length: nShown }, (_, i) => hist[i]?.price ?? null) },
              { label: rivalLabel, color: '#A31F34', values: Array.from({ length: nShown }, (_, i) => hist[i]?.opponentPrice ?? null), width: 2 }
            ]} />
            <div className="legend"><span><i style={{ background: '#1F2E5C' }} />Your price</span><span><i style={{ background: '#A31F34' }} />{rivalLabel}'s price</span></div>
            {/* on a phone: short headings and K figures, so the six columns fit without sideways scrolling (Mert, 2026-11-10) */}
            <div style={{ overflowX: 'auto' }}>
            <table className="hist rounds" style={{ marginTop: 12 }}>
              <thead><tr>
                <th>{narrow ? '#' : 'Round'}</th><th>You</th><th>{narrow ? 'Rival' : rivalLabel}</th>
                <th>{narrow ? 'Gallons' : 'Your gallons'}</th><th>{narrow ? 'Profit' : 'Your profit'}</th><th>{narrow ? 'Rival profit' : `${rivalLabel}'s profit`}</th>
              </tr></thead>
              <tbody>
                {hist.map(h => (
                  <tr key={h.round} className={latestResult?.round === h.round && !roundActive ? 'cur' : ''}>
                    <td>{h.round}</td>
                    <td className="you">{priceFmt(h.price, config)}</td>
                    <td className="rival">{priceFmt(h.opponentPrice, config)}</td>
                    <td>{narrow ? kfmt(h.demand) : `${qty(h.demand)} (${pct(h.share)})`}</td>
                    <td>{narrow ? moneyK(h.profit) : money(h.profit)}</td>
                    <td>{narrow ? moneyK(h.opponentProfit) : money(h.opponentProfit)}</td>
                  </tr>
                ))}
                <tr className="tot"><td>Total</td><td /><td /><td>{narrow ? kfmt(myGallons) : qty(myGallons)}</td><td style={{ color: 'var(--ok)' }}>{narrow ? moneyK(total) : money(total)}</td><td>{narrow ? moneyK(rivalTotal) : money(rivalTotal)}</td></tr>
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
      {config?.enableChat && (
        <div className="card">
          <div className="gname">Chat with your rival</div>
          <div className="chat">
            {(chatMessages || []).map((m, i) => (
              <div key={i} className={`m${m.fromSocketId === currentSocketId ? ' me' : ''}`}>{m.message}</div>
            ))}
          </div>
          <form className="chatrow" onSubmit={e => { e.preventDefault(); if (chatInput.trim()) { onSendChatMessage(chatInput.trim()); setChatInput(''); } }}>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Message" />
            <button type="submit">Send</button>
          </form>
        </div>
      )}
      {sessionStatus !== 'running' && sessionStatus !== 'complete' ? null : (
        <div className="card">
          <div className="gname">How it works</div>
          <Rules config={config} />
        </div>
      )}
    </div>
  );

  return (
    <div className="lab">
      {header}
      <main>
        <div id="qcard">{left}</div>
        {right}
      </main>
    </div>
  );
}
