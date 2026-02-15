// Facebook Competitor Scraper Service using Puppeteer
const puppeteer = require('puppeteer');

class CompetitorScraper {
    constructor() {
        this.browser = null;
    }

    // Helper function to replace deprecated waitForTimeout
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Initialize browser
    async initBrowser() {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080'
                ]
            });
            console.log('[Scraper] Browser initialized');
        }
        return this.browser;
    }

    // Close browser
    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            console.log('[Scraper] Browser closed');
        }
    }

    // Extract page ID/username from URL
    extractPageId(url) {
        try {
            const urlObj = new URL(url);
            let pathname = urlObj.pathname.replace(/\/$/, ''); // Remove trailing slash

            // Handle different URL formats
            // facebook.com/PageName
            // facebook.com/pages/PageName/12345
            // facebook.com/profile.php?id=12345

            if (pathname.includes('/pages/')) {
                const parts = pathname.split('/');
                const pageIndex = parts.indexOf('pages');
                return parts[pageIndex + 1] || parts[pageIndex + 2];
            }

            if (urlObj.searchParams.has('id')) {
                return urlObj.searchParams.get('id');
            }

            // Simple page name
            return pathname.split('/').filter(p => p && p !== 'pg')[0] || null;
        } catch (err) {
            console.error('[Scraper] Error extracting page ID:', err.message);
            return null;
        }
    }

    // Main scrape function
    async scrapeFacebookPage(url) {
        console.log(`[Scraper] Starting scrape for: ${url}`);

        const pageId = this.extractPageId(url);
        if (!pageId) {
            return { error: 'رابط الصفحة غير صحيح' };
        }

        let browser = null;
        let page = null;

        try {
            browser = await this.initBrowser();
            page = await browser.newPage();

            // Set user agent to avoid detection
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            // Set viewport
            await page.setViewport({ width: 1920, height: 1080 });

            // Navigate to Facebook page
            const pageUrl = url.includes('facebook.com') ? url : `https://www.facebook.com/${pageId}`;
            console.log(`[Scraper] Navigating to: ${pageUrl}`);

            await page.goto(pageUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Wait for page to load fully
            await this.delay(5000);

            // Scroll down to trigger lazy loading
            await page.evaluate(() => window.scrollBy(0, 500));
            await this.delay(2000);

            // Check if page exists
            const pageNotFound = await page.$('text/Page Not Found');
            if (pageNotFound) {
                return { error: 'الصفحة غير موجودة' };
            }

            // Extract page data with improved selectors
            const pageData = await page.evaluate(() => {
                const result = {
                    name: '',
                    category: '',
                    followers: 0,
                    likes: 0,
                    description: '',
                    picture: '',
                    website: '',
                    phone: '',
                    email: ''
                };

                // Page name - try multiple selectors (expanded)
                const nameSelectors = [
                    'h1',
                    'h1 span',
                    '[data-testid="page_title"]',
                    '.x1heor9g.x1qlqyl8.x1pd3egz.x1a2a7pz',
                    '[role="main"] h1',
                    'span[dir="auto"] > span'
                ];

                for (const selector of nameSelectors) {
                    const el = document.querySelector(selector);
                    if (el && el.innerText.trim() && el.innerText.length < 100) {
                        result.name = el.innerText.trim();
                        break;
                    }
                }

                // Category - expanded selectors (avoid login links)
                const categorySelectors = [
                    '[data-testid="page_category"]',
                    '.x1i10hfl.x1qjc9v5',
                    'a[href*="/pages/category/"]'
                ];

                for (const selector of categorySelectors) {
                    const el = document.querySelector(selector);
                    if (el && el.innerText.trim()) {
                        const text = el.innerText.trim();
                        // Check if it looks like a category (not login/navigation text)
                        const skipWords = ['log in', 'login', 'sign up', 'متابع', 'followers', 'home', 'الرئيسية'];
                        const isValid = text.length < 50 && text.length > 2 &&
                            !skipWords.some(w => text.toLowerCase().includes(w.toLowerCase()));
                        if (isValid) {
                            result.category = text;
                            break;
                        }
                    }
                }

                // If no category found, set default
                if (!result.category) {
                    result.category = 'صفحة فيسبوك';
                }

                // Followers and Likes - look for text containing these Arabic/English words
                const allText = document.body.innerText;

                // More flexible Arabic patterns
                const followersMatchAr = allText.match(/(\d+[\d\s,\.]*(?:\s*[KMB])?)\s*(?:متابع|متابعين|كشخص متابع)/i);
                const likesMatchAr = allText.match(/(\d+[\d\s,\.]*(?:\s*[KMB])?)\s*(?:إعجاب|معجب|إعجابات)/i);

                // English patterns (expanded)
                const followersMatchEn = allText.match(/(\d+[\d\s,\.]*(?:\s*[KMB])?)\s*(?:followers|people follow)/i);
                const likesMatchEn = allText.match(/(\d+[\d\s,\.]*(?:\s*[KMB])?)\s*(?:likes|people like)/i);

                // Parse number helper - improved
                const parseCount = (str) => {
                    if (!str) return 0;
                    // Remove all spaces and commas
                    str = str.replace(/[\s,]/g, '');
                    let multiplier = 1;
                    if (/[Kك]/i.test(str)) multiplier = 1000;
                    if (/[Mم]/i.test(str)) multiplier = 1000000;
                    if (/B/i.test(str)) multiplier = 1000000000;
                    const num = parseFloat(str.replace(/[KMBكم]/gi, ''));
                    return isNaN(num) ? 0 : Math.round(num * multiplier);
                };

                if (followersMatchAr) result.followers = parseCount(followersMatchAr[1]);
                else if (followersMatchEn) result.followers = parseCount(followersMatchEn[1]);

                if (likesMatchAr) result.likes = parseCount(likesMatchAr[1]);
                else if (likesMatchEn) result.likes = parseCount(likesMatchEn[1]);

                // If likes not found, use followers count
                if (result.likes === 0 && result.followers > 0) {
                    result.likes = result.followers;
                }

                // Profile picture - expanded selectors
                const picSelectors = [
                    'image[preserveAspectRatio]',
                    'svg image',
                    'img[data-imgperflogname="profileCoverPhoto"]',
                    '[role="main"] img[src*="scontent"]',
                    'img[alt*="profile"]'
                ];

                for (const selector of picSelectors) {
                    const picEl = document.querySelector(selector);
                    if (picEl) {
                        const src = picEl.getAttribute('xlink:href') || picEl.getAttribute('href') || picEl.src;
                        if (src && src.includes('scontent')) {
                            result.picture = src;
                            break;
                        }
                    }
                }

                // Fallback: try to get any profile picture
                if (!result.picture) {
                    const allImages = document.querySelectorAll('img[src*="scontent"]');
                    for (const img of allImages) {
                        if (img.src && (img.width > 80 || img.height > 80)) {
                            result.picture = img.src;
                            break;
                        }
                    }
                }

                // Description/About - expanded
                const aboutSelectors = [
                    '[data-testid="page_about"]',
                    '.x193iq5w.xeuugli.x13faqbe',
                    '[role="main"] div[style*="max-height"]',
                    'div[dir="auto"] > span'
                ];

                for (const selector of aboutSelectors) {
                    const aboutEl = document.querySelector(selector);
                    if (aboutEl && aboutEl.innerText.length > 20 && aboutEl.innerText.length < 1000) {
                        result.description = aboutEl.innerText.trim().substring(0, 500);
                        break;
                    }
                }

                return result;
            });

            console.log(`[Scraper] Page data extracted:`, pageData);

            // Try to scrape posts
            const posts = await this.scrapePagePosts(page);

            // Calculate metrics
            const metrics = this.calculateMetrics(pageData, posts);

            // Close the page (but keep browser)
            await page.close();

            return {
                ...pageData,
                url: pageUrl,
                posts: posts,
                metrics: metrics,
                scrapedAt: new Date().toISOString()
            };

        } catch (err) {
            console.error('[Scraper] Error:', err.message);
            if (page) await page.close().catch(() => { });
            return { error: `خطأ في التحليل: ${err.message}` };
        }
    }

    // Scrape recent posts - IMPROVED VERSION
    async scrapePagePosts(page) {
        try {
            console.log('[Scraper] Scraping posts...');

            // Scroll down multiple times to load more posts
            for (let i = 0; i < 5; i++) {
                await page.evaluate(() => window.scrollBy(0, 800));
                await this.delay(1500);
            }

            // Wait for posts to render
            await this.delay(2000);

            const posts = await page.evaluate(() => {
                // Multiple selectors for posts
                const postSelectors = [
                    '[role="article"]',
                    '[data-testid="post_message"]',
                    '.x1yztbdb.x1n2onr6',
                    '.x1iorvi4.x1pi30zi'
                ];

                let postElements = [];
                for (const sel of postSelectors) {
                    const elements = document.querySelectorAll(sel);
                    if (elements.length > postElements.length) {
                        postElements = elements;
                    }
                }

                const postsData = [];
                const parseNumber = (str) => {
                    if (!str) return 0;
                    str = str.replace(/[,\s]/g, '');
                    let mult = 1;
                    if (/[Kك]/i.test(str)) mult = 1000;
                    if (/[Mم]/i.test(str)) mult = 1000000;
                    const num = parseFloat(str.replace(/[KMكم]/gi, ''));
                    return isNaN(num) ? 0 : Math.round(num * mult);
                };

                postElements.forEach((post, index) => {
                    if (index >= 15) return; // Get up to 15 posts

                    const postData = {
                        text: '',
                        likes: 0,
                        comments: 0,
                        shares: 0
                    };

                    // Get post text - try multiple approaches
                    const textSelectors = [
                        '[data-ad-preview="message"]',
                        '.x1iorvi4.x78zum5',
                        '[dir="auto"]'
                    ];

                    for (const sel of textSelectors) {
                        const textEl = post.querySelector(sel);
                        if (textEl && textEl.innerText.trim().length > 10) {
                            postData.text = textEl.innerText.trim().substring(0, 400);
                            break;
                        }
                    }

                    // If no text from selectors, try the whole post text
                    if (!postData.text) {
                        const allText = post.innerText;
                        // Get first meaningful paragraph (skip metadata)
                        const lines = allText.split('\n').filter(l => l.trim().length > 20);
                        if (lines.length > 0) {
                            postData.text = lines[0].substring(0, 400);
                        }
                    }

                    // Parse engagement numbers from post text
                    const postText = post.innerText;

                    // Likes/Reactions patterns
                    const likesPatterns = [
                        /(\d+(?:[.,]\d+)*[KMكم]?)\s*(?:likes|إعجاب|reactions|تفاعل)/gi,
                        /(?:All|Like).*?(\d+(?:[.,]\d+)*[KMكم]?)/gi
                    ];
                    for (const pattern of likesPatterns) {
                        const match = postText.match(pattern);
                        if (match) {
                            const numMatch = match[0].match(/(\d+(?:[.,\d]*)[KMكم]?)/);
                            if (numMatch) {
                                postData.likes = parseNumber(numMatch[1]);
                                break;
                            }
                        }
                    }

                    // Comments
                    const commentsMatch = postText.match(/(\d+(?:[.,]\d+)*[KMكم]?)\s*(?:comments|تعليق)/i);
                    if (commentsMatch) {
                        postData.comments = parseNumber(commentsMatch[1]);
                    }

                    // Shares
                    const sharesMatch = postText.match(/(\d+(?:[.,]\d+)*[KMكم]?)\s*(?:shares|مشاركة)/i);
                    if (sharesMatch) {
                        postData.shares = parseNumber(sharesMatch[1]);
                    }

                    // Only add posts with content or engagement
                    if (postData.text.length > 10 || postData.likes > 0 || postData.comments > 0) {
                        postsData.push(postData);
                    }
                });

                return postsData;
            });

            console.log(`[Scraper] Found ${posts.length} posts`);
            return posts;

        } catch (err) {
            console.log('[Scraper] Could not scrape posts:', err.message);
            return [];
        }
    }

    // Calculate engagement metrics - IMPROVED VERSION
    calculateMetrics(pageData, posts) {
        const followers = pageData.followers || pageData.likes || 1;

        const metrics = {
            engagementRate: 0,
            postsPerWeek: 0,
            avgLikes: 0,
            avgComments: 0,
            avgShares: 0,
            totalEngagement: 0,
            dataQuality: 'complete', // complete, partial, estimated
            dataNote: ''
        };

        // Calculate totals from posts
        let totalLikes = 0;
        let totalComments = 0;
        let totalShares = 0;
        let postsWithEngagement = 0;

        posts.forEach(post => {
            totalLikes += post.likes || 0;
            totalComments += post.comments || 0;
            totalShares += post.shares || 0;
            if ((post.likes || 0) > 0 || (post.comments || 0) > 0) {
                postsWithEngagement++;
            }
        });

        metrics.totalEngagement = totalLikes + totalComments + totalShares;

        // Check if we have real engagement data
        if (postsWithEngagement > 0 && metrics.totalEngagement > 0) {
            // We have real data
            metrics.avgLikes = Math.round(totalLikes / posts.length);
            metrics.avgComments = Math.round(totalComments / posts.length);
            metrics.avgShares = Math.round(totalShares / posts.length);

            const avgEngagement = (metrics.avgLikes + metrics.avgComments + metrics.avgShares);
            metrics.engagementRate = parseFloat(((avgEngagement / followers) * 100).toFixed(2));
            metrics.dataQuality = 'complete';
        } else {
            // No engagement data - estimate based on follower tier
            // Industry averages: 1-10K followers = ~3%, 10-100K = ~2%, 100K+ = ~1.5%
            metrics.dataQuality = 'estimated';

            if (followers >= 100000) {
                metrics.engagementRate = 1.5; // Large pages typically have lower %
                metrics.dataNote = 'تقدير بناء على حجم الصفحة (صفحة كبيرة)';
            } else if (followers >= 50000) {
                metrics.engagementRate = 2.0;
                metrics.dataNote = 'تقدير بناء على حجم الصفحة';
            } else if (followers >= 10000) {
                metrics.engagementRate = 2.5;
                metrics.dataNote = 'تقدير بناء على حجم الصفحة';
            } else if (followers >= 5000) {
                metrics.engagementRate = 3.0;
                metrics.dataNote = 'تقدير بناء على حجم الصفحة';
            } else if (followers >= 1000) {
                metrics.engagementRate = 3.5;
                metrics.dataNote = 'تقدير بناء على حجم الصفحة';
            } else {
                metrics.engagementRate = 4.0;
                metrics.dataNote = 'تقدير للصفحات الصغيرة';
            }

            // Estimate average engagement based on rate
            metrics.avgLikes = Math.round(followers * (metrics.engagementRate / 100));
            metrics.avgComments = Math.round(metrics.avgLikes * 0.1);
            metrics.avgShares = Math.round(metrics.avgLikes * 0.05);
        }

        // Estimate posts per week
        if (posts.length > 0) {
            // Assume we scraped ~1-2 weeks worth of visible posts
            metrics.postsPerWeek = Math.max(1, Math.round(posts.length / 1.5));
        } else {
            metrics.postsPerWeek = 0;
        }

        return metrics;
    }

    // Generate SWOT analysis
    generateSWOT(competitors) {
        if (!competitors || competitors.length === 0) {
            return null;
        }

        // Sort by followers for comparison
        const sorted = [...competitors].sort((a, b) => (b.followers || 0) - (a.followers || 0));
        const topCompetitor = sorted[0];

        // Calculate averages
        const avgFollowers = competitors.reduce((a, b) => a + (b.followers || 0), 0) / competitors.length;
        const avgEngagement = competitors.reduce((a, b) => a + (b.metrics?.engagementRate || 0), 0) / competitors.length;
        const avgPostsPerWeek = competitors.reduce((a, b) => a + (b.metrics?.postsPerWeek || 0), 0) / competitors.length;

        const swot = {
            strengths: [],
            weaknesses: [],
            opportunities: [],
            threats: []
        };

        competitors.forEach(comp => {
            const name = comp.name || 'منافس';
            const followers = comp.followers || 0;
            const engagement = comp.metrics?.engagementRate || 0;
            const postsPerWeek = comp.metrics?.postsPerWeek || 0;

            // Strengths
            if (engagement > avgEngagement * 1.2) {
                swot.strengths.push(`${name}: معدل تفاعل مرتفع (${engagement}%)`);
            }
            if (followers > avgFollowers * 1.5) {
                swot.strengths.push(`${name}: قاعدة متابعين كبيرة (${this.formatNumber(followers)})`);
            }
            if (postsPerWeek > avgPostsPerWeek * 1.3) {
                swot.strengths.push(`${name}: نشاط مستمر (${postsPerWeek} منشور/أسبوع)`);
            }

            // Weaknesses
            if (engagement < avgEngagement * 0.5) {
                swot.weaknesses.push(`${name}: تفاعل ضعيف (${engagement}%)`);
            }
            if (postsPerWeek < 2) {
                swot.weaknesses.push(`${name}: نشر قليل (${postsPerWeek} منشور/أسبوع)`);
            }

            // Opportunities
            if (followers < avgFollowers && engagement > avgEngagement) {
                swot.opportunities.push(`${name}: إمكانية نمو عالية - تفاعل جيد مع متابعين أقل`);
            }

            // Threats
            if (followers > avgFollowers * 2) {
                swot.threats.push(`${name}: منافس قوي بقاعدة كبيرة`);
            }
            if (engagement > avgEngagement * 2) {
                swot.threats.push(`${name}: منافس بتفاعل استثنائي`);
            }
        });

        return swot;
    }

    // Format number helper
    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
}

module.exports = new CompetitorScraper();
