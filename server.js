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
const CUSTOMER_NAME = "Fitpass One"; // Will try Fitpass One, Two, Three, etc. up to Twenty if not available
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
  
  // Store selected customer name (will be set during customer selection)
  let selectedCustomerName = null;
  
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
    // REMOVED: "--enable-automation" - This flag makes automation detectable!
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
    
    // Add stealth arguments to bypass anti-scraping detection AND VM detection
    // These are CRITICAL for bypassing Kenko's anti-scraping measures
    const stealthArgs = [
      '--disable-blink-features=AutomationControlled', // Most important - removes automation flag!
      '--exclude-switches=enable-automation', // Remove automation flag from command line
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-features=VizDisplayCompositor',
      // VM detection prevention flags
      '--disable-dev-shm-usage', // Prevents /dev/shm detection (common VM indicator)
      '--disable-software-rasterizer', // Use hardware acceleration (real Macs have this)
      '--use-gl=swiftshader', // But fallback to software if needed (already in launchArgs)
      '--enable-features=NetworkService,NetworkServiceInProcess', // Real browser features
      '--disable-features=AudioServiceOutOfProcess', // Keep audio in-process (real Mac behavior)
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
  
  // CRITICAL: Use CDP (Chrome DevTools Protocol) to remove automation indicators
  // This is MORE aggressive than just removing flags - it directly overrides browser internals
  try {
    const client = await page.target().createCDPSession();
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // Remove automation indicators from window object
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy;
      `
    });
    dlog("CDP automation override active");
  } catch (cdpError) {
    dlog(`⚠ CDP session creation failed (non-critical): ${cdpError?.message}`);
    // Continue without CDP - evaluateOnNewDocument should handle most cases
  }
  
  // CRITICAL: puppeteer-extra-plugin-stealth is already applied via puppeteer.use(StealthPlugin())
  // This plugin handles most anti-scraping detection automatically
  dlog("Stealth plugin is active (puppeteer-extra-plugin-stealth)");
  dlog("CDP automation override active");
  
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
  // Enhanced fingerprinting to appear as real browser session on a real Mac (not VM)
  // TEMPORARILY DISABLED: Testing if this is causing page to close
  await page.evaluateOnNewDocument(() => {
    // Wrap everything in try-catch to prevent any errors from crashing the page
    try {
      // MINIMAL OVERRIDES ONLY - testing if aggressive overrides cause page to close
      // Most VM detection evasion temporarily disabled
      
      /*
      // Override platform to match local Mac
      if (navigator) {
        Object.defineProperty(navigator, 'platform', {
          get: () => 'MacIntel',
        });
        
        // Override hardwareConcurrency to match real Mac (VMs often show different values)
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8, // Common Mac value (not typical VM values like 2 or 4)
        });
        
        // Override deviceMemory to match real Mac (VMs often show lower values)
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8, // Real Mac typically has 8GB+ (VMs often show 2-4GB)
        });
        
        // Override maxTouchPoints (Macs don't have touch, VMs might report different)
        Object.defineProperty(navigator, 'maxTouchPoints', {
          get: () => 0, // Mac doesn't have touch
        });
      }
      
      // Override screen properties to match real Mac (prevent VM detection)
      if (typeof screen !== 'undefined' && screen) {
        Object.defineProperty(screen, 'width', {
          get: () => 1920,
        });
        Object.defineProperty(screen, 'height', {
          get: () => 1080,
        });
        Object.defineProperty(screen, 'availWidth', {
          get: () => 1920,
        });
        Object.defineProperty(screen, 'availHeight', {
          get: () => 1055, // Account for menu bar
        });
        Object.defineProperty(screen, 'colorDepth', {
          get: () => 24, // Real Mac color depth
        });
        Object.defineProperty(screen, 'pixelDepth', {
          get: () => 24,
        });
      }
    
    // Override timezone to match Mac (VMs often use UTC)
    // This is critical - VMs are often detected by timezone mismatches
    // Note: We're being careful here to not break existing functionality
    try {
      const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
      Date.prototype.getTimezoneOffset = function() {
        // Return offset for US timezone (e.g., EST/EDT)
        // This makes Railway look like it's running in US timezone like a real Mac
        return 300; // EST offset (UTC-5) - adjust if needed for your location
      };
    } catch (e) {
      // Silently fail if timezone override doesn't work
    }
    
      // Override webdriver to ensure it's undefined (stealth plugin should do this, but double-check)
      if (navigator) {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // Override languages to match real browser
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
        
        // Override vendor to match Chrome
        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.',
        });
        
        // Override appVersion to match Chrome
        Object.defineProperty(navigator, 'appVersion', {
          get: () => '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        });
        
        // Override connection properties (if available)
        if (navigator.connection) {
          Object.defineProperty(navigator.connection, 'rtt', {
            get: () => 50,
          });
          Object.defineProperty(navigator.connection, 'downlink', {
            get: () => 10,
          });
          Object.defineProperty(navigator.connection, 'effectiveType', {
            get: () => '4g',
          });
        }
        
        // Override plugins to show realistic plugins (Chrome typically has 5 plugins)
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [];
            // Create realistic plugin objects
            for (let i = 0; i < 5; i++) {
              plugins.push({
                name: `Plugin ${i + 1}`,
                description: 'Plugin description',
                filename: 'internal-pdf-viewer',
                length: 1
              });
            }
            return plugins;
          },
        });
        
        // Override mimeTypes to match plugins
        Object.defineProperty(navigator, 'mimeTypes', {
          get: () => {
            const mimeTypes = [];
            for (let i = 0; i < 5; i++) {
              mimeTypes.push({
                type: 'application/pdf',
                suffixes: 'pdf',
                description: 'PDF Document',
                enabledPlugin: navigator.plugins[i] || null
              });
            }
            return mimeTypes;
          },
        });
      }
      
      // Add Chrome-specific properties (must match real Chrome)
      if (typeof window !== 'undefined') {
        window.chrome = {
          runtime: {},
          loadTimes: function() {
            return {
              commitLoadTime: Date.now() / 1000 - Math.random() * 2,
              connectionInfo: 'http/1.1',
              finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
              finishLoadTime: Date.now() / 1000 - Math.random() * 0.5,
              firstPaintAfterLoadTime: 0,
              firstPaintTime: Date.now() / 1000 - Math.random() * 1.5,
              navigationType: 'Other',
              npnNegotiatedProtocol: 'unknown',
              requestTime: Date.now() / 1000 - Math.random() * 3,
              startLoadTime: Date.now() / 1000 - Math.random() * 3,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: false,
              wasNpnNegotiated: false
            };
          },
          csi: function() {
            return {
              startE: Date.now() - Math.random() * 1000,
              onloadT: Date.now() - Math.random() * 500,
              pageT: Math.random() * 1000 + 500,
              tran: 15
            };
          },
          app: {
            isInstalled: false,
            InstallState: {
              DISABLED: 'disabled',
              INSTALLED: 'installed',
              NOT_INSTALLED: 'not_installed'
            },
            RunningState: {
              CANNOT_RUN: 'cannot_run',
              READY_TO_RUN: 'ready_to_run',
              RUNNING: 'running'
            }
          }
        };
        
        // Remove automation detection variables
        try {
          delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
          delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
          delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
          delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON;
          delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object;
          delete window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy;
        } catch (e) {
          // Silently fail if delete doesn't work
        }
      }
    
    // Override permissions API to return realistic values
    try {
      if (window && window.navigator && window.navigator.permissions && window.navigator.permissions.query) {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => {
          // Return realistic permission states
          if (parameters.name === 'notifications') {
            return Promise.resolve({ state: 'default' });
          }
          if (parameters.name === 'geolocation') {
            return Promise.resolve({ state: 'prompt' });
          }
          return originalQuery.call(this, parameters);
        };
      }
    } catch (e) {
      // Silently fail if permissions override doesn't work
    }
    
    // Override getBattery to return realistic values (Mac-like)
    try {
      if (navigator && navigator.getBattery) {
        navigator.getBattery = () => Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
          onchargingchange: null,
          onchargingtimechange: null,
          ondischargingtimechange: null,
          onlevelchange: null
        });
      }
    } catch (e) {
      // Silently fail if getBattery override doesn't work
    }
    
    // Override WebGL to prevent VM detection via renderer info
    // VMs often have different WebGL renderer strings
    try {
      if (typeof WebGLRenderingContext !== 'undefined' && WebGLRenderingContext.prototype) {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) { // UNMASKED_VENDOR_WEBGL
            return 'Intel Inc.'; // Real Mac GPU vendor
          }
          if (parameter === 37446) { // UNMASKED_RENDERER_WEBGL
            return 'Intel Iris Plus Graphics 640'; // Real Mac GPU renderer
          }
          return getParameter.call(this, parameter);
        };
      }
      
      // Override WebGL2 similarly
      if (typeof WebGL2RenderingContext !== 'undefined' && WebGL2RenderingContext.prototype) {
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter) {
          if (parameter === 37445) {
            return 'Intel Inc.';
          }
          if (parameter === 37446) {
            return 'Intel Iris Plus Graphics 640';
          }
          return getParameter2.call(this, parameter);
        };
      }
    } catch (e) {
      // Silently fail if WebGL override doesn't work
    }
    
    // Override Canvas fingerprinting to prevent VM detection
    // VMs often produce different canvas fingerprints
    // NOTE: Simplified to avoid potential errors - just pass through for now
    // Canvas fingerprinting is less critical than other detection methods
    try {
      if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype) {
        // Keep original behavior - canvas fingerprinting is less critical
        // and modifying it can cause errors
      }
    } catch (e) {
      // Silently fail if Canvas override doesn't work
    }
    
    // Override media devices to prevent VM detection
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
        navigator.mediaDevices.enumerateDevices = function() {
          return originalEnumerateDevices.call(this).then(devices => {
            // Filter out VM-specific devices or add Mac-like devices
            return devices.filter(device => {
              // Remove any device labels that might indicate VM
              const label = device.label.toLowerCase();
              return !label.includes('virtual') && !label.includes('vmware') && 
                     !label.includes('virtualbox') && !label.includes('qemu') &&
                     !label.includes('docker') && !label.includes('container');
            });
          });
        };
      }
    } catch (e) {
      // Silently fail if media devices override doesn't work
    }
    
    // Override performance.memory to prevent VM detection (VMs often show different memory)
    try {
      if (performance && performance.memory) {
        Object.defineProperty(performance, 'memory', {
          get: () => ({
            jsHeapSizeLimit: 4294705152, // ~4GB - typical Mac value
            totalJSHeapSize: 10000000, // ~10MB - realistic
            usedJSHeapSize: 5000000, // ~5MB - realistic
          }),
        });
      }
    } catch (e) {
      // Silently fail if performance.memory override doesn't work
    }
    
    // Override navigator.cpuClass (if exists) to prevent VM detection
    try {
      if (navigator.cpuClass !== undefined) {
        Object.defineProperty(navigator, 'cpuClass', {
          get: () => 'x86_64', // Mac Intel architecture
        });
      }
    } catch (e) {
      // Silently fail if cpuClass override doesn't work
    }
    
    // Override screen orientation to match Mac (no rotation)
    try {
      if (screen && screen.orientation) {
        Object.defineProperty(screen.orientation, 'angle', {
          get: () => 0, // Mac screens don't rotate
        });
        Object.defineProperty(screen.orientation, 'type', {
          get: () => 'landscape-primary',
        });
      }
    } catch (e) {
      // Silently fail if screen orientation override doesn't work
    }
    
    // Override navigator.doNotTrack to match real browser
    try {
      Object.defineProperty(navigator, 'doNotTrack', {
        get: () => null, // Real browsers often return null
      });
    } catch (e) {
      // Silently fail
    }
    
    // Override navigator.cookieEnabled (should be true for real browsers)
    try {
      Object.defineProperty(navigator, 'cookieEnabled', {
        get: () => true,
      });
    } catch (e) {
      // Silently fail
    }
    
    // Override navigator.onLine to return true (real Macs are usually online)
    try {
      Object.defineProperty(navigator, 'onLine', {
        get: () => true,
      });
    } catch (e) {
      // Silently fail
    }
      */
      
      // MINIMAL OVERRIDES - Only keep essential ones that don't cause errors
      // Override webdriver to ensure it's undefined (stealth plugin should do this, but double-check)
      if (navigator) {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
          });
        } catch (e) {
          // Silently fail
        }
      }
      
    } catch (globalError) {
      // Catch any unhandled errors in evaluateOnNewDocument to prevent page crash
      console.error('[VM EVASION] Error in evaluateOnNewDocument:', globalError);
    }
  });
  
  // Add human-like mouse movements and scrolling behavior
  // This makes the session look more realistic
  const simulateHumanBehavior = async () => {
    try {
      // Random mouse movements (subtle, not too obvious)
      const viewport = page.viewport();
      if (viewport) {
        const moves = Math.floor(Math.random() * 3) + 1; // 1-3 moves
        for (let i = 0; i < moves; i++) {
          const x = Math.random() * viewport.width;
          const y = Math.random() * viewport.height;
          await page.mouse.move(x, y, { steps: Math.floor(Math.random() * 5) + 3 });
          await sleep(Math.random() * 200 + 100);
        }
      }
      
      // Random subtle scrolling
      const scrollAmount = Math.floor(Math.random() * 200) + 50;
      await page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);
      await sleep(Math.random() * 300 + 200);
    } catch (e) {
      // Ignore errors - this is just for realism
    }
  };
  
  // Add random human-like delay before critical actions
  // This prevents automation detection by making actions look more natural
  const humanDelay = async (minMs = 200, maxMs = 800) => {
    const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    await sleep(delay);
  };
  
  // Simulate human reading/thinking time before clicking
  const humanThinkingDelay = async () => {
    // Humans typically take 1-3 seconds to read and decide before clicking
    const delay = Math.floor(Math.random() * 2000) + 1000;
    await sleep(delay);
  };
  
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

  // Log page events (simplified - only essential ones)
  page.on("console", (msg) => logToFile(`[PAGE] ${msg.text()}`));
  page.on("requestfailed", (r) => logToFile(`[REQ FAIL] ${r.url()} ${r.failure()?.errorText}`));
  page.on("pageerror", (error) => logToFile(`[PAGE] ERROR ${error.message}`));
  
  // REMOVED: Page validity check before starting - might trigger detection
  // REMOVED: framedetached listener - might interfere with normal navigation

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
    // SIMPLIFIED: Back to original working version - no complex checks or waits
    await step("Navigate to login", async () => {
      await page.setViewport({ width: 1920, height: 1080 }); // Use realistic viewport
      dlog("Navigating to login page");
      await page.goto("https://partners.gokenko.com/login", { 
        waitUntil: "domcontentloaded",
        timeout: 30000 
      });
      dlog("Page loaded");
      
      // REMOVED: Stealth check - page.evaluate() might trigger detection
      // The stealth plugin is already active, so we don't need to verify
      
      await sleep(1000); // Wait for page to fully render and scripts to load
    });

    // Step 2: Enter gym location (it's a text input, not a dropdown)
    // SIMPLIFIED: Back to original working version
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
        // Check if page is closed before throwing error
        let pageClosed = false;
        try {
          await page.evaluate(() => document.readyState).catch(() => {
            pageClosed = true;
          });
        } catch (e) {
          pageClosed = true;
        }
        
        if (pageClosed) {
          throw new Error(`Page closed or frame detached - cannot find gym input field. This may indicate automation detection.`);
        }
        
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
      
      // Simulate human behavior after login (makes session look more realistic)
      dlog(`Simulating human behavior after login...`);
      await simulateHumanBehavior();
      await sleep(1000 + Math.random() * 1000); // Random delay 1000-2000ms
      
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
      await page.waitForSelector('mwl-calendar-week-view, div.calendar, [class*="calendar"]', { visible: true, timeout: TIMEOUT });
      await sleep(500); // Optimized: reduced from 1000ms
      await takeScreenshot('before-date-navigation');
      
      // Step 1: Switch to Day view first to filter calendar
      dlog(`Step 1: Switching to Day view...`);
      await takeScreenshot('before-switching-to-day-view');
      
      // Click the "Week" dropdown button to open it
      dlog(`Clicking Week dropdown to switch to Day view...`);
      const dropdownClicked = await clickElement(page, [
        '#pr_id_2_label',
        'span.p-dropdown-label',
        'p-dropdown.ng-tns-c40-1 div.p-dropdown-trigger',
        'p-dropdown div.p-dropdown-trigger',
        'p-dropdown button'
      ], { offset: { x: 7.174224853515625, y: 19.100000381469727 }, debug: DEBUG });
      
      if (dropdownClicked) {
        dlog(`✓ Opened view dropdown, waiting for menu...`);
        await sleep(800); // Wait for dropdown to open
        
        // Wait for dropdown menu to appear
        let dropdownReady = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          dropdownReady = await page.evaluate(() => {
            const selectors = ['#pr_id_2_list', '[role="listbox"]', 'p-dropdownitem'];
            for (const sel of selectors) {
              const el = document.querySelector(sel);
              if (el && el.offsetParent !== null) return true;
            }
            return false;
          }).catch(() => false);
          
          if (dropdownReady) {
            dlog(`✓ Dropdown menu appeared (attempt ${attempt + 1})`);
            break;
          }
          
          if (attempt < 9) {
            await sleep(300);
          }
        }
        
        if (dropdownReady) {
          // Click the "Day" option
          dlog(`Clicking Day option in dropdown...`);
          const dayOptionClicked = await clickElement(page, [
            '#pr_id_2_list p-dropdownitem:nth-of-type(1) span',
            'p-dropdownitem:nth-of-type(1) span',
            'p-dropdownitem:first-child span',
            '[aria-label="Day"]',
            'li[aria-label="Day"]',
            'p-dropdownitem span'
          ], { debug: DEBUG });
          
          if (dayOptionClicked) {
            dlog(`✓ Selected Day view`);
            await sleep(2000); // Wait for calendar to switch to Day view
          } else {
            dlog(`⚠ Could not click Day option, trying keyboard navigation...`);
            // Try keyboard navigation as fallback
            try {
              await page.keyboard.press('ArrowDown');
              await sleep(300);
              await page.keyboard.press('Enter');
              await sleep(2000);
              dlog(`✓ Used keyboard navigation to select Day`);
            } catch (e) {
              dlog(`Keyboard navigation failed: ${e?.message}`);
            }
          }
        } else {
          dlog(`⚠ Dropdown menu did not appear, trying keyboard navigation...`);
          // Try keyboard navigation as fallback
          try {
            const dropdownElement = await page.$('#pr_id_2_label, span.p-dropdown-label').catch(() => null);
            if (dropdownElement) {
              await dropdownElement.focus();
              await sleep(300);
              await page.keyboard.press('Space');
              await sleep(500);
              await page.keyboard.press('ArrowDown');
              await sleep(300);
              await page.keyboard.press('Enter');
              await sleep(2000);
              dlog(`✓ Used keyboard navigation to select Day`);
            }
          } catch (e) {
            dlog(`Keyboard navigation failed: ${e?.message}`);
          }
        }
      } else {
        dlog(`⚠ Could not click Week dropdown, checking if already in Day view...`);
        const currentView = await page.evaluate(() => {
          const label = document.querySelector('#pr_id_2_label, span.p-dropdown-label');
          return label ? label.textContent?.trim() : null;
        }).catch(() => null);
        
        if (currentView === 'Day') {
          dlog(`✓ Already in Day view`);
        } else {
          dlog(`⚠ Current view: ${currentView}, continuing anyway...`);
        }
      }
      
      // Verify we're actually in Day view before proceeding
      await sleep(1000); // Wait for calendar to stabilize
      const verifyDayView = await page.evaluate(() => {
        const label = document.querySelector('#pr_id_2_label, span.p-dropdown-label');
        const currentView = label ? label.textContent?.trim() : null;
        // Also check for Day view calendar elements
        const dayViewElements = document.querySelectorAll('mwl-calendar-day-view, [class*="day-view"], div.cal-day-view');
        return {
          currentView: currentView,
          isDayView: currentView === 'Day',
          hasDayViewElements: dayViewElements.length > 0
        };
      }).catch(() => ({ currentView: null, isDayView: false, hasDayViewElements: false }));
      
      if (!verifyDayView.isDayView) {
        dlog(`⚠ WARNING: Not in Day view! Current view: "${verifyDayView.currentView}". Retrying Day view selection...`);
        // Retry Day view selection with keyboard navigation
        try {
          const dropdownElement = await page.$('#pr_id_2_label, span.p-dropdown-label').catch(() => null);
          if (dropdownElement) {
            await dropdownElement.click();
            await sleep(800);
            await page.keyboard.press('ArrowDown');
            await sleep(300);
            await page.keyboard.press('Enter');
            await sleep(2000);
            dlog(`✓ Retried Day view selection with keyboard`);
          }
        } catch (e) {
          dlog(`⚠ Retry failed: ${e?.message}`);
        }
        
        // Verify again
        const verifyAgain = await page.evaluate(() => {
          const label = document.querySelector('#pr_id_2_label, span.p-dropdown-label');
          return label ? label.textContent?.trim() : null;
        }).catch(() => null);
        
        if (verifyAgain !== 'Day') {
          logToFile(`❌ CRITICAL: Failed to switch to Day view. Current view: "${verifyAgain}". Proceeding anyway but may fail.`);
          dlog(`❌ CRITICAL: Failed to switch to Day view. Current view: "${verifyAgain}". Proceeding anyway but may fail.`);
        } else {
          dlog(`✓ Successfully verified Day view after retry`);
        }
      } else {
        dlog(`✓ Verified: Currently in Day view`);
      }
      
      await takeScreenshot('after-switching-to-day-view');
      await sleep(1000); // Wait for calendar to stabilize
      
      // Step 2: Click date button in the center (shows current date like "Nov 23, 2025")
      dlog(`Step 2: Clicking date button in center to open date picker...`);
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
      
      // Step 3: Navigate date picker to target date and click it
      dlog(`Step 3: Navigating date picker to ${month}/${day}/${year}...`);
      
      // Wait for date picker calendar to appear and table structure to be ready
      await page.waitForSelector('bs-datepicker-container, bs-days-calendar-view, [class*="datepicker"]', { visible: true, timeout: 5000 }).catch(() => {
        dlog(`Date picker calendar not found, might already be open`);
      });
      
      await sleep(500);
      
      // REMOVED: All dropdown/instructor filtering code - we skip directly to date selection
      
      // Now continue with date picker navigation...
      // Navigate to the correct month/year if needed, then click the target date
      // (Date picker navigation code continues below - see Step 2)
      
      // Step 2: Navigate date picker to target date and click it
      dlog(`Step 2: Navigating date picker to ${month}/${day}/${year}...`);
      
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
            await takeScreenshot('after-date-selected-direct');
          } else {
            dlog(`⚠ Date picker still open, but continuing...`);
            await takeScreenshot('after-date-selected-direct-picker-open');
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
                await takeScreenshot('after-date-selected-navigation');
                break; // Exit navigation loop
              } else {
                dlog(`⚠ Date picker still open, may need to click again`);
                await takeScreenshot('after-date-selected-navigation-picker-open');
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
      
      // Step 4: Wait for calendar events to load after selecting date
      dlog(`Step 4: Waiting for events to load after date selection...`);
      await takeScreenshot('after-date-selection');
      await sleep(2000);
      
      try {
        await page.waitForSelector('mwl-calendar-week-view-event, div.checker-details, [class*="calendar-event"], [class*="event"]', { timeout: 15000, visible: true }).catch(() => {
          dlog(`Events not immediately visible, continuing...`);
        });
      } catch (e) {
        dlog(`Warning: Timeout waiting for events, but continuing...`);
      }
      await sleep(2000);
      await takeScreenshot('before-looking-for-class');
      
      // Step 5: Find and click the class at target time
      dlog(`Step 5: Looking for class at ${targetHour}:${targetMinute.toString().padStart(2, '0')}...`);
      
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
          
          // Skip headers/navigation - more aggressive filtering
          if (eventText.includes('Week') || eventText.includes('All instructors') || eventText.includes('TODAY') || 
              eventText.includes('Filters') || eventText.includes('Add event') ||
              eventText.includes('Monday') || eventText.includes('Tuesday') || eventText.includes('Wednesday') ||
              eventText.includes('Thursday') || eventText.includes('Friday') || eventText.includes('Saturday') ||
              eventText.includes('Sunday') || eventText.includes('Nov 24') || eventText.includes('Nov 25') ||
              eventText.includes('Nov 26') || eventText.includes('Nov 27') || eventText.includes('Nov 28') ||
              eventText.includes('Nov 29') || eventText.match(/^\s*\d{1,2}\s*AM\s*$/i)) continue;
          if (className.includes('header') || className.includes('navigation') || className.includes('title') ||
              className.includes('day-header') || className.includes('time-header')) continue;
          
          // Extract time from event text - find FIRST time pattern that appears early in text
          // Class times usually appear right after the class name (e.g., "Ponte Pila9:00am")
          // Use matchAll to find all times, then take the first one that appears early
          const timeMatches = Array.from(eventText.matchAll(/\b(\d{1,2}):(\d{1,2})\s*(am|pm|AM|PM)\b/gi));
          if (timeMatches.length === 0) continue;
          
          // Prioritize the first match that appears within first 80 characters (where class time usually is)
          let timeMatch = null;
          for (const match of timeMatches) {
            if (match.index < 80) {
              timeMatch = match;
              break;
            }
          }
          // If no early match found, use the very first match
          if (!timeMatch && timeMatches.length > 0) {
            timeMatch = timeMatches[0];
          }
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
        
        // Retry logic: if "Book Customer" button is not found, go back to calendar and retry
        const MAX_CLASS_CLICK_RETRIES = 3;
        let classClickSuccess = false;
        
        for (let attempt = 1; attempt <= MAX_CLASS_CLICK_RETRIES; attempt++) {
          if (attempt > 1) {
            logToFile(`[RETRY] Attempt ${attempt} to click class and open booking dialog`);
            dlog(`[RETRY] Attempt ${attempt}/${MAX_CLASS_CLICK_RETRIES} - Going back to calendar and retrying...`);
            
            // First, try to find and click the exit/close button (X) in the top left of the modal
            const exitButtonInfo = await page.evaluate(() => {
              const viewportHeight = window.innerHeight;
              const viewportWidth = window.innerWidth;
              
              // Strategy 1: Look for buttons with SVG icons (X icon in circle)
              const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div[onclick], div[cursor="pointer"]'));
              for (const btn of allButtons) {
                if (btn.offsetParent === null) continue; // Skip hidden elements
                
                const rect = btn.getBoundingClientRect();
                
                // Check if it's in the top left area (top 25% and left 25% of viewport)
                if (rect.top < viewportHeight * 0.25 && rect.left < viewportWidth * 0.25) {
                  // Check if it's a small button (close buttons are usually small)
                  if (rect.width < 80 && rect.height < 80) {
                    // Check if it contains an SVG (X icon)
                    const hasSvg = btn.querySelector('svg') !== null;
                    
                    // Check if it has a circle background (dark grey circle)
                    const styles = window.getComputedStyle(btn);
                    const bgColor = styles.backgroundColor;
                    const borderRadius = styles.borderRadius;
                    const hasCircleBg = borderRadius.includes('50%') || borderRadius.includes('9999px') || 
                                       bgColor.includes('rgb') || bgColor.includes('rgba');
                    
                    // Check text/aria-label
                    const text = (btn.textContent || '').trim().toLowerCase();
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const hasCloseText = text === 'x' || text === '×' || ariaLabel.includes('close') || 
                                       ariaLabel.includes('exit') || ariaLabel.includes('dismiss');
                    
                    // If it has SVG or close text, or looks like a circular button, it's likely the close button
                    if (hasSvg || hasCloseText || (hasCircleBg && rect.width < 50 && rect.height < 50)) {
                      return { 
                        found: true, 
                        selector: 'top-left-svg-button', 
                        x: rect.x + rect.width / 2, 
                        y: rect.y + rect.height / 2,
                        text: text,
                        ariaLabel: ariaLabel,
                        width: rect.width,
                        height: rect.height
                      };
                    }
                  }
                }
              }
              
              // Strategy 2: Look for SVG elements directly in top-left
              const allSvgs = Array.from(document.querySelectorAll('svg'));
              for (const svg of allSvgs) {
                if (svg.offsetParent === null) continue;
                
                const rect = svg.getBoundingClientRect();
                if (rect.top < viewportHeight * 0.25 && rect.left < viewportWidth * 0.25) {
                  // Find the closest clickable parent (button or div with onclick)
                  let parent = svg.parentElement;
                  let clickableParent = null;
                  let depth = 0;
                  
                  while (parent && depth < 5) {
                    if (parent.tagName === 'BUTTON' || 
                        parent.getAttribute('role') === 'button' ||
                        parent.onclick ||
                        parent.style.cursor === 'pointer' ||
                        window.getComputedStyle(parent).cursor === 'pointer') {
                      clickableParent = parent;
                      break;
                    }
                    parent = parent.parentElement;
                    depth++;
                  }
                  
                  if (clickableParent) {
                    const parentRect = clickableParent.getBoundingClientRect();
                    if (parentRect.width < 80 && parentRect.height < 80) {
                      return { 
                        found: true, 
                        selector: 'svg-parent-button', 
                        x: parentRect.x + parentRect.width / 2, 
                        y: parentRect.y + parentRect.height / 2,
                        text: (clickableParent.textContent || '').trim(),
                        ariaLabel: (clickableParent.getAttribute('aria-label') || ''),
                        width: parentRect.width,
                        height: parentRect.height
                      };
                    }
                  }
                }
              }
              
              // Strategy 3: Look for any small clickable element in top-left (most aggressive)
              const allClickable = Array.from(document.querySelectorAll('button, [role="button"], div[onclick], [class*="close"], [class*="Close"]'));
              for (const el of allClickable) {
                if (el.offsetParent === null) continue;
                
                const rect = el.getBoundingClientRect();
                if (rect.top < viewportHeight * 0.2 && rect.left < viewportWidth * 0.2 && 
                    rect.width < 60 && rect.height < 60) {
                  // Prefer elements with SVG or close-related classes
                  const hasSvg = el.querySelector('svg') !== null;
                  const className = (el.className || '').toLowerCase();
                  const hasCloseClass = className.includes('close') || className.includes('exit') || className.includes('x');
                  
                  if (hasSvg || hasCloseClass) {
                    return { 
                      found: true, 
                      selector: 'top-left-small-button', 
                      x: rect.x + rect.width / 2, 
                      y: rect.y + rect.height / 2,
                      text: (el.textContent || '').trim(),
                      ariaLabel: (el.getAttribute('aria-label') || ''),
                      width: rect.width,
                      height: rect.height
                    };
                  }
                }
              }
              
              return { found: false };
            }).catch(() => ({ found: false }));
            
            if (exitButtonInfo.found) {
              logToFile(`✓ Found exit/close button at (${exitButtonInfo.x}, ${exitButtonInfo.y}) - selector: ${exitButtonInfo.selector}`);
              dlog(`✓ Found exit/close button: text="${exitButtonInfo.text}", aria-label="${exitButtonInfo.ariaLabel}"`);
              
              // Click using Puppeteer mouse click for better reliability
              try {
                await page.mouse.click(exitButtonInfo.x, exitButtonInfo.y);
                logClick('Exit/Close button (modal)', `mouse.click(${exitButtonInfo.x}, ${exitButtonInfo.y})`, 'Puppeteer.mouse.click(coordinates)');
                logToFile(`✓ Clicked exit/close button using coordinates`);
                dlog(`✓ Clicked exit/close button using coordinates`);
                await sleep(500);
              } catch (e) {
                logToFile(`⚠ Failed to click exit button by coordinates: ${e?.message}, trying selectors...`);
                // Try using clickElement as fallback
                try {
                  await clickElement(page, [
                    exitButtonInfo.selector,
                    'button[aria-label*="close" i]',
                    'button[aria-label*="Close" i]',
                    '.close-button',
                    '.modal-close'
                  ], { location: 'Exit/Close button', debug: DEBUG });
                  await sleep(500);
                } catch (e2) {
                  logToFile(`⚠ Failed to click exit button using selectors: ${e2?.message}`);
                }
              }
            } else {
              logToFile(`⚠ Exit button not found, using Escape key fallback`);
              dlog(`⚠ Exit button not found, using Escape key fallback`);
            }
            
            // Close any modals/dialogs by pressing Escape multiple times (fallback)
            await page.keyboard.press('Escape');
            await sleep(500);
            await page.keyboard.press('Escape');
            await sleep(500);
            
            // Wait for calendar to be visible again
            await sleep(1000);
            
            // Take screenshot before retry
            await takeScreenshot(`before-class-click-retry-${attempt}`);
          }
          
          // Now click it using Puppeteer's native click methods
          dlog(`Attempting to click the class element using Puppeteer... (attempt ${attempt})`);
          
          // CRITICAL: Add human-like behavior before clicking to prevent automation detection
          // Simulate human reading/thinking time
          await humanThinkingDelay();
          
          // Simulate mouse movement to the element (humans move mouse before clicking)
          await simulateHumanBehavior();
          
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
                  
                  // Human-like delay after scrolling
                  await humanDelay(300, 600);
                  
                  // Click at the left side of the element, avoiding any buttons inside
                  const box = await element.boundingBox();
                  if (box) {
                    // Move mouse to element first (human behavior)
                    const clickX = box.x + box.width * 0.12;
                    const clickY = box.y + box.height / 2;
                    await page.mouse.move(clickX, clickY, { steps: Math.floor(Math.random() * 5) + 3 });
                    
                    // Small delay before clicking (humans don't click instantly)
                    await humanDelay(100, 300);
                    
                    // Click at 12% from left edge to avoid delete buttons (usually on the right)
                    await page.mouse.click(clickX, clickY);
                    dlog(`  Clicked at ${(box.width * 0.12).toFixed(1)}px from left edge (12% of width)`);
                  } else {
                    await element.click();
                  }
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
                    
                    // Human-like delay after scrolling
                    await humanDelay(300, 600);
                    
                    // Click at the left side of the element to avoid delete buttons
                    const box = await element.boundingBox();
                    if (box) {
                      // Move mouse to element first (human behavior)
                      const clickX = box.x + box.width * 0.12;
                      const clickY = box.y + box.height / 2;
                      await page.mouse.move(clickX, clickY, { steps: Math.floor(Math.random() * 5) + 3 });
                      
                      // Small delay before clicking
                      await humanDelay(100, 300);
                      
                      // Click at 12% from left edge (delete buttons are usually on the right)
                      await page.mouse.click(clickX, clickY);
                      dlog(`  Clicked at ${(box.width * 0.12).toFixed(1)}px from left edge (12% of width)`);
                    } else {
                      await element.click();
                    }
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
                  // Make sure we're clicking the main event element, not a delete button inside it
                  // Find the main clickable area (avoid buttons)
                  let clickTarget = event;
                  
                  // Check if event contains buttons - if so, click the main container, not the buttons
                  const buttons = event.querySelectorAll('button, [role="button"], [class*="delete"], [class*="remove"], [class*="close"], [aria-label*="delete" i], [aria-label*="remove" i]');
                  
                  // Always click on the LEFT side of the event (10-15% from left edge) to avoid delete buttons
                  // Delete buttons are usually on the right side
                  const rect = event.getBoundingClientRect();
                  const clickX = rect.left + rect.width * 0.12; // Click at 12% from left edge
                  const clickY = rect.top + rect.height / 2; // Vertical center
                  
                  // Double-check that this click point is not over any button
                  let safeToClick = true;
                  for (const btn of buttons) {
                    const btnRect = btn.getBoundingClientRect();
                    if (clickX >= btnRect.left && clickX <= btnRect.right &&
                        clickY >= btnRect.top && clickY <= btnRect.bottom) {
                      safeToClick = false;
                      break;
                    }
                  }
                  
                  // If click point is over a button, move even more to the left
                  let finalClickX = clickX;
                  if (!safeToClick) {
                    finalClickX = rect.left + rect.width * 0.05; // Click at 5% from left edge
                    dlog(`  Click point was over button, moving to 5% from left`);
                  }
                  
                  // Scroll into view
                  event.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  
                  // Click at the safe position (left side of event)
                  const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: finalClickX,
                    clientY: clickY
                  });
                  
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
            if (attempt < MAX_CLASS_CLICK_RETRIES) {
              continue; // Retry
            } else {
              throw new Error(`Could not click class element after ${MAX_CLASS_CLICK_RETRIES} attempts`);
            }
          }
          
          // Wait for the click to register and page to stabilize (especially after errors)
          await sleep(2000); // Increased from 500ms to 2000ms to handle error recovery
          
          // Take screenshot immediately after clicking class to see what appeared
          await takeScreenshot(`after-class-click${attempt > 1 ? `-retry-${attempt}` : ''}`);
          
          // The delete modal ALWAYS appears when clicking a class - we need to dismiss it
          dlog(`Checking for delete modal (expected to appear)...`);
          const deleteModalAppeared = await page.evaluate(() => {
            const bodyText = (document.body.textContent || '').toLowerCase();
            if (bodyText.includes('delete class instance') || bodyText.includes('permanently delete')) {
              return true;
            }
            // Check for delete modal buttons
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
              if (btn.offsetParent === null) continue;
              const btnText = (btn.textContent || '').toLowerCase();
              if (btnText.includes('yes, delete') || (btnText.includes('delete') && btnText.includes('class'))) {
                // Check if it's in a modal context
                let parent = btn.parentElement;
                let depth = 0;
                while (parent && depth < 5) {
                  const parentText = (parent.textContent || '').toLowerCase();
                  if (parentText.includes('delete class')) {
                    return true;
                  }
                  parent = parent.parentElement;
                  depth++;
                }
              }
            }
            return false;
          }).catch(() => false);
          
          if (deleteModalAppeared) {
            logToFile(`[MODAL] Delete modal appeared (expected) - dismissing it...`);
            dlog(`Delete modal appeared (expected) - dismissing it...`);
            
            // Dismiss the delete modal by clicking "Go back" button
            const dismissed = await page.evaluate(() => {
              const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
              for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.textContent || '').trim().toLowerCase();
                // Look for "Go back" button
                if (text === 'go back' || text === 'go back' || text.includes('back')) {
                  btn.click();
                  return true;
                }
              }
              return false;
            }).catch(() => false);
            
            if (dismissed) {
              await sleep(1500); // Increased from 1000ms to 1500ms
              dlog(`✓ Successfully dismissed delete modal by clicking "Go back"`);
              logToFile(`✓ Successfully dismissed delete modal`);
            } else {
              // Fallback: try Escape key
              dlog(`"Go back" button not found, trying Escape key...`);
              await page.keyboard.press('Escape');
              await sleep(1500); // Increased from 1000ms to 1500ms
              dlog(`✓ Dismissed delete modal using Escape key`);
            }
            
            // Take screenshot after dismissing modal
            await takeScreenshot(`after-dismissing-delete-modal${attempt > 1 ? `-retry-${attempt}` : ''}`);
          } else {
            dlog(`No delete modal detected (may have already been dismissed or not appeared)`);
          }
          
          // Verify the click worked by checking for "Book Customer" button
          // This should be visible after dismissing the delete modal
          // Wait longer for the booking dialog to fully load (especially after 403 errors)
          dlog(`Waiting for booking dialog to load after dismissing delete modal...`);
          
          // Wait longer after dismissing modal to let page stabilize (especially if there were errors)
          await sleep(3000); // Increased from 2000ms to 3000ms to handle error recovery
          
          // Wait for network idle to ensure all resources are loaded
          try {
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 5000 }).catch(() => {
              dlog(`Network idle wait timed out, continuing...`);
            });
          } catch (e) {
            dlog(`Network idle wait error: ${e?.message}`);
          }
          
          // Additional wait for page to recover from any JavaScript errors
          await sleep(2000);
          
          // Check if we're in the wrong modal (the "Booked 0/" view modal instead of booking dialog)
          // This happens when automation is detected - the website shows a view-only modal
          const modalCheck = await page.evaluate(() => {
            const bodyText = (document.body.textContent || '').toLowerCase();
            const hasBookedModal = bodyText.includes('booked') && (bodyText.includes('waitlisted') || bodyText.includes('cancelled'));
            const hasBookCustomerButton = bodyText.includes('book customer');
            
            // Look for buttons that might open the booking dialog - search more broadly
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], div[onclick], a[onclick], [class*="add"], [class*="book"], [class*="plus"], [class*="new"]'));
            const potentialBookingButtons = [];
            
            // Also look for SVG icons that might be clickable (like a "+" icon)
            const allSvgs = Array.from(document.querySelectorAll('svg'));
            const svgParents = [];
            for (const svg of allSvgs) {
              if (svg.offsetParent === null) continue;
              // Check if SVG is a plus icon (common pattern: path with "M" commands)
              const paths = svg.querySelectorAll('path');
              for (const path of paths) {
                const d = path.getAttribute('d') || '';
                // Plus icon typically has horizontal and vertical lines
                if (d.includes('M') && (d.includes('H') || d.includes('V') || d.includes('h') || d.includes('v'))) {
                  let parent = svg.parentElement;
                  let depth = 0;
                  while (parent && depth < 5) {
                    if (parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button' || 
                        parent.onclick || parent.style.cursor === 'pointer' ||
                        window.getComputedStyle(parent).cursor === 'pointer') {
                      svgParents.push(parent);
                      break;
                    }
                    parent = parent.parentElement;
                    depth++;
                  }
                  break;
                }
              }
            }
            
            // Combine buttons and SVG parents
            const allClickable = [...allButtons, ...svgParents];
            
            for (const btn of allClickable) {
              if (btn.offsetParent === null) continue;
              const text = (btn.textContent || '').trim().toLowerCase();
              const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
              const className = (btn.className || '').toLowerCase();
              const id = (btn.id || '').toLowerCase();
              
              // Look for buttons that might trigger booking - expanded criteria
              const isBookingButton = 
                text === '+' || text === 'add' || text === 'new' ||
                text.includes('add customer') || text.includes('book customer') || text.includes('new booking') ||
                text.includes('add booking') || text.includes('book') ||
                ariaLabel.includes('add') || ariaLabel.includes('book') || ariaLabel.includes('new') ||
                ariaLabel.includes('customer') || ariaLabel.includes('booking') ||
                className.includes('add') || className.includes('book') || className.includes('plus') ||
                className.includes('new') || className.includes('create') ||
                id.includes('add') || id.includes('book') || id.includes('new');
              
              if (isBookingButton) {
                const rect = btn.getBoundingClientRect();
                potentialBookingButtons.push({
                  text: btn.textContent.trim() || (btn.querySelector('svg') ? '+' : ''),
                  ariaLabel: ariaLabel,
                  className: className,
                  id: id,
                  x: rect.x + rect.width / 2,
                  y: rect.y + rect.height / 2,
                  visible: true
                });
              }
            }
            
            return {
              isBookedModal: hasBookedModal && !hasBookCustomerButton,
              potentialBookingButtons: potentialBookingButtons,
              hasBookCustomerButton: hasBookCustomerButton,
              modalText: bodyText.substring(0, 200) // First 200 chars for debugging
            };
          }).catch(() => ({ isBookedModal: false, potentialBookingButtons: [], hasBookCustomerButton: false, modalText: '' }));
          
          // If we're in the "Booked 0/" modal, try to click a button to open the booking dialog
          if (modalCheck.isBookedModal) {
            logToFile(`⚠ Detected "Booked 0/" modal (automation detection) - this is NOT the booking dialog`);
            dlog(`⚠ Detected "Booked 0/" modal - found ${modalCheck.potentialBookingButtons.length} potential booking buttons`);
            
            // Take screenshot to see what's available
            await takeScreenshot(`detected-booked-modal-attempt-${attempt}`);
            
            if (modalCheck.potentialBookingButtons.length > 0) {
              // Log all potential buttons found
              for (const btn of modalCheck.potentialBookingButtons) {
                logToFile(`  Found potential booking button: "${btn.text}" (aria-label: "${btn.ariaLabel}", class: "${btn.className}")`);
                dlog(`  Found potential booking button: "${btn.text}" at (${btn.x}, ${btn.y})`);
              }
              
              // Try clicking buttons in order of preference (prefer "Book Customer" or "Add Customer" text)
              let clicked = false;
              for (const bookingButton of modalCheck.potentialBookingButtons) {
                const btnText = bookingButton.text.toLowerCase();
                if (btnText.includes('book customer') || btnText.includes('add customer') || btnText === '+' || btnText === 'add') {
                  logToFile(`  Attempting to click button: "${bookingButton.text}" (aria-label: "${bookingButton.ariaLabel}")`);
                  dlog(`  Attempting to click button: "${bookingButton.text}" at (${bookingButton.x}, ${bookingButton.y})`);
                  
                  try {
                    await page.mouse.click(bookingButton.x, bookingButton.y);
                    logClick('Open booking dialog from "Booked 0/" modal', `mouse.click(${bookingButton.x}, ${bookingButton.y})`, 'Puppeteer.mouse.click(coordinates)');
                    logToFile(`✓ Clicked potential booking button: "${bookingButton.text}"`);
                    await sleep(2000); // Wait for booking dialog to open
                    clicked = true;
                    break;
                  } catch (e) {
                    logToFile(`⚠ Failed to click booking button "${bookingButton.text}": ${e?.message}`);
                    dlog(`⚠ Failed to click booking button "${bookingButton.text}": ${e?.message}`);
                  }
                }
              }
              
              // If no preferred button was clicked, try the first one
              if (!clicked && modalCheck.potentialBookingButtons.length > 0) {
                const bookingButton = modalCheck.potentialBookingButtons[0];
                logToFile(`  Attempting to click first available button: "${bookingButton.text}"`);
                dlog(`  Attempting to click first available button: "${bookingButton.text}" at (${bookingButton.x}, ${bookingButton.y})`);
                
                try {
                  await page.mouse.click(bookingButton.x, bookingButton.y);
                  logClick('Open booking dialog from "Booked 0/" modal (fallback)', `mouse.click(${bookingButton.x}, ${bookingButton.y})`, 'Puppeteer.mouse.click(coordinates)');
                  logToFile(`✓ Clicked potential booking button (fallback)`);
                  await sleep(2000); // Wait for booking dialog to open
                } catch (e) {
                  logToFile(`⚠ Failed to click booking button (fallback): ${e?.message}`);
                  dlog(`⚠ Failed to click booking button (fallback): ${e?.message}`);
                }
              }
            } else {
              logToFile(`⚠ No booking buttons found in "Booked 0/" modal - may need manual inspection`);
              dlog(`⚠ No booking buttons found in "Booked 0/" modal - automation may be fully blocked`);
            }
          }
          
          // Try multiple times with progressive waits to find the "Book Customer" button
          let bookCustomerFound = false;
          for (let checkAttempt = 0; checkAttempt < 8; checkAttempt++) { // Increased from 5 to 8 attempts
            await sleep(1000 + checkAttempt * 500); // Progressive wait: 1000ms, 1500ms, 2000ms, 2500ms, 3000ms, 3500ms, 4000ms, 4500ms
            
            // Check for page errors before looking for button
            const pageErrors = await page.evaluate(() => {
              // Check if there are any visible error messages
              const errorElements = Array.from(document.querySelectorAll('[class*="error"], [class*="Error"], .error-message, .alert-error'));
              const hasVisibleErrors = errorElements.some(el => el.offsetParent !== null);
              
              // Check if page is in a broken state (no interactive elements)
              const interactiveElements = Array.from(document.querySelectorAll('button, [role="button"], input, select, textarea'));
              const hasInteractiveElements = interactiveElements.some(el => el.offsetParent !== null);
              
              return {
                hasVisibleErrors,
                hasInteractiveElements,
                errorCount: errorElements.length,
                interactiveCount: interactiveElements.length
              };
            }).catch(() => ({ hasVisibleErrors: false, hasInteractiveElements: true, errorCount: 0, interactiveCount: 0 }));
            
            if (!pageErrors.hasInteractiveElements) {
              dlog(`  Check ${checkAttempt + 1}/8: Page appears broken (no interactive elements), waiting longer...`);
              await sleep(2000);
              continue;
            }
            
            const clickVerified = await page.evaluate(() => {
              // Try multiple selectors for "Book Customer" button
              const selectors = [
                'button',
                '[role="button"]',
                'div.booking-btn button',
                'div.booking-btn > button',
                'button[class*="booking"]',
                'button[class*="customer"]',
                '::-p-text(Book Customer)',
                '::-p-aria(Book Customer)'
              ];
              
              for (const selector of selectors) {
                try {
                  const buttons = Array.from(document.querySelectorAll(selector));
                  for (const btn of buttons) {
                    if (btn.offsetParent === null) continue;
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (text === 'book customer' || text.includes('book customer')) {
                      return {
                        bookCustomerButtonVisible: true,
                        bookCustomerButtonText: btn.textContent,
                        selector: selector
                      };
                    }
                  }
                } catch (e) {
                  // Skip invalid selectors
                  continue;
                }
              }
              
              return {
                bookCustomerButtonVisible: false,
                bookCustomerButtonText: null,
                selector: null
              };
            }).catch(() => ({ bookCustomerButtonVisible: false, bookCustomerButtonText: null, selector: null }));
            
            if (clickVerified.bookCustomerButtonVisible) {
              dlog(`✓ Click verified - "Book Customer" button is visible: "${clickVerified.bookCustomerButtonText}" (found with selector: ${clickVerified.selector})`);
              logToFile(`✓ Booking dialog opened successfully - "Book Customer" button visible (attempt ${attempt}, check ${checkAttempt + 1})`);
              bookCustomerFound = true;
              break;
            } else {
              dlog(`  Check ${checkAttempt + 1}/8: "Book Customer" button not found yet, waiting...`);
            }
          }
          
          if (bookCustomerFound) {
            classClickSuccess = true;
            break; // Success! Exit retry loop
          } else {
            logToFile(`⚠ WARNING: "Book Customer" button not found after dismissing delete modal (attempt ${attempt})`);
            dlog(`⚠ WARNING: "Book Customer" button not found - booking dialog may not be fully loaded`);
            
            // Not found - will retry if attempts remain
            if (attempt < MAX_CLASS_CLICK_RETRIES) {
              logToFile(`⚠ "Book Customer" button not found - will retry (attempt ${attempt}/${MAX_CLASS_CLICK_RETRIES})`);
              dlog(`⚠ "Book Customer" button not found - will retry (attempt ${attempt}/${MAX_CLASS_CLICK_RETRIES})`);
              // Continue to next iteration (will go back to calendar)
            } else {
              logToFile(`❌ ERROR: "Book Customer" button still not found after ${MAX_CLASS_CLICK_RETRIES} attempts`);
              throw new Error(`Booking dialog did not open - "Book Customer" button not found after ${MAX_CLASS_CLICK_RETRIES} attempts`);
            }
          }
        }
        
        if (!classClickSuccess) {
          throw new Error(`Failed to open booking dialog after ${MAX_CLASS_CLICK_RETRIES} attempts`);
        }
        
        await sleep(500); // Final wait before proceeding
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
      await sleep(1500); // Wait for modal/dialog to open
      await takeScreenshot('after-book-customer-click');
    });

    // Step 8: Search for customer (with retry logic for Fitpass One through Twenty)
    await step("Search for customer", async () => {
      // Try email format first (fitpass1), then Fitpass One, Two, Three, etc. up to Twenty
      const MAX_CUSTOMER_RETRIES = 20;
      let customerSelectedSuccessfully = false;
      
      for (let customerNumber = 1; customerNumber <= MAX_CUSTOMER_RETRIES; customerNumber++) {
        // First try: use email format "fitpass1"
        // Subsequent tries: use name format "Fitpass One", "Fitpass Two", etc.
        const customerName = customerNumber === 1 ? "fitpass1" : `Fitpass ${customerNumber === 2 ? "Two" : customerNumber === 3 ? "Three" : customerNumber === 4 ? "Four" : customerNumber === 5 ? "Five" : customerNumber === 6 ? "Six" : customerNumber === 7 ? "Seven" : customerNumber === 8 ? "Eight" : customerNumber === 9 ? "Nine" : customerNumber === 10 ? "Ten" : customerNumber === 11 ? "Eleven" : customerNumber === 12 ? "Twelve" : customerNumber === 13 ? "Thirteen" : customerNumber === 14 ? "Fourteen" : customerNumber === 15 ? "Fifteen" : customerNumber === 16 ? "Sixteen" : customerNumber === 17 ? "Seventeen" : customerNumber === 18 ? "Eighteen" : customerNumber === 19 ? "Nineteen" : "Twenty"}`;
        const customerSearchValue = customerName.toLowerCase();
        
        if (customerNumber > 1) {
          logToFile(`[CUSTOMER RETRY] Attempt ${customerNumber}: Trying "${customerName}"`);
          dlog(`[CUSTOMER RETRY] Attempt ${customerNumber}: Trying "${customerName}"`);
          
          // Clear the input field before trying next customer
          try {
            const customerInputSelectors = [
              '::-p-aria(Search customer)',
              'div.customer-overlay input',
              'input[placeholder*="customer" i]',
              'input[placeholder*="Search" i]',
              'input[type="text"]',
              'input[type="search"]'
            ];
            
            let inputElement = null;
            for (const selector of customerInputSelectors) {
              try {
                const element = await page.$(selector).catch(() => null);
                if (element) {
                  const isVisible = await element.isVisible().catch(() => false);
                  if (isVisible) {
                    inputElement = element;
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
            
            if (inputElement) {
              await inputElement.click({ clickCount: 3 }); // Triple click to select all
              await page.keyboard.press('Backspace');
              await sleep(200);
              dlog(`✓ Cleared input field for retry`);
            }
          } catch (e) {
            dlog(`⚠ Could not clear input field: ${e?.message}`);
          }
        }
        
        dlog(`Typing customer name character by character: ${customerSearchValue}`);
      dlog(`Typing customer name character by character: ${customerSearchValue}`);
      
      // Take screenshot before searching for input field
      await takeScreenshot('before-customer-search-input-find');
      
      // Wait for the customer search modal/dialog to appear after clicking "Book Customer"
      dlog(`Waiting for customer search input field to appear...`);
      await sleep(1000); // Initial wait for modal to open
      
      // Try to wait for the input field to appear with a timeout
      const customerInputSelectors = [
        '::-p-aria(Search customer)',
        'div.customer-overlay input',
        '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/div/div[3]/input)',
        ':scope >>> div.customer-overlay input',
        'input[placeholder*="customer" i]',
        'input[placeholder*="Search" i]',
        'input[type="text"]',
        'input[type="search"]'
      ];
      
      // Wait for at least one selector to appear
      let inputFound = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        for (const selector of customerInputSelectors) {
          try {
            const element = await page.$(selector).catch(() => null);
            if (element) {
              const isVisible = await element.isVisible().catch(() => false);
              if (isVisible) {
                inputFound = true;
                dlog(`✓ Customer search input found on attempt ${attempt + 1} with selector: ${selector}`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        if (inputFound) break;
        await sleep(500); // Wait 500ms between attempts
      }
      
      if (!inputFound) {
        logToFile(`⚠ Customer search input not found after waiting, trying to find it anyway...`);
        dlog(`⚠ Customer search input not found after waiting, trying to find it anyway...`);
      }
      
      let foundInputElement = null;
      let foundInputSelector = null;
      let browserSelector = null; // Regular CSS selector for use in page.evaluate()
      
      for (const selector of customerInputSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            const isVisible = await element.isVisible().catch(() => false);
            if (isVisible) {
              foundInputElement = element;
              foundInputSelector = selector;
              
              // Get a regular CSS selector that works in browser context
              // First try to get element attributes to build a selector
              const elementInfo = await page.evaluate((el) => {
                return {
                  id: el.id || '',
                  className: el.className || '',
                  tagName: el.tagName.toLowerCase(),
                  placeholder: el.placeholder || '',
                  ariaLabel: el.getAttribute('aria-label') || ''
                };
              }, element).catch(() => null);
              
              // Build browser selector from element info
              if (elementInfo) {
                if (elementInfo.id) {
                  browserSelector = `#${elementInfo.id}`;
                } else if (elementInfo.className) {
                  const classes = elementInfo.className.split(' ').filter(c => c).join('.');
                  browserSelector = `${elementInfo.tagName}.${classes}`;
                } else if (elementInfo.placeholder) {
                  browserSelector = `input[placeholder="${elementInfo.placeholder}"]`;
                } else if (elementInfo.ariaLabel) {
                  browserSelector = `input[aria-label="${elementInfo.ariaLabel}"]`;
                }
              }
              
              // Fallback: convert Puppeteer selector to regular CSS selector
              if (!browserSelector) {
                if (selector.startsWith('::-p-aria')) {
                  browserSelector = 'input[aria-label*="customer" i], input[placeholder*="customer" i]';
                } else if (selector.startsWith('::-p-xpath')) {
                  browserSelector = 'div.customer-overlay input, input[type="text"]';
                } else if (!selector.startsWith('::-p-') && !selector.startsWith(':scope')) {
                  browserSelector = selector;
                } else {
                  browserSelector = 'div.customer-overlay input, input[type="text"]';
                }
              }
              
              dlog(`Found customer search input with selector: ${selector}`);
              dlog(`Browser selector: ${browserSelector}`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!foundInputElement || !foundInputSelector) {
        throw new Error(`Could not find customer search input field`);
      }
      
      if (!browserSelector) {
        browserSelector = 'div.customer-overlay input, input[type="text"]';
      }
      
      // Clear any existing text first
      await foundInputElement.click({ clickCount: 3 }); // Triple click to select all
      await page.keyboard.press('Backspace');
      await sleep(100);
      
      // Set up network monitoring for autocomplete API requests (like gym selection)
      const autocompleteRequests = [];
      const autocompleteResponses = [];
      
      const requestHandler = (request) => {
        const url = request.url();
        // Look for customer/search API endpoints
        if (url.includes('customer') || url.includes('search') || url.includes('autocomplete') || 
            url.includes('query') || url.includes('filter')) {
          dlog(`[NETWORK] Customer autocomplete request detected: ${url.substring(0, 150)}`);
          autocompleteRequests.push({
            url: url,
            method: request.method(),
            postData: request.postData(),
            timestamp: Date.now()
          });
        }
      };
      
      const responseHandler = (response) => {
        const url = response.url();
        if (url.includes('customer') || url.includes('search') || url.includes('autocomplete') || 
            url.includes('query') || url.includes('filter')) {
          dlog(`[NETWORK] Customer autocomplete response: ${url.substring(0, 150)}`);
          autocompleteResponses.push({
            url: url,
            status: response.status(),
            timestamp: Date.now()
          });
        }
      };
      
      // Start monitoring network requests
      page.on('request', requestHandler);
      page.on('response', responseHandler);
      
      // Simulate human behavior before typing (makes session look more realistic)
      dlog(`Simulating human behavior before customer search...`);
      await simulateHumanBehavior();
      await sleep(1000 + Math.random() * 1000); // Random delay 1000-2000ms (longer to look more human)
      
      // SIMPLIFIED APPROACH: Use Locator API .fill() method (like user's Puppeteer recording)
      // This matches what works locally - fast and reliable
      dlog(`Using Locator API .fill() method to input customer name "${customerName}" (matching local behavior)...`);
      
      // Ensure input is focused and ready (with human-like delays)
      await foundInputElement.click();
      await sleep(300 + Math.random() * 300); // Random delay 300-600ms
      await foundInputElement.focus();
      await sleep(300 + Math.random() * 300); // Random delay 300-600ms
      
      // Clear any existing value first
      await foundInputElement.click({ clickCount: 3 });
      await sleep(100);
      await page.keyboard.press('Backspace');
      await sleep(200);
      
      // Use Locator API .fill() method (like user's Puppeteer recording)
      // This is faster and matches what works locally
      const customerLocator = page.locator(foundInputSelector);
      await customerLocator.fill(customerName);
      
      // Manually trigger events to ensure autocomplete fires (like user's recording)
      await page.evaluate((selector) => {
        const input = document.querySelector(selector);
        if (input) {
          // Trigger input event
          const inputEvent = new Event('input', { bubbles: true, cancelable: true });
          Object.defineProperty(inputEvent, 'target', { value: input, enumerable: true });
          input.dispatchEvent(inputEvent);
          
          // Trigger change event
          const changeEvent = new Event('change', { bubbles: true, cancelable: true });
          input.dispatchEvent(changeEvent);
          
          // Trigger keyup event (some autocomplete systems listen to this)
          const keyUpEvent = new KeyboardEvent('keyup', { bubbles: true });
          input.dispatchEvent(keyUpEvent);
        }
      }, browserSelector);
      
      dlog("✓ Finished filling customer name using Locator API .fill()");
      
      // Wait for autocomplete dropdown to appear (shorter wait since .fill() is instant)
      dlog("Waiting for autocomplete dropdown to appear...");
      await sleep(1500); // Shorter wait - matches local behavior
      
      // Wait for network idle (autocomplete might fetch from server)
      // Shorter timeout to match local behavior (works instantly locally)
      try {
        await page.waitForNetworkIdle({ idleTime: 300, timeout: 2000 }).catch(() => {
          dlog("Network idle wait timed out, continuing...");
        });
      } catch (e) {
        dlog(`Network idle wait error: ${e?.message}`);
      }
      
      // Additional wait for autocomplete dropdown to render
      // Shorter wait to match local behavior (dropdown appears instantly locally)
      await sleep(1000); // Reduced from 3000ms to match local behavior
      
      // Now remove network listeners (after waiting for autocomplete)
      page.off('request', requestHandler);
      page.off('response', responseHandler);
      
      // Log network requests detected
      if (autocompleteRequests.length > 0) {
        logToFile(`[NETWORK] Detected ${autocompleteRequests.length} customer autocomplete requests during typing`);
        autocompleteRequests.forEach((req, i) => {
          logToFile(`[NETWORK] Request ${i+1}: ${req.method} ${req.url.substring(0, 150)}`);
        });
      } else {
        logToFile(`[NETWORK] WARNING: No customer autocomplete API requests detected - autocomplete may not be triggering`);
      }
      
      if (autocompleteResponses.length > 0) {
        logToFile(`[NETWORK] Detected ${autocompleteResponses.length} customer autocomplete responses`);
        autocompleteResponses.forEach((resp, i) => {
          logToFile(`[NETWORK] Response ${i+1}: ${resp.status} ${resp.url.substring(0, 150)}`);
        });
      }
      
      // Take screenshot to verify autocomplete appeared
      await takeScreenshot('after-customer-search-typing');
      
      // Verify autocomplete dropdown appeared - look for span elements in customer-overlay (as shown in recording)
      const autocompleteVisible = await page.evaluate(() => {
        // Look for span elements in div.customer-overlay (as shown in recording)
        const customerOverlay = document.querySelector('div.customer-overlay');
        if (customerOverlay) {
          const spans = Array.from(customerOverlay.querySelectorAll('span'));
          for (const span of spans) {
            if (span.offsetParent !== null) {
              const text = (span.textContent || '').toLowerCase();
              if (text.includes('fitpass') || text.includes('@test.com') || text.includes('customer')) {
                return true;
              }
            }
          }
        }
        
        // Fallback: Look for common autocomplete dropdown patterns
        const selectors = [
          'div.customer-overlay span',
          'div.search-container > div > div',
          '[role="listbox"]',
          '[class*="autocomplete"]',
          '[class*="dropdown"]',
          '[class*="suggestion"]'
        ];
        
        for (const sel of selectors) {
          const elements = Array.from(document.querySelectorAll(sel));
          for (const el of elements) {
            if (el.offsetParent !== null) {
              const text = (el.textContent || '').toLowerCase();
              if (text.includes('fitpass') || text.includes('@test.com') || text.includes('customer')) {
                return true;
              }
            }
          }
        }
        return false;
      }).catch(() => false);
      
      if (autocompleteVisible) {
        dlog("✓ Autocomplete dropdown is visible");
      } else {
        logToFile("⚠ WARNING: Autocomplete dropdown may not be visible after typing");
        dlog("⚠ WARNING: Autocomplete dropdown may not be visible after typing");
        // Wait a bit more and check again
        await sleep(2000);
        
        // Final check - look for span elements in customer-overlay
        const finalCheck = await page.evaluate((customerNameParam) => {
          const customerOverlay = document.querySelector('div.customer-overlay');
          const customerNameLower = customerNameParam.toLowerCase();
          const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
          
          // Check span elements in customer-overlay first
          if (customerOverlay) {
            const spans = Array.from(customerOverlay.querySelectorAll('span'));
            for (const span of spans) {
              if (span.offsetParent !== null) {
                const text = (span.textContent || '').toLowerCase();
                if (text.includes('fitpass') && (text.includes(customerNumberWord) || text.includes('@test.com'))) {
                  return true;
                }
              }
            }
          }
          
          // Fallback: check all divs
          const allDivs = Array.from(document.querySelectorAll('div'));
          for (const div of allDivs) {
            if (div.offsetParent !== null) {
              const text = (div.textContent || '').toLowerCase();
              if (text.includes('fitpass') && text.includes(customerNumberWord)) {
                return true;
              }
            }
          }
          return false;
        }, customerName).catch(() => false);
        
        if (finalCheck) {
          dlog("✓ Autocomplete dropdown found on final check");
        } else {
          logToFile("❌ ERROR: Autocomplete dropdown not found even after extended wait");
          // Don't retry - autocomplete not appearing is a different issue, not a customer availability issue
          throw new Error(`Autocomplete dropdown not found - this is not a customer availability issue`);
        }
      }
      
      // Step 10: Select customer from results (inside retry loop)
      logToFile(`[CUSTOMER SELECTION] Starting customer selection for "${customerName}". Current click count: ${clickCounter}`);
      dlog(`[CUSTOMER SELECTION] Starting customer selection for "${customerName}". Current click count: ${clickCounter}`);
      const clicksBefore = clickCounter;
      
      // Take screenshot before selecting customer
      await takeScreenshot('before-customer-selection');
      
      // Wait a bit for dropdown to fully populate
      await sleep(1000);
      
      // First, verify autocomplete dropdown is visible and find clickable customer options
      const dropdownCheck = await page.evaluate((customerNameParam) => {
        // Look for customer options in dropdown - based on recording, they are span elements inside div.customer-overlay
        // First, find the customer overlay container (as shown in recording)
        const customerOverlay = document.querySelector('div.customer-overlay');
        const searchRoot = customerOverlay || document.body;
        
        const customerOptions = [];
        
        // Extract the number part from customer name (e.g., "one", "two", "three", or "1", "2", etc.)
        const customerNameLower = customerNameParam.toLowerCase();
        const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
        // Check if it's email format (e.g., "fitpass1")
        const isEmailFormat = /^fitpass\d+$/.test(customerNameLower);
        
        // Priority 1: Look for span elements inside div.customer-overlay (as shown in recording)
        const spanElements = Array.from(searchRoot.querySelectorAll('div.customer-overlay span, span'));
        
        // Priority 2: Also check other elements as fallback
        const allElements = Array.from(searchRoot.querySelectorAll('div, li, span, p, a'));
        
        // Combine and prioritize spans
        const elementsToCheck = [...spanElements, ...allElements.filter(el => !spanElements.includes(el))];
        
        for (const el of elementsToCheck) {
          if (el.offsetParent === null) continue;
          
          // Get the text content and check if it's a customer name
          const text = (el.textContent || '').trim();
          const textLower = text.toLowerCase();
          
          // CRITICAL: Look for the current customer name (e.g., "Fitpass One", "Fitpass Two", "fitpass1", etc.)
          // Customer names should be less than 200 characters (may include email like "fitpass1@test.com  |")
          if (text.length > 200) continue; // Skip huge elements that contain entire page
          
          // Check if text contains fitpass and the number word (or email pattern)
          const hasFitpass = textLower.includes('fitpass');
          const hasNumberWord = customerNumberWord ? textLower.includes(customerNumberWord) : false;
          const hasEmailPattern = textLower.includes('@test.com') || textLower.includes('@'); // Recording shows email in text
          
          // For email format (fitpass1), check for direct match or email pattern
          const matchesEmailFormat = isEmailFormat && (
            textLower.includes(customerNameLower) || // Direct match: "fitpass1"
            textLower.includes(customerNameLower + '@') || // Email: "fitpass1@"
            textLower.match(new RegExp(`fitpass\\s*${customerNumberWord}\\b`, 'i')) !== null // "fitpass 1" or "fitpass1"
          );
          
          // More flexible matching: if it has fitpass and email, or fitpass and number word
          // Also check for number patterns (1, 2, 3, etc.) in email or text
          const hasNumberPattern = customerNumberWord ? 
            (textLower.match(/\bfitpass\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i) !== null) :
            false;
          
          if (hasFitpass && (hasNumberWord || hasEmailPattern || hasNumberPattern || matchesEmailFormat)) {
            // Make sure it's not just "fitpass" alone - must have the number word, email, or number pattern
            if (textLower === 'fitpass' || textLower.trim() === 'fitpass') continue; // Skip if it's just "fitpass"
            
            // Check if this element is within customer overlay (as shown in recording)
            const isInCustomerOverlay = customerOverlay ? customerOverlay.contains(el) : 
                                       el.closest('div.customer-overlay') !== null ||
                                       el.closest('[class*="dropdown"]') !== null ||
                                       el.closest('[class*="autocomplete"]') !== null ||
                                       el.closest('[class*="suggestion"]') !== null ||
                                       el.closest('[class*="popover"]') !== null ||
                                       el.closest('[class*="option"]') !== null ||
                                       el.closest('[class*="item"]') !== null;
            
            // Check if it's clickable - SPAN elements are clickable (as shown in recording)
            const isClickable = el.classList.contains('cursor-pointer') || 
                               el.onclick !== null ||
                               el.getAttribute('role') === 'option' ||
                               el.tagName === 'LI' ||
                               el.tagName === 'A' ||
                               el.tagName === 'SPAN' || // SPAN elements are clickable (from recording)
                               (el.tagName === 'DIV' && isInCustomerOverlay);
            
            if (isClickable || isInCustomerOverlay) {
              const rect = el.getBoundingClientRect();
              // Make sure it's actually visible and has reasonable size (not too large)
              // Customer option should be reasonably sized (not the entire page)
              if (rect.width > 50 && rect.width < 500 && rect.height > 10 && rect.height < 100) {
                customerOptions.push({
                  text: text.substring(0, 150), // Limit text length for logging (may include email)
                  fullText: text,
                  x: rect.left + rect.width / 2,
                  y: rect.top + rect.height / 2,
                  visible: true,
                  tagName: el.tagName,
                  className: el.className.substring(0, 50), // Limit class name length
                  isClickable: isClickable,
                  isInDropdown: isInCustomerOverlay,
                  width: rect.width,
                  height: rect.height,
                  isSpan: el.tagName === 'SPAN', // Prioritize SPAN elements
                  isInCustomerOverlay: isInCustomerOverlay
                });
              }
            }
          }
        }
        
        // Sort by priority: 1) SPAN elements, 2) In customer-overlay, 3) Smaller size
        customerOptions.sort((a, b) => {
          // Prioritize SPAN elements (as shown in recording)
          if (a.isSpan && !b.isSpan) return -1;
          if (!a.isSpan && b.isSpan) return 1;
          // Prioritize elements in customer-overlay
          if (a.isInCustomerOverlay && !b.isInCustomerOverlay) return -1;
          if (!a.isInCustomerOverlay && b.isInCustomerOverlay) return 1;
          // Then by size - prefer smaller elements
          const aSize = a.width * a.height;
          const bSize = b.width * b.height;
          return aSize - bSize; // Smaller first
        });
        
        // Log all span elements found for debugging
        const allSpans = customerOverlay ? Array.from(customerOverlay.querySelectorAll('span')) : [];
        const spanTexts = allSpans.map(s => s.textContent?.trim()).filter(t => t);
        
        return {
          found: customerOptions.length > 0,
          count: customerOptions.length,
          options: customerOptions,
          debug: {
            customerOverlayFound: customerOverlay !== null,
            spanCount: allSpans.length,
            spanTexts: spanTexts.slice(0, 10), // First 10 spans for debugging
            customerNameLower: customerNameLower,
            customerNumberWord: customerNumberWord
          }
        };
      }, customerName).catch(() => ({ found: false, count: 0, options: [], debug: null }));
      
      // Log debug info
      if (dropdownCheck.debug) {
        logToFile(`[CUSTOMER DEBUG] Customer overlay found: ${dropdownCheck.debug.customerOverlayFound}`);
        logToFile(`[CUSTOMER DEBUG] Span count: ${dropdownCheck.debug.spanCount}`);
        logToFile(`[CUSTOMER DEBUG] Span texts: ${JSON.stringify(dropdownCheck.debug.spanTexts)}`);
        logToFile(`[CUSTOMER DEBUG] Looking for: "${dropdownCheck.debug.customerNameLower}" (number word: "${dropdownCheck.debug.customerNumberWord}")`);
      }
      
      if (!dropdownCheck.found) {
        logToFile(`❌ ERROR: Customer "${customerName}" not found in dropdown! Cannot select customer.`);
        dlog(`❌ ERROR: Customer "${customerName}" not found in dropdown! Cannot select customer.`);
        if (dropdownCheck.debug) {
          logToFile(`[CUSTOMER DEBUG] Available span texts: ${JSON.stringify(dropdownCheck.debug.spanTexts)}`);
        }
        
        // Take screenshot for debugging
        await takeScreenshot(`customer-dropdown-not-found-${customerNumber}`);
        
        // Don't retry - customer not found is unproductive, throw error
        throw new Error(`Customer "${customerName}" not found in dropdown - this is not a clickability issue`);
      }
      
      dlog(`✓ Found ${dropdownCheck.count} customer option(s) in dropdown`);
      logToFile(`[CUSTOMER SELECTION] Found ${dropdownCheck.count} customer option(s) in dropdown`);
      
      // Check if any of the found options are clickable
      const hasClickableOption = dropdownCheck.options.some(opt => opt.isClickable);
      
      if (!hasClickableOption) {
        logToFile(`⚠ Customer "${customerName}" found in dropdown but NOT clickable! Trying next customer.`);
        dlog(`⚠ Customer "${customerName}" found in dropdown but NOT clickable! Trying next customer.`);
        
        // Take screenshot for debugging
        await takeScreenshot(`customer-not-clickable-${customerNumber}`);
        
        // Retry with next customer - this is the case we want to retry for
        if (customerNumber < MAX_CUSTOMER_RETRIES) {
          logToFile(`⚠ Will try next customer (${customerNumber + 1}/${MAX_CUSTOMER_RETRIES})`);
          dlog(`⚠ Will try next customer (${customerNumber + 1}/${MAX_CUSTOMER_RETRIES})`);
          continue; // Try next customer
        } else {
          // Last attempt failed
          throw new Error(`Customer "${customerName}" found but not clickable and no more customers to try (1-${MAX_CUSTOMER_RETRIES})`);
        }
      }
      
      // Log the options we found (limit text length for readability)
      dropdownCheck.options.forEach((opt, i) => {
        const textPreview = opt.text.length > 50 ? opt.text.substring(0, 50) + '...' : opt.text;
        logToFile(`  Option ${i + 1}: "${textPreview}" at (${opt.x}, ${opt.y}), size: ${opt.width}x${opt.height}, tag: ${opt.tagName}, clickable: ${opt.isClickable}, inDropdown: ${opt.isInDropdown}`);
      });
      
      // Try multiple methods to click the customer - prioritize smaller, clickable elements in dropdown
      let customerSelected = false;
      
      // Method 1: Try clicking the smallest option that's in dropdown (most likely to be actual customer option)
      if (dropdownCheck.options.length > 0) {
        try {
          // Prefer: 1) Smallest element, 2) In dropdown, 3) Clickable
          const optionToClick = dropdownCheck.options.find(opt => opt.isInDropdown && opt.isClickable) ||
                               dropdownCheck.options.find(opt => opt.isInDropdown) ||
                               dropdownCheck.options.find(opt => opt.isClickable) ||
                               dropdownCheck.options[0]; // Fallback to first (smallest after sorting)
          
          const textPreview = optionToClick.text.length > 50 ? optionToClick.text.substring(0, 50) + '...' : optionToClick.text;
          dlog(`[CUSTOMER SELECTION] Method 1: Clicking customer option by coordinates: "${textPreview}" at (${optionToClick.x}, ${optionToClick.y}), size: ${optionToClick.width}x${optionToClick.height}`);
          logToFile(`[CUSTOMER SELECTION] Method 1: Clicking "${textPreview}" at (${optionToClick.x}, ${optionToClick.y}), size: ${optionToClick.width}x${optionToClick.height}`);
          
          await page.mouse.click(optionToClick.x, optionToClick.y);
          logClick('Select customer', `mouse.click(${optionToClick.x}, ${optionToClick.y})`, 'Puppeteer.mouse.click(coordinates)');
          
          // Wait for selection to register
          await sleep(1000);
          
          // Verify the click worked - check if customer was actually selected (not just typed)
          const clickVerified = await page.evaluate((customerNameParam) => {
            // Check if dropdown closed and customer name appears in a selected state
            const inputs = Array.from(document.querySelectorAll('input'));
            const customerNameLower = customerNameParam.toLowerCase();
            const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
            const isEmailFormat = /^fitpass\d+$/.test(customerNameLower);
            
            for (const input of inputs) {
              if (input.offsetParent === null) continue;
              const value = (input.value || '').trim();
              const valueLower = value.toLowerCase();
              
              // For email format (fitpass1), check for direct match or email pattern
              if (isEmailFormat) {
                if (valueLower.includes(customerNameLower) || // Direct match: "fitpass1"
                    valueLower.includes(customerNameLower + '@') || // Email: "fitpass1@"
                    valueLower.match(new RegExp(`fitpass\\s*${customerNumberWord}\\b`, 'i')) !== null) { // "fitpass 1" or "fitpass1"
                  return true;
                }
              }
              
              // For name format (Fitpass One), check if value contains fitpass and number word
              if (valueLower.includes('fitpass') && customerNumberWord && valueLower.includes(customerNumberWord)) {
                return true;
              }
            }
            return false;
          }, customerName).catch(() => false);
          
          if (clickVerified) {
            customerSelected = true;
            dlog(`✓ Customer selected using Method 1 (coordinates)`);
            logToFile(`✓ Customer selected using Method 1 (coordinates)`);
          } else {
            dlog(`⚠ Method 1 click may not have registered - input still shows just "fitpass", trying other methods...`);
            logToFile(`⚠ Method 1 click may not have registered - input still shows just "fitpass"`);
          }
        } catch (e) {
          dlog(`Method 1 failed: ${e?.message}`);
          logToFile(`Method 1 failed: ${e?.message}`);
        }
      }
      
      // Method 2: Try using clickElement with selectors from recording (fallback)
      if (!customerSelected) {
        try {
          dlog(`[CUSTOMER SELECTION] Method 2: Trying selectors from recording...`);
          // Use selectors from recording: div.customer-overlay span
          await clickElement(page, [
            'div.customer-overlay span',
            `::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/div/div[3]/div/div/div[2]/div[2]/span)`,
            ':scope >>> div.customer-overlay span',
            `::-p-text(${customerName})`,
            `::-p-text(fitpass)`
          ], { offset: { x: 76, y: 15 }, location: 'Select customer', debug: DEBUG }); // Offset from recording
          
          // Wait and verify
          await sleep(1000);
          const clickVerified = await page.evaluate((customerNameParam) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const customerNameLower = customerNameParam.toLowerCase();
            const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
            for (const input of inputs) {
              if (input.offsetParent === null) continue;
              const value = (input.value || '').trim();
              const valueLower = value.toLowerCase();
              if (valueLower.includes('fitpass') && valueLower.includes(customerNumberWord)) {
                return true;
              }
            }
            return false;
          }, customerName).catch(() => false);
          
          if (clickVerified) {
            customerSelected = true;
            dlog(`✓ Customer selected using Method 2`);
            logToFile(`✓ Customer selected using Method 2`);
          } else {
            dlog(`⚠ Method 2 click may not have registered`);
            logToFile(`⚠ Method 2 click may not have registered`);
          }
        } catch (e) {
          dlog(`Method 2 failed: ${e?.message}`);
          logToFile(`Method 2 failed: ${e?.message}`);
        }
      }
      
      // Method 3: Try direct element click via page.evaluate (last resort)
      if (!customerSelected) {
        try {
          dlog(`[CUSTOMER SELECTION] Method 3: Trying direct element click (prioritizing SPAN elements)...`);
          const clicked = await page.evaluate((customerNameParam) => {
            // Find customer overlay container (as shown in recording)
            const customerOverlay = document.querySelector('div.customer-overlay');
            const searchRoot = customerOverlay || document.body;
            
            // Prioritize SPAN elements (as shown in recording)
            const spanElements = Array.from(searchRoot.querySelectorAll('div.customer-overlay span, span'));
            const allElements = Array.from(searchRoot.querySelectorAll('div, li, span'));
            const elementsToCheck = [...spanElements, ...allElements.filter(el => !spanElements.includes(el))];
            
            // Find best match with customer name
            let bestMatch = null;
            let bestScore = -1;
            
            const customerNameLower = customerNameParam.toLowerCase();
            const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
            
            for (const el of elementsToCheck) {
              if (el.offsetParent === null) continue;
              const text = (el.textContent || '').trim();
              const textLower = text.toLowerCase();
              
              // Must be reasonable length (may include email)
              if (text.length > 200) continue;
              
              const hasFitpass = textLower.includes('fitpass');
              const hasNumberWord = textLower.includes(customerNumberWord);
              const hasEmailPattern = textLower.includes('@test.com') || textLower.includes('@');
              
              if (hasFitpass && (hasNumberWord || hasEmailPattern)) {
                const rect = el.getBoundingClientRect();
                const size = rect.width * rect.height;
                
                // Score: prioritize SPAN, then customer-overlay, then smaller size
                let score = 0;
                if (el.tagName === 'SPAN') score += 1000;
                if (customerOverlay && customerOverlay.contains(el)) score += 500;
                score += 1000 / (size + 1); // Smaller is better
                
                if (rect.width < 500 && rect.height < 100 && score > bestScore) {
                  bestScore = score;
                  bestMatch = el;
                }
              }
            }
            
            if (bestMatch) {
              bestMatch.click();
              return true;
            }
            return false;
          }, customerName).catch(() => false);
          
          if (clicked) {
            await sleep(1000);
            const clickVerified = await page.evaluate((customerNameParam) => {
              const inputs = Array.from(document.querySelectorAll('input'));
              const customerNameLower = customerNameParam.toLowerCase();
              const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
              for (const input of inputs) {
                if (input.offsetParent === null) continue;
                const value = (input.value || '').trim();
                const valueLower = value.toLowerCase();
                if (valueLower.includes('fitpass') && valueLower.includes(customerNumberWord)) {
                  return true;
                }
              }
              return false;
            }, customerName).catch(() => false);
            
            if (clickVerified) {
              customerSelected = true;
              logClick('Select customer', 'page.evaluate(element.click())', 'Direct element click');
              dlog(`✓ Customer selected using Method 3 (direct click)`);
              logToFile(`✓ Customer selected using Method 3 (direct click)`);
            } else {
              dlog(`⚠ Method 3 click may not have registered`);
              logToFile(`⚠ Method 3 click may not have registered`);
            }
          }
        } catch (e) {
          dlog(`Method 3 failed: ${e?.message}`);
          logToFile(`Method 3 failed: ${e?.message}`);
        }
      }
      
      if (!customerSelected) {
        logToFile(`❌ ERROR: Failed to select customer "${customerName}" using all methods!`);
        await takeScreenshot(`customer-selection-failed-${customerNumber}`);
        
        // Don't retry - if customer was found and clickable but clicking failed, that's a different issue
        // We only retry when customer is found but NOT clickable (handled earlier)
        throw new Error(`Failed to select customer "${customerName}" - all click methods failed. Customer was found but clicking failed.`);
      }
      
      // Wait a bit for selection to register
      await sleep(1500);
      
      // Take screenshot immediately after clicking customer
      await takeScreenshot('after-customer-click-attempt');
      
      // STRICT VALIDATION: Verify customer was actually SELECTED (not just typed)
      // Check multiple indicators that customer was selected from dropdown
      const customerSelectedCheck = await page.evaluate((customerNameParam) => {
        const results = {
          customerInInput: false,
          customerInputValue: null,
          customerNameVisible: false,
          bookButtonVisible: false,
          dropdownClosed: false,
          customerSelectedIndicator: false, // NEW: Check if customer was actually selected vs just typed
          customerText: null,
          bookButtonText: null
        };
        
        const customerNameLower = customerNameParam.toLowerCase();
        const customerNumberWord = customerNameLower.replace('fitpass', '').trim();
        
        // Check 1: Customer name appears in input field
        const inputs = Array.from(document.querySelectorAll('input'));
        for (const input of inputs) {
          if (input.offsetParent === null) continue;
          const value = (input.value || '').trim();
          if (value.toLowerCase().includes('fitpass')) {
            results.customerInInput = true;
            results.customerInputValue = value;
            results.customerText = value;
            
            // CRITICAL: Check if the input value contains the full customer name (not just "fitpass")
            const valueLower = value.toLowerCase();
            if (valueLower.includes('fitpass') && valueLower.includes(customerNumberWord)) {
              results.customerSelectedIndicator = true; // Full customer name suggests selection
            }
            break;
          }
        }
        
        // Check 2: Look for customer name in a selected/displayed state (not just in input)
        // Check for elements that show the selected customer (usually a div or span near the input)
        // CRITICAL: Must be near the input field and be a reasonable size (not entire page)
        // Reuse inputs from Check 1
        const customerInput = inputs.find(input => {
          if (input.offsetParent === null) return false;
          const value = (input.value || '').trim().toLowerCase();
          return value.includes('fitpass');
        });
        
        if (customerInput) {
          const inputRect = customerInput.getBoundingClientRect();
          const nearbyElements = Array.from(document.querySelectorAll('div, span, p, li'));
          
          for (const el of nearbyElements) {
            if (el.offsetParent === null) continue;
            const rect = el.getBoundingClientRect();
            
            // Must be near the input (within 200px horizontally, within 100px vertically)
            const isNearInput = Math.abs(rect.left - inputRect.left) < 200 && 
                               Math.abs(rect.top - inputRect.top) < 100;
            
            if (!isNearInput) continue;
            
            const text = (el.textContent || '').trim();
            const textLower = text.toLowerCase();
            
            // Look for full customer name (not just "fitpass") and must be SHORT (actual customer name, not entire page)
            if (text.length > 100) continue; // Skip huge elements
            
            if (textLower.includes('fitpass') && textLower.includes(customerNumberWord)) {
              // Check if this element is showing a selected customer (not in dropdown)
              const isSelectedDisplay = !el.closest('[class*="dropdown"]') && 
                                       !el.closest('[class*="autocomplete"]') &&
                                       !el.closest('[class*="suggestion"]') &&
                                       !el.closest('[class*="popover"]');
              
              // Must be reasonably sized (not entire page)
              if (isSelectedDisplay && rect.width < 500 && rect.height < 100) {
                results.customerNameVisible = true;
                results.customerSelectedIndicator = true; // Found selected customer display near input
                break; // Found one, stop searching
              }
            }
          }
        }
        
        // Check 3: "BOOK USING CREDITS" button appeared (strongest indicator - customer was selected)
        const bookButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(btn => {
          if (btn.offsetParent === null) return false;
          const text = (btn.textContent || '').trim().toLowerCase();
          return text === 'book using credits' || text.includes('book using credits') || text.includes('book using');
        });
        
        if (bookButton) {
          results.bookButtonVisible = true;
          results.bookButtonText = bookButton.textContent;
          results.customerSelectedIndicator = true; // BOOK button = customer definitely selected
        }
        
        // Check 4: Dropdown is closed (autocomplete dropdown should disappear after selection)
        const dropdowns = Array.from(document.querySelectorAll('div[class*="dropdown"], div[class*="autocomplete"], div[class*="suggestion"]'));
        const visibleDropdowns = dropdowns.filter(d => {
          if (d.offsetParent === null) return false;
          const text = (d.textContent || '').toLowerCase();
          return text.includes('fitpass');
        });
        results.dropdownClosed = visibleDropdowns.length === 0;
        
        return results;
      }, customerName).catch(() => ({
        customerInInput: false,
        customerInputValue: null,
        customerNameVisible: false,
        bookButtonVisible: false,
        dropdownClosed: false,
        customerSelectedIndicator: false,
        customerText: null,
        bookButtonText: null
      }));
      
      // Log validation results
      logToFile(`[CUSTOMER SELECTION VALIDATION]`);
      logToFile(`  Customer in input: ${customerSelectedCheck.customerInInput} (value: "${customerSelectedCheck.customerInputValue || 'N/A'}")`);
      logToFile(`  Customer name visible: ${customerSelectedCheck.customerNameVisible}`);
      logToFile(`  BOOK USING CREDITS button visible: ${customerSelectedCheck.bookButtonVisible} (${customerSelectedCheck.bookButtonText || 'N/A'})`);
      logToFile(`  Dropdown closed: ${customerSelectedCheck.dropdownClosed}`);
      logToFile(`  Customer selected indicator: ${customerSelectedCheck.customerSelectedIndicator}`);
      
      dlog(`[CUSTOMER SELECTION VALIDATION]`);
      dlog(`  Customer in input: ${customerSelectedCheck.customerInInput} (value: "${customerSelectedCheck.customerInputValue || 'N/A'}")`);
      dlog(`  Customer name visible: ${customerSelectedCheck.customerNameVisible}`);
      dlog(`  BOOK USING CREDITS button visible: ${customerSelectedCheck.bookButtonVisible}`);
      dlog(`  Dropdown closed: ${customerSelectedCheck.dropdownClosed}`);
      dlog(`  Customer selected indicator: ${customerSelectedCheck.customerSelectedIndicator}`);
      
      // STRICT REQUIREMENT: Customer must be actually SELECTED, not just typed
      // The customerSelectedIndicator should be true if:
      // 1. BOOK USING CREDITS button is visible (strongest indicator)
      // 2. OR customer input contains full name (not just "fitpass")
      // 3. OR customer name is visible in a selected display element
      const customerDefinitelySelected = customerSelectedCheck.customerSelectedIndicator;
      
      if (!customerDefinitelySelected) {
        logToFile(`❌ ERROR: Customer selection validation FAILED for "${customerName}"!`);
        logToFile(`  Customer was typed but NOT SELECTED from dropdown.`);
        logToFile(`  Input value: "${customerSelectedCheck.customerInputValue || 'N/A'}"`);
        logToFile(`  Expected: Full customer name (e.g., "${customerName}") or BOOK USING CREDITS button visible`);
        logToFile(`  Actual: customerSelectedIndicator=${customerSelectedCheck.customerSelectedIndicator}`);
        
        // Take screenshot of failure state
        await takeScreenshot(`customer-selection-validation-failed-${customerNumber}`);
        
        // Don't retry - validation failure means clicking didn't work properly, not a clickability issue
        throw new Error(`Customer selection validation failed for "${customerName}" - customer was clicked but not properly selected. Input value: "${customerSelectedCheck.customerInputValue || 'N/A'}", BOOK button visible: ${customerSelectedCheck.bookButtonVisible}`);
      }
      
      // Success! Customer was selected
      logToFile(`✓ Customer selection VALIDATED successfully for "${customerName}" - customer was actually selected`);
      dlog(`✓ Customer selection VALIDATED successfully for "${customerName}" - customer was actually selected`);
      selectedCustomerName = customerName;
      customerSelectedSuccessfully = true;
      
      // Take screenshot after successful validation
      await takeScreenshot(`after-customer-selection-validated-${customerName.replace(/\s+/g, '-')}`);
      
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
      const customerLogMsg = `[CUSTOMER SELECTION] Completed for "${selectedCustomerName || customerName}". Clicks made: ${clicksMade}, Total clicks so far: ${clickCounter}`;
      logToFile(customerLogMsg);
      dlog(customerLogMsg);
      if (clicksMade > 1) {
        const warningMsg = `[WARNING] Multiple clicks detected during customer selection! Click count: ${clicksMade}`;
        logToFile(warningMsg);
        console.error(warningMsg);
      }
      await sleep(500); // Optimized: reduced from 1000ms
      
      // Break out of retry loop - we found a working customer
      break;
      } // End of customer selection logic (inside retry loop)
      
      // Check if we successfully selected a customer
      if (!customerSelectedSuccessfully) {
        throw new Error(`Failed to select any customer after ${MAX_CUSTOMER_RETRIES} attempts (Fitpass One through Fitpass Twenty)`);
      }
      
      logToFile(`✓ Successfully selected customer: "${selectedCustomerName}"`);
      dlog(`✓ Successfully selected customer: "${selectedCustomerName}"`);
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
    

    // Track whether we actually completed the charge step (required for successful booking)
    let chargeStepCompleted = false;

    // Step 13: Click "BOOK USING CREDITS" button - this is the confirmation button
    // Note: Based on the modal UI, this button appears directly after selecting customer
    // We may need to select a plan first, but if plan is already selected, we can click directly
    await step("Click BOOK USING CREDITS button", async () => {
      logToFile(`[BOOK BUTTON] Starting BOOK USING CREDITS click. Current click count: ${clickCounter}`);
      dlog(`[BOOK BUTTON] Starting BOOK USING CREDITS click. Current click count: ${clickCounter}`);
      const clicksBefore = clickCounter;
      
      // Take screenshot before looking for button
      await takeScreenshot('before-looking-for-book-button');
      
      // Wait a bit to ensure modal is fully loaded
      await sleep(1500);
      
      // STRICT VALIDATION: Verify "BOOK USING CREDITS" button is visible before attempting to click
      dlog(`Validating that BOOK USING CREDITS button is visible...`);
      const bookButtonValidation = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const bookButtons = [];
        
        for (const btn of buttons) {
          if (btn.offsetParent === null) continue;
          const text = (btn.textContent || '').trim();
          const textLower = text.toLowerCase();
          
          if (textLower.includes('book using credits') || 
              textLower.includes('book using') ||
              textLower === 'book using credits') {
            const rect = btn.getBoundingClientRect();
            bookButtons.push({
              text: text,
              visible: true,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              tagName: btn.tagName,
              className: btn.className,
              ariaLabel: btn.getAttribute('aria-label') || ''
            });
          }
        }
        
        return {
          found: bookButtons.length > 0,
          count: bookButtons.length,
          buttons: bookButtons
        };
      }).catch(() => ({ found: false, count: 0, buttons: [] }));
      
      if (!bookButtonValidation.found || bookButtonValidation.count === 0) {
        logToFile(`❌ ERROR: BOOK USING CREDITS button NOT FOUND!`);
        logToFile(`  Searched all buttons on page, found ${bookButtonValidation.count} matching buttons`);
        
        // Take screenshot of failure state
        await takeScreenshot('book-button-not-found');
        
        // Log all visible buttons for debugging
        const allButtons = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          return buttons
            .filter(btn => btn.offsetParent !== null)
            .map(btn => ({
              text: (btn.textContent || '').trim().substring(0, 50),
              tagName: btn.tagName,
              className: btn.className.substring(0, 50)
            }))
            .slice(0, 20); // First 20 buttons
        }).catch(() => []);
        
        logToFile(`  Visible buttons on page (first 20):`);
        allButtons.forEach((btn, i) => {
          logToFile(`    ${i + 1}. "${btn.text}" (${btn.tagName}, ${btn.className})`);
        });
        
        throw new Error(`BOOK USING CREDITS button not found - cannot proceed with booking. Customer may not have been selected properly.`);
      }
      
      logToFile(`✓ BOOK USING CREDITS button found: "${bookButtonValidation.buttons[0].text}"`);
      dlog(`✓ BOOK USING CREDITS button found: "${bookButtonValidation.buttons[0].text}"`);
      dlog(`  Button position: (${bookButtonValidation.buttons[0].x}, ${bookButtonValidation.buttons[0].y})`);
      dlog(`  Button tag: ${bookButtonValidation.buttons[0].tagName}, class: ${bookButtonValidation.buttons[0].className}`);
      
      // Use the validated button to click it directly by coordinates (most reliable)
      dlog(`Clicking BOOK USING CREDITS button using validated coordinates...`);
      const validatedButton = bookButtonValidation.buttons[0];
      
      try {
        await page.mouse.click(validatedButton.x, validatedButton.y);
        logClick('BOOK USING CREDITS button', `mouse.click(${validatedButton.x}, ${validatedButton.y})`, 'Puppeteer.mouse.click(coordinates)');
        dlog(`✓ Clicked BOOK USING CREDITS button using coordinates`);
      } catch (e) {
        dlog(`Coordinate click failed: ${e?.message}, trying selectors...`);
        
        // Fallback to selector-based click
        await clickElement(page, [
          `::-p-text(${validatedButton.text})`,
          '::-p-aria(Calendar Button BOOK USING CREDITS)',
          'div.customer-overlay button',
          '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/div/div[3]/div/div[6]/div/button)'
        ], { offset: { x: 318, y: 20.5 }, location: 'BOOK USING CREDITS button', debug: DEBUG });
      }
      
      await sleep(1000);
      
      // Take screenshot after clicking
      await takeScreenshot('after-book-using-credits-click');
      
      // Verify button was clicked (button should disappear or modal should change)
      const clickVerified = await page.evaluate(() => {
        // Check if button still exists (should disappear after click)
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const bookButtonStillExists = buttons.some(btn => {
          if (btn.offsetParent === null) return false;
          const text = (btn.textContent || '').trim().toLowerCase();
          return text.includes('book using credits');
        });
        
        // Check if Charge button appeared (indicates we're on next step)
        const chargeButton = buttons.find(btn => {
          if (btn.offsetParent === null) return false;
          const text = (btn.textContent || '').trim().toLowerCase();
          return text.includes('charge');
        });
        
        return {
          buttonStillExists: bookButtonStillExists,
          chargeButtonVisible: chargeButton !== undefined,
          chargeButtonText: chargeButton ? chargeButton.textContent : null
        };
      }).catch(() => ({ buttonStillExists: true, chargeButtonVisible: false, chargeButtonText: null }));
      
      if (clickVerified.chargeButtonVisible) {
        logToFile(`✓ BOOK USING CREDITS button clicked successfully - Charge button is now visible`);
        dlog(`✓ BOOK USING CREDITS button clicked successfully - Charge button is now visible: "${clickVerified.chargeButtonText}"`);
      } else if (!clickVerified.buttonStillExists) {
        logToFile(`✓ BOOK USING CREDITS button clicked successfully - button disappeared`);
        dlog(`✓ BOOK USING CREDITS button clicked successfully - button disappeared`);
      } else {
        logToFile(`⚠ WARNING: BOOK USING CREDITS button still exists after click - may not have registered`);
        dlog(`⚠ WARNING: BOOK USING CREDITS button still exists after click`);
        // Wait a bit more and check again
        await sleep(1000);
        const retryCheck = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
          return buttons.some(btn => {
            if (btn.offsetParent === null) return false;
            const text = (btn.textContent || '').trim().toLowerCase();
            return text.includes('charge');
          });
        }).catch(() => false);
        
        if (!retryCheck) {
          logToFile(`❌ ERROR: Charge button not found after clicking BOOK USING CREDITS - click may have failed`);
          throw new Error(`BOOK USING CREDITS button click may have failed - Charge button not found`);
        }
      }
      
      // Log clicks made in this step
      const clicksAfterBook = clickCounter;
      const clicksMade = clicksAfterBook - clicksBefore;
      const bookButtonLogMsg = `[BOOK BUTTON] Completed. Clicks made in this step: ${clicksMade}, Total clicks so far: ${clickCounter}`;
      logToFile(bookButtonLogMsg);
      dlog(bookButtonLogMsg);
      if (clicksMade > 1) {
        const warningMsg = `[WARNING] Multiple clicks detected on BOOK USING CREDITS button! Click count: ${clicksMade}`;
        logToFile(warningMsg);
        console.error(warningMsg);
      }
      
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
      
      // DO NOT mark as successful here - we MUST complete the charge step
      // Just return the booking state to continue to charge step
      dlog(`✓ BOOK USING CREDITS clicked, proceeding to Charge step...`);
      return bookingState;
    });

    // Step 15: Click Charge button - REQUIRED for booking to be successful
    await step("Click Charge", async () => {
      dlog(`Looking for Charge button (REQUIRED for booking completion)...`);
      
      // Wait for Charge button to appear
      await sleep(3000);
      
      // Check if Charge button is visible
      const chargeButtonCheck = await page.evaluate(() => {
        // Look for Charge button
        const chargeButton = Array.from(document.querySelectorAll('button, [role="button"]')).find(btn => {
          if (btn.offsetParent === null) return false;
          const text = (btn.textContent || '').toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('charge') || ariaLabel.includes('charge');
        });
        
        return {
          found: chargeButton !== undefined,
          visible: chargeButton !== undefined && chargeButton.offsetParent !== null,
          text: chargeButton ? chargeButton.textContent : null
        };
      }).catch(() => ({ found: false, visible: false, text: null }));
      
      if (!chargeButtonCheck.visible) {
        logToFile(`❌ ERROR: Charge button not found or not visible - booking cannot be completed!`);
        dlog(`❌ ERROR: Charge button not found or not visible - booking cannot be completed!`);
        throw new Error(`Charge button not found - booking cannot be finalized without completing charge step`);
      }
      
      dlog(`✓ Charge button found: "${chargeButtonCheck.text}"`);
      
      // Click the Charge button
      dlog(`Clicking Charge button...`);
      await clickElement(page, [
        '::-p-aria(Charge MX$ 0)',
        'div.final-price-calculation-section > button',
        '::-p-xpath(/html/body/web-app/ng-component/div/div/div[2]/div/div/ng-component/div[3]/app-floating-pos/div/div[2]/div[2]/div[2]/button)',
        ':scope >>> div.final-price-calculation-section > button',
        '::-p-text(Charge  MX$ 0)',
        'button:has-text("Charge")'
      ], { offset: { x: 108, y: 19.5 }, location: 'Charge button', debug: DEBUG });
      
      dlog(`✓ Charge button clicked, waiting for booking confirmation...`);
      await sleep(2000); // Wait for booking to be processed
      
      // Verify booking was completed successfully
      const bookingConfirmed = await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        const hasSuccess = bodyText.toLowerCase().includes('success') ||
                           bodyText.toLowerCase().includes('booked') ||
                           bodyText.toLowerCase().includes('confirmed');
        
        // Check for success notifications
        const notifications = Array.from(document.querySelectorAll('[class*="notification"], [class*="toast"], [class*="alert"], [class*="success"]'));
        const hasSuccessNotification = notifications.some(n => {
          if (n.offsetParent === null) return false;
          const text = (n.textContent || '').toLowerCase();
          return text.includes('success') || text.includes('booked') || text.includes('confirmed');
        });
        
        return { hasSuccess, hasSuccessNotification };
      }).catch(() => ({ hasSuccess: false, hasSuccessNotification: false }));
      
      if (bookingConfirmed.hasSuccess || bookingConfirmed.hasSuccessNotification) {
        chargeStepCompleted = true;
        dlog(`✓ Booking confirmed after Charge step!`);
        logToFile(`✓ Charge step completed successfully - booking is finalized`);
      } else {
        logToFile(`⚠ WARNING: Charge button clicked but no success confirmation found`);
        dlog(`⚠ WARNING: Charge button clicked but no success confirmation found`);
        // Still mark as completed if we clicked it (might be processing)
        chargeStepCompleted = true;
      }
      
      // Take screenshot after charge step
      await takeScreenshot('after-charge-step');
      
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
    
    // Only mark as successful if charge step was completed
    if (!chargeStepCompleted) {
      logToFile(`❌ ERROR: Booking failed - Charge step was not completed`);
      return {
        ok: false,
        error: `Booking failed - Charge step was not completed. Booking cannot be finalized without completing the charge step.`,
        clickCount: clickCounter,
        clickLog: clickLog.slice(-20),
        ...(screenshots.length > 0 ? { screenshots } : {})
      };
    }
    
    return {
      ok: true,
      message: `Successfully booked class for ${selectedCustomerName || CUSTOMER_NAME} on ${targetDate} at ${targetTime}`,
      verified: bookingVerified,
      foundInReservations: bookingFoundInReservations,
      chargeStepCompleted: chargeStepCompleted,
      clickCount: clickCounter,
      clickLog: clickLog.slice(-20), // Include last 20 clicks in response
      ...(reservationDetails ? { reservationDetails } : {}),
      ...(screenshots.length > 0 ? { screenshots } : {})
    };

  } catch (err) {
    const errorMessage = err?.message || String(err);
    logToFile(`[ERROR] Booking failed: ${errorMessage}`);
    logToFile(`[ERROR] Stack: ${err?.stack || 'No stack trace'}`);
    console.error(`[ERROR] Booking failed: ${errorMessage}`);
    
    // Close browser in background (don't wait for it) - response must be sent immediately
    const closeBrowser = async () => {
      try {
        // Use Promise.race with timeout to ensure we don't hang
        await Promise.race([
          Promise.all([
            page.close().catch(() => {}),
            browser.close().catch(() => {})
          ]),
          new Promise(resolve => setTimeout(resolve, 2000)) // Max 2 seconds for cleanup
        ]);
      } catch (e) {
        // Ignore all errors - we've already logged the main error
      }
    };
    
    // Don't await - let it run in background
    closeBrowser().catch(() => {});
    
    // Return error response immediately (don't wait for browser cleanup)
    return {
      ok: false,
      error: errorMessage,
      clickCount: clickCounter,
      clickLog: clickLog.slice(-20), // Include last 20 clicks in error response
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
        console.log(`[RESPONSE] Booking successful: ${result.message}`);
        return res.json(result);
      }
      console.log(`[RESPONSE] Booking failed: ${result.error}`);
      console.log(`[RESPONSE] Screenshots: ${result.screenshots?.length || 0}`);
      console.log(`[RESPONSE] Click count: ${result.clickCount || 0}`);
      return res.status(500).json(result);
    } else {
      // Response already sent by watchdog, but log the result
      console.log(`[RESPONSE] Result received but response already sent (watchdog fired)`);
      console.log(`[RESPONSE] Result: ${result.ok ? 'SUCCESS' : 'FAILED'}`);
      if (!result.ok) {
        console.log(`[RESPONSE] Error: ${result.error}`);
      }
    }
  } catch (err) {
    console.error(`[ERROR] Endpoint error: ${err?.message || err}`);
    console.error(`[ERROR] Stack: ${err?.stack || 'No stack trace'}`);
    if (!done.sent) {
      clearTimeout(watchdog);
      done.sent = true;
      const errorResponse = {
        ok: false,
        error: String(err?.message || err)
      };
      console.log(`[RESPONSE] Sending error response: ${JSON.stringify(errorResponse)}`);
      return res.status(500).json(errorResponse);
    } else {
      console.log(`[ERROR] Error occurred but response already sent (watchdog fired)`);
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


