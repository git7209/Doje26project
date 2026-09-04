require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool();

pool.query("SELECT current_database() AS database, current_user AS username")
  .then((result) => console.log(JSON.stringify(result.rows[0])))
  .catch((error) => console.log(JSON.stringify({ code: error.code, message: error.message })))
  .finally(() => pool.end());
