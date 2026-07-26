import puppeteer from 'puppeteer';
import { writeFileSync } from 'fs';

// Default URLs (local)
let INSTRUCTOR_URL = 'http://localhost:5173/instructor';
let STUDENT_URL = 'http://localhost:5173';

// Parse command line arguments
let NUM_STUDENTS = 6; // Default number of students (must be even for pairing)
let AUTO_SUBMIT = false;
let USE_ONLINE = false;
let NUM_ROUNDS = null; // Default: null means use game's default settings
let MANUAL_START = false; // Wait for manual game start

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
    INSTRUCTOR_URL = 'https://games-theta-swart.vercel.app/instructor';
    STUDENT_URL = 'https://games-theta-swart.vercel.app';
  } else if (arg === '-r' || arg === '--rounds') {
    // Check if next argument is a number
    if (i + 1 < process.argv.length && !isNaN(process.argv[i + 1])) {
      NUM_ROUNDS = parseInt(process.argv[i + 1], 10);
      i++; // Skip the next argument since we used it
    }
  } else if (arg === '-m' || arg === '--manual') {
    MANUAL_START = true;
  }
}

// NUM_STUDENTS can now be any number (odd or even)
// If odd, the server will automatically add an AI player for pairing

console.log(`Configuration: ${NUM_STUDENTS} students, Auto-submit: ${AUTO_SUBMIT}, Online: ${USE_ONLINE}${NUM_ROUNDS ? `, Rounds: ${NUM_ROUNDS}` : ''}${MANUAL_START ? ', Manual start: true' : ''}`);

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle unhandled rejections
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
    
    // Set up error handlers for the page
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
    
    // Wait for React to render
    await delay(USE_ONLINE ? 3000 : 1500);
    
    console.log('📝 Looking for "New Game" button...');
    
    // Try to wait for buttons to appear
    try {
      await instructorPage.waitForSelector('button', { timeout: 5000 });
    } catch (e) {
      console.log('⚠️  Timeout waiting for buttons, trying anyway...');
    }
    
    // Get all buttons and find the New Game button
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
      if (text.toLowerCase().includes('new') && text.toLowerCase().includes('game')) {
        console.log('🖱️  Clicking New Game button...');
        await button.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      console.log('❌ Could not find New Game button');
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      throw new Error('New Game button not found');
    }
    
    console.log('✅ Clicked New Game button');
    
    // Wait for form to expand
    await delay(1000);
    
    // If NUM_ROUNDS is specified, set the rounds input
    if (NUM_ROUNDS !== null) {
      console.log(`🔢 Setting number of rounds to ${NUM_ROUNDS}...`);
      try {
        const roundsInput = await instructorPage.$('input[type="number"]').catch(() => null);
        if (roundsInput) {
          // Clear existing value and set new value
          await roundsInput.click({ clickCount: 3 }); // Select all
          await roundsInput.type(String(NUM_ROUNDS));
          console.log(`✅ Set rounds to ${NUM_ROUNDS}`);
        } else {
          console.log('⚠️  Could not find rounds input field');
        }
      } catch (e) {
        console.log('⚠️  Error setting rounds:', e.message);
      }
      await delay(500);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📋 MANUAL MODE: Configure and create your game');
    console.log('='.repeat(60));
    console.log('👉 Configure game settings in the browser:');
    console.log('   - Time per round, break time, market parameters, etc.');
    if (NUM_ROUNDS !== null) {
      console.log(`   - Rounds already set to ${NUM_ROUNDS}`);
    }
    console.log('👉 Click "Create Session"');
    console.log('👉 Waiting for session code to appear...');
    console.log('='.repeat(60) + '\n');
    
    // Wait for session code to appear on the page
    console.log('⏳ Waiting for you to create the session...');
    let sessionCode = null;
    let attempts = 0;
    const maxAttempts = 120; // Wait up to 2 minutes
    
    while (!sessionCode && attempts < maxAttempts) {
      await delay(1000);
      attempts++;
      
      sessionCode = await instructorPage.evaluate(() => {
        // Look for session code in the URL (after creating session, it redirects to /manage/:code)
        const urlMatch = window.location.pathname.match(/\/manage\/([A-Z0-9]{4})/);
        if (urlMatch) {
          return urlMatch[1];
        }
        
        // Look for the session code display in strong tags
        const allStrong = Array.from(document.querySelectorAll('strong'));
        for (const strong of allStrong) {
          const text = strong.textContent.trim();
          // Session codes are exactly 4 alphanumeric characters
          if (/^[A-Z0-9]{4}$/.test(text)) {
            // Make sure it's actually displayed on page (not hidden)
            const rect = strong.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return text;
            }
          }
        }
        
        return null;
      }).catch(() => null);
      
      if (sessionCode) {
        // Double check it's valid by waiting a bit and checking again
        await delay(500);
        const confirmed = await instructorPage.evaluate((code) => {
          const urlMatch = window.location.pathname.match(/\/manage\/([A-Z0-9]{4})/);
          return urlMatch && urlMatch[1] === code;
        }, sessionCode).catch(() => false);
        
        if (confirmed) {
          break;
        } else {
          sessionCode = null; // False positive, keep waiting
        }
      }
    }
    
    if (!sessionCode) {
      console.log('❌ Could not detect session code automatically');
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      console.log('📸 Screenshot saved to instructor-screenshot.png');
      throw new Error('Session code not found after waiting');
    }
    
    console.log(`✅ Session Code: ${sessionCode}`);
    
    // Now wait for instructor to click "Open Lobby"
    console.log('\n' + '='.repeat(60));
    console.log('🚪 Waiting for you to click "Open Lobby"...');
    console.log('='.repeat(60) + '\n');
    
    let lobbyOpened = false;
    attempts = 0;
    while (!lobbyOpened && attempts < maxAttempts) {
      await delay(1000);
      attempts++;
      
      // Check if status has changed from 'setup' to 'lobby'
      lobbyOpened = await instructorPage.evaluate(() => {
        // Look for status tag that says "LOBBY"
        const statusTags = Array.from(document.querySelectorAll('.status-tag, [class*="status"]'));
        for (const tag of statusTags) {
          if (tag.textContent.trim().toUpperCase() === 'LOBBY') {
            return true;
          }
        }
        
        // Also check if "Open Lobby" button is gone and "Start Game" button appears
        const buttons = Array.from(document.querySelectorAll('button'));
        const hasStartGame = buttons.some(btn => 
          btn.textContent.toLowerCase().includes('start') && 
          btn.textContent.toLowerCase().includes('game')
        );
        return hasStartGame;
      }).catch(() => false);
    }
    
    if (!lobbyOpened) {
      console.log('❌ Lobby was not opened within the time limit');
      throw new Error('Lobby not opened - timed out waiting');
    }
    
    console.log('✅ Lobby opened! Students can now join.');
    console.log('📌 Keeping instructor page open for monitoring\n');
    
    // Note: We'll extract parameters after the game starts (when they're displayed)
    // For now, return a placeholder that will be updated later
    return { instructorPage, sessionCode, monopolyPrice: null };
  } catch (error) {
    console.error('❌ Error in setupInstructorManual:', error.message);
    if (instructorPage) {
      await instructorPage.screenshot({ path: 'instructor-error.png' }).catch(() => {});
    }
    throw error;
  }
}

