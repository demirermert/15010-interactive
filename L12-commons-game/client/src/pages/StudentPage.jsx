import React, { useEffect, useState, useRef } from 'react';
import { socket } from '../socket.js';
import { StudentView } from '../components/StudentView.jsx';

const RANDOM_NAMES = [
  'Fisher', 'Captain', 'Sailor', 'Navigator', 'Angler', 'Skipper',
  'Mariner', 'Voyager', 'Explorer', 'Hunter', 'Seeker', 'Tracker',
  'Ranger', 'Scout', 'Pathfinder', 'Pioneer', 'Adventurer', 'Wanderer'
];

function generateRandomName() {
  const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const number = Math.floor(Math.random() * 100);
  return `${name}${number}`;
}

export function StudentPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [sessionCodeInput, setSessionCodeInput] = useState('');
  const [session, setSession] = useState(null);
  const [joinInfo, setJoinInfo] = useState(null);
  const [roundInfo, setRoundInfo] = useState(null);
  const [timer, setTimer] = useState(0);
  const [roundActive, setRoundActive] = useState(false);
  const [latestResult, setLatestResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [countdown, setCountdown] = useState(null);
  const [gameComplete, setGameComplete] = useState(false);
  const [pondDepleted, setPondDepleted] = useState(false);
  
  // Use ref for pendingHistory to avoid recreating socket listeners
  const pendingHistoryRef = useRef(null);

  // Handle URL parameters for student persistence
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const playerName = params.get('name');
    
    if (code) {
      setSessionCodeInput(code);
      
      // Auto-join the session
      socket.emit('joinSession', {
        sessionCode: code,
        playerName: playerName || generateRandomName(),
        role: 'student'
      });
    }
  }, []);

  useEffect(() => {
    const handleJoinedSession = payload => {
      setJoinInfo(payload);
      // Only clear state if joining for the first time (not reconnecting to active game)
      if (payload.status !== 'running') {
        setRoundInfo(null);
        setHistory([]);
        setLatestResult(null);
      }
      setErrorMessage('');
    };
    const handleSessionUpdate = payload => {
      setSession(payload);
    };
    const handleRoundStarted = payload => {
      setRoundInfo(payload);
      setRoundActive(true);
      setHasSubmitted(false);
      // Use currentTimer if provided (for reconnection), otherwise use full roundTime
      setTimer(payload.currentTimer !== undefined ? payload.currentTimer : payload.roundTime);
      setCountdown(null); // Clear countdown when round starts
    };
    const handleRoundResults = payload => {
      setLatestResult(payload);
      // Store history but don't display yet - wait for countdown
      pendingHistoryRef.current = payload.history || [];
      setHasSubmitted(true);
      setRoundActive(false);
      
      // Check if pond is depleted
      if (payload.pondDepleted) {
        setPondDepleted(true);
        console.log('🚫 Pond depleted! Game over for this pond.');
      }
    };
    const handleRoundCountdown = payload => {
      setCountdown(payload);
      // Now update history when countdown starts (same time as "Previous Round Result" box)
      if (pendingHistoryRef.current) {
        setHistory(pendingHistoryRef.current);
        pendingHistoryRef.current = null;
      }
    };
    const handleSessionComplete = payload => {
      console.log('🎉 Received sessionComplete event:', payload);
      setRoundActive(false);
      setCountdown(null); // Clear countdown when session ends
      setGameComplete(true);
      // If there's pending history when game ends, update it now
      if (pendingHistoryRef.current) {
        setHistory(pendingHistoryRef.current);
        pendingHistoryRef.current = null;
      }
      console.log('✅ Game complete state set to true');
    };
    const handleError = message => {
      setErrorMessage(message);
    };

    socket.on('joinedSession', handleJoinedSession);
    socket.on('sessionUpdate', handleSessionUpdate);
    socket.on('roundStarted', handleRoundStarted);
    socket.on('roundResults', handleRoundResults);
    socket.on('roundCountdown', handleRoundCountdown);
    socket.on('sessionComplete', handleSessionComplete);
    socket.on('errorMessage', handleError);

    return () => {
      socket.off('joinedSession', handleJoinedSession);
      socket.off('sessionUpdate', handleSessionUpdate);
      socket.off('roundStarted', handleRoundStarted);
      socket.off('roundResults', handleRoundResults);
      socket.off('roundCountdown', handleRoundCountdown);
      socket.off('sessionComplete', handleSessionComplete);
      socket.off('errorMessage', handleError);
    };
  }, []);

  useEffect(() => {
    if (!roundActive) return;
    const interval = setInterval(() => {
      setTimer(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [roundActive, roundInfo?.round]);

  const handleJoinSession = event => {
    event.preventDefault();
    setErrorMessage('');
    if (!sessionCodeInput) {
      setErrorMessage('Enter a code');
      return;
    }
    
    // Check if socket is connected
    if (!socket.connected) {
      setErrorMessage('Not connected to server. Please refresh the page and try again.');
      console.error('❌ Cannot join: Socket not connected');
      return;
    }
    
    // Names are now required, so just use them directly
    const playerName = `${firstName.trim()} ${lastName.trim()}`;
    
    // Update URL for students to persist their session on refresh
    const url = new URL(window.location.href);
    url.searchParams.set('code', sessionCodeInput);
    url.searchParams.set('name', playerName);
    window.history.replaceState({}, '', url.toString());
    
    socket.emit('joinSession', {
      sessionCode: sessionCodeInput,
      playerName: playerName,
      role: 'student'
    });
  };

  const handleSubmitFish = fishCount => {
    if (!session?.code) return;
    socket.emit('submitFish', { sessionCode: session.code, fishCount });
    setHasSubmitted(true); // Immediately show feedback
  };

  if (!joinInfo) {
    return (
      <div className="app-shell">
        <div className="card" style={{ position: 'relative' }}>
          {/* Left Logo - Top Left Corner */}
          <img 
            src="/course-logo.png" 
            alt="Course Logo"
            className="course-logo"
            style={{ 
              position: 'absolute',
              top: '0.5rem',
              left: '0.5rem',
              width: '140px',
              maxWidth: '25vw',
              height: 'auto',
              opacity: 0.9
            }}
          />
          
          {/* MIT Sloan Logo - Top Right Corner */}
          <img 
            src="/sloan-logo.png" 
            alt="MIT Sloan School of Management"
            className="sloan-logo"
            style={{ 
              position: 'absolute',
              top: '0.5rem',
              right: '0.5rem',
              width: '140px',
              maxWidth: '25vw',
              height: 'auto',
              opacity: 0.9
            }}
          />

          {/* Header */}
          <div style={{ 
            textAlign: 'center',
            marginTop: 'clamp(5rem, 15vw, 4rem)',
            marginBottom: '2rem',
            paddingBottom: '1.5rem',
            paddingLeft: '1rem',
            paddingRight: '1rem',
            borderBottom: '2px solid #e5e7eb'
          }}>
            <h1 style={{ 
              fontSize: 'clamp(1.1rem, 4vw, 1.5rem)', 
              fontWeight: 700,
              color: '#1f2937',
              marginBottom: '0.5rem',
              marginTop: 0
            }}>
              Welcome to 15.010 Commons Game
            </h1>
          </div>

          <form onSubmit={handleJoinSession} style={{ display: 'grid', gap: '1rem' }}>
            <div className="name-inputs-grid">
              <div className="input-row">
                <label htmlFor="first-name">First name</label>
                <input
                  id="first-name"
                  type="text"
                  value={firstName}
                  onChange={event => setFirstName(event.target.value)}
                  required
                />
              </div>
              <div className="input-row">
                <label htmlFor="last-name">Last name</label>
                <input
                  id="last-name"
                  type="text"
                  value={lastName}
                  onChange={event => setLastName(event.target.value)}
                  required
                />
              </div>
            </div>
            <div className="input-row">
              <label htmlFor="session-code">Session code</label>
              <input
                id="session-code"
                type="text"
                value={sessionCodeInput}
                onChange={event => setSessionCodeInput(event.target.value.toUpperCase())}
                required
              />
            </div>
            <button type="submit" className="primary">
              Join session
            </button>
          </form>
          {errorMessage && (
            <div style={{ 
              marginTop: '1rem',
              padding: '1rem',
              backgroundColor: errorMessage === 'GAME_ALREADY_STARTED' ? '#fef3c7' : '#fee2e2',
              border: `2px solid ${errorMessage === 'GAME_ALREADY_STARTED' ? '#f59e0b' : '#dc2626'}`,
              borderRadius: '8px',
              color: errorMessage === 'GAME_ALREADY_STARTED' ? '#92400e' : '#991b1b'
            }}>
              {errorMessage === 'GAME_ALREADY_STARTED' ? (
                <>
                  <p style={{ fontWeight: 'bold', marginTop: 0, marginBottom: '0.5rem' }}>
                    ⚠️ Game Already Started
                  </p>
                  <p style={{ margin: 0 }}>
                    This session is already in progress. Please team up with someone else to see their screen and collaborate!
                  </p>
                </>
              ) : (
                <p style={{ margin: 0 }}>{errorMessage}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <StudentView
        sessionCode={session?.code || joinInfo.code}
        currentRound={roundInfo?.round || session?.currentRound || 0}
        totalRounds={session?.config?.rounds || 5}
        roundActive={roundActive}
        timer={timer}
        maxCatch={session?.config?.maxCatchPerRound || 4}
        remainingFish={(() => {
          // Priority order for getting fish count:
          // 1. Latest result (most accurate after round completion)
          // 2. Session ponds (updated during gameplay)
          // 3. Round info (initial value when round starts)
          
          const myPondId = roundInfo?.pondId || latestResult?.pondId;
          
          // First check if we have fish count from latest result
          if (latestResult?.fishAfterDoubling !== undefined) {
            return latestResult.fishAfterDoubling;
          }
          
          // Then check session ponds
          const myPond = session?.ponds?.find(p => p.id === myPondId);
          if (myPond?.remainingFish !== undefined) {
            return myPond.remainingFish;
          }
          
          // Finally fall back to round info
          return roundInfo?.remainingFish ?? 0;
        })()}
        onSubmitFish={handleSubmitFish}
        latestResult={latestResult}
        history={history}
        hasSubmitted={hasSubmitted}
        countdown={countdown}
        pondId={roundInfo?.pondId || latestResult?.pondId}
        pondPlayers={
          roundInfo?.pondId || latestResult?.pondId
            ? session?.ponds?.find(p => p.id === (roundInfo?.pondId || latestResult?.pondId))?.players
                ?.map(playerId => session?.players?.find(player => player.socketId === playerId)?.name || playerId)
            : []
        }
        initialFish={session?.config?.initialFish || 16}
        gameComplete={gameComplete}
        pondDepleted={pondDepleted}
        playersPerPond={session?.config?.playersPerPond || 4}
        pondPlayersResults={
          gameComplete && (roundInfo?.pondId || latestResult?.pondId)
            ? session?.ponds?.find(p => p.id === (roundInfo?.pondId || latestResult?.pondId))?.players
                ?.map(playerId => {
                  const player = session?.players?.find(player => player.socketId === playerId);
                  return {
                    name: player?.name || playerId,
                    totalFish: player?.totalFish || 0
                  };
                })
                ?.sort((a, b) => b.totalFish - a.totalFish)
            : []
        }
      />
    </div>
  );
}


