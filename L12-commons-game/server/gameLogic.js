const DEFAULT_CONFIG = {
  rounds: 3,
  roundTime: 30,
  resultRevealTime: 2, // Brief pause before showing results
  countdownTime: 10, // Countdown between rounds
  initialFish: 16,
  maxFish: 999999, // Effectively no cap - fish can grow indefinitely
  maxCatchPerRound: 4,
  playersPerPond: 4  // Changed from playersPerGame to playersPerPond
};

const SESSION_CODE_LENGTH = 4;
const STATUS = {
  LOBBY: 'lobby',
  RUNNING: 'running',
  COMPLETE: 'complete'
};

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

  function createSession(instructorName, configOverrides) {
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
      config,
      instructorSocket: null,
      status: STATUS.LOBBY,
      currentRound: 0,
      players: new Map(),
      ponds: new Map(), // Each pond has its own fish population
      roundResults: [],
      submissions: new Map(),
      timers: {
        round: null,
        reveal: null,
        countdown: null,
        countdownInterval: null
      },
      timestamps: {
        roundStartTime: null,
        countdownStartTime: null
      },
      isFinalizingRound: false,
      isFinalized: false
    };

    sessions.set(code, session);
    console.log(`Session ${code} created by ${instructorName}`);
    return { code, config };
  }

  // Throttle broadcast to prevent flooding with too many updates
  let lastBroadcast = new Map();
  const BROADCAST_THROTTLE_MS = 50; // Min 50ms between broadcasts for same session
  
  function broadcastSession(session, force = false) {
    const now = Date.now();
    const lastTime = lastBroadcast.get(session.code) || 0;
    
    // Throttle broadcasts unless forced
    if (!force && (now - lastTime) < BROADCAST_THROTTLE_MS) {
      return;
    }
    
    lastBroadcast.set(session.code, now);
    
    // Optimize payload - only send necessary data
    const payload = {
      code: session.code,
      status: session.status,
      currentRound: session.currentRound,
      config: session.config,
      players: Array.from(session.players.values()).map(player => ({
        socketId: player.socketId,
        name: player.name,
        role: player.role,
        connected: player.connected,
        totalFish: player.totalFish,
        pondId: player.pondId || null,
        history: player.history || [] // Include history for all players so instructor can see it
      })),
      ponds: Array.from(session.ponds.entries()).map(([pondId, pond]) => ({
        id: pondId,
        remainingFish: pond.remainingFish,
        players: pond.playerIds
      })),
      roundResults: session.roundResults
    };
    
    // Emit session update
    // Use volatile for frequent updates, but not for forced updates (which are important)
    if (force) {
      io.to(session.code).emit('sessionUpdate', payload);
    } else {
      io.volatile.to(session.code).emit('sessionUpdate', payload);
    }
  }

  function ensureSession(code) {
    const session = sessions.get(code);
    if (!session) {
      console.error(`❌ Session not found: "${code}". Available sessions:`, Array.from(sessions.keys()));
      throw new Error('Session not found');
    }
    return session;
  }

  function ensureInstructor(socket, session) {
    if (session.instructorSocket !== socket.id) {
      throw new Error('Only instructor can perform this action');
    }
  }

  function registerPlayer(session, socket, { playerName, role }) {
    if (!playerName) {
      throw new Error('Name is required');
    }
    
    console.log(`🔍 RegisterPlayer: "${playerName}" (${role}) - Socket: ${socket.id}`);
    console.log(`   Current players in session:`, Array.from(session.players.values()).map(p => `${p.name} (${p.socketId}, connected: ${p.connected})`));
    
    // Allow observers to join without being counted as players
    if (role === 'observer') {
      const observer = {
        socketId: socket.id,
        sessionCode: session.code,
        name: playerName,
        role: 'observer',
        connected: true
      };
      session.players.set(socket.id, observer);
      // Don't return early - observers need to join the room too!
      socket.join(session.code);
      socket.data.sessionCode = session.code;
      socket.data.role = 'observer';
      return;
    }
    
    // Check if this player already exists (reconnection)
    const existingPlayer = Array.from(session.players.values()).find(
      p => p.name === playerName && p.role === (role === 'instructor' ? 'instructor' : 'student')
    );
    
    console.log(`   Existing player found:`, existingPlayer ? `Yes - ${existingPlayer.socketId} (connected: ${existingPlayer.connected})` : 'No');
    
    if (existingPlayer) {
      // Player is reconnecting - preserve their data, just update socket
      const oldSocketId = existingPlayer.socketId;
      existingPlayer.socketId = socket.id;
      existingPlayer.connected = true;
      
      // If they were AI-controlled (disconnected during game), make them human again
      if (existingPlayer.isAI) {
        existingPlayer.isAI = false;
        console.log(`👤 ${playerName} reconnected - now human-controlled again`);
      }
      
      // Remove the old socket ID entry if it's different
      if (oldSocketId !== socket.id) {
        session.players.delete(oldSocketId);
        console.log(`🔄 Player ${playerName} reconnected: ${oldSocketId} → ${socket.id}`);
        
        // CRITICAL FIX: Update the pond's playerIds array with new socket ID
        if (existingPlayer.pondId) {
          const pond = session.ponds.get(existingPlayer.pondId);
          if (pond) {
            const oldIndex = pond.playerIds.indexOf(oldSocketId);
            if (oldIndex !== -1) {
              pond.playerIds[oldIndex] = socket.id;
              console.log(`🔄 Updated ${existingPlayer.pondId} playerIds: ${oldSocketId} → ${socket.id}`);
            }
          }
        }
      }
      
      // Add with new socket ID
      session.players.set(socket.id, existingPlayer);
    } else {
      // New player
      const player = {
        socketId: socket.id,
        sessionCode: session.code,
        name: playerName,
        role: role === 'instructor' ? 'instructor' : 'student',
        connected: true,
        totalFish: 0,
        history: [],
        pondId: null // Will be assigned when game starts
      };
      session.players.set(socket.id, player);
    }
    
    socket.join(session.code);
    socket.data.sessionCode = session.code;
    socket.data.role = role === 'instructor' ? 'instructor' : 'student';
    if (role === 'instructor') {
      session.instructorSocket = socket.id;
    }
  }

  function handleJoin(socket, { sessionCode, playerName, role }) {
    try {
      console.log(`Join attempt - Socket: ${socket.id}, Code: "${sessionCode}", Name: "${playerName}", Role: "${role}"`);
      
      if (!sessionCode) {
        throw new Error('Session code is required');
      }
      
      const code = sessionCode.trim().toUpperCase();
      
      if (!code || code.length === 0) {
        throw new Error('Session code cannot be empty');
      }
      
      const session = ensureSession(code);
      
      // Check if this is a returning player
      const existingPlayer = Array.from(session.players.values()).find(
        p => p.name === playerName && p.role === role
      );
      
      // Prevent NEW students from joining if game is already running
      // But allow observers to join at any time
      if (role !== 'instructor' && role !== 'observer' && !existingPlayer && session.status === STATUS.RUNNING) {
        throw new Error('GAME_ALREADY_STARTED');
      }
      
      registerPlayer(session, socket, { playerName, role });
      socket.emit('joinedSession', {
        code,
        role: socket.data.role,
        status: session.status,
        config: session.config,
        currentRound: session.currentRound
      });
      
      // If student is reconnecting to an active round, send current round state
      if (role !== 'instructor' && session.status === STATUS.RUNNING && session.currentRound > 0) {
        const player = session.players.get(socket.id);
        
        // Dynamic round time: 30s for round 1, 20s for all other rounds
        const currentRoundTime = session.currentRound === 1 ? 30 : 20;
        
        // Calculate remaining time
        let remainingTime = 0;
        let isCountdown = false;
        
        if (session.timestamps.countdownStartTime) {
          // In countdown phase
          const elapsed = Math.floor((Date.now() - session.timestamps.countdownStartTime) / 1000);
          remainingTime = Math.max(0, session.config.countdownTime - elapsed);
          isCountdown = true;
        } else if (session.timestamps.roundStartTime) {
          // In active round - use dynamic round time
          const elapsed = Math.floor((Date.now() - session.timestamps.roundStartTime) / 1000);
          remainingTime = Math.max(0, currentRoundTime - elapsed);
        }
        
        if (player && player.pondId) {
          // Students with ponds get full info
          const pond = session.ponds.get(player.pondId);
          
          // Don't send timer updates if pond is depleted
          if (!pond?.depleted) {
            // Send round state
            socket.emit('roundStarted', {
              round: session.currentRound,
              roundTime: currentRoundTime,
              remainingFish: pond?.remainingFish || 0,
              pondId: player.pondId,
              currentTimer: remainingTime
            });
            
            // Send countdown if applicable
            if (isCountdown && remainingTime > 0) {
              socket.emit('roundCountdown', {
                timeRemaining: remainingTime,
                nextRound: session.currentRound + 1
              });
            }
          }
          
          // Send latest results if available (always show history even if depleted)
          if (player.history && player.history.length > 0) {
            const latestResult = player.history[player.history.length - 1];
            socket.emit('roundResults', {
              ...latestResult,
              history: player.history
            });
          }
        } else if (role === 'observer') {
          // Observers get basic timer info (like instructors)
          socket.emit('roundStarted', {
            round: session.currentRound,
            roundTime: currentRoundTime,
            currentTimer: remainingTime
          });
          
          // Send countdown if applicable
          if (isCountdown && remainingTime > 0) {
            socket.emit('roundCountdown', {
              timeRemaining: remainingTime,
              nextRound: session.currentRound + 1
            });
          }
        }
      }
      
      broadcastSession(session);
      console.log(`✅ ${playerName} (${role}) joined session ${code}`);
    } catch (err) {
      console.error(`❌ Join failed - Socket: ${socket.id}, Error: ${err.message}`);
      socket.emit('errorMessage', err.message);
    }
  }

  function createPonds(session) {
    const students = Array.from(session.players.values()).filter(p => p.role === 'student' && !p.isAI);
    const playersPerPond = session.config.playersPerPond;
    
    // Calculate how many ponds we need
    const totalPlayers = students.length;
    const remainder = totalPlayers % playersPerPond;
    const neededAI = remainder === 0 ? 0 : (playersPerPond - remainder);
    
    // Add AI players if needed
    if (neededAI > 0) {
      for (let i = 1; i <= neededAI; i++) {
        const aiId = `ai-${Date.now()}-${i}`;
        const aiPlayer = {
          socketId: aiId,
          sessionCode: session.code,
          name: `AI Player ${i}`,
          role: 'student',
          connected: true,
          totalFish: 0,
          history: [],
          isAI: true,
          pondId: null
        };
        session.players.set(aiId, aiPlayer);
        students.push(aiPlayer);
      }
      console.log(`Added ${neededAI} AI player(s) to session ${session.code}`);
    }
    
    // Shuffle students for random pond assignment
    const shuffled = [...students].sort(() => Math.random() - 0.5);
    
    // Create ponds and assign players
    const numPonds = Math.ceil(shuffled.length / playersPerPond);
    session.ponds.clear();
    
    for (let i = 0; i < numPonds; i++) {
      const pondId = `Pond ${i + 1}`;
      const pondPlayers = shuffled.slice(i * playersPerPond, (i + 1) * playersPerPond);
      
      session.ponds.set(pondId, {
        id: pondId,
        remainingFish: session.config.initialFish,
        playerIds: pondPlayers.map(p => p.socketId)
      });
      
      // Assign pond to players
      pondPlayers.forEach(player => {
        player.pondId = pondId;
      });
      
      console.log(`${pondId} created with ${pondPlayers.length} players: ${pondPlayers.map(p => p.name).join(', ')}`);
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
      
      if (students.length === 0) {
        throw new Error('Need at least 1 student to start');
      }
      
      // Create ponds and assign players
      createPonds(session);
      
      session.status = STATUS.RUNNING;
      session.currentRound = 0;
      broadcastSession(session);
      startNextRound(session);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  function startNextRound(session) {
    clearTimers(session);
    
    // Reset the finalization flag for the new round
    session.isFinalizingRound = false;
    
    if (session.currentRound >= session.config.rounds) {
      finalizeSession(session);
      return;
    }
    session.currentRound += 1;
    session.submissions.clear();
    
    // Track when this round started
    session.timestamps.roundStartTime = Date.now();
    session.timestamps.countdownStartTime = null;
    
    // Dynamic round time: 30s for round 1, 20s for all other rounds
    const currentRoundTime = session.currentRound === 1 ? 30 : 20;
    
    // Broadcast round start to all players with their pond info
    session.players.forEach(player => {
      if (player.role === 'student') {
        const pond = session.ponds.get(player.pondId);
        
        // Don't send round updates to students in depleted ponds
        if (pond?.depleted) {
          console.log(`⚠️  Skipping roundStarted for ${player.name} - pond depleted`);
          return;
        }
        
        io.to(player.socketId).emit('roundStarted', {
          round: session.currentRound,
          roundTime: currentRoundTime,
          remainingFish: pond?.remainingFish || 0,
          pondId: player.pondId
        });
      } else if (player.role === 'instructor' || player.role === 'observer') {
        // Send roundStarted to instructor and observers too so they can see the timer
        io.to(player.socketId).emit('roundStarted', {
          round: session.currentRound,
          roundTime: currentRoundTime
        });
      }
    });
    
    broadcastSession(session);
    
    // Submit decisions for AI players after a short delay
    const students = Array.from(session.players.values()).filter(p => p.role === 'student');
    students.forEach(student => {
      if (student.isAI) {
        const delay = Math.random() * 2000 + 1000;
        setTimeout(() => {
          if (session.currentRound > 0 && !session.submissions.has(student.socketId)) {
            const randomFish = Math.floor(Math.random() * (session.config.maxCatchPerRound + 1));
            recordSubmission(session, student.socketId, randomFish, false);
            console.log(`AI ${student.name} (${student.pondId}) submitted ${randomFish} fish`);
            concludeRoundIfReady(session);
          }
        }, delay);
      }
    });
    
    session.timers.round = setTimeout(() => {
      forceSubmitMissing(session);
    }, currentRoundTime * 1000);
  }

  function forceSubmitMissing(session) {
    const students = Array.from(session.players.values()).filter(p => p.role === 'student');
    students.forEach(student => {
      if (!session.submissions.has(student.socketId)) {
        // Submit random number between 0 and maxCatchPerRound for students who didn't submit
        const randomFish = Math.floor(Math.random() * (session.config.maxCatchPerRound + 1));
        recordSubmission(session, student.socketId, randomFish, true);
        console.log(`⚠️  Auto-submitted ${randomFish} fish for ${student.name} (no response)`);
      }
    });
    // Timer expired, finalize the round
    finalizeRound(session);
  }

  function handleFishSubmission(socket, { sessionCode, fishCount }) {
    try {
      console.log(`Submission attempt - Socket: ${socket.id}, Code: "${sessionCode}", Fish: ${fishCount}`);
      
      if (!sessionCode) {
        throw new Error('Session code is required');
      }
      
      const session = ensureSession(sessionCode);
      if (session.status !== STATUS.RUNNING) {
        throw new Error('Session not running');
      }
      const player = session.players.get(socket.id);
      if (!player || player.role !== 'student') {
        throw new Error('Only active students can submit');
      }
      const numericFish = Number(fishCount);
      if (!Number.isInteger(numericFish) || numericFish < 0) {
        throw new Error('Fish count must be a non-negative integer');
      }
      if (numericFish > session.config.maxCatchPerRound) {
        throw new Error(`Cannot catch more than ${session.config.maxCatchPerRound} fish`);
      }
      recordSubmission(session, socket.id, numericFish, false);
      console.log(`✅ ${player.name} submitted ${numericFish} fish`);
      concludeRoundIfReady(session);
    } catch (err) {
      console.error(`❌ Submission failed - Socket: ${socket.id}, Error: ${err.message}`);
      socket.emit('errorMessage', err.message);
    }
  }

  function recordSubmission(session, socketId, fishCount, forced) {
    const player = session.players.get(socketId);
    if (!player) return;
    session.submissions.set(socketId, { fishCount, forced });
  }

  function concludeRoundIfReady(session) {
    const students = Array.from(session.players.values()).filter(p => p.role === 'student');
    const allSubmitted = students.every(student => session.submissions.has(student.socketId));
    if (!allSubmitted) return;
    // All submitted, but don't clear timer - wait for full time to expire
    console.log(`All students submitted for round ${session.currentRound}, waiting for timer to expire...`);
  }

  function finalizeRound(session) {
    // Guard against multiple calls
    if (session.isFinalizingRound) {
      console.log(`⚠️  Already finalizing round ${session.currentRound}, skipping duplicate call`);
      return;
    }
    session.isFinalizingRound = true;
    
    const roundNumber = session.currentRound;
    const roundResults = [];
    
    // Batch all emissions to improve performance with many students
    const emissionQueue = [];
    
    // Process each pond separately
    session.ponds.forEach((pond, pondId) => {
      const pondPlayers = pond.playerIds.map(id => session.players.get(id)).filter(p => p);
      
      // Calculate total requested
      let totalRequested = 0;
      pondPlayers.forEach(player => {
        const submission = session.submissions.get(player.socketId);
        if (submission) {
          totalRequested += submission.fishCount;
        }
      });

      // Calculate total caught and individual allocations
      let totalCaught = 0;
      const allocations = [];
      
      if (totalRequested === 0) {
        // Nobody requested anything
        pondPlayers.forEach(player => {
          allocations.push({ player, requested: 0, caught: 0 });
        });
      } else if (totalRequested <= pond.remainingFish) {
        // Enough fish for everyone - give each player EXACTLY what they requested
        pondPlayers.forEach(player => {
          const submission = session.submissions.get(player.socketId);
          const requested = submission ? submission.fishCount : 0;
          allocations.push({ player, requested, caught: requested });
          totalCaught += requested;
        });
      } else {
        // NOT enough fish - use proportional allocation (prorated)
        // Each player gets: (requested / totalRequested) * availableFish
        // Example: 8 fish available, requests [2,4,3,4] (total=13)
        //   Player 1: 8 * (2/13) ≈ 1.23 fish
        //   Player 2: 8 * (4/13) ≈ 2.46 fish
        //   Player 3: 8 * (3/13) ≈ 1.85 fish
        //   Player 4: 8 * (4/13) ≈ 2.46 fish
        
        // First pass: calculate proportional amounts and round them
        pondPlayers.forEach((player, index) => {
          const submission = session.submissions.get(player.socketId);
          const requested = submission ? submission.fishCount : 0;
          // Proportional allocation: (requested / totalRequested) * availableFish
          const proportionalCatch = (requested / totalRequested) * pond.remainingFish;
          const roundedCatch = Math.round(proportionalCatch * 100) / 100; // Round to 2 decimal places
          allocations.push({ player, requested, caught: roundedCatch });
          totalCaught += roundedCatch;
        });
        
        // Fix rounding errors: adjust the allocation to match exactly available fish
        // Add/subtract the rounding error from the player with the largest allocation
        const roundingError = Math.round((pond.remainingFish - totalCaught) * 100) / 100;
        if (Math.abs(roundingError) > 0.001) {
          // Find player with largest allocation to adjust
          let maxIndex = 0;
          for (let i = 1; i < allocations.length; i++) {
            if (allocations[i].caught > allocations[maxIndex].caught) {
              maxIndex = i;
            }
          }
          allocations[maxIndex].caught = Math.round((allocations[maxIndex].caught + roundingError) * 100) / 100;
          totalCaught = pond.remainingFish; // Now totalCaught exactly matches available
        }
      }

      // Update each player's results in this pond
      allocations.forEach(({ player, requested, caught }) => {
        player.totalFish += caught;
        
        const playerResult = {
          round: roundNumber,
          requested: requested,
          caught: caught,
          totalFish: player.totalFish,
          name: player.name,
          pondId: pondId,
          pondTotalCaught: totalCaught
        };
        
        player.history.push(playerResult);
        roundResults.push({
          socketId: player.socketId,
          ...playerResult
        });

        // Don't emit here - wait until after fish doubling calculation
      });

      // Update pond's remaining fish and double them (capped at maxFish)
      pond.remainingFish = Math.max(0, pond.remainingFish - totalCaught);
      // Round to avoid floating point precision issues
      pond.remainingFish = Math.round(pond.remainingFish * 100) / 100;
      const fishBeforeDoubling = pond.remainingFish;
      const maxFish = session.config.maxFish || 40; // Fallback to 40 if not set
      pond.remainingFish = Math.min(pond.remainingFish * 2, maxFish);
      // Round after doubling to avoid tiny remainders
      pond.remainingFish = Math.round(pond.remainingFish * 100) / 100;
      const fishAfterDoubling = pond.remainingFish;
      
      // Check if pond is depleted and mark it permanently
      const pondDepleted = fishAfterDoubling === 0;
      if (pondDepleted) {
        pond.depleted = true; // Mark pond as permanently depleted
      }
      
      // Update history with remaining fish after doubling AND queue emissions
      pondPlayers.forEach(player => {
        if (player.history.length > 0) {
          player.history[player.history.length - 1].remainingFish = fishAfterDoubling;
          player.history[player.history.length - 1].fishBeforeDoubling = fishBeforeDoubling;
          player.history[player.history.length - 1].fishAfterDoubling = fishAfterDoubling;
          player.history[player.history.length - 1].pondDepleted = pondDepleted;
          
          // Queue emission instead of emitting immediately
          emissionQueue.push({
            socketId: player.socketId,
            event: 'roundResults',
            data: {
              round: roundNumber,
              requested: player.history[player.history.length - 1].requested,
              caught: player.history[player.history.length - 1].caught,
              totalFish: player.totalFish,
              history: player.history,
              pondId: pondId,
              pondTotalCaught: totalCaught,
              fishBeforeDoubling: fishBeforeDoubling,
              fishAfterDoubling: fishAfterDoubling,
              pondDepleted: pondDepleted
            }
          });
        }
      });
      
      if (pondDepleted) {
        console.log(`⚠️  ${pondId} Round ${roundNumber}: POND DEPLETED! All fish caught. Game over for this pond.`);
      } else {
        console.log(`${pondId} Round ${roundNumber}: Caught ${totalCaught}, Before doubling: ${fishBeforeDoubling}, After: ${fishAfterDoubling} (capped at ${maxFish})`);
      }
    });

    session.roundResults.push({ 
      round: roundNumber, 
      results: roundResults
    });

    // Batch emit all queued messages (more efficient than individual emits)
    emissionQueue.forEach(({ socketId, event, data }) => {
      io.to(socketId).emit(event, data);
    });

    // Broadcast round summary
    io.to(session.code).emit('roundSummary', {
      round: roundNumber,
      results: roundResults
    });

    broadcastSession(session, true); // Force broadcast after round finalization
    
    // Check if this was the last round
    if (session.currentRound >= session.config.rounds) {
      // Show results for resultRevealTime, then finalize immediately (no countdown)
      session.timers.reveal = setTimeout(() => {
        finalizeSession(session);
      }, session.config.resultRevealTime * 1000);
    } else {
      // Show results for resultRevealTime, then start countdown to next round
      session.timers.reveal = setTimeout(() => {
        startCountdown(session);
      }, session.config.resultRevealTime * 1000);
    }
  }

  function startCountdown(session) {
    const countdownTime = session.config.countdownTime;
    let timeRemaining = countdownTime;
    
    // Track when countdown started
    session.timestamps.countdownStartTime = Date.now();
    session.timestamps.roundStartTime = null;
    
    // Clear any existing countdown interval
    if (session.timers.countdownInterval) {
      clearInterval(session.timers.countdownInterval);
    }
    
    // Helper function to emit countdown only to active players (not in depleted ponds)
    const emitCountdownToActivePlayers = (payload) => {
      session.players.forEach(player => {
        if (player.role === 'student') {
          const pond = session.ponds.get(player.pondId);
          // Only send to students whose ponds are NOT depleted
          if (!pond?.depleted) {
            io.to(player.socketId).emit('roundCountdown', payload);
          }
        } else if (player.role === 'instructor' || player.role === 'observer') {
          // Always send to instructors and observers
          io.to(player.socketId).emit('roundCountdown', payload);
        }
      });
    };
    
    // Emit initial countdown
    emitCountdownToActivePlayers({
      timeRemaining,
      nextRound: session.currentRound + 1
    });
    
    // Update countdown every second
    session.timers.countdownInterval = setInterval(() => {
      timeRemaining -= 1;
      
      if (timeRemaining > 0) {
        emitCountdownToActivePlayers({
          timeRemaining,
          nextRound: session.currentRound + 1
        });
      } else {
        clearInterval(session.timers.countdownInterval);
        session.timers.countdownInterval = null;
      }
    }, 1000);
    
    // Start next round after countdown completes
    session.timers.countdown = setTimeout(() => {
      if (session.timers.countdownInterval) {
        clearInterval(session.timers.countdownInterval);
        session.timers.countdownInterval = null;
      }
      startNextRound(session);
    }, countdownTime * 1000);
  }

  function finalizeSession(session) {
    // Guard against multiple calls
    if (session.isFinalized) {
      console.log(`⚠️  Session ${session.code} already finalized, skipping duplicate call`);
      return;
    }
    session.isFinalized = true;
    
    console.log(`🏁 Finalizing session ${session.code}...`);
    clearTimers(session);
    session.status = STATUS.COMPLETE;
    
    // Split remaining fish among players in each pond (but keep pond.remainingFish for display)
    session.ponds.forEach((pond, pondId) => {
      const pondPlayers = pond.playerIds.map(id => session.players.get(id)).filter(p => p && p.role === 'student');
      
      if (pondPlayers.length > 0 && pond.remainingFish > 0) {
        const fishPerPlayer = pond.remainingFish / pondPlayers.length;
        const fishToDistribute = pond.remainingFish; // Store for logging
        
        pondPlayers.forEach(player => {
          player.totalFish += fishPerPlayer;
          console.log(`${pondId} - Final split: ${player.name} receives ${fishPerPlayer.toFixed(2)} fish (${fishToDistribute} fish ÷ ${pondPlayers.length} players)`);
        });
        
        console.log(`${pondId} - Remaining ${fishToDistribute} fish split among ${pondPlayers.length} players`);
        // Note: We keep pond.remainingFish unchanged for display purposes on the dashboard
      }
    });
    
    console.log(`📢 Emitting sessionComplete to session ${session.code}`);
    io.to(session.code).emit('sessionComplete', {
      rounds: session.roundResults
    });
    broadcastSession(session, true); // force=true to guarantee delivery of final status
    console.log(`✅ Session ${session.code} finalized successfully`);
  }

  function clearTimers(session) {
    if (session.timers.round) {
      clearTimeout(session.timers.round);
    }
    if (session.timers.reveal) {
      clearTimeout(session.timers.reveal);
    }
    if (session.timers.countdown) {
      clearTimeout(session.timers.countdown);
    }
    if (session.timers.countdownInterval) {
      clearInterval(session.timers.countdownInterval);
    }
    session.timers.round = null;
    session.timers.reveal = null;
    session.timers.countdown = null;
    session.timers.countdownInterval = null;
  }

  function handleDisconnect(socketId) {
    sessions.forEach(session => {
      const player = session.players.get(socketId);
      if (!player) return;
      
      player.connected = false;
      
      // If student disconnects during an active game, mark them as AI
      // so they continue playing with random submissions
      if (player.role === 'student' && session.status === STATUS.RUNNING) {
        player.isAI = true;
        console.log(`🤖 Student ${player.name} disconnected - now AI-controlled`);
      }
      
      broadcastSession(session);
      
      if (session.instructorSocket === socketId) {
        console.log(`Instructor disconnected from session ${session.code}`);
      }
    });
  }

  return {
    createSession,
    handleJoin,
    handleStartSession,
    handleFishSubmission,
    handleDisconnect
  };
}
