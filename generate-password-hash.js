const crypto = require('crypto');

const password = process.argv[2];
if (!password) {
  console.log('Usage: node generate-password-hash.js your_password');
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
console.log(`scrypt$${salt}$${hash}`);
