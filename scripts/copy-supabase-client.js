import fs from 'node:fs';
import path from 'node:path';

const source = path.resolve('node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const targetDir = path.resolve('public/vendor');
const target = path.join(targetDir, 'supabase.js');

if (!fs.existsSync(source)) {
  throw new Error('Pinned Supabase browser client is missing; run npm install first');
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
