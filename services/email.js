// Email Service - Handles verification codes and email sending
const nodemailer = require('nodemailer');

// Generate 6-digit verification code
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate reset token (longer random string)
function generateResetToken() {
    return require('crypto').randomBytes(32).toString('hex');
}

// Email transporter (configure in .env for real emails)
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

// Send verification email
async function sendVerificationEmail(email, name, code) {
    console.log(`[Email] Verification code for ${email}: ${code}`);

    if (!transporter) {
        console.log('[Email] SMTP not configured - skipping email send');
        return { success: true, message: 'Email service not configured' };
    }

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || '"DK-OctoBot" <noreply@octobot.com>',
            to: email,
            subject: 'كود التحقق من حسابك - DK-OctoBot',
            html: `
                <div style="font-family:Arial,sans-serif;direction:rtl;text-align:center;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;border-radius:16px;">
                    <div style="margin-bottom:20px;">
                        <img src="https://octomedia.octobot.it.com/logo-icon.png" alt="DK-OctoBot" style="width:100px;height:100px;" />
                    </div>
                    <h2 style="color:#E91E63;">مرحباً ${name}!</h2>
                    <p>شكراً لتسجيلك في DK-OctoBot.</p>
                    <p>كود التحقق الخاص بك هو:</p>
                    <div style="background:#f5f5f5;padding:20px;text-align:center;font-size:32px;letter-spacing:8px;font-weight:bold;color:#333;border-radius:10px;margin:20px 0;">
                        ${code}
                    </div>
                    <p style="color:#666;">هذا الكود صالح لمدة 15 دقيقة فقط.</p>
                    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
                    <p style="color:#999;font-size:12px;">إذا لم تقم بإنشاء هذا الحساب، يرجى تجاهل هذا البريد.</p>
                </div>
            `
        });
        return { success: true };
    } catch (err) {
        console.error('[Email] Send error:', err);
        return { success: false, error: err.message };
    }
}

// Send password reset email
async function sendResetEmail(email, name, token) {
    const resetUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/reset-password.html?token=${token}`;
    console.log(`[Email] Reset link for ${email}: ${resetUrl}`);

    if (!transporter) {
        console.log('[Email] SMTP not configured - skipping email send');
        return { success: true, message: 'Email service not configured' };
    }

    try {
        await transporter.sendMail({
            from: process.env.SMTP_FROM || '"DK-OctoBot" <noreply@octobot.com>',
            to: email,
            subject: 'إعادة تعيين كلمة المرور - DK-OctoBot',
            html: `
                <div style="font-family:Arial,sans-serif;direction:rtl;text-align:center;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;border-radius:16px;">
                    <div style="margin-bottom:20px;">
                        <img src="https://octomedia.octobot.it.com/logo-icon.png" alt="DK-OctoBot" style="width:100px;height:100px;" />
                    </div>
                    <h2 style="color:#E91E63;">مرحباً ${name}!</h2>
                    <p style="text-align:right;">تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بك.</p>
                    <p>اضغط على الزر أدناه لإعادة تعيين كلمة المرور:</p>
                    <div style="text-align:center;margin:30px 0;">
                        <a href="${resetUrl}" style="background:linear-gradient(135deg,#E91E63,#B039D3);color:white;padding:15px 30px;text-decoration:none;border-radius:10px;font-weight:bold;">
                            إعادة تعيين كلمة المرور
                        </a>
                    </div>
                    <p style="color:#666;">هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
                    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
                    <p style="color:#999;font-size:12px;">إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد.</p>
                </div>
            `
        });
        return { success: true };
    } catch (err) {
        console.error('[Email] Send error:', err);
        return { success: false, error: err.message };
    }
}

module.exports = {
    generateVerificationCode,
    generateResetToken,
    sendVerificationEmail,
    sendResetEmail
};
