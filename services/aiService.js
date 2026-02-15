/**
 * AI Service - OpenAI Integration
 * For generating ad content using OpenAI GPT-4o-mini (cheapest model)
 */

const OpenAI = require('openai');

class AIService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        if (this.apiKey) {
            this.client = new OpenAI({ apiKey: this.apiKey });
        }
        this.chatHistory = new Map(); // userId -> messages array
        this.productIdsCache = new Map(); // userId -> array of product IDs used in current chat
        this.model = 'gpt-4o-mini'; // Cheapest OpenAI model
    }

    /**
     * Build product context from selected products
     */
    buildProductContext(products) {
        if (!products || products.length === 0) return '';

        let context = '📦 المنتجات المحددة:\n\n';

        products.forEach((product, index) => {
            context += `${index + 1}. **${product.name}**\n`;
            if (product.description) context += `   الوصف: ${product.description}\n`;
            if (product.price) context += `   السعر: ${product.price} ج.م\n`;
            if (product.category) context += `   التصنيف: ${product.category}\n`;
            if (product.stock) context += `   المخزون: ${product.stock} قطعة\n`;
            context += '\n';
        });

        return context;
    }

    /**
     * Get the system prompt for ad generation
     */
    getSystemPrompt(products) {
        return `أنت خبير تسويق رقمي ومحترف في كتابة المحتوى الإعلاني.
مهمتك هي إنشاء محتوى إعلاني جذاب وفعال للمنتجات المحددة في القائمة أدناه **فقط**.

🚨 **تعليمات حاسمة للناتج:**
- **اكتب الإعلان مباشرة بدون أي مقدمات أو تمهيد.**
- **ممنوع نهائياً** كتابة عبارات مثل: "تمام! إليك إعلان..." أو "إليك المحتوى..." أو أي كلام تمهيدي.
- الناتج يجب أن يكون **الإعلان نفسه فقط** جاهز للنسخ والنشر مباشرة على السوشيال ميديا.
- ابدأ الإعلان بإيموجي أو عبارة جذابة مباشرة.

⛔ **تعليمات صارمة جداً (ممنوع تجاوزها):**
1. **تحدث حصرياً عن المنتجات المذكورة في القائمة أدناه فقط.**
2. **ممنوع نهائياً** ذكر أو اختراع أي منتج آخر غير موجود في القائمة.
3. إذا اختار المستخدم منتجاً واحداً، يجب أن يكون الإعلان عن هذا المنتج الوحيد فقط.
4. التزم بالأسعار والمواصفات المذكورة، ولا تؤلف أسعاراً أو خصائص من خيالك.

📝 **تعليمات التنسيق - مهمة جداً:**
- **ممنوع نهائياً** استخدام ترقيم أو عناوين مثل "1. إعلان..." أو "**إعلان منتج...**" أو أي headers.
- إذا كان هناك أكثر من منتج، اكتب **إعلان واحد متكامل** يدمج كل المنتجات بشكل سلس وجذاب.
- لا تفصل بين المنتجات بخطوط أو عناوين فرعية.
- اجعل الإعلان يتدفق بشكل طبيعي كأنه بوست واحد متماسك.
- الناتج يجب أن يكون جاهز للنسخ واللصق والنشر مباشرة بدون أي تعديل.

القواعد العامة:
1. استخدم لغة عربية سليمة وجذابة (اللهجة المصرية مقبولة).
2. أضف إيموجيز مناسبة.
3. ركز على الفوائد والقيمة.
4. أضف عبارات تحفيزية (Call to Action).

${this.buildProductContext(products)}

عند طلب كتابة إعلان، اكتب الإعلان فوراً بدون أي مقدمات أو ترقيم.`;
    }

    /**
     * Generate ad content using OpenAI GPT-4o-mini
     */
    async generateAdContent(userId, products, userMessage, isNewConversation = false) {
        try {
            if (!this.apiKey) {
                // Try to reload key from env if not set initially
                this.apiKey = process.env.OPENAI_API_KEY;
                if (!this.apiKey) throw new Error('OpenAI API Key not configured');
                this.client = new OpenAI({ apiKey: this.apiKey });
            }

            // Check if products have changed since last chat
            const currentProductIds = products.map(p => p.id).sort().join(',');
            const cachedProductIds = this.productIdsCache.get(userId) || '';
            const productsChanged = currentProductIds !== cachedProductIds;

            // Start new chat if requested, doesn't exist, or products changed
            if (isNewConversation || !this.chatHistory.has(userId) || productsChanged) {

                if (productsChanged) {
                    console.log(`[AI Service] Products changed for user ${userId}. Old: ${cachedProductIds || 'none'}, New: ${currentProductIds || 'none'}`);
                }

                // Initialize message history with system prompt
                const messages = [
                    {
                        role: 'system',
                        content: this.getSystemPrompt(products)
                    }
                ];

                this.chatHistory.set(userId, messages);
                this.productIdsCache.set(userId, currentProductIds);
            }

            const messages = this.chatHistory.get(userId);

            // Add user message to history
            messages.push({
                role: 'user',
                content: userMessage
            });

            // Call OpenAI API
            const completion = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                max_tokens: 1000,
                temperature: 0.9,
            });

            const text = completion.choices[0].message.content;

            // Add assistant response to history
            messages.push({
                role: 'assistant',
                content: text
            });

            return {
                success: true,
                content: text,
                historyLength: messages.length
            };

        } catch (error) {
            console.error('[AI Service] Error:', error);
            const errorMessage = error.message?.includes('content_policy') ?
                'عذراً، لم أتمكن من إنشاء المحتوى بسبب قيود السلامة.' :
                'حدث خطأ في الاتصال بـ AI: ' + (error.message || 'Unknown error');

            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Clear chat history for a user
     */
    clearHistory(userId) {
        this.chatHistory.delete(userId);
        return { success: true };
    }

    /**
     * Get quick suggestions based on products
     */
    getQuickPrompts() {
        return [
            '✨ اكتب لي إعلان جذاب للمنتجات دي',
            '🔥 اكتب عرض خاص مع خصم',
            '📱 اكتب بوست لإنستجرام',
            '💬 اكتب رسالة للواتساب',
            '📣 اكتب إعلان قصير وقوي'
        ];
    }
}

module.exports = new AIService();
