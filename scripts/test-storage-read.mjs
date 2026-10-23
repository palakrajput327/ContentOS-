import { getStorageProvider } from '../dist-api/storage/storage.factory.js';

async function main() {
  const { provider, bucket } = getStorageProvider();
  const key = 'workspaces/4386cbf8-47bf-41fe-a925-0549bced08f2/pdf-source/webp-512-v1/64b9f54370ac684a8808716d21f41548064f288e638325708cc4737b6fd66373.webp';
  console.log('Provider bucket:', bucket);
  try {
    const stream = await provider.read(bucket, key);
    console.log('Stream created:', Boolean(stream));
    stream.on('error', err => console.error('Stream error:', err));
    stream.on('data', chunk => console.log('Chunk received, size:', chunk.length));
  } catch (err) {
    console.error('Provider.read error:', err);
  }
}

main();
