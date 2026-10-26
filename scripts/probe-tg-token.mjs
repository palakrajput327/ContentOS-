const token1 = '8818622380:AAG2DwTkCGKT4J9ai2VDSEdNWZp81ojIeTQ0';
const token2 = '8818622380:AAG2DwTkCGKT4J9ai2VDSEdNWZp81ojIeTQ'; // without last 0
const token3 = '8818622380:AAG2DwTkCGKT4J9ai2VDSEdNWZp81ojIeTQ0'.trim();

async function test(t, label) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${t}/getMe`);
    const data = await res.json();
    console.log(`[${label}]:`, data);
  } catch (e) {
    console.error(label, e);
  }
}

async function run() {
  await test(token1, 'Exact Token Provided');
  await test(token2, 'Without last 0');
}

run();
