const bcrypt = require('bcrypt');

const password = process.argv[2];
if (!password) {
  console.log('ใส่รหัสด้วย');
  process.exit(1);
}

bcrypt.hash(password, 10).then(hash => {
  console.log(hash);
});