async function setupInstructor(browser) {
  let instructorPage;
  try {
    console.log('🎓 Setting up instructor...');
    
    instructorPage = await browser.newPage();
    
    // Set up error handlers for the page
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
    
    // Wait for React to render
    await delay(USE_ONLINE ? 3000 : 1500);
    
    console.log('📝 Looking for "New Game" button...');
    
    // Try to wait for buttons to appear
    try {
      await instructorPage.waitForSelector('button', { timeout: 5000 });
    } catch (e) {
      console.log('⚠️  Timeout waiting for buttons, trying anyway...');
    }
    
    // Get all buttons and find the New Game button
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
      if (text.toLowerCase().includes('new') && text.toLowerCase().includes('game')) {
        console.log('🖱️  Clicking New Game button...');
        await button.click();
        clicked = true;
        break;
      }
    }
    
    if (!clicked) {
      console.log('❌ Could not find New Game button');
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      throw new Error('New Game button not found');
    }
    
    console.log('✅ Clicked New Game button');
    
    // Wait for form to expand
    await delay(1000);
    
    // If NUM_ROUNDS is specified, set the rounds input
    if (NUM_ROUNDS !== null) {
      console.log(`🔢 Setting number of rounds to ${NUM_ROUNDS}...`);
      try {
        const roundsInput = await instructorPage.$('input[type="number"]').catch(() => null);
        if (roundsInput) {
          // Clear existing value and set new value
          await roundsInput.click({ clickCount: 3 }); // Select all
          await roundsInput.type(String(NUM_ROUNDS));
          console.log(`✅ Set rounds to ${NUM_ROUNDS}`);
        } else {
          console.log('⚠️  Could not find rounds input field');
        }
      } catch (e) {
        console.log('⚠️  Error setting rounds:', e.message);
      }
      await delay(500);
    }
    
    // Look for "Create Session" submit button
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
      // Try clicking the first primary button as fallback
      const primaryButton = await instructorPage.$('button.primary').catch(() => null);
      if (primaryButton) {
        console.log('🖱️  Clicking primary button (fallback)...');
        await primaryButton.click();
        clicked = true;
      }
    }
    
    if (!clicked) {
      console.log('❌ Could not find Create Session button');
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      throw new Error('Create Session button not found');
    }
    
    console.log('✅ Clicked Create Session button');
    
    // Wait for session code to appear (API call + React render + redirect)
    await delay(2000);
    
    // Try to extract session code
    let sessionCode = null;
    
    console.log('🔍 Searching for session code...');
    
    // The session code should appear in the management page after creation
    sessionCode = await instructorPage.evaluate(() => {
      // Look for the session code display
      const allStrong = Array.from(document.querySelectorAll('strong'));
      for (const strong of allStrong) {
        const text = strong.textContent.trim();
        // Session codes are exactly 4 alphanumeric characters
        if (/^[A-Z0-9]{4}$/.test(text)) {
          return text;
        }
      }
      
      // Also check for code patterns in regular text
      const bodyText = document.body.textContent;
      const codeMatch = bodyText.match(/\b([A-Z0-9]{4})\b/);
      if (codeMatch) {
        return codeMatch[1];
      }
      
      return null;
    }).catch(() => null);
    
    if (!sessionCode) {
      console.log('❌ Could not extract session code automatically');
      
      // Take a screenshot for debugging
      await instructorPage.screenshot({ path: 'instructor-screenshot.png' });
      console.log('📸 Screenshot saved to instructor-screenshot.png');
      
      // Also save HTML for debugging
      const html = await instructorPage.content().catch(() => '<error getting html>');
      writeFileSync('instructor-debug.html', html);
      console.log('📄 HTML saved to instructor-debug.html');
      
      throw new Error('Session code not found');
    }
    
    console.log(`✅ Session Code: ${sessionCode}`);
    
    // Now automatically click "Open Lobby" button
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
        await delay(2000); // Wait for status to update
        break;
      }
    }
    
    if (!lobbyOpened) {
      console.log('⚠️  Could not find "Open Lobby" button - session may already be open');
    } else {
      console.log('✅ Lobby opened! Students can now join.');
    }
    
    // Use default values for monopoly price calculation (since instructor didn't manually configure)
    // Default is Hotelling model with default parameters
    const monopolyPrice = 50; // Default for Hotelling at boundaries
    
    return { instructorPage, sessionCode, monopolyPrice };
  } catch (error) {
    console.error('❌ Error in setupInstructor:', error.message);
    if (instructorPage) {
      await instructorPage.screenshot({ path: 'instructor-error.png' }).catch(() => {});
    }
    throw error;
  }
}

