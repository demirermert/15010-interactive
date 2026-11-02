import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch(buildApiUrl('/sessions'));
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const data = await response.json();
      setSessions(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetails = async (code) => {
    try {
      setLoadingDetails(true);
      const response = await fetch(buildApiUrl(`/session/${code}`));
      if (!response.ok) {
        throw new Error('Failed to fetch session details');
      }
      const data = await response.json();
      setSessionDetails(data);
      setSelectedSession(code);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDownload = (code) => {
    const url = buildApiUrl(`/session/${code}/export`);
    window.open(url, '_blank');
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete':
        return '#10b981';
      case 'running':
        return '#3b82f6';
      case 'lobby':
        return '#f59e0b';
      default:
        return '#6b7280';
    }
  };

  if (loading) {
    return (
      <div className="app-shell">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>Loading sessions...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="card">
        <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Session History</h1>
            <p style={{ color: '#6b7280' }}>View all past game sessions</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <button>Student Login</button>
            </Link>
            <Link to="/instructor" style={{ textDecoration: 'none' }}>
              <button>Instructor Login</button>
            </Link>
          </div>
        </header>

        {error && (
          <div
            style={{
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem'
            }}
          >
            {error}
          </div>
        )}

        {sessions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
            <p>No sessions found. Play some games first!</p>
            <div style={{ marginTop: '1rem' }}>
              <Link to="/instructor" style={{ textDecoration: 'none' }}>
                <button className="primary">Create New Session</button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Session Name</th>
                  <th>Code</th>
                  <th>Instructor</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Rounds</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr 
                    key={session.code}
                    style={{ 
                      backgroundColor: selectedSession === session.code ? '#f3f4f6' : 'transparent',
                      cursor: 'pointer'
                    }}
                    onClick={() => fetchSessionDetails(session.code)}
                  >
                    <td style={{ fontWeight: 600 }}>{session.sessionName || session.code}</td>
                    <td><strong>{session.code}</strong></td>
                    <td>{session.instructorName}</td>
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
                    <td>{formatDate(session.createdAt)}</td>
                    <td>{formatDate(session.completedAt)}</td>
                    <td>{session.config?.rounds || 'N/A'}</td>
                    <td>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(session.code);
                        }}
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
                      >
                        Download CSV
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedSession && sessionDetails && (
              <section style={{ marginTop: '2rem', borderTop: '2px solid #e5e7eb', paddingTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>Session Details: {selectedSession}</h3>
                  <button onClick={() => setSelectedSession(null)}>Close Details</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div>
                    <strong>Instructor:</strong> {sessionDetails.instructorName}
                  </div>
                  <div>
                    <strong>Status:</strong> {sessionDetails.status}
                  </div>
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
                </div>

                {sessionDetails.players && sessionDetails.players.length > 0 && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h4>Players ({sessionDetails.players.length})</h4>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Role</th>
                          <th>Pair</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionDetails.players.map((player, idx) => (
                          <tr key={idx}>
                            <td>{player.name}</td>
                            <td>{player.role}</td>
                            <td>{player.pairId || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {sessionDetails.rounds && sessionDetails.rounds.length > 0 && (
                  <div>
                    <h4>Round Results ({sessionDetails.rounds.length} rounds)</h4>
                    {sessionDetails.rounds.map((round) => (
                      <div key={round.round} style={{ marginBottom: '1.5rem' }}>
                        <h5 style={{ marginBottom: '0.5rem' }}>Round {round.round}</h5>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Player</th>
                              <th>Price</th>
                              <th>Opponent</th>
                              <th>Opp. Price</th>
                              <th>Demand</th>
                              <th>Profit</th>
                              <th>Market Share</th>
                            </tr>
                          </thead>
                          <tbody>
                            {round.results.map((result, idx) => (
                              <tr key={idx}>
                                <td>{result.playerName}</td>
                                <td>${result.price.toFixed(2)}</td>
                                <td>{result.opponentName}</td>
                                <td>${result.opponentPrice.toFixed(2)}</td>
                                <td>{result.demand.toFixed(1)}</td>
                                <td>${result.profit.toFixed(2)}</td>
                                <td>{(result.marketShare * 100).toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {loadingDetails && (
              <div style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
                Loading session details...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

