// FacebookRecipient DTO - يحدد مستلم الرسالة
// يلفّ معرّف المستخدم (PSID) الذي يراسل الصفحة.
class FacebookRecipient {
    /**
     * @param {string} id - معرّف المستلم (PSID) أو رقم الهاتف
     */
    constructor(id) {
        this.id = id;
    }

    toJSON() {
        return { id: this.id };
    }
}

module.exports = FacebookRecipient;