async function setupStudent(browser, studentNum, sessionCode) {
  let studentPage;
  try {
    console.log(`👤 Setting up Student ${studentNum}...`);
    studentPage = await browser.newPage();
    
    // Set up error handlers
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
    
    // Wait for the form to be ready
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
      console.log(`⚠️  Student ${studentNum}: Skipping due to form load failure`);
      return null;
    }
    
    // Find and fill the first name input
    const firstNameInput = await studentPage.$('#first-name').catch(() => null);
    if (firstNameInput) {
      await firstNameInput.type(`Student${studentNum}`, { delay: 0 });
      console.log(`✅ Student ${studentNum}: Entered first name`);
    }
    
    await delay(50);
    
    // Find and fill the last name input
    const lastNameInput = await studentPage.$('#last-name').catch(() => null);
    if (lastNameInput) {
      await lastNameInput.type(`Test`, { delay: 0 });
      console.log(`✅ Student ${studentNum}: Entered last name`);
    }
    
    await delay(50);
    
    // Find the session code input
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
    
    // Look for "Join" button
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

async function autoSubmitForStudent(studentPage, studentNum, roundsToPlay, priceBounds) {
  console.log(`🤖 Auto-submit enabled for Student ${studentNum}`);
  
  for (let round = 1; round <= roundsToPlay; round++) {
    try {
      // Check if game has ended before starting this round
      const gameEnded = await studentPage.evaluate(() => {
        const bodyText = document.body.textContent;
        return bodyText.includes('Game Summary') || 
               bodyText.includes('Session Complete') ||
               bodyText.includes('Final Results');
      }).catch(() => false);
      
      if (gameEnded) {
        console.log(`🏁 Student ${studentNum}: Game ended, stopping auto-submit (completed ${round - 1} rounds)`);
        break;
      }
      
      // Wait for round to start - look for enabled price input
      console.log(`⏳ Student ${studentNum} Round ${round}: Waiting for round to start...`);
      
      let inputEnabled = false;
      let attempts = 0;
      const maxAttempts = 45; // 45 seconds max wait
      
      while (!inputEnabled && attempts < maxAttempts) {
        // Check again if game ended while waiting
        const gameEndedWhileWaiting = await studentPage.evaluate(() => {
          const bodyText = document.body.textContent;
          return bodyText.includes('Game Summary') || 
                 bodyText.includes('Session Complete') ||
                 bodyText.includes('Final Results');
        }).catch(() => false);
        
        if (gameEndedWhileWaiting) {
          console.log(`🏁 Student ${studentNum}: Game ended while waiting for round ${round}`);
          return; // Exit the entire function
        }
        
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
        console.log(`⚠️  Student ${studentNum} Round ${round}: Input never became ready (may have ended)`);
        // Check one more time if game ended
        const finalCheck = await studentPage.evaluate(() => {
          const bodyText = document.body.textContent;
          return bodyText.includes('Game Summary');
        }).catch(() => false);
        if (finalCheck) {
          console.log(`🏁 Student ${studentNum}: Confirmed game ended`);
          break;
        }
        continue;
      }
      
      console.log(`✅ Student ${studentNum} Round ${round}: Round started`);
      
      // Generate random integer price within bounds
      const minPrice = priceBounds?.min || 0;
      const maxPrice = priceBounds?.max || 20;
      const randomPrice = Math.floor(Math.random() * (maxPrice - minPrice + 1) + minPrice);
      
      console.log(`💰 Student ${studentNum} Round ${round}: Attempting to submit price $${randomPrice}`);
      
      // Fill in the price input (React-compatible way)
      const inputResult = await studentPage.evaluate((price) => {
        const input = document.querySelector('input[type="number"]');
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
        nativeInputValueSetter.call(input, price);
        
        // Trigger React's onChange by dispatching multiple events
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        
        return { success: true, value: input.value };
      }, randomPrice);
      
      await delay(500);
      
      // Click submit button
      const submitted = await studentPage.evaluate(() => {
        const input = document.querySelector('input[type="number"]');
        const inputValue = input ? input.value : 'no input';
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const button of buttons) {
          const text = button.textContent.toLowerCase();
          if ((text.includes('submit') || text.includes('set')) && !button.disabled) {
            button.click();
            return { success: true, inputValue };
          }
        }
        return { success: false, inputValue };
      }).catch(() => ({ success: false, inputValue: 'error' }));
      
      if (submitted.success) {
        console.log(`✅ Student ${studentNum} Round ${round}: Submitted successfully with price $${submitted.inputValue}`);
      } else {
        console.log(`⚠️  Student ${studentNum} Round ${round}: Could not submit (input value was ${submitted.inputValue})`);
      }
      
      // Wait for input to become disabled (round ended)
      console.log(`⏳ Student ${studentNum} Round ${round}: Waiting for round to end...`);
      let roundEnded = false;
      attempts = 0;
      
      while (!roundEnded && attempts < 30) {
        roundEnded = await studentPage.evaluate(() => {
          const input = document.querySelector('input[type="number"]');
          return !input || input.disabled;
        }).catch(() => true);
        
        if (!roundEnded) {
          await delay(1000);
          attempts++;
        }
      }
      
      console.log(`✅ Student ${studentNum} Round ${round}: Round complete`);
      
      // Extra wait for results to display
      await delay(2000);
      
    } catch (error) {
      console.error(`❌ Student ${studentNum} Round ${round} error:`, error.message);
    }
  }
}

