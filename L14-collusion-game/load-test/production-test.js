import { io } from 'socket.io-client';

// ============================================
// PRODUCTION TEST SCRIPT
// Specifically designed for testing deployed Render app
// ============================================

console.log('\n' + '='.repeat(70));
console.log('🚀 PRODUCTION DEPLOYMENT TEST');
console.log('='.repeat(70) + '\n');

// ============================================
// CONFIGURATION
// ============================================

const TESTS_TO_RUN = [
  { name: 'Smoke Test', students: 5, description: 'Quick test - is it working?' },
  { name: 'Small Class', students: 20, description: 'Typical small section' },
  { name: 'Medium Class', students: 50, description: 'Medium-sized class' },
  { name: 'Large Class', students: 100, description: 'Large lecture' }
];

let currentTestIndex = 0;

// ============================================
// USER PROMPTS
// ============================================

function prompt(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.once('data', (data) => {
      resolve(data.toString().trim());
    });
  });
}

async function askForServerUrl() {
  console.log('📝 Enter your production server URL:');
  console.log('   Example: https://pricing-game-abc123.onrender.com');
  console.log('');
  
  const url = await prompt('Server URL: ');
  
  if (!url || !url.startsWith('http')) {
    console.log('❌ Invalid URL. Please include http:// or https://');
    process.exit(1);
  }
  
  return url.trim().replace(/\/$/, '');
}

async function confirmTest(testConfig) {
  console.log('\n' + '-'.repeat(70));
  console.log(`📊 ${testConfig.name}`);
  console.log(`   ${testConfig.description}`);
  console.log(`   Students: ${testConfig.students}`);
  console.log(`   Duration: ~90 seconds`);
  console.log('-'.repeat(70) + '\n');
  
  const answer = await prompt('Run this test? (y/n): ');
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

// ============================================
// HEALTH CHECK
// ============================================

async function checkServerHealth(serverUrl) {
  console.log('🔍 Checking server health...');
  
  try {
    const response = await fetch(`${serverUrl}/health`, {
      signal: AbortSignal.timeout(10000)
    });
    
    if (response.ok) {
      console.log('✅ Server is online and responding\n');
      return true;
    } else {
      console.log(`❌ Server responded with status: ${response.status}`);
      return false;
    }
  } catch (error) {
    console.log(`❌ Server health check failed: ${error.message}`);
    console.log('   Make sure your server is deployed and the URL is correct\n');
    return false;
  }
}

// ============================================
// RUN SINGLE TEST
// ============================================

async function runSingleTest(serverUrl, numStudents) {
  return new Promise((resolve) => {
    import('child_process').then(({ spawn }) => {
      const env = {
        ...process.env,
        SERVER_URL: serverUrl,
        NUM_STUDENTS: numStudents.toString()
      };
      
      const child = spawn('node', ['load-test.js'], {
        cwd: process.cwd(),
        env,
        stdio: 'inherit'
      });
      
      child.on('close', (code) => {
        resolve(code === 0);
      });
    });
  });
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  // Get server URL
  const serverUrl = await askForServerUrl();
  
  // Health check
  const isHealthy = await checkServerHealth(serverUrl);
  if (!isHealthy) {
    console.log('⚠️  Server appears to be down or unreachable.');
    const continueAnyway = await prompt('Continue anyway? (y/n): ');
    if (continueAnyway.toLowerCase() !== 'y') {
      console.log('Exiting...');
      process.exit(0);
    }
  }
  
  // Run tests
  console.log('='.repeat(70));
  console.log('🧪 Available Tests:');
  console.log('='.repeat(70));
  TESTS_TO_RUN.forEach((test, idx) => {
    console.log(`${idx + 1}. ${test.name} (${test.students} students) - ${test.description}`);
  });
  console.log('='.repeat(70) + '\n');
  
  const testChoice = await prompt('Which test to run? (1-4 or "all"): ');
  
  let testsToExecute = [];
  if (testChoice.toLowerCase() === 'all') {
    testsToExecute = TESTS_TO_RUN;
  } else {
    const index = parseInt(testChoice) - 1;
    if (index >= 0 && index < TESTS_TO_RUN.length) {
      testsToExecute = [TESTS_TO_RUN[index]];
    } else {
      console.log('❌ Invalid choice');
      process.exit(1);
    }
  }
  
  // Execute selected tests
  const results = [];
  
  for (const test of testsToExecute) {
    const shouldRun = await confirmTest(test);
    
    if (!shouldRun) {
      console.log('⏭️  Skipping test...\n');
      results.push({ test: test.name, skipped: true });
      continue;
    }
    
    console.log(`\n🏁 Starting ${test.name}...\n`);
    const success = await runSingleTest(serverUrl, test.students);
    
    results.push({
      test: test.name,
      students: test.students,
      success,
      skipped: false
    });
    
    if (testsToExecute.length > 1 && test !== testsToExecute[testsToExecute.length - 1]) {
      console.log('\n⏸️  Pausing 10 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('📋 TEST SUMMARY');
  console.log('='.repeat(70));
  
  results.forEach((result) => {
    if (result.skipped) {
      console.log(`   ⏭️  ${result.test}: SKIPPED`);
    } else {
      const icon = result.success ? '✅' : '❌';
      const status = result.success ? 'PASSED' : 'FAILED';
      console.log(`   ${icon} ${result.test} (${result.students} students): ${status}`);
    }
  });
  
  console.log('='.repeat(70));
  
  const passed = results.filter(r => !r.skipped && r.success).length;
  const failed = results.filter(r => !r.skipped && !r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  
  if (failed === 0 && passed > 0) {
    console.log('\n🎉 All tests passed! Your production server is ready!\n');
  } else if (failed > 0) {
    console.log('\n⚠️  Some tests failed. Consider:');
    console.log('   • Upgrading your Render plan');
    console.log('   • Reducing students per session');
    console.log('   • Optimizing your code\n');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Set up stdin for prompts
process.stdin.setRawMode(false);
process.stdin.resume();
process.stdin.setEncoding('utf8');

main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});

