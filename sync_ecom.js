// ⚠️ DISABLED — هذا السكربت خطير: ينفّذ ALTER/FORCE على قاعدة البيانات
// السبب: User.sync({alter:true}) يسبب ALTER TABLE "users" المتكرر و deadlock،
// و EcommerceStore.sync({force:true}) يحذف جدول المتاجر ويعيد إنشاءه (فقدان بيانات).
// تم تعطيله لمنع تشغيله بالخطأ على الإنتاج.
// لإعادة التفعيل عمداً: شغّل بـ  ALLOW_DANGEROUS_SYNC=1 node sync_ecom.js
if (process.env.ALLOW_DANGEROUS_SYNC !== '1') {
    console.error('⛔ sync_ecom.js معطّل. لتشغيله عمداً: ALLOW_DANGEROUS_SYNC=1 node sync_ecom.js');
    process.exit(1);
}

const { sequelize } = require('./config/database');
const User = require('./models/User'); // User model is exported directly
const EcommerceStore = require('./models/EcommerceStore')(sequelize);

async function forceSync() {
    try {
        console.log('Syncing User table...');
        await User.sync({ alter: true });
        console.log('✅ User table synced!');

        console.log('Force syncing EcommerceStore (Recreate)...');
        // Using force true to drop and recreate table ensures type changes are applied
        await EcommerceStore.sync({ force: true });
        console.log('✅ EcommerceStore synced successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error syncing:', error);
        process.exit(1);
    }
}

forceSync();
