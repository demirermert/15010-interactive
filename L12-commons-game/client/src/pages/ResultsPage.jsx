import React, { useEffect, useState } from 'react';
import { socket } from '../socket.js';

// Helper function to format fish counts
function formatFish(value) {
  if (value === undefined || value === null) return '-';
  const num = Number(value);
  // If it's an integer, show no decimals. Otherwise show 2 decimals.
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
}

export function ResultsPage() {
  const [session, setSession] = useState(null);
  const [sessionCode, setSessionCode] = useState('');
  const [sessionCodeInput, setSessionCodeInput] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [roundTimer, setRoundTimer] = useState(null);
  const [roundActive, setRoundActive] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [currentRoundNumber, setCurrentRoundNumber] = useState(0);

  useEffect(() => {
    const handleJoinedSession = payload => {
      console.log('✅ Joined session as observer:', payload);
      setSessionCode(payload.code);
      setIsLoading(true); // Wait for sessionUpdate to arrive
    };

    const handleSessionUpdate = payload => {
      console.log('📊 Session update received:', payload);
      setSession(payload);
      setIsLoading(false);
    };

    const handleRoundStarted = payload => {
      setRoundActive(true);
      setRoundTimer(payload.roundTime);
      setCountdown(null);
      setCurrentRoundNumber(payload.round);
    };

    const handleRoundSummary = () => {
      setRoundActive(false);
      setRoundTimer(null);
    };

    const handleRoundCountdown = payload => {
      setCountdown(payload);
    };

    const handleSessionComplete = () => {
      setRoundActive(false);
      setRoundTimer(null);
      setCountdown(null);
    };

    const handleError = message => {
      setErrorMessage(message);
    };

    socket.on('joinedSession', handleJoinedSession);
    socket.on('sessionUpdate', handleSessionUpdate);
    socket.on('roundStarted', handleRoundStarted);
    socket.on('roundSummary', handleRoundSummary);
    socket.on('roundCountdown', handleRoundCountdown);
    socket.on('sessionComplete', handleSessionComplete);
    socket.on('errorMessage', handleError);

    return () => {
      socket.off('joinedSession', handleJoinedSession);
      socket.off('sessionUpdate', handleSessionUpdate);
      socket.off('roundStarted', handleRoundStarted);
      socket.off('roundSummary', handleRoundSummary);
      socket.off('roundCountdown', handleRoundCountdown);
      socket.off('sessionComplete', handleSessionComplete);
      socket.off('errorMessage', handleError);
    };
  }, []);

  // Timer effect for round countdown
  useEffect(() => {
    if (!roundActive || roundTimer === null || roundTimer <= 0) return;
    const interval = setInterval(() => {
      setRoundTimer(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [roundActive, roundTimer]);

  const handleJoinSession = event => {
    event.preventDefault();
    setErrorMessage('');
    if (!sessionCodeInput.trim()) {
      setErrorMessage('Please enter a session code');
      return;
    }
    
    // Check if socket is connected
    if (!socket.connected) {
      setErrorMessage('Not connected to server. Please refresh the page and try again.');
      console.error('❌ Cannot join: Socket not connected');
      return;
    }

    console.log('🔌 Emitting joinSession as observer:', sessionCodeInput.toUpperCase());
    socket.emit('joinSession', {
      sessionCode: sessionCodeInput.toUpperCase(),
      playerName: 'Results Viewer',
      role: 'observer'
    });
  };

  if (isLoading) {
    return (
      <div className="app-shell">
        <div className="card">
          <h1 style={{ textAlign: 'center' }}>📊 Loading Results...</h1>
          <p style={{ textAlign: 'center', color: '#6b7280' }}>
            Connecting to session {sessionCode}...
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell">
        <div className="card">
          <h1 style={{ textAlign: 'center', marginBottom: '2rem' }}>
            📊 Commons Game - Results Display
          </h1>
          <form onSubmit={handleJoinSession} style={{ display: 'grid', gap: '1rem' }}>
            <div className="input-row">
              <label htmlFor="session-code">Session Code</label>
              <input
                id="session-code"
                type="text"
                value={sessionCodeInput}
                onChange={event => setSessionCodeInput(event.target.value.toUpperCase())}
                placeholder="Enter session code"
                required
              />
            </div>
            <button type="submit" className="primary">
              View Results
            </button>
          </form>
          {errorMessage && (
            <div style={{ 
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#fee2e2',
              border: '2px solid #dc2626',
              borderRadius: '8px',
              color: '#991b1b'
            }}>
              {errorMessage}
            </div>
          )}
        </div>
      </div>
    );
  }

  const students = session.players?.filter(p => p.role === 'student') || [];
  const ponds = session.ponds || [];
  const initialFish = session.config?.initialFish || 16;

  // Prepare leaderboard data
  const leaderboard = students
    .map(student => ({
      name: student.name,
      totalFish: student.totalFish || 0
    }))
    .sort((a, b) => b.totalFish - a.totalFish);

  return (
    <div className="app-shell">
      <div className="card">
        <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1>📊 Commons Game Results</h1>
          <p style={{ fontSize: '1.2rem', color: '#6b7280' }}>
            Session: <strong>{sessionCode}</strong>
          </p>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
            <span className="status-tag">{session.status?.toUpperCase() || 'LOBBY'}</span>
            {(session.status === 'running' || session.status === 'active') && (
              <span style={{ color: '#059669', fontWeight: 600, fontSize: '1.1rem' }}>
                Round {currentRoundNumber || session.currentRound || 0} of {session.config?.rounds || 0}
              </span>
            )}
            {roundActive && roundTimer !== null && (
              <div style={{ 
                padding: '0.5rem 1rem',
                backgroundColor: '#dbeafe',
                color: '#1e40af',
                border: '2px solid #3b82f6',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '1.1rem'
              }}>
                ⏱️ Timer: {roundTimer}s
              </div>
            )}
            {countdown && countdown.timeRemaining > 0 && !roundActive && (
              <div style={{ 
                padding: '0.5rem 1rem',
                backgroundColor: '#fef3c7',
                color: '#f59e0b',
                border: '2px solid #f59e0b',
                borderRadius: '8px',
                fontWeight: 'bold',
                fontSize: '1.1rem'
              }}>
                ⏱️ Next Round: {countdown.timeRemaining}s
              </div>
            )}
          </div>
        </header>

        {/* Ponds Section - Compact layout */}
        <section style={{ marginBottom: '2.5rem' }}>
          <h2 style={{ textAlign: 'center', marginBottom: '1rem', fontSize: '1.5rem' }}>🐟 Ponds</h2>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1rem',
            maxWidth: '900px',
            margin: '0 auto'
          }}>
            {ponds.map((pond, index) => {
              const fishHealth = Math.min(100, Math.max(0, (pond.remainingFish / initialFish) * 100));
              const bgColor = fishHealth > 66 ? '#d1fae5' : fishHealth > 33 ? '#fed7aa' : '#fecaca';
              const borderColor = fishHealth > 66 ? '#10b981' : fishHealth > 33 ? '#f59e0b' : '#ef4444';
              const textColor = fishHealth > 66 ? '#065f46' : fishHealth > 33 ? '#9a3412' : '#991b1b';

              return (
                <div
                  key={pond.id}
                  style={{
                    padding: '1rem',
                    backgroundColor: bgColor,
                    border: `2px solid ${borderColor}`,
                    borderRadius: '8px',
                    textAlign: 'center'
                  }}
                >
                  <div style={{ fontSize: '1rem', fontWeight: 'bold', color: textColor, marginBottom: '0.25rem' }}>
                    Pond {index + 1}
                  </div>
                  <div style={{ fontSize: '2rem', fontWeight: 'bold', color: textColor }}>
                    {formatFish(pond.remainingFish)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: textColor }}>
                    fish left
                  </div>
                  <div style={{ fontSize: '0.7rem', color: textColor, marginTop: '0.25rem' }}>
                    {pond.players?.length || 0} players
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Leaderboard Section - Show all players */}
        <section>
          <h2 style={{ textAlign: 'center', marginBottom: '1rem', fontSize: '1.5rem' }}>🏆 Leaderboard</h2>
          {leaderboard.length > 0 ? (
            <div style={{ maxWidth: '700px', margin: '0 auto' }}>
              <div style={{ 
                maxHeight: '500px', 
                overflowY: 'auto', 
                border: '2px solid #e5e7eb', 
                borderRadius: '8px',
                backgroundColor: 'white'
              }}>
                <table className="table" style={{ marginBottom: 0 }}>
                  <thead style={{ 
                    position: 'sticky', 
                    top: 0, 
                    backgroundColor: '#f9fafb',
                    zIndex: 1,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                  }}>
                    <tr>
                      <th style={{ width: '80px' }}>Rank</th>
                      <th>Player</th>
                      <th style={{ width: '100px' }}>Total Fish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((entry, index) => (
                      <tr key={index} style={{ 
                        backgroundColor: index === 0 ? '#fef3c7' : index === 1 ? '#e5e7eb' : index === 2 ? '#fed7aa' : 'transparent'
                      }}>
                        <td>
                          <strong style={{ fontSize: index < 3 ? '1.2rem' : '1rem' }}>
                            {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}
                          </strong>
                        </td>
                        <td><strong>{entry.name}</strong></td>
                        <td><strong>{formatFish(entry.totalFish)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ 
                textAlign: 'center', 
                color: '#6b7280', 
                fontSize: '0.875rem', 
                marginTop: '0.5rem' 
              }}>
                Showing all {leaderboard.length} players
              </p>
            </div>
          ) : (
            <p style={{ textAlign: 'center', color: '#6b7280' }}>
              No players yet. Waiting for game to start...
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

