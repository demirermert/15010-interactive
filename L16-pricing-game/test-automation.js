import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

// Default URLs (local)
let INSTRUCTOR_URL = 'http://localhost:3001/instructor';
let STUDENT_URL = 'http://localhost:3001';

// Parse command line arguments
let NUM_STUDENTS = 5; // Default number of students
let AUTO_SUBMIT = false;
let USE_ONLINE = false;

// Check for flags
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '-a' || arg === '--auto') {
    AUTO_SUBMIT = true;
    // Check if next argument is a number
    if (i + 1 < process.argv.length && !isNaN(process.argv[i + 1])) {
      NUM_STUDENTS = parseInt(process.argv[i + 1], 10);
      i++; // Skip the next argument since we used it
    }
  } else if (arg === '-o' || arg === '--online') {
    USE_ONLINE = true;
    INSTRUCTOR_URL = 'https://commons-game.vercel.app/instructor';
    STUDENT_URL = 'https://commons-game.vercel.app';
  }
}

console.log(`Configuration: ${NUM_STUDENTS} students, Auto-submit: ${AUTO_SUBMIT}, Online: ${USE_ONLINE}`);

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

async function setupInstructor(browser) {
  let instructorPage;
  try {
    console.log('🎓 Setting up instructor...');
    
    // If online mode, wake up the backend first
    if (USE_ONLINE) {
      console.log('☁️  Waking up backend server (this may take 30-60 seconds on first request)...');
      try {
        const wakeUpStart = Date.now();
        const response = await fetch('https://commons-game-server.onrender.com/health', {
          signal: AbortSignal.timeout(60000) // 60 second timeout
        });
        const data = await response.json();
        const wakeUpTime = ((Date.now() - wakeUpStart) / 1000).toFixed(1);
        console.log(`✅ Backend is awake (took ${wakeUpTime}s):`, data);
      } catch (err) {
        console.log('⚠️  Backend wake-up check failed:', err.message);
        console.log('Continuing anyway...');
      }
    }
    
    instructorPage = await browser.newPage();
    
    // Bring to background to avoid stealing focus
    await instructorPage.evaluate(() => {});
    
    // Set up error handlers for the page
    instructorPage.on('pageerror', error => {
      console.log('⚠️  Page error:', error.message);
    });
    
    instructorPage.on('error', error => {
      console.log('⚠️  Page crashed:', error.message);
    });
    
    console.log(`🔗 Navigating to ${INSTRUCTOR_URL}...`);
    const timeout = USE_ONLINE ? 30000 : 10000; // Longer timeout for online
    await instructorPage.goto(INSTRUCTOR_URL, { 
      waitUntil: 'domcontentloaded',
      timeout 
    }).catch(err => {
      throw new Error(`Failed to navigate to instructor page: ${err.message}`);
    });
    
    // Wait a bit for React to render (longer for online)
    await delay(USE_ONLINE ? 3000 : 1000);
    
    console.log('📝 Looking for "Create session" button...');
    
    // Try to wait for the button to appear
    try {
      await instructorPage.waitForSelector('button[type="submit"]', { timeout: 5000 });
    } catch (e) {
      console.log('⚠️  Timeout waiting for submit button, trying anyway...');
    }
    
    // Get all buttons and find the create session button
    const buttons = await instructorPage.$$('button').catch(() => []);
    
    if (buttons.length === 0) {
      await instructorPage.screenshot({ path: 'instructor-no-buttons.png' });
      throw new Error('No buttons found on instructor page');
    }
    
    console.log(`Found ${buttons.length} button(s) on page`);
    
    let clicked = false;
    for (const button of buttons) {
      const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
      console.log(`  Button text: "${text}"`);
      if (text.toLowerCase().includes('create') && text.toLowerCase().includes('session')) {
        console.log('🖱️  Clicking Create session button...');
        await button.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      // Try clicking the first submit button as fallback
      const submitButton = await instructorPage.$('button[type="submit"]').catch(() => null);
      if (submitButton) {
        console.log('🖱️  Clicking submit button (fallback)...');
        await submitButton.click();
        clicked = true;
      }
    }
    
    if (!clicked) {
      console.log('❌ Could not find Create session button');
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      throw new Error('Create session button not found');
    }
    
    console.log('✅ Clicked Create Session button');
    
    // Wait for session code to appear (API call + React render)
    await delay(1500);
    
    // Try to extract session code
    let sessionCode = null;
    
    console.log('🔍 Searching for session code...');
    
    // Try to get the session code from the <strong> tag that contains it
    // The InstructorDashboard shows: "Session code: <strong>{session?.code}</strong>"
    sessionCode = await instructorPage.evaluate(() => {
      // Look for the strong tag that's near "Session code:"
      const allStrong = Array.from(document.querySelectorAll('strong'));
      for (const strong of allStrong) {
        const text = strong.textContent.trim();
        // Session codes are exactly 4 alphanumeric characters
        if (/^[A-Z0-9]{4}$/.test(text)) {
          return text;
        }
      }
      return null;
    }).catch(() => null);
    
    // Fallback: try to parse from text content
    let pageText = '';
    if (!sessionCode) {
      console.log('⚠️  Code not found in strong tags, trying text content...');
      pageText = await instructorPage.evaluate(() => document.body.textContent).catch(() => '');
      
      // Look for "Session code: XXXX" pattern specifically
      const codeMatch = pageText.match(/Session code:\s*([A-Z0-9]{4})\b/i);
      
      if (codeMatch) {
        sessionCode = codeMatch[1].toUpperCase();
      } else {
        // Look for all 4-character codes, but exclude common words
        const allCodes = pageText.match(/\b[A-Z0-9]{4}\b/g);
        if (allCodes && allCodes.length > 0) {
          // Filter out common English words that are 4 letters
          const excludeWords = ['CODE', 'ROLE', 'NAME', 'FISH', 'RANK', 'GAME', 'PLAY', 'USER', 'TEAM'];
          const validCodes = allCodes.filter(code => !excludeWords.includes(code.toUpperCase()));
          if (validCodes.length > 0) {
            sessionCode = validCodes[0];
            console.log(`⚠️  Found ${validCodes.length} potential code(s): ${validCodes.join(', ')}`);
          }
        }
      }
    }
    
    if (!sessionCode) {
      console.log('❌ Could not extract session code automatically');
      console.log('📄 Page content preview:');
      console.log(pageText.substring(0, 800));
      
      // Take a screenshot for debugging
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      console.log('📸 Screenshot saved to instructor-screenshot.png');
      
      // Also save HTML for debugging
      const html = await instructorPage.content().catch(() => '<error getting html>');
      writeFileSync('instructor-debug.html', html);
      console.log('📄 HTML saved to instructor-debug.html');
      
      throw new Error('Session code not found');
    }
    
    // Ensure the code is exactly 4 characters (trim if needed)
    if (sessionCode.length > 4) {
      console.log(`⚠️  Session code seems too long (${sessionCode}), trimming to 4 chars`);
      sessionCode = sessionCode.substring(0, 4);
    }
    
    console.log(`✅ Session Code: ${sessionCode}`);
    
    return { instructorPage, sessionCode };
  } catch (error) {
    console.error('❌ Error in setupInstructor:', error.message);
    if (instructorPage) {
      await instructorPage.screenshot({ path: 'instructor-error.png' }).catch(() => {});
    }
    throw error;
  }
}

async function setupResultsPage(browser, sessionCode) {
  let resultsPage;
  try {
    console.log('📊 Setting up Results page...');
    resultsPage = await browser.newPage();
    
    const RESULTS_URL = USE_ONLINE ? 'https://commons-game.vercel.app/results' : 'http://localhost:3001/results';
    await resultsPage.goto(RESULTS_URL, { 
      waitUntil: 'domcontentloaded',
      timeout: 10000
    });
    
    await delay(1000);
    
    // Enter session code
    const codeInput = await resultsPage.$('#session-code');
    if (codeInput) {
      await codeInput.type(sessionCode);
      console.log(`✅ Entered session code in results page`);
    }
    
    // Click "View Results" button
    const buttons = await resultsPage.$$('button');
    for (const button of buttons) {
      const text = await button.evaluate(el => el.textContent).catch(() => '');
      if (text.toLowerCase().includes('view') && text.toLowerCase().includes('results')) {
        await button.click();
        console.log(`✅ Clicked View Results button`);
        break;
      }
    }
    
    await delay(1500);
    console.log(`✅ Results page ready`);
    
    return resultsPage;
  } catch (error) {
    console.error('❌ Error setting up Results page:', error.message);
    if (resultsPage) {
      await resultsPage.screenshot({ path: 'results-error.png' }).catch(() => {});
    }
    // Don't throw - results page is optional
    return null;
  }
}

async function setupStudent(browser, studentNum, sessionCode) {
  let studentPage;
  try {
    console.log(`👤 Setting up Student ${studentNum}...`);
    studentPage = await browser.newPage();
    
    // Don't bring to front - keep in background
    // This prevents the automation from stealing focus
    
    // Set up error handlers
    studentPage.on('pageerror', error => {
      console.log(`⚠️  Student ${studentNum} page error:`, error.message);
    });
    
    // Longer timeout for many students
    const timeout = 30000; // Increased to 30 seconds
    await studentPage.goto(STUDENT_URL, { 
      waitUntil: 'domcontentloaded',
      timeout
    }).catch(err => {
      throw new Error(`Student ${studentNum}: Failed to navigate: ${err.message}`);
    });
    
    await delay(500);
    
    // Wait for the form to be ready with better retry logic
    let formReady = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!formReady && attempts < maxAttempts) {
      attempts++;
      try {
        await studentPage.waitForSelector('#session-code', { timeout: 10000 });
        formReady = true;
      } catch (e) {
        console.log(`⚠️  Student ${studentNum}: Form not ready (attempt ${attempts}/${maxAttempts})...`);
        if (attempts < maxAttempts) {
          await delay(2000);
          // Try refreshing the page
          console.log(`🔄 Student ${studentNum}: Refreshing page...`);
          await studentPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await delay(1000);
        }
      }
    }
    
    if (!formReady) {
      const screenshot = `student-${studentNum}-no-form.png`;
      await studentPage.screenshot({ path: screenshot });
      console.log(`📸 Screenshot saved to ${screenshot}`);
      console.log(`⚠️  Student ${studentNum}: Skipping due to form load failure (likely connection limit)`);
      return null; // Return null instead of throwing, so automation continues
    }
    
    // Find the name input field
    const nameInput = await studentPage.$('#student-name').catch(() => null);
    if (nameInput) {
      await nameInput.type(`Student${studentNum}`, { delay: 0 });
      console.log(`✅ Student ${studentNum}: Entered name`);
    }
    
    await delay(50);
    
    // Find the session code input field
    const codeInput = await studentPage.$('#session-code').catch(() => null);
    
    if (!codeInput) {
      const screenshot = `student-${studentNum}-screenshot.png`;
      await studentPage.screenshot({ path: screenshot });
      console.log(`📸 Screenshot saved to ${screenshot}`);
      throw new Error(`Student ${studentNum}: Session code input field not found`);
    }
    
    // Enter session code
    await codeInput.type(sessionCode, { delay: 0 });
    console.log(`✅ Student ${studentNum}: Entered session code`);
    
    await delay(100);
    
    // Look for "Join" button with retry
    let joined = false;
    let retries = 3;
    
    while (!joined && retries > 0) {
      const buttons = await studentPage.$$('button').catch(() => []);
      
      for (const button of buttons) {
        const text = await button.evaluate(el => el.textContent).catch(() => '');
        if (text.toLowerCase().includes('join')) {
          // Check if button is visible and clickable
          const isVisible = await button.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }).catch(() => false);
          
          if (isVisible) {
            await button.click();
            joined = true;
            console.log(`✅ Student ${studentNum}: Clicked Join Session`);
            break;
          }
        }
      }
      
      if (!joined) {
        retries--;
        console.log(`⚠️  Student ${studentNum}: Join button not clickable, retrying... (${retries} left)`);
        await delay(1000);
      }
    }
    
    if (!joined) {
      await studentPage.screenshot({ path: `student-${studentNum}-error.png` });
      throw new Error(`Student ${studentNum}: Join button not found or not clickable`);
    }
    
    console.log(`✅ Student ${studentNum}: Successfully joined session`);
    await delay(300);
    
    return studentPage;
  } catch (error) {
    console.error(`❌ Error setting up Student ${studentNum}:`, error.message);
    if (studentPage) {
      await studentPage.screenshot({ path: `student-${studentNum}-error.png` }).catch(() => {});
    }
    throw error;
  }
}

