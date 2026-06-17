// اختبار الـ DTOs ومقارنة wire format (قبل/بعد)
const {
    FacebookMessage, FacebookMessageRequest, FacebookButton
} = require('../dtos/facebook');

let pass = 0, fail = 0;
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}\n   متوقع: ${e}\n   فعلي:  ${a}`); }
}

// 1) رسالة نصية بـ MESSAGE_TAG — يطابق ما يبنيه sendWithTagFallback حالياً
check('نص + MESSAGE_TAG',
    new FacebookMessageRequest({
        recipientId: 'USER1', message: FacebookMessage.text('مرحبا'),
        tag: 'POST_PURCHASE_UPDATE'
    }).toJSON(),
    { recipient: { id: 'USER1' }, messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE', message: { text: 'مرحبا' } }
);

// 2) صورة عبر attachment_id (الحملات + مسار /send)
check('صورة attachment_id',
    new FacebookMessageRequest({
        recipientId: 'USER2', message: FacebookMessage.image({ attachmentId: 'ATT123' }),
        tag: 'POST_PURCHASE_UPDATE'
    }).toJSON(),
    { recipient: { id: 'USER2' }, messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE',
      message: { attachment: { type: 'image', payload: { attachment_id: 'ATT123' } } } }
);

// 3) صورة عبر رابط
check('صورة url',
    FacebookMessage.image({ url: 'https://x.com/a.jpg' }).toJSON(),
    { attachment: { type: 'image', payload: { url: 'https://x.com/a.jpg', is_reusable: true } } }
);

// 4) fallback إلى RESPONSE (مسار /send-one) — بدون tag
check('RESPONSE fallback',
    new FacebookMessageRequest({ recipientId: 'U3', message: FacebookMessage.text('hi'), tag: 'X' }).asResponse().toJSON(),
    { recipient: { id: 'U3' }, messaging_type: 'RESPONSE', message: { text: 'hi' } }
);

// 5) قالب أزرار (جاهز للمستقبل)
check('button template',
    FacebookMessage.buttons('اختر', [FacebookButton.url('زيارة', 'https://x.com'), FacebookButton.postback('تأكيد', 'OK')]).toJSON(),
    { attachment: { type: 'template', payload: { template_type: 'button', text: 'اختر',
      buttons: [{ type: 'web_url', title: 'زيارة', url: 'https://x.com' }, { type: 'postback', title: 'تأكيد', payload: 'OK' }] } } }
);

// 6) وسائط فيديو عبر attachment_id (مسار /send) — يطابق { type:'video', payload:{ attachment_id } }
check('فيديو media',
    FacebookMessage.media('video', 'VID9').toJSON(),
    { attachment: { type: 'video', payload: { attachment_id: 'VID9' } } }
);

// 7) نفس الكائن: MESSAGE_TAG ثم تحويله RESPONSE (مسار /send-one fallback)
const oneReq = new FacebookMessageRequest({ recipientId: 'U7', message: FacebookMessage.text('t'), tag: 'POST_PURCHASE_UPDATE' });
check('send-one MESSAGE_TAG',
    oneReq.toJSON(),
    { recipient: { id: 'U7' }, messaging_type: 'MESSAGE_TAG', tag: 'POST_PURCHASE_UPDATE', message: { text: 't' } }
);
check('send-one RESPONSE بعد التحويل',
    oneReq.asResponse().toJSON(),
    { recipient: { id: 'U7' }, messaging_type: 'RESPONSE', message: { text: 't' } }
);

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
process.exit(fail ? 1 : 0);
