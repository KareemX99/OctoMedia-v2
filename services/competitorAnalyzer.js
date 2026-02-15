// 🚀 PRO Competitor Analysis Service v3.0
// Ultra-Smart Analysis - Better than AI!
// Features: Sentiment, Timing, Content Types, Strategies, Detailed Scoring

class CompetitorAnalyzer {
    constructor() {
        // ============= BENCHMARKS DATABASE =============
        this.benchmarks = {
            engagementRate: {
                poor: { max: 0.5, label: 'ضعيف جداً', color: '#ef4444', emoji: '🔴', score: 10 },
                low: { max: 1, label: 'ضعيف', color: '#f97316', emoji: '🟠', score: 30 },
                average: { max: 2, label: 'متوسط', color: '#eab308', emoji: '🟡', score: 50 },
                good: { max: 3.5, label: 'جيد', color: '#22c55e', emoji: '🟢', score: 75 },
                excellent: { max: 100, label: 'ممتاز', color: '#10b981', emoji: '🌟', score: 95 }
            },
            postsPerWeek: {
                poor: { max: 1, label: 'قليل جداً', score: 15 },
                low: { max: 2, label: 'قليل', score: 35 },
                average: { max: 4, label: 'متوسط', score: 55 },
                good: { max: 7, label: 'جيد', score: 75 },
                excellent: { max: 100, label: 'نشط جداً', score: 90 }
            },
            followersGrowth: {
                micro: { max: 1000, tier: 'ناشئ صغير', difficulty: 'سهل جداً', color: '#22c55e' },
                small: { max: 5000, tier: 'ناشئ', difficulty: 'سهل', color: '#84cc16' },
                growing: { max: 20000, tier: 'نامي', difficulty: 'متوسط', color: '#eab308' },
                medium: { max: 50000, tier: 'متوسط', difficulty: 'صعب قليلاً', color: '#f97316' },
                large: { max: 100000, tier: 'كبير', difficulty: 'صعب', color: '#ef4444' },
                huge: { max: Infinity, tier: 'ضخم', difficulty: 'صعب جداً', color: '#dc2626' }
            }
        };

        // ============= SMART TIPS DATABASE =============
        this.strategies = {
            beatLowEngagement: {
                title: '🎯 استراتيجية التفوق في التفاعل',
                tactics: [
                    { action: 'اطرح سؤالاً في كل منشور', impact: 'زيادة التعليقات 40%' },
                    { action: 'استخدم الاستفتاءات أسبوعياً', impact: 'تفاعل أعلى 3x' },
                    { action: 'رد على كل تعليق خلال ساعة', impact: 'ولاء أكبر للمتابعين' },
                    { action: 'اطلب من المتابعين مشاركة تجاربهم', impact: 'محتوى مجاني + تفاعل' },
                    { action: 'استخدم Call-to-Action واضح', impact: 'زيادة التحويلات 25%' }
                ]
            },
            beatLowPosting: {
                title: '📅 استراتيجية التفوق في النشر',
                tactics: [
                    { action: 'جدول منشوراتك لأسبوع مقدماً', impact: 'انتظام بدون جهد' },
                    { action: 'أنشئ تقويم محتوى شهري', impact: 'خطة واضحة' },
                    { action: 'استخدم Stories يومياً', impact: 'ظهور مستمر' },
                    { action: 'أعد نشر المحتوى الناجح', impact: 'محتوى بدون جهد إضافي' },
                    { action: 'حول منشور واحد لـ 5 صيغ', impact: 'محتوى أكثر بجهد أقل' }
                ]
            },
            contentMastery: {
                title: '✨ استراتيجية المحتوى المتميز',
                tactics: [
                    { action: 'الفيديو = 3x تفاعل من الصور', impact: 'وصول أوسع' },
                    { action: 'Reels قصيرة 15-30 ثانية', impact: 'أعلى وصول مجاني' },
                    { action: 'البث المباشر أسبوعياً', impact: 'وصول 6x أكثر' },
                    { action: '3-5 هاشتاقات مستهدفة', impact: 'اكتشاف من جمهور جديد' },
                    { action: 'الإيموجي في البداية', impact: 'جذب الانتباه سريعاً' }
                ]
            },
            audienceGrowth: {
                title: '🚀 استراتيجية نمو المتابعين',
                tactics: [
                    { action: 'تعاون مع صفحات مشابهة', impact: 'وصول لجمهور جديد' },
                    { action: 'مسابقات شهرية', impact: 'نمو سريع في المتابعين' },
                    { action: 'محتوى قابل للمشاركة', impact: 'انتشار viral' },
                    { action: 'الرد على التعليقات في الصفحات الكبيرة', impact: 'ظهور مجاني' },
                    { action: 'استخدم Reels الترند', impact: 'اكتشاف من الخوارزمية' }
                ]
            }
        };

        // ============= SENTIMENT KEYWORDS =============
        this.sentimentKeywords = {
            positive: ['ممتاز', 'رائع', 'جميل', 'أحسنت', 'مبروك', 'شكراً', 'حلو', '❤️', '🔥', '👏', '💪', '😍', 'amazing', 'great', 'love', 'best'],
            negative: ['سيء', 'ضعيف', 'مشكلة', 'خطأ', 'للأسف', 'صعب', 'مو زين', '😢', '😡', '👎', 'bad', 'worst', 'hate', 'terrible'],
            questions: ['كيف', 'ليش', 'متى', 'وين', 'شنو', 'هل', '؟', '?', 'how', 'why', 'what', 'when']
        };

        // ============= BEST POSTING TIMES =============
        this.bestPostingTimes = {
            weekday: [
                { time: '8:00 - 9:00', label: 'صباحاً', reason: 'بداية يوم العمل' },
                { time: '12:00 - 13:00', label: 'الظهر', reason: 'استراحة الغداء' },
                { time: '18:00 - 21:00', label: 'مساءً', reason: 'وقت الراحة', best: true }
            ],
            weekend: [
                { time: '10:00 - 12:00', label: 'صباحاً', reason: 'استيقاظ متأخر' },
                { time: '14:00 - 16:00', label: 'بعد الظهر', reason: 'وقت فراغ' },
                { time: '20:00 - 23:00', label: 'مساءً', reason: 'ذروة التصفح', best: true }
            ]
        };
    }

