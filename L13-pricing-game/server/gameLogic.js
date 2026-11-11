import { computeDemand } from './demandModel.js';
import * as db from './database.js';
import { getAIPriceDecision, isOpenAIInitialized } from './aiPlayer.js';
import { validateConfig, studentConfig, cleanName } from './config.js';

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

export function createGameManager(io, { instructorKey = '' } = {}) {
  const sessions = new Map();

  function createSession(instructorName, sessionName, configOverrides) {
    if (!instructorName) {
      throw new Error('Instructor name required');
    }

    let code;
    do {
      code = randomCode();
    } while (sessions.has(code) || db.getSessionIdByCode(code)); // not live, and not left in the database by an earlier run

    const config = validateConfig(configOverrides); // throws with a message the form shows (2026-11-02 audit)
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
        reveal: null,
        timerBroadcast: null,
        countdown: null
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
      sessionName: session.sessionName,
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
    const instructorIds = instructorSockets(session);
    // Students get only what their page shows: no list of names, no pairs (2026-11-02 audit: that told a student who their rival was)
    const studentPayload = {
      code: session.code,
      sessionName: session.sessionName,
      status: session.status,
      currentRound: session.currentRound,
      config: studentConfig(session.config),
      playerCount: payload.players.filter(p => p.role === 'student').length
    };
    io.to(session.code).except(instructorIds).emit('sessionUpdate', studentPayload);
    instructorIds.forEach(id => io.to(id).emit('sessionUpdate', payload));
  }

  function instructorSockets(session) {
    return Array.from(session.players.values()).filter(p => p.role === 'instructor' && p.connected).map(p => p.socketId);
  }

  // Which end of the street a student is on: seller A stands at x1, seller B at x2
  // whether this student's rival is the AI seat: the chat game turns the chat off for them (Codex review, 2026-11-11)
  function rivalIsAI(session, socketId) {
    const pair = session.pairs.find(p => p.playerA === socketId || p.playerB === socketId);
    if (!pair) return false;
    return !!session.players.get(pair.playerA === socketId ? pair.playerB : pair.playerA)?.isAI;
  }

  function sideOf(session, socketId) {
    const pair = session.pairs.find(p => p.playerA === socketId || p.playerB === socketId);
    return pair ? (pair.playerA === socketId ? 'A' : 'B') : null;
  }

  // Total profit per student over the rounds played so far, best first; computed here once, so no client can double it
  function leaderboardOf(session) {
    const totals = new Map();
    session.roundResults.forEach(r => r.results.forEach(pr => [pr.playerA, pr.playerB].forEach(e => {
      const cur = totals.get(e.playerId) || { playerId: e.playerId, name: e.name, totalProfit: 0 };
      cur.totalProfit += e.profit;
      totals.set(e.playerId, cur);
    })));
    return [...totals.values()].sort((a, b) => Math.round(b.totalProfit * 100) - Math.round(a.totalProfit * 100));
  }

  function roundIsOpen(session) {
    return session.status === STATUS.RUNNING && !!session.timers.round && !session.roundFinalizing;
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
    if (!session) throw new Error('This game has ended or was stopped (session not found).');
    return session;
  }

  function ensureInstructor(socket, session) {
    const player = session.players.get(socket.id);
    if (!player || player.role !== 'instructor') {
      throw new Error('Only the instructor can do this');
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
          // A price submitted before the reconnect stays submitted (2026-11-02 audit: it used to be replaced by a random one)
          const submission = session.submissions.get(existingPlayer.pairId);
          if (submission && submission[oldSocketId] && oldSocketId !== socket.id) {
            submission[socket.id] = submission[oldSocketId];
            delete submission[oldSocketId];
          }
        }
        
        socket.join(session.code);
        socket.data.sessionCode = session.code;
        socket.data.role = existingPlayer.role;
        socket.data.studentCode = studentCode;
        // the same seat opened on a second tab or device (2026-11-11 classroom test): the older screen is told, so it
        // stops showing a frozen round and offers to take the seat back, instead of looking alive and doing nothing
        if (oldSocketId && oldSocketId !== socket.id) {
          io.to(oldSocketId).emit('seatMoved');
          io.sockets.sockets.get(oldSocketId)?.leave(session.code);
        }
        console.log(`${nameToUse} rejoined session ${session.code} with code ${studentCode}`);
        return existingPlayer.studentCode; // Return existing code
      }
    }
    
    // The instructor coming back after a drop takes over the dropped entry; a second device that is live at the same
    // time (laptop and iPad) gets its own entry, so both can run the game (2026-11-02 audit)
    if (role === 'instructor') {
      const existing = Array.from(session.players.values()).find(p => p.role === 'instructor' && !p.connected);
      if (existing && existing.socketId !== socket.id) {
        session.players.delete(existing.socketId);
        existing.socketId = socket.id;
        existing.connected = true;
        existing.lastHeartbeat = Date.now();
        session.players.set(socket.id, existing);
        session.instructorSocket = socket.id;
        socket.join(session.code);
        socket.data.sessionCode = session.code;
        socket.data.role = 'instructor';
        return null;
      }
    }

    // The student page sends its join twice on the same socket. The second one used to register a second student with a
    // second personal code over the first (same socket), so the phone kept two codes, one dead, and a student who closed
    // the tab and typed the code again on the join page was sent to the dead one about half the time: "You were not part
    // of this game" (75-student final test, 2026-11-11). The repeated join now gets the seat it already has.
    if (role === 'student') {
      const same = session.players.get(socket.id);
      if (same && same.role === 'student' && same.studentCode) {
        socket.join(session.code);
        socket.data.sessionCode = session.code;
        socket.data.role = 'student';
        socket.data.studentCode = same.studentCode;
        return same.studentCode;
      }
    }

    // For new players, name is required
    playerName = cleanName(playerName);
    if (!playerName) {
      throw new Error('Name is required');
    }
    // two students typing the same name get "Sam Lee" and "Sam Lee (2)", so the leaderboard, the market search and the
    // CSV can tell them apart (2026-11-11 classroom test: two identical rows on the dashboard). Only other phones that
    // are online count: the page's own repeated join comes on the same socket, and a dropped seat with this name must
    // keep it, since pairing leaves out an offline seat whose name a connected seat also holds
    if (role === 'student') {
      const taken = new Set(Array.from(session.players.values()).filter(p => p.role === 'student' && p.connected && p.socketId !== socket.id).map(p => p.name.toLowerCase()));
      if (taken.has(playerName.toLowerCase())) {
        let k = 2;
        while (taken.has(`${playerName} (${k})`.toLowerCase())) k++;
        playerName = `${playerName} (${k})`;
      }
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

    // Save player to database (students only: the instructor is not a player in the results)
    if (session.dbId && player.role === 'student') {
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

  function handleJoin(socket, payload) {
    try {
      const { sessionCode, role, studentCode, key } = payload || {};
      const playerName = cleanName(payload?.playerName);
      const code = String(sessionCode || '').trim().toUpperCase();
      const session = ensureSession(code);
      if (role === 'instructor' && instructorKey && key !== instructorKey) {
        throw new Error('This page is for the instructor. Students join at the main address.');
      }
      
      // Check if trying to join as a new student when session is not in lobby
      if (role === 'student' && !studentCode) {
        if (session.status === STATUS.SETUP) {
          throw new Error('This session is not open yet. Please wait for the instructor to open the lobby.');
        } else if (session.status !== STATUS.LOBBY) {
          throw new Error('The game has already started, so new players cannot join. If you were in it, go back to the page your phone had before (your personal link).');
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
        config: socket.data.role === 'instructor' ? session.config : studentConfig(session.config),
        currentRound: session.currentRound,
        studentCode: finalStudentCode || null,
        playerId: finalStudentCode || null,
        playerLink: finalStudentCode ? `/session/${code}/${finalStudentCode}` : null,
        playerName: actualPlayerName,
        side: sideOf(session, socket.id),
        rivalIsAI: rivalIsAI(session, socket.id),
        leaderboard: leaderboardOf(session),
        // a student who was offline when the game started has no pair and sits this game out
        spectator: socket.data.role === 'student' && session.status !== STATUS.LOBBY && session.status !== STATUS.SETUP && !actualPlayer?.pairId
      };
      
      // If rejoining mid-round, mid-game or after the end, send current state and history (2026-11-08: after the
      // end too, otherwise a reloaded game-over card showed a total of $0 and no rounds)
      if ((session.status === STATUS.RUNNING || session.status === STATUS.COMPLETE) && session.currentRound > 0) {
        const player = session.players.get(socket.id);

        // If instructor is rejoining mid-game, send all round summaries for the dashboard (after the end the
        // dashboard loads them from the database)
        if (role === 'instructor' && session.status === STATUS.RUNNING && session.roundResults && session.roundResults.length > 0) {
          const leaderboard = leaderboardOf(session);
          session.roundResults.forEach(roundResult => {
            socket.emit('roundSummary', {
              round: roundResult.round,
              results: roundResult.results,
              leaderboard
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

        // The rival's name again, when the game shows it (2026-11-08: a reloaded page said "Rival" until the next round)
        if (session.config.showOpponentName && player?.pairId && session.status === STATUS.RUNNING) {
          const pair = session.pairs.find(p => p.id === player.pairId);
          const rival = pair && session.players.get(pair.playerA === socket.id ? pair.playerB : pair.playerA);
          if (rival) socket.emit('opponentInfo', { opponentName: rival.name });
        }

        // If a round is currently active (timer is running), send round state
        if (roundIsOpen(session) && (role === 'instructor' || player?.pairId)) {
          const hasSubmitted = player && player.pairId && 
            session.submissions.get(player.pairId)?.[socket.id];
          
          // Calculate remaining time
          const elapsed = session.roundStartTime ? (Date.now() - session.roundStartTime) / 1000 : 0;
          const rt = session.config.roundTime;
          const fullTime = Array.isArray(rt) ? rt[session.currentRound - 1] || rt[0] : rt;
          const remainingTime = Math.max(0, fullTime - elapsed);
          
          // Round is active - tell them about it with actual remaining time
          socket.emit('roundStarted', {
            round: session.currentRound,
            roundTime: Math.ceil(remainingTime), // Send remaining time, not full time
            fullTime,
            hasSubmitted: !!hasSubmitted,
            submittedPrice: hasSubmitted ? hasSubmitted.price : null,
            side: sideOf(session, socket.id),
            rivalIsAI: rivalIsAI(session, socket.id)
          });
        }
      }
      
      socket.emit('joinedSession', joinResponse);
      // the pair's chat so far comes back after a refresh or a reconnect (Codex review, 2026-11-11)
      if (socket.data.role === 'student' && session.config.enableChat && session.chatLog) {
        const me = session.players.get(socket.id);
        const log = me?.pairId ? session.chatLog.get(me.pairId) : null;
        if (log?.length) socket.emit('chatHistory', { messages: log });
      }
      broadcastSession(session);
      if (session.status === STATUS.RUNNING) emitSubmissionProgress(session);
      console.log(`${actualPlayerName} joined session ${code}${finalStudentCode ? ` (${finalStudentCode})` : ''}`);
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
      // Everyone who joined the lobby is paired, connected or not (2026-11-08, Mert: no student may lose the game
      // to a connection blip). A locked phone drops its socket within a minute, so when the instructor presses
      // Start after explaining the rules many phones are "offline"; they wake up, rejoin and get the running round.
      // (The 2026-11-02 audit paired only connected phones so that a student who left would not leave a partner
      // against random prices; in a classroom that is the rarer case, and the forced price covers it.) The one
      // ghost we can recognise is dropped: an offline seat whose name is also held by a connected seat, which is a
      // student who joined twice (a browser that forgot its seat and came back through the join page).
      const all = Array.from(session.players.values()).filter(p => p.role === 'student');
      // names compared exactly (2026-11-11 evening, Codex review): "Alex" and "Alex (2)" are two students, and the one
      // whose phone is locked at Start must not lose the game. (From that afternoon the suffix was stripped so that a
      // seat abandoned for another device would retire; that also benched a real second Alex. A ghost seat is now paired
      // like any dark phone and its rival gets the forced prices.)
      const base = n => n.trim().toLowerCase();
      const liveNames = new Set(all.filter(p => p.connected).map(p => base(p.name)));
      const students = all.filter(p => p.connected || !liveNames.has(base(p.name)));
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
      const aiPlayerName = isOpenAIInitialized() ? 'ChatGPT' : 'AI Player'; // no robot emoji (Mert, 2026-11-10)
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
    if (session.status !== STATUS.RUNNING) return; // the game was ended meanwhile
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
    
    // Send round started to every seat (with which end of the street it is) and to the instructor
    session.pairs.forEach(pair => {
      io.to(pair.playerA).emit('roundStarted', { round: session.currentRound, roundTime, fullTime: roundTime, side: 'A', rivalIsAI: rivalIsAI(session, pair.playerA) });
      io.to(pair.playerB).emit('roundStarted', { round: session.currentRound, roundTime, fullTime: roundTime, side: 'B', rivalIsAI: rivalIsAI(session, pair.playerB) });
    });
    instructorSockets(session).forEach(id => io.to(id).emit('roundStarted', { round: session.currentRound, roundTime, fullTime: roundTime }));

    // The ChatGPT seat decides at the start of the round (its choice depends only on past rounds), so the end of the
    // round never waits for OpenAI (2026-11-02: it used to add 1-3 s to every round for the whole class)
    session.aiPending = new Map();
    const roundNow = session.currentRound;
    session.pairs.forEach(pair => {
      [[pair.playerA, pair.playerB], [pair.playerB, pair.playerA]].forEach(([me, rival]) => {
        const p = session.players.get(me);
        if (!p || !p.isAI) return;
        const q = session.players.get(rival);
        const promise = getAIPriceDecision(session.config, p.history || [], q?.history || [])
          .then(price => {
            if (session.currentRound === roundNow && roundIsOpen(session)) {
              recordSubmission(session, me, price, false);
              emitSubmissionProgress(session);
            }
          })
          .catch(err => console.error(`[Session ${session.code}] AI decision failed:`, err.message));
        session.aiPending.set(me, promise);
      });
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
    emitSubmissionProgress(session);
    
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
      session.timers.round = null; // the round is over: a rejoin or a late price must not see it as open (2026-11-02 audit)
      if (session.timers.timerBroadcast) {
        clearInterval(session.timers.timerBroadcast);
        session.timers.timerBroadcast = null;
      }
      forceSubmitMissing(session);
    }, roundTime * 1000);
  }

  async function forceSubmitMissing(session) {
    try {
      await forceSubmitMissingInner(session);
    } catch (err) {
      // never let a round's end take the process down (2026-11-02 audit)
      console.error(`[Session ${session.code}] Error finishing round ${session.currentRound}:`, err);
      try { finalizeRound(session); } catch (err2) { console.error('finalizeRound failed too:', err2); }
    }
  }

  async function forceSubmitMissingInner(session) {
    console.log(`[Session ${session.code}] Round ${session.currentRound} timer expired - finalizing round`);
    const seenPairs = new Set();
    
    // A random price inside the game's price bounds for anyone who did not submit: whole dollars on a wide range,
    // cents on a narrow one such as gas prices from $0 to $10 (2026-11-10); clamped at both ends (with a min price
    // of, say, $0.50 the floor used to land below it, 2026-11-08 fuzz test)
    // Since 2026-11-10 (Mert): uniform between the wholesale cost and the game's "random price up to" setting ($6 in
    // the gas games), never outside the price bounds; without that setting, the whole price range as before.
    const getRandomPrice = () => {
      const { min, max } = session.config.priceBounds;
      const lo = Math.max(min, Number(session.config.marginalCost) || 0);
      const cap = Number(session.config.randomPriceMax);
      const hi = Math.min(max, Number.isFinite(cap) && cap > lo ? cap : max);
      const r = hi - lo > 50 ? Math.floor(lo + Math.random() * (hi - lo + 1)) : Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
      return Math.max(lo, Math.min(hi, r));
    };
      
    // An AI decision still in flight gets a short grace period, then a random price like anyone else
    if (session.aiPending && session.aiPending.size) {
      await Promise.race([Promise.allSettled([...session.aiPending.values()]), new Promise(r => setTimeout(r, 1500))]);
    }

    // Process all pairs sequentially to get AI decisions
    for (const pair of session.pairs) {
      seenPairs.add(pair.id);
      const existing = session.submissions.get(pair.id) || {};
      const submissionA = existing[pair.playerA];
      const submissionB = existing[pair.playerB];
      
      if (!submissionA) {
        const playerA = session.players.get(pair.playerA);
        if (playerA && playerA.isAI) {
          const randomPrice = getRandomPrice();
          console.log(`[Session ${session.code}] AI seat had no answer in time; random price ${randomPrice}`);
          recordSubmission(session, pair.playerA, randomPrice, true);
        } else {
          const randomPrice = getRandomPrice();
          console.log(`[Session ${session.code}] Forcing random price ${randomPrice.toFixed(2)} for player ${pair.playerA}`);
          recordSubmission(session, pair.playerA, randomPrice, true);
        }
      }
      
      if (!submissionB) {
        const playerB = session.players.get(pair.playerB);
        if (playerB && playerB.isAI) {
          const randomPrice = getRandomPrice();
          console.log(`[Session ${session.code}] AI seat had no answer in time; random price ${randomPrice}`);
          recordSubmission(session, pair.playerB, randomPrice, true);
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

  function handlePriceSubmission(socket, payload) {
    try {
      const { sessionCode, price } = payload || {};
      const session = ensureSession(sessionCode);
      if (session.status !== STATUS.RUNNING) {
        throw new Error('The game is not running.');
      }
      if (!roundIsOpen(session)) {
        throw new Error('This round is over. Your price goes in when the next round starts.');
      }
      // a price sent in an earlier round and delivered late (a phone reconnecting) is not this round's price
      // (Codex review, 2026-11-11); pages loaded before this change send no round and are taken as before
      const sentFor = Number(payload?.round);
      if (Number.isFinite(sentFor) && sentFor > 0 && sentFor !== session.currentRound) {
        throw new Error(`That price was for round ${sentFor}, which is over. Enter your price for round ${session.currentRound}.`);
      }
      const player = session.players.get(socket.id);
      if (!player || player.role !== 'student') {
        throw new Error('Only students in the game can submit a price. Reload the page.');
      }
      if (!player.pairId) {
        throw new Error('You were not paired when the game started, so you are sitting this one out.');
      }
      // Only a number, or a string holding one, is a price (2026-11-08 fuzz test: through Number() an empty string,
      // null or [] used to count as $0 and true as $1). It is kept to the cent, so the phone's "Submitted at", the
      // results, the dashboard and the CSV all show the same number; -0 becomes 0.
      const raw = typeof price === 'string' ? price.trim() : price;
      const numericPrice = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw !== '' ? Number(raw) : NaN);
      const { min, max } = session.config.priceBounds;
      if (!Number.isFinite(numericPrice)) {
        throw new Error('Price must be numeric');
      }
      const cents = Math.round(numericPrice * 100 + 1e-9) / 100;
      if (cents < min || cents > max) {
        throw new Error(`Price must be between ${min} and ${max}`);
      }
      recordSubmission(session, socket.id, cents, false);
      socket.emit('priceAccepted', { round: session.currentRound, price: cents });
      emitSubmissionProgress(session);
      concludeRoundIfReady(session);
    } catch (err) {
      socket.emit('errorMessage', err.message);
    }
  }

  // How many prices are in this round, for the instructor's screen (2026-11-02)
  function emitSubmissionProgress(session) {
    let submitted = 0;
    let total = 0;
    session.pairs.forEach(pair => {
      const submission = session.submissions.get(pair.id) || {};
      [pair.playerA, pair.playerB].forEach(id => {
        total += 1;
        if (submission[id]) submitted += 1;
      });
    });
    io.to(session.code).emit('submissionProgress', { round: session.currentRound, submitted, total });
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
    if (session.status !== STATUS.RUNNING) return; // ended while the round was being finished
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
      let { demandA, demandB, shareA, shareB } = computeDemand({
        priceA,
        priceB,
        config: session.config
      });
      // Last line of defence (2026-11-02 audit): a NaN here used to reach the phones as null and crash the page.
      if (![demandA, demandB, shareA, shareB].every(Number.isFinite)) {
        console.error(`[Session ${session.code}] non-finite demand for prices ${priceA}/${priceB}`, session.config);
        demandA = Number.isFinite(demandA) ? demandA : 0; demandB = Number.isFinite(demandB) ? demandB : 0;
        shareA = Number.isFinite(shareA) ? shareA : 0; shareB = Number.isFinite(shareB) ? shareB : 0;
      }
      // profit = (price - wholesale cost) x gallons sold (2026-11-10; the cost was zero before)
      const unitCost = Number(session.config.marginalCost) || 0;
      const profitA = (priceA - unitCost) * demandA;
      const profitB = (priceB - unitCost) * demandB;
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
          playerId: playerA.studentCode || pair.playerA, // stable across reconnects, unlike the socket id
          ...playerResultA
        },
        playerB: {
          socketId: pair.playerB,
          playerId: playerB.studentCode || pair.playerB,
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
            share: shareA,
            forced: !!submission[pair.playerA].forced,
            opponentForced: !!submission[pair.playerB].forced
          });
          db.saveRoundResult(roundDbId, playerB.dbId, playerA.dbId, {
            price: priceB,
            opponentPrice: priceA,
            demand: demandB,
            profit: profitB,
            share: shareB,
            forced: !!submission[pair.playerB].forced,
            opponentForced: !!submission[pair.playerA].forced
          });
        } catch (err) {
          console.error('Failed to save round results to database:', err);
        }
      }
      
      io.to(pair.playerA).emit('roundResults', formatPlayerPayload(playerA, playerResultA));
      io.to(pair.playerB).emit('roundResults', formatPlayerPayload(playerB, playerResultB));
    });
    session.roundResults.push({ round: roundNumber, results: resultsForRound });
    const leaderboard = leaderboardOf(session);
    const instructorIds = instructorSockets(session);
    instructorIds.forEach(id => io.to(id).emit('roundSummary', { round: roundNumber, results: resultsForRound, leaderboard }));
    io.to(session.code).except(instructorIds).emit('roundSummary', { round: roundNumber, leaderboard });
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
    
    session.timers.countdown = setInterval(() => {
      countdown -= 1;
      if (countdown > 0) {
        io.to(session.code).emit('nextRoundCountdown', { countdown });
      } else {
        clearInterval(session.timers.countdown);
        session.timers.countdown = null;
      }
    }, 1000);
    
    session.timers.reveal = setTimeout(() => {
      if (session.timers.countdown) clearInterval(session.timers.countdown);
      session.timers.countdown = null;
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
    
    const leaderboard = leaderboardOf(session);
    const instructorIds = instructorSockets(session);
    instructorIds.forEach(id => io.to(id).emit('sessionComplete', { rounds: session.roundResults, leaderboard }));
    io.to(session.code).except(instructorIds).emit('sessionComplete', { leaderboard });
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
    if (session.timers.countdown) {
      clearInterval(session.timers.countdown);
    }
    session.timers.round = null;
    session.timers.reveal = null;
    session.timers.timerBroadcast = null;
    session.timers.countdown = null;
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

  function handleChatMessage(socket, payload) {
    try {
      const { sessionCode } = payload || {};
      const message = typeof payload?.message === 'string' ? payload.message.slice(0, 500) : '';
      if (!message.trim()) throw new Error('Empty message');
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
      if (opponent?.isAI) {
        throw new Error('Your rival this game is a computer, so there is no chat.');
      }
      
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
      
      // saved for the CSV, under the round it was about: the round being played, or in a break the next one
      if (session.dbId) {
        const played = (player.history || []).length;
        const round = Math.min(session.config.rounds || 1, Math.max(1, played >= session.currentRound ? session.currentRound + 1 : session.currentRound));
        try { db.saveChatMessage(session.dbId, { round, fromName: player.name, toName: opponent.name, message: message.trim() }); }
        catch (e) { console.error('Failed to save a chat message:', e); }
      }

      // Send to opponent
      if (!session.chatLog) session.chatLog = new Map();
      if (!session.chatLog.has(pair.id)) session.chatLog.set(pair.id, []);
      session.chatLog.get(pair.id).push(chatPayload);
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