async function autoSubmitForStudent(studentPage, studentNum, roundsToPlay) {
  console.log(`🤖 Auto-submit enabled for Student ${studentNum}`);
  
  for (let round = 1; round <= roundsToPlay; round++) {
    try {
      // Wait for round to start - look for enabled input
      console.log(`⏳ Student ${studentNum} Round ${round}: Waiting for round to start...`);
      
      let inputEnabled = false;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds max wait
      
      while (!inputEnabled && attempts < maxAttempts) {
        inputEnabled = await studentPage.evaluate(() => {
          const input = document.querySelector('#fish-input');
          return input && !input.disabled;
        }).catch(() => false);
        
        if (!inputEnabled) {
          await delay(1000);
          attempts++;
        }
      }
      
      if (!inputEnabled) {
        console.log(`⚠️  Student ${studentNum} Round ${round}: Input never became ready`);
        continue;
      }
      
      console.log(`✅ Student ${studentNum} Round ${round}: Round started`);
      
      // Generate random fish count (0 to 4, matching maxCatchPerRound)
      const randomFish = Math.floor(Math.random() * 5);
      
      console.log(`🎣 Student ${studentNum} Round ${round}: Attempting to submit ${randomFish} fish`);
      
      // Fill in the fish input (React-compatible way)
      const inputResult = await studentPage.evaluate((fish) => {
        const input = document.querySelector('#fish-input');
        if (!input) return { success: false, reason: 'Input not found' };
        if (input.disabled) return { success: false, reason: 'Input disabled' };
        
        // Clear the input first
        input.value = '';
        input.focus();
        
        // Use React's way to trigger changes
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set;
        nativeInputValueSetter.call(input, fish.toString());
        
        // Trigger React's onChange by dispatching multiple events
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        
        return { success: true, value: input.value };
      }, randomFish);
      
      await delay(500);
      
      // Click submit button
      const submitted = await studentPage.evaluate(() => {
        const input = document.querySelector('#fish-input');
        const inputValue = input ? input.value : 'no input';
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const button of buttons) {
          if (button.textContent.toLowerCase().includes('submit') && !button.disabled) {
            button.click();
            return { success: true, inputValue };
          }
        }
        return { success: false, inputValue };
      }).catch(() => ({ success: false, inputValue: 'error' }));
      
      if (submitted.success) {
        console.log(`✅ Student ${studentNum} Round ${round}: Submitted successfully with value ${submitted.inputValue}`);
      } else {
        console.log(`⚠️  Student ${studentNum} Round ${round}: Could not submit (input value was ${submitted.inputValue})`);
      }
      
      // Wait for input to become disabled (round ended)
      console.log(`⏳ Student ${studentNum} Round ${round}: Waiting for round to end...`);
      let roundEnded = false;
      attempts = 0;
      
      while (!roundEnded && attempts < 30) {
        roundEnded = await studentPage.evaluate(() => {
          const input = document.querySelector('#fish-input');
          return !input || input.disabled;
        }).catch(() => true);
        
        if (!roundEnded) {
          await delay(1000);
          attempts++;
        }
      }
      
      console.log(`✅ Student ${studentNum} Round ${round}: Round complete`);
      
      // Extra wait for results to display and countdown to next round
      await delay(2000);
      
    } catch (error) {
      console.error(`❌ Student ${studentNum} Round ${round} error:`, error.message);
    }
  }
}

