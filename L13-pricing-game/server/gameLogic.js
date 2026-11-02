import { computeDemand } from './demandModel.js';
import * as db from './database.js';
import { getAIPriceDecision, isOpenAIInitialized } from './aiPlayer.js';

const DEFAULT_CONFIG = {
  rounds: 10,
  roundTime: 30,
  resultRevealTime: 10,
  marketSize: 1000,
  alpha: 1,
  sigma: 5,
  priceBounds: { min: 0, max: 100 },
  defaultPrice: 10  // Price used when student doesn't submit
};

const SESSION_CODE_LENGTH = 4;
const STATUS = {
  SETUP: 'setup',      // Session created, parameters set, but not open to students yet
  LOBBY: 'lobby',      // Open to students, waiting to start
  RUNNING: 'running',
  COMPLETE: 'complete'
};

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Only letters, no numbers
  let result = '';
  for (let i = 0; i < SESSION_CODE_LENGTH; i += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

function deepMerge(target, source) {
  const output = { ...target };
  Object.keys(source || {}).forEach(key => {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      output[key] = deepMerge(target[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      output[key] = source[key];
    }
  });
  return output;
}

export function createGameManager(io) {
  const sessions = new Map();

  function createSession(instructorName, sessionName, configOverrides) {
    if (!instructorName) {
      throw new Error('Instructor name required');
    }

    let code;
    do {
      code = randomCode();
    } while (sessions.has(code));

    const config = deepMerge(DEFAULT_CONFIG, configOverrides);
    const session = {
      code,
      sessionName: sessionName || `${instructorName}'s Game`,
      config,
      instructorSocket: null,
      instructorName,
      status: STATUS.SETUP,  // Start in setup mode, not lobby
      currentRound: 0,
      players: new Map(),
      pairs: [],
      roundResults: [],
      submissions: new Map(),
      timers: {
        round: null,
        reveal: null
      },
      dbId: null,
      playerDbIds: new Map(),
      roundFinalizing: false,
      roundStartTime: null
    };

    // Save to database
    try {
      const dbId = db.saveSession({
        code,
        instructorName,
        sessionName: session.sessionName,
        config,
        status: STATUS.SETUP  // Save as setup in database too
      });
      session.dbId = dbId;
    } catch (err) {
      console.error('Failed to save session to database:', err);
    }

    sessions.set(code, session);
    console.log(`Session ${code} ("${session.sessionName}") created by ${instructorName}`);
    return { code, sessionName: session.sessionName, config };
  }

  function broadcastSession(session) {
    const now = Date.now();
    const AWAY_THRESHOLD = 15000; // 15 seconds
    
    const payload = {
      code: session.code,
      status: session.status,
      currentRound: session.currentRound,
      config: session.config,
      players: Array.from(session.players.values()).map(player => {
        // Determine connection status
        let connectionStatus = 'offline';
        if (player.connected) {
          const timeSinceHeartbeat = now - (player.lastHeartbeat || now);
          if (timeSinceHeartbeat < AWAY_THRESHOLD) {
            connectionStatus = 'online';
          } else {
            connectionStatus = 'away'; // Connected but no recent heartbeat
          }
        }
        
        return {
          socketId: player.socketId,
          name: player.name,
          role: player.role,
          connected: player.connected, // Keep for backward compatibility
          connectionStatus: connectionStatus, // New: 'online', 'away', or 'offline'
          pairId: player.pairId || null
        };
      }),
      pairs: session.pairs.map(pair => ({
        id: pair.id,
        playerA: sanitizePlayerRef(session.players.get(pair.playerA)),
        playerB: sanitizePlayerRef(session.players.get(pair.playerB))
      }))
    };
    io.to(session.code).emit('sessionUpdate', payload);
  }

  function sanitizePlayerRef(player) {
    if (!player) return null;
    return {
      socketId: player.socketId,
      name: player.name
    };
  }

  function ensureSession(code) {
    const session = sessions.get(code);
    if (!session) throw new Error('Session not found or has ended. Please create a new session.');
    return session;
  }

  function ensureInstructor(socket, session) {
    if (session.instructorSocket !== socket.id) {
      throw new Error('Only instructor can perform this action');
    }
  }

  function registerPlayer(session, socket, { playerName, role, studentCode }) {
    // Check if this student is rejoining with their unique code
    if (studentCode && role === 'student') {
      // Look for existing player with this unique code
      const existingPlayer = Array.from(session.players.values()).find(
        p => p.studentCode === studentCode
      );
      
      if (existingPlayer) {
        // If playerName is empty, use the existing player's name (rejoining without localStorage)
        const nameToUse = playerName || existingPlayer.name;
        
        // If playerName was provided, verify it matches (security check)
        if (playerName && existingPlayer.name !== playerName) {
          throw new Error('Name does not match this student code');
        }
        
        // Update existing player's socket and connection status
        const oldSocketId = existingPlayer.socketId;
        session.players.delete(oldSocketId);
        existingPlayer.socketId = socket.id;
        existingPlayer.connected = true;
        existingPlayer.lastHeartbeat = Date.now(); // Reset heartbeat on reconnect
        session.players.set(socket.id, existingPlayer);
        
        // Update the pair's socketId references if player was already paired
        if (existingPlayer.pairId) {
          const pair = session.pairs.find(p => p.id === existingPlayer.pairId);
          if (pair) {
            if (pair.playerA === oldSocketId) {
              pair.playerA = socket.id;
            } else if (pair.playerB === oldSocketId) {
              pair.playerB = socket.id;
            }
          }
        }
        
        socket.join(session.code);
        socket.data.sessionCode = session.code;
        socket.data.role = existingPlayer.role;
        socket.data.studentCode = studentCode;
        console.log(`${nameToUse} rejoined session ${session.code} with code ${studentCode}`);
        return existingPlayer.studentCode; // Return existing code
      }
    }
    
    // For new players, name is required
    if (!playerName) {
      throw new Error('Name is required');
    }
    
    // New player joining - generate unique student code
    let newStudentCode = null;
    if (role === 'student') {
      // Generate a unique 6-character code for this student
      do {
        newStudentCode = randomCode() + randomCode().substring(0, 2); // 6 characters
      } while (Array.from(session.players.values()).some(p => p.studentCode === newStudentCode));
    }
    
    const player = {
      socketId: socket.id,
      sessionCode: session.code,
      name: playerName,
      role: role === 'instructor' ? 'instructor' : 'student',
      connected: true,
      lastHeartbeat: Date.now(), // Track last heartbeat for away detection
      pairId: null,
      history: [],
      dbId: null,
      studentCode: newStudentCode
    };
    session.players.set(socket.id, player);
    socket.join(session.code);
    socket.data.sessionCode = session.code;
    socket.data.role = player.role;
    if (newStudentCode) {
      socket.data.studentCode = newStudentCode;
    }
    if (player.role === 'instructor') {
      session.instructorSocket = socket.id;
    }

    // Save player to database
    if (session.dbId) {
      try {
        const dbId = db.savePlayer(session.dbId, {
          socketId: socket.id,
          name: playerName,
          role: player.role,
          pairId: null
        });
        player.dbId = dbId;
        session.playerDbIds.set(socket.id, dbId);
      } catch (err) {
        console.error('Failed to save player to database:', err);
      }
    }
    
    return newStudentCode; // Return the generated code for new students
  }

  function handleJoin(socket, { sessionCode, playerName, role, studentCode }) {
    try {
      const code = sessionCode?.trim().toUpperCase();
      const session = ensureSession(code);
      
      // Check if trying to join as a new student when session is not in lobby
      if (role === 'student' && !studentCode) {
        if (session.status === STATUS.SETUP) {
          throw new Error('This session is not open yet. Please wait for the instructor to open the lobby.');
        } else if (session.status !== STATUS.LOBBY) {
          throw new Error('Game has already started. New students cannot join.');
        }
      }
      
      // Check if trying to rejoin with a code but not in this session
      if (studentCode && role === 'student') {
        const existingPlayer = Array.from(session.players.values()).find(
          p => p.studentCode === studentCode
        );
        if (!existingPlayer) {
          if (session.status === STATUS.SETUP) {
            throw new Error('This session is not open yet. Please wait for the instructor to open the lobby.');
          } else if (session.status !== STATUS.LOBBY) {
            throw new Error('Game has already started. You were not part of this game.');
          }
        }
      }
      
      const returnedCode = registerPlayer(session, socket, { playerName, role, studentCode });
      
      // Use the returned code (either new or existing)
      const finalStudentCode = returnedCode || studentCode;
      
      // Get the actual player object to get their real name (important for rejoins with empty playerName)
      const actualPlayer = session.players.get(socket.id);
      const actualPlayerName = actualPlayer ? actualPlayer.name : playerName;
      
      // Prepare join response
      const joinResponse = {
        code,
        role: socket.data.role,
        status: session.status,
        config: session.config,
        currentRound: session.currentRound,
        studentCode: finalStudentCode || null,
        playerLink: finalStudentCode ? `/session/${code}/${finalStudentCode}` : null,
        playerName: actualPlayerName
      };
      
      // If rejoining mid-round or mid-game, send current state and history
      if (session.status === STATUS.RUNNING && session.currentRound > 0) {
        const player = session.players.get(socket.id);
        
        // If instructor is rejoining, send all round summaries for dashboard
        if (role === 'instructor' && session.roundResults && session.roundResults.length > 0) {
          session.roundResults.forEach(roundResult => {
            socket.emit('roundSummary', {
              round: roundResult.round,
              results: roundResult.results
            });
          });
        }
        
        // Send player's history from previous rounds
        if (player && player.history && player.history.length > 0) {
          const latestHistory = player.history[player.history.length - 1];
          socket.emit('roundResults', {
            round: latestHistory.round,
            price: latestHistory.price,
            demand: latestHistory.demand,
            profit: latestHistory.profit,
            share: latestHistory.share,
            opponentPrice: latestHistory.opponentPrice,
            opponentDemand: latestHistory.opponentDemand,
            opponentShare: latestHistory.opponentShare,
            opponentProfit: latestHistory.opponentProfit,
            opponentName: latestHistory.opponentName,
            history: player.history
          });
        }
        
        // If a round is currently active (timer is running), send round state
        if (session.timers.round) {
          const hasSubmitted = player && player.pairId && 
            session.submissions.get(player.pairId)?.[socket.id];
          
          // Calculate remaining time
          const elapsed = session.roundStartTime ? (Date.now() - session.roundStartTime) / 1000 : 0;
          const remainingTime = Math.max(0, session.config.roundTime - elapsed);
          
          // Round is active - tell them about it with actual remaining time
          socket.emit('roundStarted', {
            round: session.currentRound,
            roundTime: Math.ceil(remainingTime), // Send remaining time, not full time
            hasSubmitted: !!hasSubmitted
          });
        }
      }
      
      socket.emit('joinedSession', joinResponse);
      broadcastSession(session);
      console.log(`${playerName} joined session ${code}${finalStudentCode ? ` (${finalStudentCode})` : ''}`);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  function handleOpenLobby(socket, sessionCode) {
    try {
      const session = ensureSession(sessionCode);
      ensureInstructor(socket, session);
      
      if (session.status !== STATUS.SETUP) {
        throw new Error('Can only open lobby from setup mode');
      }
      
      session.status = STATUS.LOBBY;
      
      // Update status in database
      if (session.dbId) {
        try {
          db.updateSessionStatus(session.code, STATUS.LOBBY);
        } catch (err) {
          console.error('Failed to update session status:', err);
        }
      }
      
      broadcastSession(session);
      console.log(`Lobby opened for session ${sessionCode}`);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  function handleStartSession(socket, sessionCode) {
    try {
      const session = ensureSession(sessionCode);
      ensureInstructor(socket, session);
      if (session.status !== STATUS.LOBBY) {
        throw new Error('Session already started');
      }
      const students = Array.from(session.players.values()).filter(p => p.role === 'student');
      if (students.length < 1) {
        throw new Error('Need at least one student to start');
      }
      pairStudents(session, students);
      session.status = STATUS.RUNNING;
      session.currentRound = 0;
      
      // Update status in database
      if (session.dbId) {
        try {
          db.updateSessionStatus(session.code, STATUS.RUNNING);
        } catch (err) {
          console.error('Failed to update session status:', err);
        }
      }
      
      broadcastSession(session);
      startNextRound(session);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  function pairStudents(session, students) {
    const shuffled = [...students];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // If odd number of students, add an AI player
    if (shuffled.length % 2 === 1) {
      const aiPlayerName = isOpenAIInitialized() ? 'ChatGPT 🤖' : 'AI Player 🤖';
      const aiPlayer = {
        socketId: `ai-player-${Date.now()}`,
        sessionCode: session.code,
        name: aiPlayerName,
        role: 'ai',
        connected: true,
        pairId: null,
        history: [],
        dbId: null,
        studentCode: null,
        isAI: true
      };
      
      // Add AI player to session
      session.players.set(aiPlayer.socketId, aiPlayer);
      shuffled.push(aiPlayer);
      
      // Save AI player to database
      if (session.dbId) {
        try {
          const dbId = db.savePlayer(session.dbId, {
            socketId: aiPlayer.socketId,
            name: aiPlayer.name,
            role: 'ai',
            pairId: null
          });
          aiPlayer.dbId = dbId;
          session.playerDbIds.set(aiPlayer.socketId, dbId);
        } catch (err) {
          console.error('Failed to save AI player to database:', err);
        }
      }
      
      console.log(`AI player added to session ${session.code} (odd number of students)`);
    }
    
    session.pairs = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      const pairId = `pair-${i / 2 + 1}`;
      const playerA = shuffled[i];
      const playerB = shuffled[i + 1];
      playerA.pairId = pairId;
      playerB.pairId = pairId;
      session.pairs.push({
        id: pairId,
        playerA: playerA.socketId,
        playerB: playerB.socketId
      });
    }
  }

  function startNextRound(session) {
    clearTimers(session);
    if (session.currentRound >= session.config.rounds) {
      finalizeSession(session);
      return;
    }
    session.currentRound += 1;
    session.submissions.clear();
    session.roundFinalizing = false; // Reset flag for new round
    session.roundStartTime = Date.now(); // Record when this round started
    
    // Get round time for this specific round (support array or single value)
    const roundTime = Array.isArray(session.config.roundTime)
      ? session.config.roundTime[session.currentRound - 1] || session.config.roundTime[0]
      : session.config.roundTime;
    
    // Send round started to all players
    io.to(session.code).emit('roundStarted', {
      round: session.currentRound,
      roundTime: roundTime
    });
    
    // If showOpponentName is enabled, send each student their opponent's name
    if (session.config.showOpponentName) {
      session.pairs.forEach(pair => {
        const playerA = session.players.get(pair.playerA);
        const playerB = session.players.get(pair.playerB);
        if (playerA && playerB) {
          io.to(pair.playerA).emit('opponentInfo', { opponentName: playerB.name });
          io.to(pair.playerB).emit('opponentInfo', { opponentName: playerA.name });
        }
      });
    }
    
    broadcastSession(session);
    
    // Broadcast timer updates every second
    let lastBroadcastTime = Date.now();
    session.timers.timerBroadcast = setInterval(() => {
      try {
        const now = Date.now();
        const elapsed = (now - session.roundStartTime) / 1000;
        const remaining = Math.max(0, Math.ceil(roundTime - elapsed));
        
        // Only broadcast if value changed or enough time passed
        if (remaining !== session.lastBroadcastRemaining || (now - lastBroadcastTime) >= 900) {
          io.to(session.code).emit('timerUpdate', { remaining });
          session.lastBroadcastRemaining = remaining;
          lastBroadcastTime = now;
        }
        
        // Stop broadcasting when time is up
        if (remaining <= 0 && session.timers.timerBroadcast) {
          clearInterval(session.timers.timerBroadcast);
          session.timers.timerBroadcast = null;
        }
      } catch (err) {
        console.error(`[Session ${session.code}] Timer broadcast error:`, err);
        if (session.timers.timerBroadcast) {
          clearInterval(session.timers.timerBroadcast);
          session.timers.timerBroadcast = null;
        }
      }
    }, 1000);
    
    session.timers.round = setTimeout(() => {
      if (session.timers.timerBroadcast) {
        clearInterval(session.timers.timerBroadcast);
        session.timers.timerBroadcast = null;
      }
      forceSubmitMissing(session);
    }, roundTime * 1000);
  }

  async function forceSubmitMissing(session) {
    console.log(`[Session ${session.code}] Round ${session.currentRound} timer expired - finalizing round`);
    const seenPairs = new Set();
    
    // Function to generate random price for non-submissions
    // Use the game's price bounds (0 to max, which is typically 2x monopoly price)
    const getRandomPrice = () => {
      const min = session.config.priceBounds?.min || 0;
      const max = session.config.priceBounds?.max || 100;
      return Math.floor(min + Math.random() * (max - min + 1)); // Return integer
    };
      
    // Process all pairs sequentially to get AI decisions
    for (const pair of session.pairs) {
      seenPairs.add(pair.id);
      const existing = session.submissions.get(pair.id) || {};
      const submissionA = existing[pair.playerA];
      const submissionB = existing[pair.playerB];
      
      if (!submissionA) {
        const playerA = session.players.get(pair.playerA);
        if (playerA && playerA.isAI) {
          // AI player - use ChatGPT to get price
          const playerB = session.players.get(pair.playerB);
          const aiPrice = await getAIPriceDecision(
            session.config,
            playerA.history || [],
            playerB.history || []
          );
          console.log(`[Session ${session.code}] AI player (ChatGPT) submitting price: ${aiPrice.toFixed(2)}`);
          recordSubmission(session, pair.playerA, aiPrice, false);
        } else {
          const randomPrice = getRandomPrice();
          console.log(`[Session ${session.code}] Forcing random price ${randomPrice.toFixed(2)} for player ${pair.playerA}`);
          recordSubmission(session, pair.playerA, randomPrice, true);
        }
      }
      
      if (!submissionB) {
        const playerB = session.players.get(pair.playerB);
        if (playerB && playerB.isAI) {
          // AI player - use ChatGPT to get price
          const playerA = session.players.get(pair.playerA);
          const aiPrice = await getAIPriceDecision(
            session.config,
            playerB.history || [],
            playerA.history || []
          );
          console.log(`[Session ${session.code}] AI player (ChatGPT) submitting price: ${aiPrice.toFixed(2)}`);
          recordSubmission(session, pair.playerB, aiPrice, false);
        } else {
          const randomPrice = getRandomPrice();
          console.log(`[Session ${session.code}] Forcing random price ${randomPrice.toFixed(2)} for player ${pair.playerB}`);
          recordSubmission(session, pair.playerB, randomPrice, true);
        }
      }
    }
    
    // Timer expired - finalize the round with all submissions
    finalizeRound(session);
  }

  function handlePriceSubmission(socket, { sessionCode, price }) {
    try {
      const session = ensureSession(sessionCode);
      if (session.status !== STATUS.RUNNING) {
        throw new Error('Session not running');
      }
      const player = session.players.get(socket.id);
      if (!player || player.role !== 'student') {
        throw new Error('Only active students can submit prices');
      }
      if (!player.pairId) {
        throw new Error('Player is not paired');
      }
      const numericPrice = Number(price);
      const { min, max } = session.config.priceBounds;
      if (!Number.isFinite(numericPrice)) {
        throw new Error('Price must be numeric');
      }
      if (numericPrice < min || numericPrice > max) {
        throw new Error(`Price must be between ${min} and ${max}`);
      }
      recordSubmission(session, socket.id, numericPrice, false);
      concludeRoundIfReady(session);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  function recordSubmission(session, socketId, price, forced) {
    const player = session.players.get(socketId);
    if (!player) {
      // Player socket not found - might be disconnected
      // Try to find the player's pairId from session.pairs
      const pair = session.pairs.find(p => p.playerA === socketId || p.playerB === socketId);
      if (pair) {
        const submission = session.submissions.get(pair.id) || {};
        submission[socketId] = { price, forced };
        session.submissions.set(pair.id, submission);
        console.log(`[Session ${session.code}] Recorded submission for disconnected player ${socketId} in pair ${pair.id}`);
      } else {
        console.warn(`[Session ${session.code}] Cannot record submission - player ${socketId} not found in any pair`);
      }
      return;
    }
    const pairId = player.pairId;
    if (!pairId) return;
    const submission = session.submissions.get(pairId) || {};
    submission[socketId] = { price, forced };
    session.submissions.set(pairId, submission);
  }

  function concludeRoundIfReady(session) {
    const allSubmitted = session.pairs.every(pair => {
      const submission = session.submissions.get(pair.id);
      return submission && submission[pair.playerA] && submission[pair.playerB];
    });
    if (!allSubmitted) return;
    // Don't clear the timer - let it run until the time expires
    // This ensures all players wait for the full round time before seeing results
  }

  function finalizeRound(session) {
    // Prevent double finalization
    if (session.roundFinalizing) {
      console.log(`[Session ${session.code}] Attempted double finalization of round ${session.currentRound} - prevented`);
      return;
    }
    session.roundFinalizing = true;
    console.log(`[Session ${session.code}] Finalizing round ${session.currentRound} and sending results to all players`);
    
    const roundNumber = session.currentRound;
    const resultsForRound = [];
    
    // Save round to database
    let roundDbId = null;
    if (session.dbId) {
      try {
        roundDbId = db.saveRound(session.dbId, roundNumber);
      } catch (err) {
        console.error('Failed to save round to database:', err);
      }
    }
    
    session.pairs.forEach(pair => {
      const submission = session.submissions.get(pair.id);
      if (!submission || !submission[pair.playerA] || !submission[pair.playerB]) {
        console.warn(`[Session ${session.code}] Skipping pair ${pair.id} - missing submissions`);
        return;
      }
      
      let playerA = session.players.get(pair.playerA);
      let playerB = session.players.get(pair.playerB);
      
      // If players are disconnected, they might not be in session.players anymore
      // We need to handle this case by creating temporary player objects
      if (!playerA) {
        console.warn(`[Session ${session.code}] PlayerA ${pair.playerA} not found - creating temporary entry for pair ${pair.id}`);
        playerA = {
          socketId: pair.playerA,
          name: `Student (${pair.id}A)`,
          history: [],
          dbId: null
        };
        // Add back to session.players so they can receive future results
        session.players.set(pair.playerA, playerA);
      }
      
      if (!playerB) {
        console.warn(`[Session ${session.code}] PlayerB ${pair.playerB} not found - creating temporary entry for pair ${pair.id}`);
        playerB = {
          socketId: pair.playerB,
          name: `Student (${pair.id}B)`,
          history: [],
          dbId: null
        };
        // Add back to session.players so they can receive future results
        session.players.set(pair.playerB, playerB);
      }
      
      const priceA = submission[pair.playerA].price;
      const priceB = submission[pair.playerB].price;
      const { demandA, demandB, shareA, shareB } = computeDemand({
        priceA,
        priceB,
        config: session.config
      });
      const profitA = priceA * demandA;
      const profitB = priceB * demandB;
      const playerResultA = {
        round: roundNumber,
        price: priceA,
        demand: demandA,
        profit: profitA,
        share: shareA,
        opponentPrice: priceB,
        opponentDemand: demandB,
        opponentShare: shareB,
        opponentProfit: profitB,
        opponentName: playerB.name,
        name: playerA.name
      };
      const playerResultB = {
        round: roundNumber,
        price: priceB,
        demand: demandB,
        profit: profitB,
        share: shareB,
        opponentPrice: priceA,
        opponentDemand: demandA,
        opponentShare: shareA,
        opponentProfit: profitA,
        opponentName: playerA.name,
        name: playerB.name
      };
      playerA.history.push(playerResultA);
      playerB.history.push(playerResultB);
      resultsForRound.push({
        pairId: pair.id,
        playerA: {
          socketId: pair.playerA,
          ...playerResultA
        },
        playerB: {
          socketId: pair.playerB,
          ...playerResultB
        }
      });
      
      // Save round results to database
      if (roundDbId && playerA.dbId && playerB.dbId) {
        try {
          db.saveRoundResult(roundDbId, playerA.dbId, playerB.dbId, {
            price: priceA,
            opponentPrice: priceB,
            demand: demandA,
            profit: profitA,
            share: shareA
          });
          db.saveRoundResult(roundDbId, playerB.dbId, playerA.dbId, {
            price: priceB,
            opponentPrice: priceA,
            demand: demandB,
            profit: profitB,
            share: shareB
          });
        } catch (err) {
          console.error('Failed to save round results to database:', err);
        }
      }
      
      io.to(pair.playerA).emit('roundResults', formatPlayerPayload(playerA, playerResultA));
      io.to(pair.playerB).emit('roundResults', formatPlayerPayload(playerB, playerResultB));
    });
    session.roundResults.push({ round: roundNumber, results: resultsForRound });
    io.to(session.code).emit('roundSummary', {
      round: roundNumber,
      results: resultsForRound
    });
    broadcastSession(session);
    
    // Check if this was the last round
    if (session.currentRound >= session.config.rounds) {
      // Last round - end the session after a short delay
      session.timers.reveal = setTimeout(() => {
        finalizeSession(session);
      }, 2000); // 2 second delay to show results
      return;
    }
    
    // Start countdown timer for next round
    // Use breakTime if provided, otherwise fall back to resultRevealTime
    const breakTime = session.config.breakTime ?? session.config.resultRevealTime;
    let countdown = breakTime;
    io.to(session.code).emit('nextRoundCountdown', { countdown });
    
    const countdownInterval = setInterval(() => {
      countdown -= 1;
      if (countdown > 0) {
        io.to(session.code).emit('nextRoundCountdown', { countdown });
      } else {
        clearInterval(countdownInterval);
      }
    }, 1000);
    
    session.timers.reveal = setTimeout(() => {
      clearInterval(countdownInterval);
      startNextRound(session);
    }, breakTime * 1000);
  }

  function formatPlayerPayload(player, latestResult) {
    const previous = player.history.slice(-2, -1)[0] || null;
    return {
      round: latestResult.round,
      price: latestResult.price,
      demand: latestResult.demand,
      profit: latestResult.profit,
      share: latestResult.share,
      opponentPrice: latestResult.opponentPrice,
      opponentDemand: latestResult.opponentDemand,
      opponentShare: latestResult.opponentShare,
      opponentProfit: latestResult.opponentProfit,
      opponentName: latestResult.opponentName,
      history: player.history,
      previousRound: previous
    };
  }

  function finalizeSession(session) {
    clearTimers(session);
    session.status = STATUS.COMPLETE;
    
    // Update session status in database
    if (session.dbId) {
      try {
        db.updateSessionStatus(session.code, STATUS.COMPLETE);
      } catch (err) {
        console.error('Failed to update session completion status:', err);
      }
    }
    
    io.to(session.code).emit('sessionComplete', {
      rounds: session.roundResults
    });
    broadcastSession(session);
  }

  function clearTimers(session) {
    if (session.timers.round) {
      clearTimeout(session.timers.round);
    }
    if (session.timers.reveal) {
      clearTimeout(session.timers.reveal);
    }
    if (session.timers.timerBroadcast) {
      clearInterval(session.timers.timerBroadcast);
    }
    session.timers.round = null;
    session.timers.reveal = null;
    session.timers.timerBroadcast = null;
  }

  function handleEndSession(socket, sessionCode) {
    try {
      const session = ensureSession(sessionCode);
      
      // Check if the requester is an instructor
      const player = session.players.get(socket.id);
      if (!player || player.role !== 'instructor') {
        throw new Error('Only instructors can end the session');
      }
      
      console.log(`Instructor ${player.name} manually ended session ${sessionCode}`);
      finalizeSession(session);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  function handleDisconnect(socketId) {
    sessions.forEach(session => {
      const player = session.players.get(socketId);
      if (!player) return;
      player.connected = false;
      broadcastSession(session);
      if (session.instructorSocket === socketId) {
        console.log(`Instructor disconnected from session ${session.code}`);
      }
    });
  }

  function handleHeartbeat(socketId) {
    sessions.forEach(session => {
      const player = session.players.get(socketId);
      if (player) {
        player.lastHeartbeat = Date.now();
        // Only broadcast every 5 seconds to reduce network traffic
        if (!session.lastHeartbeatBroadcast || Date.now() - session.lastHeartbeatBroadcast > 5000) {
          session.lastHeartbeatBroadcast = Date.now();
          broadcastSession(session);
        }
      }
    });
  }

  function handleChatMessage(socket, { sessionCode, message }) {
    try {
      const session = ensureSession(sessionCode);
      const player = session.players.get(socket.id);
      
      if (!player || player.role !== 'student') {
        throw new Error('Only students can send chat messages');
      }
      
      // Check if chat is enabled for this session
      if (!session.config.enableChat) {
        throw new Error('Chat is not enabled for this session');
      }
      
      // Find the player's pair
      if (!player.pairId) {
        throw new Error('You are not paired with anyone');
      }
      
      const pair = session.pairs.find(p => p.id === player.pairId);
      if (!pair) {
        throw new Error('Pair not found');
      }
      
      // Find the opponent
      const opponentId = pair.playerA === socket.id ? pair.playerB : pair.playerA;
      const opponent = session.players.get(opponentId);
      
      if (!opponent) {
        throw new Error('Opponent not found');
      }
      
      // Send message to opponent (and back to sender for confirmation)
      const chatPayload = {
        from: player.name,
        fromSocketId: socket.id,
        message: message.trim(),
        timestamp: Date.now()
      };
      
      // Send to opponent
      io.to(opponentId).emit('chatMessage', chatPayload);
      
      // Send back to sender (for confirmation)
      socket.emit('chatMessage', chatPayload);
      
      console.log(`[Chat] ${player.name} → ${opponent.name}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
      
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  return {
    createSession,
    handleJoin,
    handleOpenLobby,
    handleStartSession,
    handlePriceSubmission,
    handleChatMessage,
    handleEndSession,
    handleDisconnect,
    handleHeartbeat
  };
}

