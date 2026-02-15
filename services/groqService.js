// 🤖 Groq AI Service - Real AI-Powered Analysis
// Uses Llama 3 70B for intelligent competitor analysis in Arabic

const Groq = require('groq-sdk');

class GroqAIService {
    constructor() {
        this.client = null;
        this.model = 'llama-3.3-70b-versatile';
        this.initialized = false;
    }

    init() {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.warn('[Groq AI] API key not found. AI analysis disabled.');
            return false;
        }

        try {
            this.client = new Groq({ apiKey });
            this.initialized = true;
            console.log('[Groq AI] Service initialized successfully');
            return true;
        } catch (err) {
            console.error('[Groq AI] Failed to initialize:', err.message);
            return false;
        }
    }

    isAvailable() {
        return this.initialized && this.client !== null;
    }

    // ============= MAIN ANALYSIS FUNCTION =============
    async analyzeCompetitor(competitorData) {
        if (!this.isAvailable()) {
            return null;
        }

        try {
            // Run all AI analyses
            const [swotAnalysis, topPostsAnalysis, engagementAnalysis] = await Promise.all([
                this.generateSWOT(competitorData),
                this.analyzeTopPosts(competitorData),
                this.analyzeEngagement(competitorData)
            ]);

            return {
                swot: swotAnalysis,
                topPosts: topPostsAnalysis,
                engagement: engagementAnalysis,
                aiPowered: true
            };

        } catch (err) {
            console.error('[Groq AI] Analysis error:', err.message);
            return null;
        }
    }

    // ============= SWOT ANALYSIS BY AI =============
    async generateSWOT(data) {
        const prompt = this.buildSWOTPrompt(data);

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'system',
                        content: `أنت خبير في تحليل صفحات السوشيال ميديا.
مهمتك: تقديم تحليل SWOT احترافي ومفيد.
الإرشادات:
- كن محدداً ومباشراً
- استخدم أرقام وبيانات من المعلومات المتاحة
- قدم نصائح عملية قابلة للتنفيذ
- استخدم إيموجي مناسبة
- اكتب بالعربية الفصحى السهلة`
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 1500
            });

            const aiResponse = response.choices[0]?.message?.content;
            return this.parseSWOTResponse(aiResponse);

        } catch (err) {
            console.error('[Groq AI] SWOT error:', err.message);
            return null;
        }
    }

    buildSWOTPrompt(data) {
        const name = data.name || 'المنافس';
        const followers = data.followers || 0;
        const likes = data.likes || 0;
        const engagement = data.metrics?.engagementRate || 0;
        const postsPerWeek = data.metrics?.postsPerWeek || 0;
        const avgLikes = data.metrics?.avgLikes || 0;
        const avgComments = data.metrics?.avgComments || 0;
        const avgShares = data.metrics?.avgShares || 0;
        const posts = data.posts || [];

        // Get top 5 posts content
        let postsContent = '';
        if (posts.length > 0) {
            const sortedPosts = [...posts].sort((a, b) =>
                ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0))
            );
            postsContent = sortedPosts.slice(0, 5).map((p, i) =>
                `${i + 1}. "${(p.text || 'بدون نص').substring(0, 150)}" - ${p.likes || 0} لايك، ${p.comments || 0} تعليق، ${p.shares || 0} مشاركة`
            ).join('\n');
        }

        return `حلل صفحة فيسبوك "${name}" وقدم تحليل SWOT مفصل:

📊 بيانات الصفحة:
- المتابعين: ${followers.toLocaleString()}
- المعجبين: ${likes.toLocaleString()}
- معدل التفاعل: ${engagement}%
- معدل النشر: ${postsPerWeek} منشور/أسبوع
- متوسط اللايكات: ${avgLikes}
- متوسط التعليقات: ${avgComments}
- متوسط المشاركات: ${avgShares}

📝 أفضل المنشورات:
${postsContent || 'لا توجد منشورات'}

---

قدم تحليل SWOT بالشكل التالي (كل نقطة في سطر جديد):

## نقاط القوة (Strengths)
- [اذكر 3-4 نقاط قوة محددة بناءً على البيانات]

## نقاط الضعف (Weaknesses)
- [اذكر 3-4 نقاط ضعف واضحة]

## الفرص (Opportunities)
- [اذكر 3-4 فرص للتفوق على هذا المنافس]

## التهديدات (Threats)
- [اذكر 2-3 تهديدات يجب الحذر منها]

كن محدداً واستخدم الأرقام الفعلية من البيانات.`;
    }

    parseSWOTResponse(response) {
        if (!response) return null;

        const result = {
            strengths: [],
            weaknesses: [],
            opportunities: [],
            threats: [],
            raw: response
        };

        // Parse strengths
        const strengthsMatch = response.match(/نقاط القوة[^]*?(?=##|نقاط الضعف|$)/i);
        if (strengthsMatch) {
            result.strengths = this.extractBulletPoints(strengthsMatch[0]);
        }

        // Parse weaknesses
        const weaknessesMatch = response.match(/نقاط الضعف[^]*?(?=##|الفرص|$)/i);
        if (weaknessesMatch) {
            result.weaknesses = this.extractBulletPoints(weaknessesMatch[0]);
        }

        // Parse opportunities
        const opportunitiesMatch = response.match(/الفرص[^]*?(?=##|التهديدات|$)/i);
        if (opportunitiesMatch) {
            result.opportunities = this.extractBulletPoints(opportunitiesMatch[0]);
        }

        // Parse threats
        const threatsMatch = response.match(/التهديدات[^]*$/i);
        if (threatsMatch) {
            result.threats = this.extractBulletPoints(threatsMatch[0]);
        }

        return result;
    }

    extractBulletPoints(text) {
        const lines = text.split('\n');
        const points = [];
        const icons = ['💪', '📈', '🎯', '⚡', '🔥', '✨', '📊', '💡'];

        lines.forEach((line, index) => {
            const cleaned = line.replace(/^[-*•\d.)\s]+/, '').trim();
            if (cleaned.length > 10 && !cleaned.includes('##') && !cleaned.includes(':')) {
                points.push({
                    icon: cleaned.match(/[\u{1F300}-\u{1F9FF}]/u)?.[0] || icons[index % icons.length],
                    text: cleaned.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim()
                });
            }
        });

        return points.slice(0, 5);
    }

    // ============= TOP POSTS ANALYSIS =============
    async analyzeTopPosts(data) {
        const posts = data.posts || [];
        if (posts.length === 0) return null;

        // Sort by engagement
        const sortedPosts = [...posts].sort((a, b) =>
            ((b.likes || 0) + (b.comments || 0) * 2 + (b.shares || 0) * 3) -
            ((a.likes || 0) + (a.comments || 0) * 2 + (a.shares || 0) * 3)
        );

        const topPost = sortedPosts[0];
        const postsInfo = sortedPosts.slice(0, 3).map((p, i) =>
            `${i + 1}. "${(p.text || '').substring(0, 100)}" (${p.likes || 0} لايك، ${p.comments || 0} تعليق)`
        ).join('\n');

        const prompt = `حلل أفضل منشورات هذا المنافس:

${postsInfo}

اشرح في 3-4 نقاط:
1. لماذا هذه المنشورات ناجحة؟
2. ما الأسلوب المستخدم؟
3. كيف يمكنني كتابة منشورات أفضل منها؟

كن محدداً ومختصراً.`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: 'أنت خبير في تحليل المحتوى. قدم تحليلاً مختصراً ومفيداً.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 800
            });

            return {
                topPost: {
                    text: topPost.text?.substring(0, 200) || 'بدون نص',
                    likes: topPost.likes || 0,
                    comments: topPost.comments || 0,
                    shares: topPost.shares || 0
                },
                analysis: response.choices[0]?.message?.content || null
            };

        } catch (err) {
            console.error('[Groq AI] Top posts error:', err.message);
            return null;
        }
    }

    // ============= ENGAGEMENT ANALYSIS =============
    async analyzeEngagement(data) {
        const engagement = data.metrics?.engagementRate || 0;
        const followers = data.followers || 0;
        const avgLikes = data.metrics?.avgLikes || 0;
        const avgComments = data.metrics?.avgComments || 0;
        const postsPerWeek = data.metrics?.postsPerWeek || 0;

        const prompt = `حلل التفاعل على صفحة فيسبوك:

- المتابعين: ${followers.toLocaleString()}
- معدل التفاعل: ${engagement}%
- متوسط اللايكات: ${avgLikes}
- متوسط التعليقات: ${avgComments}
- النشر: ${postsPerWeek} منشور/أسبوع

قدم:
1. تقييم التفاعل (ممتاز/جيد/متوسط/ضعيف) مع السبب
2. ما الذي يجعل التفاعل بهذا المستوى؟
3. كيف أحقق تفاعل أعلى منه؟

كن مختصراً ومفيداً.`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: 'أنت خبير في تحليل التفاعل على السوشيال ميديا.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 600
            });

            const rating = this.getEngagementRating(engagement);

            return {
                rate: engagement,
                rating: rating.label,
                ratingColor: rating.color,
                analysis: response.choices[0]?.message?.content || null
            };

        } catch (err) {
            console.error('[Groq AI] Engagement error:', err.message);
            return null;
        }
    }

    getEngagementRating(rate) {
        if (rate >= 3.5) return { label: 'ممتاز 🌟', color: '#10b981' };
        if (rate >= 2) return { label: 'جيد 🟢', color: '#22c55e' };
        if (rate >= 1) return { label: 'متوسط 🟡', color: '#eab308' };
        if (rate >= 0.5) return { label: 'ضعيف 🟠', color: '#f97316' };
        return { label: 'ضعيف جداً 🔴', color: '#ef4444' };
    }

    // ============= GENERATE CONTENT IDEAS =============
    async generateContentIdeas(competitorData) {
        if (!this.isAvailable()) return null;

        const name = competitorData.name || 'المنافس';
        const posts = competitorData.posts || [];

        const postsInfo = posts.slice(0, 5).map(p =>
            `- ${(p.text || '').substring(0, 80)}`
        ).join('\n');

        const prompt = `بناءً على محتوى المنافس "${name}":

${postsInfo}

اقترح 5 أفكار منشورات للتفوق عليه:
- يجب أن تكون الأفكار مختلفة وأفضل
- اكتب كل فكرة بشكل منشور جاهز للنسخ
- استخدم إيموجي وهاشتاقات

اكتب كل منشور في فقرة منفصلة.`;

        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: 'أنت كاتب محتوى محترف. اكتب منشورات جذابة وتفاعلية بالعربية.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 1000
            });

            return response.choices[0]?.message?.content || null;

        } catch (err) {
            console.error('[Groq AI] Content ideas error:', err.message);
            return null;
        }
    }

    // ============= SPINTAX GENERATOR =============
    async generateSpintax(message) {
        // AI produces unreliable results - use manual conversion
        return this.manualSpintaxConvert(message);
    }

    // Manual spintax conversion (more reliable)
    manualSpintaxConvert(message) {
        const replacements = [
            // === GREETINGS (at start only) ===
            { find: /^اهلا و سهلا/gi, replace: '{اهلا وسهلا|مرحبا|السلام عليكم}' },
            { find: /^مرحبا بكم/gi, replace: '{مرحبا بكم|اهلا بكم|السلام عليكم}' },
            { find: /^مرحبا/gi, replace: '{مرحبا|اهلا|السلام عليكم}' },
            { find: /^اهلا/gi, replace: '{اهلا|مرحبا|السلام عليكم}' },
            { find: /^السلام عليكم/gi, replace: '{السلام عليكم|مرحبا|اهلا}' },

            // === WELCOME WORDS (anywhere) ===
            { find: /بيكم/gi, replace: '{بيكم|بكم}' },
            { find: /جميعا/gi, replace: '{جميعا|كلكم|جميعكم}' },

            // === SERVICE WORDS ===
            { find: /خدمة جديدة/gi, replace: '{خدمة جديدة|خدمة مميزة|خدمة حصرية}' },
            { find: /خدمة/gi, replace: '{خدمة|خدماتنا}' },
            { find: /خدمات/gi, replace: '{خدمات|خدماتنا}' },

            // === OFFERS ===
            { find: /عرض جديد/gi, replace: '{عرض جديد|عرض مميز|عرض حصري}' },
            { find: /عرض رائع/gi, replace: '{عرض رائع|عرض مميز|خصم رائع}' },
            { find: /عرض مميز/gi, replace: '{عرض مميز|عرض حصري|خصم مميز}' },
            { find: /خصم/gi, replace: '{خصم|تخفيض|عرض}' },

            // === ADJECTIVES ===
            { find: /رائع/gi, replace: '{رائع|مميز|ممتاز}' },
            { find: /مميز/gi, replace: '{مميز|رائع|حصري}' },
            { find: /حصري/gi, replace: '{حصري|مميز|خاص}' },
            { find: /جديد/gi, replace: '{جديد|جديدة|حديث}' },

            // === ACTIONS ===
            { find: /لدينا/gi, replace: '{لدينا|عندنا|نقدم لكم}' },
            { find: /عندنا/gi, replace: '{عندنا|لدينا|نقدم لكم}' },
            { find: /نقدم لكم/gi, replace: '{نقدم لكم|لدينا|عندنا}' },

            // === CONTACT ===
            { find: /تواصل معنا/gi, replace: '{تواصل معنا|راسلنا|اتصل بنا}' },
            { find: /راسلنا/gi, replace: '{راسلنا|تواصل معنا|كلمنا}' },
            { find: /اتصل بنا/gi, replace: '{اتصل بنا|تواصل معنا|راسلنا}' },

            // === TIME ===
            { find: /الآن/gi, replace: '{الآن|اليوم|حالا}' },
            { find: /اليوم/gi, replace: '{اليوم|الآن|حالا}' },
        ];

        let result = message;
        for (const rep of replacements) {
            result = result.replace(rep.find, rep.replace);
        }
        return result;
    }
}

module.exports = new GroqAIService();
