const { PrismaClient } = require('@prisma/client');
require('../config'); // carga el .env antes de crear el cliente
module.exports = new PrismaClient();
