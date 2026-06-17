// FacebookMessage DTO - محتوى الرسالة (نص أو مرفق)
// يمثّل حقل "message" في طلب Send API.
const FacebookAttachment = require('./FacebookAttachment');

class FacebookMessage {
    /**
     * @param {object} opts - { text } أو { attachment: FacebookAttachment }
     */
    constructor(opts = {}) {
        this.text = opts.text != null ? opts.text : null;
        this.attachment = opts.attachment || null;
    }

    // factory: رسالة نصية
    static text(text) {
        return new FacebookMessage({ text });
    }

    // factory: رسالة صورة عبر attachment_id
    static image({ attachmentId, url } = {}) {
        if (attachmentId) {
            return new FacebookMessage({ attachment: FacebookAttachment.imageById(attachmentId) });
        }
        return new FacebookMessage({ attachment: FacebookAttachment.imageByUrl(url) });
    }

    // factory: رسالة وسائط (صورة/فيديو) عبر attachment_id ونوع صريح
    static media(type, attachmentId) {
        return new FacebookMessage({ attachment: FacebookAttachment.mediaById(type, attachmentId) });
    }

    // factory: رسالة قالب أزرار (للمستقبل)
    static buttons(text, buttons) {
        return new FacebookMessage({ attachment: FacebookAttachment.buttonTemplate(text, buttons) });
    }

    toJSON() {
        if (this.attachment) {
            return { attachment: this.attachment.toJSON() };
        }
        return { text: this.text };
    }
}

module.exports = FacebookMessage;
