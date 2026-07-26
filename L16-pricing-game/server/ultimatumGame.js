import * as db from './database.js';

const DEFAULT_CONFIG = {
  rounds: 1, // Default number of rounds
  proposeTime: 10, // 10 seconds for proposer
  respondTime: 10, // 10 seconds for responder
  resultRevealTime: 10,
  totalAmount: 20, // The amount to split
  minOffer: 0,
  maxOffer: 20
};

const SESSION_CODE_LENGTH = 4;
const STATUS = {
  SETUP: 'setup',
  LOBBY: 'lobby',
  PROPOSING: 'proposing', // Phase 1
  RESPONDING: 'responding', // Phase 2
  COMPLETE: 'complete'
};

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
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

export function createUltimatumGameManager(io) {
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
    console.log('Creating Ultimatum session with config:', config);
    const session = {
      code,
      gameType: 'ultimatum',
      sessionName: sessionName || `${instructorName}'s Ultimatum Game`,
      config,
      instructorSocket: null,
      instructorName,
      status: STATUS.SETUP,
      currentRound: 0,
      players: new Map(),
      pairs: [],
      roundResults: [], // History of all rounds
      currentOffers: new Map(), // Map<pairId, { proposerId, amount }>
      currentDecisions: new Map(), // Map<pairId, { responderId, accepted }>
      timers: {
        phase: null,
        reveal: null,
        broadcast: null
      },
      phaseStartTime: null,
      phaseDuration: 0
    };

    sessions.set(code, session);
    console.log(`Ultimatum Session ${code} created by ${instructorName}`);
    return { 
      code, 
      sessionName: session.sessionName, 
      instructorName: session.instructorName,
      config,
      status: session.status,
      gameType: 'ultimatum' 
    };
  }

  function broadcastSession(session) {
    const payload = {
      code: session.code,
      status: session.status,
      currentRound: session.currentRound,
      config: session.config,
      players: Array.from(session.players.values()).map(p => ({
        socketId: p.socketId,
        name: p.name,
        role: p.role,
        connected: p.connected,
        pairId: p.pairId,
        playerType: p.playerType // 1 (Proposer) or 2 (Responder)
      })),
      roundResults: session.roundResults, // Include results for instructor view
      gameType: 'ultimatum'
    };
    io.to(session.code).emit('sessionUpdate', payload);
  }

  function ensureSession(code) {
    const session = sessions.get(code);
    if (!session) return null; // Return null instead of throwing to allow checking other manager
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
          const nameToUse = playerName || existingPlayer.name;
          if (playerName && existingPlayer.name !== playerName) {
            throw new Error('Name does not match this student code');
          }
          
          const oldSocketId = existingPlayer.socketId;
          session.players.delete(oldSocketId);
          existingPlayer.socketId = socket.id;
          existingPlayer.connected = true;
          session.players.set(socket.id, existingPlayer);
          
          if (existingPlayer.pairId) {
            const pair = session.pairs.find(p => p.id === existingPlayer.pairId);
            if (pair) {
              if (pair.player1 === oldSocketId) pair.player1 = socket.id;
              if (pair.player2 === oldSocketId) pair.player2 = socket.id;
            }
          }
          
          socket.join(session.code);
          socket.data.sessionCode = session.code;
          socket.data.role = existingPlayer.role;
          socket.data.studentCode = studentCode;
          socket.data.gameType = 'ultimatum';
          console.log(`${nameToUse} rejoined Ultimatum session ${session.code}`);
          return existingPlayer.studentCode;
        }
      }

    if (!playerName) throw new Error('Name is required');

    let newStudentCode = null;
    if (role === 'student') {
        do {
            newStudentCode = randomCode() + randomCode().substring(0, 2);
        } while (Array.from(session.players.values()).some(p => p.studentCode === newStudentCode));
    }

    const player = {
      socketId: socket.id,
      sessionCode: session.code,
      name: playerName,
      role: role === 'instructor' ? 'instructor' : 'student',
      connected: true,
      pairId: null,
      playerType: null, // 1 or 2
      history: [],
      studentCode: newStudentCode
    };

    session.players.set(socket.id, player);
    socket.join(session.code);
    socket.data.sessionCode = session.code;
    socket.data.role = player.role;
    socket.data.gameType = 'ultimatum';
    if (newStudentCode) socket.data.studentCode = newStudentCode;

    if (player.role === 'instructor') {
      session.instructorSocket = socket.id;
    }
    
    return newStudentCode;
  }

  function handleJoin(socket, payload) {
    const { sessionCode, playerName, role, studentCode } = payload;
    const code = sessionCode?.trim().toUpperCase();
    const session = ensureSession(code);
    
    if (!session) return false; // Not handled by this manager

    try {
      if (role === 'student' && !studentCode) {
        if (session.status === STATUS.SETUP) {
            throw new Error('Session not open yet');
        } else if (session.status !== STATUS.LOBBY) {
            throw new Error('Game already started');
        }
      }

      const returnedCode = registerPlayer(session, socket, { playerName, role, studentCode });
      const finalStudentCode = returnedCode || studentCode;
      
      const actualPlayer = session.players.get(socket.id);

      socket.emit('joinedSession', {
        code,
        role: socket.data.role,
        status: session.status,
        config: session.config,
        currentRound: session.currentRound,
        roundResults: session.roundResults, // Include for instructor
        gameType: 'ultimatum',
        studentCode: finalStudentCode,
        playerName: actualPlayer ? actualPlayer.name : playerName
      });

      // Send current state if rejoining
      if (session.status === STATUS.PROPOSING || session.status === STATUS.RESPONDING) {
         sendRoundStateToPlayer(session, socket.id);
      }

      broadcastSession(session);
      return true;
    } catch (err) {
      socket.emit('errorMessage', err.message);
      return true; // Handled, even if error
    }
  }

  function sendRoundStateToPlayer(session, socketId) {
      const player = session.players.get(socketId);
      if (!player || !player.pairId) return;

      const pair = session.pairs.find(p => p.id === player.pairId);
      if (!pair) return;

      const currentOffer = session.currentOffers.get(player.pairId);
      
      // Calculate remaining time
      const elapsed = session.phaseStartTime ? (Date.now() - session.phaseStartTime) / 1000 : 0;
      const remainingTime = Math.max(0, session.phaseDuration - elapsed);

      socket.emit('ultimatum:roundState', {
          status: session.status,
          playerType: player.playerType,
          offer: currentOffer ? currentOffer.amount : null,
          remainingTime: Math.ceil(remainingTime),
          round: session.currentRound
      });
  }

  function handleOpenLobby(socket, sessionCode) {
    const session = ensureSession(sessionCode);
    if (!session) return false;
    
    try {
      ensureInstructor(socket, session);
      if (session.status !== STATUS.SETUP) throw new Error('Not in setup mode');
      session.status = STATUS.LOBBY;
      broadcastSession(session);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
    return true;
  }

  function pairStudents(session) {
    const students = Array.from(session.players.values()).filter(p => p.role === 'student');
    // Shuffle
    for (let i = students.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [students[i], students[j]] = [students[j], students[i]];
    }

    session.pairs = [];
    session.currentOffers.clear();
    session.currentDecisions.clear();

    // If odd, we might need an AI or sit out. 
    // For simplicity, let's assume even or add a bot if requested. 
    // The pricing game adds an AI. Let's add a dummy bot if needed or just handle odd numbers by sitting out (simple).
    // User request: "One student will be play 1 and another will be player 2".
    // I'll implement a simple AI for odd number of students later if needed. For now, let's just warn or handle.
    // Let's copy the AI logic from pricing game if possible, but simpler: random behavior.
    
    if (students.length % 2 !== 0) {
        // Create simple AI bot
        const aiPlayer = {
            socketId: `ai-${Date.now()}`,
            name: 'AutoBot 🤖',
            role: 'ai',
            connected: true,
            playerType: null,
            history: [],
            studentCode: null,
            isAI: true
        };
        session.players.set(aiPlayer.socketId, aiPlayer);
        students.push(aiPlayer);
    }

    for (let i = 0; i < students.length; i += 2) {
      const p1 = students[i];
      const p2 = students[i + 1];
      const pairId = `pair-${(i/2) + 1}`;
      
      // Assign roles for this round. 
      // Ideally we swap roles in subsequent rounds? Or random?
      // Let's randomize who is Player 1 (Proposer) and Player 2 (Responder)
      // Or just keep p1 as 1. Let's random swap for fairness if single round, or just array shuffle handled it.
      
      p1.pairId = pairId;
      p2.pairId = pairId;
      p1.playerType = 1; // Proposer
      p2.playerType = 2; // Responder

      session.pairs.push({
        id: pairId,
        player1: p1.socketId,
        player2: p2.socketId
      });
    }
  }

  function startNextRound(session) {
    if (session.currentRound >= session.config.rounds) {
        finalizeSession(session);
        return;
    }

    session.currentRound += 1;
    
    console.log(`Starting round ${session.currentRound} with proposeTime=${session.config.proposeTime}s, respondTime=${session.config.respondTime}s`);
    
    // Repair or swap roles?
    // Economic experiments usually switch partners (Stranger matching) or keep partners (Partner matching).
    // The pricing game does random matching every round. Let's do that.
    pairStudents(session);

    // Start Phase 1: Proposing
    session.status = STATUS.PROPOSING;
    session.phaseDuration = session.config.proposeTime;
    session.phaseStartTime = Date.now();
    
    broadcastSession(session);
    startTimer(session, session.config.proposeTime, handlePhase1Timeout);
  }

  function startTimer(session, duration, callback) {
    if (session.timers.phase) clearTimeout(session.timers.phase);
    if (session.timers.broadcast) clearInterval(session.timers.broadcast);

    let remaining = duration;
    
    // Immediate broadcast
    io.to(session.code).emit('timerUpdate', { remaining });

    session.timers.broadcast = setInterval(() => {
      remaining--;
      if (remaining >= 0) {
        io.to(session.code).emit('timerUpdate', { remaining });
      }
    }, 1000);

    session.timers.phase = setTimeout(() => {
        if (session.timers.broadcast) clearInterval(session.timers.broadcast);
        callback(session);
    }, duration * 1000);
  }

  function handlePhase1Timeout(session) {
    // Force offers for those who haven't proposed
    // Random offer between 0 and 20? Or 10 (fair)? Or 0?
    // Let's say random valid offer.
    session.pairs.forEach(pair => {
        if (!session.currentOffers.has(pair.id)) {
            const randomOffer = Math.floor(Math.random() * (session.config.maxOffer + 1));
            const p1 = session.players.get(pair.player1);
            // If AI, they propose.
            if (p1 && p1.isAI) {
                // AI Logic: Propose something "fair" or random? Let's say random for now or 40-50%.
                // Random integer 0-10 (since max is 20).
                 session.currentOffers.set(pair.id, {
                     proposerId: pair.player1,
                     amount: Math.floor(Math.random() * 11) // 0-10
                 });
            } else {
                 // Force student
                 session.currentOffers.set(pair.id, {
                     proposerId: pair.player1,
                     amount: randomOffer,
                     forced: true
                 });
            }
        }
    });

    // Move to Phase 2
    session.status = STATUS.RESPONDING;
    session.phaseDuration = session.config.respondTime;
    session.phaseStartTime = Date.now();
    
    // Notify all players of the new phase and the offers
    session.pairs.forEach(pair => {
        const offer = session.currentOffers.get(pair.id);
        io.to(pair.player2).emit('ultimatum:receiveOffer', { amount: offer.amount });
    });

    broadcastSession(session);
    startTimer(session, session.config.respondTime, handlePhase2Timeout);
  }

  function handlePhase2Timeout(session) {
      // Force decisions
      // Default: Accept? Reject? 
      // Let's say Accept if offer >= 50%? Or just random? 
      // Usually default is reject or random. Let's do random for simplicity or Reject.
      // User didn't specify. Let's assume Reject if no response (conservative).
      
      session.pairs.forEach(pair => {
          if (!session.currentDecisions.has(pair.id)) {
              const p2 = session.players.get(pair.player2);
              const offer = session.currentOffers.get(pair.id);
              
              let accepted = false;
              if (p2 && p2.isAI) {
                  // AI Logic: Accept if >= 5? 
                  if (offer.amount >= 5) accepted = true;
                  else accepted = Math.random() > 0.5;
              } else {
                  // Force random decision for student
                  accepted = Math.random() > 0.5;
              }

              session.currentDecisions.set(pair.id, {
                  responderId: pair.player2,
                  accepted,
                  forced: true
              });
          }
      });

      finalizeRound(session);
  }

  function finalizeRound(session) {
      const results = [];
      
      session.pairs.forEach(pair => {
          const offer = session.currentOffers.get(pair.id);
          const decision = session.currentDecisions.get(pair.id);
          
          if (!offer || !decision) return;

          const p1 = session.players.get(pair.player1);
          const p2 = session.players.get(pair.player2);

          const total = session.config.totalAmount;
          let p1Payoff = 0;
          let p2Payoff = 0;

          if (decision.accepted) {
              p1Payoff = total - offer.amount;
              p2Payoff = offer.amount;
          } else {
              p1Payoff = 0;
              p2Payoff = 0;
          }

          const result = {
              round: session.currentRound,
              pairId: pair.id,
              proposer: { name: p1?.name, id: pair.player1, payoff: p1Payoff, offer: offer.amount },
              responder: { name: p2?.name, id: pair.player2, payoff: p2Payoff, accepted: decision.accepted }
          };
          
          results.push(result);

          if (p1) p1.history.push({ role: 'proposer', ...result });
          if (p2) p2.history.push({ role: 'responder', ...result });

          // Notify players
          io.to(pair.player1).emit('ultimatum:roundResult', result);
          io.to(pair.player2).emit('ultimatum:roundResult', result);
      });

      session.roundResults.push({ round: session.currentRound, results });
      
      // Wait for reveal time then next round or end
      setTimeout(() => {
          startNextRound(session);
      }, session.config.resultRevealTime * 1000);
  }

  function handleStartSession(socket, sessionCode) {
    const session = ensureSession(sessionCode);
    if (!session) return false;
    
    try {
        ensureInstructor(socket, session);
        if (session.status !== STATUS.LOBBY) throw new Error('Session already started');
        
        startNextRound(session);
        return true;
    } catch (err) {
        socket.emit('errorMessage', err.message);
        return true;
    }
  }

  function handleMakeOffer(socket, { sessionCode, amount }) {
      const session = ensureSession(sessionCode);
      if (!session) return;
      
      if (session.status !== STATUS.PROPOSING) {
          socket.emit('errorMessage', 'Not in proposing phase');
          return;
      }

      const player = session.players.get(socket.id);
      if (!player || player.playerType !== 1) { // Must be Proposer
          socket.emit('errorMessage', 'You are not the proposer');
          return;
      }
      
      const amt = parseInt(amount, 10);
      if (isNaN(amt) || amt < 0 || amt > session.config.maxOffer) {
          socket.emit('errorMessage', `Offer must be between 0 and ${session.config.maxOffer}`);
          return;
      }

      session.currentOffers.set(player.pairId, {
          proposerId: socket.id,
          amount: amt
      });

      // Check if all proposers have proposed
      const allProposed = session.pairs.every(p => session.currentOffers.has(p.id));
      if (allProposed) {
           // Move to next phase immediately? Or wait for timer?
           // User said "after 60 seconds... player 2 will see".
           // This implies fixed time. So we wait.
           socket.emit('ultimatum:offerSubmitted', { amount: amt });
      } else {
          socket.emit('ultimatum:offerSubmitted', { amount: amt });
      }
  }

  function handleMakeDecision(socket, { sessionCode, accepted }) {
      const session = ensureSession(sessionCode);
      if (!session) return;

      if (session.status !== STATUS.RESPONDING) {
          socket.emit('errorMessage', 'Not in responding phase');
          return;
      }

      const player = session.players.get(socket.id);
      if (!player || player.playerType !== 2) { // Must be Responder
          socket.emit('errorMessage', 'You are not the responder');
          return;
      }

      session.currentDecisions.set(player.pairId, {
          responderId: socket.id,
          accepted: !!accepted
      });

      socket.emit('ultimatum:decisionSubmitted', { accepted: !!accepted });
      
      // Check if all responded
      const allResponded = session.pairs.every(p => session.currentDecisions.has(p.id));
      if (allResponded) {
          // All decisions are in, but don't finalize yet
          // Let the timer run out so students see the countdown complete
          // The timer will call finalizeRound when it expires
          console.log(`All decisions submitted for session ${session.code}, waiting for timer to complete`);
      }
  }
  
  function finalizeSession(session) {
      session.status = STATUS.COMPLETE;
      broadcastSession(session);
  }

  function handleEndSession(socket, sessionCode) {
      const session = ensureSession(sessionCode);
      if (!session) return false;
      finalizeSession(session);
      return true;
  }

  return {
    createSession,
    handleJoin,
    handleOpenLobby,
    handleStartSession,
    handleMakeOffer,
    handleMakeDecision,
    handleEndSession,
    getSession: (code) => sessions.get(code)
  };
}

