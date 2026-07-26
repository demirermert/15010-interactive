import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

const DEFAULT_CONFIG = {
  rounds: 2,
  roundTime: 10,
  breakTime: 10,
  differentTimePerRound: false,
  roundTimes: [],
  marketSize: 100,
  modelType: 'hotelling', // 'logit' or 'hotelling'
  // Logit model parameters
  alpha: 1,
  sigma: 5,
  // Hotelling model parameters
  travelCost: 2,
  consumerValue: 100,
  x1: 0,
  x2: 100,
  priceMin: 0,
  priceMax: 100,
  defaultPrice: 10,
  enableChat: false,
  hideRoundCount: false,
  showOpponentName: false,
  showModelParameters: false
};

export default function InstructorPage() {
  const navigate = useNavigate();
  const [instructorSessions, setInstructorSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [instructorConfig, setInstructorConfig] = useState(DEFAULT_CONFIG);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [sessionDetails, setSessionDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);

  const instructorName = 'Instructor'; // Default single instructor name

  useEffect(() => {
    fetchInstructorSessions();
  }, []);

  const fetchInstructorSessions = async () => {
    try {
      setLoading(true);
      const response = await fetch(buildApiUrl('/sessions'));
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const allSessions = await response.json();
      setInstructorSessions(allSessions);
    } catch (err) {
      setErrorMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    try {
      const payload = {
        instructorName: instructorName,
        sessionName: sessionName.trim() || `${instructorName}'s Game`,
        config: {
          rounds: Number(instructorConfig.rounds),
          roundTime: instructorConfig.differentTimePerRound 
            ? instructorConfig.roundTimes.map(t => Number(t))
            : Number(instructorConfig.roundTime),
          breakTime: Number(instructorConfig.breakTime),
          marketSize: Number(instructorConfig.marketSize),
          modelType: instructorConfig.modelType,
          // Logit parameters
          alpha: Number(instructorConfig.alpha),
          sigma: Number(instructorConfig.sigma),
          // Hotelling parameters
          travelCost: Number(instructorConfig.travelCost),
          consumerValue: Number(instructorConfig.consumerValue),
          x1: Number(instructorConfig.x1),
          x2: Number(instructorConfig.x2),
          priceBounds: {
            min: Number(instructorConfig.priceMin),
            max: Number(instructorConfig.priceMax)
          },
          enableChat: Boolean(instructorConfig.enableChat),
          hideRoundCount: Boolean(instructorConfig.hideRoundCount),
          showOpponentName: Boolean(instructorConfig.showOpponentName),
          showModelParameters: Boolean(instructorConfig.showModelParameters)
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
      // Redirect to the management page (instructor view)
      navigate(`/manage/${data.code}`, { 
        state: { instructorName: instructorName } 
      });
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleDownload = (code, event) => {
    event.stopPropagation(); // Prevent row click
    const url = buildApiUrl(`/session/${code}/export`);
    window.open(url, '_blank');
  };

  const fetchSessionDetails = async (code) => {
    if (selectedSession === code) {
      // If clicking the same session, close it
      setSelectedSession(null);
      setSessionDetails(null);
      return;
    }

    try {
      setLoadingDetails(true);
      setSelectedSession(code);
      const response = await fetch(buildApiUrl(`/session/${code}`));
      if (!response.ok) {
        throw new Error('Failed to fetch session details');
      }
      const data = await response.json();
      setSessionDetails(data);
    } catch (err) {
      setErrorMessage(err.message);
      setSelectedSession(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDeleteClick = (code, sessionName, event) => {
    event.stopPropagation();
    setDeleteConfirm({ code, sessionName });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    
    try {
      const response = await fetch(buildApiUrl(`/session/${deleteConfirm.code}`), {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete session');
      }
      
      // Remove from local state
      setInstructorSessions(prev => prev.filter(s => s.code !== deleteConfirm.code));
      
      // Close details if this session was selected
      if (selectedSession === deleteConfirm.code) {
        setSelectedSession(null);
        setSessionDetails(null);
      }
      
      setDeleteConfirm(null);
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleDeleteAllConfirm = async () => {
    try {
      // Delete all sessions for this instructor
      const deletePromises = instructorSessions.map(session =>
        fetch(buildApiUrl(`/session/${session.code}`), { method: 'DELETE' })
      );
      
      await Promise.all(deletePromises);
      
      // Clear local state
      setInstructorSessions([]);
      setSelectedSession(null);
      setSessionDetails(null);
      setDeleteAllConfirm(false);
    } catch (err) {
      setErrorMessage('Failed to delete all sessions');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day} @ ${hours}:${minutes}`;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete':
        return '#10b981';
      case 'running':
        return '#3b82f6';
      case 'lobby':
        return '#f59e0b';
      case 'setup':
        return '#8b5cf6';  // Purple for setup
      default:
        return '#6b7280';
    }
  };

  return (
    <div className="app-shell">
      <div className="card">
        <header style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Instructor Dashboard</h1>
            <p style={{ color: '#6b7280' }}>Manage your game sessions</p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/history" style={{ textDecoration: 'none' }}>
              <button style={{ fontSize: '0.875rem' }}>All History</button>
            </Link>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <button style={{ fontSize: '0.875rem' }}>Student View</button>
            </Link>
          </div>
        </header>

        {/* Create New Session Section */}
        <section style={{ marginBottom: '2rem', padding: '1.5rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Create New Session</h2>
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
                <label>Rounds</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={instructorConfig.rounds}
                  onChange={event => {
                    const newRounds = event.target.value === '' ? '' : Number(event.target.value);
                    setInstructorConfig(cfg => {
                      // If different time per round is enabled, adjust the array
                      if (cfg.differentTimePerRound) {
                        const numRounds = newRounds === '' ? 1 : newRounds;
                        const newRoundTimes = Array(numRounds).fill(0).map((_, i) => 
                          cfg.roundTimes[i] || cfg.roundTime
                        );
                        return { ...cfg, rounds: newRounds, roundTimes: newRoundTimes };
                      }
                      return { ...cfg, rounds: newRounds };
                    });
                  }}
                  onBlur={event => {
                    if (event.target.value === '') {
                      setInstructorConfig(cfg => ({ ...cfg, rounds: 1 }));
                    }
                  }}
                />
              </div>
              
              <div className="input-row">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={instructorConfig.differentTimePerRound}
                    onChange={event => {
                      const checked = event.target.checked;
                      setInstructorConfig(cfg => {
                        // Initialize roundTimes array when enabling
                        const roundTimes = checked 
                          ? Array(Number(cfg.rounds)).fill(cfg.roundTime)
                          : [];
                        return { ...cfg, differentTimePerRound: checked, roundTimes };
                      });
                    }}
                    style={{ width: 'auto', cursor: 'pointer' }}
                  />
                  <span>Set different time for each round</span>
                </label>
              </div>
              
              {!instructorConfig.differentTimePerRound && (
                <div className="input-row">
                  <label>Seconds per round</label>
                  <input
                    type="number"
                    min="10"
                    step="1"
                    value={instructorConfig.roundTime}
                    onChange={event => {
                      const value = event.target.value === '' ? '' : Number(event.target.value);
                      setInstructorConfig(cfg => ({ ...cfg, roundTime: value }));
                    }}
                    onBlur={event => {
                      if (event.target.value === '') {
                        setInstructorConfig(cfg => ({ ...cfg, roundTime: 10 }));
                      }
                    }}
                  />
                </div>
              )}
              
              {instructorConfig.differentTimePerRound && (
                <div className="input-row">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.5rem' }}>
                    {Array.from({ length: Number(instructorConfig.rounds) }).map((_, i) => {
                      // Get the value, defaulting to roundTime only if undefined
                      const currentValue = instructorConfig.roundTimes[i] !== undefined 
                        ? instructorConfig.roundTimes[i] 
                        : instructorConfig.roundTime;
                      
                      return (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.75rem', color: '#6b7280', fontWeight: 500 }}>
                            Round {i + 1}
                          </label>
                          <input
                            type="number"
                            min="10"
                            step="1"
                            value={currentValue}
                            onChange={event => {
                              const value = event.target.value === '' ? '' : Number(event.target.value);
                              const newRoundTimes = [...(instructorConfig.roundTimes || [])];
                              // Ensure array is large enough
                              while (newRoundTimes.length <= i) {
                                newRoundTimes.push(instructorConfig.roundTime);
                              }
                              newRoundTimes[i] = value;
                              setInstructorConfig(cfg => ({ ...cfg, roundTimes: newRoundTimes }));
                            }}
                            onBlur={event => {
                              if (event.target.value === '') {
                                const newRoundTimes = [...(instructorConfig.roundTimes || [])];
                                while (newRoundTimes.length <= i) {
                                  newRoundTimes.push(instructorConfig.roundTime);
                                }
                                newRoundTimes[i] = 10;
                                setInstructorConfig(cfg => ({ ...cfg, roundTimes: newRoundTimes }));
                              }
                            }}
                            style={{ padding: '0.5rem', fontSize: '0.875rem' }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              
              <div className="input-row">
                <label>Break between rounds (seconds)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={instructorConfig.breakTime}
                  onChange={event => {
                    const value = event.target.value === '' ? '' : Number(event.target.value);
                    setInstructorConfig(cfg => ({ ...cfg, breakTime: value }));
                  }}
                  onBlur={event => {
                    if (event.target.value === '') {
                      setInstructorConfig(cfg => ({ ...cfg, breakTime: 0 }));
                    }
                  }}
                />
              </div>
              <div className="input-row">
                <label>Market size</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={instructorConfig.marketSize}
                  onChange={event => {
                    const value = event.target.value === '' ? '' : Number(event.target.value);
                    setInstructorConfig(cfg => ({ ...cfg, marketSize: value }));
                  }}
                  onBlur={event => {
                    if (event.target.value === '') {
                      setInstructorConfig(cfg => ({ ...cfg, marketSize: 1 }));
                    }
                  }}
                />
              </div>
              
              <div className="input-row">
                <label>Competition Model</label>
                <select
                  value={instructorConfig.modelType}
                  onChange={event => setInstructorConfig(cfg => ({ ...cfg, modelType: event.target.value }))}
                  style={{ padding: '0.5rem', fontSize: '1rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
                >
                  <option value="logit">Logit Model</option>
                  <option value="hotelling">Hotelling Model</option>
                </select>
              </div>
              
              {instructorConfig.modelType === 'logit' && (
                <>
                  <div className="input-row">
                    <label>Price sensitivity (alpha)</label>
                    <input
                      type="number"
                      step="any"
                      value={instructorConfig.alpha}
                      onChange={event => {
                        const value = event.target.value === '' ? '' : Number(event.target.value);
                        setInstructorConfig(cfg => ({ ...cfg, alpha: value }));
                      }}
                      onBlur={event => {
                        if (event.target.value === '') {
                          setInstructorConfig(cfg => ({ ...cfg, alpha: 1 }));
                        }
                      }}
                    />
                  </div>
                  <div className="input-row">
                    <label>Differentiation (sigma)</label>
                    <input
                      type="number"
                      step="any"
                      value={instructorConfig.sigma}
                      onChange={event => {
                        const value = event.target.value === '' ? '' : Number(event.target.value);
                        setInstructorConfig(cfg => ({ ...cfg, sigma: value }));
                      }}
                      onBlur={event => {
                        if (event.target.value === '') {
                          setInstructorConfig(cfg => ({ ...cfg, sigma: 1 }));
                        }
                      }}
                    />
                  </div>
                </>
              )}
              
              {instructorConfig.modelType === 'hotelling' && (
                <>
                  <div className="input-row">
                    <label>Travel cost (t)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={instructorConfig.travelCost}
                      onChange={event => {
                        const value = event.target.value === '' ? '' : Number(event.target.value);
                        setInstructorConfig(cfg => ({ ...cfg, travelCost: value }));
                      }}
                      onBlur={event => {
                        // Convert to number on blur if empty
                        if (event.target.value === '') {
                          setInstructorConfig(cfg => ({ ...cfg, travelCost: 0 }));
                        }
                      }}
                    />
                  </div>
                  <div className="input-row">
                    <label>Consumer valuation (V)</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={instructorConfig.consumerValue}
                      onChange={event => {
                        const value = event.target.value === '' ? '' : Number(event.target.value);
                        setInstructorConfig(cfg => ({ ...cfg, consumerValue: value }));
                      }}
                      onBlur={event => {
                        // Convert to number on blur if empty
                        if (event.target.value === '') {
                          setInstructorConfig(cfg => ({ ...cfg, consumerValue: 0 }));
                        }
                      }}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                    <div className="input-row">
                      <label>Firm 1 location (x₁)</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        value={instructorConfig.x1}
                        onChange={event => {
                          const value = event.target.value === '' ? '' : Number(event.target.value);
                          setInstructorConfig(cfg => ({ ...cfg, x1: value }));
                        }}
                        onBlur={event => {
                          if (event.target.value === '') {
                            setInstructorConfig(cfg => ({ ...cfg, x1: 0 }));
                          }
                        }}
                      />
                    </div>
                    <div className="input-row">
                      <label>Firm 2 location (x₂)</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        value={instructorConfig.x2}
                        onChange={event => {
                          const value = event.target.value === '' ? '' : Number(event.target.value);
                          setInstructorConfig(cfg => ({ ...cfg, x2: value }));
                        }}
                        onBlur={event => {
                          if (event.target.value === '') {
                            setInstructorConfig(cfg => ({ ...cfg, x2: 0 }));
                          }
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
                <div className="input-row">
                  <label>Min price</label>
                  <input
                    type="number"
                    step="any"
                    value={instructorConfig.priceMin}
                    onChange={event => {
                      const value = event.target.value === '' ? '' : Number(event.target.value);
                      setInstructorConfig(cfg => ({ ...cfg, priceMin: value }));
                    }}
                    onBlur={event => {
                      if (event.target.value === '') {
                        setInstructorConfig(cfg => ({ ...cfg, priceMin: 0 }));
                      }
                    }}
                  />
                </div>
                <div className="input-row">
                  <label>Max price</label>
                  <input
                    type="number"
                    step="any"
                    value={instructorConfig.priceMax}
                    onChange={event => {
                      const value = event.target.value === '' ? '' : Number(event.target.value);
                      setInstructorConfig(cfg => ({ ...cfg, priceMax: value }));
                    }}
                    onBlur={event => {
                      if (event.target.value === '') {
                        setInstructorConfig(cfg => ({ ...cfg, priceMax: 100 }));
                      }
                    }}
                  />
                </div>
              </div>
              
              <div className="input-row" style={{ marginTop: '1rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={instructorConfig.enableChat}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, enableChat: event.target.checked }))}
                    style={{ width: 'auto', cursor: 'pointer' }}
                  />
                  <span>Enable chat between paired students</span>
                </label>
                <small style={{ color: '#6b7280', fontSize: '0.875rem', marginLeft: '1.75rem' }}>
                  💬 Students matched together can chat during the game
                </small>
              </div>

              <div className="input-row">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={instructorConfig.hideRoundCount}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, hideRoundCount: event.target.checked }))}
                    style={{ width: 'auto', cursor: 'pointer' }}
                  />
                  <span>Hide total number of rounds from students</span>
                </label>
                <small style={{ color: '#6b7280', fontSize: '0.875rem', marginLeft: '1.75rem' }}>
                  🔢 Students will see "Round X" instead of "Round X of Y"
                </small>
              </div>

              <div className="input-row">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={instructorConfig.showOpponentName}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, showOpponentName: event.target.checked }))}
                    style={{ width: 'auto', cursor: 'pointer' }}
                  />
                  <span>Show opponent names to students</span>
                </label>
                <small style={{ color: '#6b7280', fontSize: '0.875rem', marginLeft: '1.75rem' }}>
                  👥 Students will see who they are paired with during the game
                </small>
              </div>

              <div className="input-row">
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={instructorConfig.showModelParameters}
                    onChange={event => setInstructorConfig(cfg => ({ ...cfg, showModelParameters: event.target.checked }))}
                    style={{ width: 'auto', cursor: 'pointer' }}
                  />
                  <span>Show model parameters to students</span>
                </label>
                <small style={{ color: '#6b7280', fontSize: '0.875rem', marginLeft: '1.75rem' }}>
                  📊 Students will see the detailed market parameters (travel cost, consumer value, etc.)
                </small>
              </div>

              <button type="submit" className="primary">
                Create Session
              </button>
              {errorMessage && <p style={{ color: '#dc2626' }}>{errorMessage}</p>}
            </form>
          )}
        </section>

        {/* Session History Section */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Session History ({instructorSessions.length})</h2>
            {instructorSessions.length > 0 && (
              <button
                onClick={() => setDeleteAllConfirm(true)}
                style={{
                  backgroundColor: '#dc2626',
                  color: 'white',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                🗑️ Delete All Sessions
              </button>
            )}
          </div>
          
          {loading ? (
            <p style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>Loading sessions...</p>
          ) : instructorSessions.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
              <p>No sessions found. Create your first game!</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Session Name</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Students</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Rounds</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {instructorSessions.map((session) => (
                  <React.Fragment key={session.code}>
                    <tr 
                      onClick={() => fetchSessionDetails(session.code)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: selectedSession === session.code ? '#f3f4f6' : 'transparent'
                      }}
                      onMouseEnter={(e) => {
                        if (selectedSession !== session.code) {
                          e.currentTarget.style.backgroundColor = '#f9fafb';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedSession !== session.code) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <td style={{ fontWeight: 600 }}>
                        <span style={{ marginRight: '0.5rem' }}>
                          {selectedSession === session.code ? '▼' : '▶'}
                        </span>
                        <Link 
                          to={`/manage/${session.code}`}
                          state={{ instructorName: instructorName }}
                          onClick={(e) => e.stopPropagation()}
                          style={{ 
                            color: '#3b82f6', 
                            textDecoration: 'none',
                            fontWeight: 600
                          }}
                          title="Open session management"
                        >
                          {session.sessionName || session.code}
                        </Link>
                      </td>
                      <td>
                        <span style={{ fontWeight: 'bold' }}>
                          {session.code}
                        </span>
                      </td>
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
                      <td>
                        <span style={{ fontWeight: 500 }}>
                          {session.studentCount || 0}
                        </span>
                      </td>
                      <td>{formatDate(session.createdAt)}</td>
                      <td>
                        {session.status === 'complete' ? formatDate(session.completedAt) : '-'}
                      </td>
                      <td>{session.config?.rounds || 'N/A'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={(e) => handleDownload(session.code, e)}
                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.875rem' }}
                          >
                            CSV
                          </button>
                          <button
                            onClick={(e) => handleDeleteClick(session.code, session.sessionName || session.code, e)}
                            style={{ 
                              padding: '0.25rem 0.75rem', 
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
                    {selectedSession === session.code && sessionDetails && (
                      <tr>
                        <td colSpan="8" style={{ padding: '1.5rem', backgroundColor: '#f9fafb' }}>
                          <div>
                            <h3 style={{ marginTop: 0 }}>Session Statistics</h3>
                            
                            {/* Configuration */}
                            <div style={{ marginBottom: '1.5rem' }}>
                              <h4 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                Configuration
                              </h4>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
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
                                <div>
                                  <strong>Price Range:</strong> ${sessionDetails.config?.priceBounds?.min} - ${sessionDetails.config?.priceBounds?.max}
                                </div>
                                <div>
                                  <strong>Total Rounds:</strong> {sessionDetails.config?.rounds}
                                </div>
                              </div>
                            </div>

                            {/* Players */}
                            {sessionDetails.players && sessionDetails.players.length > 0 && (
                              <div style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  Players ({sessionDetails.players.filter(p => p.role === 'student').length} students)
                                </h4>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  {sessionDetails.players.filter(p => p.role === 'student').map((player, idx) => (
                                    <span 
                                      key={idx}
                                      style={{ 
                                        padding: '0.25rem 0.75rem', 
                                        backgroundColor: '#e5e7eb', 
                                        borderRadius: '12px',
                                        fontSize: '0.875rem'
                                      }}
                                    >
                                      {player.name} {player.pairId && `(${player.pairId})`}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Round-by-Round Summary */}
                            {sessionDetails.rounds && sessionDetails.rounds.length > 0 && (
                              <div>
                                <h4 style={{ color: '#6b7280', fontSize: '0.875rem', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  Round-by-Round Results
                                </h4>
                                <table className="table" style={{ fontSize: '0.875rem' }}>
                                  <thead>
                                    <tr>
                                      <th>Round</th>
                                      <th>Player</th>
                                      <th>Price</th>
                                      <th>Opponent</th>
                                      <th>Opp. Price</th>
                                      <th>Profit</th>
                                      <th>Market Share</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sessionDetails.rounds.flatMap((round) =>
                                      round.results.map((result, idx) => (
                                        <tr key={`${round.round}-${idx}`}>
                                          <td>{round.round}</td>
                                          <td>{result.playerName}</td>
                                          <td>${result.price.toFixed(2)}</td>
                                          <td>{result.opponentName}</td>
                                          <td>${result.opponentPrice.toFixed(2)}</td>
                                          <td style={{ 
                                            color: result.profit > result.opponentPrice * (sessionDetails.config.marketSize / 2) ? '#10b981' : '#6b7280',
                                            fontWeight: 600
                                          }}>
                                            ${result.profit.toFixed(2)}
                                          </td>
                                          <td>{(result.marketShare * 100).toFixed(1)}%</td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>

                                {/* Summary Statistics */}
                                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'white', borderRadius: '8px' }}>
                                  <h4 style={{ marginTop: 0 }}>Summary Statistics</h4>
                                  {(() => {
                                    const allResults = sessionDetails.rounds.flatMap(r => r.results);
                                    const playerStats = {};
                                    
                                    allResults.forEach(result => {
                                      if (!playerStats[result.playerName]) {
                                        playerStats[result.playerName] = {
                                          totalProfit: 0,
                                          avgPrice: 0,
                                          avgShare: 0,
                                          rounds: 0
                                        };
                                      }
                                      playerStats[result.playerName].totalProfit += result.profit;
                                      playerStats[result.playerName].avgPrice += result.price;
                                      playerStats[result.playerName].avgShare += result.marketShare;
                                      playerStats[result.playerName].rounds += 1;
                                    });

                                    // Calculate averages
                                    Object.keys(playerStats).forEach(name => {
                                      const stats = playerStats[name];
                                      stats.avgPrice = stats.avgPrice / stats.rounds;
                                      stats.avgShare = stats.avgShare / stats.rounds;
                                    });

                                    // Sort by total profit
                                    const sortedPlayers = Object.entries(playerStats).sort((a, b) => b[1].totalProfit - a[1].totalProfit);

                                    return (
                                      <table className="table" style={{ fontSize: '0.875rem' }}>
                                        <thead>
                                          <tr>
                                            <th>Rank</th>
                                            <th>Player</th>
                                            <th>Total Profit</th>
                                            <th>Avg Price</th>
                                            <th>Avg Market Share</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sortedPlayers.map(([name, stats], idx) => (
                                            <tr key={name}>
                                              <td>
                                                <strong>
                                                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                                                </strong>
                                              </td>
                                              <td style={{ fontWeight: 600 }}>{name}</td>
                                              <td style={{ color: '#10b981', fontWeight: 600 }}>
                                                ${stats.totalProfit.toFixed(2)}
                                              </td>
                                              <td>${stats.avgPrice.toFixed(2)}</td>
                                              <td>{(stats.avgShare * 100).toFixed(1)}%</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    {selectedSession === session.code && loadingDetails && (
                      <tr>
                        <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', backgroundColor: '#f9fafb' }}>
                          Loading session details...
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div 
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000
            }}
            onClick={() => setDeleteConfirm(null)}
          >
            <div 
              style={{
                backgroundColor: 'white',
                padding: '2rem',
                borderRadius: '8px',
                maxWidth: '500px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ marginTop: 0, color: '#dc2626' }}>⚠️ Delete Session?</h2>
              <p style={{ fontSize: '1rem', marginBottom: '1rem' }}>
                Are you sure you want to permanently delete:
              </p>
              <p style={{ 
                fontWeight: 'bold', 
                fontSize: '1.1rem', 
                padding: '0.75rem', 
                backgroundColor: '#fee2e2',
                borderRadius: '4px',
                marginBottom: '1rem'
              }}>
                "{deleteConfirm.sessionName}" ({deleteConfirm.code})
              </p>
              <div style={{
                padding: '1rem',
                backgroundColor: '#fef3c7',
                borderLeft: '4px solid #f59e0b',
                marginBottom: '1.5rem',
                borderRadius: '4px'
              }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
                  ⚠️ WARNING: This action cannot be undone!
                </p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                  All data including players, rounds, and results will be permanently deleted from the database.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#e5e7eb',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Delete Permanently
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete All Confirmation Modal */}
        {deleteAllConfirm && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '2rem',
              borderRadius: '8px',
              maxWidth: '500px',
              width: '90%'
            }}>
              <h3 style={{ marginTop: 0 }}>Delete All Sessions?</h3>
              <p>
                Are you sure you want to delete <strong>all {instructorSessions.length} session(s)</strong>?
              </p>
              <div style={{
                padding: '1rem',
                backgroundColor: '#fef2f2',
                border: '1px solid #fca5a5',
                color: '#991b1b',
                marginBottom: '1.5rem',
                borderRadius: '4px'
              }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
                  ⚠️ WARNING: This action cannot be undone!
                </p>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem' }}>
                  All sessions including players, rounds, and results will be permanently deleted from the database.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setDeleteAllConfirm(false)}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#e5e7eb',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAllConfirm}
                  style={{
                    padding: '0.5rem 1.5rem',
                    fontSize: '1rem',
                    backgroundColor: '#dc2626',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  Delete All Permanently
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
