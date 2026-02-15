
const https = require('https');
require('dotenv').config();

const key = process.env.GEMINI_API_KEY;

if (!key) {
    console.error('No API Key found in .env');
    process.exit(1);
}

console.log('Fetching available models for key ending in...' + key.slice(-4));

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

https.get(url, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.error('API Error:', json.error);
            } else if (json.models) {
                console.log('\n✅ AVAILABLE MODELS:');
                console.log('-------------------');
                json.models.forEach(m => {
                    if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
                        console.log(`* ${m.name.replace('models/', '')} (${m.version})`);
                    }
                });
                console.log('-------------------\n');
            } else {
                console.log('No models found in response:', json);
            }
        } catch (e) {
            console.error('Parse Error:', e);
            console.log('Raw Data:', data);
        }
    });

}).on('error', (err) => {
    console.error('Network Error:', err);
});
