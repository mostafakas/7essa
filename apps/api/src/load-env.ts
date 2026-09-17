import { existsSync } from 'node:fs';

// يحمل .env عند التشغيل المباشر (متغيرات البيئة الموجودة لها الأولوية)
for (const file of ['.env', '../../.env']) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
