// Test phone extraction from meta_data
const metaData = [
    { key: '_billing__', value: '01118865557' },
    { key: '_billing___2_2', value: '95الوزن الطول 160' },
    { key: '_shipping_phone_2', value: '' },
    { key: 'is_vat_exempt', value: 'no' }
];

// Same logic as in ecommerceService.js
let metaPhone = null;
for (const meta of metaData) {
    if (meta.key === '_billing__' || meta.key === '_billing_phone' ||
        meta.key === '_shipping_phone' || meta.key.includes('phone')) {
        if (meta.value && typeof meta.value === 'string' && meta.value.match(/^\d+$/)) {
            metaPhone = meta.value;
            break;
        }
    }
}

console.log('=== Phone Extraction Test ===');
console.log('Found phone:', metaPhone || 'NOT FOUND');

if (metaPhone === '01118865557') {
    console.log('✅ SUCCESS! Phone extraction logic is working!');
} else {
    console.log('❌ FAILED - Phone not extracted correctly');
}
