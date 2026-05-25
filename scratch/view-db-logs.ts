import { prisma } from '../src/lib/prisma';

async function run() {
  console.log("Fetching debug logs from database...");
  const logs = await prisma.chatMessage.findMany({
    where: {
      content: {
        startsWith: '[DEBUG_LOG]'
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 10
  });

  if (logs.length === 0) {
    console.log("No debug logs found in the database yet.");
    return;
  }

  console.log(`Found ${logs.length} debug logs (showing most recent first):`);
  for (const log of logs) {
    const rawContent = log.content.replace('[DEBUG_LOG] ', '');
    try {
      const parsed = JSON.parse(rawContent);
      console.log(`\n--- Logged at ${log.createdAt.toISOString()} ---`);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(`\n--- Logged at ${log.createdAt.toISOString()} (Unparseable) ---`);
      console.log(log.content);
    }
  }
}

run().catch(console.error);
