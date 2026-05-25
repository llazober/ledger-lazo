import { POST } from '../src/app/api/crm/incoming-email/route';

async function run() {
  // Test case 1: n8n style attachment payload from iPhone (missing extension in name, filename property)
  const payload = {
    fromEmail: "luislazober@gmail.com",
    fromName: "Luis Lazo",
    subject: "W2 form from my iPhone",
    bodyText: "Here is the W2 file",
    attachments: [
      {
        filename: "IMG_iPhone_Test",
        fileType: "image/jpeg",
        base64Data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
      }
    ]
  };

  const req = new Request('http://localhost:3000/api/crm/incoming-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  console.log("Calling incoming-email POST handler directly with simulated iPhone attachment...");
  const res = await POST(req);
  console.log('Response Status:', res.status);
  const data = await res.json();
  console.log('Response Data:', JSON.stringify(data, null, 2));
}

run().catch(console.error);
