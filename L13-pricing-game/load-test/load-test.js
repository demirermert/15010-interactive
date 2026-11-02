import { io } from 'socket.io-client';

// ============================================
// CONFIGURATION
// ============================================

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:4000';
const NUM_STUDENTS = parseInt(process.env.NUM_STUDENTS) || 50;
const SESSION_CODE = process.env.SESSION_CODE || null; // If null, creates new session

// Clean server URL
const cleanServerUrl = SERVER_URL.replace(/\/$/, '');

console.log('\n' + '='.repeat(60));
console.log('🧪 PRICING GAME LOAD TEST');
console.log('='.repeat(60));
console.log(`📊 Server: ${cleanServerUrl}`);
console.log(`👥 Students: ${NUM_STUDENTS}`);
console.log(`📝 Session: ${SESSION_CODE || 'Will create new'}`);
console.log('='.repeat(60) + '\n');

// ============================================
// STATE TRACKING
// ============================================

const students = [];
const stats = {
  connected: 0,
  joined: 0,
  pricesSubmitted: 0,
  errors: [],
  roundTimes: [],
  startTime: null
};

let sessionCode = SESSION_CODE;
let instructorSocket = null;

// ============================================
// HELPER FUNCTIONS
// ============================================

function logProgress(message, type = 'info') {
  const symbols = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    progress: '⏳'
  };
  console.log(`${symbols[type]} ${message}`);
}

function logStats() {
  console.log('\n' + '-'.repeat(60));
  console.log('📊 Current Statistics:');
  console.log('-'.repeat(60));
  console.log(`   Connected: ${stats.connected}/${NUM_STUDENTS}`);
  console.log(`   Joined: ${stats.joined}/${NUM_STUDENTS}`);
  console.log(`   Prices Submitted: ${stats.pricesSubmitted}`);
  console.log(`   Errors: ${stats.errors.length}`);
  if (stats.roundTimes.length > 0) {
    const avgTime = stats.roundTimes.reduce((a, b) => a + b, 0) / stats.roundTimes.length;
    console.log(`   Avg Round Time: ${avgTime.toFixed(2)}s`);
  }
  console.log('-'.repeat(60) + '\n');
}

// ============================================
// SESSION CREATION
// ============================================

