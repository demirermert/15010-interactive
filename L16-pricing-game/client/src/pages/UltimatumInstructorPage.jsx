import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { socket } from '../socket';

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

const DEFAULT_CONFIG = {
  rounds: 1,
  proposeTime: 10,
  respondTime: 10,
  totalAmount: 20,
  minOffer: 0,
  maxOffer: 20
};

export default function UltimatumInstructorPage() {
  const navigate = useNavigate();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [instructorConfig, setInstructorConfig] = useState(DEFAULT_CONFIG);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  const instructorName = 'Instructor'; // Default single instructor name

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch(buildApiUrl('/sessions'));
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const allSessions = await response.json();
      // Filter for only ultimatum games
      const ultimatumSessions = allSessions.filter(s => s.gameType === 'ultimatum');
      setSessions(ultimatumSessions);
    } catch (err) {
      console.error('Error fetching sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSession = async (code) => {
    if (!confirm(`Delete session ${code}?`)) return;
    try {
      const response = await fetch(buildApiUrl(`/session/${code}`), {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to delete session');
      await fetchSessions(); // Refresh list
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleCreateSession = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    try {
      const payload = {
        instructorName: instructorName,
        sessionName: sessionName.trim() || `${instructorName}'s Ultimatum Game`,
        gameType: 'ultimatum',
        config: {
          rounds: 1, // Always 1 round
          proposeTime: Number(instructorConfig.proposeTime),
          respondTime: Number(instructorConfig.respondTime),
          totalAmount: Number(instructorConfig.totalAmount),
          minOffer: Number(instructorConfig.minOffer),
          maxOffer: Number(instructorConfig.maxOffer)
        }
      };
      
      const response = await fetch(buildApiUrl('/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Failed to create session');
      }
      
      const data = await response.json();
      
      // Join as instructor via socket
      socket.emit('joinSession', {
        sessionCode: data.code,
        playerName: instructorName,
        role: 'instructor'
      });
      
      // Wait for join confirmation, then navigate
      socket.once('joinedSession', () => {
        navigate(`/ult/manage/${data.code}`);
      });
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  return (
    <div className="app-shell">
      <div className="card">
        <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Ultimatum Game - Instructor Dashboard</h1>
            <p style={{ color: '#6b7280' }}>Manage your game sessions</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/ult" style={{ textDecoration: 'none' }}>
              <button style={{ fontSize: '0.875rem' }}>Student View</button>
            </Link>
            <Link to="/instructor" style={{ textDecoration: 'none' }}>
              <button style={{ fontSize: '0.875rem' }}>Pricing Game</button>
            </Link>
          </div>
        </header>

        {/* Create New Session Section */}
        <section style={{ marginBottom: '2rem', padding: '1.5rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Create New Ultimatum Game Session</h2>
            <button 
              className="primary"
              onClick={() => setShowCreateForm(!showCreateForm)}
            >
              {showCreateForm ? 'Hide Form' : 'New Game'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateSession} style={{ display: 'grid', gap: '1rem', marginTop: '1rem' }}>
              <div className="input-row">
                <label htmlFor="session-name">Session Name</label>
                <input
                  id="session-name"
                  type="text"
                  value={sessionName}
                  onChange={event => setSessionName(event.target.value)}
                  placeholder={`e.g., "MBA Section A" or "Spring 2025"`}
                />
              </div>

              <div className="input-row">
                <label>Proposing Time (seconds)</label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={instructorConfig.proposeTime}
                  onChange={event => setInstructorConfig(cfg => ({ ...cfg, proposeTime: event.target.value }))}
                />
              </div>

              <div className="input-row">
                <label>Responding Time (seconds)</label>
                <input
                  type="number"
                  min="10"
                  max="300"
                  value={instructorConfig.respondTime}
                  onChange={event => setInstructorConfig(cfg => ({ ...cfg, respondTime: event.target.value }))}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
                <div className="input-row">
                  <label>Total Amount ($)</label>
                  <input
                    type="number"
                    min="1"
                    value={instructorConfig.totalAmount}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, totalAmount: event.target.value }))}
                  />
                </div>
                <div className="input-row">
                  <label>Min Offer ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={instructorConfig.minOffer}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, minOffer: event.target.value }))}
                  />
                </div>
                <div className="input-row">
                  <label>Max Offer ($)</label>
                  <input
                    type="number"
                    min="0"
                    value={instructorConfig.maxOffer}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, maxOffer: event.target.value }))}
                  />
                </div>
              </div>

              <div style={{
                padding: '1rem',
                backgroundColor: '#e0f2fe',
                borderRadius: '6px',
                borderLeft: '4px solid #0284c7',
                fontSize: '0.875rem',
                color: '#0c4a6e',
                marginTop: '0.5rem'
              }}>
                <strong>ℹ️ How it works:</strong> Students will be paired. Player 1 (Proposer) offers an amount to Player 2 (Responder).
                If accepted, P1 gets (Total - Offer) and P2 gets Offer. If rejected, both get $0.
              </div>

              <button type="submit" className="primary">
                Create Session
              </button>
              {errorMessage && <p style={{ color: '#dc2626' }}>{errorMessage}</p>}
            </form>
          )}
        </section>

        {/* Info Section */}
        <section>
          <div style={{
            padding: '2rem',
            backgroundColor: 'white',
            border: '2px solid #e5e7eb',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2 style={{ marginTop: 0, color: '#1f2937' }}>🤝 Ultimatum Game</h2>
            <p style={{ color: '#6b7280', lineHeight: '1.6', maxWidth: '600px', margin: '0 auto 1rem auto' }}>
              The Ultimatum Game is a classic economic experiment where two players decide how to divide a sum of money.
              One player proposes a split, and the other can accept or reject it. If rejected, neither player gets anything.
            </p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginTop: '1.5rem',
              textAlign: 'left'
            }}>
              <div style={{ padding: '1rem', backgroundColor: '#f0f9ff', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>👤</div>
                <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Player 1 (Proposer)</strong>
                <small style={{ color: '#6b7280' }}>Makes an offer on how to split the money</small>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#fef3c7', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>👤</div>
                <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Player 2 (Responder)</strong>
                <small style={{ color: '#6b7280' }}>Accepts or rejects the offer</small>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#dcfce7', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✅</div>
                <strong style={{ display: 'block', marginBottom: '0.25rem' }}>If Accepted</strong>
                <small style={{ color: '#6b7280' }}>Both players receive their shares</small>
              </div>
              <div style={{ padding: '1rem', backgroundColor: '#fee2e2', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>❌</div>
                <strong style={{ display: 'block', marginBottom: '0.25rem' }}>If Rejected</strong>
                <small style={{ color: '#6b7280' }}>Both players receive nothing</small>
              </div>
            </div>
            <p style={{ 
              marginTop: '1.5rem', 
              padding: '1rem', 
              backgroundColor: '#f9fafb', 
              borderRadius: '6px',
              fontSize: '0.875rem',
              color: '#6b7280'
            }}>
              <strong>Tip:</strong> After creating a session, you'll get a 4-letter code to share with students.
              They can join at <code style={{ 
                backgroundColor: '#e5e7eb', 
                padding: '0.125rem 0.375rem', 
                borderRadius: '3px',
                fontFamily: 'monospace'
              }}>/ult</code>
            </p>
          </div>
        </section>

        {/* Session History */}
        <section style={{ marginTop: '2rem' }}>
          <h2 style={{ marginBottom: '1rem' }}>Session History ({sessions.length})</h2>
          {loading ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>Loading sessions...</p>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
              <p>No sessions found. Create your first Ultimatum Game!</p>
            </div>
          ) : (
            <div style={{ border: '2px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ backgroundColor: '#f9fafb' }}>
                  <tr>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Session Name</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Code</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Status</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Students</th>
                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>Created</th>
                    <th style={{ padding: '0.75rem', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session, idx) => (
                    <tr key={session.code} style={{
                      borderTop: idx > 0 ? '1px solid #e5e7eb' : 'none',
                      backgroundColor: idx % 2 === 0 ? 'white' : '#f9fafb'
                    }}>
                      <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                        {session.sessionName || 'Untitled Session'}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center', fontFamily: 'monospace', fontWeight: 600 }}>
                        {session.code}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: session.status === 'complete' ? '#dcfce7' : session.status === 'lobby' ? '#fef3c7' : '#dbeafe',
                          color: session.status === 'complete' ? '#065f46' : session.status === 'lobby' ? '#92400e' : '#1e40af'
                        }}>
                          {session.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        {session.studentCount || 0}
                      </td>
                      <td style={{ padding: '0.75rem', fontSize: '0.875rem', color: '#6b7280' }}>
                        {new Date(session.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                          <Link to={`/ult/manage/${session.code}`}>
                            <button style={{
                              padding: '0.375rem 0.75rem',
                              fontSize: '0.875rem',
                              backgroundColor: '#3b82f6',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}>
                              Open
                            </button>
                          </Link>
                          <button
                            onClick={() => handleDeleteSession(session.code)}
                            style={{
                              padding: '0.375rem 0.75rem',
                              fontSize: '0.875rem',
                              backgroundColor: '#dc2626',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