    // ============= MAIN ANALYSIS FUNCTION =============
    analyzeCompetitor(competitorData) {
        const analysis = {
            // Basic info
            overview: this.generateOverview(competitorData),

            // Benchmarks comparison
            benchmarks: this.compareToBenchmarks(competitorData),

            // Content deep analysis
            contentAnalysis: this.analyzeContent(competitorData),

            // Sentiment analysis
            sentimentAnalysis: this.analyzeSentiment(competitorData),

            // Posting patterns
            postingPatterns: this.analyzePostingPatterns(competitorData),

            // SWOT
            strengths: [],
            weaknesses: [],
            opportunities: [],
            threats: [],

            // Strategies
            strategies: [],

            // Recommendations
            recommendations: [],

            // Scores
            scores: {},
            overallScore: 0,

            // Verdict
            verdict: '',
            difficultyToCompete: ''
        };

        // Generate all insights
        this.generateSmartSWOT(competitorData, analysis);
        this.generateStrategies(competitorData, analysis);
        analysis.recommendations = this.generateRecommendations(competitorData, analysis);
        analysis.scores = this.calculateDetailedScores(analysis);
        analysis.overallScore = this.calculateOverallScore(analysis.scores);
        analysis.verdict = this.generateVerdict(analysis);
        analysis.difficultyToCompete = this.assessDifficulty(competitorData, analysis);

        return analysis;
    }