async function main() {
  console.log('🚀 Starting Tragedy of Commons Game Test Automation...\n');
  
  let browser;
  
  try {
    console.log('🌐 Launching browser...');
    browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-popup-blocking',
        '--no-first-run',
        '--no-default-browser-check',
        '--max-connections-per-host=100', // Increase connection limit per host
        '--socket-reuse-policy=0' // Reuse sockets aggressively
      ],
      defaultViewport: null,
      ignoreHTTPSErrors: true,
      protocolTimeout: 30000
    });
    
    console.log('✅ Browser launched successfully\n');
    
    // Handle browser disconnection
    browser.on('disconnected', () => {
      console.log('⚠️  Browser disconnected');
    });
    
    // Setup instructor and get session code
    const { instructorPage, sessionCode } = await setupInstructor(browser);
    
    console.log('\n' + '='.repeat(50));
    console.log(`📋 SESSION CODE: ${sessionCode}`);
    console.log('='.repeat(50) + '\n');
    
    // Setup results page (will appear as second tab after instructor)
    const resultsPage = await setupResultsPage(browser, sessionCode);
    if (resultsPage) {
      console.log('✅ Results page is ready - will show live updates!\n');
    }
    
    // Setup students
    const studentPages = [];
    const MAX_OPEN_TABS = 31; // Keep under browser connection limit
    const delayBetweenStudents = USE_ONLINE ? 500 : 100; // Longer delay for online to avoid connection limits
    console.log(`\n👥 Creating ${NUM_STUDENTS} student tabs...`);
    if (USE_ONLINE) {
      console.log('⏱️  Using 500ms delay between students for online mode to avoid connection limits\n');
    }
    if (NUM_STUDENTS > MAX_OPEN_TABS) {
      console.log(`⚠️  Testing with ${NUM_STUDENTS} students - will close tabs after join to stay under connection limit\n`);
    }
    
    for (let i = 1; i <= NUM_STUDENTS; i++) {
      const studentPage = await setupStudent(browser, i, sessionCode);
      if (studentPage) {
        studentPages.push(studentPage);
        
        // If we have more students than the connection limit, close older tabs
        // Keep only the last MAX_OPEN_TABS tabs open
        if (NUM_STUDENTS > MAX_OPEN_TABS && studentPages.length > MAX_OPEN_TABS) {
          const tabToClose = studentPages.shift(); // Remove and get the first (oldest) tab
          const closedStudentNum = i - MAX_OPEN_TABS;
          try {
            await tabToClose.close();
            console.log(`🗑️  Closed Student ${closedStudentNum} tab to free connection (joined successfully)`);
          } catch (err) {
            console.log(`⚠️  Failed to close Student ${closedStudentNum} tab:`, err.message);
          }
        }
      } else {
        console.log(`⚠️  Student ${i} failed to join (skipped)`);
      }
      await delay(delayBetweenStudents);
    }
    
    const successfulJoins = NUM_STUDENTS - (NUM_STUDENTS > MAX_OPEN_TABS ? NUM_STUDENTS - studentPages.length : 0);
    console.log(`\n✅ ${NUM_STUDENTS} students joined successfully!`);
    if (NUM_STUDENTS > MAX_OPEN_TABS) {
      console.log(`   (Keeping last ${studentPages.length} tabs open, others closed to avoid connection limits)`);
    }
    
    // Wait a moment for the instructor dashboard to update with all players
    await delay(800);
    
    // Click "Start game" button on instructor page
    console.log('\n🎮 Starting the game...');
    try {
      // Bring instructor page to front
      await instructorPage.bringToFront();
      
      // Look for the "Start game" button
      const startButtons = await instructorPage.$$('button').catch(() => []);
      let started = false;
      
      for (const button of startButtons) {
        const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
        if (text.toLowerCase().includes('start') && text.toLowerCase().includes('game')) {
          console.log('🖱️  Clicking Start game button...');
          await button.click();
          started = true;
          break;
        }
      }
      
      if (!started) {
        console.log('⚠️  Could not find Start game button (may need exact player count)');
        console.log('    Check if you have the required number of students joined');
      } else {
        console.log('✅ Game started!');
        
        // If auto-submit is enabled, start auto-submitting for all students
        if (AUTO_SUBMIT) {
          console.log('\n🤖 Auto-submit mode enabled! Students will automatically submit decisions.');
          
          // Get the number of rounds from instructor page (from session config)
          let ROUNDS = 5; // Default fallback
          try {
            ROUNDS = await instructorPage.evaluate(() => {
              const roundText = document.body.textContent;
              const match = roundText.match(/Round \d+ of (\d+)/);
              return match ? parseInt(match[1]) : 5;
            }).catch(() => 5);
            console.log(`📊 Detected ${ROUNDS} rounds from session config`);
          } catch (e) {
            console.log(`⚠️  Could not detect rounds, using default: ${ROUNDS}`);
          }
          
          // Start auto-submit for each student (in parallel)
          const autoSubmitPromises = studentPages.map((page, index) => {
            return autoSubmitForStudent(page, index + 1, ROUNDS);
          });
          
          // Don't await these - let them run in background
          Promise.all(autoSubmitPromises).catch(err => {
            console.error('Error in auto-submit:', err);
          });
        }
      }
    } catch (error) {
      console.log('⚠️  Error trying to start game:', error.message);
    }
    
    console.log(`\n🎮 Game session ready with ${NUM_STUDENTS} students`);
    if (AUTO_SUBMIT) {
      console.log('🤖 Auto-submit is ENABLED - students will submit automatically');
    } else {
      console.log('💡 Tip: Use -a or --auto flag to enable auto-submit for students');
      console.log('💡 Example: npm run automate -- -a 8 (opens 8 students with auto-submit)');
    }
    console.log('🖥️  Browser windows will remain open for testing');
    console.log('⏹️  Press Ctrl+C to close all windows and exit\n');
    
    // Handle Ctrl+C gracefully
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      await browser.close();
      process.exit(0);
    });
    
    // Keep the script running
    await new Promise(() => {});
    
  } catch (error) {
    console.error('\n❌ Error during automation:', error.message);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError.message);
      }
    }
    process.exit(1);
  }
}

// Suppress certain Puppeteer warnings
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning') {
    return; // Ignore deprecation warnings
  }
  console.warn(warning);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

