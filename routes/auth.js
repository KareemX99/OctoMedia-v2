// Authentication Routes
const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { generateVerificationCode, generateResetToken, sendVerificationEmail, sendResetEmail } = require('../services/email');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'octobot-saas-secret-key-2024';

// Register new user (Step 1: Create account and send verification code)
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور والاسم مطلوبين' });
        }

        // Check if user exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            if (!existingUser.isVerified) {
                // Resend verification code
                const code = generateVerificationCode();
                existingUser.verificationCode = code;
                existingUser.verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
                await existingUser.save();

                await sendVerificationEmail(email, name, code);
                return res.json({ success: true, message: 'تم إرسال كود التحقق مرة أخرى', needsVerification: true });
            }
            return res.status(409).json({ error: 'هذا البريد الإلكتروني مسجل بالفعل' });
        }

        // Generate verification code
        const verificationCode = generateVerificationCode();
        const verificationExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        // Create user (not verified yet)
        const user = await User.create({
            email,
            password,
            name,
            role: 'agent',
            isVerified: false,
            verificationCode,
            verificationExpires
        });

        // Send verification email
        await sendVerificationEmail(email, name, verificationCode);

        res.status(201).json({
            success: true,
            message: 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني للحصول على كود التحقق.',
            userId: user.id,
            needsVerification: true
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'فشل في إنشاء الحساب' });
    }
});

// Verify account (Step 2: Verify with code)
router.post('/verify', async (req, res) => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ error: 'البريد الإلكتروني والكود مطلوبين' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        if (user.isVerified) {
            return res.status(400).json({ error: 'الحساب مفعل بالفعل' });
        }

        // Check code
        if (user.verificationCode !== code) {
            return res.status(400).json({ error: 'كود التحقق غير صحيح' });
        }

        // Check expiry
        if (new Date() > user.verificationExpires) {
            return res.status(400).json({ error: 'انتهت صلاحية كود التحقق. اطلب كود جديد.' });
        }

        // Verify user
        user.isVerified = true;
        user.verificationCode = null;
        user.verificationExpires = null;
        await user.save();

        // Generate token
        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'تم تفعيل الحساب بنجاح!',
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role
            },
            token
        });

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'فشل في التحقق' });
    }
});

// Resend verification code
router.post('/resend-code', async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(404).json({ error: 'المستخدم غير موجود' });
        }

        if (user.isVerified) {
            return res.status(400).json({ error: 'الحساب مفعل بالفعل' });
        }

        const code = generateVerificationCode();
        user.verificationCode = code;
        user.verificationExpires = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        await sendVerificationEmail(email, user.name, code);

        res.json({ success: true, message: 'تم إرسال كود التحقق' });

    } catch (error) {
        res.status(500).json({ error: 'فشل في إرسال الكود' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبين' });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        // Check if verified
        if (!user.isVerified) {
            return res.status(403).json({ error: 'يجب تفعيل الحساب أولاً', needsVerification: true });
        }

        const isValid = await user.validatePassword(password);
        if (!isValid) {
            return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
        }

        if (!user.isActive) {
            return res.status(403).json({ error: 'الحساب معطل' });
        }

        // Check subscription expiration for non-admin users
        if (user.role !== 'admin' && user.subscriptionExpiresAt) {
            const expiresAt = new Date(user.subscriptionExpiresAt);
            if (expiresAt < new Date()) {
                return res.status(403).json({
                    error: 'انتهت صلاحية اشتراكك',
                    subscriptionExpired: true,
                    message: 'عذراً، انتهت صلاحية اشتراكك. برجاء التواصل مع خدمة عملاء DK-OctoBot لتجديد الاشتراك والاستمرار في استخدام النظام. شكراً لتفهمك! 💜'
                });
            }
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                permissions: user.permissions,
                isWorkingToday: user.isWorkingToday,
                subscriptionExpiresAt: user.subscriptionExpiresAt
            },
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'فشل تسجيل الدخول' });
    }
});