    // ============= DETAILED SCORING =============
    calculateDetailedScores(analysis) {
        const scores = {
            engagement: { value: 0, max: 30, label: 'التفاعل' },
            posting: { value: 0, max: 25, label: 'النشر' },
            content: { value: 0, max: 20, label: 'المحتوى' },
            audience: { value: 0, max: 15, label: 'الجمهور' },
            optimization: { value: 0, max: 10, label: 'التحسين' }
        };

        // Engagement score
        const engLevel = analysis.benchmarks.engagementRate.rating?.level;
        if (engLevel === 'excellent') scores.engagement.value = 30;
        else if (engLevel === 'good') scores.engagement.value = 22;
        else if (engLevel === 'average') scores.engagement.value = 15;
        else if (engLevel === 'low') scores.engagement.value = 8;
        else scores.engagement.value = 3;

        // Posting score
        const postLevel = analysis.benchmarks.postsPerWeek.rating?.level;
        if (postLevel === 'excellent') scores.posting.value = 25;
        else if (postLevel === 'good') scores.posting.value = 18;
        else if (postLevel === 'average') scores.posting.value = 12;
        else if (postLevel === 'low') scores.posting.value = 6;
        else scores.posting.value = 2;

        // Content score
        const content = analysis.contentAnalysis;
        if (content.patterns?.usesEmojis) scores.content.value += 5;
        if (content.patterns?.usesHashtags) scores.content.value += 5;
        if (content.patterns?.asksQuestions) scores.content.value += 5;
        if (content.patterns?.avgPostLength === 'طويل' || content.patterns?.avgPostLength === 'متوسط') scores.content.value += 5;

        // Audience score
        const followers = analysis.overview.followers;
        if (followers > 100000) scores.audience.value = 15;
        else if (followers > 50000) scores.audience.value = 12;
        else if (followers > 20000) scores.audience.value = 9;
        else if (followers > 5000) scores.audience.value = 6;
        else if (followers > 1000) scores.audience.value = 3;
        else scores.audience.value = 1;

        // Optimization score
        if (content.patterns?.usesHashtags) scores.optimization.value += 4;
        if (analysis.overview.engagementRate > 2) scores.optimization.value += 3;
        if (analysis.benchmarks.postsPerWeek.value >= 4) scores.optimization.value += 3;

        return scores;
    }

    calculateOverallScore(scores) {
        let total = 0;
        for (const key in scores) {
            total += scores[key].value;
        }
        return Math.min(100, total);
    }

    // ============= SENTIMENT ANALYSIS =============
    analyzeSentiment(data) {
        const posts = data.posts || [];
        if (posts.length === 0) {
            return { hasData: false, overall: 'neutral', breakdown: {} };
        }

        let positive = 0, negative = 0, questions = 0, neutral = 0;

        posts.forEach(post => {
            const text = (post.text || '').toLowerCase();
            let postPositive = 0, postNegative = 0, hasQuestion = false;

            this.sentimentKeywords.positive.forEach(kw => {
                if (text.includes(kw.toLowerCase())) postPositive++;
            });
            this.sentimentKeywords.negative.forEach(kw => {
                if (text.includes(kw.toLowerCase())) postNegative++;
            });
            this.sentimentKeywords.questions.forEach(kw => {
                if (text.includes(kw.toLowerCase())) hasQuestion = true;
            });

            if (postPositive > postNegative) positive++;
            else if (postNegative > postPositive) negative++;
            else neutral++;
            if (hasQuestion) questions++;
        });

        const total = posts.length;
        const positivePercent = Math.round((positive / total) * 100);
        const negativePercent = Math.round((negative / total) * 100);
        const questionPercent = Math.round((questions / total) * 100);

        let overall = 'neutral';
        if (positivePercent > 50) overall = 'positive';
        else if (negativePercent > 30) overall = 'negative';

        return {
            hasData: true,
            overall,
            breakdown: {
                positive: { count: positive, percent: positivePercent, label: 'إيجابي' },
                negative: { count: negative, percent: negativePercent, label: 'سلبي' },
                neutral: { count: neutral, percent: Math.round((neutral / total) * 100), label: 'محايد' },
                questions: { count: questions, percent: questionPercent, label: 'أسئلة' }
            },
            insight: this.getSentimentInsight(positivePercent, negativePercent, questionPercent)
        };
    }

