// FacebookAttachment DTO - يلفّ نوع المرفق وحمولته
// النوع 'image' للصور أو 'template' للرسائل التفاعلية.
const FacebookPayload = require('./FacebookPayload');

class FacebookAttachment {
    /**
     * @param {('image'|'video'|'template')} type
     * @param {FacebookPayload} payload
     */
    constructor(type, payload) {
        this.type = type;
        this.payload = payload;
    }

    // factory: مرفق صورة عبر attachment_id
    static imageById(attachmentId) {
        return new FacebookAttachment('image', FacebookPayload.imageById(attachmentId));
    }

    // factory: مرفق صورة عبر رابط
    static imageByUrl(url, isReusable = true) {
        return new FacebookAttachment('image', FacebookPayload.imageByUrl(url, isReusable));
    }

    // factory: مرفق وسائط (صورة/فيديو) عبر attachment_id مع نوع صريح
    static mediaById(type, attachmentId) {
        return new FacebookAttachment(type, FacebookPayload.imageById(attachmentId));
    }

    // factory: مرفق قالب أزرار
    static buttonTemplate(text, buttons) {
        return new FacebookAttachment('template', FacebookPayload.buttonTemplate(text, buttons));
    }

    toJSON() {
        return {
            type: this.type,
            payload: this.payload.toJSON()
        };
    }
}

module.exports = FacebookAttachment;
