import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

const openai = new OpenAI();

async function main() {
  const imagePath = path.join(__dirname, 'test_interactive_forms_only.png');
  if (!fs.existsSync(imagePath)) {
    console.error('Image not found:', imagePath);
    return;
  }

  const base64Image = fs.readFileSync(imagePath).toString('base64');

  console.log('Sending image to OpenAI Vision...');
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this image. Does this Form 1098 contain any filled-in client information or numbers (like Lender name, interest paid, SSN, borrower name)? Or is it just a blank form template? List all visible filled-in data.' },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${base64Image}`
            }
          }
        ]
      }
    ]
  });

  console.log('=== VISION ANALYSIS ===');
  console.log(response.choices[0].message?.content);
  console.log('=======================');
}

main();
