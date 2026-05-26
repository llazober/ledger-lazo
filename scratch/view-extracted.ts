import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  const doc = await prisma.document.findFirst({
    where: {
      name: { contains: 'MortgageInterest', mode: 'insensitive' },
      fileType: 'PDF'
    }
  });

  if (!doc) {
    console.error('No document found!');
  } else {
    console.log(`=== EXTRACTED TEXT FOR ${doc.name} ===`);
    console.log(doc.extractedText);
    console.log("======================================");
  }
  await prisma.$disconnect();
}

main();
