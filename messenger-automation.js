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

    async sendMessage(recipientId, message, imagePath = null, recipientName = null, pageId = null) {
        try {
            // Strategy: Use Meta Business Suite inbox to find and message the recipient
            // PSIDs don't work in browser URLs, so we search by name instead

            if (!recipientName) {
                return { success: false, error: 'اسم المستلم مطلوب للإرسال عبر المتصفح' };
            }

            // Try multiple inbox URLs in order
            const inboxUrls = [];
            if (pageId) {
                inboxUrls.push(`https://business.facebook.com/latest/inbox/all?asset_id=${pageId}`);
                inboxUrls.push(`https://www.facebook.com/latest/inbox/all?asset_id=${pageId}`);
            }
            inboxUrls.push('https://business.facebook.com/latest/inbox/all');

            let inboxLoaded = false;

            for (const inboxUrl of inboxUrls) {
                try {
                    console.log(`[Puppeteer] Trying inbox: ${inboxUrl}`);
                    await this.page.goto(inboxUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                    await this.delay(3000);

                    const currentUrl = this.page.url();
                    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
                        this.isLoggedIn = false;
                        return { success: false, error: 'غير مسجل دخول' };
                    }

                    // Check if page loaded properly (not an error page)
                    const hasError = await this.page.evaluate(() => {
                        return document.body.innerText.includes("isn't available") ||
                            document.body.innerText.includes('غير متاح');
                    });

                    if (!hasError) {
                        inboxLoaded = true;
                        console.log(`[Puppeteer] ✅ Inbox loaded: ${inboxUrl}`);
                        break;
                    }
                    console.log(`[Puppeteer] ⚠️ Inbox not available, trying next...`);
                } catch (e) {
                    console.log(`[Puppeteer] ❌ Inbox URL failed: ${e.message.substring(0, 60)}`);
                }
            }

            if (!inboxLoaded) {
                const screenshotPath = path.join(__dirname, 'debug_puppeteer.png');
                await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
                return { success: false, error: 'لم يتم فتح inbox الصفحة — تأكد إنك أدمن على الصفحة' };
            }

            // Look for search box in inbox and search by name
            const searchSelectors = [
                'input[placeholder*="Search"]',
                'input[placeholder*="بحث"]',
                'input[placeholder*="search"]',
                'input[aria-label*="Search"]',
                'input[aria-label*="بحث"]',
                'input[type="search"]',
                '[role="search"] input',
                'input[placeholder*="Search Messenger"]'
            ];

            let searchBox = null;
            for (const sel of searchSelectors) {
                searchBox = await this.page.$(sel);
                if (searchBox) break;
            }

            if (searchBox) {
                console.log(`[Puppeteer] Searching for: ${recipientName}`);
                await searchBox.click();
                await this.delay(500);
                // Clear any existing text
                await this.page.keyboard.down('Control');
                await this.page.keyboard.press('a');
                await this.page.keyboard.up('Control');
                await this.page.keyboard.type(recipientName, { delay: 30 });
                await this.delay(4000);

                // Click on the first matching result
                const resultClicked = await this.page.evaluate((name) => {
                    const lowerName = name.toLowerCase();
                    // Look for conversation items with the recipient name
                    const allElements = document.querySelectorAll('a, [role="row"], [role="listitem"], [role="option"], div[tabindex], span');
                    for (const el of allElements) {
                        const text = (el.textContent || '').toLowerCase().trim();
                        if (text.includes(lowerName) && el.offsetParent !== null && el.closest('[role="listbox"], [role="list"], [role="menu"], ul, [data-testid]')) {
                            el.click();
                            return true;
                        }
                    }
                    // Fallback: try any clickable element with the name
                    for (const el of allElements) {
                        const text = (el.textContent || '').toLowerCase().trim();
                        if (text === lowerName && el.offsetParent !== null) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }, recipientName);

                if (!resultClicked) {
                    console.log(`[Puppeteer] ❌ Could not find conversation for: ${recipientName}`);
                    const screenshotPath = path.join(__dirname, 'debug_puppeteer.png');
                    await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
                    return { success: false, error: `لم يتم العثور على محادثة: ${recipientName}` };
                }

                await this.delay(3000);
            } else {
                console.log('[Puppeteer] ⚠️ No search box found, trying to scroll conversations...');
                // Try to find conversation by scrolling and clicking
                const found = await this.page.evaluate((name) => {
                    const lowerName = name.toLowerCase();
                    const allText = document.querySelectorAll('span, a, div');
                    for (const el of allText) {
                        const text = (el.textContent || '').toLowerCase().trim();
                        if (text === lowerName && el.offsetParent !== null) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }, recipientName);

                if (!found) {
                    const screenshotPath = path.join(__dirname, 'debug_puppeteer.png');
                    await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
                    return { success: false, error: `لم يتم العثور على محادثة: ${recipientName}` };
                }
                await this.delay(3000);
            }

            // Now we should be in the conversation - find the message box
            const inputSelector = [
                '[aria-label="Message"]',
                '[aria-label="رسالة"]',
                '[aria-label="Aa"]',
                '[aria-label="Reply"]',
                '[aria-label="الرد"]',
                'div[contenteditable="true"][role="textbox"]',
                '[contenteditable="true"]'
            ].join(', ');

            try {
                await this.page.waitForSelector(inputSelector, { timeout: 10000 });
            } catch (e) {
                const screenshotPath = path.join(__dirname, 'debug_puppeteer.png');
                await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
                console.error(`[Puppeteer] ❌ No message box after opening conversation`);
                return { success: false, error: 'لم يتم العثور على مربع الرسائل بعد فتح المحادثة' };
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
                    await this.page.$('[aria-label="رسالة"]') ||
                    await this.page.$('[aria-label="Aa"]') ||
                    await this.page.$('[contenteditable="true"]');

                if (messageBox) {
                    await messageBox.click();
                    await this.delay(500);
                    await this.page.keyboard.type(message, { delay: 15 });
                } else {
                    return { success: false, error: 'لم يتم العثور على مربع الكتابة' };
                }
            }

            // Send
            await this.page.keyboard.press('Enter');
            await this.delay(2000);

            return { success: true };
        } catch (err) {
            console.error(`[Puppeteer] Failed to send to ${recipientName || recipientId}:`, err.message);
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
