// server.js — CRM Booking Scraper API (Express + Puppeteer)

console.log("🚀 Starting server initialization...");

import express from "express";
console.log("✅ Express imported");

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Use stealth plugin to bypass anti-scraping detection
// This plugin handles navigator.webdriver, chrome runtime, plugins, and many other detection vectors
puppeteer.use(StealthPlugin());
console.log("✅ Puppeteer-extra with stealth plugin imported");

import fs from "fs";
import path from "path";
console.log("✅ Core modules imported");

const app = express();
app.use(express.json({ limit: "1mb" }));
console.log("✅ Express app created and middleware configured");

// Setup logging to file
const LOG_DIR = "/tmp";
const LOG_FILE = path.join(LOG_DIR, "booking-server.log");

// Helper to log to both console and file
const logToFile = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message); // Always log to console first
  // Try to log to file, but don't crash if it fails
  try {
    // Ensure LOG_DIR exists
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    // Silently fail - don't crash the server if file logging fails
    console.error(`Failed to write to log file: ${err.message}`);
  }
};

// Constants
const TIMEOUT = 10000;
const CUSTOMER_NAME = "Fitpass One"; // Fixed for now, will be parameterized later
const PLAN_SELECTOR = "div:nth-of-type(32)"; // Fitpass Check-in plan

// Utilities
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Global click counter for debugging
let clickCounter = 0;
const clickLog = [];

// Helper function to log clicks
const logClick = (location, selector, method) => {
  clickCounter++;
  const logEntry = {
    count: clickCounter,
    timestamp: new Date().toISOString(),
    location,
    selector: selector?.substring(0, 100) || 'unknown',
    method
  };
  clickLog.push(logEntry);
  const logMessage = `[CLICK #${clickCounter}] ${location} - Method: ${method}, Selector: ${selector?.substring(0, 50) || 'unknown'}`;
  logToFile(logMessage);
};

