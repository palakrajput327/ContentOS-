import fs from 'node:fs';

for (const file of ['server/db.ts', 'dist-api/db.js']) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Replace the SSL determination block
  const oldRegex = /\/\/ Determine SSL configuration flexibly[\s\S]*?poolConfig\.ssl = useSsl/m;
  const newBlock = `// Determine SSL configuration flexibly
const isExplicitlyDisabled = rawConnectionString ? /sslmode=disable|ssl=false/i.test(rawConnectionString) : false;
const isExplicitlyRequired = rawConnectionString ? /sslmode=(require|verify-ca|verify-full|prefer)|ssl=true/i.test(rawConnectionString) : false;

let useSsl = false;
if (isExplicitlyDisabled) {
  useSsl = false;
} else if (isExplicitlyRequired) {
  useSsl = true;
} else if (!localDatabase) {
  // Remote cloud database (e.g. Neon, AWS RDS, Supabase) requires SSL
  useSsl = true;
} else if (process.env.PGSSL === "true" || process.env.DATABASE_SSL === "true") {
  useSsl = true;
} else {
  // Local cPanel PostgreSQL (127.0.0.1 / localhost) does not support SSL
  useSsl = false;
}

poolConfig.ssl = useSsl`;

  if (oldRegex.test(content)) {
    content = content.replace(oldRegex, newBlock);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Successfully patched', file);
  } else {
    console.warn('Regex did not match in', file);
  }
}
