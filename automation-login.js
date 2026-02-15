// سكريبت تسجيل دخول Facebook للـ Automation
// شغّل مرة واحدة بس: node automation-login.js
// بعد كدا الـ cookies هتتحفظ والسيرفر هيستخدمها تلقائي

const MessengerAutomation = require('./messenger-automation');

async function login() {
    console.log('🤖 فتح المتصفح...');
    const bot = new MessengerAutomation();
    await bot.initialize(false); // headless = false عشان تشوف المتصفح

    console.log('');
    console.log('📋 ================================');
    console.log('   سجّل دخول Facebook في المتصفح');
    console.log('   اللي فتح دلوقتي');
    console.log('================================');
    console.log('');

    // Open Facebook login page
    await bot.page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2' });

    // Wait for user to login manually
    console.log('⏳ مستني تسجل دخول...');
    console.log('   (المتصفح هيفضل مفتوح لحد ما تسجل دخول)');
    console.log('');

    // Poll for login status every 3 seconds
    let isLoggedIn = false;
    let attempts = 0;
    const maxAttempts = 120; // 6 minutes max

    while (!isLoggedIn && attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 3000));
        attempts++;

        try {
            isLoggedIn = await bot.page.evaluate(() => {
                return document.querySelector('[aria-label="Account"]') !== null ||
                    document.querySelector('[aria-label="الحساب"]') !== null ||
                    document.querySelector('[data-pagelet="RightRail"]') !== null ||
                    document.querySelector('[role="banner"]') !== null;
            });
        } catch (e) {
            // Page might be navigating
        }

        if (attempts % 10 === 0) {
            console.log(`⏳ لسه مستني... (${attempts * 3} ثانية)`);
        }
    }

    if (isLoggedIn) {
        await bot.saveCookies();
        console.log('');
        console.log('✅ ================================');
        console.log('   تم تسجيل الدخول بنجاح!');
        console.log('   الـ Cookies اتحفظت في fb_cookies.json');
        console.log('   ');
        console.log('   أعد تشغيل السيرفر (node server.js)');
        console.log('   والـ Puppeteer هيشتغل تلقائي 🚀');
        console.log('================================');
    } else {
        console.log('');
        console.log('❌ انتهى الوقت - ما قدرتش أتأكد من تسجيل الدخول');
        console.log('   شغّل السكريبت تاني وجرب من أول');
    }

    await bot.close();
    process.exit(0);
}

login().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
