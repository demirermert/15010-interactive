import puppeteer from 'puppeteer';

// Default URLs (local)
let INSTRUCTOR_URL = 'http://localhost:5173/ult/instructor';
let STUDENT_URL = 'http://localhost:5173/ult';

// Parse command line arguments
let NUM_STUDENTS = 6; // Default number of students (must be even for pairing)
let AUTO_SUBMIT = false;
let USE_ONLINE = false;
let NUM_ROUNDS = null;
let MANUAL_START = false;

// Check for flags
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '-a' || arg === '--auto') {
    AUTO_SUBMIT = true;
    if (i + 1 < process.argv.length && !isNaN(process.argv[i + 1])) {
      NUM_STUDENTS = parseInt(process.argv[i + 1], 10);
      i++;
    }
  } else if (arg === '-o' || arg === '--online') {
    USE_ONLINE = true;
    INSTRUCTOR_URL = 'https://games-theta-swart.vercel.app/ult/instructor';
    STUDENT_URL = 'https://games-theta-swart.vercel.app/ult';
  } else if (arg === '-r' || arg === '--rounds') {
    if (i + 1 < process.argv.length && !isNaN(process.argv[i + 1])) {
      NUM_ROUNDS = parseInt(process.argv[i + 1], 10);
      i++;
    }
  } else if (arg === '-m' || arg === '--manual') {
    MANUAL_START = true;
  }
}

console.log(`Configuration: ${NUM_STUDENTS} students, Auto-submit: ${AUTO_SUBMIT}, Online: ${USE_ONLINE}${NUM_ROUNDS ? `, Rounds: ${NUM_ROUNDS}` : ''}${MANUAL_START ? ', Manual start: true' : ''}`);

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
  process.exit(1);
});

