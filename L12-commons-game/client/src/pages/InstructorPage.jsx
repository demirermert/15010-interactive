import React, { useEffect, useMemo, useState } from 'react';
import { socket } from '../socket.js';
import { InstructorDashboard } from '../components/InstructorDashboard.jsx';

const DEFAULT_CONFIG = {
  rounds: 5,
  roundTime: 30,
  initialFish: 16,
  maxFish: 999999,
  maxCatchPerRound: 4,
  playersPerPond: 4
};

export function InstructorPage() {
  const [sessionCodeInput, setSessionCodeInput] = useState('');
  const [session, setSession] = useState(null);
  const [joinInfo, setJoinInfo] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [leaderboardData, setLeaderboardData] = useState(new Map());
  const [instructorConfig, setInstructorConfig] = useState(DEFAULT_CONFIG);
  const [countdown, setCountdown] = useState(null);
  const [roundTimer, setRoundTimer] = useState(null);
  const [roundActive, setRoundActive] = useState(false);
  const [currentRoundNumber, setCurrentRoundNumber] = useState(0);

  useEffect(() => {
    const handleJoinedSession = payload => {
      setJoinInfo(payload);
      setLeaderboardData(new Map());
      setErrorMessage('');
    };
    const handleSessionUpdate = payload => {
      setSession(payload);
      
      // If game is complete, update leaderboard with final player totals (includes split fish)
      if (payload.status === 'complete' && payload.players) {
        setLeaderboardData(prev => {
          const next = new Map();
          payload.players.forEach(player => {
            if (player.role === 'student') {
              next.set(player.socketId, {
                socketId: player.socketId,
                name: player.name,
                totalFish: player.totalFish
              });
            }
          });
          return next;
        });
      }
    };
    const handleRoundSummary = payload => {
      setRoundActive(false);
      setRoundTimer(null);
      setLeaderboardData(prev => {
        const next = new Map(prev);
        payload.results.forEach(entry => {
          const current = next.get(entry.socketId) || {
            socketId: entry.socketId,
            name: entry.name || entry.socketId,
            totalFish: 0
          };
          current.name = entry.name || current.name;
          current.totalFish = entry.totalFish;
          next.set(entry.socketId, current);
        });
        return next;
      });
    };
    const handleRoundStarted = payload => {
      setRoundActive(true);
      setRoundTimer(payload.roundTime);
      setCountdown(null);
      setCurrentRoundNumber(payload.round);
    };
    const handleRoundCountdown = payload => {
      setCountdown(payload);
    };
    const handleSessionComplete = payload => {
      setCountdown(null);
      setRoundActive(false);
      setRoundTimer(null);
      
      // Update leaderboard with final round results
      if (payload.rounds && payload.rounds.length > 0) {
        const finalRound = payload.rounds[payload.rounds.length - 1];
        setLeaderboardData(prev => {
          const next = new Map(prev);
          finalRound.results.forEach(entry => {
            const current = next.get(entry.socketId) || {
              socketId: entry.socketId,
              name: entry.name || entry.socketId,
              totalFish: 0
            };
            current.name = entry.name || current.name;
            current.totalFish = entry.totalFish;
            next.set(entry.socketId, current);
          });
          return next;
        });
      }
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

  const leaderboard = useMemo(() => {
    return Array.from(leaderboardData.values())
      .sort((a, b) => b.totalFish - a.totalFish);
  }, [leaderboardData]);

  const handleCreateSession = async event => {
    event.preventDefault();
    setErrorMessage('');
    try {
      const payload = {
        instructorName: 'Instructor',
        config: {
          rounds: Number(instructorConfig.rounds),
          roundTime: Number(instructorConfig.roundTime),
          initialFish: Number(instructorConfig.initialFish),
          maxCatchPerRound: Number(instructorConfig.maxCatchPerRound),
          playersPerPond: Number(instructorConfig.playersPerPond)
        }
      };
      
      const API_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4001';
      console.log('🔗 Creating session at:', `${API_URL}/session`);
      
      const response = await fetch(`${API_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Failed to create session');
      }
      const data = await response.json();
      setSessionCodeInput(data.code);
      socket.emit('joinSession', {
        sessionCode: data.code,
        playerName: 'Instructor',
        role: 'instructor'
      });
    } catch (err) {
      setErrorMessage(err.message);
    }
  };

  const handleStartSession = () => {
    const sessionCode = session?.code || joinInfo?.code;
    if (!sessionCode) return;
    setErrorMessage('');
    socket.emit('startSession', { sessionCode });
  };

  if (!joinInfo) {
    return (
      <div className="app-shell">
        <div className="card">
          <h1>Tragedy of the Commons - Instructor</h1>
          <h2>Create session</h2>
          <form onSubmit={handleCreateSession} style={{ display: 'grid', gap: '1rem' }}>
            <div className="input-row">
              <label>Rounds</label>
              <input
                type="number"
                min="1"
                value={instructorConfig.rounds}
                onChange={event => setInstructorConfig(cfg => ({ ...cfg, rounds: event.target.value }))}
              />
            </div>
            <div className="input-row">
              <label>Seconds per round</label>
              <input
                type="number"
                min="10"
                value={instructorConfig.roundTime}
                onChange={event => setInstructorConfig(cfg => ({ ...cfg, roundTime: event.target.value }))}
              />
            </div>
            <div className="input-row">
              <label>Initial fish</label>
              <input
                type="number"
                min="1"
                value={instructorConfig.initialFish}
                onChange={event => setInstructorConfig(cfg => ({ ...cfg, initialFish: event.target.value }))}
              />
            </div>
            <div className="input-row">
              <label>Max catch per round</label>
              <input
                type="number"
                min="1"
                value={instructorConfig.maxCatchPerRound}
                onChange={event => setInstructorConfig(cfg => ({ ...cfg, maxCatchPerRound: event.target.value }))}
              />
            </div>
            <div className="input-row">
              <label>Players per pond</label>
              <input
                type="number"
                min="2"
                value={instructorConfig.playersPerPond}
                onChange={event => setInstructorConfig(cfg => ({ ...cfg, playersPerPond: event.target.value }))}
              />
            </div>
            <button type="submit" className="primary">
              Create session
            </button>
          </form>
          {errorMessage && <p style={{ color: '#dc2626' }}>{errorMessage}</p>}
          {joinInfo?.code && (
            <div style={{ marginTop: '1.5rem' }}>
              <p>Share this code with students:</p>
              <h1>{joinInfo.code}</h1>
            </div>
          )}
        </div>
      </div>
    );
  }

  const studentCount = session?.players?.filter(player => player.role === 'student').length || 0;
  const canStart = session?.status === 'lobby' && studentCount > 0;
  let startDisabledReason = '';
  if (session?.status === 'lobby' && studentCount === 0) {
    startDisabledReason = 'Need at least 1 student to start';
  } else if (session && session.status !== 'lobby') {
    startDisabledReason = 'Game already in progress';
  }

  return (
    <div className="app-shell">
      <InstructorDashboard
        instructorName="Instructor"
        session={session}
        joinInfo={joinInfo}
        canStart={canStart}
        startDisabledReason={startDisabledReason}
        onStart={handleStartSession}
        leaderboard={leaderboard}
        errorMessage={errorMessage}
        onDismissError={() => setErrorMessage('')}
        countdown={countdown}
        roundTimer={roundTimer}
        roundActive={roundActive}
        currentRoundNumber={currentRoundNumber}
      />
    </div>
  );
}

