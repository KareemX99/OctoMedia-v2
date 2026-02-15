// Browser Automation Module for Facebook Messenger
// WARNING: This may violate Facebook's Terms of Service - use at your own risk

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

class MessengerAutomation {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isLoggedIn = false;
        this.cookiesPath = path.join(__dirname, 'fb_cookies.json');
    }

    async initialize(headless = true) {
        this.browser = await puppeteer.launch({
            headless: headless ? 'new' : false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1280,800'
            ],
            defaultViewport: { width: 1280, height: 800 }
        });
        this.page = await this.browser.newPage();

        // Anti-detection: remove webdriver flag
        await this.page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.navigator.chrome = { runtime: {} };
        });

        // Set a realistic user agent
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Load cookies if available
        await this.loadCookies();

        return this;
    }

    async loadCookies() {
        try {
            if (fs.existsSync(this.cookiesPath)) {
                const cookies = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf8'));
                await this.page.setCookie(...cookies);
                console.log('Loaded saved Facebook cookies');
                return true;
            }
        } catch (err) {
            console.log('No cookies found or error loading:', err.message);
        }
        return false;
    }

    async saveCookies() {
        try {
            const cookies = await this.page.cookies();
            fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
            console.log('Saved Facebook cookies');
        } catch (err) {
            console.error('Error saving cookies:', err.message);
        }
    }

    async checkLoginStatus() {
        try {
            await this.page.goto('https://www.facebook.com/', { waitUntil: 'networkidle2', timeout: 30000 });

            const currentUrl = this.page.url();
            console.log(`[Automation] Login check URL: ${currentUrl}`);

            // Method 1: URL check - if redirected to login, not logged in
            if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
                console.log('[Automation] Detected login/checkpoint page - NOT logged in');
                this.isLoggedIn = false;
                return false;
            }

            // Method 2: DOM check with many fallback selectors
            const isLoggedIn = await this.page.evaluate(() => {
                return document.querySelector('[aria-label="Account"]') !== null ||
                    document.querySelector('[aria-label="\u0627\u0644\u062d\u0633\u0627\u0628"]') !== null ||
                    document.querySelector('[data-pagelet="RightRail"]') !== null ||
                    document.querySelector('[role="navigation"]') !== null ||
                    document.querySelector('[aria-label="Facebook"]') !== null ||
                    document.querySelector('[data-pagelet="LeftRail"]') !== null ||
                    document.querySelector('[aria-label="Your profile"]') !== null ||
                    document.querySelector('[aria-label="Messenger"]') !== null ||
                    document.querySelector('div[role="feed"]') !== null ||
                    // No login form + big page = probably logged in
                    (document.querySelector('input[name="email"]') === null &&
                        document.querySelector('input[name="pass"]') === null &&
                        document.body.innerHTML.length > 50000);
            });

            console.log(`[Automation] Login status: ${isLoggedIn ? '\u2705 LOGGED IN' : '\u274c NOT logged in'}`);
            this.isLoggedIn = isLoggedIn;
            return isLoggedIn;
        } catch (err) {
            console.error('Error checking login status:', err.message);
            return false;
        }
    }

    async login(email, password) {
        try {
            await this.page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2' });

            // Wait for login form
            await this.page.waitForSelector('#email', { timeout: 10000 });

            // Type credentials
            await this.page.type('#email', email, { delay: 50 });
            await this.page.type('#pass', password, { delay: 50 });

            // Click login button
            await this.page.click('button[name="login"]');

            // Wait for navigation
            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

            // Check if login was successful
            const isSuccess = await this.checkLoginStatus();

            if (isSuccess) {
                await this.saveCookies();
            }

            return isSuccess;
        } catch (err) {
            console.error('Login failed:', err.message);
            return false;
        }
    }

    // Login using existing access token (from OAuth)
    async loginWithToken(accessToken, userId) {
        try {
            // Set cookies that Facebook uses for authentication
            const cookies = [
                {
                    name: 'c_user',
                    value: userId,
                    domain: '.facebook.com',
                    path: '/',
                    httpOnly: true,
                    secure: true
                },
                {
                    name: 'xs',
                    value: accessToken.substring(0, 24), // Session token
                    domain: '.facebook.com',
                    path: '/',
                    httpOnly: true,
                    secure: true
                }
            ];

            await this.page.setCookie(...cookies);

            // Go to Facebook and check if we're logged in
            const isLoggedIn = await this.checkLoginStatus();

            if (isLoggedIn) {
                await this.saveCookies();
            }

            return isLoggedIn;
        } catch (err) {
            console.error('Token login failed:', err.message);
            return false;
        }
    }

    // Auto-initialize and check for existing session
    async autoLogin() {
        try {
            // First check if we have saved cookies
            await this.loadCookies();

            // Check if we're logged in
            const isLoggedIn = await this.checkLoginStatus();

            if (isLoggedIn) {
                console.log('Auto-login successful using saved cookies');
                this.isLoggedIn = true;
                return true;
            }

            console.log('No valid session found');
            return false;
        } catch (err) {
            console.error('Auto-login failed:', err.message);
            return false;
        }
    }

    async sendMessage(recipientId, message, imagePath = null) {
        try {
            // Try multiple URL formats
            const urls = [
                `https://www.messenger.com/t/${recipientId}`,
                `https://www.facebook.com/messages/t/${recipientId}`
            ];

            let messageBoxFound = false;

            for (const url of urls) {
                try {
                    console.log(`[Puppeteer] Trying URL: ${url}`);
                    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

                    const currentUrl = this.page.url();
                    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
                        console.log(`[Puppeteer] Redirected to login, skipping...`);
                        continue;
                    }

                    const inputSelector = [
                        '[aria-label="Message"]',
                        '[aria-label="\u0631\u0633\u0627\u0644\u0629"]',
                        'div[contenteditable="true"][role="textbox"]',
                        '[contenteditable="true"]'
                    ].join(', ');

                    await this.page.waitForSelector(inputSelector, { timeout: 10000 });
                    messageBoxFound = true;
                    console.log(`[Puppeteer] \u2705 Message box found`);
                    break;
                } catch (urlErr) {
                    console.log(`[Puppeteer] \u274c URL failed: ${urlErr.message.substring(0, 80)}`);
                    continue;
                }
            }

            if (!messageBoxFound) {
                const screenshotPath = path.join(__dirname, 'debug_puppeteer.png');
                await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
                console.error(`[Puppeteer] \u274c No message box found. Screenshot: ${screenshotPath}`);
                console.error(`[Puppeteer] Current URL: ${this.page.url()}`);
                return { success: false, error: '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0645\u0631\u0628\u0639 \u0627\u0644\u0631\u0633\u0627\u0626\u0644' };
            }

            // Upload image if exists
            if (imagePath && fs.existsSync(imagePath)) {
                const fileInput = await this.page.$('input[type="file"]');
                if (fileInput) {
                    await fileInput.uploadFile(imagePath);
                    await this.delay(3000);
                }
            }

            // Type the message
            if (message) {
                const messageBox = await this.page.$('div[contenteditable="true"][role="textbox"]') ||
                    await this.page.$('[aria-label="Message"]') ||
                    await this.page.$('[aria-label="\u0631\u0633\u0627\u0644\u0629"]') ||
                    await this.page.$('[contenteditable="true"]');

                if (messageBox) {
                    await messageBox.click();
                    await this.delay(500);
                    await this.page.keyboard.type(message, { delay: 15 });
                } else {
                    return { success: false, error: '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0645\u0631\u0628\u0639 \u0627\u0644\u0643\u062a\u0627\u0628\u0629' };
                }
            }

            // Send
            await this.page.keyboard.press('Enter');
            await this.delay(2000);

            return { success: true };
        } catch (err) {
            console.error(`[Puppeteer] Failed to send to ${recipientId}:`, err.message);
            const screenshotPath = path.join(__dirname, 'debug_puppeteer.png');
            await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
            return { success: false, error: err.message };
        }
    }

    async sendMessageByName(conversationUrl, message, imagePath = null) {
        try {
            await this.page.goto(conversationUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Same logic as sendMessage
            await this.page.waitForSelector('[aria-label="Message"], [aria-label="رسالة"], [contenteditable="true"]', { timeout: 15000 });

            if (imagePath && fs.existsSync(imagePath)) {
                const fileInput = await this.page.$('input[type="file"][accept*="image"]');
                if (fileInput) {
                    await fileInput.uploadFile(imagePath);
                    await this.delay(3000);
                }
            }

            if (message) {
                const messageBox = await this.page.$('[aria-label="Message"], [aria-label="رسالة"], [contenteditable="true"][role="textbox"]');
                if (messageBox) {
                    await messageBox.click();
                    await this.page.keyboard.type(message, { delay: 20 });
                }
            }

            await this.page.keyboard.press('Enter');
            await this.delay(2000);

            return { success: true };
        } catch (err) {
            console.error('Failed to send message:', err.message);
            return { success: false, error: err.message };
        }
    }

    async getPageConversations(pageId) {
        try {
            // Navigate to page inbox
            const inboxUrl = `https://www.facebook.com/${pageId}/inbox`;
            await this.page.goto(inboxUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait for conversations list
            await this.delay(3000);

            // Extract conversation links
            const conversations = await this.page.evaluate(() => {
                const links = [];
                const items = document.querySelectorAll('[data-testid="messenger-primary-tab"] a, [role="listitem"] a');
                items.forEach(item => {
                    const href = item.href;
                    const name = item.innerText || 'Unknown';
                    if (href && href.includes('/t/')) {
                        links.push({ url: href, name: name.split('\n')[0] });
                    }
                });
                return links;
            });

            return conversations;
        } catch (err) {
            console.error('Failed to get conversations:', err.message);
            return [];
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}

module.exports = MessengerAutomation;
