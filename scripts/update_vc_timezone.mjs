import fs from 'node:fs';

const tsFile = 'server/documents/visual-concepts.service.ts';
const jsFile = 'dist-api/documents/visual-concepts.service.js';

const oldLogic = `    const now = new Date();
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    let dayOffset = 0;
    let slotIdx = sortedSlots.findIndex((s) => {
      const [h, m] = s.time.split(":").map(Number);
      return h > currentHour || (h === currentHour && m > currentMin);
    });

    if (slotIdx === -1) {
      dayOffset = 1;
      slotIdx = 0;
    }

    let count = 0;
    for (const c of concepts) {
      const slot = sortedSlots[slotIdx];
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const [sh, sm] = slot.time.split(":").map(Number);
      targetDate.setHours(sh, sm, 0, 0);

      await pool.query(
        \`UPDATE document_visual_concepts
         SET scheduled_at = $1, target_channels = $2::jsonb, status = 'PENDING', updated_at = NOW()
         WHERE id = $3\`,
        [targetDate.toISOString(), JSON.stringify(channels), c.id]
      );
      count++;

      slotIdx++;
      if (slotIdx >= sortedSlots.length) {
        slotIdx = 0;
        dayOffset++;
      }
    }`;

const newLogicTs = `    let timezone = opts.timezone;
    if (!timezone) {
      const wsRes = await pool.query(\`SELECT timezone FROM workspaces WHERE id = $1\`, [workspaceId]);
      timezone = wsRes.rows[0]?.timezone || 'Asia/Kolkata';
    }

    const now = new Date();
    const nowParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const curHourStr = nowParts.find((p) => p.type === 'hour')?.value || '00';
    const curMinStr = nowParts.find((p) => p.type === 'minute')?.value || '00';
    const currentHour = parseInt(curHourStr === '24' ? '0' : curHourStr, 10);
    const currentMin = parseInt(curMinStr, 10);

    let dayOffset = 0;
    let slotIdx = sortedSlots.findIndex((s) => {
      const [h, m] = s.time.split(':').map(Number);
      return h > currentHour || (h === currentHour && m > currentMin);
    });

    if (slotIdx === -1) {
      dayOffset = 1;
      slotIdx = 0;
    }

    function parseDateInTz(y: string, mo: string, da: string, h: number, mi: number, tz: string): Date {
      const isoLocal = \`\${y}-\${mo}-\${da}T\${String(h).padStart(2, '0')}:\${String(mi).padStart(2, '0')}:00\`;
      try {
        const d = new Date(isoLocal + 'Z');
        const targetStr = d.toLocaleString('en-US', { timeZone: tz });
        const targetDate = new Date(targetStr);
        const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' });
        const utcDate = new Date(utcStr);
        const offsetMs = targetDate.getTime() - utcDate.getTime();
        return new Date(d.getTime() - offsetMs);
      } catch {
        return new Date(isoLocal + 'Z');
      }
    }

    let count = 0;
    for (const c of concepts) {
      const slot = sortedSlots[slotIdx];
      const checkBase = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(checkBase);

      const y = parts.find((p) => p.type === 'year')?.value || '2026';
      const mo = parts.find((p) => p.type === 'month')?.value || '01';
      const da = parts.find((p) => p.type === 'day')?.value || '01';

      const [sh, sm] = slot.time.split(':').map(Number);
      const targetUtcDate = parseDateInTz(y, mo, da, sh, sm, timezone);

      await pool.query(
        \`UPDATE document_visual_concepts
         SET scheduled_at = $1, target_channels = $2::jsonb, status = 'PENDING', updated_at = NOW()
         WHERE id = $3\`,
        [targetUtcDate.toISOString(), JSON.stringify(channels), c.id]
      );
      count++;

      slotIdx++;
      if (slotIdx >= sortedSlots.length) {
        slotIdx = 0;
        dayOffset++;
      }
    }`;

// Replace in TS file
let tsContent = fs.readFileSync(tsFile, 'utf8').replace(/\r\n/g, '\n');
if (tsContent.includes('const currentHour = now.getHours();')) {
  tsContent = tsContent.replace(oldLogic.replace(/\r\n/g, '\n'), newLogicTs);
  fs.writeFileSync(tsFile, tsContent);
  console.log('Successfully updated server/documents/visual-concepts.service.ts with timezone logic!');
} else {
  console.warn('Could not locate oldLogic in tsFile');
}

// Replace in JS file (without TS types)
const newLogicJs = newLogicTs.replace(/y: string, mo: string, da: string, h: number, mi: number, tz: string/g, 'y, mo, da, h, mi, tz');
let jsContent = fs.readFileSync(jsFile, 'utf8').replace(/\r\n/g, '\n');
if (jsContent.includes('const currentHour = now.getHours();')) {
  jsContent = jsContent.replace(oldLogic.replace(/\r\n/g, '\n'), newLogicJs);
  fs.writeFileSync(jsFile, jsContent);
  console.log('Successfully updated dist-api/documents/visual-concepts.service.js with timezone logic!');
} else {
  console.warn('Could not locate oldLogic in jsFile');
}

