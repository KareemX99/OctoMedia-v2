// FacebookButton DTO - زر واحد داخل قالب أزرار (button template)
// جاهز للرسائل التفاعلية المستقبلية. يدعم نوعين: web_url و postback.
class FacebookButton {
    /**
     * @param {('web_url'|'postback')} type - نوع الزر
     * @param {string} title - النص الظاهر على الزر
     * @param {object} [opts] - { url } لـ web_url أو { payload } لـ postback
     */
    constructor(type, title, opts = {}) {
        this.type = type;
        this.title = title;
        this.url = opts.url || null;
        this.payload = opts.payload || null;
    }

    // factory: زر يفتح رابط
    static url(title, url) {
        return new FacebookButton('web_url', title, { url });
    }

    // factory: زر يرسل postback عند الضغط
    static postback(title, payload) {
        return new FacebookButton('postback', title, { payload });
    }

    toJSON() {
        const out = { type: this.type, title: this.title };
        if (this.type === 'web_url') out.url = this.url;
        if (this.type === 'postback') out.payload = this.payload;
        return out;
    }
}

module.exports = FacebookButton;