// Helper function to wait for and click an element using Puppeteer
async function clickElement(page, selectors, options = {}) {
  const { timeout = TIMEOUT, offset, debug = false, location = 'unknown' } = options;
  const dlog = (...a) => debug && console.log("[CLICK DEBUG]", ...a);
  
  // Separate selectors into standard CSS and Puppeteer Locator API selectors
  const validSelectors = [];
  const locatorApiSelectors = [];
  
  for (const sel of selectors) {
    if (sel.startsWith('::-p-') || sel.startsWith(':scope >>>')) {
      locatorApiSelectors.push(sel);
    } else {
      validSelectors.push(sel);
    }
  }
  
  // First try standard selectors
  let lastError = null;
  let clicked = false; // Track if we've already clicked to prevent double-clicks
  for (const selector of validSelectors) {
    if (clicked) break; // Stop if we already clicked
    try {
      dlog(`Trying standard selector: ${selector}`);
      // Wait for element first
      await page.waitForSelector(selector, { visible: true, timeout: timeout / 2 }).catch(() => {
        dlog(`Selector ${selector} not found`);
      });
      
        const element = await page.$(selector);
        if (element) {
        const isVisible = await element.isVisible().catch(() => false);
        dlog(`Element found, visible: ${isVisible}`);
        
        if (isVisible) {
          logClick(location, selector, offset ? `Puppeteer.click(offset)` : `Puppeteer.click()`);
          if (offset) {
            await element.click({ offset });
          } else {
            await element.click();
          }
          clicked = true; // Mark as clicked
          await sleep(100); // Optimized: reduced from 200ms
          dlog(`Successfully clicked using selector: ${selector}`);
          return true;
        }
        }
      } catch (e) {
      dlog(`Selector ${selector} failed: ${e?.message}`);
      lastError = e;
        // Continue to next selector
      }
    }
  
  // If standard selectors failed, try Puppeteer Locator API selectors via page.evaluate
  if (locatorApiSelectors.length > 0 && !clicked) {
    dlog(`Standard selectors failed, trying Puppeteer Locator API selectors via page.evaluate...`);
    const clickedResult = await page.evaluate((selectors, location) => {
      let clickedOnce = false; // Prevent multiple clicks
      let clickInfo = null;
      for (const selector of selectors) {
        if (clickedOnce) break; // Stop if we already clicked
        try {
          // Extract text/aria-label from ::-p-aria selector
          if (selector.includes('::-p-aria')) {
            const match = selector.match(/::\-p\-aria\(([^)]+)\)/);
            if (match) {
              const text = match[1];
              // Try to find by aria-label or text content
              const element = document.querySelector(`[aria-label="${text}"], [aria-label*="${text}"]`) ||
                            Array.from(document.querySelectorAll('*')).find(el => el.textContent?.includes(text));
              if (element && element.offsetParent !== null) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                console.log(`[BROWSER CLICK] ${location} - Clicking via ::-p-aria("${text}")`);
                element.click();
                clickedOnce = true;
                clickInfo = { method: 'element.click()', selector: `::-p-aria(${text})` };
                return { clicked: true, info: clickInfo };
              }
            }
          }
          
          // Extract text from ::-p-text selector
          if (selector.includes('::-p-text')) {
            const match = selector.match(/::\-p\-text\((.*?)\)/);
            if (match) {
              const text = match[1];
              // Find element containing this exact text
              const allElements = Array.from(document.querySelectorAll('*'));
              const element = allElements.find(el => {
                if (el.offsetParent === null) return false;
                const elText = (el.textContent || '').trim();
                return elText === text || elText.includes(text);
              });
              if (element && element.offsetParent !== null) {
                console.log(`[BROWSER CLICK] ${location} - Clicking via ::-p-text("${text}")`);
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Only click once - use element.click() only
                element.click();
                clickedOnce = true;
                clickInfo = { method: 'element.click()', selector: `::-p-text(${text})` };
                return { clicked: true, info: clickInfo };
              }
            }
          }
          
          // Extract XPath from ::-p-xpath selector
          if (selector.includes('::-p-xpath')) {
            const match = selector.match(/::\-p\-xpath\((.*?)\)/);
            if (match) {
              const xpath = match[1];
              try {
                const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                const element = result.singleNodeValue;
                if (element && element.offsetParent !== null) {
                  console.log(`[BROWSER CLICK] ${location} - Clicking via XPath`);
                  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  // Only click once - use element.click() only (removed duplicate mouse events)
                  element.click();
                  clickedOnce = true;
                  clickInfo = { method: 'element.click()', selector: `::-p-xpath(${xpath.substring(0, 50)})` };
                  return { clicked: true, info: clickInfo };
                } else {
                  console.log(`[BROWSER] XPath element found but not visible`);
                }
              } catch (e) {
                console.log(`[BROWSER] XPath evaluation failed: ${e?.message}`);
              }
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      return { clicked: clickedOnce, info: clickInfo };
    }, locatorApiSelectors, location).catch(() => ({ clicked: false, info: null }));
    
    const clicked = clickedResult?.clicked || false;
    if (clicked && clickedResult?.info) {
      logClick(location, clickedResult.info.selector, clickedResult.info.method);
    }
    
    if (clicked) {
      dlog("Successfully clicked using page.evaluate with Locator API selectors");
    await sleep(200);
    return true;
    }
  }
  
  throw new Error(`Could not click element with selectors: ${selectors.join(', ')}. Last error: ${lastError?.message || 'All selectors failed'}`);
}

// Helper function to fill an input using Puppeteer (fast fill for email/password)
async function fillInput(page, selectors, value, options = {}) {
  const { timeout = TIMEOUT, waitAfterClick = 200, debug = false } = options;
  const dlog = (...a) => debug && console.log("[FILL DEBUG]", ...a);
  
  // Try each selector individually
    for (const selector of selectors) {
      try {
      dlog(`Trying selector: ${selector}`);
      // Wait for element to be visible
      await page.waitForSelector(selector, { visible: true, timeout: timeout / 2 }).catch(() => {
        dlog(`Selector ${selector} not found with waitForSelector`);
      });
      
        const element = await page.$(selector);
        if (element) {
        const isVisible = await element.isVisible().catch(() => false);
        dlog(`Element found, visible: ${isVisible}`);
        
        if (isVisible) {
          // Set value directly - INSTANT, NO TYPING, NO ANIMATION
          dlog(`Setting value instantly (direct assignment, no typing): ${value}`);
          
          // Use element.evaluate - use the element we already found
          await element.evaluate((el, val) => {
            // Focus the element first
            el.focus();
            
            // Get native value setter to bypass React/Vue/any framework
            const nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            
            // Clear React value tracker first if it exists
            if (el._valueTracker) {
              el._valueTracker.setValue('');
            }
            
            // Set value using native setter - this completely bypasses typing
            nativeValueSetter.call(el, val);
            
            // Also set directly as fallback
            el.value = val;
            
            // For React controlled components - update the internal tracker AFTER setting value
            if (el._valueTracker) {
              el._valueTracker.setValue(val);
            }
            
            // Now trigger events - value is already set, so no typing animation
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            Object.defineProperty(inputEvent, 'target', { value: el, enumerable: true, writable: false });
            el.dispatchEvent(inputEvent);
            
            const changeEvent = new Event('change', { bubbles: true, cancelable: true });
            Object.defineProperty(changeEvent, 'target', { value: el, enumerable: true, writable: false });
            el.dispatchEvent(changeEvent);
            
            // Also trigger focus/blur to ensure form validation works
            el.dispatchEvent(new Event('focus', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, value);
          
          dlog("Successfully set value instantly (direct assignment, no typing animation)");
          return true;
        }
        }
      } catch (e) {
      dlog(`Selector ${selector} failed: ${e?.message}`);
        // Continue to next selector
      continue;
      }
    }
  
    throw new Error(`Could not fill input with selectors: ${selectors.join(', ')}`);
}

// Main booking function
async function bookClass({
  email,
  password,
  gymName,
  targetDate,
  targetTime,
  DEBUG = false
}) {
  // IMPORTANT: Clean up environment variables FIRST, before anything else
  // This prevents Puppeteer from detecting X11/D-Bus on Railway/containers
  const displayBefore = process.env.DISPLAY || 'not set';
  delete process.env.DISPLAY;
  delete process.env.XAUTHORITY;
  delete process.env.DBUS_SESSION_BUS_ADDRESS;
  delete process.env.DBUS_SYSTEM_BUS_ADDRESS;
  
  // Reset click counter and log for each booking attempt
  clickCounter = 0;
  clickLog.length = 0;
  logToFile(`[BOOKING START] Starting booking process. Click counter reset to 0.`);
  
  // Store screenshots for debugging
  const screenshots = [];
  
  const dlog = (...a) => {
    console.log(...a);
    if (DEBUG) {
      const message = `[DEBUG] ${a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')}`;
      logToFile(message);
    }
  };
  
  dlog(`Environment cleanup: DISPLAY was ${displayBefore}, now deleted`);
  
  // Allow showing browser window for local testing
  // Set HEADLESS=false or pass DEBUG=true to see the browser
  // For Railway testing, you can also set SHOW_BROWSER=true in environment variables
  // IMPORTANT: Always use headless mode in production/Railway (NODE_ENV=production)
  const isProduction = process.env.NODE_ENV === 'production';
  const showBrowser = !isProduction && (process.env.SHOW_BROWSER === 'true' || process.env.HEADLESS === 'false' || DEBUG);
  const headless = !showBrowser;
  
  // Determine Chromium executable path
  // Use Puppeteer's bundled Chromium (best headless support, no X11 dependencies)
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    // Use Puppeteer's bundled Chromium - it handles headless mode properly
    executablePath = undefined; // undefined means use bundled Chromium
    dlog(`Using Puppeteer's bundled Chromium (best headless support)`);
  } else {
    dlog(`Using custom Chromium path: ${executablePath}`);
  }

  // Browser launch args - optimized for Railway/containerized environments
  // Force headless backend and prevent X11 detection
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu", // Always disable GPU in containers
    "--disable-accelerated-2d-canvas",
    "--no-first-run",
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process,VizDisplayCompositor",
    "--disable-site-isolation-trials",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-features=TranslateUI",
    "--disable-hang-monitor",
    "--disable-ipc-flooding-protection",
    "--disable-notifications",
    "--disable-prompt-on-repost",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-pings",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--disable-gpu-compositing",
    "--disable-gpu-sandbox",
    "--disable-oop-rasterization",
    "--disable-partial-raster",
    "--disable-skia-runtime-opts",
    "--disable-system-font-check",
    "--disable-threaded-animation",
    "--disable-threaded-scrolling",
    "--disable-checker-imaging",
    "--disable-image-animation-resync",
    "--run-all-compositor-stages-before-draw",
    "--disable-background-drawing",
    "--disable-client-side-phishing-detection",
    "--disable-popup-blocking",
    "--disable-translate",
    "--safebrowsing-disable-auto-update",
    "--enable-automation",
    "--password-store=basic",
    "--use-mock-keychain",
    "--hide-scrollbars",
    "--ignore-certificate-errors",
    "--ignore-ssl-errors",
    "--ignore-certificate-errors-spki-list",
    // Critical flags for container compatibility - prevent X11 detection
    "--single-process",  // Run in single process mode (helps in containers)
    "--no-zygote",       // Disable zygote process (helps in containers)
    // Force software rendering to avoid X11/GPU dependencies
    "--use-gl=swiftshader",  // Use SwiftShader software rendering (no X11 needed)
  ];

  // Always add headless flag for production/headless mode
  if (headless) {
    launchArgs.push("--headless=new");
  }

  dlog(`Launching browser with executablePath: ${executablePath || 'default'}`);
  dlog(`Headless mode: ${headless} (showBrowser: ${showBrowser})`);
  dlog(`Launch args: ${launchArgs.join(' ')}`);
  
  // Use 'new' headless mode for all environments - it doesn't require X11
  // The 'new' headless mode is more reliable in containers and doesn't try to detect X11
  let browser;
  const headlessMode = headless ? 'new' : false;
  
  try {
    dlog(`Launching browser with headless=${headlessMode}...`);
    
    // Final cleanup - ensure X11/D-Bus vars are completely removed before launch
    // DO NOT set them to empty strings - Chromium can detect empty strings
    // Just delete them completely
    delete process.env.DISPLAY;
    delete process.env.XAUTHORITY;
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
    delete process.env.DBUS_SYSTEM_BUS_ADDRESS;
    
    // Add stealth arguments to bypass anti-scraping detection
    // These are CRITICAL for bypassing Kenko's anti-scraping measures
    const stealthArgs = [
      '--disable-blink-features=AutomationControlled', // Most important - removes automation flag!
      '--exclude-switches=enable-automation', // Remove automation flag from command line
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-features=VizDisplayCompositor',
    ];
    
    browser = await puppeteer.launch({
      headless: headlessMode,
      executablePath: executablePath,
      args: [...launchArgs, ...stealthArgs],
      defaultViewport: { width: 1920, height: 1080 }, // Realistic viewport
      timeout: 120000,
      ignoreHTTPSErrors: true,
      // Additional options for better container compatibility
      protocolTimeout: 120000
    });
    
    // Restore original env (though we'll keep them deleted)
    // Don't restore DISPLAY/XAUTHORITY/DBUS vars
    
    dlog(`✓ Browser launched successfully with headless=${headlessMode}`);
  } catch (launchError) {
    dlog(`❌ Browser launch failed`);
    dlog(`Error: ${launchError?.message}`);
    dlog(`Error details: ${JSON.stringify(launchError, null, 2)}`);
    const errorMsg = launchError?.message || String(launchError);
    throw new Error(`Failed to launch the browser process! ${errorMsg}\n\nTROUBLESHOOTING: https://pptr.dev/troubleshooting`);
  }

  const page = await browser.newPage();
  
  // CRITICAL: puppeteer-extra-plugin-stealth is already applied via puppeteer.use(StealthPlugin())
  // This plugin handles most anti-scraping detection automatically
  dlog("Stealth plugin is active (puppeteer-extra-plugin-stealth)");
  
  // CRITICAL: Set User-Agent to match local Chrome EXACTLY (Chrome 131 on macOS)
  // Railway needs to look exactly like a local Chrome browser, not headless
  // The API checks User-Agent and may reject headless browsers or different versions
  const realChromeUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  await page.setUserAgent(realChromeUA);
  dlog(`Set User-Agent to match local Chrome exactly: ${realChromeUA}`);
  logToFile(`[BROWSER] User-Agent set to match local: ${realChromeUA}`);
  
  // Set realistic viewport (stealth plugin handles other properties)
  await page.setViewport({
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
  });
  
  // Set extra headers to match local Chrome exactly
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-User': '?1',
    'Sec-Fetch-Dest': 'document',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-platform-version': '"14.1.0"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
  });
  
  // Override navigator properties to match local Chrome (not headless)
  await page.evaluateOnNewDocument(() => {
    // Override platform to match local
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
    });
    
    // Override hardwareConcurrency (headless often shows different values)
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8, // Common Mac value
    });
    
    // Override deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 8,
    });
    
    // Override webdriver to ensure it's undefined (stealth plugin should do this, but double-check)
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });
  
  // Override permissions (for both domains)
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('https://partners.gokenko.com', [
    'geolocation',
    'notifications',
  ]);
  await context.overridePermissions('https://kenko.app', [
    'geolocation',
    'notifications',
  ]);
  
  dlog("✓ Page configured with stealth plugin");
  
  // Small delay to ensure page is stable
  await sleep(500);
  
  // Helper to take screenshot and store as base64 (must be after page is created)
  // Always saves screenshots for debugging, not just when DEBUG=true
  const takeScreenshot = async (name) => {
    try {
      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot-${name}-${timestamp}.png`;
      
      screenshots.push({ name, data: `data:image/png;base64,${screenshot}`, filename });
      dlog(`Screenshot captured: ${name} (${filename})`);
      
      // Also save to /tmp directory for Railway debugging (accessible via web endpoint)
      try {
        const screenshotPath = path.join(LOG_DIR, filename);
        const screenshotBuffer = Buffer.from(screenshot, 'base64');
        fs.writeFileSync(screenshotPath, screenshotBuffer);
        dlog(`Screenshot saved to: ${screenshotPath}`);
      } catch (fileError) {
        // Silently fail if we can't write to /tmp (not critical)
        dlog(`Could not save screenshot to file: ${fileError?.message}`);
      }
      
      return screenshot;
    } catch (e) {
      dlog(`Could not take screenshot ${name}: ${e?.message}`);
      return null;
    }
  };
  page.setDefaultTimeout(TIMEOUT);

  // Log page events
  page.on("console", (msg) => logToFile(`[PAGE] ${msg.text()}`));
  page.on("requestfailed", (r) => logToFile(`[REQ FAIL] ${r.url()} ${r.failure()?.errorText}`));

  const step = async (label, fn) => {
    logToFile(`➡️ ${label}`);
    const t = Date.now();
    try {
      const r = await fn();
      logToFile(`✅ ${label} ${Date.now() - t}ms`);
      return r;
    } catch (e) {
      logToFile(`❌ ${label} ${e?.message || e}`);
      throw e;
    }
  };

  try {
    // Step 1: Navigate to login page
    await step("Navigate to login", async () => {
      await page.setViewport({ width: 1920, height: 1080 }); // Use realistic viewport
      dlog("Navigating to login page");
      await page.goto("https://partners.gokenko.com/login", { 
        waitUntil: "domcontentloaded",
        timeout: 30000 
      });
      dlog("Page loaded");
      
      // Verify stealth is working - check if webdriver is hidden
      const webdriverCheck = await page.evaluate(() => {
        return {
          webdriver: navigator.webdriver,
          userAgent: navigator.userAgent,
          plugins: navigator.plugins.length,
          languages: navigator.languages,
          chrome: !!window.chrome
        };
      });
      dlog(`Stealth check: webdriver=${webdriverCheck.webdriver}, chrome=${webdriverCheck.chrome}, plugins=${webdriverCheck.plugins}`);
      logToFile(`[STEALTH] webdriver=${webdriverCheck.webdriver}, chrome=${webdriverCheck.chrome}, plugins=${webdriverCheck.plugins}`);
      
      await sleep(1000); // Wait for page to fully render and scripts to load
    });

    // Step 2: Enter gym location (it's a text input, not a dropdown)
    await step("Enter gym location", async () => {
      // Wait for the input field to be visible - use the same selector as reference
      // Reference code uses: input[placeholder*="Search for your business"]
      dlog("Waiting for gym name input field");
      
      const inputSelectors = [
        'input[placeholder*="Search for your business"]', // Same as reference
        'input[placeholder*="search for your business"]',
        'input[placeholder*="Search"]',
        'input[placeholder*="search"]',
        '#radix-\\:r2\\: input',  // Input inside the radix component
        '#radix-\\:r2\\:',         // The radix component itself
        'input[type="text"]',
        'input[type="search"]',
        '[id*="radix"] input',
        'input[role="combobox"]',
        'input[role="searchbox"]'
      ];
      
      // Try waiting for each selector (like reference does)
      let inputElement = null;
      let foundSelector = null;
      
      for (const selector of inputSelectors) {
        try {
          dlog(`Waiting for input with selector: ${selector}`);
          await page.waitForSelector(selector, { visible: true, timeout: 2000 });
          const elements = await page.$$(selector);
          
          for (const element of elements) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              inputElement = element;
              foundSelector = selector;
              dlog(`Found visible input with selector: ${selector}`);
              break;
            }
          }
          
          if (inputElement) break;
        } catch (e) {
          dlog(`Selector ${selector} not found: ${e?.message}`);
          continue;
        }
      }
      
      // If no input found with waitForSelector, try direct search
      if (!inputElement) {
        dlog("Direct wait didn't find input, searching all inputs on page");
        const allInputs = await page.$$('input');
        for (const input of allInputs) {
          try {
            const isVisible = await input.isVisible().catch(() => false);
            const tagName = await input.evaluate(el => el.tagName).catch(() => '');
            if (isVisible && tagName === 'INPUT') {
              inputElement = input;
              dlog("Found input by searching all inputs");
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      if (!inputElement) {
        if (DEBUG) {
          try {
            await page.screenshot({ path: '/tmp/gym-input-debug.png', fullPage: true });
            dlog("Screenshot saved to /tmp/gym-input-debug.png");
          } catch (e) {
            dlog(`Could not take screenshot: ${e?.message}`);
          }
        }
        throw new Error(`Could not find gym name input field. Tried selectors: ${inputSelectors.join(', ')}`);
      }
      
      // Click and fill the input - MUST type character by character for autocomplete to work
      // Use page.type() like in the reference code
      dlog("Clicking on gym name input field");
      
      // Set up network monitoring AND response interception for autocomplete API calls
      const autocompleteRequests = [];
      const autocompleteResponses = [];
      
      const requestHandler = (request) => {
        const url = request.url();
        if (url.includes('search') || url.includes('autocomplete') || url.includes('gym') || url.includes('business') || url.includes('location') || url.includes('partner')) {
          dlog(`[NETWORK] Autocomplete request detected: ${url.substring(0, 150)}`);
          autocompleteRequests.push({
            url: url,
            method: request.method(),
            postData: request.postData(),
            timestamp: Date.now()
          });
        }
      };
      
      const responseHandler = async (response) => {
        const url = response.url();
        if (url.includes('search') || url.includes('autocomplete') || url.includes('gym') || url.includes('business') || url.includes('location') || url.includes('partner')) {
          try {
            const responseData = await response.json().catch(() => null);
            dlog(`[NETWORK] Autocomplete response: ${url.substring(0, 150)}`);
            logToFile(`[NETWORK] Response data: ${JSON.stringify(responseData).substring(0, 500)}`);
            autocompleteResponses.push({
              url: url,
              data: responseData,
              timestamp: Date.now()
            });
          } catch (e) {
            // Response might not be JSON
          }
        }
      };
      
      page.on('request', requestHandler);
      page.on('response', responseHandler);
      
      const gymNameLower = gymName.toLowerCase();
      dlog(`Typing gym name character by character: ${gymNameLower}`);
      
      // Type each character individually with proper event triggering for autocomplete
      // Railway needs slower typing and explicit event dispatching to trigger autocomplete
      if (foundSelector) {
        dlog(`Using found selector for typing: ${foundSelector}`);
        // Clear any existing text first
        await page.click(foundSelector, { clickCount: 3 }); // Triple click to select all
        await page.keyboard.press('Backspace');
        await sleep(100); // Optimized: reduced from 200ms
        
        // Focus the input
        await page.focus(foundSelector);
        await sleep(100); // Optimized: reduced from 200ms
        
        // CRITICAL: Type character by character using ONLY keyboard.type() to trigger autocomplete
        // Railway needs slower, more realistic typing - don't set value directly, let keyboard.type() do it
        dlog(`Typing "${gymNameLower}" character by character (Railway-optimized, keyboard only)...`);
        
        // Ensure input is focused and ready - click first to ensure it's active
        await page.click(foundSelector);
        await sleep(100); // Optimized: reduced from 200ms
        await page.focus(foundSelector);
        await sleep(150); // Optimized: reduced from 300ms
        
        // Trigger focus event to ensure autocomplete is listening
        await page.evaluate((selector) => {
          const input = document.querySelector(selector);
          if (input) {
            input.focus();
            input.dispatchEvent(new Event('focus', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
            input.dispatchEvent(new Event('mousedown', { bubbles: true }));
            input.dispatchEvent(new Event('mouseup', { bubbles: true }));
          }
        }, foundSelector);
        await sleep(150); // Optimized: reduced from 300ms
        
        // CRITICAL: Type each character with FULL event sequence (keydown -> keypress -> input -> keyup)
        // This simulates REAL human typing - Railway needs this level of realism to trigger autocomplete
        dlog(`Typing "${gymNameLower}" with full event sequence (Railway-optimized, ultra-realistic)...`);
        
        for (let i = 0; i < gymNameLower.length; i++) {
          const char = gymNameLower[i];
          const charCode = char.charCodeAt(0);
          
          // Generate random delay between characters (optimized for maximum speed)
          // Base delay: 50-100ms (very fast typing)
          const baseDelay = 50 + Math.random() * 50;
          const occasionalPause = Math.random() < 0.05 ? 100 : 0; // 5% chance of longer pause
          const delay = baseDelay + occasionalPause;
          
          dlog(`Typing character ${i+1}/${gymNameLower.length}: "${char}" (delay: ${Math.round(delay)}ms)`);
          
          // FULL EVENT SEQUENCE for each character (like a real human):
          // 1. KeyDown event
          await page.evaluate((selector, char, charCode) => {
            const input = document.querySelector(selector);
            if (input) {
              const keyDownEvent = new KeyboardEvent('keydown', {
                key: char,
                code: char.match(/[a-z]/i) ? `Key${char.toUpperCase()}` : char,
                keyCode: charCode,
                which: charCode,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(keyDownEvent);
            }
          }, foundSelector, char, charCode);
          await sleep(20 + Math.random() * 30); // Optimized: reduced delay
          
          // 2. KeyPress event
          await page.evaluate((selector, char, charCode) => {
            const input = document.querySelector(selector);
            if (input) {
              const keyPressEvent = new KeyboardEvent('keypress', {
                key: char,
                code: char.match(/[a-z]/i) ? `Key${char.toUpperCase()}` : char,
                keyCode: charCode,
                which: charCode,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(keyPressEvent);
            }
          }, foundSelector, char, charCode);
          await sleep(15 + Math.random() * 15); // Optimized: reduced delay
          
          // 3. Actually type the character using keyboard (this sets the value)
          await page.keyboard.type(char, { delay: 0 }); // No delay here, we control timing manually
          
          // 4. Input event (fires when value changes)
          await page.evaluate((selector) => {
            const input = document.querySelector(selector);
            if (input) {
              const inputEvent = new Event('input', { bubbles: true, cancelable: true });
              Object.defineProperty(inputEvent, 'target', { value: input, enumerable: true });
              input.dispatchEvent(inputEvent);
            }
          }, foundSelector);
          await sleep(20 + Math.random() * 30); // Optimized: reduced delay
          
          // 5. KeyUp event
          await page.evaluate((selector, char, charCode) => {
            const input = document.querySelector(selector);
            if (input) {
              const keyUpEvent = new KeyboardEvent('keyup', {
                key: char,
                code: char.match(/[a-z]/i) ? `Key${char.toUpperCase()}` : char,
                keyCode: charCode,
                which: charCode,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(keyUpEvent);
            }
          }, foundSelector, char, charCode);
          
          // Wait between characters - Railway needs time for autocomplete to process
          // Optimized for speed: minimal wait between characters
          const waitTime = i < 3 ? 150 + Math.random() * 100 : 100 + Math.random() * 100;
          await sleep(waitTime);
        }
        
        // Final input event to ensure autocomplete fires one more time
        await page.evaluate((selector) => {
          const input = document.querySelector(selector);
          if (input) {
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            Object.defineProperty(inputEvent, 'target', { value: input, enumerable: true });
            input.dispatchEvent(inputEvent);
            
            // Also trigger compositionend (for autocomplete systems that listen to it)
            const compositionEndEvent = new CompositionEvent('compositionend', { bubbles: true });
            input.dispatchEvent(compositionEndEvent);
          }
        }, foundSelector);
        await sleep(100); // Optimized: minimal wait after typing
        
        dlog("✓ Finished typing with keyboard.type() only");
        
        // Log network requests detected
        if (autocompleteRequests.length > 0) {
          logToFile(`[NETWORK] Detected ${autocompleteRequests.length} autocomplete requests during typing`);
          autocompleteRequests.forEach((req, i) => {
            logToFile(`[NETWORK] Request ${i+1}: ${req.url.substring(0, 100)}`);
          });
        } else {
          logToFile(`[NETWORK] WARNING: No autocomplete API requests detected - autocomplete may not be triggering`);
        }
        
        // Remove network listener (Puppeteer uses off() instead of removeListener())
        page.off('request', requestHandler);
        
        // Wait exactly 1 second after typing before clicking studio (optimized)
        dlog("Waiting 1 second after typing before clicking studio...");
        await sleep(1000);
      } else {
        // Fallback: try to use the element directly
        dlog("Using element-based typing as fallback");
        await inputElement.click({ clickCount: 3 }); // Triple click to select all
        await page.keyboard.press('Backspace');
        await sleep(100); // Optimized: reduced from 200ms
        
        // Focus the input
        await inputElement.focus();
        await sleep(100); // Optimized: reduced from 200ms
        
        // CRITICAL: Type character by character with FULL event sequence (same as main method)
        dlog(`Typing "${gymNameLower}" with full event sequence (Railway-optimized, ultra-realistic, fallback)...`);
        
        // Ensure input is focused and ready - click first to ensure it's active
        await inputElement.click();
        await sleep(100); // Optimized: reduced from 200ms
        await inputElement.focus();
        await sleep(150); // Optimized: reduced from 300ms
        
        // Trigger focus event to ensure autocomplete is listening
        await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
          const input = inputs.find(i => i.offsetParent !== null);
          if (input) {
            input.focus();
            input.dispatchEvent(new Event('focus', { bubbles: true }));
            input.dispatchEvent(new Event('click', { bubbles: true }));
            input.dispatchEvent(new Event('mousedown', { bubbles: true }));
            input.dispatchEvent(new Event('mouseup', { bubbles: true }));
          }
        });
        await sleep(150); // Optimized: reduced from 300ms
        
        // Type each character with FULL event sequence (keydown -> keypress -> input -> keyup)
        for (let i = 0; i < gymNameLower.length; i++) {
          const char = gymNameLower[i];
          const charCode = char.charCodeAt(0);
          
          // Generate random delay between characters (optimized for maximum speed)
          const baseDelay = 50 + Math.random() * 50;
          const occasionalPause = Math.random() < 0.05 ? 100 : 0;
          const delay = baseDelay + occasionalPause;
          
          dlog(`[FALLBACK] Typing character ${i+1}/${gymNameLower.length}: "${char}" (delay: ${Math.round(delay)}ms)`);
          
          // FULL EVENT SEQUENCE for each character
          await page.evaluate((char, charCode) => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
            const input = inputs.find(i => i.offsetParent !== null);
            if (input) {
              const keyDownEvent = new KeyboardEvent('keydown', {
                key: char,
                code: char.match(/[a-z]/i) ? `Key${char.toUpperCase()}` : char,
                keyCode: charCode,
                which: charCode,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(keyDownEvent);
            }
          }, char, charCode);
          await sleep(50 + Math.random() * 50);
          
          await page.evaluate((char, charCode) => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
            const input = inputs.find(i => i.offsetParent !== null);
            if (input) {
              const keyPressEvent = new KeyboardEvent('keypress', {
                key: char,
                code: char.match(/[a-z]/i) ? `Key${char.toUpperCase()}` : char,
                keyCode: charCode,
                which: charCode,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(keyPressEvent);
            }
          }, char, charCode);
          await sleep(30 + Math.random() * 30);
          
          // Actually type the character
          await page.keyboard.type(char, { delay: 0 });
          
          // Input event
          await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
            const input = inputs.find(i => i.offsetParent !== null);
            if (input) {
              const inputEvent = new Event('input', { bubbles: true, cancelable: true });
              Object.defineProperty(inputEvent, 'target', { value: input, enumerable: true });
              input.dispatchEvent(inputEvent);
            }
          });
          await sleep(50 + Math.random() * 50);
          
          // KeyUp event
          await page.evaluate((char, charCode) => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
            const input = inputs.find(i => i.offsetParent !== null);
            if (input) {
              const keyUpEvent = new KeyboardEvent('keyup', {
                key: char,
                code: char.match(/[a-z]/i) ? `Key${char.toUpperCase()}` : char,
                keyCode: charCode,
                which: charCode,
                bubbles: true,
                cancelable: true
              });
              input.dispatchEvent(keyUpEvent);
            }
          }, char, charCode);
          
          // Wait between characters
          // Optimized for speed: minimal wait between characters
          const waitTime = i < 3 ? 150 + Math.random() * 100 : 100 + Math.random() * 100;
          await sleep(waitTime);
        }
        
        // Final input event
        await page.evaluate(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
          const input = inputs.find(i => i.offsetParent !== null);
          if (input) {
            const inputEvent = new Event('input', { bubbles: true, cancelable: true });
            Object.defineProperty(inputEvent, 'target', { value: input, enumerable: true });
            input.dispatchEvent(inputEvent);
            const compositionEndEvent = new CompositionEvent('compositionend', { bubbles: true });
            input.dispatchEvent(compositionEndEvent);
          }
        });
        await sleep(800);
        
        dlog("✓ Finished typing with keyboard.type() only (fallback)");
        
        // Additional wait after completing typing - Railway needs more time for autocomplete
        await sleep(3000); // Increased wait for Railway autocomplete to appear
      }
      
      // Verify the input value was set correctly
      const inputValue = await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        return input ? input.value : '';
      }, foundSelector || 'input[type="text"]').catch(() => '');
      
      dlog(`Input value after typing: "${inputValue}"`);
      if (inputValue !== gymNameLower) {
        dlog(`⚠ WARNING: Input value mismatch! Expected: "${gymNameLower}", Got: "${inputValue}"`);
        // Try to set it directly as fallback
        await page.evaluate((selector, value) => {
          const input = document.querySelector(selector);
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, foundSelector || 'input[type="text"]', gymNameLower);
        await sleep(2000);
      }
      
      // Wait for autocomplete/suggestion to appear - longer wait for Railway
      dlog("Waiting for gym suggestion/option to appear after typing");
      
      // Wait for network requests to complete (autocomplete might fetch from server)
      // Use a simple delay since Puppeteer doesn't have waitForLoadState
      await sleep(8000); // Increased wait for Railway - autocomplete needs time to fetch from server
      
      // Take screenshot after typing to see if dropdown appears
      await takeScreenshot('gym-after-typing');
      
      // Get page state to debug what's visible
      const pageState = await page.evaluate(() => {
        // Look for dropdown/autocomplete elements
        const dropdowns = Array.from(document.querySelectorAll('[role="listbox"], [role="menu"], [class*="dropdown"], [class*="autocomplete"], [class*="suggestion"], div[class*="radix"]'));
        const visibleDropdowns = dropdowns.filter(d => d.offsetParent !== null);
        
        // Get all text content that might contain gym name
        const allText = Array.from(document.querySelectorAll('*')).filter(el => {
          const text = el.textContent || '';
          return text.length > 0 && text.length < 100 && el.offsetParent !== null;
        }).map(el => ({
          tag: el.tagName,
          text: (el.textContent || '').substring(0, 50),
          classes: el.className || ''
        })).slice(0, 20);
        
        // Get input value
        const inputs = Array.from(document.querySelectorAll('input'));
        const inputValues = inputs.filter(i => i.offsetParent !== null).map(i => ({
          value: i.value || '',
          placeholder: i.placeholder || '',
          id: i.id || ''
        }));
        
        return {
          dropdownsFound: visibleDropdowns.length,
          dropdowns: visibleDropdowns.map(d => ({
            tag: d.tagName,
            classes: d.className || '',
            text: (d.textContent || '').substring(0, 100),
            visible: d.offsetParent !== null
          })),
          visibleText: allText,
          inputValues: inputValues
        };
      }).catch(() => ({ dropdownsFound: 0, dropdowns: [], visibleText: [], inputValues: [] }));
      
      dlog(`Page state after typing: ${JSON.stringify(pageState, null, 2)}`);
      
      // Check if gym suggestion is visible
      const gymSuggestionCheck = await page.evaluate((gymName) => {
        // Look for any visible element containing the gym name
        const allElements = Array.from(document.querySelectorAll('*'));
        const gymElements = allElements.filter(el => {
          if (el.offsetParent === null) return false;
          const text = (el.textContent || '').trim().toLowerCase();
          return text.includes(gymName.toLowerCase());
        });
        
        // Get input position
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
        const activeInput = inputs.find(i => i.offsetParent !== null && i.value);
        let inputRect = null;
        if (activeInput) {
          inputRect = activeInput.getBoundingClientRect();
        }
        
        // Check for elements below input that contain gym name
        const suggestionsBelow = gymElements.filter(el => {
          if (!inputRect) return false;
          const elRect = el.getBoundingClientRect();
          return elRect.top > inputRect.bottom && 
                 Math.abs(elRect.left - inputRect.left) < 100 &&
                 elRect.width > 50;
        });
        
        return {
          gymNameFound: gymElements.length > 0,
          gymElementCount: gymElements.length,
          suggestionsBelowInput: suggestionsBelow.length,
          inputPosition: inputRect ? { top: inputRect.top, bottom: inputRect.bottom, left: inputRect.left, width: inputRect.width } : null,
          suggestionPositions: suggestionsBelow.map(el => {
            const rect = el.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, text: (el.textContent || '').substring(0, 30) };
          })
        };
      }, gymName).catch(() => ({ gymNameFound: false, gymElementCount: 0, suggestionsBelowInput: 0 }));
      
      logToFile(`[GYM SELECTION] Gym suggestion check: Found=${gymSuggestionCheck.gymNameFound}, Count=${gymSuggestionCheck.gymElementCount}, Below input=${gymSuggestionCheck.suggestionsBelowInput}`);
      logToFile(`[GYM SELECTION] Input position: ${JSON.stringify(gymSuggestionCheck.inputPosition)}`);
      if (gymSuggestionCheck.suggestionPositions && gymSuggestionCheck.suggestionPositions.length > 0) {
        logToFile(`[GYM SELECTION] Suggestion positions: ${JSON.stringify(gymSuggestionCheck.suggestionPositions)}`);
      }
      dlog(`Gym suggestion check: ${JSON.stringify(gymSuggestionCheck, null, 2)}`);
      
      // IMPORTANT: Do NOT press Enter - it will exit the text box. Click directly below the input.
      // Using the proven working method: Puppeteer mouse click at coordinates below input
      logToFile("[GYM SELECTION] Clicking suggestion box below input field using Puppeteer mouse click...");
      dlog("[GYM SELECTION] Clicking suggestion box below input field using Puppeteer mouse click...");
      const clicksBeforeGym = clickCounter;
      
      // Wait for suggestion to appear - check multiple times for Railway
      let suggestionVisible = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        const checkResult = await page.evaluate((gymName) => {
          const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
          const activeInput = inputs.find(i => i.offsetParent !== null && i.value);
          if (!activeInput) return { visible: false };
          
          const inputRect = activeInput.getBoundingClientRect();
          const allElements = Array.from(document.querySelectorAll('*'));
          const suggestions = allElements.filter(el => {
            if (el.offsetParent === null) return false;
            const text = (el.textContent || '').trim().toLowerCase();
            const elRect = el.getBoundingClientRect();
            return text.includes(gymName.toLowerCase()) &&
                   elRect.top > inputRect.bottom &&
                   Math.abs(elRect.left - inputRect.left) < 100 &&
                   elRect.width > 50;
          });
          
          return { visible: suggestions.length > 0, count: suggestions.length };
        }, gymName).catch(() => ({ visible: false, count: 0 }));
        
        if (checkResult.visible) {
          suggestionVisible = true;
          logToFile(`[GYM SELECTION] Suggestion is visible (attempt ${attempt + 1})`);
          break;
        }
        
        logToFile(`[GYM SELECTION] Suggestion not yet visible (attempt ${attempt + 1}/5), waiting...`);
        await sleep(1000);
      }
      
      // Log network requests/responses for debugging
      if (autocompleteRequests.length > 0) {
        logToFile(`[NETWORK] Detected ${autocompleteRequests.length} autocomplete requests during typing`);
        autocompleteRequests.forEach((req, i) => {
          logToFile(`[NETWORK] Request ${i+1}: ${req.method} ${req.url.substring(0, 150)}`);
        });
      } else {
        logToFile(`[NETWORK] WARNING: No autocomplete API requests detected - autocomplete may not be triggering`);
      }
      
      if (autocompleteResponses.length > 0) {
        logToFile(`[NETWORK] Detected ${autocompleteResponses.length} autocomplete responses`);
        autocompleteResponses.forEach((resp, i) => {
          logToFile(`[NETWORK] Response ${i+1}: ${resp.url.substring(0, 150)}`);
          if (resp.data) {
            logToFile(`[NETWORK] Response data keys: ${Object.keys(resp.data).join(', ')}`);
          }
        });
      }
      
      // Remove network listeners
      page.off('request', requestHandler);
      page.off('response', responseHandler);
      
      if (!suggestionVisible) {
        logToFile(`[GYM SELECTION] WARNING: Suggestion not visible after waiting`);
        
        // Try to find the gym suggestion element even if it's hidden or not visible
        dlog(`[GYM SELECTION] Attempting to find gym suggestion element (including hidden elements)...`);
        const gymElement = await page.evaluate((gymName) => {
          const searchText = gymName.toLowerCase();
          const allElements = Array.from(document.querySelectorAll('*'));
          
          // Look for elements containing the gym name
          const candidates = allElements.filter(el => {
            const text = (el.textContent || '').trim().toLowerCase();
            return text === searchText || text.includes(searchText);
          });
          
          // Prefer visible elements, but also check hidden ones
          const visible = candidates.find(el => el.offsetParent !== null);
          if (visible) return { found: true, selector: visible.tagName + (visible.id ? '#' + visible.id : '') + (visible.className ? '.' + visible.className.split(' ')[0] : '') };
          
          // If no visible element, try to find and make visible
          const hidden = candidates.find(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && (el.offsetParent !== null || style.visibility === 'visible');
          });
          
          if (hidden) {
            // Try to make it visible
            hidden.style.display = 'block';
            hidden.style.visibility = 'visible';
            hidden.style.opacity = '1';
            return { found: true, selector: hidden.tagName + (hidden.id ? '#' + hidden.id : '') };
          }
          
          return { found: false };
        }, gymName).catch(() => ({ found: false }));
        
        if (gymElement.found) {
          logToFile(`[GYM SELECTION] Found gym element (possibly hidden): ${gymElement.selector}`);
          suggestionVisible = true;
        }
      }
      
      try {
        const inputElement = await page.$(foundSelector || 'input[type="text"]');
        if (!inputElement) {
          throw new Error('Could not find gym input element');
        }
        
        // If suggestion is visible, try to click it directly
        if (suggestionVisible) {
          dlog(`[GYM SELECTION] Attempting to click visible suggestion element...`);
          const clicked = await page.evaluate((gymName) => {
            const searchText = gymName.toLowerCase();
            const allElements = Array.from(document.querySelectorAll('*'));
            const suggestion = allElements.find(el => {
              const text = (el.textContent || '').trim().toLowerCase();
              return (text === searchText || text.includes(searchText)) && el.offsetParent !== null;
            });
            
            if (suggestion) {
              suggestion.click();
              return true;
            }
            return false;
          }, gymName).catch(() => false);
          
          if (clicked) {
            logToFile(`[GYM SELECTION] Successfully clicked suggestion element directly`);
            await sleep(2000);
            // Verify we moved past gym selection
            const stillOnGymPage = await page.evaluate(() => {
              const input = document.querySelector('input[type="text"], input[type="search"]');
              return input && input.value && input.value.toLowerCase().includes('ponte');
            }).catch(() => false);
            
            if (!stillOnGymPage) {
              await takeScreenshot('gym-after-selection');
              return; // Success!
            }
          }
        }
        
        // Fallback: Click directly below the input (original method)
        const box = await inputElement.boundingBox();
        if (!box) {
          throw new Error('Could not get bounding box for gym input element');
        }
        
        // Click directly below the input (suggestion box should be there)
        const clickX = box.x + box.width / 2;
        const clickY = box.y + box.height + 30; // 30px below the input
        logToFile(`[GYM SELECTION] Clicking at coordinates: (${clickX}, ${clickY})`);
        dlog(`[GYM SELECTION] Clicking at coordinates: (${clickX}, ${clickY})`);
        logClick('Gym selection', `mouse.click(${clickX}, ${clickY})`, 'Puppeteer.mouse.click()');
        await page.mouse.click(clickX, clickY);
        await sleep(2000);
        
        // Verify we moved past gym selection
        const stillOnGymPage = await page.evaluate(() => {
          const input = document.querySelector('input[type="text"], input[type="search"]');
          return input && input.value && input.value.toLowerCase().includes('ponte');
        }).catch(() => false);
        
        const clicksAfterGym = clickCounter;
        const clicksMade = clicksAfterGym - clicksBeforeGym;
        
        if (!stillOnGymPage) {
          const summaryMessage = `[GYM SELECTION SUMMARY] Success: true, Method: Puppeteer mouse click at coordinates, Clicks made: ${clicksMade}`;
          logToFile(summaryMessage);
          dlog(summaryMessage);
          await takeScreenshot('gym-after-selection');
        } else {
          const errorMsg = `[GYM SELECTION] Failed - still on gym page after clicking`;
          logToFile(errorMsg);
          dlog(errorMsg);
          await takeScreenshot('gym-all-attempts-failed');
          throw new Error(`Failed to select gym "${gymName}" - still on gym selection page`);
        }
      } catch (e) {
        const errorMsg = `[GYM SELECTION] Error: ${e?.message}`;
        logToFile(errorMsg);
        dlog(errorMsg);
        await takeScreenshot('gym-all-attempts-failed');
        throw new Error(`Failed to select gym "${gymName}": ${e?.message}`);
      }
    });

    // Step 3: Fill email
    await step("Enter email", async () => {
      await clickElement(page, [
        '::-p-aria(name@example.com)',
        'form > div:nth-of-type(1) input',
        '::-p-xpath(/html/body/div/div/div/div[2]/div/form/div[1]/div[2]/input)',
        ':scope >>> form > div:nth-of-type(1) input'
      ], { offset: { x: 211.5, y: 1.3359375 } });
      await sleep(100); // Optimized: reduced from 200ms
      await fillInput(page, [
        '::-p-aria(name@example.com)',
        'form > div:nth-of-type(1) input',
        '::-p-xpath(/html/body/div/div/div/div[2]/div/form/div[1]/div[2]/input)',
        ':scope >>> form > div:nth-of-type(1) input'
      ], email, { debug: DEBUG });
      await takeScreenshot('after-email-entry');
    });

    // Step 4: Fill password
    await step("Enter password", async () => {
      await clickElement(page, [
        '::-p-aria(Password)',
        'form > div:nth-of-type(2) input',
        '::-p-xpath(/html/body/div/div/div/div[2]/div/form/div[2]/div[2]/input)',
        ':scope >>> form > div:nth-of-type(2) input'
      ], { offset: { x: 200.5, y: 26.3359375 } });
      await sleep(100); // Optimized: reduced from 200ms
      await fillInput(page, [
        '::-p-aria(Password)',
        'form > div:nth-of-type(2) input',
        '::-p-xpath(/html/body/div/div/div/div[2]/div/form/div[2]/div[2]/input)',
        ':scope >>> form > div:nth-of-type(2) input'
      ], password, { debug: DEBUG });
      await takeScreenshot('after-password-entry');
    });

    // Step 5: Submit login
    await step("Submit login", async () => {
      // Set up navigation wait BEFORE clicking
      const navigationPromise = page.waitForNavigation({ 
        waitUntil: "networkidle0", 
        timeout: 15000 
      }).catch((e) => {
        dlog(`Navigation wait error (may be normal): ${e?.message}`);
        return null; // Don't fail if navigation already completed
      });
      
      await clickElement(page, [
        '::-p-aria(Sign in)',
        'form button',
        '::-p-xpath(/html/body/div/div/div/div[2]/div/form/div[3]/button)',
        ':scope >>> form button'
      ], { offset: { x: 274.5, y: 16.3359375 } });
      
      // Wait for navigation to complete
      dlog("Waiting for login navigation...");
      try {
        await navigationPromise;
        dlog("Login navigation completed");
      } catch (e) {
        dlog(`Navigation error (continuing anyway): ${e?.message}`);
        // Wait a bit for page to stabilize even if navigation promise failed
        await sleep(1000);
      }
      
      // Check if page is still valid before continuing
      try {
        const pageUrl = page.url();
        dlog(`Page URL after login: ${pageUrl}`);
      } catch (e) {
        dlog(`⚠ Page context may be invalid: ${e?.message}`);
        // Wait a bit longer and try to recover
        await sleep(1000);
      }
      
      // Handle potential password re-entry (as in recorded session)
      await sleep(500); // Optimized: reduced from 1000ms
      
      try {
        const passwordInput = await page.$('form > div:nth-of-type(2) input').catch(() => null);
        if (passwordInput) {
          dlog("Password re-entry detected, filling again");
          await clickElement(page, [
            'body > div > div > div',
            '::-p-xpath(/html/body/div/div/div)',
            ':scope >>> body > div > div > div'
          ], { offset: { x: 55.5, y: 344.3359375 } });
          await sleep(300); // Optimized: reduced from 500ms
          await fillInput(page, [
            '::-p-aria(Password)',
            'form > div:nth-of-type(2) input',
            '::-p-xpath(/html/body/div/div/div/div[2]/div/form/div[2]/div[2]/input)',
            ':scope >>> form > div:nth-of-type(2) input'
          ], password, { debug: DEBUG });
          await page.keyboard.down('Enter');
          await page.keyboard.up('Enter');
          // Wait for second navigation if needed
          await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }).catch(() => {});
        }
      } catch (e) {
        dlog(`Error checking for password re-entry (may be normal): ${e?.message}`);
      }
      
      await sleep(1000); // Wait for page to stabilize after navigation
      
      // Take screenshot with error handling
      try {
        await takeScreenshot('after-login-submit');
      } catch (e) {
        dlog(`⚠ Could not take screenshot after login: ${e?.message}`);
      }
    });

    // Step 6: Navigate to target month/year, find target date column, then find and click class
    await step(`Navigate to date ${targetDate} and find class`, async () => {
      dlog(`=== SIMPLIFIED DATE NAVIGATION (Day View + Date Picker) ===`);
      dlog(`Parsing target date: ${targetDate}`);
      
      // Parse the target date (format: YYYY-MM-DD)
      const [year, month, day] = targetDate.split('-').map(Number);
      dlog(`Target date parsed: Year=${year}, Month=${month}, Day=${day}`);
      
      // Parse target time here so we can use it when checking events
      let targetHour, targetMinute;
      const timeMatch = targetTime.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
      if (timeMatch) {
        targetHour = parseInt(timeMatch[1]);
        targetMinute = parseInt(timeMatch[2]);
        const period = timeMatch[3]?.toLowerCase();
        if (period === 'pm' && targetHour !== 12) targetHour += 12;
        if (period === 'am' && targetHour === 12) targetHour = 0;
      } else {
        const parts = targetTime.split(':');
        targetHour = parseInt(parts[0]) || 8;
        targetMinute = parseInt(parts[1]) || 0;
      }
      dlog(`Target time parsed: ${targetHour}:${targetMinute.toString().padStart(2, '0')}`);
      
      // Wait for calendar to load
      await page.waitForSelector('mwl-calendar-week-view, div.calendar, [class*="calendar"], p-dropdown', { visible: true, timeout: TIMEOUT });
      await sleep(500); // Optimized: reduced from 1000ms
      await takeScreenshot('before-date-navigation');
      
      // Add delay before clicking dropdown - page needs time to fully load (optimized)
      dlog(`Waiting 1 second for page to fully load before clicking dropdown...`);
      await sleep(1000); // Optimized: reduced from 2000ms
      
      // Step 1: Click dropdown to switch to Day view (using page.evaluate for reliability)
      dlog(`Step 1: Clicking view dropdown to select Day view...`);
      
      // First, let's see what dropdown elements exist on the page
      const dropdownInfo = await page.evaluate(() => {
        const info = {
          found: [],
          visible: [],
          details: []
        };
        
        // Check various selectors
        const selectors = [
          'p-dropdown',
          'p-dropdown.ng-tns-c40-1',
          'p-dropdown div.p-dropdown-trigger',
          'p-dropdown.ng-tns-c40-1 div.p-dropdown-trigger',
          'p-dropdown div.p-dropdown-trigger > span',
          'p-dropdown button',
          '[class*="dropdown"]',
          '[class*="p-dropdown"]'
        ];
        
        selectors.forEach(sel => {
          const elements = document.querySelectorAll(sel);
          info.found.push(`${sel}: ${elements.length} found`);
          elements.forEach((el, idx) => {
            const isVisible = el.offsetParent !== null;
            const text = el.textContent?.trim()?.substring(0, 50) || '';
            const className = el.className || '';
            const id = el.id || '';
            info.details.push({
              selector: sel,
              index: idx,
              visible: isVisible,
              text: text,
              className: className,
              id: id,
              tagName: el.tagName
            });
            if (isVisible) {
              info.visible.push(`${sel}[${idx}]: "${text}" (class: ${className}, id: ${id})`);
            }
          });
        });
        
        return info;
      }).catch(() => ({ found: [], visible: [], details: [] }));
      
      dlog(`Found dropdown elements:`);
      dlog(`  Found: ${JSON.stringify(dropdownInfo.found, null, 2)}`);
      dlog(`  Visible: ${JSON.stringify(dropdownInfo.visible, null, 2)}`);
      if (dropdownInfo.details.length > 0) {
        dlog(`  Details: ${JSON.stringify(dropdownInfo.details.slice(0, 5), null, 2)}`);
      }
      
      const dropdownClicked = await page.evaluate(() => {
        // Method 1: Try the specific ID from the HTML provided
        const byId = document.querySelector('#pr_id_2_label');
        if (byId && byId.offsetParent !== null) {
          console.log('[BROWSER] Found dropdown label by ID (#pr_id_2_label), clicking...');
          console.log('[BROWSER] Label text:', byId.textContent?.trim());
          
          // Find the parent trigger element (the actual clickable element)
          const trigger = byId.closest('div.p-dropdown-trigger') || byId.closest('p-dropdown') || byId.parentElement;
          
          if (trigger) {
            console.log('[BROWSER] Found parent trigger:', trigger.tagName, trigger.className);
            trigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Try multiple click methods
            // Method 1: Direct click
            trigger.click();
            
            // Method 2: MouseEvent with all events
            const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
            const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
            trigger.dispatchEvent(mouseDown);
            trigger.dispatchEvent(mouseUp);
            trigger.dispatchEvent(clickEvent);
            
            // Method 3: Try focusing and triggering keydown (Enter)
            trigger.focus();
            const keyDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
            trigger.dispatchEvent(keyDown);
            
            return { success: true, method: 'id_selector' };
          }
          
          // If no trigger found, try clicking the label directly
          byId.scrollIntoView({ behavior: 'smooth', block: 'center' });
          byId.click();
          return { success: true, method: 'id_selector_direct' };
        }
        
        // Method 2: Try finding the label span by class and text
        const byLabel = document.querySelector('span.p-dropdown-label');
        if (byLabel && byLabel.offsetParent !== null && (byLabel.textContent?.trim().includes('Week') || byLabel.textContent?.trim().includes('Day'))) {
          console.log('[BROWSER] Found dropdown label by class (span.p-dropdown-label), clicking...');
          console.log('[BROWSER] Label text:', byLabel.textContent?.trim());
          byLabel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          byLabel.click();
          // Also try clicking the parent trigger
          const trigger = byLabel.closest('div.p-dropdown-trigger') || byLabel.closest('p-dropdown');
          if (trigger) {
            trigger.click();
          }
          return { success: true, method: 'label_span' };
        }
        
        // Method 3: Try the specific selector from Puppeteer recording
        const byClass = document.querySelector('p-dropdown.ng-tns-c40-1 div.p-dropdown-trigger, p-dropdown div.p-dropdown-trigger');
        if (byClass && byClass.offsetParent !== null) {
          console.log('[BROWSER] Found dropdown by class selector, clicking...');
          console.log('[BROWSER] Element text:', byClass.textContent?.trim());
          byClass.scrollIntoView({ behavior: 'smooth', block: 'center' });
          byClass.click();
          return { success: true, method: 'class_selector' };
        }
        
        // Method 4: Try finding by span inside dropdown that contains "Week" or "Day"
        const bySpan = document.querySelector('p-dropdown span.p-dropdown-label, span.p-dropdown-label');
        if (bySpan && bySpan.offsetParent !== null) {
          console.log('[BROWSER] Found dropdown label span, clicking...');
          console.log('[BROWSER] Span text:', bySpan.textContent?.trim());
          bySpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
          bySpan.click();
          // Also try clicking the parent trigger
          const trigger = bySpan.closest('div.p-dropdown-trigger') || bySpan.closest('p-dropdown');
          if (trigger) {
            trigger.click();
          }
          return { success: true, method: 'span_click' };
        }
        
        // Method 5: Try any p-dropdown trigger
        const anyTrigger = document.querySelector('p-dropdown div.p-dropdown-trigger, p-dropdown button');
        if (anyTrigger && anyTrigger.offsetParent !== null) {
          console.log('[BROWSER] Found dropdown by fallback selector, clicking...');
          console.log('[BROWSER] Element text:', anyTrigger.textContent?.trim());
          anyTrigger.scrollIntoView({ behavior: 'smooth', block: 'center' });
          anyTrigger.click();
          return { success: true, method: 'fallback' };
        }
        
        console.log('[BROWSER] Could not find dropdown trigger');
        return { success: false, reason: 'not_found' };
      }).catch((e) => ({ success: false, reason: e?.message || 'error' }));
      
      // Use Puppeteer's native click on the trigger div directly (not the label span)
      dlog(`Trying Puppeteer click on dropdown trigger div with coordinates (31, 22)...`);
      try {
        // First try clicking the trigger div directly (this is the actual clickable element)
        await page.waitForSelector('p-dropdown.ng-tns-c40-1 div.p-dropdown-trigger', { visible: true, timeout: 5000 });
        const triggerElement = await page.$('p-dropdown.ng-tns-c40-1 div.p-dropdown-trigger');
        
        if (triggerElement) {
          const isVisible = await triggerElement.isVisible().catch(() => false);
          if (isVisible) {
            dlog(`Trigger element is visible, clicking with Puppeteer using coordinates (31, 22)...`);
            
            // Get the bounding box to calculate absolute coordinates
            const box = await triggerElement.boundingBox();
            if (box) {
              dlog(`Trigger bounding box: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`);
              
              // Calculate absolute page coordinates: box.x + offsetX, box.y + offsetY
              const clickX = box.x + 31;
              const clickY = box.y + 22;
              dlog(`Clicking at absolute page coordinates (${clickX}, ${clickY})`);
              
              // Try clicking at absolute page coordinates
              await page.mouse.click(clickX, clickY);
              dlog(`✓ Clicked trigger at page coordinates (${clickX}, ${clickY})`);
              
              // Also try with offset click
              await triggerElement.click({ offset: { x: 31, y: 22 } });
              dlog(`✓ Clicked trigger with offset (31, 22)`);
              
              // Wait for dropdown to open
              await sleep(500);
              
              // Verify the click worked
              const dropdownOpened = await page.evaluate(() => {
                const menu = document.querySelector('#pr_id_2_list, [role="listbox"], p-dropdownitem');
                return menu !== null && menu.offsetParent !== null;
              }).catch(() => false);
              
              if (dropdownOpened) {
                dlog(`✓ Dropdown menu opened after click!`);
              } else {
                dlog(`⚠ Dropdown menu not detected after click`);
              }
            } else {
              dlog(`Could not get bounding box for trigger`);
              // Fallback: try offset click anyway
              await triggerElement.click({ offset: { x: 31, y: 22 } });
              dlog(`✓ Clicked trigger with offset (fallback)`);
              await sleep(500);
            }
          } else {
            dlog(`Trigger element not visible`);
          }
        } else {
          dlog(`Could not find trigger element, trying label...`);
          
          // Fallback: try clicking the label
          const labelElement = await page.$('#pr_id_2_label');
          if (labelElement) {
            const isLabelVisible = await labelElement.isVisible().catch(() => false);
            if (isLabelVisible) {
              dlog(`Trying label element with coordinates...`);
              await labelElement.click({ offset: { x: 31, y: 22 } });
              dlog(`✓ Clicked label with offset`);
              await sleep(500);
            }
          }
        }
      } catch (e) {
        dlog(`Puppeteer click failed: ${e?.message}`);
      }
      
      if (!dropdownClicked.success) {
        dlog(`✗ Could not click dropdown: ${dropdownClicked.reason}, trying clickElement fallback...`);
        const fallbackWorked = await clickElement(page, [
          '#pr_id_2_label',
          'span.p-dropdown-label#pr_id_2_label',
          'span.p-dropdown-label',
          'p-dropdown.ng-tns-c40-1 div.p-dropdown-trigger',
          'p-dropdown div.p-dropdown-trigger',
          'p-dropdown div.p-dropdown-trigger > span',
          'p-dropdown button',
          '[class*="dropdown"] button'
        ], { offset: { x: 7.174224853515625, y: 19.100000381469727 }, debug: DEBUG }).catch(() => false);
        
        if (!fallbackWorked) {
          dlog(`✗ All dropdown click attempts failed, throwing error`);
          throw new Error(`Could not click dropdown to switch to Day view`);
        }
        dlog(`✓ Fallback dropdown click succeeded`);
      } else {
        const dropdownMethodMsg = `[DATE NAV DROPDOWN] Successfully clicked dropdown using method: ${dropdownClicked.method}`;
        logToFile(dropdownMethodMsg);
        dlog(`✓ ${dropdownMethodMsg}`);
      }
      
      // Give the dropdown time to open (increased for Railway)
      dlog(`Waiting for dropdown menu to open...`);
      await sleep(800); // Increased wait time for dropdown to open
      
      // Wait for dropdown menu to appear - check multiple times (increased attempts for Railway)
      dlog(`Checking if dropdown menu appeared...`);
      let dropdownReady = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        dropdownReady = await page.evaluate(() => {
          // More aggressive search for dropdown with multiple selectors
          const selectors = [
            '#pr_id_2_list',
            '[role="listbox"]',
            'p-dropdownitem',
            '.p-dropdown-panel',
            '[class*="dropdown-panel"]',
            'p-dropdownitem span'
          ];
          
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
              return true;
            }
          }
          return false;
        }).catch(() => false);
        
        if (dropdownReady) {
          dlog(`✓ Dropdown menu appeared (attempt ${attempt + 1})`);
          break;
        }
        
        if (attempt < 9) {
          dlog(`Waiting for dropdown menu... (attempt ${attempt + 1}/10)`);
          await sleep(300); // Increased wait time for Railway
        }
      }
      
      // Take screenshot after clicking dropdown to see if it opened
      await takeScreenshot('after-dropdown-click');
      
      if (!dropdownReady) {
        dlog(`⚠ Dropdown menu not found after 5 attempts, trying alternative methods...`);
        await takeScreenshot('date-nav-dropdown-not-found');
        
        // Try keyboard navigation as fallback
        dlog(`Trying keyboard navigation to open dropdown...`);
        try {
          // Focus the dropdown and press Enter/Arrow Down to open it
          const dropdownElement = await page.$('p-dropdown.ng-tns-c40-1, p-dropdown');
          if (dropdownElement) {
            await dropdownElement.focus();
            await sleep(200);
            await page.keyboard.press('ArrowDown');
            await sleep(300);
            await page.keyboard.press('Enter');
            await sleep(500);
            
            // Check again if dropdown opened
            dropdownReady = await page.evaluate(() => {
              const selectors = ['#pr_id_2_list', '[role="listbox"]', 'p-dropdownitem', '.p-dropdown-panel'];
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) return true;
              }
              return false;
            }).catch(() => false);
            
            if (dropdownReady) {
              dlog(`✓ Dropdown opened using keyboard navigation`);
            }
          }
        } catch (e) {
          dlog(`Keyboard navigation failed: ${e?.message}`);
        }
      }
      
      await sleep(300); // Give dropdown time to fully render
      
      // Step 2: Click "Day" option using page.evaluate (more reliable)
      dlog(`Step 2: Clicking "Day" option...`);
      await takeScreenshot('before-clicking-day-option');
      
      // If dropdown still not ready, try keyboard navigation to select Day
      if (!dropdownReady) {
        dlog(`Dropdown not visible, trying keyboard navigation to select Day...`);
        try {
          // Focus the dropdown first
          const dropdownElement = await page.$('p-dropdown.ng-tns-c40-1, p-dropdown, #pr_id_2_label');
          if (dropdownElement) {
            await dropdownElement.focus();
            await sleep(200);
          }
          
          // Try pressing ArrowDown then Enter to select first option (Day)
          await page.keyboard.press('ArrowDown');
          await sleep(300);
          await page.keyboard.press('Enter');
          await sleep(800);
          
          // Check if Day view was selected by checking the dropdown label
          const daySelected = await page.evaluate(() => {
            const label = document.querySelector('#pr_id_2_label, span.p-dropdown-label');
            return label && label.textContent?.trim() === 'Day';
          }).catch(() => false);
          
          if (daySelected) {
            const keyboardMethodMsg = `[DATE NAV DAY OPTION] Successfully selected Day using method: keyboard_navigation`;
            logToFile(keyboardMethodMsg);
            dlog(`✓ ${keyboardMethodMsg}`);
            await takeScreenshot('after-clicking-day-option');
            // Skip the rest of the day clicking logic - continue to next step
          } else {
            dlog(`⚠ Keyboard navigation did not select Day, trying other methods...`);
          }
        } catch (e) {
          dlog(`Keyboard navigation failed: ${e?.message}`);
        }
      }
      
      const dayClicked = await page.evaluate(() => {
        // Method 1: Try ID selector from Puppeteer recording
        const byId = document.querySelector('#pr_id_2_list p-dropdownitem:nth-of-type(1) span');
        if (byId && byId.offsetParent !== null) {
          console.log('[BROWSER] Found Day option by ID selector, clicking...');
          byId.scrollIntoView({ behavior: 'smooth', block: 'center' });
          byId.click();
          return { success: true, method: 'id_selector' };
        }
        
        // Method 2: Find all dropdown items and look for "Day" text
        const dropdownItems = document.querySelectorAll('p-dropdownitem span, li span, [role="option"] span');
        for (const item of dropdownItems) {
          if (item.offsetParent !== null && item.textContent?.trim() === 'Day') {
            console.log('[BROWSER] Found Day option by text content, clicking...');
            item.scrollIntoView({ behavior: 'smooth', block: 'center' });
            item.click();
            return { success: true, method: 'text_content' };
          }
        }
        
        // Method 3: First dropdown item (Day is usually first)
        const firstItem = document.querySelector('p-dropdownitem:first-child span, p-dropdownitem:nth-of-type(1) span, li:first-child span');
        if (firstItem && firstItem.offsetParent !== null) {
          console.log('[BROWSER] Found first dropdown item (likely Day), clicking...');
          firstItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstItem.click();
          return { success: true, method: 'first_item' };
        }
        
        // Method 4: Find by aria-label
        const byAria = document.querySelector('[aria-label="Day"], li[aria-label="Day"]');
        if (byAria && byAria.offsetParent !== null) {
          console.log('[BROWSER] Found Day option by aria-label, clicking...');
          byAria.scrollIntoView({ behavior: 'smooth', block: 'center' });
          byAria.click();
          return { success: true, method: 'aria_label' };
        }
        
        // Method 5: Try any visible dropdown item (as fallback)
        const anyItem = document.querySelector('p-dropdownitem span');
        if (anyItem && anyItem.offsetParent !== null) {
          console.log('[BROWSER] Clicking first visible dropdown item as fallback...');
          anyItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          anyItem.click();
          return { success: true, method: 'fallback' };
        }
        
        console.log('[BROWSER] Could not find Day option');
        return { success: false, reason: 'not_found' };
      }).catch((e) => ({ success: false, reason: e?.message || 'error' }));
      
      if (dayClicked.success) {
        const dayMethodMsg = `[DATE NAV DAY OPTION] Successfully clicked Day option using method: ${dayClicked.method}`;
        logToFile(dayMethodMsg);
        dlog(`✓ ${dayMethodMsg}`);
        await sleep(1500);
      } else {
        const dayFailMsg = `[DATE NAV DAY OPTION] Could not click Day option: ${dayClicked.reason}, trying clickElement fallback...`;
        logToFile(dayFailMsg);
        dlog(`✗ ${dayFailMsg}`);
        
        // Final fallback: use clickElement
      await clickElement(page, [
          '#pr_id_2_list p-dropdownitem:nth-of-type(1) span',
          'p-dropdownitem:nth-of-type(1) span',
          'p-dropdownitem:first-child span',
          '[aria-label="Day"]',
          'li[aria-label="Day"]',
          '#p-highlighted-option',
          'p-dropdownitem span'
        ], { offset: { x: 13, y: 4 }, debug: DEBUG });
        await sleep(1500);
      }
      
      // Step 3: Click date button in the center (shows current date like "Nov 23, 2025")
      dlog(`Step 3: Clicking date button in center...`);
      await takeScreenshot('before-clicking-date-button');
      
      // Find the date button by looking for elements containing the date format
      let datePickerClicked = false;
      
      // Method 1: Try to find button/div containing date text (Nov 23, 2025 format)
      try {
        const dateButton = await page.evaluate(() => {
          // Look for buttons or clickable divs in the header area that contain date text
          const allElements = Array.from(document.querySelectorAll('button, div, span'));
          for (const el of allElements) {
            if (el.offsetParent === null) continue;
            const text = (el.textContent || '').trim();
            // Match date formats like "Nov 23, 2025" or "November 23, 2025"
            if (text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i)) {
              // Check if it's in the header/center area (not in sidebar)
              const rect = el.getBoundingClientRect();
              const centerX = window.innerWidth / 2;
              // Date button should be roughly in the center of the screen
              if (Math.abs(rect.left + rect.width / 2 - centerX) < 300) {
                return {
                  found: true,
                  tag: el.tagName,
                  text: text,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2
                };
              }
            }
          }
          return { found: false };
        }).catch(() => ({ found: false }));
        
        if (dateButton.found) {
          dlog(`Found date button: "${dateButton.text}" at (${dateButton.x}, ${dateButton.y})`);
          await page.mouse.click(dateButton.x, dateButton.y);
          dlog(`✓ Clicked date button using text search`);
          datePickerClicked = true;
          await sleep(1000);
        }
      } catch (e) {
        dlog(`Date button text search failed: ${e?.message}`);
      }
      
      // Method 2: Try XPath from Puppeteer recording (if Method 1 didn't work)
      if (!datePickerClicked) {
        try {
          const xpathSelector = '/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div/div[1]/div[2]/div[3]';
          const [datePickerElement] = await page.$x(xpathSelector);
          if (datePickerElement) {
            const isVisible = await datePickerElement.isVisible().catch(() => false);
            if (isVisible) {
              await datePickerElement.click({ offset: { x: 93.6015625, y: 24.25 } });
              dlog(`✓ Clicked date range picker using XPath`);
              datePickerClicked = true;
              await sleep(1000);
            }
          }
        } catch (e) {
          dlog(`XPath selector failed: ${e?.message}`);
        }
      }
      
      // Method 3: Fallback to CSS selectors
      if (!datePickerClicked) {
        const dateMethodMsg = `[DATE NAV DATE BUTTON] Trying CSS selectors fallback...`;
        logToFile(dateMethodMsg);
        dlog(dateMethodMsg);
        await clickElement(page, [
          'div.date-range',
          '[class*="date-range"]',
          '[class*="date-picker"]',
          'button:has-text("Nov")',
          'button:has-text("2025")',
          'div:has-text("Nov 23")',
          'div:has-text("2025")'
        ], { offset: { x: 93.6015625, y: 24.25 }, debug: DEBUG });
        await sleep(1000);
      } else {
        const dateMethodMsg = `[DATE NAV DATE BUTTON] Successfully clicked date button`;
        logToFile(dateMethodMsg);
        dlog(`✓ ${dateMethodMsg}`);
      }
      
      await takeScreenshot('after-clicking-date-button');
      
      // Step 4: Navigate date picker to target date and click it
      dlog(`Step 4: Navigating date picker to ${month}/${day}/${year}...`);
      
      // Wait for date picker calendar to appear and table structure to be ready
      await page.waitForSelector('bs-datepicker-container, bs-days-calendar-view, [class*="datepicker"]', { visible: true, timeout: 5000 }).catch(() => {
        dlog(`Date picker calendar not found, might already be open`);
      });
      // Wait for table structure to be ready (matching Puppeteer recording pattern)
      await page.waitForSelector('bs-days-calendar-view table, bs-calendar-layout table, [class*="datepicker"] table, table td span', { visible: true, timeout: 5000 }).catch(() => {
        dlog(`Date picker table not found immediately, continuing...`);
      });
      await sleep(1000);
      
      // Navigate date picker to target month/year if needed, then click the day
      const datePicked = await page.evaluate((targetDay, targetMonth, targetYear) => {
        const targetDateStr = `${targetYear}-${targetMonth.toString().padStart(2, '0')}-${targetDay.toString().padStart(2, '0')}`;
        
        // First, check if we're in the right month/year by looking at calendar headers
        const calendarView = document.querySelector('bs-days-calendar-view, [class*="datepicker"]');
        let isCorrectMonth = false;
        if (calendarView) {
          const calendarText = calendarView.textContent || '';
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const monthName = monthNames[targetMonth - 1];
          if (calendarText.includes(monthName) && calendarText.includes(String(targetYear))) {
            isCorrectMonth = true;
          }
        }
        
        if (!isCorrectMonth) {
          console.log(`[BROWSER] Not in correct month/year, need to navigate...`);
          return { success: false, reason: 'wrong_month_year' };
        }
        
        // Try to find the date using table structure (matching Puppeteer recording pattern)
        const table = document.querySelector('bs-days-calendar-view table, bs-calendar-layout table, [class*="datepicker"] table');
        if (table) {
          const rows = table.querySelectorAll('tbody tr, tr');
          for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
            const cells = rows[rowIdx].querySelectorAll('td');
            for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
              const span = cells[cellIdx].querySelector('span');
              if (span && span.offsetParent !== null && span.textContent?.trim() === String(targetDay)) {
                console.log(`[BROWSER] Found target date ${targetDay} at row ${rowIdx + 1}, column ${cellIdx + 1}, clicking...`);
                span.click();
                return { success: true, method: 'table_click' };
              }
            }
          }
        }
        
        // Fallback: try generic span selector
        const daySpans = document.querySelectorAll('bs-days-calendar-view table td span, [class*="datepicker"] table td span, tr td span');
        for (const span of daySpans) {
          if (span.offsetParent === null) continue;
          const spanText = span.textContent?.trim();
          if (spanText === String(targetDay)) {
            console.log(`[BROWSER] Found target date ${targetDay} using fallback selector, clicking...`);
            span.click();
            return { success: true, method: 'fallback_click' };
          }
        }
        
        console.log(`[BROWSER] Target date ${targetDay} not found in calendar`);
        return { success: false, reason: 'date_not_visible' };
      }, day, month, year).catch(() => ({ success: false, reason: 'error' }));
      
      if (!datePicked.success) {
        // Navigate the date picker to the correct month/year
        dlog(`Navigating date picker calendar to ${month}/${day}/${year}...`);
        
        // Before navigating, try to click the day if we can find it and verify context
        dlog(`First, trying to find and click target date ${day}/${month}/${year} directly...`);
        const directDateClick = await page.evaluate((targetDay, targetMonth, targetYear) => {
          const targetDateStr = `${targetYear}-${targetMonth.toString().padStart(2, '0')}-${targetDay.toString().padStart(2, '0')}`;
          
          // Find all day spans in the calendar
          const table = document.querySelector('bs-days-calendar-view table, bs-calendar-layout table, [class*="datepicker"] table');
          if (table) {
            const rows = table.querySelectorAll('tbody tr, tr');
            for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
              const cells = rows[rowIdx].querySelectorAll('td');
              for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
                const span = cells[cellIdx].querySelector('span');
                if (span && span.offsetParent !== null && span.textContent?.trim() === String(targetDay)) {
                  // Check if this date cell is in the right month/year by checking parent context
                  // Look for month/year indicators in nearby headers or parent elements
                  const calendarView = span.closest('bs-days-calendar-view') || span.closest('bs-calendar-layout');
                  if (calendarView) {
                    const calendarText = calendarView.textContent || '';
                    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                    const targetMonthName = monthNames[targetMonth - 1];
                    
                    // Check if this calendar view contains our target month/year
                    if (calendarText.includes(targetMonthName) && calendarText.includes(String(targetYear))) {
                      console.log(`[BROWSER] Found day ${targetDay} in correct month/year context (${targetMonth}/${targetYear}), clicking...`);
                      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      span.click();
                      return { success: true, method: 'direct_with_context' };
                    }
                  }
                  
                  // If context check failed but we're in November area (target is Nov), try clicking anyway
                  // This handles cases where month/year detection isn't perfect
                  if (targetMonth === 11) {
                    const calendarText = document.querySelector('bs-days-calendar-view, bs-calendar-layout')?.textContent || '';
                    if (calendarText.includes('November') || calendarText.includes('Nov')) {
                      console.log(`[BROWSER] Found day ${targetDay} in November context, clicking...`);
                      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      span.click();
                      return { success: true, method: 'direct_november' };
                    }
                  }
                }
              }
            }
          }
          
          return { success: false, reason: 'day_not_found_with_context' };
        }, day, month, year).catch(() => ({ success: false, reason: 'error' }));
        
        if (directDateClick.success) {
          const dateMethodMsg = `[DATE NAV DATE PICKER] Successfully clicked target date ${day}/${month}/${year} using method: ${directDateClick.method}`;
          logToFile(dateMethodMsg);
          dlog(`✓ ${dateMethodMsg}`);
          await sleep(1500);
          
          // Verify date picker closed
          const dateSelected = await page.evaluate(() => {
            const container = document.querySelector('bs-datepicker-container');
            return !container || container.offsetParent === null;
          }).catch(() => false);
          
          if (dateSelected) {
            dlog(`✓ Date picker closed, date selected successfully`);
          } else {
            dlog(`⚠ Date picker still open, but continuing...`);
          }
        } else {
          dlog(`Could not find target date directly, navigating date picker...`);
          
          // Try to navigate month/year in the date picker
          // The date picker might have month/year navigation buttons
          for (let navAttempt = 0; navAttempt < 12; navAttempt++) {
          // Check current month/year in date picker - improved detection
          const currentDatePickerState = await page.evaluate(() => {
            let foundMonth = null;
            let foundYear = null;
            
            // Method 1: Look for month/year in calendar view headers
            const view = document.querySelector('bs-days-calendar-view, bs-calendar-layout, [class*="datepicker"]');
            if (view) {
              const text = view.textContent || '';
              const monthMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)/i);
              const yearMatch = text.match(/\b(20\d{2})\b/);
              if (monthMatch) {
                const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                foundMonth = months.indexOf(monthMatch[1].toLowerCase()) + 1;
              }
              if (yearMatch) foundYear = parseInt(yearMatch[1]);
            }
            
            // Method 2: Look for month/year buttons or headers
            if (!foundMonth || !foundYear) {
              const headers = document.querySelectorAll('bs-datepicker-container th, bs-datepicker-container button, [class*="datepicker"] th, [class*="datepicker"] button');
              for (const h of headers) {
                if (h.offsetParent !== null) {
                  const text = h.textContent || '';
                  const monthMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)/i);
                  const yearMatch = text.match(/\b(20\d{2})\b/);
                  if (monthMatch && !foundMonth) {
                    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                    foundMonth = months.indexOf(monthMatch[1].toLowerCase()) + 1;
                  }
                  if (yearMatch && !foundYear) foundYear = parseInt(yearMatch[1]);
                  if (foundMonth && foundYear) break;
                }
              }
            }
            
            // Method 3: Look at visible dates in the calendar table
            if (!foundMonth || !foundYear) {
              const cells = document.querySelectorAll('bs-days-calendar-view td, bs-calendar-layout td, [class*="datepicker"] table td');
              for (const cell of cells) {
                if (cell.offsetParent !== null) {
                  const span = cell.querySelector('span');
                  if (span && span.textContent?.trim()) {
                    // Check if this is a valid date cell (not empty)
                    const cellText = cell.textContent?.trim();
                    const monthMatch = cellText?.match(/(January|February|March|April|May|June|July|August|September|October|November|December)/i);
                    const yearMatch = cellText?.match(/\b(20\d{2})\b/);
                    if (monthMatch && !foundMonth) {
                      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                      foundMonth = months.indexOf(monthMatch[1].toLowerCase()) + 1;
                    }
                    if (yearMatch && !foundYear) foundYear = parseInt(yearMatch[1]);
                    if (foundMonth && foundYear) break;
                  }
                }
              }
            }
            
            // Method 4: Look at the date picker container's entire text
            if (!foundMonth || !foundYear) {
              const container = document.querySelector('bs-datepicker-container');
              if (container) {
                const text = container.textContent || '';
                const monthMatch = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)/i);
                const yearMatch = text.match(/\b(20\d{2})\b/);
                if (monthMatch && !foundMonth) {
                  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
                  foundMonth = months.indexOf(monthMatch[1].toLowerCase()) + 1;
                }
                if (yearMatch && !foundYear) foundYear = parseInt(yearMatch[1]);
              }
            }
            
            return { month: foundMonth, year: foundYear };
          }).catch(() => ({ month: null, year: null }));
          
          dlog(`Date picker state: Month=${currentDatePickerState?.month}, Year=${currentDatePickerState?.year}, Target: ${month}/${year}`);
          
          // If we detected the month/year, try to click the day even if not exact match yet
          // But prioritize if we're on the exact month/year
          if (currentDatePickerState?.month === month && currentDatePickerState?.year === year) {
            dlog(`✓ Date picker is on correct month/year (${currentDatePickerState.month}/${currentDatePickerState.year}), clicking day ${day}...`);
            
            const dayClicked = await page.evaluate((targetDay) => {
              // Try to find the date in the calendar table using table structure
              const table = document.querySelector('bs-days-calendar-view table, bs-calendar-layout table, [class*="datepicker"] table');
              
              if (table) {
                const rows = table.querySelectorAll('tbody tr, tr');
                for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
                  const cells = rows[rowIdx].querySelectorAll('td');
                  for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
                    const span = cells[cellIdx].querySelector('span');
                    if (span && span.offsetParent !== null && span.textContent?.trim() === String(targetDay)) {
                      console.log(`[BROWSER] Found day ${targetDay} at row ${rowIdx + 1}, column ${cellIdx + 1}, clicking...`);
                      span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      span.click();
                      return { success: true, method: 'table_click' };
                    }
                  }
                }
              }
              
              // Fallback: try all spans
              const spans = document.querySelectorAll('bs-days-calendar-view table td span, bs-calendar-layout table td span, [class*="datepicker"] table td span, tr td span');
              for (const span of spans) {
                if (span.offsetParent === null) continue;
                if (span.textContent?.trim() === String(targetDay)) {
                  console.log(`[BROWSER] Found day ${targetDay} using fallback selector, clicking...`);
                  span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  span.click();
                  return { success: true, method: 'fallback_click' };
                }
              }
              
              console.log(`[BROWSER] Could not find day ${targetDay} in date picker`);
              return { success: false, reason: 'day_not_found' };
            }, day).catch(() => ({ success: false, reason: 'error' }));
            
            if (dayClicked.success) {
              const dayPickerMethodMsg = `[DATE NAV DATE PICKER] Successfully clicked day ${day} using method: ${dayClicked.method}`;
              logToFile(dayPickerMethodMsg);
              dlog(`✓ ${dayPickerMethodMsg}`);
              await sleep(1500);
              
              // Verify the date was actually selected
              const dateSelected = await page.evaluate(() => {
                // Check if the date picker closed or if the date is now selected
                const container = document.querySelector('bs-datepicker-container');
                if (!container || container.offsetParent === null) {
                  return true; // Date picker closed, date was likely selected
                }
                return false;
              }).catch(() => false);
              
              if (dateSelected) {
                dlog(`✓ Date picker closed, date should be selected`);
                break; // Exit navigation loop
              } else {
                dlog(`⚠ Date picker still open, may need to click again`);
              }
            } else {
              dlog(`✗ Could not find day ${day} in date picker: ${dayClicked.reason}`);
            }
          } else {
            // Navigate to correct month/year
            const needsForward = !currentDatePickerState?.month || 
                                 !currentDatePickerState?.year ||
                                 (currentDatePickerState.year * 12 + currentDatePickerState.month) < (year * 12 + month);
            
            if (needsForward) {
              dlog(`Navigating date picker forward...`);
              await clickElement(page, [
                'bs-datepicker-container button[aria-label*="next"]',
                'bs-datepicker-container button.next',
                '[class*="datepicker"] button[aria-label*="next"]',
                '::-p-xpath(//bs-datepicker-container//button[@aria-label[contains(., "next")]])'
              ], { timeout: 2000, debug: DEBUG }).catch(() => {
                dlog(`Could not find next button in date picker`);
              });
            } else {
              dlog(`Navigating date picker backward...`);
              await clickElement(page, [
                'bs-datepicker-container button[aria-label*="previous"]',
                'bs-datepicker-container button.previous',
                '[class*="datepicker"] button[aria-label*="previous"]'
              ], { timeout: 2000, debug: DEBUG }).catch(() => {
                dlog(`Could not find previous button in date picker`);
              });
            }
            await sleep(1000);
          }
          
          if (navAttempt >= 11) {
            dlog(`✗ Could not navigate to target date in date picker after ${navAttempt + 1} attempts`);
            break;
          }
          }
        }
      }
      
      if (datePicked.success) {
        dlog(`✓ Date picked successfully using direct click`);
        await sleep(1500);
      }
      
      // Step 5: Wait for calendar events to load after selecting date
      dlog(`Step 5: Waiting for events to load after date selection...`);
      await sleep(2000);
      
      try {
        await page.waitForSelector('mwl-calendar-week-view-event, div.checker-details, [class*="calendar-event"], [class*="event"]', { timeout: 10000, visible: true }).catch(() => {
          dlog(`Events not immediately visible, continuing...`);
        });
      } catch (e) {
        dlog(`Warning: Timeout waiting for events, but continuing...`);
      }
      await sleep(2000);
      
      // Step 6: Find and click the class at target time
      dlog(`Step 6: Looking for class at ${targetHour}:${targetMinute.toString().padStart(2, '0')}...`);
      
      // First, find the matching event element and get its selector/index
      const classInfo = await page.evaluate((targetHour, targetMinute) => {
        // In Day view, find all events and match by time
        // Try multiple selectors to find the actual clickable event elements
        const allEvents = document.querySelectorAll(
          'mwl-calendar-week-view-event, ' +
          'div.checker-details, ' +
          'div[class*="calendar-event"], ' +
          'div[class*="event"], ' +
          '[class*="cal-event"], ' +
          'div[class*="cal-day-event"], ' +
          '.cal-day-event, ' +
          '[data-event-index], ' +
          'div.cal-event-item'
        );
        
        console.log(`[BROWSER] Found ${allEvents.length} potential events in Day view`);
        
        // Convert target time to 12-hour format for matching
        const targetHour12 = targetHour % 12 || 12;
        const targetPeriod = targetHour >= 12 ? 'pm' : 'am';
        const targetPeriodUpper = targetPeriod.toUpperCase();
        
        // Build exact time patterns - must match the exact hour and minute
        const exactTimePatterns = [
          // 24-hour format
          `${targetHour}:${targetMinute.toString().padStart(2, '0')}`,
          `${targetHour}:${targetMinute}`,
          // 12-hour format with am/pm
          `${targetHour12}:${targetMinute.toString().padStart(2, '0')}${targetPeriod}`,
          `${targetHour12}:${targetMinute}${targetPeriod}`,
          `${targetHour12}:${targetMinute.toString().padStart(2, '0')} ${targetPeriodUpper}`,
          `${targetHour12}:${targetMinute} ${targetPeriodUpper}`,
          `${targetHour12}:${targetMinute.toString().padStart(2, '0')} ${targetPeriod}`,
          `${targetHour12}:${targetMinute} ${targetPeriod}`,
          // Without leading zero
          `${targetHour12}:${targetMinute.toString().padStart(2, '0')}${targetPeriodUpper}`,
          `${targetHour12}:${targetMinute}${targetPeriodUpper}`
        ];
        
        console.log(`[BROWSER] Looking for time: ${targetHour12}:${targetMinute.toString().padStart(2, '0')} ${targetPeriod} (${targetHour}:${targetMinute.toString().padStart(2, '0')} in 24h format)`);
        
        for (const event of allEvents) {
          if (event.offsetParent === null) continue;
          
          const eventText = event.textContent || '';
          const className = event.className || '';
          
          // Skip headers/navigation
          if (eventText.includes('Week') || eventText.includes('All instructors') || eventText.includes('TODAY') || 
              eventText.includes('Filters') || eventText.includes('Add event')) continue;
          if (className.includes('header') || className.includes('navigation') || className.includes('title')) continue;
          
          // Extract time from event text - look for patterns like "8:00am", "8:00 am", "8:0am", etc.
          const timeMatch = eventText.match(/\b(\d{1,2}):(\d{1,2})\s*(am|pm|AM|PM)?\b/i);
          if (!timeMatch) continue;
          
          const eventHour = parseInt(timeMatch[1]);
          const eventMinute = parseInt(timeMatch[2]);
          const eventPeriod = timeMatch[3]?.toLowerCase() || '';
          
          // Convert event time to 24-hour format for accurate comparison
          let eventHour24 = eventHour;
          if (eventPeriod === 'pm' && eventHour !== 12) eventHour24 = eventHour + 12;
          if (eventPeriod === 'am' && eventHour === 12) eventHour24 = 0;
          
          // Match if hour and minute exactly match (24-hour format comparison)
          const exactMatch = eventHour24 === targetHour && eventMinute === targetMinute;
          
          if (exactMatch) {
            console.log(`[BROWSER] ✓ Found matching event (exactMatch=true): "${eventText.substring(0, 100)}"`);
            console.log(`[BROWSER] Event time: ${eventHour24}:${eventMinute.toString().padStart(2, '0')} (${eventHour}:${eventMinute.toString().padStart(2, '0')}${eventPeriod || ''}), Target: ${targetHour}:${targetMinute.toString().padStart(2, '0')}`);
            console.log(`[BROWSER] Event element tag: ${event.tagName}, class: ${event.className}`);
            
            // Generate a unique selector for this element
            // Try to find a unique attribute or path
            let selector = null;
            if (event.id) {
              selector = `#${event.id}`;
            } else if (event.className) {
              // Try to create a more specific selector
              const classes = event.className.split(' ').filter(c => c && !c.includes('ng-'));
              if (classes.length > 0) {
                // Find index among siblings with same class
                const siblings = Array.from(event.parentElement?.children || []);
                const sameClassSiblings = siblings.filter(el => {
                  const elClasses = el.className?.split(' ') || [];
                  return classes.some(c => elClasses.includes(c));
                });
                const index = sameClassSiblings.indexOf(event);
                selector = `${event.tagName.toLowerCase()}.${classes[0]}${index > 0 ? `:nth-of-type(${index + 1})` : ''}`;
              }
            }
            
            // Return info so we can click it with Puppeteer native click
            return { 
              success: true, 
              eventText: eventText.substring(0, 100),
              elementTag: event.tagName,
              elementClass: event.className || '',
              selector: selector,
              // Also return the element's position in the DOM for fallback
              eventIndex: Array.from(event.parentElement?.children || []).indexOf(event),
              parentSelector: event.parentElement?.tagName?.toLowerCase() || null
            };
          } else {
            console.log(`[BROWSER] Time mismatch - Event: ${eventHour24}:${eventMinute.toString().padStart(2, '0')} (${eventHour}:${eventMinute.toString().padStart(2, '0')}${eventPeriod || ''}), Target: ${targetHour}:${targetMinute.toString().padStart(2, '0')} - "${eventText.substring(0, 80)}"`);
          }
        }
        
        console.log(`[BROWSER] No matching event found`);
        return { success: false, reason: 'no_time_match' };
      }, targetHour, targetMinute).catch((e) => ({ success: false, reason: 'error', error: e?.message }));
      
      if (classInfo.success) {
        dlog(`✓ Successfully found matching class!`);
        dlog(`  Event: ${classInfo.eventText}`);
        dlog(`  Element: ${classInfo.elementTag || 'unknown'}, Class: ${classInfo.elementClass || 'none'}`);
        dlog(`  Selector: ${classInfo.selector || 'none'}`);
        
        // Now click it using Puppeteer's native click methods
        dlog(`Attempting to click the class element using Puppeteer...`);
        
        let clicked = false;
        
        // Method 1: Try using the selector if available
        if (classInfo.selector) {
          try {
            await page.waitForSelector(classInfo.selector, { visible: true, timeout: 3000 });
            const element = await page.$(classInfo.selector);
            if (element) {
              const isVisible = await element.isVisible().catch(() => false);
              if (isVisible) {
                dlog(`  Clicking using selector: ${classInfo.selector}`);
                await element.scrollIntoView();
                await sleep(300);
                await element.click();
                clicked = true;
                dlog(`  ✓ Clicked using selector`);
              }
            }
          } catch (e) {
            dlog(`  Selector click failed: ${e?.message}`);
          }
        }
        
        // Method 2: Find all matching elements and click the one that matches our event text
        if (!clicked) {
          try {
            dlog(`  Trying to find element by class and event text...`);
            const elements = await page.$$('div.cal-event-container, div[class*="cal-event"], mwl-calendar-week-view-event');
            
            for (let i = 0; i < elements.length; i++) {
              const element = elements[i];
              const isVisible = await element.isVisible().catch(() => false);
              if (!isVisible) continue;
              
              const text = await element.evaluate(el => el.textContent || '');
              const timeMatch = text.match(/\b(\d{1,2}):(\d{1,2})\s*(am|pm)?\b/i);
              
              if (timeMatch) {
                let eventHour = parseInt(timeMatch[1]);
                const eventMinute = parseInt(timeMatch[2]);
                const eventPeriod = timeMatch[3]?.toLowerCase() || '';
                
                let eventHour24 = eventHour;
                if (eventPeriod === 'pm' && eventHour !== 12) eventHour24 = eventHour + 12;
                if (eventPeriod === 'am' && eventHour === 12) eventHour24 = 0;
                
                if (eventHour24 === targetHour && eventMinute === targetMinute) {
                  dlog(`  Found matching element at index ${i}, clicking...`);
                  await element.scrollIntoView();
                  await sleep(300);
                  await element.click();
                  clicked = true;
                  dlog(`  ✓ Clicked matching element at index ${i}`);
                  break;
                }
              }
            }
          } catch (e) {
            dlog(`  Element array click failed: ${e?.message}`);
          }
        }
        
        // Method 3: Use page.evaluate to find and click via native browser click
        if (!clicked) {
          dlog(`  Trying native browser click via page.evaluate...`);
          const clickedInBrowser = await page.evaluate((targetHour, targetMinute) => {
            const allEvents = document.querySelectorAll('div.cal-event-container, div[class*="cal-event"], mwl-calendar-week-view-event');
            
            for (const event of allEvents) {
              if (event.offsetParent === null) continue;
              
              const eventText = event.textContent || '';
              const timeMatch = eventText.match(/\b(\d{1,2}):(\d{1,2})\s*(am|pm)?\b/i);
              if (!timeMatch) continue;
              
              let eventHour = parseInt(timeMatch[1]);
              const eventMinute = parseInt(timeMatch[2]);
              const eventPeriod = timeMatch[3]?.toLowerCase() || '';
              
              let eventHour24 = eventHour;
              if (eventPeriod === 'pm' && eventHour !== 12) eventHour24 = eventHour + 12;
              if (eventPeriod === 'am' && eventHour === 12) eventHour24 = 0;
              
              if (eventHour24 === targetHour && eventMinute === targetMinute) {
                // Scroll into view
                event.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Click with multiple methods
                event.click();
                
                // Also try mouse events
                const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
                const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window });
                const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                
                event.dispatchEvent(mouseDown);
                event.dispatchEvent(mouseUp);
                event.dispatchEvent(clickEvent);
                
                return true;
              }
            }
            return false;
          }, targetHour, targetMinute).catch(() => false);
          
          if (clickedInBrowser) {
            clicked = true;
            dlog(`  ✓ Clicked using native browser click`);
          }
        }
        
        if (!clicked) {
          dlog(`  ✗ Could not click the element using any method`);
        }
        
        // Wait for the click to register and check if a booking dialog/modal appeared
        await sleep(500);
        
        // Verify the click worked by checking for common indicators:
        // - Booking dialog/modal appears
        // - Event becomes selected/highlighted
        // - A form or details panel appears
        const clickVerified = await page.evaluate(() => {
          // Check for booking dialog, modal, or details panel
          const bookingDialog = document.querySelector('div[class*="modal"], div[class*="dialog"], div[class*="booking"], div[class*="details"], div[class*="panel"]');
          if (bookingDialog && bookingDialog.offsetParent !== null) {
            return true;
          }
          
          // Check if any event is selected/highlighted
          const selectedEvent = document.querySelector('[class*="selected"], [class*="active"], [class*="highlight"]');
          if (selectedEvent && selectedEvent.offsetParent !== null) {
            return true;
          }
          
          return false;
        }).catch(() => false);
        
        if (clickVerified) {
          dlog(`✓ Click verified - booking dialog/details panel appeared`);
        } else {
          dlog(`⚠ Click may not have registered - no booking dialog detected, but continuing...`);
        }
        
        await sleep(800); // Optimized: reduced from 1500ms
      } else {
        dlog(`✗ Could not find class at ${targetTime}`);
        dlog(`  Reason: ${classInfo.reason}`);
        
        // Log all events found for debugging
        const allEventTimes = await page.evaluate(() => {
          const events = document.querySelectorAll('mwl-calendar-week-view-event, div.checker-details, div[class*="calendar-event"], div[class*="event"]');
          const times = [];
          for (const event of events) {
            if (event.offsetParent === null) continue;
            const text = event.textContent || '';
            const timeMatch = text.match(/\b(\d{1,2}):(\d{1,2})\s*(am|pm)?\b/i);
            if (timeMatch) {
              times.push(`${timeMatch[1]}:${timeMatch[2]}${timeMatch[3] || ''}`);
            }
          }
          return times;
        }).catch(() => []);
        
        dlog(`  Available class times on this date: ${allEventTimes.join(', ')}`);
        
        throw new Error(`Could not find class at ${targetTime} on ${targetDate}: ${classInfo.reason}`);
      }
      
      dlog(`=== DATE NAVIGATION AND CLASS SELECTION COMPLETE ===`);
    });

    // Step 7: Click "Book Customer" button
    await step("Click Book Customer", async () => {
      await clickElement(page, [
        '::-p-aria(Book Customer)',
        'div.booking-btn > button',
        '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[2]/div/div[3]/div[2]/div[1]/div[2]/button)',
        ':scope >>> div.booking-btn > button',
        '::-p-text(Book Customer)'
      ], { offset: { x: 61, y: 8.3828125 } });
      await sleep(500); // Optimized: reduced from 1000ms
    });

    // Step 8: Search for customer
    await step("Search for customer", async () => {
      await fillInput(page, [
        '::-p-aria(Search customer)',
        'div.customer-overlay input',
        '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/div/div[3]/input)',
        ':scope >>> div.customer-overlay input'
      ], CUSTOMER_NAME.toLowerCase(), { debug: DEBUG });
      await sleep(500); // Optimized: reduced from 1000ms
    });

    // Step 10: Select customer from results
    await step("Select customer", async () => {
      logToFile(`[CUSTOMER SELECTION] Starting customer selection. Current click count: ${clickCounter}`);
      dlog(`[CUSTOMER SELECTION] Starting customer selection. Current click count: ${clickCounter}`);
      const clicksBefore = clickCounter;
      
      // Take screenshot before selecting customer
      await takeScreenshot('before-customer-selection');
      
      await clickElement(page, [
        'div.search-container > div > div',
        '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/div/div[3]/div/div)',
        ':scope >>> div.search-container > div > div',
        `::-p-text(${CUSTOMER_NAME})`
      ], { offset: { x: 201, y: 11 }, location: 'Select customer', debug: DEBUG });
      
      // Take screenshot immediately after selecting customer to see if booking was triggered
      await takeScreenshot('after-customer-selection');
      logToFile(`[CUSTOMER SELECTION] Screenshot taken after customer selection`);
      
      // Check if booking was automatically triggered
      const autoBookingCheck = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        const hasSuccessNotification = bodyText.toLowerCase().includes('successfully booked') || 
                                      bodyText.toLowerCase().includes('customer successfully booked');
        const notifications = Array.from(document.querySelectorAll('[class*="notification"], [class*="toast"], [class*="alert"]'));
        return {
          hasSuccessNotification,
          notificationCount: notifications.filter(n => n.offsetParent !== null).length,
          notificationTexts: notifications.filter(n => n.offsetParent !== null).map(n => n.textContent?.substring(0, 50)).slice(0, 3)
        };
      }).catch(() => ({ hasSuccessNotification: false, notificationCount: 0, notificationTexts: [] }));
      
      if (autoBookingCheck.hasSuccessNotification || autoBookingCheck.notificationCount > 0) {
        logToFile(`[WARNING] Booking notification detected immediately after customer selection! Notification count: ${autoBookingCheck.notificationCount}`);
        logToFile(`[WARNING] Notification texts: ${autoBookingCheck.notificationTexts.join(', ')}`);
      }
      
      const clicksAfter = clickCounter;
      const clicksMade = clicksAfter - clicksBefore;
      const customerLogMsg = `[CUSTOMER SELECTION] Completed. Clicks made: ${clicksMade}, Total clicks so far: ${clickCounter}`;
      logToFile(customerLogMsg);
      dlog(customerLogMsg);
      if (clicksMade > 1) {
        const warningMsg = `[WARNING] Multiple clicks detected during customer selection! Click count: ${clicksMade}`;
        logToFile(warningMsg);
        console.error(warningMsg);
      }
      await sleep(500); // Optimized: reduced from 1000ms
    });

    // Step 11: Wait for booking modal to fully load after selecting customer
    await step("Wait for booking modal", async () => {
      dlog(`Waiting for booking modal to fully load after selecting customer...`);
      await sleep(1000); // Optimized: reduced from 2000ms
      
      // Check if the modal is visible and what buttons/options are available
      const modalState = await page.evaluate(() => {
        // Look for "BOOK USING CREDITS" button
        const bookButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(el => 
          el.textContent?.includes('BOOK USING CREDITS') || 
          el.textContent?.includes('BOOK USING') ||
          el.getAttribute('aria-label')?.includes('BOOK')
        );
        
        // Look for SELECT PLAN dropdown
        const selectPlan = Array.from(document.querySelectorAll('*')).find(el => 
          el.textContent?.includes('SELECT PLAN') ||
          el.getAttribute('aria-label')?.includes('SELECT PLAN')
        );
        
        return {
          hasBookButton: bookButton !== undefined && bookButton.offsetParent !== null,
          bookButtonText: bookButton?.textContent?.substring(0, 50) || '',
          bookButtonTag: bookButton?.tagName || '',
          bookButtonClass: bookButton?.className || '',
          hasSelectPlan: selectPlan !== undefined && selectPlan.offsetParent !== null
        };
      }).catch(() => ({}));
      
      dlog(`Modal state: hasBookButton=${modalState.hasBookButton}, hasSelectPlan=${modalState.hasSelectPlan}`);
      if (modalState.bookButtonText) {
        dlog(`  Book button found: ${modalState.bookButtonText} (tag: ${modalState.bookButtonTag}, class: ${modalState.bookButtonClass})`);
      }
    });
    

    // Step 13: Click "BOOK USING CREDITS" button - this is the confirmation button
    // Note: Based on the modal UI, this button appears directly after selecting customer
    // We may need to select a plan first, but if plan is already selected, we can click directly
    await step("Click BOOK USING CREDITS button", async () => {
      logToFile(`[BOOK BUTTON] Starting BOOK USING CREDITS click. Current click count: ${clickCounter}`);
      dlog(`[BOOK BUTTON] Starting BOOK USING CREDITS click. Current click count: ${clickCounter}`);
      const clicksBefore = clickCounter;
      dlog(`Looking for BOOK USING CREDITS button to confirm booking...`);
      
      // Wait a bit to ensure modal is fully loaded (optimized)
      await sleep(800); // Optimized: reduced from 1500ms
      
      // Try to find and click the button using exact selectors from Puppeteer recording
      // Recording shows: ::-p-aria(Calendar Button BOOK USING CREDITS), XPath, div.customer-overlay button
      // Offset: x: 318, y: 20.5
      dlog(`Using exact selectors from Puppeteer recording...`);
      
      // First try using exact XPath from recording
      // CRITICAL: Use a flag to ensure we only click ONCE, even if multiple selectors match the same button
      const clicked = await page.evaluate(() => {
        let buttonClicked = false; // Guard to prevent double-clicks
        let buttonElement = null;
        
        // Try XPath from Puppeteer recording first
        const xpath = '/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/div/div[3]/div/div[6]/div/button';
        try {
          const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const button = result.singleNodeValue;
          
          if (button && button.offsetParent !== null) {
            buttonElement = button;
            console.log(`[BROWSER CLICK] BOOK USING CREDITS - Found button via XPath`);
          }
        } catch (e) {
          console.log(`[BROWSER] XPath failed: ${e?.message}`);
        }
        
        // Fallback: try aria-label from recording (only if XPath didn't find it)
        if (!buttonElement) {
          const ariaButton = document.querySelector('[aria-label*="Calendar Button BOOK USING CREDITS"], [aria-label*="BOOK USING CREDITS"]');
          if (ariaButton && ariaButton.offsetParent !== null) {
            buttonElement = ariaButton;
            console.log(`[BROWSER CLICK] BOOK USING CREDITS - Found button via aria-label`);
          }
        }
        
        // Fallback: try CSS selector from recording (only if previous methods didn't find it)
        if (!buttonElement) {
          const cssButton = document.querySelector('div.customer-overlay button');
          if (cssButton && cssButton.offsetParent !== null) {
            const text = cssButton.textContent || '';
            if (text.includes('BOOK USING CREDITS') || text.includes('BOOK USING')) {
              buttonElement = cssButton;
              console.log(`[BROWSER CLICK] BOOK USING CREDITS - Found button via CSS selector`);
            }
          }
        }
        
        // CRITICAL: Only click ONCE, regardless of which selector found it
        if (buttonElement && !buttonClicked) {
          console.log(`[BROWSER CLICK] BOOK USING CREDITS - Clicking button ONCE (no duplicates)`);
          buttonElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          buttonElement.click();
          buttonClicked = true;
          return true;
        }
        
        if (!buttonElement) {
          console.log(`[BROWSER] BOOK USING CREDITS button not found`);
        }
        return false;
      }).catch(() => false);
      
      await sleep(500);
      
      // Log clicks made in this step
      const clicksBeforeBook = clickCounter;
      
      // If page.evaluate didn't work, try Puppeteer native click with exact selectors and offset
      if (!clicked) {
        dlog(`Button not found via page.evaluate, trying Puppeteer native click with exact selectors...`);
        
        // Try CSS selector from recording with exact offset
        try {
          await page.waitForSelector('div.customer-overlay button', { visible: true, timeout: 5000 });
          const cssButton = await page.$('div.customer-overlay button');
          
          if (cssButton) {
            const isVisible = await cssButton.isVisible().catch(() => false);
            if (isVisible) {
              const text = await cssButton.evaluate(el => el.textContent || '').catch(() => '');
              if (text.includes('BOOK USING CREDITS') || text.includes('BOOK USING')) {
                dlog(`Found BOOK USING CREDITS button via CSS selector: ${text.substring(0, 50)}`);
                logClick('BOOK USING CREDITS button', 'div.customer-overlay button', 'Puppeteer.click(offset)');
                await cssButton.scrollIntoView();
                await sleep(300);
                
                // Use exact offset from recording: x: 318, y: 20.5
                await cssButton.click({ offset: { x: 318, y: 20.5 } });
                dlog(`✓ Clicked BOOK USING CREDITS button with exact offset (318, 20.5) from recording`);
                clicked = true;
              }
            }
          }
        } catch (e) {
          dlog(`Puppeteer native click failed: ${e?.message}`);
        }
      } else {
        logClick('BOOK USING CREDITS button', 'page.evaluate', 'element.click()');
        dlog(`✓ Successfully clicked BOOK USING CREDITS button via page.evaluate`);
      }
      
      const clicksAfterBook = clickCounter;
      const clicksMade = clicksAfterBook - clicksBeforeBook;
      const bookButtonLogMsg = `[BOOK BUTTON] Completed. Clicks made in this step: ${clicksMade}, Total clicks so far: ${clickCounter}`;
      logToFile(bookButtonLogMsg);
      dlog(bookButtonLogMsg);
      if (clicksMade > 1) {
        const warningMsg = `[WARNING] Multiple clicks detected on BOOK USING CREDITS button! Click count: ${clicksMade}`;
        logToFile(warningMsg);
        console.error(warningMsg);
      }
      
      // CRITICAL: Take screenshot immediately after clicking to capture double-booking
      await takeScreenshot('after-book-using-credits-click');
      logToFile(`[BOOK BUTTON] Screenshot taken immediately after clicking BOOK USING CREDITS button`);
      
      // Minimal wait for booking to be processed (optimized for speed)
      await sleep(500);
      
      // Verify the booking was processed - check if booking completed
      dlog(`Checking booking status after clicking BOOK USING CREDITS...`);
      const bookingState = await page.evaluate(() => {
        // Look for success messages
        const bodyText = document.body.textContent || '';
        const hasSuccess = bodyText.toLowerCase().includes('success') ||
                           bodyText.toLowerCase().includes('booked') ||
                           bodyText.toLowerCase().includes('confirmed');
        
        // Check if modal closed or if we're on a different screen
        const modal = document.querySelector('[class*="modal"], [class*="dialog"], [class*="overlay"]');
        const modalOpen = modal && modal.offsetParent !== null;
        
        return {
          hasSuccess,
          modalOpen
        };
      }).catch(() => ({ hasSuccess: false, modalOpen: true }));
      
      if (bookingState.hasSuccess || !bookingState.modalOpen) {
        dlog(`✓ Booking appears to be successful! Closing browser immediately...`);
        // Close browser immediately after successful booking
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        return { bookingComplete: true, hasSuccess: true };
      }
      
      // Return the booking state so we can conditionally skip Charge step
      return bookingState;
    });

    // Step 15: Click Charge button (only if booking hasn't completed yet)
    // When using credits, the booking might complete immediately without needing to charge
    await step("Click Charge", async () => {
      dlog(`Checking if Charge button is needed...`);
      
      // Wait a bit more to see if booking completed or if Charge button appears
      await sleep(3000);
      
      // Check if booking is already complete
      const finalCheck = await page.evaluate(() => {
        // Look for success messages
        const bodyText = document.body.textContent || '';
        const hasSuccess = bodyText.toLowerCase().includes('success') ||
                           bodyText.toLowerCase().includes('booked') ||
                           bodyText.toLowerCase().includes('confirmed') ||
                           bodyText.toLowerCase().includes('complete');
        
        // Check if modal closed
        const modal = document.querySelector('[class*="modal"], [class*="dialog"], [class*="overlay"]');
        const modalOpen = modal && modal.offsetParent !== null;
        
        // Look for Charge button
        const chargeButton = Array.from(document.querySelectorAll('button')).find(btn => 
          (btn.textContent?.includes('Charge') || btn.getAttribute('aria-label')?.includes('Charge')) &&
          btn.offsetParent !== null
        );
        
        return {
          hasSuccess,
          modalOpen,
          hasChargeButton: chargeButton !== undefined,
          chargeButtonVisible: chargeButton !== undefined && chargeButton.offsetParent !== null
        };
      }).catch(() => ({ hasSuccess: false, modalOpen: true, hasChargeButton: false, chargeButtonVisible: false }));
      
      if (finalCheck.hasSuccess || !finalCheck.modalOpen) {
        dlog(`✓ Booking appears to be complete - skipping Charge step`);
        dlog(`  Success: ${finalCheck.hasSuccess}, Modal open: ${finalCheck.modalOpen}`);
        return; // Skip Charge step - booking is complete
      }
      
      if (!finalCheck.chargeButtonVisible) {
        dlog(`⚠ Charge button not found or not visible - booking may already be complete`);
        dlog(`  Checking for alternative completion indicators...`);
        
        // Wait a bit more and check again
        await sleep(2000);
        const finalCheck2 = await page.evaluate(() => {
          const bodyText = document.body.textContent || '';
          return bodyText.toLowerCase().includes('success') ||
                 bodyText.toLowerCase().includes('booked') ||
                 bodyText.toLowerCase().includes('confirmed');
        }).catch(() => false);
        
        if (finalCheck2) {
          dlog(`✓ Booking confirmed - skipping Charge step`);
          return;
        }
      }
      
      dlog(`Charge button needed - attempting to click...`);
      await clickElement(page, [
        '::-p-aria(Charge MX$ 0)',
        'div.final-price-calculation-section > button',
        '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/app-floating-pos/div/div[2]/div[2]/div[2]/button)',
        ':scope >>> div.final-price-calculation-section > button',
        '::-p-text(Charge  MX$ 0)'
      ], { offset: { x: 108, y: 19.5 } });
      
      dlog(`Charge button clicked, waiting for booking to be processed...`);
      await sleep(500); // Optimized: reduced wait time
      
      // Check immediately if booking is confirmed
      const immediateCheck = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        const hasSuccess = bodyText.toLowerCase().includes('success') ||
                           bodyText.toLowerCase().includes('booked') ||
                           bodyText.toLowerCase().includes('confirmed');
        const modal = document.querySelector('[class*="modal"], [class*="dialog"], [class*="overlay"]');
        const modalOpen = modal && modal.offsetParent !== null;
        return { hasSuccess, modalOpen };
      }).catch(() => ({ hasSuccess: false, modalOpen: true }));
      
      if (immediateCheck.hasSuccess || !immediateCheck.modalOpen) {
        dlog(`✓ Booking confirmed immediately after Charge! Closing browser...`);
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        return; // Exit early - booking complete
      }
      
      // Wait for booking confirmation/success indicators (optimized: reduced attempts)
      dlog(`Checking for booking confirmation...`);
      
      let bookingConfirmed = false;
      let confirmationMessage = null;
      let bookingId = null;
      
      // Wait up to 5 seconds for confirmation (optimized: reduced from 15 seconds)
      for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(1000);
        
        const status = await page.evaluate(() => {
          // Check for success messages
          const successMessages = document.querySelectorAll(
            'div[class*="success"], ' +
            'div[class*="confirmation"], ' +
            'div[class*="completed"], ' +
            '[class*="alert-success"], ' +
            '[class*="message-success"]'
          );
          
          let message = null;
          for (const msg of successMessages) {
            if (msg.offsetParent !== null) {
              const text = msg.textContent || '';
              if (text.toLowerCase().includes('success') || 
                  text.toLowerCase().includes('booked') ||
                  text.toLowerCase().includes('confirmed') ||
                  text.toLowerCase().includes('complete')) {
                message = text.substring(0, 200);
                break;
              }
            }
          }
          
          // Check if Charge button is disabled/gone (indicates processing)
          const chargeButton = document.querySelector('button:has-text("Charge"), [aria-label*="Charge"]');
          const buttonGone = chargeButton === null || chargeButton.offsetParent === null;
          
          // Check for booking ID or reference number
          const pageText = document.body.textContent || '';
          const bookingIdMatch = pageText.match(/booking[:\s#]*(\d+)/i) || 
                                 pageText.match(/reference[:\s#]*(\d+)/i) ||
                                 pageText.match(/confirmation[:\s#]*(\d+)/i);
          
          return {
            message: message,
            buttonGone: buttonGone,
            bookingId: bookingIdMatch ? bookingIdMatch[1] : null,
            hasSuccess: message !== null
          };
        }).catch(() => ({ message: null, buttonGone: false, bookingId: null, hasSuccess: false }));
        
        if (status.hasSuccess) {
          bookingConfirmed = true;
          confirmationMessage = status.message;
          bookingId = status.bookingId;
          dlog(`✓ Booking confirmed! Closing browser immediately...`);
          dlog(`  Confirmation message: ${confirmationMessage || 'Found in page'}`);
          if (bookingId) {
            dlog(`  Booking ID: ${bookingId}`);
          }
          // Close browser immediately after confirmation
          await page.close().catch(() => {});
          await browser.close().catch(() => {});
          break;
        }
        
        if (status.buttonGone && attempt > 1) {
          dlog(`Charge button disappeared (attempt ${attempt + 1}/5), booking may be processing...`);
        }
        
        dlog(`Waiting for confirmation... (attempt ${attempt + 1}/5)`);
      }
      
      if (!bookingConfirmed) {
        dlog(`⚠ No explicit confirmation message found after 5 seconds, but booking may still be successful. Closing browser...`);
        // Close browser even if no explicit confirmation (booking likely completed)
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
        dlog(`Checking page state...`);
        
        // Final check - take a screenshot and log page state
        const finalState = await page.evaluate(() => {
          return {
            url: window.location.href,
            title: document.title,
            hasError: document.body.textContent?.toLowerCase().includes('error') || false,
            hasSuccess: document.body.textContent?.toLowerCase().includes('success') || false,
            hasBooking: document.body.textContent?.toLowerCase().includes('booked') || false,
            pageText: document.body.textContent?.substring(0, 500) || ''
          };
        }).catch(() => ({}));
        
        dlog(`  Page URL: ${finalState.url || 'unknown'}`);
        dlog(`  Page title: ${finalState.title || 'unknown'}`);
        dlog(`  Has error: ${finalState.hasError || false}`);
        dlog(`  Has success: ${finalState.hasSuccess || false}`);
        dlog(`  Has booking: ${finalState.hasBooking || false}`);
        
        if (DEBUG) {
          await page.screenshot({ path: '/tmp/booking-final-state.png', fullPage: true });
          dlog(`  Screenshot saved to /tmp/booking-final-state.png`);
        }
      }
      
      await sleep(2000);
    });

    // Step 16: Verify booking appears in reservations list
    let bookingVerified = false;
    let bookingFoundInReservations = false;
    let reservationDetails = null;
    
    await step("Verify booking in reservations", async () => {
      dlog(`Verifying booking appears in reservations list...`);
      
      try {
        // Navigate to reservations page
        // Common URLs: /reservations, /bookings, /appointments, /schedule
        const possibleUrls = [
          "https://partners.gokenko.com/reservations",
          "https://partners.gokenko.com/bookings",
          "https://partners.gokenko.com/appointments",
          "https://partners.gokenko.com/schedule",
          "https://partners.gokenko.com/dashboard/reservations"
        ];
        
        let reservationsPageFound = false;
        for (const url of possibleUrls) {
          try {
            dlog(`Trying to navigate to: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 });
            await sleep(2000);
            
            // Check if we're on a valid reservations page
            const pageTitle = await page.title().catch(() => '');
            const pageUrl = page.url();
            dlog(`  Page title: ${pageTitle}`);
            dlog(`  Current URL: ${pageUrl}`);
            
            // Look for reservations/booking indicators
            const hasReservationsContent = await page.evaluate(() => {
              const bodyText = document.body.textContent || '';
              return bodyText.toLowerCase().includes('reservation') ||
                     bodyText.toLowerCase().includes('booking') ||
                     bodyText.toLowerCase().includes('appointment') ||
                     bodyText.toLowerCase().includes('schedule');
            }).catch(() => false);
            
            if (hasReservationsContent || pageUrl.includes('reservation') || pageUrl.includes('booking')) {
              reservationsPageFound = true;
              dlog(`✓ Found reservations page at: ${url}`);
              break;
            }
          } catch (e) {
            dlog(`  Could not access ${url}: ${e?.message}`);
            continue;
          }
        }
        
        if (!reservationsPageFound) {
          dlog(`⚠ Could not find reservations page - trying to navigate from current page`);
          // Try clicking on a reservations link if we're still logged in
          try {
            const reservationLinks = await page.$$('a[href*="reservation"], a[href*="booking"], a[href*="appointment"]');
            if (reservationLinks.length > 0) {
              dlog(`Found ${reservationLinks.length} reservation links, clicking first one...`);
              await reservationLinks[0].click();
              await sleep(3000);
              reservationsPageFound = true;
            }
          } catch (e) {
            dlog(`Could not navigate via links: ${e?.message}`);
          }
        }
        
        if (reservationsPageFound) {
          // Wait for reservations list to load
          await sleep(3000);
          
          // Search for the booking in the reservations list
          // Look for the gym name, date, and time
          const searchDate = new Date(targetDate).toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: 'numeric' 
          });
          
          dlog(`Searching for booking with:`);
          dlog(`  Gym: ${gymName}`);
          dlog(`  Date: ${targetDate} (formatted: ${searchDate})`);
          dlog(`  Time: ${targetTime}`);
          
          const bookingSearch = await page.evaluate((gymName, targetDate, targetTime, searchDate) => {
            const bodyText = document.body.textContent || '';
            const pageHTML = document.body.innerHTML || '';
            
            // Check if gym name appears
            const hasGymName = bodyText.toLowerCase().includes(gymName.toLowerCase());
            
            // Check for date (try multiple formats)
            const dateFormats = [
              targetDate, // 2025-11-25
              searchDate, // Nov 25, 2025
              targetDate.replace(/-/g, '/'), // 2025/11/25
              targetDate.split('-').reverse().join('/'), // 25/11/2025
            ];
            const hasDate = dateFormats.some(date => bodyText.includes(date));
            
            // Check for time
            const hasTime = bodyText.toLowerCase().includes(targetTime.toLowerCase());
            
            // Try to find reservation elements
            const reservationElements = Array.from(document.querySelectorAll(
              'div[class*="reservation"], ' +
              'div[class*="booking"], ' +
              'div[class*="appointment"], ' +
              'tr[class*="reservation"], ' +
              'tr[class*="booking"], ' +
              'li[class*="reservation"], ' +
              'li[class*="booking"]'
            ));
            
            // Check each reservation element for our booking details
            let matchingReservation = null;
            for (const element of reservationElements) {
              const elementText = element.textContent || '';
              const hasGym = elementText.toLowerCase().includes(gymName.toLowerCase());
              const hasDateMatch = dateFormats.some(date => elementText.includes(date));
              const hasTimeMatch = elementText.toLowerCase().includes(targetTime.toLowerCase());
              
              if (hasGym && (hasDateMatch || hasTimeMatch)) {
                matchingReservation = {
                  text: elementText.substring(0, 200),
                  html: element.innerHTML.substring(0, 500)
                };
                break;
              }
            }
            
            return {
              hasGymName,
              hasDate,
              hasTime,
              hasAllDetails: hasGymName && hasDate && hasTime,
              matchingReservation: matchingReservation,
              pageText: bodyText.substring(0, 1000)
            };
          }, gymName, targetDate, targetTime, searchDate).catch(() => ({
            hasGymName: false,
            hasDate: false,
            hasTime: false,
            hasAllDetails: false,
            matchingReservation: null,
            pageText: ''
          }));
          
          dlog(`Booking search results:`);
          dlog(`  Has gym name: ${bookingSearch.hasGymName}`);
          dlog(`  Has date: ${bookingSearch.hasDate}`);
          dlog(`  Has time: ${bookingSearch.hasTime}`);
          dlog(`  Has all details: ${bookingSearch.hasAllDetails}`);
          
          if (bookingSearch.matchingReservation) {
            dlog(`✓ Found matching reservation element!`);
            dlog(`  Reservation text: ${bookingSearch.matchingReservation.text.substring(0, 150)}`);
            bookingFoundInReservations = true;
            reservationDetails = bookingSearch.matchingReservation;
          } else if (bookingSearch.hasAllDetails) {
            dlog(`✓ Found all booking details on page (gym, date, time)`);
            bookingFoundInReservations = true;
            reservationDetails = { text: bookingSearch.pageText.substring(0, 300) };
          } else {
            dlog(`⚠ Booking details not found in reservations list`);
            dlog(`  Page text preview: ${bookingSearch.pageText.substring(0, 200)}`);
            
            if (DEBUG) {
              await page.screenshot({ path: '/tmp/reservations-page.png', fullPage: true });
              dlog(`  Screenshot saved to /tmp/reservations-page.png`);
            }
          }
        } else {
          dlog(`⚠ Could not access reservations page to verify booking`);
        }
        
        bookingVerified = true;
      } catch (err) {
        dlog(`⚠ Error verifying booking in reservations: ${err?.message}`);
        dlog(`  Stack: ${err?.stack}`);
        // Don't fail the whole booking if verification fails
      }
    });

    // Browser may already be closed if booking completed successfully
    // Only close here if it wasn't closed earlier (safe to call multiple times)
    try {
      await page.close().catch(() => {});
    } catch (e) {
      // Page may already be closed
    }
    try {
      await browser.close().catch(() => {});
    } catch (e) {
      // Browser may already be closed
    }

    // Log final click summary
    logToFile(`\n[CLICK SUMMARY] Total clicks performed: ${clickCounter}`);
    logToFile(`[CLICK SUMMARY] Click log entries: ${clickLog.length}`);
    if (clickLog.length > 0) {
      logToFile(`[CLICK SUMMARY] Last 10 clicks:`);
      clickLog.slice(-10).forEach(log => {
        logToFile(`  #${log.count} - ${log.location} (${log.method})`);
      });
    }
    
    return {
      ok: true,
      message: `Successfully booked class for ${CUSTOMER_NAME} on ${targetDate} at ${targetTime}`,
      verified: bookingVerified,
      foundInReservations: bookingFoundInReservations,
      clickCount: clickCounter,
      clickLog: clickLog.slice(-20), // Include last 20 clicks in response
      ...(reservationDetails ? { reservationDetails } : {}),
      ...(screenshots.length > 0 ? { screenshots } : {})
    };

  } catch (err) {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    return {
      ok: false,
      error: err?.message || String(err),
      ...(screenshots.length > 0 ? { screenshots } : {})
    };
  }
}

// Health check endpoint - must respond quickly for Railway healthcheck
// This MUST be defined before server.listen() is called
app.get("/", (_req, res) => {
  console.log("Healthcheck endpoint hit");
  res.status(200).send("✅ Booking scraper API online");
});

// Additional healthcheck endpoint for Railway
app.get("/health", (_req, res) => {
  console.log("Health endpoint hit");
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Screenshot endpoints - serve screenshots from /tmp directory
app.get("/screenshots", (req, res) => {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('screenshot-') && f.endsWith('.png'))
      .sort()
      .reverse(); // Most recent first
    res.json({ 
      screenshots: files,
      count: files.length,
      directory: LOG_DIR
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/screenshots/:filename", (req, res) => {
  const filename = req.params.filename;
  // Security: only allow screenshot files
  if (!filename.startsWith('screenshot-') || !filename.endsWith('.png')) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  
  const filePath = path.join(LOG_DIR, filename);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "Screenshot not found" });
  }
});

// Booking endpoint
app.post("/book", async (req, res) => {
  console.log(`[REQ] POST /book body=`, JSON.stringify(req.body || {}));

  const done = { sent: false };
  const watchdog = setTimeout(() => {
    if (!done.sent) {
      done.sent = true;
      res.status(202).json({
        ok: false,
        pending: true,
        message: "Job still running; check logs for progress."
      });
    }
  }, 55000);

  try {
    const {
      email,
      password,
      gymName,
      targetDate, // Format: YYYY-MM-DD
      targetTime, // Format: HH:mm or "8:00 am"
      debug = false
    } = req.body || {};

    if (!email || !password || !gymName || !targetDate || !targetTime) {
      if (!done.sent) {
        clearTimeout(watchdog);
        done.sent = true;
        return res.status(400).json({
          ok: false,
          error: "Missing required fields: email, password, gymName, targetDate, targetTime"
        });
      }
      return;
    }

    const result = await bookClass({
      email,
      password,
      gymName,
      targetDate,
      targetTime,
      DEBUG: !!debug
    });

    if (!done.sent) {
      clearTimeout(watchdog);
      done.sent = true;
      if (result.ok) {
        return res.json(result);
      }
      return res.status(500).json(result);
    }
  } catch (err) {
    if (!done.sent) {
      clearTimeout(watchdog);
      done.sent = true;
      return res.status(500).json({
        ok: false,
        error: String(err?.message || err)
      });
    }
  }
});

// Error handlers - log but allow server to continue
process.on("unhandledRejection", (e) => {
  console.error("❌ unhandledRejection:", e);
});

process.on("uncaughtException", (e) => {
  console.error("❌ uncaughtException:", e);
  console.error("Stack:", e.stack);
  // Log the error but don't exit - Railway will restart if needed
});

// Start server
const port = process.env.PORT || 3000;
const host = "0.0.0.0";

console.log(`📡 Attempting to start server on ${host}:${port}...`);

// Start the server with explicit error handling
try {
  const server = app.listen(port, host, () => {
    console.log(`🚀 Booking scraper API running on ${host}:${port}`);
    console.log(`✅ Healthcheck endpoint available at http://${host}:${port}/`);
    console.log(`✅ Server is ready to accept connections`);
  });

  // Handle server errors
  server.on('error', (error) => {
    console.error("❌ Server error:", error);
    console.error("Error code:", error.code);
    console.error("Error message:", error.message);
    // Log but don't exit - Railway will handle restarts
  });

  // Log when server is listening
  server.on('listening', () => {
    console.log(`✅ Server is listening on ${host}:${port}`);
  });

  console.log(`✅ Server startup initiated`);
} catch (error) {
  console.error("❌ Failed to start server:", error);
  console.error("Stack:", error.stack);
  // Don't exit - let Railway see the error and restart
}