async function createSession() {
  if (sessionCode) {
    logProgress(`Using existing session: ${sessionCode}`, 'info');
    return sessionCode;
  }

  logProgress('Creating new session...', 'progress');
  
  try {
    const response = await fetch(`${cleanServerUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instructorName: 'Load Test Instructor',
        sessionName: `Load Test - ${NUM_STUDENTS} Students`,
        config: {
          rounds: 3,
          roundTime: 15,
          resultRevealTime: 10
        }
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    sessionCode = data.code;
    logProgress(`Session created: ${sessionCode}`, 'success');
    return sessionCode;
  } catch (error) {
    logProgress(`Failed to create session: ${error.message}`, 'error');
    throw error;
  }
}

// ============================================
// STUDENT SIMULATION
// ============================================

// Generate random realistic names
const firstNames = [
  'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason',
  'Isabella', 'William', 'Mia', 'James', 'Charlotte', 'Benjamin', 'Amelia',
  'Lucas', 'Harper', 'Henry', 'Evelyn', 'Alexander', 'Abigail', 'Michael',
  'Emily', 'Daniel', 'Elizabeth', 'Matthew', 'Sofia', 'Jackson', 'Avery',
  'David', 'Ella', 'Joseph', 'Scarlett', 'Samuel', 'Grace', 'Sebastian'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
  'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
  'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
  'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King'
];

function generateRandomName(index) {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  // Add a number to ensure uniqueness in case of duplicate name combinations
  return `${firstName} ${lastName} ${index}`;
}

function createStudent(index, sessionCode) {
  return new Promise((resolve, reject) => {
    const studentName = generateRandomName(index);
    const socket = io(cleanServerUrl, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 10000
    });

    const student = {
      id: index,
      name: studentName,
      socket,
      connected: false,
      joined: false,
      pricesSubmitted: 0,
      errors: [],
      roundStartTimes: {}
    };

    // Connection
    socket.on('connect', () => {
      student.connected = true;
      stats.connected++;
      
      socket.emit('joinSession', {
        sessionCode,
        playerName: studentName,
        role: 'student'
      });
    });

    // Joined session
    socket.on('joinedSession', (payload) => {
      student.joined = true;
      student.studentCode = payload.studentCode;
      stats.joined++;
      resolve(student);
    });

    // Round started
    socket.on('roundStarted', (payload) => {
      student.roundStartTimes[payload.round] = Date.now();
      
      // Submit price after random delay (1-5 seconds)
      const delay = Math.random() * 4000 + 1000;
      setTimeout(() => {
        const randomPrice = Math.random() * 100;
        socket.emit('submitPrice', {
          sessionCode,
          price: randomPrice
        });
        student.pricesSubmitted++;
        stats.pricesSubmitted++;
      }, delay);
    });

    // Round results
    socket.on('roundResults', (payload) => {
      const roundTime = (Date.now() - student.roundStartTimes[payload.round]) / 1000;
      stats.roundTimes.push(roundTime);
    });

    // Errors
    socket.on('errorMessage', (message) => {
      student.errors.push(message);
      stats.errors.push({ student: studentName, message });
      logProgress(`${studentName}: ${message}`, 'error');
    });

    socket.on('connect_error', (error) => {
      const msg = `Connection error: ${error.message}`;
      student.errors.push(msg);
      stats.errors.push({ student: studentName, message: msg });
      reject(error);
    });

    socket.on('disconnect', () => {
      student.connected = false;
    });

    // Timeout
    setTimeout(() => {
      if (!student.joined) {
        reject(new Error(`${studentName} failed to join within 10 seconds`));
      }
    }, 10000);
  });
}

// ============================================
// INSTRUCTOR SIMULATION
// ============================================

function connectInstructor(sessionCode) {
  return new Promise((resolve, reject) => {
    logProgress('Connecting instructor...', 'progress');
    
    const socket = io(cleanServerUrl, {
      transports: ['websocket'],
      timeout: 10000
    });

    socket.on('connect', () => {
      socket.emit('joinSession', {
        sessionCode,
        playerName: 'Load Test Instructor',
        role: 'instructor'
      });
    });

    socket.on('joinedSession', () => {
      logProgress('Instructor connected', 'success');
      resolve(socket);
    });

    socket.on('errorMessage', (message) => {
      logProgress(`Instructor error: ${message}`, 'error');
      reject(new Error(message));
    });

    socket.on('connect_error', (error) => {
      logProgress(`Instructor connection error: ${error.message}`, 'error');
      reject(error);
    });
  });
}

// ============================================
// MAIN TEST EXECUTION
// ============================================

async function runLoadTest() {
  stats.startTime = Date.now();
  
  try {
    // Step 1: Create session
    logProgress('Starting load test...', 'info');
    await createSession();

    // Step 2: Connect students in batches
    logProgress(`Connecting ${NUM_STUDENTS} students in batches...`, 'progress');
    const BATCH_SIZE = 10;
    const batches = Math.ceil(NUM_STUDENTS / BATCH_SIZE);

    for (let batch = 0; batch < batches; batch++) {
      const start = batch * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, NUM_STUDENTS);
      
      logProgress(`Batch ${batch + 1}/${batches}: Connecting students ${start + 1}-${end}...`, 'progress');
      
      const promises = [];
      for (let i = start; i < end; i++) {
        promises.push(createStudent(i + 1, sessionCode));
      }

      try {
        const batchStudents = await Promise.all(promises);
        students.push(...batchStudents);
        logProgress(`Batch ${batch + 1}/${batches} complete`, 'success');
      } catch (error) {
        logProgress(`Batch ${batch + 1}/${batches} had errors: ${error.message}`, 'warning');
      }
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logProgress(`All students processed: ${students.length} connected`, 'success');
    logStats();

    // Step 3: Connect instructor
    instructorSocket = await connectInstructor(sessionCode);

    // Wait for connections to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 4: Start the game
    logProgress('Starting game...', 'progress');
    instructorSocket.emit('startSession', { sessionCode });

    // Step 5: Monitor game progress
    logProgress('Monitoring game (3 rounds, ~60 seconds)...', 'info');
    
    // Print stats every 10 seconds
    const statsInterval = setInterval(logStats, 10000);

    // Wait for game to complete (3 rounds × 15s + 3 × 10s reveals = 75s, add buffer)
    await new Promise(resolve => setTimeout(resolve, 90000));

    clearInterval(statsInterval);

    // Final results
    const totalTime = (Date.now() - stats.startTime) / 1000;
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 FINAL RESULTS');
    console.log('='.repeat(60));
    logStats();
    
    console.log('📊 Performance Metrics:');
    console.log(`   Total Test Time: ${totalTime.toFixed(2)}s`);
    console.log(`   Success Rate: ${((stats.joined / NUM_STUDENTS) * 100).toFixed(1)}%`);
    console.log(`   Total Submissions: ${stats.pricesSubmitted}`);
    console.log(`   Expected Submissions: ${NUM_STUDENTS * 3}`);
    console.log(`   Submission Rate: ${((stats.pricesSubmitted / (NUM_STUDENTS * 3)) * 100).toFixed(1)}%`);
    
    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors Encountered (${stats.errors.length}):`);
      stats.errors.slice(0, 10).forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.student}: ${err.message}`);
      });
      if (stats.errors.length > 10) {
        console.log(`   ... and ${stats.errors.length - 10} more errors`);
      }
    }
    
    console.log('='.repeat(60));
    
    // Assessment
    const successRate = (stats.joined / NUM_STUDENTS) * 100;
    const submissionRate = (stats.pricesSubmitted / (NUM_STUDENTS * 3)) * 100;
    
    console.log('\n🎯 Assessment:');
    if (successRate >= 95 && submissionRate >= 90) {
      console.log('   ✅ EXCELLENT - Server handled the load well!');
    } else if (successRate >= 80 && submissionRate >= 70) {
      console.log('   ⚠️  ACCEPTABLE - Some issues, but mostly functional');
    } else {
      console.log('   ❌ POOR - Server struggled with this load');
      console.log('   💡 Consider: Reducing students per session or upgrading server');
    }
    console.log('');

    // Cleanup
    logProgress('Cleaning up...', 'progress');
    students.forEach(s => {
      if (s.socket) s.socket.disconnect();
    });
    if (instructorSocket) instructorSocket.disconnect();

    logProgress('Load test completed!', 'success');
    process.exit(0);

  } catch (error) {
    logProgress(`Load test failed: ${error.message}`, 'error');
    
    // Cleanup on error
    students.forEach(s => {
      if (s.socket) s.socket.disconnect();
    });
    if (instructorSocket) instructorSocket.disconnect();
    
    process.exit(1);
  }
}

// Run the test
runLoadTest();

