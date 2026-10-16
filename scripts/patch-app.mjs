import fs from 'node:fs';
let s = fs.readFileSync('app.mjs', 'utf8');
const oldText = 'const { bootstrap } = await import("./dist-api/phase-main.js");\r\n\r\nbootstrap().catch((error) => {\r\n  console.error("ContentOS startup failed:", error);\r\n  process.exit(1);\r\n});';
const newText = 'if (!process.env.QUEUE_BACKEND) process.env.QUEUE_BACKEND = "postgres";\r\n\r\nconst { bootstrap } = await import("./dist-api/phase-main.js");\r\n\r\nbootstrap().catch((error) => {\r\n  console.error("ContentOS startup failed:", error?.stack || error);\r\n  process.exit(1);\r\n});';
if (s.includes(oldText)) {
  s = s.replace(oldText, newText);
} else {
  s = s.replace('const { bootstrap } = await import("./dist-api/phase-main.js");\n\nbootstrap().catch((error) => {\n  console.error("ContentOS startup failed:", error);\n  process.exit(1);\n});', 'if (!process.env.QUEUE_BACKEND) process.env.QUEUE_BACKEND = "postgres";\n\nconst { bootstrap } = await import("./dist-api/phase-main.js");\n\nbootstrap().catch((error) => {\n  console.error("ContentOS startup failed:", error?.stack || error);\n  process.exit(1);\n});');
}
fs.writeFileSync('app.mjs', s, 'utf8');
console.log('Done');
