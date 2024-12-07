import express from 'express';
import * as ChromeLauncher from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import { performance } from 'perf_hooks';

const app = express();
app.use(express.json());

const maxWaitTime = 10000; // Maximum time to wait for the cookie in milliseconds

app.post('/get-cf-clearance', async (req, res) => {
  const { url, userAgent } = req.body;

  if (!url || !userAgent) {
    return res.status(400).json({ error: 'Please provide a URL and User-Agent.' });
  }

  let chrome;
  let client;
  let startTime;

  try {
    chrome = await ChromeLauncher.launch({
      startingUrl: url,
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
        `--user-agent=${userAgent}`,
      ]
    });

    client = await CDP({ port: chrome.port });

    const { Network, Page, Input } = client;

    await Network.enable();
    await Page.enable();

    const { frameId } = await Page.navigate({ url });
    await Page.loadEventFired();
    startTime = performance.now();

    const checkForClearanceCookie = async () => {
      const { cookies } = await Network.getAllCookies();
      return cookies.find(cookie => cookie.name === 'cf_clearance');
    };

    const clickAtCoordinates = async (x, y) => {
      await Input.dispatchMouseEvent({
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
      await Input.dispatchMouseEvent({
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
    };

    const x = 273;
    const y = 290;
    const checkInterval = 10;
    const maxIterations = maxWaitTime / checkInterval;

    for (let i = 0; i < maxIterations; i++) {
      await clickAtCoordinates(x, y);
      await new Promise(resolve => setTimeout(resolve, 100)); // Short delay
      const cfClearanceCookie = await checkForClearanceCookie();
      if (cfClearanceCookie) {
        return res.status(200).json({ value: cfClearanceCookie.value });
      }
    }

    res.status(408).json({ error: 'cf_clearance cookie not found within the timeout period.' });

  } catch (err) {
    console.error('An error occurred:', err);
    res.status(500).json({ error: 'An internal server error occurred.' });
  } finally {
    if (client) await client.close();
    if (chrome) await chrome.kill();

    const endTime = performance.now();
    console.log(`Execution time: ${(endTime - startTime) / 1000} seconds`);
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
