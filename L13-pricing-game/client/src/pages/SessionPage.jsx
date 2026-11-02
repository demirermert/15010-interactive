import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { socket } from '../socket.js';
import { StudentView } from '../components/StudentView.jsx';
import { InstructorDashboard } from '../components/InstructorDashboard.jsx';

const API_BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL || '').trim();

function buildApiUrl(path) {
  if (!API_BASE_URL) {
    return `/api${path}`;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBase}${path}`;
}

export default function SessionPage() {
  const { sessionCode, studentId: studentCodeFromUrl } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isManagePage = location.pathname.startsWith('/manage/');
  const navigationState = location?.state;
  
  // Check if we should auto-join (and thus show loading immediately)
  const shouldAutoJoinInstructor = isManagePage && (
    navigationState?.instructorName || 
    localStorage.getItem(`instructor_${sessionCode}`)
  );
  const shouldAutoJoinStudent = !isManagePage && (
    studentCodeFromUrl || // Always auto-join if personal link exists
    navigationState?.studentName
  );
  const shouldAutoJoin = shouldAutoJoinInstructor || shouldAutoJoinStudent;
  
  const [session, setSession] = useState(null);
  const [joinInfo, setJoinInfo] = useState(null);
  const [isCompletedSession, setIsCompletedSession] = useState(false);
  const [roundInfo, setRoundInfo] = useState(null);
  const [timer, setTimer] = useState(0);
  const [roundActive, setRoundActive] = useState(false);
  const [latestResult, setLatestResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [leaderboardData, setLeaderboardData] = useState(new Map());
  const [latestRoundSummary, setLatestRoundSummary] = useState(null);
  const [allRoundSummaries, setAllRoundSummaries] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const [userName, setUserName] = useState('');
  const [isJoining, setIsJoining] = useState(shouldAutoJoin); // Start as true if auto-joining
  const [hasAttemptedJoin, setHasAttemptedJoin] = useState(false);
  const [nextRoundCountdown, setNextRoundCountdown] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [opponentName, setOpponentName] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPageReady, setIsPageReady] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [receivedEvents, setReceivedEvents] = useState({
    sessionUpdate: false,
    gameState: false
  });

  // Clear all state when session code changes (navigating to a new session)
  useEffect(() => {
    console.log('[SessionPage] Session code changed to:', sessionCode);
    
    // If this isn't the initial load, we're transitioning between sessions
    if (!isInitialLoad) {
      setIsTransitioning(true);
      setIsPageReady(false);
      setReceivedEvents({ sessionUpdate: false, gameState: false });
    }
    
    setHasAttemptedJoin(false); // Reset join attempt flag
    
    // Clear only session-specific data that could cause issues
    // Keep UI state intact to prevent flickering
    setJoinInfo(null);
    setErrorMessage('');
    
    // Clear sessionStorage for old round data
    sessionStorage.removeItem('roundStartTime');
    sessionStorage.removeItem('roundDuration');
    sessionStorage.removeItem('lastServerTime');
    sessionStorage.removeItem('lastServerTimer');
  }, [sessionCode, isInitialLoad]);

  // Check if all required events have been received and mark page as ready
  // This runs AFTER all state updates have completed, preventing flicker
  useEffect(() => {
    const allReceived = receivedEvents.sessionUpdate && receivedEvents.gameState;
    if (allReceived && (isTransitioning || isInitialLoad)) {
      console.log('[SessionPage] All required events received, marking ready');
      setIsTransitioning(false);
      setIsPageReady(true);
      setIsInitialLoad(false);
    }
  }, [receivedEvents, isTransitioning, isInitialLoad]);

  // Timeout fallback: if we're still waiting after 3 seconds, mark as ready anyway
  useEffect(() => {
    if (isTransitioning || (isInitialLoad && !isPageReady)) {
      const timeoutId = setTimeout(() => {
        console.log('[SessionPage] Timeout reached, forcing page ready');
        setIsTransitioning(false);
        setIsPageReady(true);
        setIsInitialLoad(false);
      }, 3000); // 3 second timeout
      
      return () => clearTimeout(timeoutId);
    }
  }, [isTransitioning, isInitialLoad, isPageReady]);

  useEffect(() => {
    const handleJoinedSession = async payload => {
      console.log('[SessionPage] Joined session successfully:', payload.sessionCode);
      setJoinInfo(payload);
      setUserRole(payload.role);
      
      // Only clear history/results if this is a NEW join (status is lobby)
      // For rejoins during active games, keep the existing state
      if (payload.status === 'lobby') {
        setRoundInfo(null);
        setHistory([]);
        setLatestResult(null);
        setLeaderboardData(new Map());
        setLatestRoundSummary(null);
        setAllRoundSummaries([]);
      }
      
      // Mark as ready once we've joined and will receive session data
      setIsJoining(false);
      
      // If session is complete and we're an instructor, load historical data from database
      if (payload.status === 'complete' && payload.role === 'instructor') {
        console.log('[SessionPage] Detected completed session, fetching historical data...');
        try {
          const url = buildApiUrl(`/session/${sessionCode}`);
          console.log('[SessionPage] Fetching from:', url);
          const response = await fetch(url);
          console.log('[SessionPage] Response status:', response.status);
          if (response.ok) {
            const sessionData = await response.json();
            console.log('[SessionPage] Fetched session data:', sessionData);
            setIsCompletedSession(true);
            
            // Reconstruct allRoundSummaries from the fetched data
            if (sessionData.rounds && sessionData.rounds.length > 0) {
              const reconstructedSummaries = sessionData.rounds.map(round => ({
                round: round.round,
                results: round.results
              }));
              console.log('[SessionPage] Reconstructed summaries:', reconstructedSummaries.length);
              setAllRoundSummaries(reconstructedSummaries);
              setLatestRoundSummary(reconstructedSummaries[reconstructedSummaries.length - 1] || null);
              
              // Reconstruct leaderboard data
              const leaderboardMap = new Map();
              sessionData.rounds.forEach(round => {
                round.results.forEach(result => {
                  const existing = leaderboardMap.get(result.playerName) || { 
                    name: result.playerName,
                    totalProfit: 0 
                  };
                  existing.totalProfit += result.profit;
                  leaderboardMap.set(result.playerName, existing);
                });
              });
              console.log('[SessionPage] Reconstructed leaderboard:', leaderboardMap.size, 'players');
              setLeaderboardData(leaderboardMap);
            }
          }
        } catch (err) {
          console.error('[SessionPage] Failed to fetch completed session data:', err);
        }
      }
      
      setErrorMessage('');
      setIsJoining(false);
      
      // Update userName state with the confirmed name from server
      if (payload.playerName) {
        setUserName(payload.playerName);
      }
      
      // Store student name in localStorage for auto-rejoin on refresh
      if (payload.role === 'student' && payload.studentCode && payload.playerName) {
        const storageKey = `student_${sessionCode}_${payload.studentCode}`;
        const storageData = {
          name: payload.playerName,
          timestamp: Date.now() // Store when they joined
        };
        localStorage.setItem(storageKey, JSON.stringify(storageData));
      }
      
      // Store instructor name in localStorage for auto-rejoin on refresh
      if (payload.role === 'instructor' && payload.playerName) {
        const instructorStorageKey = `instructor_${sessionCode}`;
        localStorage.setItem(instructorStorageKey, payload.playerName);
      }
      
      // If student just joined and got a new code, redirect to personal URL
      if (payload.studentCode && !studentCodeFromUrl && payload.role === 'student') {
        navigate(`/session/${sessionCode}/${payload.studentCode}`, { replace: true });
      }
    };
    
    const handleSessionUpdate = payload => {
      console.log('[SessionPage] Session update received for:', payload.code);
      // Only update if this is the current session we're viewing
      if (payload.code === sessionCode) {
        setSession(payload);
        
        // Mark sessionUpdate as received
        setReceivedEvents(prev => {
          const updated = { ...prev, sessionUpdate: true };
          
          // If session is in lobby or setup, there's no active timer/countdown to wait for
          // Mark gameState as received immediately
          if (payload.status === 'lobby' || payload.status === 'setup' || payload.status === 'complete') {
            updated.gameState = true;
            console.log('[SessionPage] Session in non-active state, marking gameState received');
          }
          
          return updated;
        });
      }
    };
    
    const handleRoundStarted = payload => {
      setRoundInfo(payload);
      setRoundActive(true);
      // If payload includes hasSubmitted (when rejoining), use it; otherwise default to false
      setHasSubmitted(payload.hasSubmitted || false);
      setTimer(payload.roundTime);
      setNextRoundCountdown(null); // Clear countdown when new round starts
      
      // Store the round start time for client-side fallback timer
      sessionStorage.setItem('roundStartTime', Date.now().toString());
      sessionStorage.setItem('roundDuration', payload.roundTime.toString());
      
      // Mark gameState as received (we have timer info)
      setReceivedEvents(prev => ({ ...prev, gameState: true }));
    };
    
    const handleRoundResults = payload => {
      setLatestResult(payload);
      setHistory(payload.history || []);
      setHasSubmitted(true);
      setRoundActive(false);
      
      // Clear round timer from session storage
      sessionStorage.removeItem('roundStartTime');
      sessionStorage.removeItem('roundDuration');
    };
    
    const handleTimerUpdate = payload => {
      setTimer(payload.remaining);
      // Update last server time
      sessionStorage.setItem('lastServerTime', Date.now().toString());
      sessionStorage.setItem('lastServerTimer', payload.remaining.toString());
      
      // Mark gameState as received (we have timer info)
      setReceivedEvents(prev => ({ ...prev, gameState: true }));
    };
    
    const handleNextRoundCountdown = payload => {
      setNextRoundCountdown(payload.countdown);
      setRoundActive(false);
      setTimer(0);
      
      // Mark gameState as received (we have countdown info)
      setReceivedEvents(prev => ({ ...prev, gameState: true }));
    };
    
    const handleRoundSummary = payload => {
      setLatestRoundSummary(payload);
      setAllRoundSummaries(prev => {
        // Check if this round already exists to prevent duplicates
        const existingIndex = prev.findIndex(r => r.round === payload.round);
        if (existingIndex >= 0) {
          // Round already exists, replace it
          const updated = [...prev];
          updated[existingIndex] = payload;
          return updated;
        }
        // New round, append it
        return [...prev, payload];
      });
      setLeaderboardData(prev => {
        const next = new Map(prev);
        payload.results.forEach(result => {
          [result.playerA, result.playerB].forEach(entry => {
            // Use player name as key instead of socketId to handle reconnections
            const playerKey = entry.name || entry.socketId;
            const current = next.get(playerKey) || {
              socketId: entry.socketId,
              name: entry.name || entry.socketId,
              totalProfit: 0
            };
            current.name = entry.name || current.name;
            current.totalProfit += entry.profit;
            next.set(playerKey, current);
          });
        });
        return next;
      });
    };
    
    const handleSessionComplete = payload => {
      setRoundActive(false);
      setLatestRoundSummary(payload.rounds[payload.rounds.length - 1] || null);
      
      // Solution #1: Clear localStorage when session ends
      if (studentCodeFromUrl && sessionCode) {
        const storageKey = `student_${sessionCode}_${studentCodeFromUrl}`;
        localStorage.removeItem(storageKey);
        console.log('Session completed - cleared stored session data');
      }
    };
    
    const handleError = async (message) => {
      console.log('[SessionPage] Error received:', message);
      
      // If session not found in memory, try fetching from database (completed sessions)
      // But only if we're not currently joining for the first time (which might be a timing issue)
      if ((message.includes('Session not found') || message.includes('has ended')) && hasAttemptedJoin) {
        try {
          const response = await fetch(buildApiUrl(`/session/${sessionCode}`));
          if (response.ok) {
            const sessionData = await response.json();
            
            // Only mark as completed if it's actually complete
            if (sessionData.status === 'complete') {
              console.log('[SessionPage] Session is complete, entering read-only mode');
              setIsCompletedSession(true);
              setSession({
                code: sessionData.code,
                sessionName: sessionData.sessionName,
                instructorName: sessionData.instructorName,
                status: sessionData.status,
                config: sessionData.config,
                currentRound: sessionData.config.rounds,
                players: sessionData.players || []
              });
              
              // Reconstruct allRoundSummaries from the fetched data
              if (sessionData.rounds && sessionData.rounds.length > 0) {
                const reconstructedSummaries = sessionData.rounds.map(round => ({
                  round: round.round,
                  results: round.results
                }));
                setAllRoundSummaries(reconstructedSummaries);
                setLatestRoundSummary(reconstructedSummaries[reconstructedSummaries.length - 1] || null);
                
                // Reconstruct leaderboard data
                const leaderboardMap = new Map();
                sessionData.rounds.forEach(round => {
                  round.results.forEach(result => {
                    const existing = leaderboardMap.get(result.playerName) || { 
                      name: result.playerName,
                      totalProfit: 0 
                    };
                    existing.totalProfit += result.profit;
                    leaderboardMap.set(result.playerName, existing);
                  });
                });
                setLeaderboardData(leaderboardMap);
              }
              
              setJoinInfo({ role: 'instructor', code: sessionData.code });
              setUserRole('instructor');
              setIsJoining(false);
              setHasAttemptedJoin(true);
              return;
            } else {
              // Session exists but is not complete - this might be a timing issue
              console.log('[SessionPage] Session exists but not complete, retrying join...');
              // Wait a moment and retry
              setTimeout(() => {
                if (isManagePage && userName) {
                  socket.emit('joinSession', {
                    sessionCode,
                    playerName: userName,
                    role: 'instructor'
                  });
                }
              }, 500);
              return;
            }
          }
        } catch (err) {
          console.error('[SessionPage] Failed to fetch completed session:', err);
        }
      }
      setErrorMessage(message);
      setIsJoining(false);
    };

    const handleChatMessage = (payload) => {
      setChatMessages(prev => [...prev, payload]);
    };

    const handleOpponentInfo = (payload) => {
      setOpponentName(payload.opponentName);
    };

    socket.on('joinedSession', handleJoinedSession);
    socket.on('sessionUpdate', handleSessionUpdate);
    socket.on('roundStarted', handleRoundStarted);
    socket.on('timerUpdate', handleTimerUpdate);
    socket.on('roundResults', handleRoundResults);
    socket.on('roundSummary', handleRoundSummary);
    socket.on('nextRoundCountdown', handleNextRoundCountdown);
    socket.on('sessionComplete', handleSessionComplete);
    socket.on('errorMessage', handleError);
    socket.on('chatMessage', handleChatMessage);
    socket.on('opponentInfo', handleOpponentInfo);

    return () => {
      socket.off('joinedSession', handleJoinedSession);
      socket.off('sessionUpdate', handleSessionUpdate);
      socket.off('roundStarted', handleRoundStarted);
      socket.off('timerUpdate', handleTimerUpdate);
      socket.off('roundResults', handleRoundResults);
      socket.off('roundSummary', handleRoundSummary);
      socket.off('nextRoundCountdown', handleNextRoundCountdown);
      socket.off('sessionComplete', handleSessionComplete);
      socket.off('errorMessage', handleError);
      socket.off('chatMessage', handleChatMessage);
      socket.off('opponentInfo', handleOpponentInfo);
    };
  }, []);

  // Client-side fallback timer - runs every second to keep timer updated even if socket fails
  useEffect(() => {
    if (!roundActive || hasSubmitted) return;
    
    const fallbackTimer = setInterval(() => {
      const roundStartTime = parseInt(sessionStorage.getItem('roundStartTime'));
      const roundDuration = parseInt(sessionStorage.getItem('roundDuration'));
      const lastServerTime = parseInt(sessionStorage.getItem('lastServerTime'));
      const lastServerTimer = parseInt(sessionStorage.getItem('lastServerTimer'));
      
      if (roundStartTime && roundDuration) {
        // Calculate client-side remaining time
        const elapsed = (Date.now() - roundStartTime) / 1000;
        const clientRemaining = Math.max(0, Math.ceil(roundDuration - elapsed));
        
        // If we have recent server data (within 3 seconds), use it
        // Otherwise use client-side calculation
        if (lastServerTime && lastServerTimer && (Date.now() - lastServerTime) < 3000) {
          // Server data is recent, trust it
          setTimer(lastServerTimer);
        } else {
          // No recent server data, use client calculation
          setTimer(clientRemaining);
        }
        
        // If timer reaches 0, clean up
        if (clientRemaining <= 0) {
          sessionStorage.removeItem('roundStartTime');
          sessionStorage.removeItem('roundDuration');
        }
      }
    }, 1000);
    
    return () => clearInterval(fallbackTimer);
  }, [roundActive, hasSubmitted]);

  // Handle page visibility changes (mobile app switching)
  useEffect(() => {
    let wasHidden = false;
    
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page became hidden (user switched apps)
        wasHidden = true;
        console.log('Page hidden - user switched apps');
      } else if (wasHidden) {
        // Page became visible again after being hidden
        console.log('Page visible again - checking connection...');
        
        // Check if socket is disconnected
        if (!socket.connected) {
          console.log('Socket disconnected - reconnecting...');
          socket.connect();
        }
        
        // If we have joinInfo (were in a session), force a rejoin to refresh state
        if (joinInfo && sessionCode) {
          console.log('Refreshing session state...');
          
          // Wait a moment for socket to reconnect, then rejoin
          setTimeout(() => {
            if (joinInfo.role === 'student' && studentCodeFromUrl) {
              socket.emit('joinSession', {
                sessionCode,
                playerName: joinInfo.playerName,
                studentCode: studentCodeFromUrl,
                role: 'student'
              });
            } else if (joinInfo.role === 'instructor') {
              socket.emit('joinSession', {
                sessionCode,
                playerName: joinInfo.playerName,
                role: 'instructor'
              });
            }
          }, 500); // Give socket 500ms to reconnect
        }
        
        wasHidden = false;
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [joinInfo, sessionCode, studentCodeFromUrl]);

  // Auto-join if coming from instructor or student page, or if student code in URL
  useEffect(() => {
    if (hasAttemptedJoin || joinInfo) return;
    
    // If on /manage/ route, it's an instructor
    if (isManagePage) {
      const state = navigationState;
      // Try navigation state first, then check localStorage
      const instructorStorageKey = `instructor_${sessionCode}`;
      const storedInstructorName = localStorage.getItem(instructorStorageKey);
      const instructorName = state?.instructorName || storedInstructorName;
      
      if (instructorName) {
        setUserName(instructorName);
        setIsJoining(true);
        setHasAttemptedJoin(true);
        socket.emit('joinSession', {
          sessionCode,
          playerName: instructorName,
          role: 'instructor'
        });
      }
    } else if (studentCodeFromUrl) {
      // If student code is in URL, this is a personal link
      // Try to get stored name from localStorage
      const storageKey = `student_${sessionCode}_${studentCodeFromUrl}`;
      const storedData = localStorage.getItem(storageKey);
      
      if (storedData) {
        try {
          const parsed = JSON.parse(storedData);
          const EIGHT_MINUTES = 8 * 60 * 1000; // 8 minutes in milliseconds
          const age = Date.now() - parsed.timestamp;
          
          // Only auto-rejoin if data is less than 8 minutes old
          if (age < EIGHT_MINUTES) {
            // Auto-rejoin with stored name
            setUserName(parsed.name);
            setIsJoining(true);
            setHasAttemptedJoin(true);
            socket.emit('joinSession', {
              sessionCode,
              playerName: parsed.name,
              studentCode: studentCodeFromUrl,
              role: 'student'
            });
            return; // Exit early after rejoining
          } else {
            // Data is too old, clear it
            console.log('Session data expired (>8 minutes), clearing...');
            localStorage.removeItem(storageKey);
          }
        } catch (err) {
          // Invalid JSON format (old data format), clear it
          console.log('Invalid stored data format, clearing...');
          localStorage.removeItem(storageKey);
        }
      }
      
      // If no stored name OR storage expired, try rejoining with just the student code
      // The server can look up the player by their studentCode
      console.log('Attempting to rejoin with studentCode only (no stored name)');
      setIsJoining(true);
      setHasAttemptedJoin(true);
      socket.emit('joinSession', {
        sessionCode,
        playerName: '', // Server will use existing name
        studentCode: studentCodeFromUrl,
        role: 'student'
      });
    } else {
      // On /session/ route without student code, check for navigation state
      const state = navigationState;
      if (state?.studentName) {
        setUserName(state.studentName);
        setIsJoining(true);
        setHasAttemptedJoin(true);
        socket.emit('joinSession', {
          sessionCode,
          playerName: state.studentName,
          role: 'student'
        });
      }
    }
  }, [sessionCode, studentCodeFromUrl, hasAttemptedJoin, joinInfo, isManagePage, navigationState]);

  const leaderboard = useMemo(() => {
    return Array.from(leaderboardData.values())
      .sort((a, b) => b.totalProfit - a.totalProfit);
  }, [leaderboardData]);

  const handleStartSession = () => {
    if (!sessionCode) return;
    setErrorMessage('');
    socket.emit('startSession', { sessionCode });
  };

  const handleOpenLobby = () => {
    if (!sessionCode) return;
    setErrorMessage('');
    socket.emit('openLobby', { sessionCode });
  };

  const handleEndSession = () => {
    if (!sessionCode) return;
    setErrorMessage('');
    socket.emit('endSession', { sessionCode });
  };

  const handleSubmitPrice = price => {
    if (!sessionCode) return;
    socket.emit('submitPrice', { sessionCode, price });
    setHasSubmitted(true); // Immediately show "waiting for others" message
  };

  const priceBounds = useMemo(() => {
    if (session?.config?.priceBounds) return session.config.priceBounds;
    return { min: 0, max: 100 };
  }, [session?.config?.priceBounds]);

  const handleJoinAsStudent = (e) => {
    e.preventDefault();
    if (!userName.trim()) {
      setErrorMessage('Please enter your name');
      return;
    }
    setIsJoining(true);
    setHasAttemptedJoin(true);
    socket.emit('joinSession', {
      sessionCode,
      playerName: userName,
      studentCode: studentCodeFromUrl || undefined,
      role: 'student'
    });
  };

  const handleJoinAsInstructor = (e) => {
    e.preventDefault();
    if (!userName.trim()) {
      setErrorMessage('Please enter your name');
      return;
    }
    setIsJoining(true);
    socket.emit('joinSession', {
      sessionCode,
      playerName: userName,
      role: 'instructor'
    });
  };

  // If not joined yet, show join form or loading
  if (!joinInfo) {
    // If on /manage/ route, show instructor join form or loading
    if (isManagePage) {
      // Show loading screen if already attempting to join
      if (isJoining) {
        return (
          <div className="app-shell">
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ 
                fontSize: '3rem',
                marginBottom: '1rem',
                animation: 'pulse 1.5s ease-in-out infinite'
              }}>
                🎮
              </div>
              <h2 style={{ color: '#6b7280', marginBottom: '0.5rem' }}>Loading Session...</h2>
              <p style={{ color: '#9ca3af' }}>Please wait a moment</p>
            </div>
          </div>
        );
      }
      
      return (
        <div className="app-shell">
          <div className="card">
            <h2>Manage Session: {sessionCode}</h2>
            <p style={{ color: '#6b7280', marginBottom: '1rem' }}>Enter your instructor name to access the dashboard</p>
            <form onSubmit={handleJoinAsInstructor} style={{ display: 'grid', gap: '1rem', maxWidth: '400px' }}>
              <div className="input-row">
                <label htmlFor="name">Instructor Name</label>
                <input
                  id="name"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your instructor name"
                  required
                  disabled={isJoining}
                />
              </div>
              <button type="submit" className="primary" disabled={isJoining}>
                {isJoining ? 'Accessing...' : 'Access Dashboard'}
              </button>
            </form>
            {errorMessage && <p style={{ color: '#dc2626', marginTop: '1rem' }}>{errorMessage}</p>}
            <div style={{ marginTop: '1.5rem' }}>
              <button onClick={() => navigate('/instructor')}>Back to Instructor Portal</button>
            </div>
          </div>
        </div>
      );
    }
    
    // Otherwise show student join form or loading if auto-rejoining
    // Show loading screen if already attempting to join (auto-rejoin)
    if (isJoining) {
      return (
        <div className="app-shell">
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ 
              fontSize: '3rem',
              marginBottom: '1rem',
              animation: 'pulse 1.5s ease-in-out infinite'
            }}>
              🎮
            </div>
            <h2 style={{ color: '#6b7280', marginBottom: '0.5rem' }}>
              {studentCodeFromUrl ? 'Rejoining Session...' : 'Joining Session...'}
            </h2>
            <p style={{ color: '#9ca3af' }}>Please wait a moment</p>
          </div>
        </div>
      );
    }
    
    // Show join form only if not auto-rejoining
    return (
      <div className="app-shell">
        <div className="card">
          <h2>Join Session: {sessionCode}</h2>
          {studentCodeFromUrl && (
            <p style={{ color: '#6b7280', marginBottom: '1rem' }}>
              Welcome back! Enter your name to rejoin your game.
            </p>
          )}
          <form onSubmit={handleJoinAsStudent} style={{ display: 'grid', gap: '1rem', maxWidth: '400px' }}>
            <div className="input-row">
              <label htmlFor="name">Your Name</label>
              <input
                id="name"
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={studentCodeFromUrl ? "Enter your full name (e.g., John Smith)" : "Enter your name"}
                required
                disabled={isJoining}
              />
              {studentCodeFromUrl && (
                <small style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                  Must match the name you used when you first joined
                </small>
              )}
            </div>
            <button type="submit" className="primary" disabled={isJoining}>
              {isJoining ? 'Joining...' : (studentCodeFromUrl ? 'Rejoin Game' : 'Join as Student')}
            </button>
          </form>
          {errorMessage && <p style={{ color: '#dc2626', marginTop: '1rem' }}>{errorMessage}</p>}
          <div style={{ marginTop: '1.5rem' }}>
            <button onClick={() => navigate('/')}>Back to Home</button>
          </div>
        </div>
      </div>
    );
  }

  // Handle sending chat messages
  const handleSendChatMessage = (message) => {
    socket.emit('chatMessage', { sessionCode, message });
  };

  // If joined as instructor
  if (userRole === 'instructor') {
    // Only use session data if it matches the current sessionCode (prevents flickering from old session)
    const validSession = session && session.code === sessionCode ? session : null;
    
    const studentCount = validSession?.players?.filter(player => player.role === 'student').length || 0;
    const canStart = validSession?.status === 'lobby' && studentCount >= 1;
    const canOpenLobby = validSession?.status === 'setup';
    let startDisabledReason = '';
    if (validSession?.status === 'lobby' && studentCount < 1) {
      startDisabledReason = 'Need at least one student to start';
    } else if (validSession && validSession.status !== 'lobby') {
      startDisabledReason = 'Game already in progress';
    }

    return (
      <div className="app-shell" style={{ position: 'relative' }}>
        {/* Loading overlay during initial load and transitions */}
        {(isTransitioning || (isInitialLoad && !isPageReady)) ? (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(4px)'
          }}>
            <div style={{
              textAlign: 'center',
              padding: '2rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)',
              border: '2px solid #e5e7eb'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                border: '4px solid #e5e7eb',
                borderTopColor: '#3b82f6',
                borderRadius: '50%',
                margin: '0 auto 1rem',
                animation: 'spin 1s linear infinite'
              }} />
              <p style={{ 
                margin: 0, 
                fontSize: '1.25rem', 
                fontWeight: 600, 
                color: '#1f2937' 
              }}>
                Loading Session...
              </p>
              <p style={{ 
                margin: '0.5rem 0 0 0', 
                fontSize: '0.875rem', 
                color: '#6b7280' 
              }}>
                Session Code: {sessionCode}
              </p>
            </div>
          </div>
        ) : (
          <>
            {isCompletedSession && (
              <div style={{
                padding: '1rem',
                marginBottom: '1rem',
                backgroundColor: '#dbeafe',
                borderRadius: '8px',
                borderLeft: '4px solid #3b82f6',
                textAlign: 'center'
              }}>
                <p style={{ margin: 0, color: '#1e40af', fontWeight: 600 }}>
                  📋 Viewing archived session (read-only mode)
                </p>
              </div>
            )}
            <InstructorDashboard
              instructorName={userName || validSession?.instructorName}
              session={validSession}
              canStart={canStart && !isCompletedSession}
              canOpenLobby={canOpenLobby && !isCompletedSession}
              startDisabledReason={startDisabledReason}
              onStart={handleStartSession}
              onOpenLobby={handleOpenLobby}
              onEndSession={handleEndSession}
              leaderboard={leaderboard}
              latestRound={latestRoundSummary}
              allRounds={allRoundSummaries}
              errorMessage={errorMessage}
              onDismissError={() => setErrorMessage('')}
              timer={timer}
              roundActive={roundActive}
              nextRoundCountdown={nextRoundCountdown}
            />
          </>
        )}
      </div>
    );
  }

  // If joined as student
  const personalLink = joinInfo?.playerLink || (studentCodeFromUrl ? `/session/${sessionCode}/${studentCodeFromUrl}` : null);
  
  // Only use session data if it matches the current sessionCode (prevents flickering from old session)
  const validSession = session && session.code === sessionCode ? session : null;
  
  return (
    <div className="app-shell">
      <StudentView
        sessionCode={sessionCode}
        sessionStatus={validSession?.status}
        currentRound={roundInfo?.round || validSession?.currentRound || 0}
        roundActive={roundActive}
        timer={timer}
        priceBounds={priceBounds}
        onSubmitPrice={handleSubmitPrice}
        latestResult={latestResult}
        history={history}
        hasSubmitted={hasSubmitted}
        personalLink={personalLink}
        nextRoundCountdown={nextRoundCountdown}
        session={validSession}
        leaderboard={leaderboard}
        allRounds={allRoundSummaries}
        chatMessages={chatMessages}
        onSendChatMessage={handleSendChatMessage}
        currentSocketId={socket.id}
        opponentName={opponentName}
      />
    </div>
  );
}

