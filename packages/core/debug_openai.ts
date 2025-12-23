
import OpenAI from 'openai';

async function test() {
    const apiKey = process.env.OPENAI_API_KEY || 'dummy';
    const baseURL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/v1';

    console.log(`Testing with baseURL: ${baseURL}`);
    console.log(`Testing with apiKey: ${apiKey}`);

    const client = new OpenAI({
        apiKey,
        baseURL,
    });

    try {
        const response = await client.models.list();
        console.log('Response:', JSON.stringify(response, null, 2));
        console.log('Models count:', response.data.length);
    } catch (error) {
        console.error('Error:', error);
    }
}

test();