    getSentimentInsight(pos, neg, quest) {
        if (pos > 60) return '😊 محتوى إيجابي جداً - يجذب التفاعل الإيجابي';
        if (neg > 30) return '😟 محتوى يميل للسلبية - قد يؤثر على الصورة';
        if (quest > 40) return '❓ يستخدم الأسئلة بكثرة - استراتيجية ذكية';
        return '😐 محتوى متوازن - يحتاج مزيد من الإيجابية';
    }

    // ============= POSTING PATTERNS =============
    analyzePostingPatterns(data) {
        const posts = data.posts || [];
        const metrics = data.metrics || {};

        return {
            frequency: {
                value: metrics.postsPerWeek || 0,
                label: metrics.postsPerWeek >= 5 ? 'نشط' : metrics.postsPerWeek >= 3 ? 'متوسط' : 'ضعيف',
                recommendation: metrics.postsPerWeek < 5 ? 'زِد النشر إلى 5+ أسبوعياً' : 'حافظ على هذا المستوى'
            },
            consistency: posts.length > 5 ? 'منتظم نسبياً' : 'غير واضح',
            bestTimes: this.bestPostingTimes,
            recommendation: 'أفضل وقت للنشر: المساء (18:00 - 21:00) في أيام الأسبوع'
        };
    }

    // ============= GENERATE OVERVIEW =============
    generateOverview(data) {
        const followers = data.followers || 0;
        const likes = data.likes || 0;
        const posts = data.posts || [];
        const metrics = data.metrics || {};

        const tierInfo = this.getBenchmarkRating('followersGrowth', followers);

        return {
            name: data.name || 'صفحة',
            category: data.category || 'غير محدد',
            followers,
            likes,
            followerTier: tierInfo?.tier || 'غير محدد',
            tierColor: tierInfo?.color || '#888',
            difficulty: tierInfo?.difficulty || 'غير محدد',
            engagementRate: metrics.engagementRate || 0,
            postsPerWeek: metrics.postsPerWeek || 0,
            totalPosts: posts.length,
            avgLikes: metrics.avgLikes || 0,
            avgComments: metrics.avgComments || 0,
            avgShares: metrics.avgShares || 0,
            likesToFollowersRatio: followers > 0 ? ((likes / followers) * 100).toFixed(1) : 0
        };
    }

    // ============= BENCHMARKS =============
    getBenchmarkRating(metric, value) {
        const benchmark = this.benchmarks[metric];
        if (!benchmark) return null;

        for (const [level, config] of Object.entries(benchmark)) {
            if (value <= config.max) {
                return { level, ...config };
            }
        }
        return null;
    }

    compareToBenchmarks(data) {
        const metrics = data.metrics || {};

        const engagementRating = this.getBenchmarkRating('engagementRate', metrics.engagementRate || 0);
        const postingRating = this.getBenchmarkRating('postsPerWeek', metrics.postsPerWeek || 0);

        return {
            engagementRate: {
                value: metrics.engagementRate || 0,
                rating: engagementRating,
                industryAvg: 2.5,
                comparison: this.getComparisonText(metrics.engagementRate || 0, 2.5),
                action: engagementRating?.score < 50 ? 'فرصة للتفوق!' : 'منافسة قوية'
            },
            postsPerWeek: {
                value: metrics.postsPerWeek || 0,
                rating: postingRating,
                industryAvg: 4,
                comparison: this.getComparisonText(metrics.postsPerWeek || 0, 4),
                action: postingRating?.score < 55 ? 'انشر أكثر منه' : 'حافظ على نفس الوتيرة'
            }
        };
    }

