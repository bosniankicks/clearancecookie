import express from 'express';
import * as ChromeLauncher from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import { performance } from 'perf_hooks';

const app = express();
app.use(express.json());

const REQUEST_TIMEOUT = 30000; // 30 seconds timeout per request
const MAX_CONCURRENT_BROWSERS = 10;

class BrowserPool {
  constructor(maxSize) {
    this.pool = [];
    this.maxSize = maxSize;
    this.waiting = [];
    this.activeRequests = new Map(); // Track active requests
  }

  async acquire() {
    if (this.pool.length < this.maxSize) {
      const browser = await this.createBrowser();
      const id = Math.random().toString(36).substr(2, 9);
      this.activeRequests.set(id, browser);
      return { browser, id };
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  async release(id) {
    const browser = this.activeRequests.get(id);
    if (!browser) return;

    this.activeRequests.delete(id);

    try {
      if (browser.chrome) {
        await browser.chrome.kill();
      }
    } catch (err) {
      console.error('Error killing browser:', err);
    }

    if (this.waiting.length > 0) {
      const newBrowser = await this.createBrowser();
      const newId = Math.random().toString(36).substr(2, 9);
      this.activeRequests.set(newId, newBrowser);
      const resolve = this.waiting.shift();
      resolve({ browser: newBrowser, id: newId });
    }
  }

  async createBrowser() {
    try {
      const chrome = await ChromeLauncher.launch({
        chromeFlags: [
          '--headless=new',
          '--no-first-run',
          '--window-size=1920x1080',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-sync',
          '--disable-background-timer-throttling',
          '--disable-client-side-phishing-detection',
          '--disable-popup-blocking',
          '--enable-fast-unload',
          '--disable-translate',
          '--disable-renderer-backgrounding',
          '--disable-preconnect',
          '--disable-dev-shm-usage',
          '--disable-ipc-flooding-protection',
          '--disable-backgrounding-occluded-windows',
          '--disk-cache-size=10485760',
          '--media-cache-size=1048576',
        ]
      });
      
      return { chrome, inUse: false };
    } catch (err) {
      console.error('Error creating browser:', err);
      throw err;
    }
  }

  async cleanup() {
    for (const [id, browser] of this.activeRequests) {
      try {
        if (browser.chrome) {
          await browser.chrome.kill();
        }
      } catch (err) {
        console.error('Error during cleanup:', err);
      }
    }
    this.activeRequests.clear();
    this.pool = [];
  }
}

const browserPool = new BrowserPool(MAX_CONCURRENT_BROWSERS);

async function processSingleRequest(url, userAgent) {
  const { browser, id } = await browserPool.acquire();
  let client;
  const startTime = performance.now();

  // Create a timeout promise
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timed out')), REQUEST_TIMEOUT);
  });

  try {
    client = await CDP({ port: browser.chrome.port });
    const { Network, Page, Runtime } = client;

    //await Network.setUserAgentOverride({ userAgent });
    await Network.enable();
    await Page.enable();

    // Set up cookie listener
    let cfClearance = null;
    Network.responseReceivedExtraInfo(({ headers }) => {
      const setCookie = headers['set-cookie'];
      if (setCookie && setCookie.includes('cf_clearance')) {
        const match = setCookie.match(/cf_clearance=([^;]+)/);
        if (match) {
          cfClearance = match[1];
        }
      }
    });

    // Navigate and wait for either timeout or success
    const navigationPromise = Promise.race([
      (async () => {
        await Page.navigate({ url });
        await Page.loadEventFired();
        
        // Wait a bit for potential redirects and cookie setting
        for (let i = 0; i < 30; i++) {
          if (cfClearance) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
          const { cookies } = await Network.getAllCookies();
          const cookie = cookies.find(c => c.name === 'cf_clearance');
          if (cookie) {
            cfClearance = cookie.value;
            break;
          }
        }

        if (cfClearance) {
          return { success: true, value: cfClearance };
        }
        throw new Error('Cookie not found');
      })(),
      timeoutPromise
    ]);

    const result = await navigationPromise;
    return result;

  } catch (err) {
    console.error('Request processing error:', err);
    return { success: false, error: err.message };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (err) {
        console.error('Error closing CDP client:', err);
      }
    }
    await browserPool.release(id);
    
    const endTime = performance.now();
    console.log(`Request completed in ${(endTime - startTime) / 1000} seconds`);
  }
}

app.post('/get-cf-clearance', async (req, res) => {
  const { url, userAgent } = req.body;

  if (!url || !userAgent) {
    return res.status(400).json({ error: 'Please provide a URL and User-Agent.' });
  }

  try {
    const result = await processSingleRequest(url, userAgent);
    if (result.success) {
      res.status(200).json({ value: result.value });
    } else {
      res.status(408).json({ error: result.error });
    }
  } catch (err) {
    console.error('Request processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

process.on('SIGINT', async () => {
  await browserPool.cleanup();
  process.exit();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Maximum concurrent browsers: ${MAX_CONCURRENT_BROWSERS}`);
});
