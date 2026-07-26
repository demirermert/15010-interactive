import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { socket } from '../socket';

// Random name generation (same as pricing game)
const firstNames = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Parker',
  'Quinn', 'Reese', 'Cameron', 'Dakota', 'Skylar', 'Hayden', 'Rowan', 'Sage'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Moore'
];

function generateRandomName() {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const randomNum = Math.floor(Math.random() * 1000);
  return `${firstName} ${lastName} ${randomNum}`;
}

export default function UltimatumStudentPage() {
  const navigate = useNavigate();
  const { sessionCode: urlSessionCode, studentId } = useParams();
  
  const [sessionCode, setSessionCode] = useState(urlSessionCode || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [joined, setJoined] = useState(false);
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  
  // Game state
  const [playerType, setPlayerType] = useState(null); // 1 or 2
  const [phase, setPhase] = useState('lobby'); // 'lobby', 'proposing', 'responding', 'result', 'complete'
  const [offerAmount, setOfferAmount] = useState('');
  const [receivedOffer, setReceivedOffer] = useState(null);
  const [timer, setTimer] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [roundResult, setRoundResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [partnerName, setPartnerName] = useState(null);

  useEffect(() => {
    // Load saved data from localStorage
    const savedName = localStorage.getItem('ultimatum_playerName');
    const savedCode = localStorage.getItem('ultimatum_studentCode');
    
    // Parse first and last name if saved
    if (savedName) {
      const parts = savedName.split(' ');
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(' '));
      }
    }
    
    // Auto-join if we have URL params
    if (urlSessionCode && (savedCode || studentId)) {
      const codeToUse = studentId || savedCode;
      handleJoin(urlSessionCode, savedName || '', codeToUse);
    }

    socket.on('joinedSession', handleJoinedSession);
    socket.on('sessionUpdate', handleSessionUpdate);
    socket.on('errorMessage', handleError);
    socket.on('timerUpdate', handleTimerUpdate);
    socket.on('ultimatum:receiveOffer', handleReceiveOffer);
    socket.on('ultimatum:offerSubmitted', handleOfferSubmitted);
    socket.on('ultimatum:decisionSubmitted', handleDecisionSubmitted);
    socket.on('ultimatum:roundResult', handleRoundResult);
    socket.on('ultimatum:roundState', handleRoundState);

    return () => {
      socket.off('joinedSession', handleJoinedSession);
      socket.off('sessionUpdate', handleSessionUpdate);
      socket.off('errorMessage', handleError);
      socket.off('timerUpdate', handleTimerUpdate);
      socket.off('ultimatum:receiveOffer', handleReceiveOffer);
      socket.off('ultimatum:offerSubmitted', handleOfferSubmitted);
      socket.off('ultimatum:decisionSubmitted', handleDecisionSubmitted);
      socket.off('ultimatum:roundResult', handleRoundResult);
      socket.off('ultimatum:roundState', handleRoundState);
    };
  }, [urlSessionCode, studentId]);

  const handleJoin = (code, name, studentCode) => {
    socket.emit('joinSession', {
      sessionCode: code || sessionCode,
      playerName: name || playerName,
      role: 'student',
      studentCode: studentCode || undefined
    });
  };

  const handleJoinedSession = (data) => {
    setJoined(true);
    setSession(data);
    setPhase(data.status);
    
    if (data.studentCode) {
      localStorage.setItem('ultimatum_studentCode', data.studentCode);
    }
    if (data.playerName) {
      localStorage.setItem('ultimatum_playerName', data.playerName);
      // Store individual names for form persistence
      const parts = data.playerName.split(' ');
      if (parts.length >= 2) {
        setFirstName(parts[0]);
        setLastName(parts.slice(1).join(' '));
      }
    }
    
    // Navigate to student-specific URL
    if (data.code && data.studentCode && !urlSessionCode) {
      navigate(`/ult/session/${data.code}/${data.studentCode}`, { replace: true });
    }
  };

  const handleSessionUpdate = (data) => {
    setSession(data);
    setPhase(data.status);
    
    // Find my player type
    const me = data.players?.find(p => p.socketId === socket.id);
    if (me) {
      setPlayerType(me.playerType);
      
      // Find partner name if paired
      if (me.pairId && data.players) {
        const partner = data.players.find(p => p.pairId === me.pairId && p.socketId !== socket.id);
        if (partner) {
          setPartnerName(partner.name);
        }
      }
    }
  };

  const handleError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 5000);
  };

  const handleTimerUpdate = ({ remaining }) => {
    setTimer(remaining);
  };

  const handleReceiveOffer = ({ amount }) => {
    setReceivedOffer(amount);
    setSubmitted(false);
  };

  const handleOfferSubmitted = () => {
    setSubmitted(true);
  };

  const handleDecisionSubmitted = () => {
    setSubmitted(true);
  };

  const handleRoundResult = (result) => {
    setRoundResult(result);
    setHistory(prev => [...prev, result]);
    setSubmitted(false);
    setReceivedOffer(null);
    setOfferAmount('');
  };

  const handleRoundState = (state) => {
    setPhase(state.status);
    setTimer(state.remainingTime);
    if (state.offer !== null) {
      setReceivedOffer(state.offer);
    }
  };

  const submitForm = (e) => {
    e.preventDefault();
    setError('');
    
    if (!sessionCode.trim()) {
      setError('Enter a session code');
      return;
    }
    
    // Clear old ultimatum session data
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('ultimatum_')) {
        localStorage.removeItem(key);
      }
    });
    
    // If names are not provided, generate a random name
    let fullName;
    if (!firstName.trim() || !lastName.trim()) {
      fullName = generateRandomName();
    } else {
      fullName = `${firstName.trim()} ${lastName.trim()}`;
    }
    
    handleJoin(sessionCode.trim().toUpperCase(), fullName);
  };

  const submitOffer = () => {
    const amount = parseInt(offerAmount, 10);
    if (isNaN(amount) || amount < 0 || amount > 20) {
      setError('Offer must be between 0 and 20');
      return;
    }
    socket.emit('ultimatum:makeOffer', { sessionCode: session.code, amount });
  };

  const submitDecision = (accepted) => {
    socket.emit('ultimatum:makeDecision', { sessionCode: session.code, accepted });
  };

  if (!joined) {
    return (
      <div className="app-shell">
        <div className="card student-join-card">
          {/* Logos Container - Responsive */}
          <div className="logos-container">
            <img 
              src="/course-logo.png" 
              alt="Course Logo"
              className="logo-left"
            />
            <img 
              src="/sloan-logo.png" 
              alt="MIT Sloan School of Management"
              className="logo-right"
            />
          </div>

          {/* Header */}
          <div className="student-header">
            <h1>Ultimatum Game</h1>
            <p>Economic Analysis of Business Decisions</p>
          </div>

          <form onSubmit={submitForm} className="student-form">
            <div className="name-inputs">
              <div className="input-row">
                <label htmlFor="first-name">First name</label>
                <input
                  id="first-name"
                  type="text"
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                />
              </div>
              <div className="input-row">
                <label htmlFor="last-name">Last name</label>
                <input
                  id="last-name"
                  type="text"
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="input-row">
              <label htmlFor="session-code">Session code</label>
              <input
                id="session-code"
                type="text"
                value={sessionCode}
                onChange={e => setSessionCode(e.target.value.toUpperCase())}
                required
              />
            </div>
            <button type="submit" className="primary">
              Join session
            </button>
          </form>
          {error && <p style={{ color: '#dc2626', marginTop: '1rem' }}>{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>🤝 Ultimatum Game</h1>
          <p style={{ color: '#6b7280' }}>Session: {session?.code}</p>
          
          {phase !== 'lobby' && timer > 0 && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: '#f9fafb',
              borderRadius: '8px'
            }}>
              <div style={{
                fontSize: '2rem',
                fontWeight: 700,
                color: timer <= 10 ? '#dc2626' : '#3b82f6',
                marginTop: '0.5rem'
              }}>
                {timer}s
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

        {/* Lobby */}
        {phase === 'lobby' && (
          <div style={{
            padding: '2rem',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⏳ Waiting to Start</h2>
            <p style={{ color: '#78350f' }}>
              Waiting for the instructor to start the game...
            </p>
            
            {/* Show partner name if paired */}
            {partnerName && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                backgroundColor: '#dbeafe',
                borderRadius: '8px',
                borderLeft: '4px solid #3b82f6'
              }}>
                <p style={{ margin: 0, color: '#1e40af', fontWeight: 600 }}>
                  👥 Paired with: <span style={{ color: '#3b82f6' }}>{partnerName}</span>
                </p>
              </div>
            )}
            
            <div style={{
              marginTop: '1.5rem',
              padding: '1.5rem',
              backgroundColor: 'white',
              borderRadius: '8px',
              textAlign: 'left'
            }}>
              <h3 style={{ marginTop: 0 }}>How to Play:</h3>
              <p>You'll be paired with another student.</p>
              <p><strong>If you're Player 1 (Proposer):</strong><br/>
              You'll have {session?.config?.proposeTime || 10} seconds to offer any amount from $0 to $20 to your partner.</p>
              <p><strong>If you're Player 2 (Responder):</strong><br/>
              You'll see the offer and have {session?.config?.respondTime || 10} seconds to accept or reject it.</p>
              <p><strong>Payoffs:</strong><br/>
              • If accepted: Player 1 gets $(20 - offer), Player 2 gets $offer<br/>
              • If rejected: Both players get $0</p>
            </div>
          </div>
        )}

        {/* Proposing Phase - Player 1 */}
        {phase === 'proposing' && playerType === 1 && !submitted && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              padding: '1.5rem',
              backgroundColor: '#dbeafe',
              borderRadius: '8px',
              marginBottom: '2rem'
            }}>
              <h2 style={{ fontSize: '1.5rem', margin: 0 }}>💰 You are Player 1 (Proposer)</h2>
              <p style={{ margin: '0.5rem 0 0 0', color: '#1e40af' }}>
                Make an offer to {partnerName ? <strong>{partnerName}</strong> : 'your partner'}
              </p>
            </div>

            <div style={{ maxWidth: '500px', margin: '0 auto' }}>
              <div style={{
                padding: '2rem',
                backgroundColor: '#f9fafb',
                borderRadius: '12px',
                marginBottom: '1.5rem'
              }}>
                <div style={{ fontSize: '1.125rem', color: '#6b7280', marginBottom: '1rem', textAlign: 'center' }}>
                  How much do you want to offer?
                </div>
                <div style={{
                  fontSize: '4rem',
                  fontWeight: 700,
                  color: '#3b82f6',
                  textAlign: 'center',
                  marginBottom: '2rem'
                }}>
                  ${offerAmount || 0}
                </div>
                
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={offerAmount || 0}
                  onChange={(e) => setOfferAmount(e.target.value)}
                  style={{
                    width: '100%',
                    height: '12px',
                    borderRadius: '6px',
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${(offerAmount || 0) * 5}%, #e5e7eb ${(offerAmount || 0) * 5}%, #e5e7eb 100%)`,
                    outline: 'none',
                    cursor: 'pointer',
                    WebkitAppearance: 'none',
                    appearance: 'none'
                  }}
                />
                
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: '0.5rem',
                  fontSize: '0.875rem',
                  color: '#6b7280'
                }}>
                  <span>$0</span>
                  <span>$10</span>
                  <span>$20</span>
                </div>
                
                <div style={{
                  marginTop: '1.5rem',
                  padding: '1rem',
                  backgroundColor: '#e0f2fe',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  color: '#0c4a6e'
                }}>
                  💡 <strong>Your payoff if accepted:</strong> ${20 - (offerAmount || 0)}<br/>
                  💡 <strong>Partner's payoff if accepted:</strong> ${offerAmount || 0}
                </div>
              </div>
              
              <button
                onClick={submitOffer}
                className="primary"
                style={{
                  width: '100%',
                  padding: '1.25rem',
                  fontSize: '1.25rem',
                  fontWeight: 600
                }}
              >
                Submit Offer
              </button>
            </div>
          </div>
        )}

        {/* Proposing Phase - Player 2 Waiting */}
        {phase === 'proposing' && playerType === 2 && (
          <div style={{
            padding: '2rem',
            backgroundColor: '#f0f9ff',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⏳ You are Player 2 (Responder)</h2>
            <p style={{ color: '#1e40af', fontSize: '1.125rem' }}>
              Waiting for {partnerName ? <strong>{partnerName}</strong> : 'Player 1'} to make an offer...
            </p>
          </div>
        )}

        {/* Waiting after submission */}
        {submitted && phase === 'proposing' && (
          <div style={{
            padding: '2rem',
            backgroundColor: '#d1fae5',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>✓ Offer Submitted</h2>
            <p style={{ color: '#065f46' }}>Waiting for the round to continue...</p>
          </div>
        )}

        {/* Responding Phase - Player 2 */}
        {phase === 'responding' && playerType === 2 && !submitted && receivedOffer !== null && (
          <div style={{ textAlign: 'center' }}>
            <div style={{
              padding: '1.5rem',
              backgroundColor: '#fef3c7',
              borderRadius: '8px',
              marginBottom: '2rem'
            }}>
              <h2 style={{ fontSize: '1.5rem', margin: 0 }}>🤔 You are Player 2 (Responder)</h2>
              <p style={{ margin: '0.5rem 0 0 0', color: '#92400e' }}>
                {partnerName ? <strong>{partnerName}</strong> : 'Player 1'} has made an offer
              </p>
            </div>

            <div style={{
              padding: '2rem',
              backgroundColor: '#f9fafb',
              borderRadius: '12px',
              marginBottom: '2rem'
            }}>
              <div style={{ fontSize: '1rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                {partnerName || 'Player 1'} offers you:
              </div>
              <div style={{ fontSize: '3.5rem', fontWeight: 700, color: '#10b981' }}>
                ${receivedOffer}
              </div>
              <div style={{ fontSize: '1rem', color: '#6b7280', marginTop: '1rem' }}>
                If you accept, {partnerName || 'Player 1'} gets ${20 - receivedOffer}
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem',
              maxWidth: '500px',
              margin: '0 auto'
            }}>
              <button
                onClick={() => submitDecision(false)}
                style={{
                  flex: 1,
                  padding: '1.25rem',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  backgroundColor: '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                ❌ Reject
              </button>
              <button
                onClick={() => submitDecision(true)}
                style={{
                  flex: 1,
                  padding: '1.25rem',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                ✓ Accept
              </button>
            </div>
          </div>
        )}

        {/* Responding Phase - Player 1 Waiting */}
        {phase === 'responding' && playerType === 1 && (
          <div style={{
            padding: '2rem',
            backgroundColor: '#f0f9ff',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⏳ Waiting for Response</h2>
            <p style={{ color: '#1e40af', fontSize: '1.125rem' }}>
              {partnerName ? <strong>{partnerName}</strong> : 'Player 2'} is deciding whether to accept your offer...
            </p>
          </div>
        )}

        {/* Waiting after decision submission */}
        {submitted && phase === 'responding' && (
          <div style={{
            padding: '2rem',
            backgroundColor: '#d1fae5',
            borderRadius: '8px',
            textAlign: 'center'
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>✓ Decision Submitted</h2>
            <p style={{ color: '#065f46' }}>Waiting for results...</p>
          </div>
        )}

        {/* Round Result */}
        {roundResult && (
          <div style={{ marginTop: '2rem' }}>
            <div style={{
              padding: '2rem',
              backgroundColor: roundResult.responder.accepted ? '#d1fae5' : '#fee2e2',
              borderRadius: '12px',
              textAlign: 'center',
              marginBottom: '2rem'
            }}>
              <h2 style={{ fontSize: '1.75rem', margin: '0 0 1rem 0' }}>
                {roundResult.responder.accepted ? '✓ Offer Accepted!' : '❌ Offer Rejected'}
              </h2>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
                marginTop: '1rem'
              }}>
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'white',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                    Player 1 ({roundResult.proposer.name})
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>
                    ${roundResult.proposer.payoff}
                  </div>
                </div>
                <div style={{
                  padding: '1rem',
                  backgroundColor: 'white',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                    Player 2 ({roundResult.responder.name})
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>
                    ${roundResult.responder.payoff}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>📊 Your History</h3>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse'
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Role</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Offer</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left' }}>Decision</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Payoff</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '0.75rem' }}>
                      {item.role === 'proposer' ? 'Player 1' : 'Player 2'}
                    </td>
                    <td style={{ padding: '0.75rem' }}>${item.proposer.offer}</td>
                    <td style={{ padding: '0.75rem' }}>
                      {item.responder.accepted ? '✓ Accepted' : '❌ Rejected'}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: '#10b981' }}>
                      ${item.role === 'proposer' ? item.proposer.payoff : item.responder.payoff}
                    </td>
                  </tr>
                ))}
                <tr style={{ backgroundColor: '#f9fafb', fontWeight: 700 }}>
                  <td colSpan="3" style={{ padding: '0.75rem' }}>Total Earnings</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontSize: '1.25rem', color: '#10b981' }}>
                    ${history.reduce((sum, item) => 
                      sum + (item.role === 'proposer' ? item.proposer.payoff : item.responder.payoff), 0
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Complete */}
        {phase === 'complete' && (
          <div style={{
            padding: '2rem',
            backgroundColor: '#dbeafe',
            borderRadius: '8px',
            textAlign: 'center',
            marginTop: '2rem'
          }}>
            <h2 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem 0' }}>🎉 Game Complete!</h2>
            <p style={{ color: '#1e40af' }}>Thank you for participating!</p>
          </div>
        )}
      </div>
    </div>
  );
}

