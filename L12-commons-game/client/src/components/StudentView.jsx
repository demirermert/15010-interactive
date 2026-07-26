import React, { useState, useEffect } from 'react';

// Helper function to format fish counts to 2 decimal places
function formatFish(value) {
  if (value === undefined || value === null) return '-';
  const num = Number(value);
  // If it's an integer, show no decimals. Otherwise show 2 decimals.
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}

export function StudentView({
  sessionCode,
  currentRound,
  totalRounds,
  roundActive,
  timer,
  maxCatch,
  remainingFish,
  onSubmitFish,
  latestResult,
  history,
  hasSubmitted,
  countdown,
  pondId,
  pondPlayers,
  initialFish,
  gameComplete,
  pondDepleted,
  pondPlayersResults,
  playersPerPond
}) {
  const [fishCount, setFishCount] = useState('');
  const [error, setError] = useState('');
  const [displayedFish, setDisplayedFish] = useState(remainingFish);

  useEffect(() => {
    setFishCount('');
    setError('');
  }, [currentRound]);

  // Update displayed fish only when round is active or countdown is active
  // Keep it frozen during "Calculating results..." phase
  useEffect(() => {
    if (roundActive || countdown) {
      setDisplayedFish(remainingFish);
    }
  }, [remainingFish, roundActive, countdown]);

  const handleSubmit = event => {
    event.preventDefault();
    const numeric = Number(fishCount);
    if (!Number.isInteger(numeric) || numeric < 0) {
      setError('Enter a valid non-negative integer');
      return;
    }
    if (numeric > maxCatch) {
      setError(`You can catch at most ${maxCatch} fish`);
      return;
    }
    setError('');
    onSubmitFish(numeric);
  };

  // Calculate fish health for visual (based on 40 fish maximum - the cap)
  const maxFish = 40;
  const fishHealth = Math.min(100, Math.max(0, (displayedFish / maxFish) * 100));
  const bgColor = fishHealth > 66 ? '#d1fae5' : fishHealth > 33 ? '#fed7aa' : '#fecaca';
  const borderColor = fishHealth > 66 ? '#10b981' : fishHealth > 33 ? '#f59e0b' : '#ef4444';
  const textColor = fishHealth > 66 ? '#065f46' : fishHealth > 33 ? '#9a3412' : '#991b1b';

  return (
    <div className="card student-game-card">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'clamp(1.25rem, 4vw, 1.5rem)' }}>
            Session {sessionCode}
            {currentRound > 0 && (
              <span style={{ marginLeft: '1rem', color: '#6b7280', fontSize: 'clamp(1rem, 3vw, 1.25rem)' }}>
                Round {currentRound} of {totalRounds}
              </span>
            )}
          </h2>
        </div>
      </header>

      {/* Previous Round Result - Show during countdown, OR immediately if pond depleted */}
      {((countdown && latestResult) || (pondDepleted && latestResult && !roundActive)) && latestResult.fishBeforeDoubling !== undefined && latestResult.fishAfterDoubling !== undefined && (
        <div style={{
          backgroundColor: '#dbeafe',
          border: '2px solid #3b82f6',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          textAlign: 'center'
        }}>
          <h3 style={{ color: '#1e40af', fontSize: '1.5rem', marginTop: 0, marginBottom: '1rem' }}>
            Previous Round Result
          </h3>
          <p style={{ fontSize: '1.1rem', color: '#1e40af', margin: '0 0 0.5rem 0', fontWeight: 600 }}>
            You caught: <strong>{formatFish(latestResult.caught)}</strong> fish
          </p>
          <p style={{ fontSize: '1.1rem', color: '#1e40af', margin: '0 0 0.5rem 0', fontWeight: 600 }}>
            🐟 Pond caught <strong>{formatFish(latestResult.pondTotalCaught)}</strong> fish total
          </p>
          <p style={{ fontSize: '1.1rem', color: '#1e40af', margin: '0 0 0.5rem 0', fontWeight: 600 }}>
            Remaining <strong>{formatFish(latestResult.fishBeforeDoubling)}</strong> fish doubled to <strong>{formatFish(latestResult.fishAfterDoubling)}</strong> fish!
          </p>
          <p style={{ fontSize: '1.1rem', color: '#1e40af', margin: 0, fontWeight: 600 }}>
            Your total fish: <strong>{formatFish(latestResult.totalFish)}</strong>
          </p>
        </div>
      )}

      {/* Pond Visualization */}
      {pondId && (
        <div className="student-pond-card" style={{ 
          padding: '1.5rem', 
          backgroundColor: bgColor,
          borderRadius: '16px',
          border: `3px solid ${borderColor}`,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          marginBottom: '1.5rem',
          transition: 'all 0.3s ease'
        }}>
          {/* Timer Display - Hide "Calculating results" when depleted pond shows results */}
          {!(pondDepleted && latestResult && !roundActive && !countdown) && (
            <div style={{
              textAlign: 'center',
              marginBottom: '1rem',
              padding: countdown ? '1rem' : '0.75rem',
              backgroundColor: countdown ? '#fde68a' : gameComplete ? '#d1fae5' : 'rgba(255, 255, 255, 0.7)',
              borderRadius: '12px',
              border: countdown ? '3px solid #f59e0b' : gameComplete ? '2px solid #10b981' : '2px solid rgba(0, 0, 0, 0.1)',
              boxShadow: countdown ? '0 4px 12px rgba(245, 158, 11, 0.4)' : 'none'
            }}>
              <div style={{
                fontSize: countdown ? '1.58rem' : gameComplete ? '1.75rem' : roundActive ? '1.75rem' : '1.25rem',
                fontWeight: 'bold',
                color: countdown ? '#f59e0b' : gameComplete ? '#059669' : '#1f2937'
              }}>
                {countdown 
                  ? `Round ${countdown.nextRound} starts in ${countdown.timeRemaining}s`
                  : gameComplete
                    ? '🎉 Game Complete!'
                    : roundActive 
                      ? `Round ${currentRound} ends in ${timer}s` 
                      : 'Calculating results...'}
              </div>
            </div>
          )}

          {/* Large Fish Count Display */}
          <div style={{ 
            textAlign: 'center', 
            padding: '1.5rem',
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            borderRadius: '12px',
            marginBottom: '0'
          }}>
            <div style={{ fontSize: '3.5rem', fontWeight: 'bold', color: textColor, lineHeight: 1 }}>
              {displayedFish}
            </div>
            <div style={{ fontSize: '0.875rem', color: textColor, marginTop: '0.25rem' }}>
              fish remaining
            </div>
          </div>
        </div>
      )}

      {gameComplete && pondPlayersResults && pondPlayersResults.length > 0 && (
        <div style={{ 
          backgroundColor: '#dbeafe', 
          border: '3px solid #3b82f6', 
          borderRadius: '16px', 
          padding: '2rem', 
          marginBottom: '1.5rem',
          textAlign: 'center'
        }}>
          <h2 style={{ color: '#1e40af', fontSize: '2rem', margin: '0 0 1rem 0' }}>
            🎉 Game Ended!
          </h2>
          <h3 style={{ color: '#1e40af', fontSize: '1.25rem', marginBottom: '1rem' }}>
            Final Results - Your Pond
          </h3>
          <div style={{ 
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '1rem',
            marginTop: '1rem'
          }}>
            {pondPlayersResults.map((player, index) => (
              <div 
                key={index}
                style={{ 
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem',
                  backgroundColor: index % 2 === 0 ? '#f9fafb' : 'white',
                  borderRadius: '8px',
                  marginBottom: index < pondPlayersResults.length - 1 ? '0.5rem' : 0,
                  fontWeight: index === 0 ? 'bold' : 'normal',
                  fontSize: index === 0 ? '1.1rem' : '1rem'
                }}
              >
                <span style={{ color: '#1f2937' }}>
                  {player.name}
                </span>
                <span style={{ color: '#059669', fontWeight: 'bold' }}>
                  {formatFish(player.totalFish)} fish
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {currentRound === 0 && !gameComplete ? (
        <div style={{ 
          backgroundColor: '#f0f9ff', 
          border: '2px solid #3b82f6', 
          borderRadius: '12px', 
          padding: '2rem',
          marginBottom: '1.5rem'
        }}>
          <h2 style={{ color: '#1e40af', fontSize: '1.75rem', marginTop: 0, textAlign: 'center' }}>
            🎮 How to Play: Tragedy of the Commons
          </h2>
          <div style={{ color: '#1f2937', fontSize: '1rem', lineHeight: '1.8' }}>
            <p><strong>Objective:</strong> Catch as many fish as possible from your shared pond.</p>
            
            <p><strong>The Rules:</strong></p>
            <ul style={{ paddingLeft: '1.5rem' }}>
              <li><strong>Number of rounds:</strong> The game will have {totalRounds} rounds</li>
              <li><strong>Starting fish:</strong> Your pond starts with {initialFish} fish</li>
              <li>Each round, you can choose to catch 0 to {maxCatch} fish from your pond</li>
              <li>You share this pond with {playersPerPond ? (playersPerPond - 1) : 'other'} other player{playersPerPond && playersPerPond > 2 ? 's' : ''} (total of {playersPerPond || '4'} players per pond)</li>
              <li><strong>Fish allocation:</strong> If your pond has enough fish for everyone's requests, each player gets exactly what they asked for. If there aren't enough fish, they are allocated proportionally: (your request / total requested) × available fish. Example: 8 fish available, requests [2,4,3,4] (total 13) → players get [1.23, 2.46, 1.85, 2.46]</li>
              <li>After everyone submits, the remaining fish in the pond will <strong>double</strong> (with no limit!)</li>
              <li><strong>Warning:</strong> If all the fish are caught (0 remaining), the pond is depleted and cannot recover</li>
              <li><strong>At the end of the game</strong>, any remaining fish in the pond will be <strong>split equally</strong> among all players in that pond</li>
            </ul>
            
            <p style={{ 
              textAlign: 'center', 
              marginTop: '1.5rem',
              padding: '1rem',
              backgroundColor: '#dbeafe',
              borderRadius: '8px',
              fontWeight: 600,
              color: '#1e40af'
            }}>
              Waiting for instructor to start the game...
            </p>
          </div>
        </div>
      ) : !gameComplete ? (
        <>
          {/* Pond Depleted Message - Only show during active round when depleted */}
          {pondDepleted && roundActive ? (
            <div style={{
              padding: '2rem',
              backgroundColor: '#fee2e2',
              border: '3px solid #dc2626',
              borderRadius: '12px',
              textAlign: 'center',
              marginBottom: '1.5rem'
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
                🚫
              </div>
              <h2 style={{ 
                color: '#991b1b', 
                marginTop: 0, 
                marginBottom: '1rem',
                fontSize: '1.8rem'
              }}>
                Your Pond is Depleted!
              </h2>
              <p style={{ 
                color: '#7f1d1d', 
                fontSize: '1.2rem', 
                marginBottom: '1rem',
                fontWeight: 600
              }}>
                All fish have been caught from your pond.
              </p>
              <p style={{ 
                color: '#991b1b', 
                fontSize: '1.1rem',
                margin: '0.5rem 0'
              }}>
                Your pond cannot recover. 
              </p>
              <p style={{ 
                color: '#7f1d1d', 
                fontSize: '1rem',
                marginTop: '1.5rem',
                padding: '1rem',
                backgroundColor: 'rgba(255, 255, 255, 0.5)',
                borderRadius: '8px'
              }}>
                Please wait while other ponds finish their game...
              </p>
            </div>
          ) : pondDepleted && (countdown || (!roundActive && !countdown)) ? (
            /* When pond is depleted during countdown OR calculating results, show compact message */
            <div style={{
              padding: '1rem',
              backgroundColor: '#fee2e2',
              border: '2px solid #dc2626',
              borderRadius: '8px',
              textAlign: 'center',
              marginBottom: '1.5rem'
            }}>
              <p style={{ 
                color: '#991b1b', 
                fontWeight: 'bold',
                margin: 0,
                fontSize: '1.1rem'
              }}>
                🚫 Your pond is depleted - waiting for other ponds to finish...
              </p>
            </div>
          ) : (
            <>
              {/* Only show input form when NOT in countdown (hide during 10s break) */}
              {!countdown && (
                <>
                  <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
                    <div style={{ textAlign: 'center' }}>
                      <label htmlFor="fish-input" style={{ fontSize: '1.5rem', fontWeight: 600, display: 'block', marginBottom: '1rem' }}>
                        How many fish to catch?
                      </label>
                      <input
                        id="fish-input"
                        type="number"
                        step="1"
                        min="0"
                        max={maxCatch}
                        value={fishCount}
                        onChange={event => setFishCount(event.target.value)}
                        disabled={!roundActive || hasSubmitted}
                        placeholder={`0 to ${maxCatch}`}
                        style={{ 
                          width: '220px',
                          maxWidth: '90%',
                          padding: '1.25rem 1rem',
                          fontSize: 'clamp(2rem, 6vw, 2.5rem)',
                          textAlign: 'center',
                          border: '3px solid #2563eb',
                          borderRadius: '8px',
                          fontWeight: 'bold',
                          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                          transition: 'all 0.2s ease'
                        }}
                      />
                      {error && <div style={{ color: '#dc2626', marginTop: '0.5rem' }}>{error}</div>}
                    </div>
                    <button className="primary" type="submit" disabled={!roundActive || hasSubmitted}>
                      {hasSubmitted ? 'Submitted - Waiting for others...' : 'Submit'}
                    </button>
                  </form>

                  {hasSubmitted && roundActive && (
                    <div style={{ 
                      backgroundColor: '#d1fae5', 
                      border: '2px solid #059669', 
                      borderRadius: '8px', 
                      padding: '1rem', 
                      marginTop: '1rem',
                      textAlign: 'center'
                    }}>
                      <p style={{ color: '#059669', fontWeight: 600, fontSize: '1.1rem', margin: 0 }}>
                        ✓ Your decision has been submitted!
                      </p>
                      <p style={{ color: '#047857', margin: '0.5rem 0 0 0' }}>
                        Waiting for other players to submit their decisions...
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      ) : null}

      {history && history.length > 0 && (
        <div style={{ marginTop: '1.5rem', marginBottom: '2rem', padding: '1.5rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
          <h3 style={{ textAlign: 'center', marginTop: 0, marginBottom: '1.5rem' }}>Round history</h3>
          <div className="history-list">
            <div className="history-item" style={{ fontWeight: 600 }}>
              <span>Round</span>
              <span>You Caught</span>
              <span>Total Caught</span>
              <span>Remaining</span>
            </div>
            {history.map(item => (
              <div className="history-item" key={item.round}>
                <span>{item.round}</span>
                <span>{formatFish(item.caught)}</span>
                <span>{item.pondTotalCaught !== undefined ? formatFish(item.pondTotalCaught) : '-'}</span>
                <span>{item.remainingFish !== undefined ? formatFish(item.remainingFish) : '-'}</span>
              </div>
            ))}
            <div className="history-item" style={{ 
              fontWeight: 700, 
              backgroundColor: '#e5e7eb', 
              borderTop: '3px solid #9ca3af',
              fontSize: '1.1rem',
              padding: '1rem 0.5rem'
            }}>
              <span>Total</span>
              <span>{formatFish(history.reduce((sum, item) => sum + item.caught, 0))}</span>
              <span>{formatFish(history.reduce((sum, item) => sum + (item.pondTotalCaught || 0), 0))}</span>
              <span style={{ fontStyle: 'italic', color: '#6b7280' }}>
                {history.length > 0 && history[history.length - 1].remainingFish !== undefined 
                  ? formatFish(history[history.length - 1].remainingFish)
                  : '-'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