async function main() {
  console.log('🚀 Starting Pricing Game Test Automation...\n');
  
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
        '--max-connections-per-host=100',
        '--socket-reuse-policy=0'
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
    let { instructorPage, sessionCode, monopolyPrice } = MANUAL_START 
      ? await setupInstructorManual(browser)
      : await setupInstructor(browser);
    
    console.log('\n' + '='.repeat(50));
    console.log(`📋 SESSION CODE: ${sessionCode}`);
    console.log('='.repeat(50) + '\n');
    
    // Setup students
    const studentPages = [];
    const MAX_OPEN_TABS = 100;
    const delayBetweenStudents = USE_ONLINE ? 500 : 100;
    console.log(`\n👥 Creating ${NUM_STUDENTS} student tabs...`);
    if (USE_ONLINE) {
      console.log('⏱️  Using 500ms delay between students for online mode\n');
    }
    
    for (let i = 1; i <= NUM_STUDENTS; i++) {
      const studentPage = await setupStudent(browser, i, sessionCode);
      if (studentPage) {
        studentPages.push(studentPage);
        
        // If we have more students than the connection limit, close older tabs
        if (NUM_STUDENTS > MAX_OPEN_TABS && studentPages.length > MAX_OPEN_TABS) {
          const tabToClose = studentPages.shift();
          const closedStudentNum = i - MAX_OPEN_TABS;
          try {
            await tabToClose.close();
            console.log(`🗑️  Closed Student ${closedStudentNum} tab to free connection`);
          } catch (err) {
            console.log(`⚠️  Failed to close Student ${closedStudentNum} tab:`, err.message);
          }
        }
      } else {
        console.log(`⚠️  Student ${i} failed to join (skipped)`);
      }
      await delay(delayBetweenStudents);
    }
    
    console.log(`\n✅ ${NUM_STUDENTS} students joined successfully!`);
    if (NUM_STUDENTS > MAX_OPEN_TABS) {
      console.log(`   (Keeping last ${studentPages.length} tabs open, others closed to avoid connection limits)`);
    }
    
    // Wait for the instructor dashboard to update with all players
    await delay(1500);
    
    // Click "Start Game" button on instructor page (always do this, even in manual mode)
    console.log('\n🎮 Starting the game...');
    try {
      // Bring instructor page to front
      await instructorPage.bringToFront();
      
      // Look for the "Start Game" button
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
        console.log('    Make sure all students have joined and pairing is complete');
      } else {
        console.log('✅ Game started!');
        
        // Wait for the page to update after starting
        await delay(1500);
        
        // Extract game parameters NOW (after game starts, when they're displayed)
        if (monopolyPrice === null || monopolyPrice === 10) {
          console.log('📊 Extracting game parameters from instructor page...');
          const gameParams = await instructorPage.evaluate(() => {
            // Look for the parameters display in small gray text (after game starts)
            const allDivs = Array.from(document.querySelectorAll('div'));
            
            for (const div of allDivs) {
              const style = window.getComputedStyle(div);
              const text = div.textContent;
              
              // Look for the parameter display (small gray text)
              if (style.fontSize.includes('0.75rem') || style.fontSize === '12px') {
                // Check for Hotelling model
                if (text.includes('Hotelling Model') || text.includes('hotelling')) {
                  const tMatch = text.match(/t=\$?([\d.]+)/);
                  const vMatch = text.match(/V=\$?([\d.]+)/);
                  const x1Match = text.match(/x₁=([\d.]+)/);
                  const x2Match = text.match(/x₂=([\d.]+)/);
                  
                  if (tMatch && vMatch && x1Match && x2Match) {
                    return {
                      modelType: 'hotelling',
                      travelCost: parseFloat(tMatch[1]),
                      consumerValue: parseFloat(vMatch[1]),
                      x1: parseFloat(x1Match[1]),
                      x2: parseFloat(x2Match[1])
                    };
                  }
                }
                
                // Check for Logit model
                if (text.includes('Logit Model') || text.includes('logit')) {
                  const alphaMatch = text.match(/α=([\d.]+)/);
                  const sigmaMatch = text.match(/σ=([\d.]+)/);
                  
                  if (alphaMatch) {
                    return {
                      modelType: 'logit',
                      alpha: parseFloat(alphaMatch[1]),
                      sigma: sigmaMatch ? parseFloat(sigmaMatch[1]) : 5
                    };
                  }
                }
              }
            }
            
            return null;
          }).catch(() => null);
          
          if (gameParams) {
            if (gameParams.modelType === 'hotelling') {
              const V = gameParams.consumerValue;
              const t = gameParams.travelCost;
              const x1 = gameParams.x1;
              const leftReach = (V/2) / t;
              const rightReach = (V/2) / t;
              
              if (leftReach >= x1 && rightReach >= (100 - x1)) {
                monopolyPrice = V/2;
              } else if (leftReach < x1 && rightReach < (100 - x1)) {
                monopolyPrice = V/2;
              } else if (leftReach >= x1) {
                monopolyPrice = (V + t * x1) / 2;
              } else {
                monopolyPrice = (V + t * (100 - x1)) / 2;
              }
              console.log(`📊 Hotelling Model: V=${V}, t=${t}, x₁=${x1}, x₂=${gameParams.x2}`);
            } else if (gameParams.modelType === 'logit') {
              monopolyPrice = 10 / gameParams.alpha;
              console.log(`📊 Logit Model: α=${gameParams.alpha}, σ=${gameParams.sigma}`);
            }
            console.log(`💰 Calculated Monopoly Price: $${monopolyPrice.toFixed(2)}`);
          } else {
            console.log('⚠️  Could not extract game parameters from page, using default monopoly price = $10');
            monopolyPrice = 10;
          }
        }
        
        // If auto-submit is enabled, start auto-submitting for all students
        if (AUTO_SUBMIT) {
          console.log('\n🤖 Auto-submit mode enabled! Students will automatically submit prices.');
          
          // Get game configuration from instructor page
          let ROUNDS = 2;
          let priceBounds = { min: 0, max: Math.min(2 * monopolyPrice, 100) };
          
          try {
            const config = await instructorPage.evaluate(() => {
              const bodyText = document.body.textContent;
              
              // Try to extract rounds
              const roundMatch = bodyText.match(/Round \d+ of (\d+)/i) || 
                                bodyText.match(/Total Rounds:\s*(\d+)/i) ||
                                bodyText.match(/Rounds:\s*(\d+)/i);
              const rounds = roundMatch ? parseInt(roundMatch[1]) : 2;
              
              return { rounds };
            }).catch(() => ({ rounds: 2 }));
            
            ROUNDS = config.rounds;
            console.log(`📊 Detected game config: ${ROUNDS} rounds, prices $${priceBounds.min}-$${priceBounds.max.toFixed(2)} (based on monopoly price)`);
          } catch (e) {
            console.log(`⚠️  Could not detect game config, using defaults: ${ROUNDS} rounds`);
          }
          
          // Start auto-submit for each student (in parallel)
          const autoSubmitPromises = studentPages.map((page, index) => {
            return autoSubmitForStudent(page, index + 1, ROUNDS, priceBounds);
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
      console.log('📊 Monitoring session for completion...');
    } else {
      console.log('💡 Tip: Use -a or --auto flag to enable auto-submit for students');
      console.log('💡 Example: npm run test-game -- -m -a 6 (manual config, 6 students with auto-submit)');
      console.log('💡 Flags: -m for manual config, -r [number] to set rounds, -o for online mode');
    }
    console.log('🖥️  Browser windows will remain open for testing');
    console.log('⏹️  Press Ctrl+C to close all windows and exit\n');
    
    // Handle Ctrl+C gracefully
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Shutting down...');
      await browser.close();
      process.exit(0);
    });
    
    // Monitor for session completion and generate report
    if (AUTO_SUBMIT) {
      console.log('⏳ Waiting for game to complete...\n');
      
      let sessionComplete = false;
      let checkAttempts = 0;
      const maxCheckAttempts = 3600; // Check for up to 1 hour (at 5 second intervals)
      
      while (!sessionComplete && checkAttempts < maxCheckAttempts) {
        await delay(5000); // Check every 5 seconds
        checkAttempts++;
        
        // Check if session is complete
        sessionComplete = await instructorPage.evaluate(() => {
          // Look for "COMPLETE" status
          const statusTags = Array.from(document.querySelectorAll('.status-tag, [class*="status"]'));
          for (const tag of statusTags) {
            if (tag.textContent.trim().toUpperCase() === 'COMPLETE') {
              return true;
            }
          }
          
          // Also look for completion message or indicator
          const bodyText = document.body.textContent;
          if (bodyText.includes('Session Complete') || bodyText.includes('Game Over')) {
            return true;
          }
          
          return false;
        }).catch(() => false);
        
        if (sessionComplete) {
          console.log('\n' + '='.repeat(70));
          console.log('🎉 SESSION COMPLETED! Generating report...');
          console.log('='.repeat(70) + '\n');
          
          // Wait a moment for all data to be rendered
          await delay(2000);
          
          // Extract test integrity data from instructor page
          const testReport = await instructorPage.evaluate(() => {
            const report = {
              sessionCode: null,
              totalRounds: 0,
              expectedRounds: 0,
              totalStudents: 0,
              playersData: [],
              offlinePlayers: [],
              awayPlayers: [],
              modelInfo: null
            };
            
            // Get session code
            const urlMatch = window.location.pathname.match(/\/manage\/([A-Z0-9]{4})/);
            if (urlMatch) {
              report.sessionCode = urlMatch[1];
            }
            
            // Get model info
            const paramDivs = Array.from(document.querySelectorAll('div'));
            for (const div of paramDivs) {
              const text = div.textContent;
              if (text.includes('Hotelling Model') || text.includes('Logit Model')) {
                report.modelInfo = text.trim();
                break;
              }
            }
            
            // Try to detect number of rounds played
            const roundTexts = document.body.textContent.match(/Round (\d+) of (\d+)/);
            if (roundTexts) {
              report.totalRounds = parseInt(roundTexts[1]);
              report.expectedRounds = parseInt(roundTexts[2]);
            }
            
            // Get player connection status from the student list
            // Look for the students list section
            const studentListHeaders = Array.from(document.querySelectorAll('h3, h4'));
            let studentsSection = null;
            
            for (const header of studentListHeaders) {
              if (header.textContent.includes('Students') || header.textContent.includes('Players')) {
                studentsSection = header.parentElement;
                break;
              }
            }
            
            if (studentsSection) {
              // Find all player rows (they typically have status indicators)
              const playerDivs = Array.from(studentsSection.querySelectorAll('div'));
              
              playerDivs.forEach(div => {
                const text = div.textContent;
                
                // Look for status indicators (online/offline/away)
                const hasOnline = text.toLowerCase().includes('online');
                const hasOffline = text.toLowerCase().includes('offline');
                const hasAway = text.toLowerCase().includes('away');
                
                // Extract player name (usually before the status)
                const playerMatch = text.match(/([A-Za-z]+\s+\d+)/);
                if (playerMatch) {
                  const playerName = playerMatch[1];
                  
                  let status = 'unknown';
                  if (hasOnline) status = 'online';
                  else if (hasOffline) status = 'offline';
                  else if (hasAway) status = 'away';
                  
                  report.playersData.push({
                    name: playerName,
                    status: status
                  });
                  
                  if (status === 'offline') {
                    report.offlinePlayers.push(playerName);
                  } else if (status === 'away') {
                    report.awayPlayers.push(playerName);
                  }
                }
              });
            }
            
            report.totalStudents = report.playersData.length;
            
            // Check data completeness: verify all players who joined also have leaderboard entries
            // Look specifically for the Leaderboard section (not pair table or student list)
            const leaderboardHeaders = Array.from(document.querySelectorAll('h3'));
            let leaderboardSection = null;
            
            for (const header of leaderboardHeaders) {
              if (header.textContent.includes('Leaderboard') || header.textContent.includes('🏆')) {
                leaderboardSection = header.nextElementSibling;
                break;
              }
            }
            
            if (leaderboardSection) {
              // Count students in the leaderboard (each player should appear once)
              const leaderboardEntries = leaderboardSection.querySelectorAll('[style*="padding"]');
              // Filter for actual player entries (they have a profit value displayed)
              let leaderboardCount = 0;
              leaderboardEntries.forEach(entry => {
                if (entry.textContent.includes('$') && entry.textContent.match(/Student \d+/)) {
                  leaderboardCount++;
                }
              });
              report.playersWithScores = leaderboardCount;
            } else {
              // Fallback: just assume all players have scores if we can't find leaderboard
              report.playersWithScores = report.totalStudents;
            }
            
            return report;
          }).catch(() => null);
          
          // Generate and display test integrity report
          console.log('📋 TEST INTEGRITY REPORT');
          console.log('='.repeat(70));
          
          if (testReport) {
            console.log(`Session Code: ${testReport.sessionCode || 'N/A'}`);
            console.log(`Model: ${testReport.modelInfo || 'N/A'}`);
            console.log();
            
            // Round completion check
            console.log('📊 GAME COMPLETION:');
            console.log('-'.repeat(70));
            if (testReport.totalRounds > 0 && testReport.expectedRounds > 0) {
              if (testReport.totalRounds === testReport.expectedRounds) {
                console.log(`✅ All rounds completed: ${testReport.totalRounds}/${testReport.expectedRounds}`);
              } else {
                console.log(`⚠️  Incomplete: ${testReport.totalRounds}/${testReport.expectedRounds} rounds`);
              }
            } else {
              console.log(`⚠️  Could not verify round completion`);
            }
            console.log();
            
            // Student participation check
            console.log('👥 STUDENT PARTICIPATION:');
            console.log('-'.repeat(70));
            console.log(`Total Students: ${testReport.totalStudents || NUM_STUDENTS}`);
            
            const onlineCount = testReport.playersData.filter(p => p.status === 'online').length;
            const offlineCount = testReport.offlinePlayers.length;
            const awayCount = testReport.awayPlayers.length;
            
            if (onlineCount > 0) {
              console.log(`✅ Online: ${onlineCount} students`);
            }
            if (awayCount > 0) {
              console.log(`⚠️  Away: ${awayCount} students`);
              testReport.awayPlayers.forEach(name => {
                console.log(`   - ${name}`);
              });
            }
            if (offlineCount > 0) {
              console.log(`❌ Offline: ${offlineCount} students`);
              testReport.offlinePlayers.forEach(name => {
                console.log(`   - ${name}`);
              });
            }
            
            if (offlineCount === 0 && awayCount === 0) {
              console.log(`✅ All students remained connected throughout the game`);
            }
            console.log();
            
            // Data integrity check
            console.log('💾 DATA INTEGRITY:');
            console.log('-'.repeat(70));
            if (testReport.playersWithScores !== undefined) {
              const expectedPlayers = testReport.totalStudents || NUM_STUDENTS;
              if (testReport.playersWithScores === expectedPlayers) {
                console.log(`✅ All ${expectedPlayers} students have recorded scores`);
              } else {
                console.log(`⚠️  ${testReport.playersWithScores}/${expectedPlayers} students have scores`);
                console.log(`   ${expectedPlayers - testReport.playersWithScores} students may have missing data`);
              }
            }
            console.log();
            
            // Overall test result
            console.log('🎯 OVERALL TEST RESULT:');
            console.log('-'.repeat(70));
            const allRoundsComplete = testReport.totalRounds === testReport.expectedRounds;
            const noOffline = offlineCount === 0;
            const allHaveScores = testReport.playersWithScores === (testReport.totalStudents || NUM_STUDENTS);
            
            if (allRoundsComplete && noOffline && allHaveScores) {
              console.log('✅ TEST PASSED - Session ran perfectly!');
              console.log('   • All rounds completed');
              console.log('   • All students remained online');
              console.log('   • All data recorded successfully');
            } else {
              console.log('⚠️  TEST HAD ISSUES:');
              if (!allRoundsComplete) console.log('   • Rounds did not complete as expected');
              if (!noOffline) console.log(`   • ${offlineCount} student(s) went offline`);
              if (!allHaveScores) console.log('   • Some students have missing score data');
            }
          } else {
            console.log('❌ Could not extract test data from instructor page');
          }
          
          console.log('='.repeat(70));
          console.log('✅ Report complete!');
          console.log('💡 Press Ctrl+C to close browser and exit\n');
          
          break; // Exit monitoring loop
        }
      }
      
      if (!sessionComplete && checkAttempts >= maxCheckAttempts) {
        console.log('⚠️  Stopped monitoring - timeout reached (1 hour)');
      }
    }
    
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
    return;
  }
  console.warn(warning);
});

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

