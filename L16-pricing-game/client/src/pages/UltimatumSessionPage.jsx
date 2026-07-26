import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { socket } from '../socket';

export default function UltimatumSessionPage() {
  const { sessionCode } = useParams();
  const navigate = useNavigate();
  
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [timer, setTimer] = useState(0);
  const [showAcceptedOnly, setShowAcceptedOnly] = useState(false);

  useEffect(() => {
    // Join as instructor
    socket.emit('joinSession', {
      sessionCode: sessionCode,
      playerName: 'Instructor',
      role: 'instructor'
    });

    socket.on('joinedSession', handleJoinedSession);
    socket.on('sessionUpdate', handleSessionUpdate);
    socket.on('errorMessage', handleError);
    socket.on('timerUpdate', ({ remaining }) => setTimer(remaining));

    return () => {
      socket.off('joinedSession', handleJoinedSession);
      socket.off('sessionUpdate', handleSessionUpdate);
      socket.off('errorMessage', handleError);
      socket.off('timerUpdate');
    };
  }, [sessionCode]);

  const handleJoinedSession = (data) => {
    if (data.gameType !== 'ultimatum') {
      navigate('/instructor');
      return;
    }
    setSession(data);
  };

  const handleSessionUpdate = (data) => {
    if (data.gameType !== 'ultimatum') return;
    setSession(data);
  };

  const handleError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 5000);
  };

  const openLobby = () => {
    socket.emit('openLobby', { sessionCode });
  };

  const startGame = () => {
    socket.emit('startSession', { sessionCode });
  };

  const endSession = () => {
    socket.emit('endSession', { sessionCode });
  };

  if (!session) {
    return (
      <div className="app-shell">
        <div className="card">
          <p style={{ textAlign: 'center', padding: '2rem' }}>Loading session...</p>
        </div>
      </div>
    );
  }

  const students = session.players?.filter(p => p.role === 'student' || p.role === 'ai') || [];
  const canOpenLobby = session.status === 'setup';
  const canStart = session.status === 'lobby' && students.length >= 2;

  return (
    <div className="app-shell">
      <div className="card">
        <header style={{ marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '2px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h2 style={{ margin: '0 0 0.5rem 0' }}>Ultimatum Game - Instructor View</h2>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>
                Session: <strong>{session.sessionName || session.code}</strong> ({session.code})
              </p>
              <span className="status-tag">{session.status?.toUpperCase()}</span>
            </div>
            
            <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column' }}>
              <Link to="/ult/instructor" style={{ textDecoration: 'none' }}>
                <button style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>
                  ← Back to Dashboard
                </button>
              </Link>
              {canOpenLobby && (
                <button
                  onClick={openLobby}
                  className="primary"
                  style={{ backgroundColor: '#10b981', whiteSpace: 'nowrap' }}
                >
                  🚪 Open Lobby
                </button>
              )}
              {canStart && (
                <button onClick={startGame} className="primary" style={{ whiteSpace: 'nowrap' }}>
                  🎮 Start Game
                </button>
              )}
              {session.status !== 'complete' && (
                <button
                  onClick={endSession}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  End Session
                </button>
              )}
            </div>
          </div>

          {session.currentRound > 0 && (
            <div style={{
              marginTop: '1rem',
              padding: '1.5rem',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                Round {session.currentRound}
              </div>
              {timer > 0 && (
                <div style={{
                  fontSize: '2.5rem',
                  fontWeight: 700,
                  color: timer <= 10 ? '#dc2626' : '#3b82f6'
                }}>
                  {timer}s
                </div>
              )}
              <div style={{ fontSize: '1rem', color: '#6b7280', marginTop: '0.5rem' }}>
                {session.status === 'proposing' && 'Proposers making offers...'}
                {session.status === 'responding' && 'Responders deciding...'}
              </div>
            </div>
          )}
        </header>

        {error && (
          <div style={{
            padding: '1rem',
            backgroundColor: '#fee2e2',
            borderRadius: '8px',
            color: '#991b1b',
            marginBottom: '1rem'
          }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Students ({students.length})</h3>
          {students.length === 0 ? (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: '2rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
              No students have joined yet
            </p>
          ) : (
            <div style={{
              border: '2px solid #e5e7eb',
              borderRadius: '8px',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ backgroundColor: '#f9fafb' }}>
                  <tr>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>#</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Name</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Pair</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, idx) => (
                    <tr key={student.socketId} style={{
                      borderTop: idx > 0 ? '1px solid #e5e7eb' : 'none',
                      backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb'
                    }}>
                      <td style={{ padding: '0.75rem' }}>{idx + 1}</td>
                      <td style={{ padding: '0.75rem', fontWeight: 500 }}>{student.name}</td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: student.connected ? '#d1fae5' : '#fee2e2',
                          color: student.connected ? '#065f46' : '#991b1b'
                        }}>
                          {student.connected ? '🟢 Online' : '🔴 Offline'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.875rem' }}>
                        {student.pairId || '-'}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        {student.playerType === 1 ? '👤 Player 1' : student.playerType === 2 ? '👤 Player 2' : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {session.status === 'lobby' && students.length < 2 && (
          <div style={{
            padding: '1rem',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            color: '#92400e',
            textAlign: 'center'
          }}>
            ⚠️ Need at least 2 students to start the game
          </div>
        )}

        {session.status === 'complete' && (
          <div style={{ marginTop: '2rem' }}>
            <div style={{
              padding: '2rem',
              backgroundColor: '#dbeafe',
              borderRadius: '8px',
              textAlign: 'center',
              marginBottom: '2rem'
            }}>
              <h2 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem 0' }}>🎉 Game Complete!</h2>
              <p style={{ color: '#1e40af' }}>All rounds have been completed.</p>
            </div>

            {/* Results Table */}
            {session.roundResults && session.roundResults.length > 0 && (
              <div style={{ marginTop: '2rem' }}>
                {/* Header with checkbox and copy button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h3 style={{ margin: 0 }}>📊 Game Results</h3>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                      <input
                        type="checkbox"
                        checked={showAcceptedOnly}
                        onChange={(e) => setShowAcceptedOnly(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span>Show accepted only</span>
                    </label>
                  </div>
                  <button
                    onClick={() => {
                      const rows = [];
                      session.roundResults.forEach((roundData) => {
                        roundData.results.forEach((result) => {
                          // Only include if not filtering, or if filtering and accepted
                          if (!showAcceptedOnly || result.responder.accepted) {
                            rows.push(`${result.proposer.name}, ${result.responder.name}`);
                          }
                        });
                      });
                      const text = rows.join('\n');
                      navigator.clipboard.writeText(text).then(() => {
                        alert(`${rows.length} player pairs copied to clipboard!`);
                      }).catch(err => {
                        console.error('Failed to copy:', err);
                        alert('Failed to copy to clipboard');
                      });
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                      fontWeight: 500
                    }}
                  >
                    📋 Copy Player Names
                  </button>
                </div>
                <div style={{
                  border: '2px solid #e5e7eb',
                  borderRadius: '8px',
                  overflow: 'hidden'
                }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ backgroundColor: '#f9fafb' }}>
                      <tr>
                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>Game #</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Player 1</th>
                        <th style={{ padding: '0.75rem', textAlign: 'left' }}>Player 2</th>
                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>Offer</th>
                        <th style={{ padding: '0.75rem', textAlign: 'center' }}>Accepted?</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Flatten all results into a single array
                        const allResults = [];
                        session.roundResults.forEach((roundData) => {
                          roundData.results.forEach((result) => {
                            allResults.push(result);
                          });
                        });
                        
                        // Filter if checkbox is checked
                        const filteredResults = showAcceptedOnly 
                          ? allResults.filter(r => r.responder.accepted)
                          : allResults;
                        
                        // Sort by offer amount (ascending)
                        const sortedResults = [...filteredResults].sort((a, b) => 
                          a.proposer.offer - b.proposer.offer
                        );
                        
                        // Render rows
                        return sortedResults.map((result, idx) => (
                          <tr key={idx} style={{
                            borderTop: idx > 0 ? '1px solid #e5e7eb' : 'none',
                            backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb'
                          }}>
                            <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 500 }}>
                              {idx + 1}
                            </td>
                            <td style={{ padding: '0.75rem' }}>
                              {result.proposer.name}
                            </td>
                            <td style={{ padding: '0.75rem' }}>
                              {result.responder.name}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 600, color: '#3b82f6' }}>
                              ${result.proposer.offer}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                              <span style={{
                                padding: '0.25rem 0.75rem',
                                borderRadius: '12px',
                                fontSize: '0.875rem',
                                fontWeight: 600,
                                backgroundColor: result.responder.accepted ? '#d1fae5' : '#fee2e2',
                                color: result.responder.accepted ? '#065f46' : '#991b1b'
                              }}>
                                {result.responder.accepted ? '✓ Yes' : '✗ No'}
                              </span>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