async function setupInstructorManual(browser) {
  let instructorPage;
  try {
    console.log('🎓 Opening instructor page for manual setup...');
    
    instructorPage = await browser.newPage();
    
    instructorPage.on('pageerror', error => {
      console.log('⚠️  Page error:', error.message);
    });
    
    instructorPage.on('error', error => {
      console.log('⚠️  Page crashed:', error.message);
    });
    
    console.log(`🔗 Navigating to ${INSTRUCTOR_URL}...`);
    const timeout = USE_ONLINE ? 30000 : 10000;
    await instructorPage.goto(INSTRUCTOR_URL, { 
      waitUntil: 'domcontentloaded',
      timeout 
    }).catch(err => {
      throw new Error(`Failed to navigate to instructor page: ${err.message}`);
    });
    
    await delay(USE_ONLINE ? 3000 : 1500);
    
    console.log('📝 Looking for "New Game" button...');
    
    try {
      await instructorPage.waitForSelector('button', { timeout: 5000 });
    } catch (e) {
      console.log('⚠️  Timeout waiting for buttons, trying anyway...');
    }
    
    const buttons = await instructorPage.$$('button').catch(() => []);
    
    if (buttons.length === 0) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-no-buttons.png' });
      throw new Error('No buttons found on instructor page');
    }
    
    console.log(`Found ${buttons.length} button(s) on page`);
    
    let clicked = false;
    let foundText = '';
    for (const button of buttons) {
      const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
      console.log(`  Button text: "${text}"`);
      if (text.toLowerCase().includes('new') && text.toLowerCase().includes('game')) {
        console.log('🖱️  Clicking New Game button...');
        await button.click();
        clicked = true;
        foundText = text;
        break;
      }
      // Check if form is already open (button says "Hide Form")
      if (text.toLowerCase().includes('hide') && text.toLowerCase().includes('form')) {
        console.log('✅ Form already open (button shows "Hide Form")');
        clicked = true; // Don't click, just proceed
        foundText = text;
        break;
      }
    }
    
    if (!clicked) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-screenshot.png' });
      throw new Error('New Game button not found');
    }
    
    if (!foundText.includes('Hide')) {
      console.log('✅ Clicked New Game button');
    }
    await delay(1000);
    
    // Note: Ultimatum Game always has 1 round, so we don't set rounds
    if (NUM_ROUNDS !== null) {
      console.log(`⚠️  Note: Ultimatum Game always plays 1 round (NUM_ROUNDS ignored)`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 MANUAL MODE: Configure and create your game');
    console.log('='.repeat(60));
    console.log('👉 Configure game settings in the browser');
    console.log('👉 Click "Create Session"');
    console.log('👉 Waiting for session code to appear...');
    console.log('='.repeat(60) + '\n');
    
    // Wait for session code
    console.log('⏳ Waiting for you to create the session...');
    let sessionCode = null;
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes
    
    while (!sessionCode && attempts < maxAttempts) {
      await delay(2000); // Poll every 2 seconds instead of 1 second
      attempts++;
      
      // Check if page is still alive
      if (instructorPage.isClosed()) {
        throw new Error('Instructor page was closed');
      }
      
      sessionCode = await instructorPage.evaluate(() => {
        try {
          const urlMatch = window.location.pathname.match(/\/ult\/manage\/([A-Z]{4})/);
          if (urlMatch) return urlMatch[1];
          
          const allStrong = Array.from(document.querySelectorAll('strong'));
          for (const strong of allStrong) {
            const text = strong.textContent.trim();
            if (/^[A-Z]{4}$/.test(text)) {
              const rect = strong.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) return text;
            }
          }
          return null;
        } catch (e) {
          return null;
        }
      }).catch(err => {
        // Silently ignore errors during form interaction
        if (attempts % 10 === 0) {
          console.log(`⏳ Still waiting... (${Math.floor(attempts * 2 / 60)} minutes)`);
        }
        return null;
      });
      
      if (sessionCode) {
        await delay(500);
        const confirmed = await instructorPage.evaluate((code) => {
          const urlMatch = window.location.pathname.match(/\/ult\/manage\/([A-Z]{4})/);
          return urlMatch && urlMatch[1] === code;
        }, sessionCode).catch(() => false);
        
        if (confirmed) break;
        else sessionCode = null;
      }
    }
    
    if (!sessionCode) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-screenshot.png' });
      throw new Error('Session code not found after waiting');
    }
    
    console.log(`✅ Session Code: ${sessionCode}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('🚪 Waiting for you to click "Open Lobby"...');
    console.log('='.repeat(60) + '\n');
    
    let lobbyOpened = false;
    attempts = 0;
    while (!lobbyOpened && attempts < maxAttempts) {
      await delay(2000); // Poll every 2 seconds
      attempts++;
      
      lobbyOpened = await instructorPage.evaluate(() => {
        try {
          const statusTags = Array.from(document.querySelectorAll('.status-tag, [class*="status"]'));
          for (const tag of statusTags) {
            if (tag.textContent.trim().toUpperCase() === 'LOBBY') return true;
          }
          
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.some(btn => 
            btn.textContent.toLowerCase().includes('start') && 
            btn.textContent.toLowerCase().includes('game')
          );
        } catch (e) {
          return false;
        }
      }).catch(() => false);
    }
    
    if (!lobbyOpened) {
      throw new Error('Lobby not opened - timed out waiting');
    }
    
    console.log('✅ Lobby opened! Students can now join.\n');
    
    return { instructorPage, sessionCode };
  } catch (error) {
    console.error('❌ Error in setupInstructorManual:', error.message);
    if (instructorPage) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-error.png' }).catch(() => {});
    }
    throw error;
  }
}

async function setupInstructor(browser) {
  let instructorPage;
  try {
    console.log('🎓 Setting up instructor...');
    
    instructorPage = await browser.newPage();
    
    instructorPage.on('pageerror', error => {
      console.log('⚠️  Page error:', error.message);
    });
    
    console.log(`🔗 Navigating to ${INSTRUCTOR_URL}...`);
    const timeout = USE_ONLINE ? 30000 : 10000;
    await instructorPage.goto(INSTRUCTOR_URL, { 
      waitUntil: 'domcontentloaded',
      timeout 
    }).catch(err => {
      throw new Error(`Failed to navigate: ${err.message}`);
    });
    
    await delay(USE_ONLINE ? 3000 : 1500);
    
    console.log('📝 Looking for "New Game" button...');
    
    const buttons = await instructorPage.$$('button').catch(() => []);
    
    console.log(`Found ${buttons.length} button(s) on page`);
    
    let clicked = false;
    for (const button of buttons) {
      const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
      console.log(`  Button text: "${text}"`);
      if (text.toLowerCase().includes('new') && text.toLowerCase().includes('game')) {
        console.log('🖱️  Clicking New Game button...');
        await button.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-screenshot.png' });
      throw new Error('New Game button not found');
    }
    
    console.log('✅ Clicked New Game button');
    await delay(1000);
    
    // Note: Ultimatum Game always has 1 round, so we don't set rounds
    // The time settings can be configured in the UI if needed
    
    // Click Create Session
    console.log('📝 Looking for "Create Session" button...');
    const submitButtons = await instructorPage.$$('button').catch(() => []);
    
    clicked = false;
    for (const button of submitButtons) {
      const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
      if (text.toLowerCase().includes('create') && text.toLowerCase().includes('session')) {
        console.log('🖱️  Clicking Create Session button...');
        await button.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      const primaryButton = await instructorPage.$('button.primary').catch(() => null);
      if (primaryButton) {
        console.log('🖱️  Clicking primary button (fallback)...');
        await primaryButton.click();
        clicked = true;
      }
    }
    
    if (!clicked) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-screenshot.png' });
      throw new Error('Create Session button not found');
    }
    
    console.log('✅ Clicked Create Session button');
    await delay(2000);
    
    // Extract session code
    let sessionCode = await instructorPage.evaluate(() => {
      const urlMatch = window.location.pathname.match(/\/ult\/manage\/([A-Z]{4})/);
      if (urlMatch) return urlMatch[1];
      
      const allStrong = Array.from(document.querySelectorAll('strong'));
      for (const strong of allStrong) {
        const text = strong.textContent.trim();
        if (/^[A-Z]{4}$/.test(text)) return text;
      }
      
      return null;
    }).catch(() => null);
    
    if (!sessionCode) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-screenshot.png' });
      throw new Error('Session code not found');
    }
    
    console.log(`✅ Session Code: ${sessionCode}`);
    
    // Click Open Lobby
    console.log('🚪 Clicking "Open Lobby" button...');
    await delay(1000);
    
    const openLobbyButtons = await instructorPage.$$('button').catch(() => []);
    let lobbyOpened = false;
    
    for (const button of openLobbyButtons) {
      const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
      if (text.toLowerCase().includes('open') && text.toLowerCase().includes('lobby')) {
        console.log('🖱️  Found "Open Lobby" button, clicking...');
        await button.click();
        lobbyOpened = true;
        await delay(2000);
        break;
      }
    }
    
    if (!lobbyOpened) {
      console.log('⚠️  Could not find "Open Lobby" button - session may already be open');
    } else {
      console.log('✅ Lobby opened! Students can now join.');
    }
    
    return { instructorPage, sessionCode };
  } catch (error) {
    console.error('❌ Error in setupInstructor:', error.message);
    if (instructorPage) {
      await instructorPage.screenshot({ path: 'ultimatum-instructor-error.png' }).catch(() => {});
    }
    throw error;
  }
}

async function setupStudent(browser, studentNum, sessionCode) {
  let studentPage;
  try {
    console.log(`👤 Setting up Student ${studentNum}...`);
    studentPage = await browser.newPage();
    
    studentPage.on('pageerror', error => {
      console.log(`⚠️  Student ${studentNum} page error:`, error.message);
    });
    
    const timeout = 30000;
    await studentPage.goto(STUDENT_URL, { 
      waitUntil: 'domcontentloaded',
      timeout
    }).catch(err => {
      throw new Error(`Student ${studentNum}: Failed to navigate: ${err.message}`);
    });
    
    await delay(500);
    
    // Wait for form
    let formReady = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!formReady && attempts < maxAttempts) {
      attempts++;
      try {
        await studentPage.waitForSelector('input[type="text"]', { timeout: 10000 });
        formReady = true;
      } catch (e) {
        console.log(`⚠️  Student ${studentNum}: Form not ready (attempt ${attempts}/${maxAttempts})...`);
        if (attempts < maxAttempts) {
          await delay(2000);
          await studentPage.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await delay(1000);
        }
      }
    }
    
    if (!formReady) {
      const screenshot = `ultimatum-student-${studentNum}-no-form.png`;
      await studentPage.screenshot({ path: screenshot });
      console.log(`⚠️  Student ${studentNum}: Skipping due to form load failure`);
      return null;
    }
    
    // Fill first name
    const firstNameInput = await studentPage.$('#first-name').catch(() => null);
    if (firstNameInput) {
      await firstNameInput.click({ clickCount: 3 }); // Select all existing text
      await firstNameInput.type(`Student${studentNum}`, { delay: 0 });
      console.log(`✅ Student ${studentNum}: Entered first name`);
    }
    
    await delay(50);
    
    // Fill last name
    const lastNameInput = await studentPage.$('#last-name').catch(() => null);
    if (lastNameInput) {
      await lastNameInput.click({ clickCount: 3 }); // Select all existing text
      await lastNameInput.type(`Test`, { delay: 0 });
      console.log(`✅ Student ${studentNum}: Entered last name`);
    }
    
    await delay(50);
    
    // Fill session code
    const codeInput = await studentPage.$('#session-code').catch(() => null);
    
    if (!codeInput) {
      const screenshot = `ultimatum-student-${studentNum}-screenshot.png`;
      await studentPage.screenshot({ path: screenshot });
      throw new Error(`Student ${studentNum}: Session code input field not found`);
    }
    
    await codeInput.type(sessionCode, { delay: 0 });
    console.log(`✅ Student ${studentNum}: Entered session code`);
    
    await delay(100);
    
    // Click Join button
    let joined = false;
    let retries = 3;
    
    while (!joined && retries > 0) {
      const buttons = await studentPage.$$('button').catch(() => []);
      
      for (const button of buttons) {
        const text = await button.evaluate(el => el.textContent).catch(() => '');
        if (text.toLowerCase().includes('join')) {
          const isVisible = await button.evaluate(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !el.disabled;
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
      await studentPage.screenshot({ path: `ultimatum-student-${studentNum}-error.png` });
      throw new Error(`Student ${studentNum}: Join button not found or not clickable`);
    }
    
    console.log(`✅ Student ${studentNum}: Successfully joined session`);
    await delay(300);
    
    return studentPage;
  } catch (error) {
    console.error(`❌ Error setting up Student ${studentNum}:`, error.message);
    if (studentPage) {
      await studentPage.screenshot({ path: `ultimatum-student-${studentNum}-error.png` }).catch(() => {});
    }
    throw error;
  }
}

async function autoSubmitForStudent(studentPage, studentNum, roundsToPlay) {
  console.log(`🤖 Auto-submit enabled for Student ${studentNum}`);
  
  for (let round = 1; round <= roundsToPlay; round++) {
    try {
      // Check if game ended
      const gameEnded = await studentPage.evaluate(() => {
        const bodyText = document.body.textContent;
        return bodyText.includes('Game Complete') || bodyText.includes('Session Complete');
      }).catch(() => false);
      
      if (gameEnded) {
        console.log(`🏁 Student ${studentNum}: Game ended (completed ${round - 1} rounds)`);
        break;
      }
      
      // Determine if this student is Player 1 (Proposer) or Player 2 (Responder)
      const playerInfo = await studentPage.evaluate(() => {
        const bodyText = document.body.textContent;
        const isProposer = bodyText.includes('Player 1 (Proposer)') || bodyText.includes('YOUR PRICE') || bodyText.includes('How much do you want to offer');
        const isResponder = bodyText.includes('Player 2 (Responder)') || bodyText.includes('Player 1 offers you');
        return { isProposer, isResponder };
      }).catch(() => ({ isProposer: false, isResponder: false }));
      
      if (playerInfo.isProposer) {
        // Player 1 - Make an offer
        console.log(`⏳ Student ${studentNum} Round ${round}: Waiting to make offer (Player 1)...`);
        
        let inputEnabled = false;
        let attempts = 0;
        const maxAttempts = 65;
        
        while (!inputEnabled && attempts < maxAttempts) {
          inputEnabled = await studentPage.evaluate(() => {
            const input = document.querySelector('input[type="number"]');
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
        
        // Generate random offer (0-20)
        const randomOffer = Math.floor(Math.random() * 21);
        console.log(`💰 Student ${studentNum} Round ${round}: Offering $${randomOffer} (Player 1)`);
        
        // Fill offer
        await studentPage.evaluate((offer) => {
          const input = document.querySelector('input[type="number"]');
          if (!input) return;
          
          input.value = '';
          input.focus();
          
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          ).set;
          nativeInputValueSetter.call(input, offer);
          
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, randomOffer);
        
        await delay(500);
        
        // Click submit
        const submitted = await studentPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const button of buttons) {
            const text = button.textContent.toLowerCase();
            if ((text.includes('submit') || text.includes('offer')) && !button.disabled) {
              button.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);
        
        if (submitted) {
          console.log(`✅ Student ${studentNum} Round ${round}: Offer submitted`);
        }
        
      } else if (playerInfo.isResponder) {
        // Player 2 - Wait for offer and decide
        console.log(`⏳ Student ${studentNum} Round ${round}: Waiting for offer (Player 2)...`);
        
        let offerReceived = false;
        let attempts = 0;
        const maxAttempts = 65;
        
        while (!offerReceived && attempts < maxAttempts) {
          offerReceived = await studentPage.evaluate(() => {
            const bodyText = document.body.textContent;
            return bodyText.includes('Player 1 offers you') || bodyText.includes('Accept') || bodyText.includes('Reject');
          }).catch(() => false);
          
          if (!offerReceived) {
            await delay(1000);
            attempts++;
          }
        }
        
        if (!offerReceived) {
          console.log(`⚠️  Student ${studentNum} Round ${round}: Never received offer`);
          continue;
        }
        
        console.log(`📨 Student ${studentNum} Round ${round}: Received offer (Player 2)`);
        
        // Make random decision (weighted towards acceptance)
        const accept = Math.random() > 0.3; // 70% chance to accept
        
        console.log(`🎲 Student ${studentNum} Round ${round}: ${accept ? 'Accepting' : 'Rejecting'} offer`);
        
        await delay(500);
        
        // Click Accept or Reject button
        const clicked = await studentPage.evaluate((shouldAccept) => {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const button of buttons) {
            const text = button.textContent.toLowerCase();
            if (shouldAccept && text.includes('accept') && !button.disabled) {
              button.click();
              return true;
            }
            if (!shouldAccept && text.includes('reject') && !button.disabled) {
              button.click();
              return true;
            }
          }
          return false;
        }, accept).catch(() => false);
        
        if (clicked) {
          console.log(`✅ Student ${studentNum} Round ${round}: Decision submitted`);
        }
      } else {
        console.log(`⏳ Student ${studentNum} Round ${round}: Waiting for round to start...`);
        await delay(5000);
      }
      
      // Wait for next round
      await delay(3000);
      
    } catch (error) {
      console.error(`❌ Student ${studentNum} Round ${round} error:`, error.message);
    }
  }
}

async function main() {
  console.log('🚀 Starting Ultimatum Game Test Automation...\n');
  
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
        '--no-default-browser-check'
      ],
      defaultViewport: null,
      ignoreHTTPSErrors: true,
      protocolTimeout: 30000
    });
    
    console.log('✅ Browser launched successfully\n');
    
    browser.on('disconnected', () => {
      console.log('⚠️  Browser disconnected');
    });
    
    // Setup instructor
    let { instructorPage, sessionCode } = MANUAL_START 
      ? await setupInstructorManual(browser)
      : await setupInstructor(browser);
    
    console.log('\n' + '='.repeat(50));
    console.log(`📋 SESSION CODE: ${sessionCode}`);
    console.log('='.repeat(50) + '\n');
    
    // Setup students
    const studentPages = [];
    const delayBetweenStudents = USE_ONLINE ? 500 : 100;
    console.log(`\n👥 Creating ${NUM_STUDENTS} student tabs...`);
    
    for (let i = 1; i <= NUM_STUDENTS; i++) {
      const studentPage = await setupStudent(browser, i, sessionCode);
      if (studentPage) {
        studentPages.push(studentPage);
      }
      await delay(delayBetweenStudents);
    }
    
    console.log(`\n✅ ${studentPages.length} students joined successfully!`);
    
    await delay(1500);
    
    // Start the game
    console.log('\n🎮 Starting the game...');
    try {
      await instructorPage.bringToFront();
      
      const startButtons = await instructorPage.$$('button').catch(() => []);
      let started = false;
      
      for (const button of startButtons) {
        const text = await button.evaluate(el => el.textContent.trim()).catch(() => '');
        if (text.toLowerCase().includes('start') && text.toLowerCase().includes('game')) {
          console.log('🖱️  Clicking Start Game button...');
          await button.click();
          started = true;
          break;
        }
      }
      
      if (!started) {
        console.log('⚠️  Could not find Start Game button');
      } else {
        console.log('✅ Game started!');
        
        await delay(1500);
        
        // Start auto-submit if enabled
        if (AUTO_SUBMIT) {
          console.log('\n🤖 Auto-submit mode enabled!');
          
          const ROUNDS = NUM_ROUNDS || 5;
          console.log(`📊 Game will run for ${ROUNDS} rounds`);
          
          // Start auto-submit for each student
          const autoSubmitPromises = studentPages.map((page, index) => {
            return autoSubmitForStudent(page, index + 1, ROUNDS);
          });
          
          Promise.all(autoSubmitPromises).catch(err => {
            console.error('Error in auto-submit:', err);
          });
        }
      }
    } catch (error) {
      console.log('⚠️  Error trying to start game:', error.message);
    }
    
    console.log(`\n🎮 Game session ready with ${studentPages.length} students`);
    if (AUTO_SUBMIT) {
      console.log('🤖 Auto-submit is ENABLED - students will submit automatically');
    } else {
      console.log('💡 Tip: Use -a or --auto flag to enable auto-submit');
      console.log('💡 Example: npm run test-ultimatum -- -a 6');
    }
    console.log('🖥️  Browser windows will remain open for testing');
    console.log('⏹️  Press Ctrl+C to close all windows and exit\n');
    
    // Handle Ctrl+C
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      await browser.close();
      process.exit(0);
    });
    
    // Keep running
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

process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning') return;
  console.warn(warning);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

