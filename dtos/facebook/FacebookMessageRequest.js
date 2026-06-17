// FacebookMessageRequest DTO - الغلاف الخارجي لطلب Send API
// يجمّع: recipient + messaging_type + tag (اختياري) + message.
const FacebookRecipient = require('./FacebookRecipient');

class FacebookMessageRequest {
    /**
     * @param {object} opts
     * @param {string} opts.recipientId - معرّف المستلم (PSID)
     * @param {FacebookMessage} opts.message - محتوى الرسالة
     * @param {('MESSAGE_TAG'|'RESPONSE'|'UPDATE')} [opts.messagingType='MESSAGE_TAG']
     * @param {string|null} [opts.tag=null] - مطلوب فقط مع MESSAGE_TAG
     */
    constructor({ recipientId, message, messagingType = 'MESSAGE_TAG', tag = null }) {
        this.recipient = new FacebookRecipient(recipientId);
        this.message = message;
        this.messagingType = messagingType;
        this.tag = tag;
    }

    // يبدّل الـ tag ويرجّع نفس الكائن (لمحاولات fallback المتتابعة)
    withTag(tag) {
        this.messagingType = 'MESSAGE_TAG';
        this.tag = tag;
        return this;
    }

    // يحوّل الطلب لوضع RESPONSE (داخل نافذة الـ 24 ساعة، بدون tag)
    asResponse() {
        this.messagingType = 'RESPONSE';
        this.tag = null;
        return this;
    }

    toJSON() {
        const out = {
            recipient: this.recipient.toJSON(),
            messaging_type: this.messagingType
        };
        if (this.messagingType === 'MESSAGE_TAG' && this.tag) {
            out.tag = this.tag;
        }
        out.message = this.message.toJSON();
        return out;
    }
}

module.exports = FacebookMessageRequest;