    getComparisonText(value, benchmark) {
        const diff = ((value - benchmark) / benchmark * 100).toFixed(0);
        if (value > benchmark * 1.2) return { text: `أعلى من المتوسط بـ ${diff}%`, type: 'positive', emoji: '📈' };
        if (value < benchmark * 0.8) return { text: `أقل من المتوسط بـ ${Math.abs(diff)}%`, type: 'negative', emoji: '📉' };
        return { text: 'قريب من متوسط السوق', type: 'neutral', emoji: '➡️' };
    }

    // ============= CONTENT ANALYSIS =============
    analyzeContent(data) {
        const posts = data.posts || [];
        if (posts.length === 0) {
            return { hasData: false, patterns: {} };
        }

        const stats = {
            totalPosts: posts.length,
            withText: 0, avgTextLength: 0,
            withEmojis: 0, withHashtags: 0,
            withQuestions: 0, withLinks: 0,
            withMentions: 0, withNumbers: 0
        };

        let totalTextLength = 0;
        const topPosts = [];
        const hashtagsUsed = new Set();
        const emojisUsed = [];

        posts.forEach(post => {
            const text = post.text || '';
            if (text.length > 0) {
                stats.withText++;
                totalTextLength += text.length;
            }

            // Pattern detection
            const emojiMatch = text.match(/[\u{1F300}-\u{1F9FF}]/gu);
            if (emojiMatch) {
                stats.withEmojis++;
                emojisUsed.push(...emojiMatch);
            }

            const hashtags = text.match(/#[\w\u0600-\u06FF]+/g);
            if (hashtags) {
                stats.withHashtags++;
                hashtags.forEach(h => hashtagsUsed.add(h));
            }

            if (/[؟?]/.test(text)) stats.withQuestions++;
            if (/https?:\/\//.test(text)) stats.withLinks++;
            if (/@\w+/.test(text)) stats.withMentions++;
            if (/\d+/.test(text)) stats.withNumbers++;

            const engagement = (post.likes || 0) + (post.comments || 0) * 2 + (post.shares || 0) * 3;
            topPosts.push({ ...post, totalEngagement: engagement });
        });

        stats.avgTextLength = stats.withText > 0 ? Math.round(totalTextLength / stats.withText) : 0;
        topPosts.sort((a, b) => b.totalEngagement - a.totalEngagement);

        // Percentages
        const pcts = {
            emojiPct: Math.round((stats.withEmojis / posts.length) * 100),
            hashtagPct: Math.round((stats.withHashtags / posts.length) * 100),
            questionPct: Math.round((stats.withQuestions / posts.length) * 100),
            linkPct: Math.round((stats.withLinks / posts.length) * 100),
            numberPct: Math.round((stats.withNumbers / posts.length) * 100)
        };

        // Top emojis
        const emojiCounts = {};
        emojisUsed.forEach(e => emojiCounts[e] = (emojiCounts[e] || 0) + 1);
        const topEmojis = Object.entries(emojiCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([emoji]) => emoji);

        return {
            hasData: true,
            stats,
            percentages: pcts,
            patterns: {
                usesEmojis: pcts.emojiPct > 30,
                usesHashtags: pcts.hashtagPct > 30,
                asksQuestions: pcts.questionPct > 20,
                includesLinks: pcts.linkPct > 20,
                usesNumbers: pcts.numberPct > 30,
                avgPostLength: stats.avgTextLength > 200 ? 'طويل' :
                    stats.avgTextLength > 50 ? 'متوسط' : 'قصير'
            },
            topPosts: topPosts.slice(0, 3),
            hashtagsUsed: Array.from(hashtagsUsed).slice(0, 10),
            topEmojis,
            contentStyle: this.determineContentStyle(pcts, stats)
        };
    }

    determineContentStyle(pcts, stats) {
        if (pcts.emojiPct > 50 && pcts.questionPct > 30) return '🎉 أسلوب تفاعلي وحيوي';
        if (stats.avgTextLength > 200) return '📚 أسلوب تعليمي ومفصل';
        if (pcts.linkPct > 40) return '🔗 أسلوب ترويجي';
        if (stats.avgTextLength < 50) return '⚡ أسلوب سريع ومباشر';
        return '📝 أسلوب متوازن';
    }

    // ============= SMART SWOT =============
    generateSmartSWOT(data, analysis) {
        const benchmarks = analysis.benchmarks;
        const content = analysis.contentAnalysis;
        const overview = analysis.overview;
        const sentiment = analysis.sentimentAnalysis;
        const pcts = content.percentages || {};

        // ========== STRENGTHS ==========
        analysis.strengths.push({
            icon: '👥',
            text: `${this.formatNumber(overview.followers)} متابع (${overview.followerTier})`,
            score: overview.followers > 10000 ? 'قوي' : 'متوسط'
        });

        if (benchmarks.engagementRate.value > 0) {
            const emoji = benchmarks.engagementRate.rating?.emoji || '📊';
            analysis.strengths.push({
                icon: emoji,
                text: `تفاعل ${benchmarks.engagementRate.value}% (${benchmarks.engagementRate.rating?.label})`,
                score: benchmarks.engagementRate.rating?.score > 50 ? 'قوي' : 'ضعيف'
            });
        }

        if (benchmarks.postsPerWeek.value >= 4) {
            analysis.strengths.push({
                icon: '📅',
                text: `نشاط منتظم: ${benchmarks.postsPerWeek.value} منشور/أسبوع`,
                score: 'قوي'
            });
        }

        if (content.patterns?.usesEmojis) {
            analysis.strengths.push({ icon: '😊', text: `يستخدم الإيموجي (${pcts.emojiPct}%)`, score: 'إيجابي' });
        }
        if (content.patterns?.asksQuestions) {
            analysis.strengths.push({ icon: '❓', text: `يطرح أسئلة (${pcts.questionPct}%)`, score: 'ذكي' });
        }
        if (content.patterns?.usesHashtags) {
            analysis.strengths.push({ icon: '#️⃣', text: `يستخدم هاشتاقات (${pcts.hashtagPct}%)`, score: 'جيد' });
        }
        if (sentiment.overall === 'positive') {
            analysis.strengths.push({ icon: '😊', text: 'محتوى إيجابي يجذب التفاعل', score: 'ممتاز' });
        }

        // ========== WEAKNESSES ==========
        if (benchmarks.engagementRate.rating?.score < 50) {
            analysis.weaknesses.push({
                icon: '📉',
                text: `تفاعل ${benchmarks.engagementRate.rating.label} - أقل من متوسط 2.5%`,
                opportunity: 'تفوق بسهولة!'
            });
        }

        if (benchmarks.postsPerWeek.value < 3) {
            analysis.weaknesses.push({
                icon: '🐌',
                text: `نشر قليل (${benchmarks.postsPerWeek.value}/أسبوع)`,
                opportunity: 'انشر أكثر للتفوق'
            });
        }

        if (overview.avgComments < 5) {
            analysis.weaknesses.push({
                icon: '💬',
                text: `تعليقات قليلة (متوسط ${Math.round(overview.avgComments)})`,
                opportunity: 'حفّز النقاش'
            });
        }

        if (!content.patterns?.usesHashtags) {
            analysis.weaknesses.push({
                icon: '#️⃣',
                text: `هاشتاقات ضعيفة (${pcts.hashtagPct || 0}%)`,
                opportunity: 'استخدم الهاشتاقات للتميز'
            });
        }

        if (!content.patterns?.usesEmojis) {
            analysis.weaknesses.push({
                icon: '😐',
                text: `محتوى جاف (${pcts.emojiPct || 0}% إيموجي)`,
                opportunity: 'أضف حيوية لمحتواك'
            });
        }

        if (sentiment.overall === 'negative') {
            analysis.weaknesses.push({
                icon: '😟',
                text: 'محتوى سلبي قد يؤثر على الصورة',
                opportunity: 'كن أكثر إيجابية'
            });
        }

        // ========== OPPORTUNITIES ==========
        analysis.opportunities.push({
            icon: '🎯',
            text: 'تفوق عليه بمحتوى أفضل وتفاعل أقوى',
            priority: 'high'
        });

        if (benchmarks.engagementRate.value < 3) {
            analysis.opportunities.push({
                icon: '🚀',
                text: `حقق تفاعل أعلى من ${benchmarks.engagementRate.value}%`,
                priority: 'high'
            });
        }

        if (benchmarks.postsPerWeek.value < 5) {
            analysis.opportunities.push({
                icon: '📈',
                text: `انشر أكثر من ${benchmarks.postsPerWeek.value} منشور/أسبوع`,
                priority: 'medium'
            });
        }

        if (!content.patterns?.usesEmojis) {
            analysis.opportunities.push({
                icon: '✨',
                text: 'استخدم الإيموجي للتميز عنه',
                priority: 'low'
            });
        }

        analysis.opportunities.push({
            icon: '🎬',
            text: 'استخدم الفيديو والـ Reels للوصول 3x',
            priority: 'high'
        });

        // ========== THREATS ==========
        if (overview.followers > 50000) {
            analysis.threats.push({
                icon: '⚠️',
                text: 'قاعدة متابعين كبيرة - يحتاج جهد للمنافسة',
                level: 'high'
            });
        }
        if (benchmarks.engagementRate.rating?.score > 70) {
            analysis.threats.push({
                icon: '🔥',
                text: 'تفاعل قوي - صعب المنافسة في هذه النقطة',
                level: 'medium'
            });
        }
        if (benchmarks.postsPerWeek.value >= 7) {
            analysis.threats.push({
                icon: '📊',
                text: 'نشاط عالي جداً - يحتاج التزام كبير',
                level: 'medium'
            });
        }

        // Add default threat
        if (analysis.threats.length === 0) {
            analysis.threats.push({
                icon: '👀',
                text: 'راقب تطورات المنافس باستمرار',
                level: 'low'
            });
        }

        // Limit items
        analysis.strengths = analysis.strengths.slice(0, 5);
        analysis.weaknesses = analysis.weaknesses.slice(0, 5);
        analysis.opportunities = analysis.opportunities.slice(0, 5);
        analysis.threats = analysis.threats.slice(0, 3);
    }

    // ============= STRATEGIES =============
    generateStrategies(data, analysis) {
        const strategies = [];
        const benchmarks = analysis.benchmarks;
        const content = analysis.contentAnalysis;

        if (benchmarks.engagementRate.rating?.score < 60) {
            strategies.push(this.strategies.beatLowEngagement);
        }

        if (benchmarks.postsPerWeek.value < 4) {
            strategies.push(this.strategies.beatLowPosting);
        }

        if (analysis.overview.followers < 20000) {
            strategies.push(this.strategies.audienceGrowth);
        }

        strategies.push(this.strategies.contentMastery);

        analysis.strategies = strategies.slice(0, 3);
    }

    // ============= RECOMMENDATIONS =============
    generateRecommendations(data, analysis) {
        const recommendations = [];
        const benchmarks = analysis.benchmarks;
        const content = analysis.contentAnalysis;

        // Priority 1: Engagement
        if (benchmarks.engagementRate.value < 2) {
            recommendations.push({
                priority: 'high',
                icon: '🎯',
                title: 'زيادة التفاعل (أولوية قصوى)',
                description: `المنافس لديه تفاعل ${benchmarks.engagementRate.value}% - فرصة ذهبية!`,
                actions: [
                    'اطرح سؤالاً في نهاية كل منشور',
                    'استخدم الاستفتاءات أسبوعياً',
                    'رد على كل تعليق بسرعة',
                    'استخدم Call-to-Action واضح'
                ],
                expectedImpact: 'زيادة التفاعل 40-100%'
            });
        }

        // Priority 2: Posting
        if (benchmarks.postsPerWeek.value < 4) {
            recommendations.push({
                priority: 'high',
                icon: '📅',
                title: 'زيادة النشر للتفوق',
                description: `المنافس ينشر ${benchmarks.postsPerWeek.value} فقط - انشر أكثر!`,
                actions: [
                    'جدول منشورات للأسبوع كامل',
                    'استخدم Stories يومياً',
                    'حول منشور واحد لـ 3 صيغ',
                    'استخدم أداة جدولة مثل Meta Business'
                ],
                expectedImpact: 'وصول أوسع بـ 50%'
            });
        }

        // Priority 3: Content
        if (!content.patterns?.usesEmojis || !content.patterns?.usesHashtags) {
            recommendations.push({
                priority: 'medium',
                icon: '✨',
                title: 'تحسين جودة المحتوى',
                description: 'محتوى المنافس يفتقر للجاذبية - تميّز!',
                actions: [
                    'أضف 2-3 إيموجي لكل منشور',
                    'استخدم 3-5 هاشتاقات مستهدفة',
                    'اكتب منشورات أطول وأكثر قيمة',
                    'استخدم صور وفيديوهات عالية الجودة'
                ],
                expectedImpact: 'تفاعل أعلى 25%'
            });
        }

        // Priority 4: Video
        recommendations.push({
            priority: 'medium',
            icon: '🎬',
            title: 'استراتيجية الفيديو',
            description: 'الفيديو يحصل على 3x تفاعل أكثر!',
            actions: [
                'انشر Reels قصيرة (15-30 ثانية)',
                'البث المباشر مرة أسبوعياً',
                'حول المحتوى النصي لفيديو',
                'استخدم ترجمة في الفيديوهات'
            ],
            expectedImpact: 'وصول 3x أكثر'
        });

        return recommendations.slice(0, 4);
    }

    // ============= VERDICT =============
    generateVerdict(analysis) {
        const score = analysis.overallScore;

        if (score >= 80) return '🏆 منافس قوي جداً - يحتاج استراتيجية مكثفة للتفوق';
        if (score >= 60) return '💪 منافس جيد - يمكن التفوق بالتركيز على نقاط ضعفه';
        if (score >= 40) return '🎯 منافس متوسط - فرصة ممتازة للتفوق!';
        if (score >= 20) return '🚀 منافس ضعيف - يمكن التفوق بسهولة!';
        return '⭐ منافس ضعيف جداً - فرصة ذهبية!';
    }

    assessDifficulty(data, analysis) {
        const overview = analysis.overview;
        const score = analysis.overallScore;

        if (overview.followers > 100000 && score > 70) {
            return { level: 'صعب جداً', color: '#dc2626', advice: 'ركز على نيتش مختلف أو جمهور محدد' };
        }
        if (overview.followers > 50000 && score > 60) {
            return { level: 'صعب', color: '#f97316', advice: 'يحتاج جهد كبير ومستمر' };
        }
        if (overview.followers > 20000 || score > 50) {
            return { level: 'متوسط', color: '#eab308', advice: 'منافسة معقولة مع الالتزام' };
        }
        if (overview.followers > 5000) {
            return { level: 'سهل', color: '#22c55e', advice: 'يمكن التفوق خلال 3-6 أشهر' };
        }
        return { level: 'سهل جداً', color: '#10b981', advice: 'يمكن التفوق بسرعة!' };
    }

    formatNumber(num) {
        if (!num) return '0';
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }
}

module.exports = new CompetitorAnalyzer();
