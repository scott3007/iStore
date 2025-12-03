require('dotenv').config();
const mysql = require('mysql2');

const pool = mysql.createPool({
    host: 'b3k-5j.h.filess.io',      // Change to your host
    port: 3307,           // Change to your user
    user: 'aistore_olderonly',           // Change to your user
    password: '7b019f6fcef0ccb4431b82784b804ede94257a22',   // Change to your password
    database: 'aistore_olderonly',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool.promise();