// Forgot password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        const user = await User.findOne({ where: { email } });
        if (!user) {
            // Don't reveal if email exists
            return res.json({ success: true, message: 'إذا كان البريد مسجلاً، سيتم إرسال رابط إعادة التعيين' });
        }

        const resetToken = generateResetToken();
        user.resetToken = resetToken;
        user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save();

        await sendResetEmail(email, user.name, resetToken);

        res.json({ success: true, message: 'تم إرسال رابط إعادة تعيين كلمة المرور' });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'فشل في إرسال الرابط' });
    }
});

// Reset password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ error: 'التوكن وكلمة المرور الجديدة مطلوبين' });
        }

        const user = await User.findOne({ where: { resetToken: token } });
        if (!user) {
            return res.status(400).json({ error: 'رابط إعادة التعيين غير صالح' });
        }

        if (new Date() > user.resetTokenExpires) {
            return res.status(400).json({ error: 'انتهت صلاحية رابط إعادة التعيين' });
        }

        user.password = password;
        user.resetToken = null;
        user.resetTokenExpires = null;
        await user.save();

        res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'فشل في تغيير كلمة المرور' });
    }
});

// Get current user (requires auth)
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'email', 'name', 'role', 'permissions', 'isActive', 'isWorkingToday', 'isVerified', 'subscriptionExpiresAt']
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get user' });
    }
});

// Get all team members (admin only)
router.get('/team', authMiddleware, adminOnly, async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: ['id', 'email', 'name', 'role', 'permissions', 'isActive', 'isWorkingToday', 'isVerified', 'subscriptionExpiresAt', 'createdAt']
        });

        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get team' });
    }
});

// Toggle working status (admin only)
router.put('/team/:userId/working', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { isWorkingToday } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.isWorkingToday = isWorkingToday;
        await user.save();

        res.json({
            success: true, user: {
                id: user.id,
                name: user.name,
                isWorkingToday: user.isWorkingToday
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Update user role (admin only)
router.put('/team/:userId/role', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        if (!['admin', 'supervisor', 'agent'].includes(role)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.role = role;
        await user.save();

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// Update user permissions (admin only)
router.put('/team/:userId/permissions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { permissions } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.permissions = permissions;
        await user.save();

        // Emit real-time notification to the employee
        if (global.io) {
            global.io.emit('permissions-updated', {
                userId: user.id,
                permissions: user.permissions
            });
            console.log(`[Permissions] Real-time update sent to user ${user.id}`);
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                permissions: user.permissions
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update permissions' });
    }
});

// Update user subscription expiration date (admin only)
router.put('/team/:userId/subscription', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;
        const { subscriptionExpiresAt } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Set subscription expiration date (can be null to remove)
        user.subscriptionExpiresAt = subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
        await user.save();

        // Emit real-time notification to the employee
        if (global.io) {
            global.io.emit('subscription-updated', {
                userId: user.id,
                subscriptionExpiresAt: user.subscriptionExpiresAt
            });
            console.log(`[Subscription] Updated for user ${user.id}: ${user.subscriptionExpiresAt}`);
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                subscriptionExpiresAt: user.subscriptionExpiresAt
            }
        });
    } catch (error) {
        console.error('Update subscription error:', error);
        res.status(500).json({ error: 'Failed to update subscription' });
    }
});

// Verify/Activate user account (admin only)
router.put('/team/:userId/verify', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.isVerified) {
            return res.status(400).json({ error: 'الحساب مفعل بالفعل' });
        }

        // Activate the user
        user.isVerified = true;
        user.verificationCode = null;
        user.verificationExpires = null;
        await user.save();

        res.json({
            success: true,
            message: 'تم تفعيل الحساب بنجاح',
            user: {
                id: user.id,
                name: user.name,
                isVerified: user.isVerified
            }
        });
    } catch (error) {
        console.error('Verify user error:', error);
        res.status(500).json({ error: 'Failed to verify user' });
    }
});

// Delete team member (admin only)
router.delete('/team/:userId', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { userId } = req.params;

        // Prevent deleting self
        if (req.user.id === userId) {
            return res.status(400).json({ error: 'Cannot delete yourself' });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        await user.destroy();
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// Auth Middleware
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

// Admin Only Middleware
function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

module.exports = { router, authMiddleware, adminOnly };
