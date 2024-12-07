import * as ChromeLauncher from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import fs from 'fs/promises';
import { performance } from 'perf_hooks';

const url = 'https://www.laptop.bg'; // The target website
const outputFile = 'cf_clearance.json'; // Output file
const maxWaitTime = 30000; // Maximum time to wait for the cookie in milliseconds (30 seconds)
const userAgentString = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

async function runChromeAndGetCookie() {
  let chrome;
  let client;
  let startTime;

  try {
    //console.log('Launching Chrome...');
    chrome = await ChromeLauncher.launch({
      startingUrl: url,
      chromeFlags: [
       // '--headless=new',
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
        `--user-agent=${userAgentString}` // Set User-Agent using a flag
      ]
    });

    //console.log(`Chrome debugging port running on ${chrome.port}`);

    //console.log('Connecting to Chrome...');
    client = await CDP({ port: chrome.port });
    //console.log('Connected to Chrome');

    const { Network, Page, Input, Runtime } = client;

    await Network.enable();
    await Page.enable();

    //console.log('Navigating to URL...');
    const { frameId } = await Page.navigate({ url });
    await Page.loadEventFired();
    //console.log('Page loaded');
    startTime = performance.now();

    // Function to check for cf_clearance cookie
    async function checkForClearanceCookie() {
      const { cookies } = await Network.getAllCookies();
      const cfClearanceCookie = cookies.find(cookie => cookie.name === 'cf_clearance');
      if (cfClearanceCookie) {
        console.log('cf_clearance cookie found:', cfClearanceCookie);
        await fs.writeFile(outputFile, JSON.stringify(cfClearanceCookie, null, 2));
        console.log(`Cookie saved to ${outputFile}`);
        return true;
      }
      return false;
    }

    

    // Draw a red box at the specified coordinates
    const x = 273;
    const y = 290;



    // Function to perform a single click at the specified coordinates
    async function clickAtCoordinates(x, y) {
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
    }

    function getRandomDelay() {
      return Math.random() * (100 - 50) + 150;
    }

    const checkInterval = 10; // Interval in milliseconds
    const maxIterations = maxWaitTime / checkInterval;

    for (let i = 0; i < maxIterations; i++) {
      await clickAtCoordinates(x, y);
      const delay = getRandomDelay();
      //console.log(`Clicked at (${x}, ${y}). Waiting ${delay.toFixed(2)} ms.`);
      await new Promise(resolve => setTimeout(resolve, delay));
      if (await checkForClearanceCookie()) {
        break;
      }
    }

  } catch (err) {
    console.error('An error occurred:', err);
  } finally {
    if (client) {
      await client.close();
    }
    if (chrome) {
      await chrome.kill();
    }
    const endTime = performance.now();
    const executionTime = (endTime - startTime) / 1000;
    console.log(`Total execution time: ${executionTime.toFixed(2)} seconds`);
  }
}

runChromeAndGetCookie();
