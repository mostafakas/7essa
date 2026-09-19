// دالة Vercel الوحيدة للخادم: كل المسارات /api/* تُوجه إليها (vercel.json)
// الكود المجمّع في dist يُبنى أولًا بأمر البناء (npm run vercel-build)
module.exports = require('../dist/serverless.js').default;
