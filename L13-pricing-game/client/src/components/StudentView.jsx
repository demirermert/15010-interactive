import React, { useState, useEffect, useRef } from 'react';
import { RoundsChart, Street } from '../charts.jsx';
import { money, pct, roundTimeFor } from '../econ.js';

// The student page in the 2026 lab look (2026-11-02; the 2025 page is in git history).
// Left: this round (the price box, then the round's result). Right: the market and every round so far.

function Rules({ config }) {
  const hot = config?.modelType === 'hotelling';
  const rounds = config?.hideRoundCount
    ? 'The game runs for several rounds, and you do not know how many.'
    : `You'll play for ${config?.rounds || 'several'} rounds.`;
  const t = config?.roundTime;
  const secs = Array.isArray(t) ? null : t;
  return (
    <div className="story">
      <p>You are paired with another student and you both sell a drink. {rounds}</p>
      <p>Each round, you and your rival <b>set prices at the same time</b>{secs ? <>, within <b>{secs} seconds</b></> : null}.
        The products are similar but differentiated: lower prices attract more customers, but you earn less on each one.</p>
      <p><b>Your goal:</b> the most total profit over all rounds, not the biggest market share. Marginal cost is zero,
        so profit is price times quantity.</p>
      <p>After each round you see your rival's price, both market shares and both profits.</p>
      {hot && config?.showModelParameters && (
        <p>Customers live along a street from 0 to 100. Each is worth <b>{money(config.consumerValue)}</b> and pays
          <b> {money(config.travelCost)}</b> per unit of distance to reach a seller.</p>
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
    const numeric = Number(price);
    if (price === '' || !Number.isFinite(numeric)) {
      setError('Enter a price.');
      return;
    }
    if (numeric < priceBounds.min || numeric > priceBounds.max) {
      setError(`The price must be between ${money(priceBounds.min)} and ${money(priceBounds.max)}.`);
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
  const total = (history || []).reduce((s, h) => s + (h.profit || 0), 0);
  const rivalTotal = (history || []).reduce((s, h) => s + (h.opponentProfit || 0), 0);
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

  const header = (
    <header className="lab-head">
      <div className="hin">
        <img src="/course-logo.png" alt="15.010" />
        <div>
          <h1>Pricing Game</h1>
          <div className="sub">15.010 Class 13 &middot; price competition, round after round</div>
        </div>
        {steps}
        <div className="who">
          <div className="names">{me || 'Student'}</div>
          <div>session <b>{sessionCode}</b></div>
        </div>
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
    left = (
      <div className="card">
        <div className="case">Game over</div>
        <div className="qt">Your total profit</div>
        <div className="total">{money(total)}</div>
        <div className="hint">Your rival made {money(rivalTotal)} in the same market.</div>
        {rank > 0 && <div className="fb info">You placed <b>{rank}</b> of {leaderboard.length}.</div>}
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
            <input ref={inputRef} type="number" inputMode="decimal" step="any" value={done && price === '' && (sent ?? acceptedPrice) != null ? (sent ?? acceptedPrice) : price}
              onChange={e => setPrice(e.target.value)} disabled={done} placeholder="0" aria-label="Your price" />
          </div>
          <div className="hint">Between {money(priceBounds.min)} and {money(priceBounds.max)}.
 If you don't submit in time, the game picks a random price for you.</div>
          {!done && <button className="go" type="submit">Submit price</button>}
        </form>
        {error && <div className="fb no">{error}</div>}
        {errorMessage && <div className="fb no" onClick={onDismissError}>{errorMessage}</div>}
        {done && !errorMessage && <div className="fb ok">Submitted{(sent ?? acceptedPrice) != null ? <> at <b>{money(sent ?? acceptedPrice, Number.isInteger(sent ?? acceptedPrice) ? 0 : 2)}</b></> : null}. Results appear when the clock runs out.</div>}
      </div>
    );
  } else if (between) {
    const r = latestResult;
    left = (
      <div className="card">
        <div className="case">Round {r.round} result</div>
        <div className="qt">{r.profit > r.opponentProfit ? 'You out-earned your rival this round' : r.profit < r.opponentProfit ? 'Your rival earned more this round' : 'You and your rival earned the same'}</div>
        <div className="vs">
          <div className="side you">
            <div className="who2">You</div>
            <div className="k">Price</div><div className="v">{money(r.price, Number.isInteger(r.price) ? 0 : 2)}</div>
            <div className="k">Market share</div><div className="v">{pct(r.share)}</div>
            <div className="k">Profit</div><div className="v big" style={{ color: 'var(--ok)' }}>{money(r.profit)}</div>
          </div>
          <div className="side rival">
            <div className="who2">{rivalLabel}</div>
            <div className="k">Price</div><div className="v">{money(r.opponentPrice, Number.isInteger(r.opponentPrice) ? 0 : 2)}</div>
            <div className="k">Market share</div><div className="v">{pct(r.opponentShare)}</div>
            <div className="k">Profit</div><div className="v big">{money(r.opponentProfit)}</div>
          </div>
        </div>
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
          {/* the walking cost is what differs between the three games (2026-11-07), so it is always shown */}
          <div className="hint" style={{ fontWeight: 600, color: '#1F2E5C' }}>
            {Number(config.travelCost) > 0
              ? <>Walking costs {money(config.travelCost, 2)} per block.</>
              : <>Walking is free: customers simply buy from the cheaper seller.</>}
          </div>
          <div className="hint">Customers live along the street and buy from the seller that leaves them the most: what the
            drink is worth to them, minus its price, minus the walk. If both are too costly, they buy nothing.</div>
        </div>
      )}
      <div className="card">
        <div className="gname">Your rounds</div>
        {hist.length === 0 ? (
          <div className="hint">Your results appear here after the first round.</div>
        ) : (
          <>
            <RoundsChart rounds={nShown} height={220} series={[
              { label: 'You', color: '#1F2E5C', values: Array.from({ length: nShown }, (_, i) => hist[i]?.price ?? null) },
              { label: rivalLabel, color: '#A31F34', values: Array.from({ length: nShown }, (_, i) => hist[i]?.opponentPrice ?? null), width: 2 }
            ]} />
            <div className="legend"><span><i style={{ background: '#1F2E5C' }} />Your price</span><span><i style={{ background: '#A31F34' }} />{rivalLabel}'s price</span></div>
            <div style={{ overflowX: 'auto' }}>
            <table className="hist" style={{ marginTop: 12 }}>
              <thead><tr><th>Round</th><th>You</th><th>{rivalLabel}</th><th>Your share</th><th>Your profit</th><th>{rivalLabel}'s profit</th></tr></thead>
              <tbody>
                {hist.map(h => (
                  <tr key={h.round} className={latestResult?.round === h.round && !roundActive ? 'cur' : ''}>
                    <td>{h.round}</td>
                    <td className="you">{money(h.price, Number.isInteger(h.price) ? 0 : 2)}</td>
                    <td className="rival">{money(h.opponentPrice, Number.isInteger(h.opponentPrice) ? 0 : 2)}</td>
                    <td>{pct(h.share)}</td>
                    <td>{money(h.profit)}</td>
                    <td>{money(h.opponentProfit)}</td>
                  </tr>
                ))}
                <tr className="tot"><td>Total</td><td /><td /><td /><td style={{ color: 'var(--ok)' }}>{money(total)}</td><td>{money(rivalTotal)}</td></tr>
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
