// FacebookPayload DTO - محتوى الـ attachment
// يمثّل إما حمولة صورة (attachment_id أو url) أو قالب أزرار (button template).
class FacebookPayload {
    constructor(fields = {}) {
        // حقول الصورة
        this.attachmentId = fields.attachmentId || null;
        this.url = fields.url || null;
        this.isReusable = fields.isReusable || false;
        // حقول القالب التفاعلي
        this.templateType = fields.templateType || null;
        this.text = fields.text || null;
        this.buttons = fields.buttons || null; // مصفوفة FacebookButton
    }

    // factory: حمولة صورة عبر attachment_id قابل لإعادة الاستخدام
    static imageById(attachmentId) {
        return new FacebookPayload({ attachmentId });
    }

    // factory: حمولة صورة عبر رابط مباشر
    static imageByUrl(url, isReusable = true) {
        return new FacebookPayload({ url, isReusable });
    }

    // factory: قالب أزرار (نص + مجموعة أزرار)
    static buttonTemplate(text, buttons) {
        return new FacebookPayload({ templateType: 'button', text, buttons });
    }

    toJSON() {
        if (this.templateType === 'button') {
            return {
                template_type: 'button',
                text: this.text,
                buttons: (this.buttons || []).map(b => b.toJSON())
            };
        }
        const out = {};
        if (this.attachmentId) out.attachment_id = this.attachmentId;
        if (this.url) out.url = this.url;
        if (this.isReusable) out.is_reusable = true;
        return out;
    }
}

module.exports = FacebookPayload;
